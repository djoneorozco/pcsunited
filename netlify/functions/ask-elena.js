// netlify/functions/ask-elena.js
// ============================================================
// PCSUnited • Ask Elena — Router-First, Modular, Military-Smart
// Version: v3.0.0 (PCSUnited)
// GOAL:
//  - Keep ask-elena.js SMALL (router + auth/profile + shared utilities)
//  - Route domain logic to /elena/skills/*
//  - Use deterministic pay tables for military pay questions
//  - Optional OpenAI fallback for non-deterministic queries
//
// REQUIRED ENV:
//   SUPABASE_URL
//   SUPABASE_SERVICE_KEY
//
// OPTIONAL ENV:
//   OPENAI_API_KEY
//
// FILES EXPECTED (you will create):
//   netlify/functions/elena/router.js
//   netlify/functions/elena/skills/pay.js        (recommended first)
//   netlify/functions/elena/skills/profile.js    (optional)
//   netlify/functions/elena/skills/afford.js     (optional)
//   netlify/functions/elena/data/*               (json knowledge)
//
// PAY TABLES (existing):
//   ✅ netlify/functions/data/militaryPayTables.json   (your current canonical)
//   ↩︎ netlify/functions/militaryPayTables.json        (legacy support)
//
// ============================================================

const { createClient } = require("@supabase/supabase-js");
const fs = require("fs");
const path = require("path");

// Try-load router (will be used when you create it). We also keep a fallback baseline.
let ROUTER = null;
try {
  ROUTER = require("./elena/router.js");
} catch (_) {
  ROUTER = null;
}

/* ============================================================
   //#1 — CORS (PCSUnited)
============================================================ */
const ALLOW_ORIGINS = [
  "https://pcsunited.com",
  "https://www.pcsunited.com",
  "https://pcsunited.webflow.io",
  "https://www.pcsunited.webflow.io",
  "https://pcsunited.netlify.app",
  "http://localhost:8888",
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
    "Content-Type": "application/json",
  };
}

function respond(statusCode, headers, payload) {
  return { statusCode, headers, body: JSON.stringify(payload || {}) };
}

/* ============================================================
   //#2 — Supabase Profile Fields (Canonical Fix 1)
   - Keep this list aligned with your saved canonical list.
============================================================ */
const SELECT_COLS = [
  "id",
  "created_at",
  "email",
  "first_name",
  "last_name",
  "phone",
  "mode",
  "rank",
  "va_disability",
  "yos",
  "family",
  "base",
  "rank_paygrade",
  "role",
  "profiles_user_id_unique",
  "notes",
  "full_name",
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
].join(",");

/* ============================================================
   //#3 — Shared Utility Helpers
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
  // Priority order: payload.email -> payload.context.email -> payload.context.profile.email -> payload.identity.email
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
    "E-1": "AB", "E-2": "Amn", "E-3": "A1C", "E-4": "SrA",
    "E-5": "SSgt", "E-6": "TSgt", "E-7": "MSgt", "E-8": "SMSgt", "E-9": "CMSgt",
    "W-1": "WO1", "W-2": "CWO2", "W-3": "CWO3", "W-4": "CWO4", "W-5": "CWO5",
    "O-1": "2nd Lt", "O-2": "1st Lt", "O-3": "Capt", "O-4": "Maj",
    "O-5": "Lt Col", "O-6": "Col", "O-7": "Brig Gen", "O-8": "Maj Gen",
    "O-9": "Lt Gen", "O-10": "Gen",
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
   //#4 — Pay Tables Loader (same as your working pattern)
============================================================ */
let __PAY_TABLES_CACHE__ = null;
let __PAY_TABLES_PATH_USED__ = null;

