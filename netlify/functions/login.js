// netlify/functions/login.js
//
// Logs in a Supabase Auth user (email + password)
// Returns { ok:true, user, session } on success
//
// EXPECTS ENV (recommended):
//   SUPABASE_URL
//   SUPABASE_ANON_KEY
//
// Optional fallback (not recommended for login, but supported so you don’t break):
//   SUPABASE_SERVICE_KEY  (or SUPABASE_SERVICE_ROLE_KEY)
//
// Notes:
// - 401 here usually means: wrong creds, wrong Supabase project, or user can’t sign in per Auth settings.

import { createClient } from "@supabase/supabase-js";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
  "Content-Type": "application/json"
};

function respond(statusCode, payload) {
  return {
    statusCode,
    headers: CORS_HEADERS,
    body: JSON.stringify(payload || {})
  };
}

export async function handler(event) {
  // --- 0) CORS preflight ---
  if (event.httpMethod === "OPTIONS") {
    return respond(200, { ok: true });
  }

  // --- 1) Enforce POST ---
  if (event.httpMethod !== "POST") {
    return respond(405, { ok: false, error: "Method not allowed" });
  }

  // --- 2) Parse Body ---
  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return respond(400, { ok: false, error: "Invalid JSON body" });
  }

  const email = String(body.email || "").trim().toLowerCase();
  const password = String(body.password || "").trim();

  if (!email || !password) {
    return respond(400, { ok: false, error: "Email and password are required." });
  }

  // --- 3) Init Supabase (prefer ANON key for login) ---
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

  // fallback names some people use:
  const SUPABASE_SERVICE_KEY =
    process.env.SUPABASE_SERVICE_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!SUPABASE_URL) {
    return respond(500, { ok: false, error: "SUPABASE_URL is missing in Netlify env." });
  }

  const keyInUse = SUPABASE_ANON_KEY || SUPABASE_SERVICE_KEY;

  if (!keyInUse) {
    return respond(500, {
      ok: false,
      error: "Supabase env not configured. Provide SUPABASE_ANON_KEY (recommended)."
    });
  }

  const supabase = createClient(SUPABASE_URL, keyInUse, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  // Debug mode (safe): /api/login?debug=1
  const debug = (event.queryStringParameters?.debug || "") === "1";

  // --- 4) Sign in ---
  try {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password
    });

    if (error) {
      // This is the exact reason you’re seeing 401 in Network
      return respond(401, {
        ok: false,
        error: error.message || "Invalid login credentials.",
        ...(debug
          ? {
              debug: {
                usedKey: SUPABASE_ANON_KEY ? "ANON" : "SERVICE_FALLBACK",
                emailTried: email
              }
            }
          : {})
      });
    }

    return respond(200, {
      ok: true,
      user: data.user,
      session: data.session,
      ...(debug
        ? {
            debug: {
              usedKey: SUPABASE_ANON_KEY ? "ANON" : "SERVICE_FALLBACK",
              emailTried: email
            }
          }
        : {})
    });
  } catch (e) {
    return respond(500, {
      ok: false,
      error: e?.message || "Server error during login.",
      ...(debug ? { debug: { emailTried: email } } : {})
    });
  }
}
