// netlify/functions/send-code.js
// ============================================================
// PCS United • Send Verification Code
// - POST { email, rank, lastName, phone }
// - Generates 6-digit code
// - Stores sha256 hash in Supabase email_codes
// - Sends email via Resend
// - Returns { ok: true, resendId }
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

function cleanEmail(raw) {
  // removes invisible whitespace that can break validation
  return String(raw || "")
    .replace(/\s+/g, "")
    .trim()
    .toLowerCase();
}

export const handler = async (event) => {
  // CORS preflight
  if (event.httpMethod === "OPTIONS") return respond(200, {});
  if (event.httpMethod !== "POST") return respond(405, { ok: false, error: "Method not allowed" });

  // Parse body
  let body = {};
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return respond(400, { ok: false, error: "Invalid JSON body" });
  }

  const email = cleanEmail(body.email);
  const rank = String(body.rank || "");
  const lastName = String(body.lastName || "");
  const phone = String(body.phone || "");

  if (!email || !/^[^@]+@[^@]+\.[^@]+$/.test(email)) {
    return respond(400, { ok: false, error: "Valid email required" });
  }

  // Env checks
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
  const RESEND_API_KEY = process.env.RESEND_API_KEY;

  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return respond(500, { ok: false, error: "Supabase env not configured" });
  }
  if (!RESEND_API_KEY) {
    return respond(500, { ok: false, error: "RESEND_API_KEY missing" });
  }

  // Generate + hash
  const code = makeCode();
  const code_hash = hashCode(code);
  const now = new Date().toISOString();
  const expiresAt = new Date("2075-01-01T00:00:00Z").toISOString(); // effectively no expiration

  // Supabase insert
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

  // Resend
  const resend = new Resend(RESEND_API_KEY);

  // MUST be a verified sender domain inside Resend
  const fromAddress =
    process.env.EMAIL_FROM ||
    process.env.FROM_EMAIL ||
    "PCS United <noreply@theorozcorealty.com>";

  const subject = "PCS United • Your 6-Digit Verification Code";

  const helloLine = `Hi ${[rank, lastName].filter(Boolean).join(" ").trim() || "there"},`;

  const textBody = `${helloLine}

Your PCS United verification code is: ${code}

If you didn’t request this, you can ignore this email.
`;

  const htmlEmailBody = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>PCS United Verification</title>
</head>
<body style="margin:0;background:#0b0e1a;font-family:Inter,system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;">
  <div style="max-width:560px;margin:32px auto;padding:22px;">
    <div style="background:linear-gradient(180deg,#101426,#0f1324);border:1px solid rgba(255,255,255,0.10);border-radius:16px;box-shadow:0 24px 48px rgba(0,0,0,.55);padding:22px;color:#e9ecff;">
      <div style="font-weight:900;letter-spacing:.08em;text-transform:uppercase;font-size:12px;color:#a8b0d6;">
        PCS UNITED • ACCOUNT VERIFICATION
      </div>

      <h1 style="margin:10px 0 6px;font-size:20px;line-height:1.25;">
        Your 6-Digit Verification Code
      </h1>

      <p style="margin:0 0 14px;color:#a8b0d6;font-size:14px;line-height:1.6;">
        ${helloLine}<br/>
        Use this code to verify your email and continue.
      </p>

      <div style="margin:18px 0 16px;padding:14px 16px;border-radius:14px;
                  background:rgba(12,14,25,0.65);border:1px solid rgba(255,255,255,0.10);
                  text-align:center;font-size:28px;font-weight:900;letter-spacing:8px;color:#8ef3c5;">
        ${code}
      </div>

      <p style="margin:0;color:#a8b0d6;font-size:12px;line-height:1.6;">
        Don’t share this code with anyone. If you didn’t request it, you can ignore this email.
      </p>

      <div style="margin-top:16px;padding-top:14px;border-top:1px solid rgba(255,255,255,0.08);
                  color:#a8b0d6;font-size:12px;line-height:1.6;">
        <strong style="color:#e9ecff;">PCS United</strong><br/>
        Support: reply to this email
      </div>
    </div>
  </div>
</body>
</html>`;

  try {
    const result = await resend.emails.send({
      from: fromAddress,
      to: [email],
      subject,
      text: textBody,
      html: htmlEmailBody,
    });

    console.log("Resend send result:", result);

    return respond(200, {
      ok: true,
      message: "Code created, stored, and sent.",
      resendId: result?.id || null,
    });
  } catch (mailErr) {
    console.error("Resend error:", mailErr);
    return respond(500, { ok: false, error: "Email send failed", details: String(mailErr?.message || mailErr) });
  }
};
