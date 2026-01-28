// netlify/functions/elena/skills/brain.js
// ============================================================
// PCSUnited • Elena Skill: BRAIN — profile-aware greeting + deterministic snapshot
// Version: v1.0.0
//
// PURPOSE:
//  - Make Elena "know the user" (rank/name/base) for greetings and context.
//  - Delegate numeric truth to your existing /api/brain (NO duplicated math).
//  - Provide a clean, reusable "brain snapshot" payload for other skills.
//
// HOW USER DATA RECALL WORKS (IMPORTANT):
//  - Best practice: router.js fetches Supabase profile once, then passes ctx.profile
//  - This skill ALSO supports a fallback Supabase lookup if ctx.profile is missing,
//    using SUPABASE_URL + SUPABASE_SERVICE_KEY and the email in payload/ctx.
//
// SKILL CONTRACT:
// module.exports = { id, priority, match, handle }
//
// ctx recommended shape:
// {
//   apiBase: "https://pcsunited.netlify.app" OR "" (optional; used for HTTP brain fallback),
//   email: "user@duke.edu" (optional),
//   profile: {...} (optional, preferred),
//   cityKey: "SanAntonio" (optional),
//   bedrooms: 4 (optional),
//   source: "webflow" (optional)
// }
//
// ============================================================

"use strict";

const path = require("path");
const fs = require("fs");

let createClient = null;
try {
  ({ createClient } = require("@supabase/supabase-js"));
} catch (_) {
  // supabase-js not installed or not bundled — router should pass ctx.profile instead
}

/* ============================================================
   //#1 — Skill identity
============================================================ */
const SKILL_ID = "brain";
const PRIORITY = 95; // very high — this is a core "personalization + snapshot" skill

/* ============================================================
   //#2 — Helpers
============================================================ */
function safeStr(x) {
  const s = String(x ?? "").trim();
  return s || "";
}

function normalizeEmail(x) {
  return safeStr(x).toLowerCase();
}

function toInt(x) {
  const n = Number.parseInt(String(x), 10);
  return Number.isFinite(n) ? n : null;
}

function normalizePaygrade(x) {
  const raw = safeStr(x).toUpperCase().replace(/\s+/g, "");
  if (!raw) return "";
  if (/^[EOW]-\d{1,2}$/.test(raw)) return raw;
  if (/^[EOW]\d{1,2}$/.test(raw)) return raw[0] + "-" + raw.slice(1);
  return raw;
}

function rankShort(paygradeOrRank) {
  const p = normalizePaygrade(paygradeOrRank);
  const map = {
    "E-1": "AB",
    "E-2": "Amn",
    "E-3": "A1C",
    "E-4": "SrA",
    "E-5": "SSgt",
    "E-6": "TSgt",
    "E-7": "MSgt",
    "E-8": "SMSgt",
    "E-9": "CMSgt",
    "W-1": "WO1",
    "W-2": "CWO2",
    "W-3": "CWO3",
    "W-4": "CWO4",
    "W-5": "CWO5",
    "O-1": "2nd Lt",
    "O-2": "1st Lt",
    "O-3": "Capt",
    "O-4": "Maj",
    "O-5": "Lt Col",
    "O-6": "Col",
    "O-7": "Brig Gen",
    "O-8": "Maj Gen",
    "O-9": "Lt Gen",
    "O-10": "Gen",
  };
  return map[p] || p || "";
}

function firstNameOf(fullName, firstNameField) {
  const fn = safeStr(firstNameField);
  if (fn) return fn;

  const name = safeStr(fullName);
  if (!name) return "";
  const parts = name.split(/\s+/).filter(Boolean);
  return parts.length ? parts[0] : "";
}

function lastNameOf(fullName, lastNameField) {
  const ln = safeStr(lastNameField);
  if (ln) return ln;

  const name = safeStr(fullName);
  if (!name) return "";
  const parts = name.split(/\s+/).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : "";
}

function looksLikeGreeting(text) {
  const t = safeStr(text).toLowerCase();
  return (
    t === "hi" ||
    t === "hey" ||
    t === "hello" ||
    t.startsWith("hi ") ||
    t.startsWith("hey ") ||
    t.startsWith("hello ")
  );
}

