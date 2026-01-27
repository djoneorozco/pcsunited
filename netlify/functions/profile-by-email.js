// netlify/functions/profile-by-email.js
// ============================================================
// PCSUnited • profile-by-email
// - POST { email }
// - Returns: { ok:true, profile:{...all columns...} }
// - CORS + OPTIONS support (required for Webflow -> Netlify)
//
// ✅ Robust ENV support:
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY  (preferred)
//   SUPABASE_SERVICE_KEY       (fallback; used by some of your other functions)
// ============================================================

const { createClient } = require("@supabase/supabase-js");

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
  "Vary": "Origin",
  "Content-Type": "application/json"
};

function respond(statusCode, payload) {
  return {
    statusCode,
    headers: CORS_HEADERS,
    body: JSON.stringify(payload || {})
  };
}

exports.handler = async function (event) {
  // --- 0) CORS preflight ---
  if (event.httpMethod === "OPTIONS") {
    return respond(200, {});
  }

  // --- 1) Enforce POST ---
  if (event.httpMethod !== "POST") {
    return respond(405, { ok: false, error: "Method not allowed" });
  }

  // --- 2) Parse body ---
  let body = {};
  try {
    body = JSON.parse(event.body || "{}");
  } catch (_) {
    return respond(400, { ok: false, error: "Invalid JSON body" });
  }

  const email = String(body.email || "").trim().toLowerCase();
  if (!email) {
    return respond(400, { ok: false, error: "Email is required" });
  }

  // --- 3) Env (robust) ---
  const SUPABASE_URL =
    process.env.SUPABASE_URL ||
    process.env.SUPABASE_PROJECT_URL ||
    "";

  const SUPABASE_SERVICE_KEY =
    process.env.SUPABASE_SERVICE_ROLE_KEY || // preferred name
    process.env.SUPABASE_SERVICE_KEY ||      // fallback name (your login.js uses this)
    "";

  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return respond(500, {
      ok: false,
      error: "Missing Supabase env vars (need SUPABASE_URL and a service key).",
      missing: {
        SUPABASE_URL: !SUPABASE_URL,
        SUPABASE_SERVICE_ROLE_KEY_or_SERVICE_KEY: !SUPABASE_SERVICE_KEY
      }
    });
  }

  // --- 4) Query profiles ---
  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false }
    });

    const { data, error } = await supabase
      .from("profiles")
      .select("*")
      .eq("email", email)
      .maybeSingle();

    if (error) {
      return respond(500, { ok: false, error: error.message });
    }

    return respond(200, { ok: true, email, profile: data || null });
  } catch (e) {
    return respond(500, { ok: false, error: e?.message || "Server error" });
  }
};
