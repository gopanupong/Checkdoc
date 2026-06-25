# คู่มือการติดตั้งและคำแนะนำในการ Deploy (Vercel & Cloudflare Deployment Guide)

เอกสารฉบับนี้อธิบายวิธีการติดตั้งระบบตรวจสอบและวิเคราะห์หนังสือราชการอัจฉริยะ สำหรับ **การไฟฟ้าส่วนภูมิภาค (กฟภ.)** เพื่อรองรับการนำไปปรับใช้งานจริงบนเครือข่ายระดับโปรดักชัน

---

## 🗂️ ส่วนประกอบของระบบ (System Components)

1. **Frontend (Vite + React)**: สามารถ Deploy ได้ง่ายบน **Vercel** หรือ Cloudflare Pages
2. **Backend (Cloudflare Worker / Express)**: โค้ดสำหรับทำหน้าที่เป็น API Gateway บริดจ์ข้อมูลขึ้น Google Drive และดึงการวิเคราะห์จากโมเดล Gemini 1.5 Pro/3.1 Pro 
3. **Database (Cloudflare D1)**: ฐานข้อมูลเชิงสัมพันธ์น้ำหนักเบาและมีความรวดเร็วสูงบนขอบเครือข่าย (Edge SQLite)
4. **Storage (Google Drive)**: โฟลเดอร์ปลายทางสำหรับจัดเก็บไฟล์ผ่าน Service Account: `1BYT89M2qsfiOofobM21s7hoS5Nio6wSQ`

---

## 🛠️ ขั้นตอนที่ 1: การเตรียมโครงสร้างฐานข้อมูล (Cloudflare D1 Setup)

1. เข้าไปที่แผงควบคุม **Cloudflare Dashboard** -> **Workers & Pages** -> **D1**
2. คลิก **Create Database** และเลือก **D1** ตั้งชื่อฐานข้อมูล เช่น `pea-letter-db`
3. เข้าไปที่เมนู **Console** ของฐานข้อมูล D1 ที่คุณสร้างขึ้น แล้วคัดลอกคำสั่ง SQL จากไฟล์ `schema.sql` ในโปรเจกต์นี้ไปรันเพื่อติดตั้งตาราง:
   ```sql
   -- รันใน D1 Console
   CREATE TABLE IF NOT EXISTS documents (
     id TEXT PRIMARY KEY,
     file_name TEXT NOT NULL,
     file_type TEXT NOT NULL,
     google_drive_link TEXT,
     created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
   );

   CREATE TABLE IF NOT EXISTS analysis_results (
     id TEXT PRIMARY KEY,
     document_id TEXT NOT NULL,
     original_text TEXT NOT NULL,
     status TEXT NOT NULL,
     warning_message TEXT,
     recommended_text TEXT NOT NULL,
     created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
     FOREIGN KEY (document_id) REFERENCES documents (id) ON DELETE CASCADE
   );
   ```

4. หรือระบุในไฟล์ `wrangler.toml` สำหรับการ Binding ฐานข้อมูลกับตัว Worker:
   ```toml
   [[d1_databases]]
   binding = "DB"
   database_name = "pea-letter-db"
   database_id = "<ระบุ-d1-database-id-ของคุณ>"
   ```

---

## ⚙️ ขั้นตอนที่ 2: การเชื่อมต่อ Google Service Account & Google Drive API

เพื่อให้ Worker ของคุณสามารถอัปโหลดไฟล์เข้าไปในโฟลเดอร์ปลายทางได้โดยตรง:
1. ไปที่ **Google Cloud Console** -> เปิดใช้บริการ **Google Drive API**
2. สร้าง **Service Account** และสร้างคีย์ใหม่ในรูปแบบ **JSON** ดาวน์โหลดเก็บไว้
3. นำอีเมลของ Service Account (เช่น `pea-uploader@your-project.iam.gserviceaccount.com`) ไปกด **แชร์สิทธิ์แบบ Editor (หรือสิทธิ์การจัดระเบียบและแก้ไขไฟล์)** ให้กับโฟลเดอร์ Google Drive ปลายทาง:
   * **ลิงก์โฟลเดอร์เป้าหมายของ กฟภ.:** [https://drive.google.com/drive/folders/1BYT89M2qsfiOofobM21s7hoS5Nio6wSQ](https://drive.google.com/drive/folders/1BYT89M2qsfiOofobM21s7hoS5Nio6wSQ)

---

## 🔐 ขั้นตอนที่ 3: การกำหนด Environment Variables (Cloudflare Dashboard)

ในหน้าการจัดการ Cloudflare Worker หรือบนไฟล์ `wrangler.toml` ให้ระบุตัวแปรเหล่านี้ในแผงความปลอดภัย (Settings > Variables) เพื่อให้ Worker ดึงไปใช้งานอย่างปลอดภัย:

1. **`GEMINI_API_KEY`**: 
   * ได้รับจาก **Google AI Studio** เพื่อทำหน้าที่เชื่อมต่อ API ในการส่งตรวจวิเคราะห์อักษรศาสตร์
2. **`GOOGLE_SERVICE_ACCOUNT_JSON`**:
   * นำไฟล์ JSON ของ Service Account ที่ดาวน์โหลดมาจากขั้นตอนที่ 2 มาแปลงเป็นสตริงแถวเดียว (หรือลบตัวตัดบรรทัดให้อยู่ในบล็อกเดียวกันทั้งหมด) แล้ววางลงในช่องเก็บค่าของ Cloudflare Secret
   * **หมายเหตุ:** ในการ Deploy บน Cloudflare Worker ฟังก์ชัน SubtleCrypto ที่เขียนขึ้นใน `worker.ts` จะถอดรหัสฟิลด์ `private_key` และใช้ในการลงนาม JWT แลกเปลี่ยน Access Token อัตโนมัติโดยไม่ต้องพึ่งพาไลบรารี Node ขนาดใหญ่

---

## 🚀 ขั้นตอนที่ 4: การนำไปปรับใช้งานจริง (Deployment Actions)

### 1. Deploy ตัว Frontend ขึ้น Vercel
คุณสามารถ Deploy แอปพลิเคชัน Vite + React นี้ขึ้นไปยัง **Vercel** ได้โดยตรงภายในไม่กี่วินาที:
```bash
# ติดตั้ง Vercel CLI
npm install -g vercel

# ทำการ Deploy ขึ้น Vercel
vercel
```
หลังจาก Deploy เสร็จสิ้น ให้นำค่าที่ได้จากหน้า Vercel ไปกำหนดเป็น URL หลัก เพื่อให้เว็บบราวเซอร์สามารถเชื่อมต่อไปยัง API ได้อย่างถูกต้อง

### 2. Deploy ตัว Worker ขึ้น Cloudflare
ใช้ `wrangler` ซึ่งเป็น CLI อย่างเป็นทางการของ Cloudflare ในการ Deploy ตัวไฟล์ `worker.ts`:
```bash
# ล็อกอินเข้า Cloudflare
npx wrangler login

# ทำการ Deploy Worker ตัวเก่ง
npx wrangler deploy worker.ts --name pea-letter-worker
```
เมื่อ Deploy สำเร็จ คุณจะได้ URL Endpoint ของระบบวิเคราะห์หลังบ้าน ให้แก้ไขฝั่ง Frontend เพื่อชี้ Endpoint ในการประมวลผลไปยัง Worker ที่ทำงานจริงบนระบบโปรดักชันของท่าน
