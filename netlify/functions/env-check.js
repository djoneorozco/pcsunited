// netlify/functions/env-check.js
// ============================================================
// PCSUnited • env-check (DIAGNOSTIC)
// - POST (or GET) returns what env vars exist (names only) + lengths
// - DOES NOT expose secrets
// ============================================================

function corsHeaders(origin = "*") {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin"
  };
}

export const handler = async (event) => {
  const origin = event.headers?.origin || "*";

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: corsHeaders(origin), body: "" };
  }

  const keys = Object.keys(process.env || {}).sort();
  const supabaseKeys = keys.filter(k => k.startsWith("SUPABASE_"));

  const url = process.env.SUPABASE_URL || "";
  const role = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

  return {
    statusCode: 200,
    headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
    body: JSON.stringify({
      ok: true,
      node: process.version,
      has: {
        SUPABASE_URL: !!url,
        SUPABASE_SERVICE_ROLE_KEY: !!role
      },
      lengths: {
        SUPABASE_URL: url.length,
        SUPABASE_SERVICE_ROLE_KEY: role.length
      },
      supabase_env_keys: supabaseKeys
    })
  };
};
