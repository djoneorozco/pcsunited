// netlify/functions/elena-agent.js
// ============================================================
// PCSUnited • Agentic Elena — elena-agent (Orchestrator)
// v1.0.0 (2026-02-06)
//
// ✅ Purpose:
// - Deterministic orchestration layer for Ask Elena
// - Pulls profile + brain + mortgage via your existing PCSUnited APIs
// - Computes verdict (GREEN/CAUTION/NO-GO) deterministically
// - Returns a single "truth packet" (inputs_used + receipts + next_action)
//
// ✅ Design Principles:
// - NO LLM required here
// - NO "AI math" (only deterministic rules)
// - Safe fallbacks + explicit "sources"
// -Toggle-friendly: HUD can render directly or forward payload into ask-elena for narration
//
// INPUT (POST JSON):
// {
//   email: "user@email.com",                // required
//   question?: "can I afford ...",          // optional (tagging only)
//   overrides?: {                           // optional scenario overrides
//     price?: number,
//     expenses?: number,
//     downpayment?: number,
//     creditScore?: number,
//     termYears?: number,
//     loanType?: string,
//     cityKey?: string,
//     bedrooms?: number
//   },
//   scenario?: { ... }                      // optional baseline scenario (bridge-like)
// }
//
// OUTPUT (JSON):
// {
//   ok: true,
//   scenario_id: "elena_...",
//   ts: 1700000000,
//   email: "...",
//   inputs_used: {...},
//   mortgage: {...},
//   verdict: {...},
//   next_action: {...},
//   debug?: {...}
// }
//
// ============================================================

/* eslint-disable no-console */

const crypto = require("crypto");

// ------------------------------
// //#1 CORS + ORIGIN CONTROL
// ------------------------------
const ALLOW_ORIGINS = [
  // Webflow (PCSUnited)
  "https://pcsunited.webflow.io",
  "https://www.pcsunited.webflow.io",

  // Legacy / staging (if you still embed from here)
  "https://new-real-estate-purchase.webflow.io",
  "https://www.new-real-estate-purchase.webflow.io",

  // Netlify (PCSUnited)
  "https://pcsunited.netlify.app",
  "https://www.pcsunited.netlify.app",

  // Legacy Netlify (if any older embeds still call from here)
  "https://theorozcorealty.netlify.app",
  "https://www.theorozcorealty.netlify.app",
];

function corsHeaders(origin) {
  const allowOrigin = ALLOW_ORIGINS.includes(origin) ? origin : "*";
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Headers": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
    "Vary": "Origin",
  };
}

function respond(statusCode, payload, origin) {
  return {
    statusCode,
    headers: corsHeaders(origin),
    body: JSON.stringify(payload),
  };
}

// ------------------------------
// //#2 HELPERS
// ------------------------------
function safeJsonParse(raw) {
  try {
    return JSON.parse(raw || "{}");
  } catch {
    return {};
  }
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function clamp(n, lo, hi) {
  if (!Number.isFinite(n)) return n;
  return Math.max(lo, Math.min(hi, n));
}

function roundTo(n, step) {
  if (!Number.isFinite(n)) return n;
  return Math.round(n / step) * step;
}

function nowTs() {
  return Math.floor(Date.now() / 1000);
}

function makeScenarioId(email, ts) {
  const h = crypto.createHash("sha256").update(String(email || "") + ":" + String(ts)).digest("hex");
  return "elena_" + h.slice(0, 16);
}

// Prefer explicit env var if you ever want to route to a different Netlify site.
// Otherwise, default to PCSUnited Netlify.
function pickApiBase(event) {
  const env = process.env.PCSU_API_BASE || process.env.API_BASE;
  if (env) return env.replace(/\/$/, "");

  // If called from Webflow, we still want PCSUnited Netlify as the API origin.
  // This matches your existing pattern for *.webflow.io embeds.
  return "https://pcsunited.netlify.app";
}

async function postJSON(url, payload, timeoutMs = 12000) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload || {}),
      signal: controller.signal,
    });
    const text = await res.text();
    const data = safeJsonParse(text);

    return { ok: res.ok, status: res.status, data };
  } catch (e) {
    return { ok: false, status: 0, data: { error: String(e?.message || e) } };
  } finally {
    clearTimeout(t);
  }
}

function pickFirst(...vals) {
  for (const v of vals) {
    if (v !== undefined && v !== null && v !== "" && !(typeof v === "number" && !Number.isFinite(v))) return v;
  }
  return null;
}

