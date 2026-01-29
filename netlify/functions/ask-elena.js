// netlify/functions/ask-elena.js
// v2.4.2 — PCSUnited Elena (Profile-aware + deterministic pay basics + affordability + base/city context)
//
// GOAL (unchanged + added):
// - Elena can answer questions about the user's profile + pay (Base Pay + BAS, and BAH if ZIP/base is available)
// - Adds deterministic “How much house can I afford?” quick answer
// - ✅ NEW: Base/City context from netlify/functions/cities/index.byBase.json (+ per-base file load)
//
// REQUIRED ENV:
//   SUPABASE_URL
//   SUPABASE_SERVICE_KEY
// OPTIONAL ENV:
//   OPENAI_API_KEY   (only for non-deterministic questions)
//
// CLIENT SHOULD CALL (recommended):
//   POST https://pcsunited.netlify.app/api/ask-elena
//   body: { message, email, zip?, context?: { profile?: {...}, base?: "..."} }

const { createClient } = require("@supabase/supabase-js");
const fs = require("fs");
const path = require("path");

/* ============================================================
   //#1 — CORS (PCSUnited)
============================================================ */
const ALLOW_ORIGINS = [
  "https://pcsunited.com",
  "https://www.pcsunited.com",
  "https://pcsunited.netlify.app",

  "https://pcsunited.webflow.io",
  "https://www.pcsunited.webflow.io",

  "http://localhost:8888",
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
    "Content-Type": "application/json",
  };
}

function respond(statusCode, headers, payload) {
  return { statusCode, headers, body: JSON.stringify(payload || {}) };
}

/* ============================================================
   //#2 — Supabase profile fields (minimal; compatible)
============================================================ */
const SELECT_COLS = [
  "id",
  "created_at",
  "profiles_user_id_unique",
  "email",
  "full_name",
  "last_name",
  "phone",
  "mode",
  "rank",
  "rank_paygrade",
  "va_disability",
  "yos",
  "family",
  "base",
  "notes",
].join(",");

/* ============================================================
   //#3 — Utility helpers
============================================================ */
function safeStr(x) {
  const s = String(x ?? "").trim();
  return s || "";
}

function normalizeEmail(x) {
  return safeStr(x).toLowerCase();
}

function lastNameOf(fullName, lastNameField) {
  const ln = safeStr(lastNameField);
  if (ln) return ln;

  const name = safeStr(fullName);
  if (!name) return "";
  const parts = name.split(/\s+/).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : "";
}

function getEmailFromPayload(payload) {
  const direct = normalizeEmail(payload?.email);
  if (direct) return direct;

  const ctxEmail = normalizeEmail(payload?.context?.email);
  if (ctxEmail) return ctxEmail;

  const ctxProfEmail = normalizeEmail(payload?.context?.profile?.email);
  if (ctxProfEmail) return ctxProfEmail;

  const identEmail = normalizeEmail(payload?.identity?.email);
  if (identEmail) return identEmail;

  return "";
}

/**
 * Normalize paygrade to match your pay table keys:
 *  - "E7"  -> "E-7"
 *  - "E-7" -> "E-7"
 *  - "O1"  -> "O-1"
 */
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

