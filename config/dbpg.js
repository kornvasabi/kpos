const { Pool } = require('pg');
require('dotenv').config(); // โหลดค่าจาก .env

// สร้าง Pool เพื่อการเชื่อมต่อที่เสถียร (สไตล์ IT Support)
const pool = new Pool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT || 5432, // ⚠️ เปลี่ยนเป็นพอร์ตเริ่มต้นของ PostgreSQL (5432)
    
    // การตั้งค่า Pool ใน pg
    max: 10,                // เทียบเท่า connectionLimit (จำนวน connection สูงสุดใน pool)
    idleTimeoutMillis: 30000, // ปิด connection ที่ไม่ได้ใช้งานนานเกิน 30 วินาที
    connectionTimeoutMillis: 2000, // ถ้าเชื่อมต่อไม่สำเร็จภายใน 2 วินาที ให้คืน Error (ป้องกัน Queue ค้าง)
});

// ทดสอบการเชื่อมต่อเบื้องต้น (สไตล์ Tester)
pool.connect()
    .then(client => {
        console.log('✅ เชื่อมต่อ PostgreSQL สำเร็จ! (Host:', process.env.DB_HOST, ')');
        client.release(); // 🔥 สำคัญ: คืน connection กลับสู่ pool หลังทดสอบเสร็จ
    })
    .catch(err => {
        console.error('❌ เชื่อมต่อ PostgreSQL ล้มเหลว:', err.message);
    });

// จัดการ Error ที่เกิดจาก Pool โดยรวม (ป้องกันแอป Crash แบบเงียบๆ)
pool.on('error', (err, client) => {
    console.error('⚠️ เกิดข้อผิดพลาดที่ไม่คาดคิดใน PostgreSQL Pool:', err);
});

module.exports = pool;