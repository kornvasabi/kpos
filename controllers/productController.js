const db = require('../config/dbpg');

// โหลดหน้าเว็บ
const showProductList = async (req, res) => {
    try {
        res.render('product_list', { title: 'จัดการสินค้า - ร้านโชห่วย' });
    } catch (error) {
        console.error("Error:", error);
        res.render('product_list', { title: 'จัดการสินค้า' });
    }
};

// ดึงข้อมูลเข้า DataTables
const getProductsData = async (req, res) => {
    try {
        const draw = parseInt(req.body.draw) || 1;
        const start = parseInt(req.body.start) || 0;
        const length = parseInt(req.body.length) || 50;
        const keyword = (req.body.search?.value || '').trim();

        let whereClause = '';
        let searchParams = [];

        if (keyword) {
            whereClause = `WHERE p.name LIKE $1 OR p.barcode LIKE $1 OR c.name LIKE $1`;
            searchParams = [`%${keyword}%`];
        }

        const baseSql = `FROM products p
                         LEFT JOIN categories c ON p.category_id = c.id
                         LEFT JOIN units u ON p.unit_id = u.id
                         ${whereClause}`;

        // ใช้ Parameterized Query เพื่อป้องกัน SQL Injection
        const countParams = keyword ? [`%${keyword}%`] : [];

        // แก้ไข: รับผลลัพธ์เป็น object แล้วดึง .rows ออกมา
        const totalResult = await db.query(`SELECT COUNT(*) AS "recordsTotal" FROM products`);
        const filteredResult = await db.query(`SELECT COUNT(*) AS "recordsFiltered" ${baseSql}`, searchParams);
        
        const dataQuery = `SELECT p.*, c.name as category_name, u.name as unit_name
                 ${baseSql}
                 ORDER BY p.id DESC
                 LIMIT $${searchParams.length + 1} OFFSET $${searchParams.length + 2}`;
        
        const dataResult = await db.query(dataQuery, [...searchParams, length, start]);

        // ดึงค่าจาก property rows และแถวแรก
        const recordsTotal = totalResult.rows[0].recordsTotal;
        const recordsFiltered = filteredResult.rows[0].recordsFiltered;
        const rows = dataResult.rows;

        res.json({ draw, recordsTotal, recordsFiltered, data: rows });
    } catch (error) {
        console.error("Error:", error);
        res.json({ draw: 1, recordsTotal: 0, recordsFiltered: 0, data: [] });
    }
};

