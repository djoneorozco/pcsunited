// netlify/functions/elena-router.js
// ============================================================
// PCSUnited • Elena Router (Function Entry) — v1.1.0
// PURPOSE:
// - Single Netlify Function entrypoint (stable URL)
// - Routes requests to modular skills in /netlify/functions/elena/skills/*
// - FIX: Adds ProfileSkill to answer "what is my rank / yos / base" using Supabase
// - Fixes CORS + OPTIONS preflight correctly
// ============================================================

/* ============================================================
   //#1 — CORS (PCSUnited + local dev)
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
   //#2 — Import Skills (modular brain)
   NOTE: these files live in:
   netlify/functions/elena/skills/*.js
============================================================ */
import * as ProfileSkill from "./elena/skills/profile.js"; // ✅ NEW
import * as BrainSkill from "./elena/skills/brain.js";
import * as PaySkill from "./elena/skills/pay.js";
import * as CitiesSkill from "./elena/skills/cities.js";

/* ============================================================
   //#3 — Skill registry (ordered: most deterministic first)
============================================================ */
const SKILLS = [
  ProfileSkill, // ✅ NEW: rank/yos/base/profile answers
  BrainSkill,
  PaySkill,
  CitiesSkill,
];

/* ============================================================
   //#4 — Minimal intent router (skill-driven)
============================================================ */
async function routeToSkill({ message, email, context }) {
  for (const skill of SKILLS) {
    const can = typeof skill?.canHandle === "function"
      ? await skill.canHandle({ message, email, context })
      : false;

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
   //#5 — Netlify Function handler
============================================================ */
export async function handler(event) {
  const origin = event.headers?.origin || "";
  const headers = corsHeaders(origin);

  // Preflight
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

  // Email resolution priority:
  // - payload.email (HUD sends this)
  // - payload.context.identity.email
  // - payload.context.profile.email (hint)
  const email =
    safeStr(payload.email) ||
    safeStr(payload?.context?.identity?.email) ||
    safeStr(payload?.context?.profile?.email) ||
    "";

  const context = (payload?.context && typeof payload.context === "object") ? payload.context : {};

  try {
    const result = await routeToSkill({ message, email, context });
    return respond(200, headers, result);
  } catch (err) {
    return respond(500, headers, {
      ok: false,
      error: "Router exception",
      detail: String(err?.message || err),
    });
  }
}
