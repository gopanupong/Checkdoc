/**
 * Cloudflare Worker for PEA Official Letter Verifier & Google Drive Upload
 * Supports Cloudflare D1 Database and Gemini 1.5 Pro (or 3.1 Pro) API.
 */

// Local type definitions to satisfy compiler during React project compilation
declare global {
  interface D1Database {
    prepare(query: string): {
      bind(...args: any[]): {
        run(): Promise<any>;
      };
      all(): Promise<{ results: any[] }>;
    };
  }
  interface ExecutionContext {
    waitUntil(promise: Promise<any>): void;
    passThroughOnException(): void;
  }
}

interface Env {
  DB: D1Database; // Cloudflare D1 Binding
  GEMINI_API_KEY: string;
  GOOGLE_SERVICE_ACCOUNT_JSON: any; // Service Account JSON (string or parsed object if Cloudflare Variable Type is JSON)
  GOOGLE_DRIVE_ROOT_FOLDER_ID?: string; // Optional custom Google Drive Folder ID
  ASSETS?: {
    fetch(request: Request): Promise<Response>;
  };
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    // 1. CORS Preflight & Main Headers Configuration
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    const url = new URL(request.url);
    // Robust trailing slash and empty path matching
    const pathname = url.pathname.replace(/\/$/, "") || "/";

