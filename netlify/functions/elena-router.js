// netlify/functions/elena-router.js
"use strict";

const { route } = require("./elena/router.js");

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

function safeJSON(s) {
  try { return JSON.parse(s || "{}"); } catch (_) { return null; }
}

exports.handler = async (event) => {
  const origin = event.headers?.origin || "";
  const headers = corsHeaders(origin);

  if (event.httpMethod === "OPTIONS") return respond(204, headers, {});
  if (event.httpMethod !== "POST") return respond(405, headers, { ok:false, error: "Method Not Allowed" });

  // Accept both application/json and text/plain (your “no-preflight” client)
  const bodyObj = safeJSON(event.body) || {};
  const message = String(bodyObj.message || "").trim();
  if (!message) return respond(400, headers, { ok:false, error: "Missing message" });

  const email =
    String(bodyObj.email || bodyObj?.context?.identity?.email || bodyObj?.context?.email || "").trim().toLowerCase();

  const ctx = (bodyObj.context && typeof bodyObj.context === "object") ? bodyObj.context : {};
  ctx.email = ctx.email || email || undefined;

  try {
    const out = await route(message, ctx, {});
    return respond(200, headers, {
      ok: true,
      reply: out?.reply || "I’m here — what do you want to solve?",
      intent: out?.intent,
      data: out?.data,
      debug: out?.debug,
    });
  } catch (err) {
    return respond(500, headers, { ok:false, error: "Router exception", detail: String(err) });
  }
};
