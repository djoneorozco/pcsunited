// netlify/functions/elena-router.js
// ============================================================
// PCSUnited • Elena Router (Public Function Endpoint) — v1.1.0
// PURPOSE:
// - Single stable endpoint for Webflow HUD: /.netlify/functions/elena-router
// - Handles CORS + OPTIONS
// - Parses message/email/context
// - Routes to internal modular router: netlify/functions/elena/router.js
// ============================================================

"use strict";

const { createClient } = require("@supabase/supabase-js");
const ElenaRouter = require("./elena/router.js");

/* ============================================================
  //#1 CORS
============================================================ */
const ALLOW_ORIGINS = [
  "https://pcs-united.webflow.io",
  "https://www.pcs-united.webflow.io",
  "https://pcsunited.netlify.app",
  "https://www.pcsunited.netlify.app",
  "http://localhost:8888",
  "http://localhost:5173",
  "http://localhost:3000",
];

function corsHeaders(origin) {
  const o = String(origin || "").trim();
  const allow = ALLOW_ORIGINS.includes(o) ? o : "*";
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
    "Content-Type": "application/json; charset=utf-8",
  };
}

function respond(statusCode, headers, payload) {
  return { statusCode, headers, body: JSON.stringify(payload ?? {}) };
}

function safeStr(x) {
  const s = String(x ?? "").trim();
  return s || "";
}

/* ============================================================
  //#2 Supabase helper (Service Role)
============================================================ */
function getSupabaseAdmin() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return null;

  return createClient(url, key, {
    auth: { persistSession: false },
  });
}

/* ============================================================
  //#3 Main handler
============================================================ */
exports.handler = async (event) => {
  const origin = event.headers?.origin || event.headers?.Origin || "";
  const headers = corsHeaders(origin);

  // Preflight
  if (event.httpMethod === "OPTIONS") {
    return respond(204, headers, {});
  }

  if (event.httpMethod !== "POST") {
    return respond(405, headers, { ok: false, error: "Method Not Allowed" });
  }

  let payload = {};
  try {
    payload = JSON.parse(event.body || "{}");
  } catch (_) {
    return respond(400, headers, { ok: false, error: "Invalid JSON body" });
  }

  const message = safeStr(payload.message);
  if (!message) return respond(400, headers, { ok: false, error: "Missing message" });

  // email priority: payload.email -> context.identity.email -> context.profile.email
  const email =
    safeStr(payload.email) ||
    safeStr(payload?.context?.identity?.email) ||
    safeStr(payload?.context?.profile?.email) ||
    safeStr(payload?.context?.email) ||
    "";

  const context = (payload?.context && typeof payload.context === "object") ? payload.context : {};

  // Build helpers that skills can use (supabase, etc)
  const supabase = getSupabaseAdmin();

  const helpers = {
    supabase,
    env: {
      hasSupabase: !!supabase,
    },
  };

  try {
    const out = await ElenaRouter.route(message, { email, ...context }, helpers);

    // Router returns { reply, intent, data?, debug? }
    return respond(200, headers, {
      ok: true,
      reply: out.reply || "I’m here — what do you want to solve?",
      intent: out.intent || "unknown",
      data: out.data || undefined,
      // uncomment if you want debugging in prod:
      // debug: out.debug || undefined,
    });
  } catch (err) {
    return respond(500, headers, {
      ok: false,
      error: "Elena router exception",
      detail: String(err),
    });
  }
};
