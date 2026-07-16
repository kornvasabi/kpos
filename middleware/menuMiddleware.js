// ไฟล์: middleware/menuMiddleware.js
const db = require('../config/dbpg');
const baseUrl = require('../config/baseUrl');

const loadMenus = async (req, res, next) => {
    if (!req.session || !req.session.user) return next();

    try {
        const groupId = req.session.user.group_id || '1';

        // ⚠️ เปลี่ยน ? เป็น $1
        const sql = `
            SELECT m.* FROM menus m
             INNER JOIN permissions p ON m.id = p.menu_id
            WHERE p.group_id = $1
            ORDER BY m.sort_order ASC;
        `;
        // ⚠️ เปลี่ยนจาก const [rows] เป็น const result แล้วดึง .rows ออกมา (โครงสร้างของ pg)
        const result = await db.query(sql, [groupId]);
        const rows = result.rows;

        // 🟢 1. สร้าง Array เก็บเฉพาะ URL ที่ User คนนี้มีสิทธิ์เข้าถึง
        // แปลงจาก user_list.php เป็น /user_list
        const allowedUrls = rows
            .filter(item => item.link !== '#') // ตัดพวกเมนูแม่ที่เป็น # ออก
            .map(item => '/' + item.link.replace('.php', ''));

        // แอบเก็บรายชื่อ URL ที่อนุญาตไว้ใน res.locals 
        res.locals.allowedUrls = allowedUrls;

        // --- โค้ดจัดกลุ่มยัดลูกใส่ไส้แม่เหมือนเดิม ---
        const menuTree = [];
        const parents = rows.filter(item => item.parent_id === 0);
        parents.forEach(parent => {
            parent.children = rows.filter(item => item.parent_id === parent.id);
            menuTree.push(parent);
         });

        res.locals.dynamicMenus = menuTree;
        next(); 
    } catch (error) {
        console.error("Menu Load Error:", error);
        res.locals.dynamicMenus = []; 
         res.locals.allowedUrls = []; 
        next();
    }
};

// ตัด BASE_URL ออกจาก path ให้เหลือ path ภายในแอป (เช่น /emis/user_list → /user_list)
function normalizePathForApp(reqPath) {
    let p = reqPath || '/';
    if (baseUrl && p.startsWith(baseUrl)) {
        p = p.slice(baseUrl.length) || '/';
    }
    if (!p.startsWith('/')) p = '/' + p;
    return p;
}

// 🟢 อัปเกรด checkPermission ให้รองรับสิทธิ์ Level และรองรับ API Routes
const checkPermission = async (req, res, next) => {
    const normalizedPath = normalizePathForApp(req.path);
    let currentPath = normalizedPath.substring(1); // ตัด / ตัวหน้าออก

    // ==========================================
    // 🚀 ทริคอัจฉริยะ: ตรวจจับว่าเป็น URL ของ API หรือไม่
    // ถ้าเป็น /api/customers/update/5 จะ ถูกตัดเหลือแค่ 'customers' เพื่อเอาไปหาในฐานข้อมูล
    // ==========================================
    if (currentPath.startsWith('api/')) {
        currentPath = currentPath.substring(4); // ตัดคำว่า 'api/' ออก
        currentPath = currentPath.split('/')[0]; // ตัดพวก /add, /update ทิ้ง เอาแค่ชื่อเมนูหลัก
    }

    // 1. อนุญาตให้เข้าหน้า Dashboard ได้เสมอ (ให้สิทธิ์สูงสุด Level 1 ไปเลย)
    if (currentPath === 'dashboard' || currentPath === '') {
        res.locals.permission = { can_view: true, can_add: true, can_edit: true, can_delete: true, access_level: 1 };
        req.currentPermission = res.locals.permission; // ส่งต่อให้ Controller
        return next();
    }
    
    try {
        // ดึง Group ID ของคนที่ล็อกอินอยู่
        const groupId = req.session.user ? req.session.user.group_id : null;
        if (!groupId) {
            // ถ้าเป็นการยิง API แล้ว Session หลุด ให้ส่ง JSON แจ้ง Error กลับไป
            if (req.path.includes('/api/')) return res.json({ status: 'error', message: 'Session หมดอายุ กรุณาล็อกอินใหม่' });
            return res.redirect(`${baseUrl}/`);
        }
        
        // 2. Query ดึงสิทธิ์ (🟢 เพิ่ม p.access_level เข้ามาด้วย)
        // ⚠️ เปลี่ยน ? เป็น $1, $2
        const sql = `
            SELECT p.can_view, p.can_rpt, p.can_add, p.can_edit, p.can_delete, p.access_level 
            FROM group_permissions p
            JOIN menus m ON p.menu_id = m.id
            WHERE p.group_id = $1 AND m.link = $2
        `;
        // ⚠️ เปลี่ยนจาก const [perms] เป็น const result แล้วดึง .rows ออกมา (โครงสร้างของ pg)
        const result = await db.query(sql, [groupId, currentPath]);
        const perms = result.rows;
        
        // 3. ตรวจสอบว่ามีสิทธิ์เข้าดู (can_view = true) หรือไม่?
        // ⚠️ เปลี่ยนจาก can_view === 1 เป็น can_view === true (เพราะเราใช้ BOOLEAN ใน PostgreSQL)
        if (perms.length > 0 && perms[0].can_view === true) {
            
            // 🚀 มีสิทธิ์ผ่าน! -> ฝากตัวแปรไปให้ EJS และ Controller ใช้งาน
            res.locals.permission = perms[0];  // สำหรับหน้า View โชว์/ซ่อนปุ่ม
            req.currentPermission = perms[0];  // สำหรับ API เอา Level ไปกรองสาขา
            
            return next(); 

        } else {
            console.log(`❌ บล็อกการเข้าถึง! ไม่มีสิทธิ์เข้า URL: ${req.path}`);

            // 🟢 ถ้าโจรพยายามแฮกยิง API เข้ามาตรงๆ ให้บล็อกและส่ง JSON กลับไปด่า
            if (req.path.includes('/api/')) {
                return res.json({ status: 'error', message: 'คุณไม่มีสิทธิ์ทำรายการนี้ครับ!' });
            }

            // ⛔ สำหรับหน้า View -> เตะกลับ Dashboard พร้อมโชว์ SweetAlert2 แบบหล่อๆ
            const dashboardHref = `${baseUrl}/dashboard`;
            const dashboardHrefJson = JSON.stringify(dashboardHref);
            return res.send(`
                 
            `);
        }

    } catch (error) {
        console.error("Check Permission Error:", error);
        if (req.path.includes('/api/')) return res.json({ status: 'error', message: 'ระบบตรวจสอบสิทธิ์ขัดข้อง' });
        return res.status(500).send("ระบบตรวจสอบสิทธิ์ขัดข้อง");
    }
};

// 🟢 ส่งออก checkPermission ไปใช้ด้วย
module.exports = { loadMenus, checkPermission };