// netlify/functions/elena/skills/pay.js
// ============================================================
// PCSUnited • Elena Skill: PAY — "Thin wrapper" (NO duplicate math)
// Version: v1.0.0
//
// WHAT THIS DOES:
//  - Detects pay-related questions (including “next year”, “promote”, “put on Tech”, etc.)
//  - Pulls rank/YOS/base/zip/family from ctx.profile when available
//  - Extracts missing inputs from user text when possible
//  - Delegates ALL pay computation to ONE source of truth:
//      ✅ netlify/functions/pay-tables.js  (preferred: internal module call)
//      ↩︎ fallback: compute directly from militaryPayTables.json ONLY if pay-tables cannot be loaded
//
// NOTE:
//  - This file intentionally avoids duplicating pay logic.
//  - The fallback path is “last resort” to prevent a dead-end if module import fails.
//
// SKILL CONTRACT:
// module.exports = { id, priority, match, handle }
//
// ctx shape (recommended):
// {
//   profile: { rank_paygrade, rank, yos, base, family, ... },
//   resolvedZip: "78234" (optional),
//   knowledge: { packs: {...} } (optional)
// }
// ============================================================

"use strict";

const path = require("path");
const fs = require("fs");

/* ============================================================
   //#1 — Skill identity
============================================================ */
const SKILL_ID = "pay";
const PRIORITY = 90; // pay is common; keep it high but below "auth/login" if you add that later

/* ============================================================
   //#2 — Utilities
============================================================ */
function safeStr(x) {
  const s = String(x ?? "").trim();
  return s || "";
}

function lower(x) {
  return safeStr(x).toLowerCase();
}

function normalizeEmail(x) {
  return safeStr(x).toLowerCase();
}

function normalizePaygrade(x) {
  const raw = safeStr(x).toUpperCase().replace(/\s+/g, "");
  if (!raw) return "";
  if (/^[EOW]-\d{1,2}$/.test(raw)) return raw;
  if (/^[EOW]\d{1,2}$/.test(raw)) return raw[0] + "-" + raw.slice(1);
  return raw;
}

function parseIntSafe(x) {
  const n = Number.parseInt(String(x), 10);
  return Number.isFinite(n) ? n : null;
}

