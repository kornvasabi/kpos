const db = require('../config/dbpg');
const baseUrl = require('../config/baseUrl');

const requireAuth = async (req, res, next) => {
    if (req.session && req.session.user) {
        try {
            // ⚠️ เปลี่ยนจาก const [users] เป็น const result แล้วดึง .rows ออกมา (โครงสร้างของ pg)
            // และเปลี่ยน ? เป็น $1
            const result = await db.query(
                'SELECT force_logout, expires_at FROM users WHERE id = $1',
                [req.session.user.id]
            );
            const users = result.rows;

            if (users.length > 0) {
                const user = users[0];
                
                // หมายเหตุ: หากในฐานข้อมูลคุณเปลี่ยน force_logout เป็น BOOLEAN (true/false) 
                // บรรทัดด้านล่างอาจต้องเปลี่ยนเป็น user.force_logout === true 
                // แต่หากยังใช้ SMALLINT (0/1) อยู่ ให้คงเป็น 1 ตามเดิมได้เลยครับ
                if (user.force_logout === 1) {
                    req.session.destroy();
                    return res.redirect(`${baseUrl}/?error=kicked`); 
                }
                
                if (user.expires_at) {
                    const now = new Date();
                    const expireTime = new Date(user.expires_at);
                    if (now > expireTime) {
                        req.session.destroy();
                        return res.redirect(`${baseUrl}/?error=expired`);
                    }
                }
                
                return next(); 
            }
        } catch (error) {
            console.error("Auth Middleware Error:", error);
            return res.redirect(`${baseUrl}/`);
        }
    }
    return res.redirect(`${baseUrl}/`);
};

module.exports = { requireAuth };