function loadPayTables() {
  if (__PAY_TABLES_CACHE__ !== null) return __PAY_TABLES_CACHE__;

  // ✅ Primary (PCSUnited canonical)
  const p1 = path.join(process.cwd(), "netlify", "functions", "data", "militaryPayTables.json");
  // ↩︎ Fallback (legacy)
  const p2 = path.join(process.cwd(), "netlify", "functions", "militaryPayTables.json");

  try {
    let fp = null;
    if (fs.existsSync(p1)) fp = p1;
    else if (fs.existsSync(p2)) fp = p2;

    if (!fp) {
      __PAY_TABLES_CACHE__ = null;
      __PAY_TABLES_PATH_USED__ = null;
      return null;
    }

    const raw = fs.readFileSync(fp, "utf8");
    __PAY_TABLES_CACHE__ = JSON.parse(raw);
    __PAY_TABLES_PATH_USED__ = fp;
    return __PAY_TABLES_CACHE__;
  } catch (_) {
    __PAY_TABLES_CACHE__ = null;
    __PAY_TABLES_PATH_USED__ = null;
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

function deriveZipFromBase(tables, baseName) {
  const baseToZip =
    tables?.BAH?.base_to_zip ||
    tables?.BAH?.baseToZip ||
    {};

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
   //#5 — Deterministic Baseline Intent (minimal)
   NOTE: Your real routing will live in /elena/router.js
============================================================ */
function detectBaselineIntent(text) {
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

  return null;
}

/* ============================================================
   //#6 — Optional OpenAI Fallback
============================================================ */
async function openAIFallback({ key, system, user, model = "gpt-4o-mini" }) {
  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model,
      temperature: 0.35,
      max_tokens: 500,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });
  const data = await resp.json();
  const reply = (data?.choices?.[0]?.message?.content || "").trim();
  return reply || "";
}

/* ============================================================
   //#7 — Main Handler
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

  // --- Context profile fast-path (client may pass profile) ---
  const contextProfile =
    payload?.context?.profile && typeof payload.context.profile === "object"
      ? payload.context.profile
      : null;

  // --- Supabase lookup by email (authoritative) ---
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
      // swallow — we can still respond using contextProfile
    }
  }

  if (!profile && contextProfile) profile = contextProfile;

  // Normalize profile context for downstream skills/router
  const fullName = safeStr(profile?.full_name);
  const ln = lastNameOf(fullName, profile?.last_name);
  const pg = normalizePaygrade(profile?.rank_paygrade || profile?.rank);
  const yos = profile?.yos ?? null;
  const base = safeStr(profile?.base);
  const family = profile?.family ?? null;
  const va = profile?.va_disability ?? null;

  const zip = safeStr(payload.zip || payload?.context?.zip || "");

  const profileContext = profile
    ? {
        email: normalizeEmail(profile.email || email) || null,
        full_name: fullName || null,
        first_name: safeStr(profile.first_name) || null,
        last_name: safeStr(profile.last_name) || null,
        phone: safeStr(profile.phone) || null,
        mode: safeStr(profile.mode) || null,
        rank_paygrade: safeStr(profile.rank_paygrade) || null,
        rank: safeStr(profile.rank) || null,
        yos: (yos === null || yos === undefined) ? null : Number(yos),
        base: base || null,
        family: (family === null || family === undefined) ? null : family,
        va_disability: (va === null || va === undefined) ? null : va,
        monthly_expenses: profile?.monthly_expenses ?? null,
        projected_home_price: profile?.projected_home_price ?? null,
        downpayment: profile?.downpayment ?? null,
        credit_score: profile?.credit_score ?? null,
        time_to_buy: safeStr(profile?.time_to_buy) || null,
        bedrooms: profile?.bedrooms ?? null,
        bathrooms: profile?.bathrooms ?? null,
        sqft: profile?.sqft ?? null,
        property_type: safeStr(profile?.property_type) || null,
        amenities: safeStr(profile?.amenities) || null,
        home_condition: safeStr(profile?.home_condition) || null,
      }
    : null;

  // Resolve ZIP (for deterministic pay)
  const tables = loadPayTables();
  const derivedZip = (!zip && base && tables) ? deriveZipFromBase(tables, base) : "";
  const resolvedZip = zip || derivedZip || "";

  // Build shared ctx for skills/router
  const ctx = {
    brand: "PCSUnited",
    nowISO: new Date().toISOString(),
    origin: origin || null,
    profile: profileContext,
    resolvedZip: resolvedZip || null,
    payTablesPathUsed: __PAY_TABLES_PATH_USED__ || null,
    usedSupabase,
    hasContextProfile: !!contextProfile,
    raw: {
      message: userText,
      email: email || null,
      zip: zip || null,
    },
  };

  // ============================================================
  // //#7.1 — Router path (preferred)
  // ============================================================
  if (ROUTER && typeof ROUTER.route === "function") {
    try {
      const routed = await ROUTER.route(userText, ctx, {
        computePayBasics,
        money,
        rankShort,
        normalizePaygrade,
      });

      // Expect { reply, intent, data?, debug? }
      if (routed && routed.reply) {
        return respond(200, headers, {
          intent: routed.intent || "routed",
          reply: routed.reply,
          data: routed.data || undefined,
          profile: profileContext || undefined,
          debug: Object.assign(
            {
              usedSupabase,
              hasContextProfile: !!contextProfile,
              payTablesPathUsed: __PAY_TABLES_PATH_USED__ || null,
              resolvedZip: resolvedZip || null,
              router: true,
            },
            routed.debug || {}
          ),
        });
      }
      // If router returns nothing useful, fall through to baseline
    } catch (err) {
      // Router exists but failed — do NOT crash the function.
      // Fall through to baseline + include debug.
      ctx.routerError = String(err);
    }
  }

  // ============================================================
  // //#7.2 — Baseline deterministic fallback (works even without router)
  // ============================================================
  const intent = detectBaselineIntent(userText);

  // --- Profile question ---
  if (intent?.type === "profile_question") {
    if (!profileContext || !profileContext.email) {
      return respond(200, headers, {
        intent: "profile_question",
        reply:
          "I can pull that instantly once your PCSUnited profile is synced. Send your email (or log in) and I’ll load rank + YOS + base.",
        profile: null,
        debug: { usedSupabase, hasContextProfile: !!contextProfile, payTablesPathUsed: __PAY_TABLES_PATH_USED__ || null },
      });
    }

    const r = rankShort(pg) || pg || "—";
    const y = (profileContext.yos !== null && profileContext.yos !== undefined) ? String(profileContext.yos) : "—";
    const fam = (profileContext.family !== null && profileContext.family !== undefined) ? String(profileContext.family) : "—";
    const vaTxt = (profileContext.va_disability !== null && profileContext.va_disability !== undefined)
      ? `${profileContext.va_disability}%`
      : "—";

    return respond(200, headers, {
      intent: "profile_question",
      reply: `PCSUnited profile loaded: ${r} ${ln || ""} — ${y} YOS, Base ${base || "—"}, Family ${fam}, VA ${vaTxt}.`.trim(),
      profile: profileContext,
      debug: { usedSupabase, hasContextProfile: !!contextProfile, payTablesPathUsed: __PAY_TABLES_PATH_USED__ || null },
    });
  }

  // --- Pay question ---
  if (intent?.type === "pay_question") {
    if (!profileContext || !profileContext.email) {
      return respond(200, headers, {
        intent: "pay_question",
        reply:
          "I can calculate that instantly once your PCSUnited profile is synced. Send your email (or log in) so I can pull rank + YOS + base.",
        profile: null,
        debug: { usedSupabase, hasContextProfile: !!contextProfile, payTablesPathUsed: __PAY_TABLES_PATH_USED__ || null },
      });
    }

    const pay = computePayBasics({
      paygrade: pg,
      yos: profileContext.yos,
      zip: resolvedZip,
      family: !!profileContext.family,
      base: profileContext.base,
    });

    const r = rankShort(pg) || pg || "—";

    if (!pay.ok) {
      return respond(200, headers, {
        intent: "pay_question",
        reply: `I can see your profile (${r}, ${String(profileContext.yos ?? "—")} YOS), but pay math can’t run yet: ${pay.reason}`,
        profile: profileContext,
        debug: { usedSupabase, hasContextProfile: !!contextProfile, payTablesPathUsed: __PAY_TABLES_PATH_USED__ || null },
      });
    }

    const lines = [];
    lines.push(`Monthly pay snapshot for ${r} ${ln || ""}:`.trim());
    lines.push(`• Base Pay: ${money(pay.basePay)}`);
    lines.push(`• BAS: ${money(pay.bas)}`);
    if (pay.bah > 0) lines.push(`• BAH: ${money(pay.bah)}${pay.resolvedZip ? ` (ZIP ${pay.resolvedZip})` : ""}`);
    else lines.push(`• BAH: — (${pay.bahNote || "ZIP required"})`);
    lines.push(`= Estimated Total: ${money(pay.total)} / month`);

    return respond(200, headers, {
      intent: "pay_question",
      reply: lines.join("\n"),
      profile: profileContext,
      pay: {
        basePay: pay.basePay,
        bas: pay.bas,
        bah: pay.bah,
        total: pay.total,
        bahNote: pay.bahNote || "",
        resolvedZip: pay.resolvedZip || "",
      },
      debug: {
        usedSupabase,
        hasContextProfile: !!contextProfile,
        payTablesPathUsed: __PAY_TABLES_PATH_USED__ || null,
        resolvedZip: resolvedZip || null,
      },
    });
  }

  // --- Affordability (simple deterministic cap) ---
  if (intent?.type === "affordability_question") {
    if (!profileContext || !profileContext.email) {
      return respond(200, headers, {
        intent: "affordability_question",
        reply:
          "I can calculate that fast — I just need your profile synced (email) so I can pull rank + YOS + base (for BAH).",
        profile: null,
        debug: { usedSupabase, hasContextProfile: !!contextProfile, payTablesPathUsed: __PAY_TABLES_PATH_USED__ || null },
      });
    }

    const r = rankShort(pg) || pg || "—";

    const pay = computePayBasics({
      paygrade: pg,
      yos: profileContext.yos,
      zip: resolvedZip,
      family: !!profileContext.family,
      base: profileContext.base,
    });

    if (!pay.ok) {
      return respond(200, headers, {
        intent: "affordability_question",
        reply: `I can see your profile (${r}, ${String(profileContext.yos ?? "—")} YOS), but pay math can’t run yet: ${pay.reason}`,
        profile: profileContext,
        debug: { usedSupabase, hasContextProfile: !!contextProfile, payTablesPathUsed: __PAY_TABLES_PATH_USED__ || null },
      });
    }

    const totalPay = Number(pay.total) || 0;
    const allInCap = totalPay * 0.30;
    const piTarget = allInCap / 1.28;

    // Use an explicit assumption until your mortgage module refines by credit score.
    const aprAssumed = 7.0;
    const termAssumed = 30;

    // Basic PI->Principal
    const principalFromPaymentPI = (payment, aprPercent, termYears) => {
      const M = Number(payment) || 0;
      const apr = Number(aprPercent) || 0;
      const years = Number(termYears) || 30;
      const n = Math.max(1, Math.round(years * 12));
      if (M <= 0) return 0;
      const r = apr > 0 ? (apr / 100) / 12 : 0;
      if (r === 0) return M * n;
      const pow = Math.pow(1 + r, n);
      return M * ((pow - 1) / (r * pow));
    };

    const maxPrincipal = principalFromPaymentPI(piTarget, aprAssumed, termAssumed);
    const price0 = maxPrincipal;
    const price5 = maxPrincipal / (1 - 0.05);

    const lines = [];
    lines.push(`BLUF: “Safe” all-in housing cap ≈ ${money(allInCap)}/mo.`);
    lines.push(`P&I target ≈ ${money(piTarget)}/mo (using 1.28 buffer).`);
    lines.push("");
    lines.push(`Pay used for ${r} ${ln || ""}:`.trim());
    lines.push(`• Base Pay: ${money(pay.basePay)} • BAS: ${money(pay.bas)}`);
    if (pay.bah > 0) lines.push(`• BAH: ${money(pay.bah)}${pay.resolvedZip ? ` (ZIP ${pay.resolvedZip})` : ""}`);
    else lines.push(`• BAH: — (${pay.bahNote || "needs base/ZIP"})`);
    lines.push(`= Total Pay: ${money(totalPay)}/mo`);
    lines.push("");
    lines.push(`Quick max price (assumes ${aprAssumed}% APR, ${termAssumed}yr fixed):`);
    lines.push(`• ~${money(price0)} @ 0% down (VA-style rough cap)`);
    lines.push(`• ~${money(price5)} @ 5% down`);
    lines.push("");
    lines.push(`Give me your credit score + down payment and I’ll tighten this.`);

    return respond(200, headers, {
      intent: "affordability_question",
      reply: lines.join("\n"),
      profile: profileContext,
      affordability: {
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
        payTablesPathUsed: __PAY_TABLES_PATH_USED__ || null,
        resolvedZip: resolvedZip || null,
      },
    });
  }

  // ============================================================
  // //#7.3 — OpenAI fallback (optional, profile-aware)
  // ============================================================
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    const hint = profileContext
      ? `Profile visible (${rankShort(pg) || pg || "—"}, ${String(profileContext.yos ?? "—")} YOS, ${base || "—"}).`
      : "No profile loaded yet (login or include email/context.profile).";

    return respond(200, headers, {
      intent: "fallback_no_openai",
      reply: `Elena (PCSUnited dev echo): “${userText}” — ${hint} Add OPENAI_API_KEY for natural-language answers.`,
      profile: profileContext || undefined,
      debug: {
        usedSupabase,
        hasContextProfile: !!contextProfile,
        payTablesPathUsed: __PAY_TABLES_PATH_USED__ || null,
        resolvedZip: resolvedZip || null,
        routerPresent: !!ROUTER,
        routerError: ctx.routerError || null,
      },
    });
  }

  // Pay preview for LLM context (so it won’t ask for ZIP if base->ZIP worked)
  let payPreview = null;
  if (profileContext && pg && profileContext.yos !== null && profileContext.yos !== undefined) {
    const p = computePayBasics({
      paygrade: pg,
      yos: profileContext.yos,
      zip: resolvedZip,
      family: !!profileContext.family,
      base: profileContext.base,
    });
    if (p?.ok) payPreview = p;
  }

  const system = [
    "You are Elena for PCSUnited (military housing + pay + PCS readiness).",
    "Tone: warm, high-trust, BLUF-first, precise. No fluff.",
    "If the question needs inputs, ask ONLY for the missing fields once.",
    "If resolvedZip is present, DO NOT ask for ZIP.",
    "Prefer deterministic answers using payPreview/profile when provided.",
    "Never invent official policy; if unsure, say what you know + what to verify.",
  ].join(" ");

  try {
    const reply = await openAIFallback({
      key,
      system,
      user: JSON.stringify({
        message: userText,
        profile: profileContext,
        resolvedZip: resolvedZip || null,
        payPreview: payPreview
          ? { basePay: payPreview.basePay, bas: payPreview.bas, bah: payPreview.bah, total: payPreview.total }
          : null,
        note: "Use resolvedZip/payPreview if present. Ask for missing inputs once.",
      }),
      model: "gpt-4o-mini",
    });

    return respond(200, headers, {
      intent: "openai_fallback",
      reply: reply || "I’m here — tell me what you want to solve first (pay, PCS timeline, or housing cap).",
      profile: profileContext || undefined,
      debug: {
        usedSupabase,
        hasContextProfile: !!contextProfile,
        payTablesPathUsed: __PAY_TABLES_PATH_USED__ || null,
        resolvedZip: resolvedZip || null,
        routerPresent: !!ROUTER,
        routerError: ctx.routerError || null,
      },
    });
  } catch (err) {
    return respond(500, headers, {
      error: "Server exception",
      detail: String(err),
      debug: {
        usedSupabase,
        hasContextProfile: !!contextProfile,
        payTablesPathUsed: __PAY_TABLES_PATH_USED__ || null,
      },
    });
  }
};
