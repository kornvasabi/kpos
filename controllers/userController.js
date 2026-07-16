// ไฟล์: controllers/userController.js
const db      = require('../config/dbpg');
const bcrypt  = require('bcryptjs');
// ============================================================
// showUserList — โหลดหน้าเว็บ (ไม่ต้อง query users แล้ว
// เพราะตารางโหลดผ่าน AJAX server-side แทน)
// ============================================================
const showUserList = async (req, res) => {
try {
// ดึงแค่ Master Data สำหรับ Dropdown (ข้อมูลน้อย โหลดไวมาก)
// ⚠️ เปลี่ยนจาก const [[groups], [branches], [departments]] เป็นโครงสร้างของ pg
const [groupsResult, branchesResult, departmentsResult] = await Promise.all([
db.query("SELECT id, group_name FROM user_groups ORDER BY id"),
db.query("SELECT id, branch_code, branch_name FROM branches ORDER BY id"),
db.query("SELECT id, dept_name FROM departments ORDER BY id")
]);
const groups = groupsResult.rows;
const branches = branchesResult.rows;
const departments = departmentsResult.rows;

    res.render('user_list', {
        title:       'จัดการผู้ใช้งาน - Myproject_ww',
        groups,
        branches,
        departments
        // ไม่ส่ง users แล้ว — DataTable ดึงเองผ่าน /api/users_data
    });
} catch (error) {
    console.error("showUserList Error:", error);
    res.render('user_list', {
        title: 'จัดการผู้ใช้งาน - Myproject_ww',
        groups: [], branches: [], departments: []
    });
}
};
// ============================================================
// getUsersData — Server-Side DataTable API
// รับ: draw, start, length, search[value]
// ส่ง: { draw, recordsTotal, recordsFiltered, data }
// ============================================================
const getUsersData = async (req, res) => {
try {
const draw    = parseInt(req.body.draw)   || 1;
const start   = parseInt(req.body.start)  || 0;
const length  = parseInt(req.body.length) || 50;
const keyword = (req.body.search?.value || '').trim();

    // ── Build WHERE clause ────────────────────────────────
     let whereClause  = '';
     let searchParams = [];
     let paramIndex = 1; // ⚠️ ตัวนับ parameter สำหรับ PostgreSQL
     
     if (keyword) {
         whereClause  = `WHERE (u.username LIKE $${paramIndex} OR u.fullname LIKE $${paramIndex + 1})`;
         searchParams = [`%${keyword}%`, `%${keyword}%`];
         paramIndex += 2;
     }
     
     // ── Base SQL ──────────────────────────────────────────
     const baseSql = `
         FROM users u
         LEFT JOIN user_groups  g ON u.group_id  = g.id
         LEFT JOIN branches     b ON u.branch_id  = b.id
         LEFT JOIN departments  d ON u.dept_id    = d.id
         ${whereClause}
     `;
     
     // ⚠️ PostgreSQL คืนค่า COUNT(*) เป็น String (bigint) ต้องแปลงเป็น Number
     const totalResult = await db.query(`SELECT COUNT(*) AS recordsTotal FROM users u`);
     const recordsTotal = Number(totalResult.rows[0].recordstotal);
     
     const filteredResult = await db.query(
         `SELECT COUNT(*) AS recordsFiltered ${baseSql}`, 
         searchParams
     );
     const recordsFiltered = Number(filteredResult.rows[0].recordsfiltered);
     
     // ⚠️ เพิ่ม LIMIT $N OFFSET $N ต่อท้าย parameter
     const dataParams = [...searchParams, length, start];
     const dataResult = await db.query(
         `SELECT u.id, u.username, u.fullname, u.force_logout, u.expires_at,
                 g.group_name, b.branch_name, d.dept_name
          ${baseSql}
          ORDER BY u.id ASC
          LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
         dataParams
     );
     const rows = dataResult.rows;
     
     res.json({ draw, recordsTotal, recordsFiltered, data: rows });
 } catch (error) {
     console.error("getUsersData Error:", error);
     res.json({ draw: 1, recordsTotal: 0, recordsFiltered: 0, data: [] });
 }
};
// ============================================================
// addUser — เพิ่มผู้ใช้ใหม่
// ============================================================
const addUser = async (req, res) => {
// ⚠️ เปลี่ยนจาก db.getConnection() เป็น pool.connect() (pg)
const client = await db.connect(); // 🔥 ใช้ client แยก
try {
     // ⚠️ เปลี่ยนจาก connection.beginTransaction() เป็น client.query('BEGIN')
     await client.query('BEGIN'); // 🚀 เริ่ม transaction
     
     const { username, password, fullname, group_id, branch_id, dept_id, accessible_branches, expires_at } = req.body;
     
     if (!username || !password || !fullname) {
         return res.json({ status: 'error', message: 'กรุณากรอกข้อมูลให้ครบ' });
     }
     
     // ── hash password ──
     const salt = await bcrypt.genSalt(10);
 	const combined = `${password}_${username}`;
     const hashedPassword = await bcrypt.hash(combined, salt);
     
     // ── insert users ──
     // ⚠️ เปลี่ยน ? เป็น $1, $2, ... และเพิ่ม RETURNING id
     const insertResult = await client.query(
         `INSERT INTO users (username, password, fullname, group_id, branch_id, dept_id, expires_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7)
          RETURNING id`,
         [username, hashedPassword, fullname, group_id || null, branch_id || null, dept_id || null, expires_at || null]
     );
     // ⚠️ เปลี่ยนจาก result.insertId เป็น result.rows[0].id
     const newUserId = insertResult.rows[0].id;
     
     // ── insert user_branches ──
     if (accessible_branches) {
         const branchesArray = Array.isArray(accessible_branches)
             ? accessible_branches
             : [accessible_branches];
         
         for (const b_id of branchesArray) {
             // ⚠️ เปลี่ยน ? เป็น $1, $2
             await client.query(
                 `INSERT INTO user_branches (user_id, branch_id) VALUES ($1, $2)`,
                 [newUserId, b_id]
             );
         }
     }
     
     // ⚠️ เปลี่ยนจาก connection.commit() เป็น client.query('COMMIT')
     await client.query('COMMIT'); // ✅ สำเร็จ → commit
     
     res.json({ status: 'success', message: 'เพิ่มผู้ใช้งานสำเร็จ' });
 } catch (error) {
     // ⚠️ เปลี่ยนจาก connection.rollback() เป็น client.query('ROLLBACK')
     await client.query('ROLLBACK'); // ❌ พัง → ย้อนทั้งหมด
     console.error("Transaction Error:", error);
     res.json({ status: 'error', message: 'เกิดข้อผิดพลาด (rollback แล้ว)' });
 } finally {
     // ⚠️ เปลี่ยนจาก connection.release() เป็น client.release()
     client.release(); // 🔥 สำคัญมาก (คืน client)
 }
};
// ============================================================
// getUser — โหลดข้อมูลขึ้นฟอร์มแก้ไข
// ============================================================
const getUser = async (req, res) => {
try {
const userId = req.params.id;

    // ⚠️ เปลี่ยนจาก const [[user], [mapped]] เป็นโครงสร้างของ pg
    // ⚠️ เปลี่ยน ? เป็น $1
    const [userResult, mappedResult] = await Promise.all([
        db.query("SELECT * FROM users WHERE id = $1", [userId]),
        db.query("SELECT branch_id FROM user_branches WHERE user_id = $1", [userId])
    ]);
    const user = userResult.rows;
    const mapped = mappedResult.rows;
    
    if (!user.length) {
        return res.json({ status: 'error', message: 'ไม่พบข้อมูลผู้ใช้งานในระบบ' });
    }
    
    const mappedBranches = mapped.map(m => m.branch_id);
    res.json({ status: 'success', data: user[0], mapped_branches: mappedBranches });
} catch (error) {
    console.error("getUser Error:", error);
    res.json({ status: 'error', message: 'เกิดข้อผิดพลาดในการดึงข้อมูล' });
}
};
// ============================================================
// updateUser — อัปเดตข้อมูลผู้ใช้
// ============================================================
const updateUser = async (req, res) => {
try {
const { id, password, fullname, group_id, branch_id, dept_id, force_logout, accessible_branches, expires_at } = req.body;

    const paramExpiresAt = (expires_at && expires_at.trim() !== '') ? expires_at : null;
     
     const g_id = group_id  || null;
     const b_id = branch_id || null;
     const d_id = dept_id   || null;
     
     if (password) {
         // ⚠️ เปลี่ยน ? เป็น $1
         const userRowResult = await db.query('SELECT username FROM users WHERE id = $1', [id]);
         const userRow = userRowResult.rows[0];
         
         if (!userRow) return res.status(404).json({ error: 'ไม่พบ user นี้ในระบบ' });
         
         const combined       = `${password}_${userRow.username}`;
         const hashedPassword = await bcrypt.hash(combined, 10);
         
         // ⚠️ เปลี่ยน ? เป็น $1, $2, ...
         await db.query(
             `UPDATE users SET password=$1, fullname=$2, group_id=$3, branch_id=$4, dept_id=$5, force_logout=$6, expires_at=$7 WHERE id=$8`,
             [hashedPassword, fullname, g_id, b_id, d_id, force_logout, paramExpiresAt, id]
         );
     } else {
         // ⚠️ เปลี่ยน ? เป็น $1, $2, ...
         await db.query(
             `UPDATE users SET fullname=$1, group_id=$2, branch_id=$3, dept_id=$4, force_logout=$5, expires_at=$6 WHERE id=$7`,
             [fullname, g_id, b_id, d_id, force_logout, paramExpiresAt, id]
         );
     }
     
     // ⚠️ เปลี่ยน ? เป็น $1
     await db.query("DELETE FROM user_branches WHERE user_id = $1", [id]);
     
     if (accessible_branches) {
         const branchesArray = Array.isArray(accessible_branches) ? accessible_branches : [accessible_branches];
         
         await Promise.all(
             branchesArray.map(acc_b_id =>
                 // ⚠️ เปลี่ยน ? เป็น $1, $2
                 db.query("INSERT INTO user_branches (user_id, branch_id) VALUES ($1, $2)", [id, acc_b_id])
             )
         );
     }
     
     // ⚠️ เปลี่ยน ? เป็น $1 และปรับโครงสร้างการรับค่า
     const updatedUserResult = await db.query(
         `SELECT u.*, g.group_name, b.branch_name, d.dept_name
          FROM users u
          LEFT JOIN user_groups  g ON u.group_id  = g.id
          LEFT JOIN branches     b ON u.branch_id  = b.id
          LEFT JOIN departments  d ON u.dept_id    = d.id
          WHERE u.id = $1`,
         [id]
     );
     const updatedUser = updatedUserResult.rows[0];
     
     res.json({ status: 'success', message: 'อัปเดตข้อมูลและสิทธิ์สาขาเรียบร้อยแล้ว!', data: updatedUser });
 } catch (error) {
     console.error("updateUser Error:", error);
     res.json({ status: 'error', message: 'เกิดข้อผิดพลาดในการอัปเดตข้อมูล' });
 }
};
// ============================================================
// deleteUser — ลบผู้ใช้
// ============================================================
const deleteUser = async (req, res) => {
try {
const { id } = req.body;

    if (id == 1) {
        return res.json({ status: 'error', message: 'ไม่อนุญาตให้ลบ Super Admin ออกจากระบบครับ!' });
    }
    
    // ⚠️ เปลี่ยน ? เป็น $1
    await db.query("DELETE FROM users WHERE id = $1", [id]);
    
    res.json({ status: 'success', message: 'ลบข้อมูลผู้ใช้งานออกจากระบบเรียบร้อยแล้ว!' });
} catch (error) {
    console.error("deleteUser Error:", error);
    res.json({ status: 'error', message: 'เกิดข้อผิดพลาด ไม่สามารถลบข้อมูลได้' });
}
};
module.exports = { showUserList, getUsersData, addUser, getUser, updateUser, deleteUser };