// netlify/functions/intake-attach.mjs
// ============================================================
// PCS United • Attach Intake → Email (ESM) — v1.0
// PURPOSE:
// - After user logs in, link the most recent pre-login intake row
//   (identified by intake_id) to the authenticated email.
// INPUT (POST JSON):
//   { "intake_id": "pcsint_...", "email": "user@email.com" }
// ============================================================

import { createClient } from "@supabase/supabase-js";

const SCHEMA_VERSION = "1.0";

function corsHeaders(event) {
  const origin = event?.headers?.origin || event?.headers?.Origin || "*";
  const reqHeaders =
    event?.headers?.["access-control-request-headers"] ||
    event?.headers?.["Access-Control-Request-Headers"] ||
    "Content-Type, Authorization";

  return {
    "Access-Control-Allow-Origin": origin === "null" ? "*" : origin,
    "Access-Control-Allow-Headers": reqHeaders,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
    "Content-Type": "application/json",
  };
}

function respond(event, statusCode, obj) {
  return { statusCode, headers: corsHeaders(event), body: JSON.stringify(obj) };
}

function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY; // service role
  if (!url || !key) throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_KEY.");
  return createClient(url, key, { auth: { persistSession: false } });
}

export async function handler(event) {
  try {
    if (event.httpMethod === "OPTIONS") {
      return { statusCode: 204, headers: corsHeaders(event), body: "" };
    }
    if (event.httpMethod !== "POST") {
      return respond(event, 405, { ok: false, schemaVersion: SCHEMA_VERSION, error: "Method not allowed." });
    }

    const body = JSON.parse(event.body || "{}");
    const intake_id = String(body.intake_id || "").trim();
    const email = String(body.email || "").trim().toLowerCase();

    if (!intake_id) return respond(event, 400, { ok: false, schemaVersion: SCHEMA_VERSION, error: "Missing intake_id." });
    if (!email) return respond(event, 400, { ok: false, schemaVersion: SCHEMA_VERSION, error: "Missing email." });

    const sb = getSupabase();

    // Update intake row by intake_id.
    // If multiple exist, we update all matches (safe + deterministic).
    const { data, error } = await sb
      .from("financial_intakes")
      .update({ email })
      .eq("intake_id", intake_id)
      .select("id,intake_id,email,mode,expenses,price,downpayment,credit_score,source");

    if (error) throw new Error(error.message || "Supabase update failed.");

    return respond(event, 200, {
      ok: true,
      schemaVersion: SCHEMA_VERSION,
      attached: data?.length || 0,
      intake_id,
      email,
      rows: data || [],
    });
  } catch (e) {
    return respond(event, 500, { ok: false, schemaVersion: SCHEMA_VERSION, error: String(e?.message || e) });
  }
}
