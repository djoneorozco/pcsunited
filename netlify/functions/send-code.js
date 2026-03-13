// netlify/functions/send-code.js
// ============================================================
// PCS United • Send Verification Code
// PURPOSE:
// - Accept POST { email, rank, lastName, phone }
// - Generate 6-digit code
// - Hash code (never store raw code)
// - Insert row into Supabase (email_codes: email, code_hash, attempts, created_at, expires_at)
// - Send email via Resend (HTML + text)
// - Return { ok: true, emailId }
//
// Notes:
// - Designed for repos using package.json: { "type": "module" }
// - Uses verified sending domain via EMAIL_FROM / FROM_EMAIL
// ============================================================

import crypto from "crypto";
import { Resend } from "resend";
import { createClient } from "@supabase/supabase-js";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

function respond(statusCode, payloadObj) {
  return {
    statusCode,
    headers: CORS_HEADERS,
    body: JSON.stringify(payloadObj || {}),
  };
}

function makeCode() {
  const n = crypto.randomInt(0, 1000000);
  return n.toString().padStart(6, "0");
}

function hashCode(code) {
  return crypto.createHash("sha256").update(code).digest("hex");
}

function isValidEmail(email) {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email);
}

export async function handler(event) {
  // ===== CORS preflight =====
  if (event.httpMethod === "OPTIONS") return respond(200, {});
  if (event.httpMethod !== "POST") return respond(405, { ok: false, error: "Method not allowed" });

  // ===== Parse body =====
  let body = {};
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return respond(400, { ok: false, error: "Invalid JSON body" });
  }

  const email = String(body.email || "").trim().toLowerCase();
  const rank = String(body.rank || "").trim();         // display only
  const lastName = String(body.lastName || "").trim(); // display only
  const phone = String(body.phone || "").trim();       // display only

  if (!email || !isValidEmail(email)) {
    return respond(400, { ok: false, error: "Valid email required" });
  }

  // ===== Env =====
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
  const RESEND_API_KEY = process.env.RESEND_API_KEY;

  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return respond(500, { ok: false, error: "Supabase env not configured" });
  }
  if (!RESEND_API_KEY) {
    return respond(500, { ok: false, error: "Email service not configured (missing RESEND_API_KEY)" });
  }

  // ===== Generate + hash code =====
  const code = makeCode();
  const code_hash = hashCode(code);
  const now = new Date().toISOString();
  const expiresAt = new Date("2075-01-01T00:00:00Z").toISOString(); // effectively no expiration

  // ===== Supabase insert =====
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false },
  });

  const { error: insertErr } = await supabase.from("email_codes").insert([
    {
      email,
      code_hash,
      attempts: 0,
      created_at: now,
      expires_at: expiresAt,
    },
  ]);

  if (insertErr) {
    console.error("Supabase insert error:", insertErr);
    return respond(500, { ok: false, error: "DB insert failed" });
  }

  // ===== Resend send =====
  const fromAddress =
    process.env.EMAIL_FROM ||
    process.env.FROM_EMAIL ||
    "PCS United <noreply@theorozcorealty.com>"; // must be a verified domain in Resend

  const resend = new Resend(RESEND_API_KEY);

  const greetingBits = [];
  if (rank) greetingBits.push(rank);
  if (lastName) greetingBits.push(lastName);
  const greet = greetingBits.length ? greetingBits.join(" ") : "there";

  const subject = "PCS United • Your 6-Digit Verification Code";

  const textBody =
`Hi ${greet},

Your PCS United verification code is: ${code}

If you didn’t request this, you can ignore this email.
`;

  const htmlEmailBody = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>PCS United Verification</title>
  <style>
    body{margin:0;background:#0b0e1a;font-family:Inter,system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;}
    .wrap{max-width:560px;margin:40px auto;padding:0 16px;}
    .card{background:#101426;border:1px solid rgba(255,255,255,.10);border-radius:16px;box-shadow:0 24px 48px rgba(0,0,0,.55);overflow:hidden;}
    .top{padding:22px 22px 10px;}
    .brand{color:#e9ecff;font-weight:900;letter-spacing:.08em;text-transform:uppercase;font-size:12px;opacity:.9}
    h1{margin:10px 0 0;color:#e9ecff;font-size:22px;line-height:1.2}
    p{margin:10px 0 0;color:#a8b0d6;font-size:14px;line-height:1.6}
    .codebox{margin:18px 0 0;display:inline-block;background:rgba(12,14,25,.65);border:1px solid rgba(255,255,255,.12);border-radius:12px;padding:14px 18px;color:#e9ecff;font-size:30px;font-weight:900;letter-spacing:6px}
    .meta{padding:0 22px 22px;}
    .hr{height:1px;background:rgba(255,255,255,.08);margin:18px 0}
    .fine{font-size:12px;color:rgba(168,176,214,.85)}
  </style>
</head>
<body>
  <div class="wrap">
    <div class="card">
      <div class="top">
        <div class="brand">PCS United</div>
        <h1>Your verification code</h1>
        <p>Hi <strong style="color:#e9ecff">${greet}</strong>, use this code to continue your signup.</p>
        <div class="codebox">${code}</div>
      </div>
      <div class="meta">
        <div class="hr"></div>
        <p class="fine">If you didn’t request this, you can safely ignore this email.</p>
        ${phone ? `<p class="fine">Phone on file: ${phone}</p>` : ``}
      </div>
    </div>
  </div>
</body>
</html>`;

  try {
    const emailRes = await resend.emails.send({
      from: fromAddress,
      to: [email],
      subject,
      text: textBody,
      html: htmlEmailBody,
    });

    console.log("Resend send result:", emailRes);

    // Resend usually returns: { id: "..." }
    return respond(200, {
      ok: true,
      message: "Code created, stored, and queued for delivery.",
      emailId: emailRes?.id || null,
    });
  } catch (mailErr) {
    console.error("Resend error:", mailErr);
    return respond(500, { ok: false, error: "Email send failed" });
  }
}