function needsBrainSnapshot(text) {
  const t = safeStr(text).toLowerCase();
  return (
    t.includes("run my numbers") ||
    t.includes("my snapshot") ||
    t.includes("my profile") ||
    t.includes("what do you know about me") ||
    t.includes("summarize me") ||
    t.includes("my grade") ||
    t.includes("can i afford") ||
    t.includes("afford") ||
    t.includes("housing cap") ||
    t.includes("budget") ||
    t.includes("bluf")
  );
}

/* ============================================================
   //#3 — Skill match
============================================================ */
function match(text, ctx) {
  const t = safeStr(text);
  if (!t) return false;

  // If the user is greeting, this skill can respond with profile-aware welcome
  if (looksLikeGreeting(t)) return true;

  // If user asks for summary / snapshot / affordability, brain skill is best
  if (needsBrainSnapshot(t)) return true;

  // Also: if router wants a default greeting on load, it can call this skill directly.
  // If ctx has a flag like ctx.forceGreeting, honor it.
  if (ctx?.forceGreeting) return true;

  return false;
}

/* ============================================================
   //#4 — Supabase (optional fallback)
   Best practice: router.js passes ctx.profile already.
============================================================ */
const SELECT_COLS_CANONICAL = [
  "id",
  "created_at",
  "email",
  "first_name",
  "last_name",
  "full_name",
  "phone",
  "mode",
  "rank",
  "rank_paygrade",
  "va_disability",
  "yos",
  "family",
  "base",
  "monthly_expenses",
  "projected_home_price",
  "downpayment",
  "credit_score",
  "time_to_buy",
  "bedrooms",
  "bathrooms",
  "sqft",
  "property_type",
  "amenities",
  "home_condition",
  "notes",
].join(",");

async function fetchProfileFromSupabase(email) {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

  if (!createClient) return { ok: false, reason: "supabase-js not available in bundle" };
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) return { ok: false, reason: "Supabase env missing" };
  const e = normalizeEmail(email);
  if (!e) return { ok: false, reason: "Missing email" };

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data, error } = await supabase
      .from("profiles")
      .select(SELECT_COLS_CANONICAL)
      .eq("email", e)
      .maybeSingle();

    if (error) return { ok: false, reason: error.message || "Supabase error" };
    if (!data) return { ok: false, reason: "Profile not found" };

    return { ok: true, profile: data };
  } catch (err) {
    return { ok: false, reason: String(err) };
  }
}

/* ============================================================
   //#5 — Delegate to /api/brain (NO duplicated math)
   Strategy:
   1) Try internal module call (fast + reliable)
   2) Fallback to HTTP fetch if module not found
============================================================ */
function tryLoadBrainEngine() {
  // This file: netlify/functions/elena/skills/brain.js
  // Brain function likely: netlify/functions/brain.js
  const candidates = [
    path.join(__dirname, "..", "..", "..", "brain.js"),
    path.join(process.cwd(), "netlify", "functions", "brain.js"),
  ];

  for (const fp of candidates) {
    try {
      if (fs.existsSync(fp)) {
        const mod = require(fp);
        return { ok: true, mod, fp };
      }
    } catch (_) {}
  }
  return { ok: false, mod: null, fp: null };
}

async function callBrainEngine({ apiBase, payload }) {
  // 1) Internal module call
  const engine = tryLoadBrainEngine();
  if (engine.ok && engine.mod && typeof engine.mod.handler === "function") {
    try {
      const fakeEvent = {
        httpMethod: "POST",
        headers: { origin: "internal://elena" },
        body: JSON.stringify(payload || {}),
      };
      const resp = await engine.mod.handler(fakeEvent);
      const body = safeStr(resp && resp.body);
      const json = body ? JSON.parse(body) : null;
      return { ok: true, mode: "module_handler", enginePath: engine.fp, data: json };
    } catch (err) {
      return { ok: false, mode: "module_handler", enginePath: engine.fp, error: String(err) };
    }
  }

  // 2) HTTP fallback
  const base = safeStr(apiBase);
  if (!base) {
    return { ok: false, mode: "http_fetch", error: "Missing ctx.apiBase for HTTP brain fallback" };
  }

  const url = base.replace(/\/$/, "") + "/api/brain";

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload || {}),
    });

    const json = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, mode: "http_fetch", error: json?.error || "Brain request failed", status: res.status };

    return { ok: true, mode: "http_fetch", enginePath: url, data: json };
  } catch (err) {
    return { ok: false, mode: "http_fetch", error: String(err), enginePath: url };
  }
}