function money(n) {
  const x = Number(n) || 0;
  return x.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

function normalizeBaseName(s) {
  return String(s || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

/* ============================================================
   //#3B — Mortgage helpers (deterministic)
============================================================ */
function monthlyPaymentPI(principal, aprPercent, termYears) {
  const P = Number(principal) || 0;
  const apr = Number(aprPercent) || 0;
  const years = Number(termYears) || 30;
  const n = Math.max(1, Math.round(years * 12));

  if (P <= 0) return 0;

  const r = apr > 0 ? (apr / 100) / 12 : 0;
  if (r === 0) return P / n;

  const pow = Math.pow(1 + r, n);
  return (P * (r * pow)) / (pow - 1);
}

function principalFromPaymentPI(payment, aprPercent, termYears) {
  const M = Number(payment) || 0;
  const apr = Number(aprPercent) || 0;
  const years = Number(termYears) || 30;
  const n = Math.max(1, Math.round(years * 12));

  if (M <= 0) return 0;

  const r = apr > 0 ? (apr / 100) / 12 : 0;
  if (r === 0) return M * n;

  const pow = Math.pow(1 + r, n);
  return M * ((pow - 1) / (r * pow));
}

/* ============================================================
   //#4 — Deterministic pay tables (militaryPayTables.json)
============================================================ */
let __PAY_TABLES_CACHE__ = null;
let __PAY_TABLES_LOC_USED__ = null; // "data" | "legacy" | null

function loadPayTables() {
  if (__PAY_TABLES_CACHE__ !== null) return __PAY_TABLES_CACHE__;

  const pData = path.join(process.cwd(), "netlify", "functions", "data", "militaryPayTables.json");
  const pLegacy = path.join(process.cwd(), "netlify", "functions", "militaryPayTables.json");

  try {
    let fp = null;
    if (fs.existsSync(pData)) {
      fp = pData;
      __PAY_TABLES_LOC_USED__ = "data";
    } else if (fs.existsSync(pLegacy)) {
      fp = pLegacy;
      __PAY_TABLES_LOC_USED__ = "legacy";
    }

    if (!fp) {
      __PAY_TABLES_CACHE__ = null;
      __PAY_TABLES_LOC_USED__ = null;
      return null;
    }

    const raw = fs.readFileSync(fp, "utf8");
    __PAY_TABLES_CACHE__ = JSON.parse(raw);
    return __PAY_TABLES_CACHE__;
  } catch (_) {
    __PAY_TABLES_CACHE__ = null;
    __PAY_TABLES_LOC_USED__ = null;
    return null;
  }
}

// choose nearest YOS key <= requested YOS if exact missing
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

/* ============================================================
   //#4B — Base/City mapping (cities/index.byBase.json)
   - Primary: netlify/functions/cities/index.byBase.json
   - Optional fallback: netlify/functions/cities/base.json (if you add it later)
   - Optional per-base file load: netlify/functions/cities/<file>.json
============================================================ */
let __BASE_INDEX_CACHE__ = null;
let __BASE_INDEX_LOC_USED__ = null; // "index.byBase" | "base.json" | null

function loadBaseIndex() {
  if (__BASE_INDEX_CACHE__ !== null) return __BASE_INDEX_CACHE__;

  const pIndex = path.join(process.cwd(), "netlify", "functions", "cities", "index.byBase.json");
  const pBase = path.join(process.cwd(), "netlify", "functions", "cities", "base.json"); // optional

  try {
    let fp = null;
    if (fs.existsSync(pIndex)) {
      fp = pIndex;
      __BASE_INDEX_LOC_USED__ = "index.byBase";
    } else if (fs.existsSync(pBase)) {
      fp = pBase;
      __BASE_INDEX_LOC_USED__ = "base.json";
    }

    if (!fp) {
      __BASE_INDEX_CACHE__ = null;
      __BASE_INDEX_LOC_USED__ = null;
      return null;
    }

    const raw = fs.readFileSync(fp, "utf8");
    __BASE_INDEX_CACHE__ = JSON.parse(raw);
    return __BASE_INDEX_CACHE__;
  } catch (_) {
    __BASE_INDEX_CACHE__ = null;
    __BASE_INDEX_LOC_USED__ = null;
    return null;
  }
}

function resolveBaseMeta(inputBaseName) {
  const idx = loadBaseIndex();
  if (!idx) return null;

  const bases = idx?.bases || {};
  const aliases = idx?.aliases || {};

  const raw = safeStr(inputBaseName);
  if (!raw) return null;

  // 1) exact base key
  if (bases[raw]) return { canonical: raw, ...bases[raw] };

  // 2) alias -> canonical
  const aliased = aliases[raw];
  if (aliased && bases[aliased]) return { canonical: aliased, ...bases[aliased] };

  // 3) normalized match across bases + aliases
  const want = normalizeBaseName(raw);
  if (!want) return null;

  // normalize base keys
  for (const k of Object.keys(bases)) {
    if (normalizeBaseName(k) === want) return { canonical: k, ...bases[k] };
  }

  // normalize aliases
  for (const [a, canon] of Object.entries(aliases)) {
    if (normalizeBaseName(a) === want && bases[canon]) return { canonical: canon, ...bases[canon] };
  }

  return null;
}

function findBaseMentionInText(text) {
  const idx = loadBaseIndex();
  if (!idx) return "";

  const t = String(text || "").toLowerCase();
  if (!t) return "";

  const bases = Object.keys(idx.bases || {});
  const aliases = Object.keys(idx.aliases || {});

  // try longer strings first to reduce accidental matches
  const candidates = [...bases, ...aliases].sort((a, b) => b.length - a.length);

  for (const c of candidates) {
    if (!c) continue;
    if (t.includes(String(c).toLowerCase())) return c;
  }

  return "";
}

function loadPerBaseFile(meta) {
  if (!meta || !meta.file) return null;
  const fname = String(meta.file).endsWith(".json") ? String(meta.file) : `${meta.file}.json`;
  const fp = path.join(process.cwd(), "netlify", "functions", "cities", fname);

  try {
    if (!fs.existsSync(fp)) return null;
    const raw = fs.readFileSync(fp, "utf8");
    return JSON.parse(raw);
  } catch (_) {
    return null;
  }
}

/* ============================================================
   //#4C — ZIP derivation (prefer base index; fallback pay tables)
============================================================ */
function deriveZipFromBase(tables, baseName) {
  // 1) prefer city index mapping if present
  const meta = resolveBaseMeta(baseName);
  const z1 = safeStr(meta?.zip);
  if (z1) return z1;

  // 2) fallback: pay table base_to_zip mapping
  const baseToZip = tables?.BAH?.base_to_zip || tables?.BAH?.baseToZip || {};
  if (!baseName) return "";

  const want = normalizeBaseName(baseName);
  if (!want) return "";

  const map = new Map();
  for (const [k, v] of Object.entries(baseToZip || {})) {
    const nk = normalizeBaseName(k);
    if (nk) map.set(nk, safeStr(v));
  }

  return map.get(want) || "";
}

function lookupBah(tables, zip, paygrade, familyBool) {
  const z = safeStr(zip);
  if (!z) return { bah: 0, note: "BAH needs a ZIP code (or a base name for base→ZIP mapping)." };

  const rec =
    tables?.BAH?.by_zip?.[z] ||
    tables?.BAH?.byZip?.[z] ||
    tables?.BAH_TX?.[z] ||
    null;

  if (!rec) return { bah: 0, note: "BAH ZIP not found in table." };

  const bucket = familyBool ? rec.with : rec.without;
  const val = Number(bucket?.[paygrade]) || 0;

  if (!val) return { bah: 0, note: "BAH for that ZIP/paygrade not found." };
  return { bah: val, note: "" };
}

function computePayBasics({ paygrade, yos, zip, family, base }) {
  const tables = loadPayTables();
  if (!tables) return { ok: false, reason: "Pay tables JSON not available on server." };

  const pg = normalizePaygrade(paygrade);
  const y = Number(yos);

  if (!pg || !Number.isFinite(y)) {
    return { ok: false, reason: "Missing rank/paygrade or YOS." };
  }

  const baseTable = tables.BASEPAY?.[pg];
  const basePay = pickYosValue(baseTable, y);

  const isOfficer = pg.startsWith("O-") || pg.startsWith("W-");
  const bas = Number(isOfficer ? tables.BAS?.officer : tables.BAS?.enlisted) || 0;

  let z = safeStr(zip);
  if (!z) {
    const derived = deriveZipFromBase(tables, base);
    if (derived) z = derived;
  }

  const { bah, note: bahNote } = lookupBah(tables, z, pg, !!family);

  return {
    ok: true,
    basePay,
    bas,
    bah,
    total: basePay + bas + bah,
    bahNote: bahNote || "",
    resolvedZip: z || "",
  };
}

/* ============================================================
   //#5 — Intent detection (simple + reliable)
============================================================ */
function detectIntent(text) {
  const t = String(text || "").toLowerCase();

  if (
    t.includes("monthly pay") ||
    t.includes("total pay") ||
    t.includes("how much do i make") ||
    t.includes("salary") ||
    (t.includes("pay") && (t.includes("monthly") || t.includes("total") || t.includes("mine") || t.includes("my")))
  ) return { type: "pay_question" };

  if (t.includes("my rank") || (t.includes("rank") && t.includes("my")) || t.includes("profile loaded")) {
    return { type: "profile_question" };
  }

  if (
    t.includes("afford") ||
    t.includes("how much house") ||
    t.includes("how much home") ||
    t.includes("most i can spend") ||
    (t.includes("spend") && (t.includes("house") || t.includes("home"))) ||
    (t.includes("budget") && (t.includes("house") || t.includes("home") || t.includes("mortgage")))
  ) return { type: "affordability_question" };

  // ✅ NEW: base/city info intent
  if (
    t.includes("base info") ||
    t.includes("tell me about") ||
    t.includes("pcs to") ||
    t.includes("i'm going to") ||
    t.includes("im going to") ||
    t.includes("city targets") ||
    (t.includes("city") && (t.includes("target") || t.includes("rent") || t.includes("home price") || t.includes("market")))
  ) return { type: "base_city_question" };

  return null;
}

/* ============================================================
   //#6 — Main handler
============================================================ */
module.exports.handler = async (event) => {
  const origin = event.headers?.origin || "";
  const headers = corsHeaders(origin);

  if (event.httpMethod === "OPTIONS") return respond(204, headers, {});
  if (event.httpMethod !== "POST") return respond(405, headers, { error: "Method Not Allowed" });

  let payload = {};
  try {
    payload = JSON.parse(event.body || "{}");
  } catch (_) {
    return respond(400, headers, { error: "Invalid JSON body" });
  }

  const userText = safeStr(payload.message);
  if (!userText) return respond(400, headers, { error: "Missing message" });

  const contextProfile =
    payload?.context?.profile && typeof payload.context.profile === "object"
      ? payload.context.profile
      : null;

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

  const email = getEmailFromPayload(payload);
  let profile = null;
  let usedSupabase = false;

  if (email && SUPABASE_URL && SUPABASE_SERVICE_KEY) {
    try {
      const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
        auth: { persistSession: false, autoRefreshToken: false },
      });

      const { data, error } = await supabase
        .from("profiles")
        .select(SELECT_COLS)
        .eq("email", email)
        .maybeSingle();

      if (!error && data) {
        profile = data;
        usedSupabase = true;
      }
    } catch (_) {
      // swallow
    }
  }

  if (!profile && contextProfile) profile = contextProfile;

  const fullName = safeStr(profile?.full_name);
  const ln = lastNameOf(fullName, profile?.last_name);
  const pg = normalizePaygrade(profile?.rank_paygrade || profile?.rank);
  const yos = profile?.yos ?? null;
  const baseFromProfile = safeStr(profile?.base);
  const family = profile?.family ?? null;
  const va = profile?.va_disability ?? null;

  const zip = safeStr(payload.zip || payload?.context?.zip || "");

  const profileContext = profile
    ? {
        email: normalizeEmail(profile.email || email) || null,
        full_name: fullName || null,
        last_name: safeStr(profile.last_name) || null,
        rank_paygrade: safeStr(profile.rank_paygrade) || null,
        rank: safeStr(profile.rank) || null,
        yos: yos === null || yos === undefined ? null : Number(yos),
        base: baseFromProfile || null,
        family: family === null || family === undefined ? null : family,
        va_disability: va === null || va === undefined ? null : va,
        mode: safeStr(profile.mode) || null,
      }
    : null;

  const intent = detectIntent(userText);

  // ============================================================
  // //#6.0 — Base/City context resolve (from profile + context + text)
  // ============================================================
  const baseHint =
    safeStr(payload?.base) ||
    safeStr(payload?.context?.base) ||
    safeStr(payload?.context?.profile?.base) ||
    baseFromProfile ||
    "";

  const baseFromText = findBaseMentionInText(userText);
  const baseCandidate = baseHint || baseFromText || "";

  const baseMeta = baseCandidate ? resolveBaseMeta(baseCandidate) : null;
  const perBaseData = baseMeta ? loadPerBaseFile(baseMeta) : null;

  const baseContext = baseMeta
    ? {
        base: baseMeta.canonical || null,
        cityKey: safeStr(baseMeta.cityKey) || null,
        zip: safeStr(baseMeta.zip) || null,
        file: safeStr(baseMeta.file) || null,
        data: perBaseData || null, // raw JSON if present
      }
    : null;

  // Resolve ZIP early (deterministic + OpenAI fallback)
  const tables = loadPayTables();
  const derivedZip = !zip && baseCandidate && tables ? deriveZipFromBase(tables, baseCandidate) : "";
  const resolvedZip = zip || derivedZip || "";

  // ============================================================
  // //#6.1 — Profile question (deterministic)
  // ============================================================
  if (intent?.type === "profile_question") {
    if (!profileContext || !profileContext.email) {
      return respond(200, headers, {
        intent: "profile_question",
        reply:
          "I can answer that instantly once your profile is synced. Send your email (or load your profile in the shell) and I’ll pull your rank + YOS.",
        profile: null,
        debug: {
          usedSupabase,
          hasContextProfile: !!contextProfile,
          payTablesLocation: __PAY_TABLES_LOC_USED__ || null,
          baseIndexLocation: __BASE_INDEX_LOC_USED__ || null,
        },
      });
    }

    const r = rankShort(pg) || pg || "—";
    const y = profileContext.yos !== null && profileContext.yos !== undefined ? String(profileContext.yos) : "—";
    const fam = profileContext.family !== null && profileContext.family !== undefined ? String(profileContext.family) : "—";
    const vaTxt =
      profileContext.va_disability !== null && profileContext.va_disability !== undefined
        ? `${profileContext.va_disability}%`
        : "—";

    return respond(200, headers, {
      intent: "profile_question",
      reply: `Locked in. I see you as ${r} ${ln || ""} — ${y} YOS, Base ${baseFromProfile || "—"}, Family ${fam}, VA ${vaTxt}.`.trim(),
      profile: profileContext,
      baseContext,
      debug: {
        usedSupabase,
        hasContextProfile: !!contextProfile,
        payTablesLocation: __PAY_TABLES_LOC_USED__ || null,
        baseIndexLocation: __BASE_INDEX_LOC_USED__ || null,
      },
    });
  }

  // ============================================================
  // //#6.2 — Pay question (deterministic)
  // ============================================================
  if (intent?.type === "pay_question") {
    if (!profileContext || !profileContext.email) {
      return respond(200, headers, {
        intent: "pay_question",
        reply:
          "I can calculate that instantly once your profile is synced. Send your email (or load your profile in the shell) so I can grab rank + YOS.",
        profile: null,
        debug: {
          usedSupabase,
          hasContextProfile: !!contextProfile,
          payTablesLocation: __PAY_TABLES_LOC_USED__ || null,
          baseIndexLocation: __BASE_INDEX_LOC_USED__ || null,
        },
      });
    }

    const pay = computePayBasics({
      paygrade: pg,
      yos: profileContext.yos,
      zip: resolvedZip,
      family: !!profileContext.family,
      base: profileContext.base || baseCandidate,
    });

    const r = rankShort(pg) || pg || "—";

    if (!pay.ok) {
      return respond(200, headers, {
        intent: "pay_question",
        reply: `I can see your profile (${r}, ${String(profileContext.yos ?? "—")} YOS), but pay math can’t run yet: ${pay.reason}`,
        profile: profileContext,
        baseContext,
        debug: {
          usedSupabase,
          hasContextProfile: !!contextProfile,
          payTablesLocation: __PAY_TABLES_LOC_USED__ || null,
          baseIndexLocation: __BASE_INDEX_LOC_USED__ || null,
        },
      });
    }

    const lines = [];
    lines.push(`Monthly pay snapshot for ${r} ${ln || ""}:`.trim());
    lines.push(`• Base Pay: ${money(pay.basePay)}`);
    lines.push(`• BAS: ${money(pay.bas)}`);

    if (pay.bah > 0) {
      lines.push(`• BAH: ${money(pay.bah)}${pay.resolvedZip ? ` (ZIP ${pay.resolvedZip})` : ""}`);
    } else {
      lines.push(`• BAH: — (${pay.bahNote || "ZIP required"})`);
    }

    lines.push(`= Estimated Total: ${money(pay.total)} / month`);

    return respond(200, headers, {
      intent: "pay_question",
      reply: lines.join("\n"),
      profile: profileContext,
      baseContext,
      pay: {
        basePay: pay.basePay,
        bas: pay.bas,
        bah: pay.bah,
        total: pay.total,
        bahNote: pay.bahNote || "",
        resolvedZip: pay.resolvedZip || "",
        inputs: {
          paygrade: pg || null,
          yos: profileContext.yos ?? null,
          zip: resolvedZip || null,
          base: (profileContext.base || baseCandidate) || null,
          family: !!profileContext.family,
        },
      },
      debug: {
        usedSupabase,
        hasContextProfile: !!contextProfile,
        payTablesLocation: __PAY_TABLES_LOC_USED__ || null,
        baseIndexLocation: __BASE_INDEX_LOC_USED__ || null,
      },
    });
  }

  // ============================================================
  // //#6.3 — Affordability question (deterministic quick answer)
  // ============================================================
  if (intent?.type === "affordability_question") {
    if (!profileContext || !profileContext.email) {
      return respond(200, headers, {
        intent: "affordability_question",
        reply:
          "I can calculate that fast — I just need your profile synced (email) so I can pull rank + YOS + base for BAH.",
        profile: null,
        debug: {
          usedSupabase,
          hasContextProfile: !!contextProfile,
          payTablesLocation: __PAY_TABLES_LOC_USED__ || null,
          baseIndexLocation: __BASE_INDEX_LOC_USED__ || null,
        },
      });
    }

    const r = rankShort(pg) || pg || "—";

    const pay = computePayBasics({
      paygrade: pg,
      yos: profileContext.yos,
      zip: resolvedZip,
      family: !!profileContext.family,
      base: profileContext.base || baseCandidate,
    });

    if (!pay.ok) {
      return respond(200, headers, {
        intent: "affordability_question",
        reply: `I can see your profile (${r}, ${String(profileContext.yos ?? "—")} YOS), but pay math can’t run yet: ${pay.reason}`,
        profile: profileContext,
        baseContext,
        debug: {
          usedSupabase,
          hasContextProfile: !!contextProfile,
          payTablesLocation: __PAY_TABLES_LOC_USED__ || null,
          baseIndexLocation: __BASE_INDEX_LOC_USED__ || null,
        },
      });
    }

    const totalPay = Number(pay.total) || 0;
    const allInCap = totalPay * 0.30;
    const piTarget = allInCap / 1.28;

    const aprAssumed = 7.0;
    const termAssumed = 30;

    const maxPrincipal = principalFromPaymentPI(piTarget, aprAssumed, termAssumed);
    const price0 = maxPrincipal;
    const price5 = maxPrincipal / (1 - 0.05);

    const lines = [];
    lines.push(`BLUF: Your “safe” all-in housing cap is about ${money(allInCap)}/mo.`);
    lines.push(`That’s a P&I target of ~${money(piTarget)}/mo (using your 1.28 buffer).`);
    lines.push("");
    lines.push(`Pay snapshot for ${r} ${ln || ""}:`.trim());
    lines.push(`• Base Pay: ${money(pay.basePay)}`);
    lines.push(`• BAS: ${money(pay.bas)}`);
    if (pay.bah > 0) lines.push(`• BAH: ${money(pay.bah)}${pay.resolvedZip ? ` (ZIP ${pay.resolvedZip})` : ""}`);
    else lines.push(`• BAH: — (${pay.bahNote || "needs base/ZIP"})`);
    lines.push(`= Total Pay Used: ${money(totalPay)}/mo`);
    lines.push("");
    lines.push(`Quick max price estimate (assumes ${aprAssumed}% APR, ${termAssumed}yr fixed):`);
    lines.push(`• ~${money(price0)} home price @ 0% down (VA-style rough cap)`);
    lines.push(`• ~${money(price5)} home price @ 5% down`);
    lines.push("");
    lines.push(`If you tell me your credit score + planned down payment, I’ll tighten this to your real APR band.`);

    return respond(200, headers, {
      intent: "affordability_question",
      reply: lines.join("\n"),
      profile: profileContext,
      baseContext,
      pay: {
        basePay: pay.basePay,
        bas: pay.bas,
        bah: pay.bah,
        total: pay.total,
        resolvedZip: pay.resolvedZip || "",
      },
      affordability: {
        ratios: { housing_cap_pct: 0.30, buffer_allin_to_pi: 1.28 },
        allInCapMonthly: allInCap,
        piTargetMonthly: piTarget,
        assumptions: { apr_percent: aprAssumed, term_years: termAssumed },
        maxPrincipal,
        maxPrice_0_down: price0,
        maxPrice_5_down: price5,
      },
      debug: {
        usedSupabase,
        hasContextProfile: !!contextProfile,
        payTablesLocation: __PAY_TABLES_LOC_USED__ || null,
        baseIndexLocation: __BASE_INDEX_LOC_USED__ || null,
      },
    });
  }

  // ============================================================
  // //#6.3B — Base/City question (deterministic)
  // ============================================================
  if (intent?.type === "base_city_question") {
    if (!baseContext || !baseContext.base) {
      return respond(200, headers, {
        intent: "base_city_question",
        reply:
          "Tell me the base name you’re heading to (example: Nellis AFB / JBSA-Lackland). If your profile has a base saved, I can use that too.",
        profile: profileContext || null,
        baseContext: null,
        debug: {
          usedSupabase,
          hasContextProfile: !!contextProfile,
          baseIndexLocation: __BASE_INDEX_LOC_USED__ || null,
        },
      });
    }

    const lines = [];
    lines.push(`Base locked: ${baseContext.base}.`);
    if (baseContext.cityKey) lines.push(`City key: ${baseContext.cityKey}.`);
    if (baseContext.zip) lines.push(`ZIP anchor: ${baseContext.zip}.`);

    if (baseContext.data && typeof baseContext.data === "object") {
      // We don’t assume schema — just highlight common-looking values if present.
      const d = baseContext.data;
      const maybe = (obj, keys) => {
        for (const k of keys) {
          const v = obj?.[k];
          if (v !== undefined && v !== null && String(v).trim() !== "") return v;
        }
        return null;
      };

      const targetRent = maybe(d, ["targetRent", "rentTarget", "target_rent", "targets_rent"]);
      const avgHome = maybe(d, ["avgHomePrice", "averageHomePrice", "homePriceAvg", "avg_home_price", "targets_home"]);
      if (targetRent) lines.push(`Target rent (from base file): ${String(targetRent)}`);
      if (avgHome) lines.push(`Average home price (from base file): ${String(avgHome)}`);
    }

    lines.push("");
    lines.push("Ask me what you want: rent target, price bands, neighborhoods, commute rails, or VA-loan strategy for that market.");

    return respond(200, headers, {
      intent: "base_city_question",
      reply: lines.join("\n"),
      profile: profileContext || null,
      baseContext,
      debug: {
        usedSupabase,
        hasContextProfile: !!contextProfile,
        baseIndexLocation: __BASE_INDEX_LOC_USED__ || null,
      },
    });
  }

  // ============================================================
  // //#6.4 — OpenAI fallback (profile-aware, optional)
  // ============================================================
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    const hint = profileContext
      ? `I can see your profile (${rankShort(pg) || pg || "—"}, ${String(profileContext.yos ?? "—")} YOS, ${baseFromProfile || "—"}).`
      : "I can’t see your profile yet (sync it in the shell or include email).";

    return respond(200, headers, {
      intent: "fallback_no_openai",
      reply: `Elena (dev echo): “${userText}” — ${hint} Add OPENAI_API_KEY for natural-language answers.`,
      profile: profileContext,
      baseContext,
      debug: {
        usedSupabase,
        hasContextProfile: !!contextProfile,
        payTablesLocation: __PAY_TABLES_LOC_USED__ || null,
        baseIndexLocation: __BASE_INDEX_LOC_USED__ || null,
      },
    });
  }

  // Provide pay preview to the LLM so it DOESN’T ask for ZIP if base already gives one.
  let payPreview = null;
  if (profileContext && pg && profileContext.yos !== null && profileContext.yos !== undefined) {
    const p = computePayBasics({
      paygrade: pg,
      yos: profileContext.yos,
      zip: resolvedZip,
      family: !!profileContext.family,
      base: profileContext.base || baseCandidate,
    });
    if (p?.ok) payPreview = p;
  }

  const system = [
    "You are Elena, a warm, high-trust A.I. Concierge for PCSUnited / RealtySaSS.",
    "BLUF-first. Keep answers under 8 sentences. No fluff.",
    "If a question needs math, ask for the missing inputs explicitly.",
    "If profile is available, use it (rank/yos/base/family/VA).",
    "IMPORTANT: If resolvedZip is provided (either user ZIP or derived from base), DO NOT ask for ZIP.",
    "If payPreview is provided, you can reference Base Pay + BAS + BAH + Total directly.",
    "If baseContext is provided (base/cityKey/zip), you can answer base/city questions using it.",
  ].join(" ");

  try {
    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        // ✅ upgrade model
        model: "gpt-5-nano",
        temperature: 0.35,

        // ✅ fix: some models require max_completion_tokens (max_tokens deprecated)
        max_completion_tokens: 450,

        messages: [
          { role: "system", content: system },
          {
            role: "user",
            content: JSON.stringify({
              message: userText,
              profile: profileContext,
              resolvedZip: resolvedZip || null,
              baseContext: baseContext || null,
              payPreview: payPreview
                ? {
                    basePay: payPreview.basePay,
                    bas: payPreview.bas,
                    bah: payPreview.bah,
                    total: payPreview.total,
                    bahNote: payPreview.bahNote,
                  }
                : null,
              note: "Use resolvedZip/baseContext/payPreview if present. Only ask for missing inputs once.",
            }),
          },
        ],
      }),
    });

    const data = await resp.json();
    const reply = (data?.choices?.[0]?.message?.content || "").trim() || "I’m here — what are we solving today?";

    return respond(200, headers, {
      intent: "openai_fallback",
      reply,
      profile: profileContext || undefined,
      baseContext: baseContext || undefined,
      debug: {
        usedSupabase,
        hasContextProfile: !!contextProfile,
        payTablesLocation: __PAY_TABLES_LOC_USED__ || null,
        baseIndexLocation: __BASE_INDEX_LOC_USED__ || null,
        resolvedZip: resolvedZip || null,
      },
    });
  } catch (err) {
    return respond(500, headers, {
      error: "Server exception",
      detail: String(err),
      debug: {
        usedSupabase,
        hasContextProfile: !!contextProfile,
        payTablesLocation: __PAY_TABLES_LOC_USED__ || null,
        baseIndexLocation: __BASE_INDEX_LOC_USED__ || null,
      },
    });
  }
};