function money(n) {
  const x = Number(n) || 0;
  return x.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

/* ============================================================
   //#3 — Rank parsing (lightweight)
   - We keep this minimal: just enough to infer target rank from phrases.
============================================================ */
const RANK_ALIASES = [
  // Enlisted (common words)
  { rx: /\b(airman basic|ab)\b/i, pg: "E-1" },
  { rx: /\b(airman|amn)\b/i, pg: "E-2" },
  { rx: /\b(a1c|airman first class)\b/i, pg: "E-3" },
  { rx: /\b(sra|senior airman)\b/i, pg: "E-4" },
  { rx: /\b(ssgt|staff|staff sergeant)\b/i, pg: "E-5" },
  { rx: /\b(tsgt|tech|technical sergeant)\b/i, pg: "E-6" },
  { rx: /\b(msgt|master sergeant)\b/i, pg: "E-7" },
  { rx: /\b(smsgt|senior master sergeant)\b/i, pg: "E-8" },
  { rx: /\b(cmsgt|chief master sergeant|chief)\b/i, pg: "E-9" },

  // Officers (basic)
  { rx: /\b(2nd lt|second lieutenant|o-1)\b/i, pg: "O-1" },
  { rx: /\b(1st lt|first lieutenant|o-2)\b/i, pg: "O-2" },
  { rx: /\b(capt|captain|o-3)\b/i, pg: "O-3" },
  { rx: /\b(maj|major|o-4)\b/i, pg: "O-4" },
  { rx: /\b(lt col|lieutenant colonel|o-5)\b/i, pg: "O-5" },
  { rx: /\b(col|colonel|o-6)\b/i, pg: "O-6" },

  // Generic explicit paygrade forms (E-6, O3, W-2 etc)
];

function extractPaygradeFromText(text) {
  const t = safeStr(text);

  // Explicit "E-6", "O-3", "W-2"
  const m1 = t.match(/\b([EOW])\s*-\s*(\d{1,2})\b/i);
  if (m1) return normalizePaygrade(`${m1[1]}-${m1[2]}`);

  // Compact "E6", "O3", "W2"
  const m2 = t.match(/\b([EOW])\s*(\d{1,2})\b/i);
  if (m2) return normalizePaygrade(`${m2[1]}-${m2[2]}`);

  // Named ranks
  for (const a of RANK_ALIASES) {
    if (a.rx.test(t)) return a.pg;
  }

  return "";
}

function looksLikePromotion(text) {
  const t = lower(text);
  return (
    t.includes("next year") ||
    t.includes("promot") ||
    t.includes("put on") ||
    t.includes("sew on") ||
    t.includes("pin on") ||
    t.includes("testing") ||
    t.includes("waps") ||
    t.includes("cycle")
  );
}

function extractFutureOffsetYears(text) {
  const t = lower(text);
  if (t.includes("next year")) return 1;

  // "in 2 years", "in 3 yrs"
  const m = t.match(/\bin\s+(\d{1,2})\s*(year|years|yr|yrs)\b/);
  if (m) {
    const n = parseIntSafe(m[1]);
    return n && n > 0 ? n : 0;
  }

  return 0;
}

function extractYosFromText(text) {
  const t = lower(text);

  // "8 yos", "8 years of service"
  const m1 = t.match(/\b(\d{1,2})\s*(yos|years of service)\b/);
  if (m1) return parseIntSafe(m1[1]);

  // "i have 10 years"
  const m2 = t.match(/\b(i have|i've got|ive got|with)\s+(\d{1,2})\s*(years|yrs)\b/);
  if (m2) return parseIntSafe(m2[2]);

  return null;
}

function inferFamilyBool(profile) {
  // In your profiles, family might be count (1..n) or boolean-ish
  const f = profile?.family;
  if (typeof f === "boolean") return f;
  const n = Number(f);
  if (Number.isFinite(n)) return n >= 2; // if "family" means household count: >=2 implies dependents
  const s = lower(f);
  if (s === "true" || s === "yes" || s === "with") return true;
  if (s === "false" || s === "no" || s === "without") return false;
  return false;
}

function resolveZip(ctx) {
  // Priority: ctx.resolvedZip -> ctx.zip -> ctx.profile.zip -> ctx.profile.base_zip (if you add later)
  const z =
    safeStr(ctx?.resolvedZip) ||
    safeStr(ctx?.zip) ||
    safeStr(ctx?.profile?.zip) ||
    safeStr(ctx?.profile?.base_zip) ||
    "";
  return z;
}

/* ============================================================
   //#4 — Delegate to your pay engine (pay-tables.js)
   Preferred: internal module call to avoid HTTP / CORS complexity.
============================================================ */
function tryLoadPayEngine() {
  // Attempt multiple require paths safely.
  // This file is at: netlify/functions/elena/skills/pay.js
  // pay-tables.js is at: netlify/functions/pay-tables.js
  const candidates = [
    path.join(__dirname, "..", "..", "..", "pay-tables.js"), // netlify/functions/pay-tables.js
    path.join(process.cwd(), "netlify", "functions", "pay-tables.js"),
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

/* ============================================================
   //#5 — LAST RESORT fallback (read JSON directly)
   Only used if pay-tables.js module import fails.
============================================================ */
let __PAY_TABLES_CACHE__ = null;

function loadPayTablesFallback() {
  if (__PAY_TABLES_CACHE__ !== null) return __PAY_TABLES_CACHE__;

  const p = path.join(process.cwd(), "netlify", "functions", "data", "militaryPayTables.json");
  try {
    if (!fs.existsSync(p)) {
      __PAY_TABLES_CACHE__ = null;
      return null;
    }
    const raw = fs.readFileSync(p, "utf8");
    __PAY_TABLES_CACHE__ = JSON.parse(raw);
    return __PAY_TABLES_CACHE__;
  } catch (_) {
    __PAY_TABLES_CACHE__ = null;
    return null;
  }
}

function pickYosValue(tableForRank, yos) {
  if (!tableForRank || typeof tableForRank !== "object") return 0;

  const y = Number(yos);
  if (!Number.isFinite(y)) return 0;

  const direct = tableForRank[String(y)];
  if (direct != null) return Number(direct) || 0;

  const keys = Object.keys(tableForRank)
    .map((k) => Number(k))
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => a - b);

  if (!keys.length) return 0;

  let best = keys[0];
  for (const k of keys) {
    if (k <= y) best = k;
    else break;
  }
  return Number(tableForRank[String(best)]) || 0;
}

function fallbackComputePay({ paygrade, yos }) {
  const tables = loadPayTablesFallback();
  if (!tables) return { ok: false, reason: "militaryPayTables.json not found for fallback." };

  const pg = normalizePaygrade(paygrade);
  const y = Number(yos);

  if (!pg || !Number.isFinite(y)) return { ok: false, reason: "Missing rank/paygrade or YOS." };

  const basePay = pickYosValue(tables?.BASEPAY?.[pg], y);

  const isOfficer = pg.startsWith("O-") || pg.startsWith("W-");
  const bas = Number(isOfficer ? tables?.BAS?.officer : tables?.BAS?.enlisted) || 0;

  // NOTE: fallback does NOT compute BAH. That belongs to pay-tables.js.
  return { ok: true, basePay, bas, bah: 0, total: basePay + bas };
}

/* ============================================================
   //#6 — match() : detect pay questions
============================================================ */
function match(text /*, ctx */) {
  const t = lower(text);
  if (!t) return false;

  // Strong signals
  if (
    t.includes("base pay") ||
    t.includes("bah") ||
    t.includes("bas") ||
    t.includes("monthly pay") ||
    t.includes("total pay") ||
    t.includes("how much do i make") ||
    t.includes("salary") ||
    (t.includes("pay") && (t.includes("my") || t.includes("mine") || t.includes("month") || t.includes("check")))
  ) return true;

  // Promotion phrases often imply pay question
  if (looksLikePromotion(t) && (t.includes("how much") || t.includes("pay") || t.includes("base"))) return true;

  // “I’m a staff now, next year tech…”
  if (looksLikePromotion(t) && (t.includes("staff") || t.includes("tech") || t.includes("tsgt") || t.includes("ssgt"))) return true;

  return false;
}

/* ============================================================
   //#7 — handle() : parse -> delegate -> format reply
============================================================ */
async function handle(text, ctx /*, helpers */) {
  const message = safeStr(text);
  const profile = (ctx && typeof ctx === "object" && ctx.profile && typeof ctx.profile === "object") ? ctx.profile : {};

  // --- Inputs from profile first ---
  const profPg = normalizePaygrade(profile.rank_paygrade || profile.rank || "");
  const profYos = (profile.yos === null || profile.yos === undefined) ? null : Number(profile.yos);
  const baseName = safeStr(profile.base || "");
  const familyBool = inferFamilyBool(profile);

  // --- Extract from message ---
  const msgPg = extractPaygradeFromText(message); // could be target or current
  const msgYos = extractYosFromText(message);
  const futureYears = extractFutureOffsetYears(message);

  // If message includes a paygrade and is a promotion context, treat it as target.
  // If message has no paygrade, use profile paygrade.
  let targetPaygrade = msgPg || profPg;

  // YOS: prefer explicit in message, else profile, then adjust if “next year/in X years”
  let targetYos = (msgYos !== null) ? msgYos : (Number.isFinite(profYos) ? profYos : null);
  if (targetYos !== null && futureYears > 0) targetYos = targetYos + futureYears;

  // ZIP: prefer ctx.resolvedZip/ctx.zip; fallback to empty (pay-tables can still compute base pay & maybe BAH if it derives zip elsewhere)
  const zip = resolveZip(ctx);

  // If we’re missing essentials, ask for them cleanly.
  if (!targetPaygrade || targetPaygrade.length < 2) {
    return {
      intent: "pay_missing_rank",
      reply:
        "Tell me your paygrade (like E-5 / E-6) and your Years of Service (YOS), and I’ll give you Base Pay + BAS + BAH (if we have a base or ZIP).",
      data: { need: ["rank_paygrade", "yos"] },
      debug: { skill: SKILL_ID, reason: "missing_paygrade", got: { profPg, msgPg } },
    };
  }

  if (targetYos === null || !Number.isFinite(Number(targetYos))) {
    return {
      intent: "pay_missing_yos",
      reply:
        `I can calculate pay for ${targetPaygrade}, I just need your Years of Service (YOS). What YOS are you now? (Example: 8)`,
      data: { need: ["yos"], rank_paygrade: targetPaygrade },
      debug: { skill: SKILL_ID, reason: "missing_yos", got: { profYos, msgYos } },
    };
  }

  // ------------------------------------------------------------
  // Delegate to pay-tables.js (source of truth)
  // ------------------------------------------------------------
  const engine = tryLoadPayEngine();
  let result = null;
  let engineMode = "none";

  if (engine.ok && engine.mod) {
    // pay-tables.js likely exports handler(event) for Netlify.
    // We can call it internally by faking an event.
    // If you later refactor pay-tables.js to export computePay(), this still works.
    try {
      if (typeof engine.mod.computePay === "function") {
        engineMode = "module_computePay";
        result = await engine.mod.computePay({
          rank: targetPaygrade,
          yos: Number(targetYos),
          zip: zip || "",
          family: !!familyBool,
          base: baseName || "",
        });
      } else if (typeof engine.mod.handler === "function") {
        engineMode = "netlify_handler";
        const fakeEvent = {
          httpMethod: "POST",
          headers: { origin: "internal://elena" },
          body: JSON.stringify({
            rank: targetPaygrade,
            yos: Number(targetYos),
            zip: zip || "",
            family: !!familyBool,
          }),
        };
        const resp = await engine.mod.handler(fakeEvent);
        const body = safeStr(resp && resp.body);
        result = body ? JSON.parse(body) : null;
      }
    } catch (err) {
      result = { ok: false, error: String(err) };
    }
  }

  // If pay-tables engine isn’t available, do minimal fallback
  if (!result || result.ok === false) {
    engineMode = engineMode !== "none" ? engineMode : "fallback_json";
    const fb = fallbackComputePay({ paygrade: targetPaygrade, yos: Number(targetYos) });

    if (!fb.ok) {
      return {
        intent: "pay_error",
        reply:
          "I couldn’t access the pay engine right now. If you want, paste your pay-tables.js export shape (handler/computePay) and I’ll wire this to it cleanly.",
        data: { error: fb.reason || "unknown" },
        debug: { skill: SKILL_ID, engineMode, enginePath: engine.fp || null, rawResult: result || null },
      };
    }

    // Minimal answer without BAH (by design)
    const lines = [];
    lines.push(`Pay estimate for ${targetPaygrade} @ ${Number(targetYos)} YOS:`);
    lines.push(`• Base Pay: ${money(fb.basePay)}`);
    lines.push(`• BAS: ${money(fb.bas)}`);
    lines.push(`• BAH: — (requires pay-tables engine or ZIP/base mapping)`);
    lines.push(`= Estimated Total (Base+BAS only): ${money(fb.total)} / month`);

    return {
      intent: "pay_fallback_base_only",
      reply: lines.join("\n"),
      data: { rank_paygrade: targetPaygrade, yos: Number(targetYos), basePay: fb.basePay, bas: fb.bas, bah: 0, total: fb.total },
      debug: { skill: SKILL_ID, engineMode, enginePath: engine.fp || null, note: "Fallback used; no BAH computed here." },
    };
  }

  // Normalize expected fields from pay-tables.js
  const ok = !!result.ok || (result.basePay != null); // tolerate slight schema differences
  if (!ok) {
    return {
      intent: "pay_error",
      reply:
        "I reached the pay engine, but it didn’t return a usable response. If you paste the pay-tables.js response payload shape, I’ll align this skill to it exactly.",
      data: { raw: result || null },
      debug: { skill: SKILL_ID, engineMode, enginePath: engine.fp || null },
    };
  }

  const outBasePay = Number(result.basePay) || 0;
  const outBah = Number(result.bah) || 0;
  const outBas = Number(result.bas) || 0; // if your pay-tables.js includes BAS
  const outTotal = Number(result.total) || (outBasePay + outBah + outBas);

  // Determine what was used for rank/yos/zip
  const usedRank = normalizePaygrade(result.rank || result.rank_paygrade || targetPaygrade);
  const usedYos = Number(result.yos ?? targetYos);
  const usedZip = safeStr(result.zip || result.resolvedZip || zip || "");

  // Reply formatting
  const lines = [];
  const promoNote = looksLikePromotion(message) && futureYears > 0
    ? ` (assumed +${futureYears} year${futureYears === 1 ? "" : "s"} of service)`
    : "";

  lines.push(`Monthly pay snapshot for ${usedRank} @ ${usedYos} YOS${promoNote}:`);
  lines.push(`• Base Pay: ${money(outBasePay)}`);

  // BAS: show only if present (some engines may not return it)
  if (outBas > 0) lines.push(`• BAS: ${money(outBas)}`);
  else lines.push(`• BAS: — (not returned by pay engine)`);

  // BAH
  if (outBah > 0) {
    lines.push(`• BAH: ${money(outBah)}${usedZip ? ` (ZIP ${usedZip})` : ""}`);
  } else {
    const note = safeStr(result.note || result.bahNote || "");
    lines.push(`• BAH: —${note ? ` (${note})` : usedZip ? ` (ZIP ${usedZip} not found for this rank)` : " (needs base/ZIP)"}`);
  }

  lines.push(`= Estimated Total: ${money(outTotal)} / month`);

  return {
    intent: "pay_answer",
    reply: lines.join("\n"),
    data: {
      rank_paygrade: usedRank,
      yos: usedYos,
      zip: usedZip || null,
      base: baseName || null,
      family: !!familyBool,
      basePay: outBasePay,
      bas: outBas,
      bah: outBah,
      total: outTotal,
      assumptions: {
        futureYearsOffset: futureYears || 0,
        usedProfileDefaults: {
          paygrade: !msgPg && !!profPg,
          yos: msgYos === null && Number.isFinite(profYos),
        },
      },
    },
    debug: {
      skill: SKILL_ID,
      engineMode,
      enginePath: engine.fp || null,
      source: "pay-tables.js (delegated)",
      schemaSeen: Object.keys(result || {}).slice(0, 30),
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
