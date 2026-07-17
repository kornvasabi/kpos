const db = require('../config/dbpg');
// 🟢 1. เปิดหน้าจอจัดการสาขา
exports.branchPage = async (req, res) => {
    res.render('branches', { title: 'จัดการข้อมูลสาขา' });
};
// 🟢 2. ดึงข้อมูลสาขาทั้งหมด (API)
exports.getBranches = async (req, res) => {
    try {
        // ⚠️ เปลี่ยนจาก const [branches] เป็น const result แล้วดึง .rows ออกมา
        // ⚠️ เปลี่ยน is_active = 1 เป็น is_active = TRUE (เพราะเราใช้ BOOLEAN ใน PostgreSQL)
        const result = await db.query(`SELECT * FROM branches WHERE is_active = TRUE ORDER BY id DESC`);
        const branches = result.rows;
        res.json({ status: 'success', data: branches });
    } catch (error) {
        console.error(error);
        res.status(500).json({ status: 'error', message: 'ดึงข้อมูลไม่สำเร็จ' });
    }
};
// 🟢 3. บันทึกสาขาใหม่ (API)
exports.addBranch = async (req, res) => {
    try {
        const { branch_code, branch_name, contact_number, address, api_url } = req.body;
        
        // ⚠️ เปลี่ยนจาก const [existing] เป็น const result แล้วดึง .rows ออกมา
        // ⚠️ เปลี่ยน ? เป็น $1
        const existingResult = await db.query('SELECT id FROM branches WHERE branch_code = $1', [branch_code]);
        const existing = existingResult.rows;
        
        if (existing.length > 0) {
            return res.json({ status: 'error', message: 'รหัสสาขานี้มีในระบบแล้ว กรุณาใช้รหัสอื่น' });
        }
        
        // ⚠️ เปลี่ยน ? เป็น $1, $2, ... และ NOW() เป็น CURRENT_TIMESTAMP
        await db.query(`
            INSERT INTO branches (branch_code, branch_name, contact_number, address, api_url, created_at, updated_at) 
            VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        `, [branch_code, branch_name, contact_number, address, api_url]);
        
        res.json({ status: 'success', message: 'บันทึกข้อมูลสาขาสำเร็จ!' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ status: 'error', message: 'เกิดข้อผิดพลาดในการบันทึก' });
    }
};
// 🟢 4. แก้ไขข้อมูลสาขา (API)
exports.updateBranch = async (req, res) => {
    try {
        const id = req.params.id;
        const { branch_code, branch_name, contact_number, address, api_url } = req.body;
        
        // ⚠️ เปลี่ยน ? เป็น $1, $2, ... และ NOW() เป็น CURRENT_TIMESTAMP
        await db.query(`
            UPDATE branches 
            SET branch_code = $1, branch_name = $2, contact_number = $3, address = $4, api_url = $5, updated_at = CURRENT_TIMESTAMP
            WHERE id = $6
        `, [branch_code, branch_name, contact_number, address, api_url, id]);
        
        res.json({ status: 'success', message: 'อัปเดตข้อมูลสำเร็จ!' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ status: 'error', message: 'อัปเดตไม่สำเร็จ' });
    }
};
// 🟢 5. ยกเลิกการใช้งานสาขา (Soft Delete) (API)
exports.deleteBranch = async (req, res) => {
    try {
        const id = req.params.id;
        
        // ⚠️ เปลี่ยน is_active = 0 เป็น is_active = FALSE (เพราะเราใช้ BOOLEAN)
        // ⚠️ เปลี่ยน ? เป็น $1 และ NOW() เป็น CURRENT_TIMESTAMP
        await db.query('UPDATE branches SET is_active = FALSE, updated_at = CURRENT_TIMESTAMP WHERE id = $1', [id]);
        
        res.json({ status: 'success', message: 'ยกเลิกสาขานี้เรียบร้อยแล้ว' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ status: 'error', message: 'ยกเลิกข้อมูลไม่สำเร็จ' });
    }
};