/* ============================================================
   //#6 — Greeting builder
============================================================ */
function buildGreeting(profile, ctx) {
  const fullName = safeStr(profile?.full_name);
  const fn = firstNameOf(fullName, profile?.first_name);
  const ln = lastNameOf(fullName, profile?.last_name);

  const pg = normalizePaygrade(profile?.rank_paygrade || profile?.rank || "");
  const r = rankShort(pg) || safeStr(profile?.rank) || "—";

  // For PCSUnited, profile.base might represent current base OR destination base.
  // We’ll phrase it safely as “at <base>” unless ctx.ordersBase is provided.
  const currentBase = safeStr(profile?.base);
  const ordersBase = safeStr(ctx?.ordersBase || ctx?.destinationBase || "");

  const nameBit = ln ? `${r} ${ln}` : (fn ? `${r} ${fn}` : `${r}`);
  const baseBit = ordersBase
    ? `congratulations on your orders to ${ordersBase}`
    : (currentBase ? `I see you’re tied to ${currentBase}` : "");

  if (baseBit) {
    return `Hi ${nameBit} — ${baseBit}. How can I help you today?`;
  }
  return `Hi ${nameBit} — how can I help you today?`;
}

/* ============================================================
   //#7 — handle()
============================================================ */
async function handle(text, ctx) {
  const message = safeStr(text);

  // ------------------------------------------------------------
  // Step 1: Resolve identity + profile (prefer ctx.profile)
  // ------------------------------------------------------------
  let profile = (ctx && ctx.profile && typeof ctx.profile === "object") ? ctx.profile : null;

  // Try to infer email from ctx/payload shape
  const email =
    normalizeEmail(ctx?.email) ||
    normalizeEmail(ctx?.identity?.email) ||
    normalizeEmail(ctx?.profile?.email) ||
    "";

  let usedSupabaseFallback = false;
  let supabaseReason = null;

  if (!profile && email) {
    const sp = await fetchProfileFromSupabase(email);
    if (sp.ok) {
      profile = sp.profile;
      usedSupabaseFallback = true;
    } else {
      supabaseReason = sp.reason || "unknown";
    }
  }

  // If still no profile, be honest + ask for what you need
  if (!profile) {
    // If user is just greeting, respond friendly but request email/profile sync
    if (looksLikeGreeting(message) || ctx?.forceGreeting) {
      return {
        intent: "brain_greeting_no_profile",
        reply:
          "Hey — I’m Elena. If you want me to recognize you and use your rank/base automatically, I need your profile synced (email) so I can pull it from Supabase.",
        data: { need: ["email (to load profile)"] },
        debug: { skill: SKILL_ID, usedSupabaseFallback, supabaseReason },
      };
    }

    return {
      intent: "brain_no_profile",
      reply:
        "I can do that — I just need your email (or your profile loaded in the shell) so I can pull rank/YOS/base from Supabase and run a real snapshot.",
      data: { need: ["email (to load profile)"] },
      debug: { skill: SKILL_ID, usedSupabaseFallback, supabaseReason },
    };
  }

  // ------------------------------------------------------------
  // Step 2: Greeting (profile-aware)
  // ------------------------------------------------------------
  const shouldJustGreet = looksLikeGreeting(message) || ctx?.forceGreeting;
  if (shouldJustGreet && !needsBrainSnapshot(message)) {
    return {
      intent: "brain_greeting",
      reply: buildGreeting(profile, ctx),
      data: { profile: { email: normalizeEmail(profile.email || email) || null } },
      debug: { skill: SKILL_ID, usedSupabaseFallback },
    };
  }

  // ------------------------------------------------------------
  // Step 3: Call /api/brain for deterministic snapshot (delegate)
  // ------------------------------------------------------------
  const apiBase = safeStr(ctx?.apiBase || "");

  // Choose inputs to send to brain
  // NOTE: brain.js in your ecosystem often wants: { email, cityKey, bedrooms }
  const cityKey = safeStr(ctx?.cityKey || profile?.cityKey || "");
  const bedrooms =
    (ctx?.bedrooms != null ? Number(ctx.bedrooms) : (profile?.bedrooms != null ? Number(profile.bedrooms) : null));

  const brainPayload = {
    email: normalizeEmail(profile.email || email) || undefined,
    cityKey: cityKey || undefined,
    bedrooms: Number.isFinite(bedrooms) ? bedrooms : undefined,
    // Optional: pass a small profile hint (brain may ignore)
    profileHint: {
      rank: safeStr(profile.rank || ""),
      rank_paygrade: safeStr(profile.rank_paygrade || ""),
      yos: profile.yos ?? undefined,
      base: safeStr(profile.base || ""),
      family: profile.family ?? undefined,
      mode: safeStr(profile.mode || ""),
    },
    source: safeStr(ctx?.source || "elena-skill"),
  };

  const brain = await callBrainEngine({ apiBase, payload: brainPayload });

  // If brain fails, still give a useful response + greeting
  if (!brain.ok) {
    const greet = buildGreeting(profile, ctx);
    return {
      intent: "brain_engine_unavailable",
      reply:
        `${greet}\n\nI can see your profile, but I couldn’t reach the brain engine right now. If you tell me what you want (pay, BAH, affordability, mortgage), I’ll still walk you through it. ` +
        `(Debug: ${safeStr(brain.error || "unknown error")})`,
      data: { profile: { email: normalizeEmail(profile.email || email) || null } },
      debug: { skill: SKILL_ID, usedSupabaseFallback, brain: { mode: brain.mode, enginePath: brain.enginePath || null, error: brain.error || null } },
    };
  }

  const brainData = brain.data || {};

  // ------------------------------------------------------------
  // Step 4: Compose a BLUF-style reply (short + useful)
  // ------------------------------------------------------------
  const greet = buildGreeting(profile, ctx);

  // We avoid guessing fields; we read safely
  const incomeTotal =
    Number(brainData?.pay?.total ?? brainData?.totalPay ?? brainData?.income?.total ?? 0) || 0;

  const resolvedCity =
    safeStr(brainData?.city?.name || brainData?.city?.location || brainData?.cityKey || cityKey || "");

  const targetRent =
    Number(brainData?.city?.targets?.rent ?? brainData?.targets?.rent ?? 0) || 0;

  const targetHome =
    Number(brainData?.city?.targets?.home ?? brainData?.targets?.home_price ?? brainData?.targets?.homePrice ?? 0) || 0;

  const capAllIn = incomeTotal > 0 ? incomeTotal * 0.30 : 0;

  const lines = [];
  lines.push(greet);

  // If user asked for snapshot/affordability, add the quick deterministic rails
  if (needsBrainSnapshot(message)) {
    if (incomeTotal > 0) {
      lines.push("");
      lines.push(`BLUF: Your “safe” all-in housing cap is about ${capAllIn.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 })}/mo (30% of income).`);
    }
    if (resolvedCity) {
      lines.push(`Market context${resolvedCity ? ` (${resolvedCity})` : ""}:`);
      if (targetRent > 0) lines.push(`• Target rent: ${money(targetRent)}/mo`);
      if (targetHome > 0) lines.push(`• Target home price: ${money(targetHome)}`);
    }
    lines.push("");
    lines.push("Tell me your goal (rent vs buy, timeline, or a price you’re considering) and I’ll tighten this into a clear YES/NO path.");
  } else {
    // If user message wasn't explicitly "snapshot", keep it lighter
    lines.push("");
    lines.push("What are we solving — pay, affordability, mortgage estimate, or PCS planning?");
  }

  return {
    intent: "brain_snapshot",
    reply: lines.join("\n"),
    data: {
      profile: {
        email: normalizeEmail(profile.email || email) || null,
        full_name: safeStr(profile.full_name) || null,
        first_name: safeStr(profile.first_name) || null,
        last_name: safeStr(profile.last_name) || null,
        rank_paygrade: safeStr(profile.rank_paygrade) || null,
        rank: safeStr(profile.rank) || null,
        yos: (profile.yos == null) ? null : Number(profile.yos),
        base: safeStr(profile.base) || null,
        family: (profile.family == null) ? null : profile.family,
        mode: safeStr(profile.mode) || null,
      },
      brain: brainData,
      rails: {
        housing_cap_pct: 0.30,
        housing_cap_monthly: capAllIn,
      },
    },
    debug: {
      skill: SKILL_ID,
      usedSupabaseFallback,
      brain: {
        mode: brain.mode,
        enginePath: brain.enginePath || null,
      },
    },
  };
}

/* ============================================================
   //#8 — Export skill
============================================================ */
module.exports = {
  id: SKILL_ID,
  priority: PRIORITY,
  match,
  handle,
};