// เพิ่มสินค้า
const addProduct = async (req, res) => {
    try {
        const { name, barcode, category_id, unit_id, cost_price, selling_price, min_stock, description } = req.body;

        await db.query(
            `INSERT INTO products (name, barcode, category_id, unit_id, cost_price, selling_price, min_stock, description)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [name, barcode, category_id, unit_id, cost_price, selling_price, min_stock, description]
        );

        res.json({ status: 'success', message: 'เพิ่มสินค้าเรียบร้อยแล้ว' });
    } catch (error) {
        console.error("Error:", error);
        res.json({ status: 'error', message: 'เกิดข้อผิดพลาดในการบันทึก' });
    }
};

// ============================================================
// getProduct — โหลดข้อมูลสินค้า 1 รายการขึ้นฟอร์มแก้ไข
// URL: GET /api/products/get/:id
// ============================================================
const getProduct = async (req, res) => {
    try {
        const prodId = req.params.id;

        const result = await db.query(
            `SELECT p.*, c.name as category_name, u.name as unit_name
             FROM products p
             LEFT JOIN categories c ON p.category_id = c.id
             LEFT JOIN units u ON p.unit_id = u.id
             WHERE p.id = $1`,
            [prodId]
        );

        // แก้ไข: ตรวจสอบ result.rows แทนการ destructuring โดยตรง
        if (!result.rows || result.rows.length === 0) {
            return res.json({ status: 'error', message: 'ไม่พบข้อมูลสินค้าในระบบ' });
        }

        const product = result.rows[0];
        res.json({ status: 'success', data: product });

    } catch (error) {
        console.error("getProduct Error:", error);
        res.json({ status: 'error', message: 'เกิดข้อผิดพลาดในการดึงข้อมูล' });
    }
};

// ============================================================
// updateProduct — อัปเดตข้อมูลสินค้า
// URL: POST /api/products/update
// ============================================================
const updateProduct = async (req, res) => {
    try {
        const { id, name, barcode, category_id, unit_id, cost_price, selling_price, min_stock, description } = req.body;

        if (!id || !name || !unit_id) {
            return res.json({ status: 'error', message: 'กรุณากรอกข้อมูลสำคัญให้ครบถ้วนครับ' });
        }

        await db.query(
            `UPDATE products
             SET name = $1, barcode = $2, category_id = $3, unit_id = $4,
                 cost_price = $5, selling_price = $6, min_stock = $7, description = $8
             WHERE id = $9`,
            [name, barcode, category_id, unit_id, cost_price, selling_price, min_stock, description, id]
        );

        res.json({ status: 'success', message: 'อัปเดตข้อมูลสินค้าเรียบร้อยแล้ว!' });

    } catch (error) {
        console.error("updateProduct Error:", error);
        res.json({ status: 'error', message: 'เกิดข้อผิดพลาดในการอัปเดตข้อมูลสินค้า' });
    }
};

// ============================================================
// deleteProduct — ลบสินค้า
// URL: POST /api/products/delete
// ============================================================
const deleteProduct = async (req, res) => {
    try {
        const { id } = req.body;

        if (!id) {
            return res.json({ status: 'error', message: 'ไม่ระบุรหัสสินค้าที่ต้องการลบ' });
        }

        /* 🔒 จุดตรวจสอบความปลอดภัย (Data Integrity Check):
           ก่อนจะลบสินค้า ต้องเช็คก่อนว่าสินค้านี้ถูกผูกอยู่กับรายการสั่งซื้อ หรือประวัติการขายหรือไม่
        */
        const checkResult = await db.query(
            "SELECT COUNT(*) AS count FROM stock_movements WHERE product_id = $1",
            [id]
        );

        const count = checkResult.rows[0].count;

        if (count > 0) {
            return res.json({
                status: 'error',
                message: 'ไม่สามารถลบได้ เนื่องจากสินค้านี้มีประวัติการเคลื่อนไหวสต็อก กรุณาลบประวัติก่อนครับ'
            });
        }

        // หากผ่านเงื่อนไข ไม่มีประวัติ ก็ทำการลบได้เลย
        await db.query("DELETE FROM products WHERE id = $1", [id]);

        res.json({ status: 'success', message: 'ลบข้อมูลสินค้าออกจากระบบเรียบร้อยแล้ว!' });

    } catch (error) {
        console.error("deleteProduct Error:", error);
        res.json({ status: 'error', message: 'เกิดข้อผิดพลาด ไม่สามารถลบข้อมูลสินค้าได้' });
    }
};

// ============================================================
// getCategories — ดึงรายการหมวดหมู่สำหรับ Dropdown
// URL: GET /api/categories
// ============================================================
const getCategories = async (req, res) => {
    try {
        const db = require('../config/dbpg');
        const result = await db.query('SELECT id, name FROM categories ORDER BY name');
        res.json({ status: 'success', data: result.rows });
    } catch (error) {
        console.error("Error loading categories:", error);
        res.json({ status: 'error', message: error.message });
    }
};

// ============================================================
// getUnits — ดึงรายการหน่วยนับสำหรับ Dropdown
// URL: GET /api/units
// ============================================================
const getUnits = async (req, res) => {
    try {
        const db = require('../config/dbpg');
        const result = await db.query('SELECT id, name FROM units ORDER BY name');
        res.json({ status: 'success', data: result.rows });
    } catch (error) {
        console.error("Error loading units:", error);
        res.json({ status: 'error', message: error.message });
    }
};

module.exports = {
    showProductList,
    getProductsData,
    addProduct,
    getProduct,
    updateProduct,
    deleteProduct,
    getCategories,  // เพิ่ม exports ตัวใหม่
    getUnits        // เพิ่ม exports ตัวใหม่
};