// ------------------------------
// //#3 NORMALIZE INPUTS
// ------------------------------
function normalizeEmail(emailRaw) {
  const e = String(emailRaw || "").trim().toLowerCase();
  if (!e || !e.includes("@")) return "";
  return e;
}

function buildScenario(body) {
  const scenario = body?.scenario && typeof body.scenario === "object" ? body.scenario : {};
  const overrides = body?.overrides && typeof body.overrides === "object" ? body.overrides : {};

  // Accept a few legacy-ish keys if they come in (helps during migration)
  const legacy = body?.bridge && typeof body.bridge === "object" ? body.bridge : {};

  // Canonical numeric inputs
  const price =
    num(pickFirst(overrides.price, scenario.price, scenario.housingPrice, legacy.price, legacy.housingPrice, legacy.housingOverride)) ??
    null;

  const expenses =
    num(pickFirst(overrides.expenses, scenario.expenses, scenario.monthlyExpenses, legacy.expenses, legacy.expensesOverride)) ??
    null;

  const downpayment =
    num(pickFirst(overrides.downpayment, scenario.downpayment, scenario.dpAmt, legacy.dpAmt, legacy.downpayment, legacy.savingsOverride)) ??
    null;

  const creditScoreRaw = num(pickFirst(overrides.creditScore, scenario.creditScore, legacy.creditScore, legacy.credit_score));
  const creditScore = creditScoreRaw ? clamp(Math.round(creditScoreRaw), 300, 850) : null;

  const termYearsRaw = num(pickFirst(overrides.termYears, scenario.termYears, legacy.termYears));
  const termYears = termYearsRaw ? clamp(Math.round(termYearsRaw), 10, 40) : 30;

  const loanType = String(pickFirst(overrides.loanType, scenario.loanType, legacy.loanType, "va") || "va").toLowerCase();

  const cityKey = pickFirst(overrides.cityKey, scenario.cityKey, legacy.cityKey) || null;
  const bedroomsRaw = num(pickFirst(overrides.bedrooms, scenario.bedrooms, legacy.bedrooms));
  const bedrooms = bedroomsRaw ? clamp(Math.round(bedroomsRaw), 0, 12) : null;

  // Identity-ish / profile-ish fields (for brain)
  const rank = pickFirst(scenario.rank, legacy.rank) || null;
  const yosRaw = num(pickFirst(scenario.yos, legacy.yos));
  const yos = yosRaw ? clamp(Math.round(yosRaw), 0, 40) : null;
  const base = pickFirst(scenario.base, legacy.base) || null;
  const family = pickFirst(scenario.family, legacy.family);
  const familyBool = family === true || family === "true" || family === 1 || family === "1";

  const mode = String(pickFirst(scenario.mode, legacy.mode, "active") || "active").toLowerCase();
  const va_disability = num(pickFirst(scenario.va_disability, legacy.va_disability, scenario.va, legacy.va));

  return {
    question: String(body?.question || "").trim() || null,
    overrides,
    baseline: scenario,
    legacy,
    // canonical inputs
    price,
    expenses,
    downpayment,
    creditScore,
    termYears,
    loanType,
    cityKey,
    bedrooms,
    // profile hints
    rank,
    yos,
    base,
    family: familyBool,
    mode,
    va_disability,
  };
}

// ------------------------------
// //#4 VERDICT ENGINE (DETERMINISTIC)
// ------------------------------
function computeVerdict({ income, expenses, housingAllIn }) {
  const inc = Number.isFinite(income) ? income : null;
  const exp = Number.isFinite(expenses) ? expenses : 0;
  const hou = Number.isFinite(housingAllIn) ? housingAllIn : null;

  if (!inc || !hou) {
    return {
      status: "INSUFFICIENT",
      grade: "N/A",
      housingCap: null,
      ratios: { housingRatio: null, expenseRatio: inc ? exp / inc : null },
      residual: null,
      notes: ["Missing income or mortgage estimate; cannot compute a defensible verdict."],
    };
  }

  // Housing affordability cap (your canonical 30% rule)
  const housingCap = inc * 0.30;
  const housingRatio = hou / inc;

  const residual = inc - exp - hou;

  // Cushion thresholds (tunable)
  const cushionLow = inc * 0.05; // 5% of income
  const cushionGood = inc * 0.12; // 12% of income

  let status = "GREEN";
  const notes = [];

  if (residual < 0) {
    status = "NO-GO";
    notes.push("Residual income is negative after expenses + housing.");
  } else if (hou > housingCap) {
    status = "NO-GO";
    notes.push("Housing cost exceeds the 30% housing cap.");
  } else if (residual < cushionLow) {
    status = "CAUTION";
    notes.push("Buffer is thin after expenses + housing.");
  }

  // Grade (simple, readable, deterministic)
  // You can refine later, but this is stable and transparent.
  let grade = "B";
  if (status === "NO-GO") grade = "D";
  else if (status === "CAUTION") grade = "C+";
  else {
    if (housingRatio <= 0.25 && residual >= cushionGood) grade = "A";
    else if (housingRatio <= 0.28 && residual >= cushionLow) grade = "A-";
    else if (housingRatio <= 0.30 && residual >= cushionLow) grade = "B+";
    else grade = "B";
  }

  return {
    status,
    grade,
    housingCap: Math.round(housingCap),
    ratios: { housingRatio, expenseRatio: exp / inc },
    residual: Math.round(residual),
    notes,
  };
}

