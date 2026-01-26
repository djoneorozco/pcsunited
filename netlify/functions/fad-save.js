// netlify/functions/fad-save.js
// ============================================================
// PCS United • FAD Snapshot Save (v1.0.0)
// PURPOSE:
// - Persist the user's *latest* Financial Analysis Dashboard state to Supabase
// - Supports hybrid triggers: autosave / blur / unload / manual Save button
// - Upserts ONE row per email (latest snapshot), so retrieval is simple + fast
//
// BODY (POST JSON):
// {
//   "email": "user@email.com",
//   "mode": "autosave" | "manual" | "blur" | "unload",
//   "source": "pcsunited.fad.autosave.v1",
//   "payload": { ...anything... },
//   "kpis": {
//     "income": 0,
//     "expenses": 0,
//     "housing": 0,
//     "savings": 0,
//     "creditScore": 700,
//     "verdict": "GREEN" | "CAUTION" | "NO-GO",
//     "cityKey": "SanAntonio"
//   }
// }
//
// RETURNS:
// { ok:true, saved:{ email, updated_at }, id }
//
// ENV REQUIRED:
//   SUPABASE_URL
//   SUPABASE_SERVICE_KEY
// ============================================================

import { createClient } from "@supabase/supabase-js";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
  "Content-Type": "application/json",
  "Vary": "Origin",
};

function respond(statusCode, payload) {
  return { statusCode, headers: CORS_HEADERS, body: JSON.stringify(payload || {}) };
}

function s(v) {
  const out = String(v ?? "").trim();
  return out ? out : "";
}

function n(v) {
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
}

function isEmail(x) {
  const v = String(x || "").trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

export const handler = async (event) => {
  // ============================================================
  // //#0 CORS + METHOD
  // ============================================================
  if (event.httpMethod === "OPTIONS") return respond(200, { ok: true });
  if (event.httpMethod !== "POST") return respond(405, { ok: false, error: "Method not allowed" });

  // ============================================================
  // //#1 INPUT
  // ============================================================
  let body = {};
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return respond(400, { ok: false, error: "Invalid JSON body" });
  }

  const email = s(body.email).toLowerCase();
  if (!email || !isEmail(email)) return respond(400, { ok: false, error: "Valid email is required" });

  const mode = s(body.mode).toLowerCase() || "autosave";
  const source = s(body.source) || "pcsunited.fad.autosave.v1";

  const payload = (body.payload && typeof body.payload === "object") ? body.payload : {};
  const kpis = (body.kpis && typeof body.kpis === "object") ? body.kpis : {};

  // ============================================================
  // //#2 ENV + CLIENT
  // ============================================================
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return respond(500, { ok: false, error: "Supabase env not configured" });
  }

  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // ============================================================
  // //#3 UPSERT LATEST SNAPSHOT
  // ============================================================
  try {
    const row = {
      email,
      source,
      mode,
      payload,
      k_income: n(kpis.income),
      k_expenses: n(kpis.expenses),
      k_housing: n(kpis.housing),
      k_savings: n(kpis.savings),
      credit_score: (kpis.creditScore == null ? null : Math.round(Number(kpis.creditScore))) || null,
      verdict: s(kpis.verdict) || null,
      city_key: s(kpis.cityKey) || null,
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await sb
      .from("fad_snapshots")
      .upsert(row, { onConflict: "email" })
      .select("id,email,updated_at")
      .single();

    if (error) {
      console.error("fad-save upsert error:", error);
      return respond(500, { ok: false, error: error.message || "Upsert failed" });
    }

    return respond(200, {
      ok: true,
      id: data?.id || null,
      saved: {
        email: data?.email || email,
        updated_at: data?.updated_at || row.updated_at,
        mode,
        source,
      },
    });
  } catch (e) {
    console.error("fad-save fatal:", e);
    return respond(500, { ok: false, error: "Server error" });
  }
};
