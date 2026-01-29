// netlify/functions/elena-router.js
// ============================================================
// PCSUnited • Elena Router (Function Entry) — v1.0.1
// FIX:
// - Use __dirname + path.join to require elena/router.js reliably
// - Supports both application/json AND text/plain bodies (no-preflight posts)
// - Clean CORS + OPTIONS
// ============================================================

"use strict";

const path = require("path");

// ✅ Unbreakable import (prevents “double elena” resolution problems)
let ROUTER = null;
function getRouter() {
  if (ROUTER) return ROUTER;

  const routerPath = path.join(__dirname, "elena", "router.js");
  // router.js must be CommonJS: module.exports = { route }
  ROUTER = require(routerPath);
  return ROUTER;
}

/* ============================================================
   #1 — CORS
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

function safeJSON(str) {
  try { return JSON.parse(str); } catch (_) { return null; }
}

/* ============================================================
   #2 — Body parsing (JSON OR text/plain)
============================================================ */
function parseBody(event) {
  const raw = event.body || "";
  // If Webflow HUD used text/plain to avoid preflight, we still parse JSON inside
  const asJson = safeJSON(raw);
  if (asJson && typeof asJson === "object") return asJson;
  return {};
}

/* ============================================================
   #3 — Handler
============================================================ */
exports.handler = async function handler(event) {
  const origin = event.headers?.origin || "";
  const headers = corsHeaders(origin);

  if (event.httpMethod === "OPTIONS") {
    return respond(204, headers, {});
  }
  if (event.httpMethod !== "POST") {
    return respond(405, headers, { ok: false, error: "Method Not Allowed" });
  }

  const payload = parseBody(event);

  const message = safeStr(payload.message);
  if (!message) return respond(400, headers, { ok: false, error: "Missing message" });

  const email =
    safeStr(payload.email) ||
    safeStr(payload?.context?.identity?.email) ||
    safeStr(payload?.context?.email) ||
    "";

  const context = (payload?.context && typeof payload.context === "object") ? payload.context : {};

  try {
    const { route } = getRouter();
    if (typeof route !== "function") {
      return respond(500, headers, { ok: false, error: "Router missing route() export" });
    }

    const out = await route(message, { email, ...context });

    // Normalize output
    const reply = safeStr(out?.reply) || "I’m here. What would you like to explore?";
    return respond(200, headers, {
      ok: true,
      reply,
      intent: out?.intent || "ok",
      data: out?.data || undefined,
      debug: out?.debug || undefined,
    });

  } catch (err) {
    return respond(500, headers, {
      ok: false,
      error: "Router exception",
      detail: String(err),
    });
  }
};
