// netlify/functions/save-intake.js
// ============================================================
// PCS United • Save Financial Intake (v1.0.1)
// PURPOSE:
// - Accept POST payload from the PCS United Financial Intake embed
// - Upsert into Supabase public.financial_intakes by intake_id
//
// BODY (POST JSON):
// {
//   intake_id: "pcsint_...",
//   email: "optional@x.com",
//   mode: "ready|soon|unsure",
//   expenses: number,
//   price: number,
//   downpayment: number,
//   credit_score: number,
//   source: "pcsunited.financial.intake.v1",
//   payload: {...}   // optional raw blob
// }
//
// ENV REQUIRED:
//   SUPABASE_URL
//   SUPABASE_SERVICE_KEY
// ============================================================

const { createClient } = require("@supabase/supabase-js");

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

function respond(statusCode, payload) {
  return {
    statusCode,
    headers: CORS_HEADERS,
    body: JSON.stringify(payload || {}),
  };
}

function nOrNull(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function cleanMode(v) {
  const s = String(v || "").trim().toLowerCase();
  if (s === "ready" || s === "soon" || s === "unsure") return s;
  return null;
}

exports.handler = async function (event) {
  // ============================================================
  // //#0 CORS + METHOD
  // ============================================================
  if (event.httpMethod === "OPTIONS") return respond(200, { ok: true });
  if (event.httpMethod !== "POST") return respond(405, { ok: false, error: "Method not allowed" });

  // ============================================================
  // //#1 PARSE BODY
  // ============================================================
  let body = {};
  try {
    body = JSON.parse(event.body || "{}");
  } catch (e) {
    return respond(400, { ok: false, error: "Invalid JSON body" });
  }

  const intake_id = String(body.intake_id || "").trim();
  const email = String(body.email || "").trim().toLowerCase() || null;
  const mode = cleanMode(body.mode);

  if (!intake_id) {
    return respond(400, { ok: false, error: "intake_id is required" });
  }

  const expenses = nOrNull(body.expenses);
  const price = nOrNull(body.price);
  const downpayment = nOrNull(body.downpayment);
  const credit_score = Number.isFinite(Number(body.credit_score)) ? Math.round(Number(body.credit_score)) : null;

  const source = String(body.source || "pcsunited.financial.intake.v1").trim();
  const payload = body.payload && typeof body.payload === "object" ? body.payload : null;

  // ============================================================
  // //#2 SUPABASE CLIENT
  // ============================================================
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return respond(500, { ok: false, error: "Supabase env not configured" });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // ============================================================
  // //#3 UPSERT BY intake_id
  // ============================================================
  const row = {
    intake_id,
    email,
    mode,
    expenses,
    price,
    downpayment,
    credit_score,
    source,
    payload,
  };

  const { error } = await supabase
    .from("financial_intakes")
    .upsert([row], { onConflict: "intake_id" });

  if (error) {
    console.error("PCS United save-intake error:", error);
    return respond(500, { ok: false, error: error.message || "DB upsert failed" });
  }

  return respond(200, { ok: true, message: "Intake saved.", intake_id });
};