    try {
      // Endpoint: GET /api/documents -> Fetch verified history
      if (pathname === "/api/documents" && request.method === "GET") {
        if (!env.DB) {
          throw new Error("ระบบฐานข้อมูล D1 Database ไม่ได้รับการเชื่อมต่อ (D1 Database Binding is missing) กรุณาตรวจสอบการผูกฐานข้อมูล (D1 Binding) ใน wrangler.toml หรือ Cloudflare Workers Settings");
        }

        const { results: documents } = await env.DB.prepare(
          "SELECT d.*, a.status, a.original_text, a.warning_message, a.recommended_text FROM documents d LEFT JOIN analysis_results a ON d.id = a.document_id ORDER BY d.created_at DESC"
        ).all();

        return new Response(JSON.stringify({ success: true, data: documents }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Endpoint: POST /api/upload -> Upload files and analyze
      if (pathname === "/api/upload" && request.method === "POST") {
        const formData = await request.formData();
        const files = formData.getAll("files") as File[];

        if (!files || files.length === 0) {
          return new Response(JSON.stringify({ success: false, error: "No files provided" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const results = [];

        // Parse Service Account
        if (!env.GOOGLE_SERVICE_ACCOUNT_JSON) {
          const envKeys = Object.keys(env || {}).join(", ");
          throw new Error(`Missing GOOGLE_SERVICE_ACCOUNT_JSON environment variable. (ตัวแปรที่มีอยู่ใน env: [${envKeys || "ไม่มีเลย"}])`);
        }
        if (!env.GEMINI_API_KEY) {
          throw new Error("Missing GEMINI_API_KEY environment variable");
        }

        let serviceAccount: any;
        if (typeof env.GOOGLE_SERVICE_ACCOUNT_JSON === "object" && env.GOOGLE_SERVICE_ACCOUNT_JSON !== null) {
          serviceAccount = env.GOOGLE_SERVICE_ACCOUNT_JSON;
        } else if (typeof env.GOOGLE_SERVICE_ACCOUNT_JSON === "string") {
          let saString = env.GOOGLE_SERVICE_ACCOUNT_JSON.trim();
          if (saString.startsWith('"') && saString.endsWith('"')) {
            try {
              saString = JSON.parse(saString);
            } catch (e) {}
          }
          try {
            serviceAccount = JSON.parse(saString);
          } catch (e: any) {
            throw new Error(
              "โครงสร้าง GOOGLE_SERVICE_ACCOUNT_JSON ใน Cloudflare Settings ไม่ถูกต้องตามรูปแบบ JSON! " +
              "(ค่าที่ได้รับขึ้นต้นด้วย: '" + saString.substring(0, 30) + "...') " +
              "คุณต้องนำไฟล์ JSON ของ Service Account ทั้งก้อน (รวมวงเล็บปีกกา { ... }) ไปวางลงในช่องเก็บความลับ"
            );
          }
        } else {
          throw new Error(
            "GOOGLE_SERVICE_ACCOUNT_JSON ใน Cloudflare Settings มีประเภทข้อมูลที่ไม่ถูกต้อง: " + typeof env.GOOGLE_SERVICE_ACCOUNT_JSON
          );
        }

        if (!env.DB) {
          throw new Error("ระบบฐานข้อมูล D1 Database ไม่ได้รับการเชื่อมต่อ (D1 Database Binding is missing) กรุณาตรวจสอบการผูกฐานข้อมูล (D1 Binding) ใน wrangler.toml หรือ Cloudflare Workers Settings");
        }

        // Retrieve OAuth2 Access Token for Google Drive Upload
        const googleAccessToken = await getGoogleAccessToken(serviceAccount);

        for (const file of files) {
          const documentId = crypto.randomUUID();
          const fileBytes = await file.arrayBuffer();

          // 2. Upload file directly to designated Google Drive folder
          const folderId = env.GOOGLE_DRIVE_ROOT_FOLDER_ID || "1BYT89M2qsfiOofobM21s7hoS5Nio6wSQ";
          const uploadResult = await uploadToGoogleDrive(
            googleAccessToken,
            file.name,
            file.type,
            fileBytes,
            folderId
          );

          // 3. Store document metadata in Cloudflare D1
          await env.DB.prepare(
            "INSERT INTO documents (id, file_name, file_type, google_drive_link) VALUES (?, ?, ?, ?)"
          )
            .bind(documentId, file.name, file.type, uploadResult.webViewLink || "")
            .run();

          // 4. Send document/image data to Gemini 1.5 Pro / 3.1 Pro REST API
          const base64Data = arrayBufferToBase64(fileBytes);
          const aiAnalysis = await analyzeWithGemini(env.GEMINI_API_KEY, base64Data, file.type);

          // Extract values
          const analysisId = crypto.randomUUID();
          const hasIssues = aiAnalysis.issues && aiAnalysis.issues.length > 0;
          const status = hasIssues ? "fail" : "pass";
          const warningMessage = JSON.stringify(aiAnalysis.issues || []);
          const originalText = aiAnalysis.extracted_text || "";
          const recommendedText = aiAnalysis.recommended_full_text || "";

          // 5. Store analysis results in Cloudflare D1
          await env.DB.prepare(
            "INSERT INTO analysis_results (id, document_id, original_text, status, warning_message, recommended_text) VALUES (?, ?, ?, ?, ?, ?)"
          )
            .bind(analysisId, documentId, originalText, status, warningMessage, recommendedText)
            .run();

          results.push({
            id: documentId,
            file_name: file.name,
            file_type: file.type,
            google_drive_link: uploadResult.webViewLink,
            status,
            original_text: originalText,
            warning_message: aiAnalysis.issues || [],
            recommended_text: recommendedText,
          });
        }

        return new Response(JSON.stringify({ success: true, data: results }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // 6. Serve static assets if no API routes matched
      if (env.ASSETS) {
        return await env.ASSETS.fetch(request);
      }

      return new Response(JSON.stringify({ success: false, error: "Not Found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    } catch (err: any) {
      let errMsg = err.message || String(err);
      if (errMsg.includes("no such table")) {
        errMsg = `ไม่พบตารางในฐานข้อมูล D1 (${errMsg}) กรุณาเข้าไปที่ Cloudflare D1 Console แล้วรันคำสั่งสร้างตารางในไฟล์ schema.sql เพื่อเปิดใช้งานฐานข้อมูลให้ถูกต้อง`;
      }
      return new Response(JSON.stringify({ success: false, error: errMsg }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  },
};

/**
 * Generates Google OAuth2 Access Token from Service Account using SubtleCrypto (RS256)
 */
async function getGoogleAccessToken(sa: any): Promise<string> {
  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + 3600;

  const header = { alg: "RS256", typ: "JWT" };
  const claim = {
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/drive",
    aud: "https://oauth2.googleapis.com/token",
    exp: exp,
    iat: iat,
  };

  const base64UrlHeader = base64UrlEncode(JSON.stringify(header));
  const base64UrlClaim = base64UrlEncode(JSON.stringify(claim));
  const signatureInput = `${base64UrlHeader}.${base64UrlClaim}`;

  // Sign with private key
  const privateKeyPem = sa.private_key;
  const privateKey = await importPrivateKey(privateKeyPem);
  const encoder = new TextEncoder();
  const signatureBuffer = await crypto.subtle.sign(
    { name: "RSASSA-PKCS1-v1_5" },
    privateKey,
    encoder.encode(signatureInput)
  );

  const base64UrlSignature = arrayBufferToBase64Url(signatureBuffer);
  const jwt = `${signatureInput}.${base64UrlSignature}`;

  // Exchange JWT for access token
  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  });

  if (!tokenResponse.ok) {
    throw new Error(`Failed to exchange JWT for Google access token: ${await tokenResponse.text()}`);
  }

  const tokenData = (await tokenResponse.json()) as any;
  return tokenData.access_token;
}

/**
 * Import PEM Private Key into SubtleCrypto CryptoKey
 */
async function importPrivateKey(pem: string): Promise<CryptoKey> {
  const pemHeader = "-----BEGIN PRIVATE KEY-----";
  const pemFooter = "-----END PRIVATE KEY-----";
  
  // Handle literal "\n" strings that might result from raw copy-pasting JSON values
  let pemContents = pem
    .replace(pemHeader, "")
    .replace(pemFooter, "")
    .replace(/\\n/g, "")
    .replace(/\s+/g, "");

  const binaryDerString = atob(pemContents);
  const binaryDer = new Uint8Array(binaryDerString.length);
  for (let i = 0; i < binaryDerString.length; i++) {
    binaryDer[i] = binaryDerString.charCodeAt(i);
  }

  return await crypto.subtle.importKey(
    "pkcs8",
    binaryDer.buffer,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );
}

/**
 * Uploads a file to Google Drive using multipart/related format
 */
async function uploadToGoogleDrive(
  token: string,
  fileName: string,
  mimeType: string,
  fileData: ArrayBuffer,
  parentFolderId: string
): Promise<{ id: string; webViewLink: string }> {
  const metadata = {
    name: fileName,
    parents: [parentFolderId],
  };

  const boundary = "boundary_cloudflare_worker_pea_upload";
  const delimiter = `\r\n--${boundary}\r\n`;
  const closeDelimiter = `\r\n--${boundary}--\r\n`;

  const headerPart =
    `Content-Type: application/json; charset=UTF-8\r\n\r\n` + JSON.stringify(metadata);

  const filePartHeader = `Content-Type: ${mimeType}\r\n\r\n`;

  // Merge segments into single payload
  const encoder = new TextEncoder();
  const part1 = encoder.encode(delimiter + headerPart + delimiter + filePartHeader);
  const part2 = new Uint8Array(fileData);
  const part3 = encoder.encode(closeDelimiter);

  const body = new Uint8Array(part1.length + part2.length + part3.length);
  body.set(part1, 0);
  body.set(part2, part1.length);
  body.set(part3, part1.length + part2.length);

  const response = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": `multipart/related; boundary=${boundary}`,
      },
      body,
    }
  );

  if (!response.ok) {
    throw new Error(`Google Drive upload failed: ${await response.text()}`);
  }

  // Set permission to anyone with link (optional/recommended so we can view)
  const uploadResult = (await response.json()) as any;
  try {
    await fetch(`https://www.googleapis.com/drive/v3/files/${uploadResult.id}/permissions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        role: "reader",
        type: "anyone",
      }),
    });
  } catch (e) {
    console.warn("Failed to set file public reading permissions", e);
  }

  return uploadResult;
}

/**
 * Send file bytes to Google Gemini API
 */
async function analyzeWithGemini(
  apiKey: string,
  base64Data: string,
  mimeType: string
): Promise<{ extracted_text: string; recommended_full_text: string; issues: any[] }> {
  // Translate standard mimetypes for Gemini compatibility
  let geminiMime = mimeType;
  if (mimeType.includes("officedocument.wordprocessingml")) {
    // DOCX: can extract via OCR/Conversion or we can pass docx directly to Gemini in v1beta
    geminiMime = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  }

  const model = "gemini-1.5-pro"; // Or upgrade to gemini-2.5-pro / gemini-3.1-pro-preview
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const systemInstruction = `คุณคือผู้เชี่ยวชาญด้านอักษรศาสตร์และการเขียนหนังสือราชการในรูปแบบของการไฟฟ้าส่วนภูมิภาค (กฟภ.) หน้าที่ของคุณคือการตรวจคำผิด คำทับศัพท์ที่ไม่ถูกต้องตามระเบียบงานสารบรรณ คำที่ไม่สอดคล้อง หรือประโยคที่ขาดความสุภาพเป็นทางการ หากพบข้อผิดพลาด ให้ระบุคำ/ประโยคเดิม เหตุผลที่ไม่ถูกต้อง และพ่นประโยคที่แก้ไขแล้วตามฟอร์ม กฟภ. ที่ถูกต้องออกมา ให้ส่งผลลัพธ์เป็นโครงสร้าง JSON ดังนี้:
{
  "extracted_text": "ข้อความทั้งหมดที่ดึงออกมาระดับโครงสร้างจากเอกสาร",
  "recommended_full_text": "ร่างข้อความหนังสือราชการทั้งหมดที่ได้รับการแก้ไขข้อผิดพลาดทุกจุดเรียบร้อยแล้ว ถูกต้องร้อยเปอร์เซ็นต์ตามมาตรฐานสารบรรณ กฟภ.",
  "issues": [
    {
      "original_phrase": "คำหรือส่วนของประโยคที่ตรวจพบข้อผิดพลาด",
      "issue_type": "ประเภทความผิดพลาด (เช่น 'สะกดผิด', 'คำทับศัพท์ไม่ถูกระเบียบ', 'ไม่สุภาพ/ไม่เป็นทางการ', 'แบบฟอร์มไม่ถูกต้อง')",
      "warning_description": "คำอธิบายเหตุผลและหลักภาษาอย่างละเอียดว่าทำไมถึงผิด และในกฟภ. ต้องใช้อย่างไร",
      "corrected_phrase": "คำหรือประโยคที่ได้รับการแก้ไขและถูกต้องแล้ว"
    }
  ]
}`;

  const payload = {
    contents: [
      {
        parts: [
          {
            inlineData: {
              mimeType: geminiMime,
              data: base64Data,
            },
          },
          {
            text: "กรุณาตรวจสอบหนังสือราชการฉบับนี้อย่างละเอียดตามกฎอักษรศาสตร์และระเบียบงานสารบรรณของการไฟฟ้าส่วนภูมิภาค (กฟภ.) ค้นหาข้อผิดพลาดและส่งออกข้อมูลในรูปแบบ JSON ตามคำสั่งในระบบ",
          },
        ],
      },
    ],
    generationConfig: {
      responseMimeType: "application/json",
      temperature: 0.1,
    },
    systemInstruction: {
      parts: [
        {
          text: systemInstruction,
        },
      ],
    },
  };

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`Gemini API Error: ${await response.text()}`);
  }

  const data = (await response.json()) as any;
  const outputText = data.candidates?.[0]?.content?.parts?.[0]?.text;

  if (!outputText) {
    throw new Error("No output text received from Gemini");
  }

  return JSON.parse(outputText.trim());
}

// Utility encodings
function base64UrlEncode(str: string): string {
  const binary = new TextEncoder().encode(str);
  let base64 = btoa(String.fromCharCode(...binary));
  return base64.replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function arrayBufferToBase64Url(buf: ArrayBuffer): string {
  const binary = String.fromCharCode(...new Uint8Array(buf));
  let base64 = btoa(binary);
  return base64.replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function arrayBufferToBase64(buf: ArrayBuffer): string {
  const binary = String.fromCharCode(...new Uint8Array(buf));
  return btoa(binary);
}