function pickNextAction({ verdict, income, expenses, price, downpayment, housingAllIn }) {
  if (!verdict || verdict.status === "INSUFFICIENT") {
    return {
      type: "collect_missing_inputs",
      target: null,
      why: "Need complete inputs (income + mortgage estimate) to produce a defensible recommendation.",
    };
  }

  // If NO-GO, lead with the lever that most directly fixes it.
  if (verdict.status === "NO-GO") {
    // 1) If price exists and we have current all-in, compute a target price to fit cap.
    if (Number.isFinite(price) && price > 0 && Number.isFinite(housingAllIn) && housingAllIn > 0 && Number.isFinite(verdict.housingCap)) {
      const cap = verdict.housingCap;
      const ratio = cap / housingAllIn;
      const targetPrice = roundTo(price * ratio, 1000);

      return {
        type: "lower_price",
        target: {
          current_price: Math.round(price),
          target_price: Math.max(0, Math.round(targetPrice)),
          target_housing_cap: Math.round(cap),
        },
        why: "Brings estimated all-in housing closer to the 30% cap using your current scenario as the baseline.",
      };
    }

    // 2) Otherwise reduce expenses to create cushion.
    if (Number.isFinite(income) && Number.isFinite(expenses) && Number.isFinite(housingAllIn)) {
      const required = Math.max(0, housingAllIn + expenses - (income - income * 0.05));
      const targetCut = roundTo(required, 50);
      return {
        type: "reduce_expenses",
        target: {
          current_expenses: Math.round(expenses),
          suggested_cut: Math.round(targetCut),
        },
        why: "Creates at least a small 5% buffer after housing + expenses.",
      };
    }

    return {
      type: "adjust_scenario",
      target: null,
      why: "Reduce price, increase downpayment, or lower expenses to reach a stable buffer.",
    };
  }

  // If CAUTION: try to build buffer.
  if (verdict.status === "CAUTION") {
    if (Number.isFinite(income) && Number.isFinite(expenses) && Number.isFinite(housingAllIn)) {
      const targetResidual = income * 0.10; // aim 10% buffer
      const needed = Math.max(0, targetResidual - (income - expenses - housingAllIn));
      const targetCut = roundTo(needed, 50);

      if (targetCut > 0) {
        return {
          type: "increase_buffer",
          target: {
            target_residual: Math.round(targetResidual),
            suggested_monthly_improvement: Math.round(targetCut),
          },
          why: "Moves you toward a healthier buffer so small surprises don’t flip the verdict.",
        };
      }
    }

    return {
      type: "raise_downpayment_or_lower_price",
      target: null,
      why: "Small adjustments can move you from CAUTION to GREEN.",
    };
  }

  // GREEN: next action is usually execution readiness.
  return {
    type: "lock_in_plan",
    target: null,
    why: "You’re in a stable range—next step is choosing the right plan (timeline, pre-approval, and guardrails).",
  };
}

