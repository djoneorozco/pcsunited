// netlify/functions/elena-router.js
// ============================================================
// PCSUnited • Elena Function Entry (CommonJS) — v1.0.1
// PURPOSE:
// - Single stable Netlify Function endpoint for Webflow
// - Handles CORS + OPTIONS correctly
// - Accepts JSON body (and text/plain fallback)
// - Delegates routing to: netlify/functions/elena/router.js
// ============================================================

"use strict";

const { route } = require("./elena/router.js");

/* ============================================================
   //#1 — CORS
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
    "Vary": "Origin",
    "Content-Type": "application/json; charset=utf-8",
  };
}

function respond(statusCode, headers, payload) {
  return {
    statusCode,
    headers,
    body: JSON.stringify(payload ?? {}),
  };
}

function safeStr(x) {
  const s = String(x ?? "").trim();
  return s || "";
}

function safeJSONParse(raw) {
  try { return JSON.parse(raw || "{}"); } catch (_) { return null; }
}

/* ============================================================
   //#2 — Handler
============================================================ */
exports.handler = async (event) => {
  const origin = event.headers?.origin || "";
  const headers = corsHeaders(origin);

  // Preflight
  if (event.httpMethod === "OPTIONS") {
    return respond(204, headers, {});
  }

  if (event.httpMethod !== "POST") {
    return respond(405, headers, { ok:false, error: "Method Not Allowed" });
  }

  // Parse body (supports application/json AND text/plain JSON string)
  const bodyObj = safeJSONParse(event.body);
  if (!bodyObj) {
    return respond(400, headers, { ok:false, error: "Invalid JSON body" });
  }

  const message = safeStr(bodyObj.message);
  if (!message) return respond(400, headers, { ok:false, error: "Missing message" });

  // Identity-first email (same logic as your HUD)
  const email =
    safeStr(bodyObj?.email) ||
    safeStr(bodyObj?.context?.identity?.email) ||
    safeStr(bodyObj?.context?.email) ||
    safeStr(bodyObj?.identity?.email) ||
    "";

  const context = (bodyObj?.context && typeof bodyObj.context === "object") ? bodyObj.context : {};
  context.email = context.email || email || undefined;

  try {
    // Delegate to CommonJS router
    const out = await route(message, context, {});

    // Standardize response shape for the HUD
    return respond(200, headers, {
      ok: true,
      reply: safeStr(out?.reply) || "I’m here — what should we tackle?",
      intent: safeStr(out?.intent) || "ok",
      data: out?.data || undefined,
      debug: out?.debug || undefined,
    });
  } catch (err) {
    return respond(500, headers, {
      ok: false,
      error: "Elena router exception",
      detail: String(err),
    });
  }
};
