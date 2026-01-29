// netlify/functions/elena-router.js
// ============================================================
// PCSUnited • Elena Router (Function Entry) — v1.0.0
// PURPOSE:
// - Single Netlify Function entrypoint (stable URL)
// - Routes requests to modular skills in /netlify/functions/elena/skills/*
// - Fixes CORS + OPTIONS preflight correctly (your current error)
// ============================================================

/* ============================================================
   #1 — CORS (PCSUnited + local dev)
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

/* ============================================================
   #2 — Import Skills (modular brain)
   NOTE: these files live in:
   netlify/functions/elena/skills/pay.js
   netlify/functions/elena/skills/cities.js
   netlify/functions/elena/skills/brain.js
============================================================ */
import * as PaySkill from "./elena/skills/pay.js";
import * as CitiesSkill from "./elena/skills/cities.js";
import * as BrainSkill from "./elena/skills/brain.js";

/* ============================================================
   #3 — Skill registry (ordered: most deterministic first)
============================================================ */
const SKILLS = [
  BrainSkill,
  PaySkill,
  CitiesSkill,
];

/* ============================================================
   #4 — Minimal intent router (skill-driven)
============================================================ */
async function routeToSkill({ message, email, context }) {
  for (const skill of SKILLS) {
    const can = typeof skill?.canHandle === "function" ? await skill.canHandle({ message, email, context }) : false;
    if (can) {
      const out = typeof skill?.handle === "function"
        ? await skill.handle({ message, email, context })
        : null;

      if (out && typeof out === "object") {
        return {
          ok: true,
          skill: safeStr(skill?.SKILL_NAME || "skill"),
          ...out,
        };
      }
    }
  }

  // Fallback: deterministic, safe, short
  return {
    ok: true,
    skill: "fallback",
    reply:
      "I can help — tell me what lane this is in:\n" +
      "1) Pay / promotion pay\n" +
      "2) Base / city estimates\n" +
      "3) Your PCSUnited profile\n\n" +
      "If it’s pay-related, include: rank (now + next), YOS, and base or ZIP for BAH.",
  };
}

/* ============================================================
   #5 — Netlify Function handler
============================================================ */
export async function handler(event) {
  const origin = event.headers?.origin || "";
  const headers = corsHeaders(origin);

  // ✅ THIS is what fixes your preflight error
  if (event.httpMethod === "OPTIONS") {
    return respond(204, headers, {});
  }

  if (event.httpMethod !== "POST") {
    return respond(405, headers, { error: "Method Not Allowed" });
  }

  let payload = {};
  try {
    payload = JSON.parse(event.body || "{}");
  } catch (_) {
    return respond(400, headers, { error: "Invalid JSON body" });
  }

  const message = safeStr(payload.message);
  if (!message) return respond(400, headers, { error: "Missing message" });

  const email = safeStr(payload.email || payload?.context?.email || payload?.identity?.email || "");
  const context = (payload?.context && typeof payload.context === "object") ? payload.context : {};

  try {
    const result = await routeToSkill({ message, email, context });
    return respond(200, headers, result);
  } catch (err) {
    return respond(500, headers, {
      error: "Router exception",
      detail: String(err),
    });
  }
}