// ------------------------------
// //#5 MAIN HANDLER
// ------------------------------
exports.handler = async (event) => {
  const origin = event.headers?.origin || event.headers?.Origin || "";

  // OPTIONS preflight
  if (event.httpMethod === "OPTIONS") {
    return respond(200, { ok: true }, origin);
  }

  if (event.httpMethod !== "POST") {
    return respond(405, { ok: false, error: "Method not allowed. Use POST." }, origin);
  }

  const body = safeJsonParse(event.body);
  const email = normalizeEmail(body.email);

  if (!email) {
    return respond(400, { ok: false, error: "Missing or invalid email." }, origin);
  }

  const API_BASE = pickApiBase(event);

  // Build scenario from request (baseline + overrides)
  const sc = buildScenario(body);

  // ------------------------------------------------------------
  // //#5A Fetch profile (only if missing key fields for brain)
  // ------------------------------------------------------------
  let profile = null;
  let profileSource = "none";
  const needProfile = !sc.rank || sc.yos === null || !sc.base;

  if (needProfile) {
    const r = await postJSON(`${API_BASE}/api/profile-by-email`, { email });
    if (r.ok && r.data) {
      profile = r.data?.profile || r.data; // tolerate different shapes
      profileSource = "api/profile-by-email";
    } else {
      profileSource = "api/profile-by-email:failed";
    }
  }

  // Merge profile fields into scenario hints (scenario still wins if provided)
  const rank = pickFirst(sc.rank, profile?.rank, profile?.rank_paygrade) || null;
  const yos = num(pickFirst(sc.yos, profile?.yos));
  const base = pickFirst(sc.base, profile?.base) || null;
  const family = sc.family ?? (profile?.family === true);
  const mode = pickFirst(sc.mode, profile?.mode, "active") || "active";
  const va_disability = num(pickFirst(sc.va_disability, profile?.va_disability));

  // ------------------------------------------------------------
  // //#5B Brain (income + city baselines)
  // ------------------------------------------------------------
  const brainPayload = {
    rank,
    yos: Number.isFinite(yos) ? yos : undefined,
    base,
    family: !!family,
    mode,
    va_disability: Number.isFinite(va_disability) ? va_disability : undefined,
    cityKey: sc.cityKey || undefined,
    bedrooms: Number.isFinite(sc.bedrooms) ? sc.bedrooms : undefined,
    email, // harmless; allows server to log/trace if desired
  };

  const brainRes = await postJSON(`${API_BASE}/api/brain`, brainPayload);
  const brain = brainRes.ok ? brainRes.data : null;

  // Income preference: brain.pay.total (your canonical preference) else scenario baseline if provided
  const brainPayTotal =
    num(
      pickFirst(
        brain?.pay?.total,
        brain?.pay?.monthlyTotal,
        brain?.income?.total,
        brain?.income_total,
        brain?.totalPay
      )
    ) ?? null;

  const incomeFromScenario =
    num(pickFirst(sc.baseline?.income, sc.legacy?.income, sc.baseline?.monthlyIncome, sc.legacy?.monthlyIncome)) ?? null;

  const income = brainPayTotal ?? incomeFromScenario;

  const incomeSource = brainPayTotal ? "api/brain" : (incomeFromScenario ? "scenario" : "missing");

  // ------------------------------------------------------------
  // //#5C Mortgage (all-in + breakdown)
  // ------------------------------------------------------------
  const price = sc.price;
  const down = sc.downpayment;
  const creditScore = sc.creditScore;

  // Mortgage defaults from brain if available
  const taxRate = num(pickFirst(sc.baseline?.taxRate, brain?.city?.taxRate, brain?.rates?.taxRate));
  const taxAnnual = num(pickFirst(sc.baseline?.taxAnnual, brain?.city?.taxAnnual, brain?.rates?.taxAnnual));
  const insuranceAnnual = num(pickFirst(sc.baseline?.insuranceAnnual, brain?.city?.insuranceAnnual, brain?.rates?.insuranceAnnual));
  const hoaMonthly = num(pickFirst(sc.baseline?.hoaMonthly, brain?.city?.hoaMonthly, brain?.rates?.hoaMonthly));

  const mortgagePayload = {
    price: Number.isFinite(price) ? price : undefined,
    down: Number.isFinite(down) ? down : undefined,
    creditScore: Number.isFinite(creditScore) ? creditScore : undefined,
    termYears: sc.termYears,
    loanType: sc.loanType,
    taxRate: Number.isFinite(taxRate) ? taxRate : undefined,
    taxAnnual: Number.isFinite(taxAnnual) ? taxAnnual : undefined,
    insuranceAnnual: Number.isFinite(insuranceAnnual) ? insuranceAnnual : undefined,
    hoaMonthly: Number.isFinite(hoaMonthly) ? hoaMonthly : undefined,
    // aprOverride optional if you later add it
  };

  let mortgage = null;
  let mortgageSource = "missing";

  if (!Number.isFinite(price) || !Number.isFinite(down) || !Number.isFinite(creditScore)) {
    mortgageSource = "insufficient_inputs_for_mortgage";
  } else {
    const mortRes = await postJSON(`${API_BASE}/api/mortgage`, mortgagePayload);
    if (mortRes.ok && mortRes.data) {
      mortgage = mortRes.data;
      mortgageSource = "api/mortgage";
    } else {
      mortgageSource = "api/mortgage:failed";
    }
  }

  // Attempt to extract all-in mortgage from known shapes
  const housingAllIn =
    num(
      pickFirst(
        mortgage?.allInMonthly,
        mortgage?.all_in_monthly,
        mortgage?.monthlyAllIn,
        mortgage?.payment?.allIn,
        mortgage?.payment?.all_in,
        mortgage?.totalMonthly
      )
    ) ?? null;

  const breakdown = {
    principal: num(pickFirst(mortgage?.breakdown?.principal, mortgage?.principal)) ?? null,
    interest: num(pickFirst(mortgage?.breakdown?.interest, mortgage?.interest)) ?? null,
    taxes: num(pickFirst(mortgage?.breakdown?.taxes, mortgage?.taxes, mortgage?.tax)) ?? null,
    insurance: num(pickFirst(mortgage?.breakdown?.insurance, mortgage?.insurance)) ?? null,
    pmi: num(pickFirst(mortgage?.breakdown?.pmi, mortgage?.pmi)) ?? null,
    hoa: num(pickFirst(mortgage?.breakdown?.hoa, mortgage?.hoa)) ?? null,
  };

  // ------------------------------------------------------------
  // //#5D Verdict + Next Action
  // ------------------------------------------------------------
  const verdict = computeVerdict({
    income,
    expenses: sc.expenses,
    housingAllIn,
  });

  const next_action = pickNextAction({
    verdict,
    income,
    expenses: sc.expenses,
    price,
    downpayment: down,
    housingAllIn,
  });

  // ------------------------------------------------------------
  // //#5E Assemble Agent Payload
  // ------------------------------------------------------------
  const ts = nowTs();
  const scenario_id = makeScenarioId(email, ts);

  const inputs_used = {
    income: Number.isFinite(income) ? Math.round(income) : null,
    expenses: Number.isFinite(sc.expenses) ? Math.round(sc.expenses) : null,
    price: Number.isFinite(price) ? Math.round(price) : null,
    downpayment: Number.isFinite(down) ? Math.round(down) : null,
    creditScore: Number.isFinite(creditScore) ? creditScore : null,
    termYears: sc.termYears,
    loanType: sc.loanType,
    sources: {
      email: "request",
      profile: profileSource,
      income: incomeSource,
      expenses: sc.expenses !== null ? "scenario/overrides" : "missing",
      price: Number.isFinite(price) ? "scenario/overrides" : "missing",
      downpayment: Number.isFinite(down) ? "scenario/overrides" : "missing",
      creditScore: Number.isFinite(creditScore) ? "scenario/overrides" : "missing",
      mortgage: mortgageSource,
    },
  };

  const payload = {
    ok: true,
    scenario_id,
    ts,
    email,
    intent: sc.question ? "user_question" : "affordability_check",
    inputs_used,
    mortgage: {
      all_in_monthly: Number.isFinite(housingAllIn) ? Math.round(housingAllIn) : null,
      breakdown,
      raw: mortgage ? undefined : null, // keep small; do not ship raw by default
      source: mortgageSource,
    },
    verdict,
    next_action,
    // If you want to forward this into /api/ask-elena, include a compact context:
    context: {
      profile: profile ? {
        rank: profile?.rank || null,
        yos: profile?.yos ?? null,
        base: profile?.base || null,
        family: profile?.family ?? null,
        mode: profile?.mode || null,
        va_disability: profile?.va_disability ?? null,
      } : null,
      brain_ok: !!brainRes.ok,
      mortgage_ok: !!mortgage,
    },
  };

  // Optional debug (enable by sending ?debug=1 or body.debug=true)
  const debugEnabled =
    body?.debug === true ||
    (event.queryStringParameters && (event.queryStringParameters.debug === "1" || event.queryStringParameters.debug === "true"));

  if (debugEnabled) {
    payload.debug = {
      API_BASE,
      brainStatus: brainRes.status,
      mortgagePayloadSent: mortgagePayload,
      brainPayloadSent: brainPayload,
      profileFetched: !!profile,
    };
  }

  return respond(200, payload, origin);
};
