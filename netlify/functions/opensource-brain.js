// netlify/functions/opensource-brain.js
// ============================================================
// PCSUnited • Open Source Brain
// Netlify Function Endpoint
// v1.1.0
//
// PURPOSE
// - Netlify serverless endpoint for PCSUnited compensation payloads
// - Uses modular official engines as source-of-truth
// - Returns tool-ready payloads for PCS Snapshot, FAD, Ask-Elena, AIOU
// ============================================================

const BASELINE_PROFILE = require("./baseline-profile");
const COMP_ENGINE = require("./comp-engine");
const OFFICIAL_PAY = require("./official-pay");
const OFFICIAL_BAH = require("./official-bah");
const OFFICIAL_RETIREMENT = require("./official-retirement");
const OFFICIAL_VA = require("./official-va");

const BRAIN_VERSION = "pcsu-open-brain-1.1.0";
const ALLOW_ORIGIN = "*";

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": ALLOW_ORIGIN,
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Methods": "POST,OPTIONS"
    },
    body: JSON.stringify(body)
  };
}

function normalizeString(value) {
  return String(value || "").trim();
}

function normalizeUpper(value) {
  return normalizeString(value).toUpperCase();
}

function toFiniteNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function round2(value) {
  return Number((Number(value) || 0).toFixed(2));
}

function inferToolName(toolName) {
  const s = normalizeUpper(toolName || "GENERIC");
  return ["PCS_SNAPSHOT", "FAD", "ASK_ELENA", "AIOU", "GENERIC"].includes(s)
    ? s
    : "GENERIC";
}

function sourceVersions() {
  return {
    brainVersion: BRAIN_VERSION,
    profileVersion: BASELINE_PROFILE.PROFILE_VERSION || null,
    compEngineVersion: COMP_ENGINE.ENGINE_VERSION || null,
    payVersion: OFFICIAL_PAY.RATE_VERSION || null,
    bahVersion: OFFICIAL_BAH.RATE_VERSION || null,
    retirementVersion: OFFICIAL_RETIREMENT.RATE_VERSION || null,
    vaVersion: OFFICIAL_VA.RATE_VERSION || null
  };
}

function buildSummaryFromComp(profile, compensation) {
  const mode = profile.mode;
  const monthly = (compensation && compensation.monthly) || {};

  const summary = {
    mode,
    headline: "",
    monthlyIncome: null,
    monthlyHousingAllowance: null,
    monthlyFoodAllowance: null,
    monthlyRetiredPay: null,
    monthlyVA: null,
    combinedMonthlyGross: null
  };

  if (mode === "ACTIVE_DUTY") {
    summary.monthlyIncome = round2(monthly.grossMonthlyComp || 0);
    summary.monthlyHousingAllowance = round2(monthly.bah || 0);
    summary.monthlyFoodAllowance = round2(monthly.bas || 0);
    summary.combinedMonthlyGross = round2(monthly.grossMonthlyComp || 0);
    summary.headline =
      `Estimated monthly active-duty compensation is $${summary.combinedMonthlyGross.toLocaleString()}.`;
    return summary;
  }

  if (compensation.lane === "VA_ONLY") {
    summary.monthlyVA = round2(monthly.vaCompensation || monthly.grossMonthlyComp || 0);
    summary.combinedMonthlyGross = round2(summary.monthlyVA);
    summary.headline =
      `Estimated monthly VA compensation is $${summary.monthlyVA.toLocaleString()}.`;
    return summary;
  }

  if (compensation.lane === "RETIREMENT_ONLY") {
    summary.monthlyRetiredPay = round2(monthly.retiredPayGross || monthly.grossMonthlyComp || 0);
    summary.combinedMonthlyGross = round2(summary.monthlyRetiredPay);
    summary.headline =
      `Estimated monthly retired pay is $${summary.monthlyRetiredPay.toLocaleString()}.`;
    return summary;
  }

  if (compensation.lane === "RETIRED_VETERAN") {
    summary.monthlyRetiredPay = round2(monthly.retiredPayGross || 0);
    summary.monthlyVA = round2(monthly.vaCompensation || 0);
    summary.combinedMonthlyGross = round2(monthly.combinedMonthlyGross || 0);
    summary.headline =
      `Estimated combined monthly retired pay and VA compensation is $${summary.combinedMonthlyGross.toLocaleString()}.`;
    return summary;
  }

  if (Number.isFinite(Number(monthly.grossMonthlyComp))) {
    summary.combinedMonthlyGross = round2(monthly.grossMonthlyComp);
    summary.headline =
      `Estimated monthly compensation is $${summary.combinedMonthlyGross.toLocaleString()}.`;
  }

  return summary;
}

function buildHousingBaseline(profile, compensation) {
  const monthly = (compensation && compensation.monthly) || {};
  const grossMonthly =
    monthly.combinedMonthlyGross ??
    monthly.grossMonthlyComp ??
    monthly.grossMonthlyCompRaw ??
    monthly.retiredPayGross ??
    monthly.vaCompensation ??
    0;

  const gross = round2(grossMonthly);
  const safeHousingTarget = round2(gross * 0.30);
  const stretchHousingTarget = round2(gross * 0.35);

  return {
    base: profile.currentBase || profile.newBase || "",
    grossMonthlyIncomeForHousing: gross,
    safeHousingTarget,
    stretchHousingTarget
  };
}

function buildFinancialInputs(profile) {
  return {
    additionalIncome: round2(profile.additionalIncome || 0),
    monthlyExpenses: round2(profile.monthlyExpenses || 0),
    monthlyDebt: round2(profile.monthlyDebt || 0),
    downpayment: round2(profile.downpayment || 0),
    projectedHomePrice: round2(profile.projectedHomePrice || 0),
    creditScore: toFiniteNumber(profile.creditScore, 0)
  };
}

function buildReadinessSignals(profile, compensation) {
  const financial = buildFinancialInputs(profile);
  const monthly = (compensation && compensation.monthly) || {};

  const gross =
    monthly.combinedMonthlyGross ??
    monthly.grossMonthlyComp ??
    monthly.retiredPayGross ??
    monthly.vaCompensation ??
    0;

  const totalIncome = round2((gross || 0) + (financial.additionalIncome || 0));
  const totalExpenses = round2(
    (financial.monthlyExpenses || 0) + (financial.monthlyDebt || 0)
  );
  const residual = round2(totalIncome - totalExpenses);

  let readiness = "UNKNOWN";
  if (totalIncome <= 0) readiness = "NEEDS_INPUTS";
  else if (residual < 0) readiness = "AT_RISK";
  else if (residual < 500) readiness = "TIGHT";
  else if (residual < 1500) readiness = "STABLE";
  else readiness = "STRONG";

  return {
    totalIncome,
    totalExpenses,
    residual,
    readiness
  };
}

function buildGenericPayload(profile, compensation, tool) {
  return {
    tool,
    profile,
    compensation,
    summary: buildSummaryFromComp(profile, compensation),
    housing: buildHousingBaseline(profile, compensation),
    financialInputs: buildFinancialInputs(profile),
    readiness: buildReadinessSignals(profile, compensation),
    sourceVersions: sourceVersions()
  };
}

function buildFadPayload(profile, compensation) {
  const payload = buildGenericPayload(profile, compensation, "FAD");

  return Object.assign({}, payload, {
    fad: {
      incomeMonthly: payload.readiness.totalIncome,
      baselineCompMonthly: round2(
        (compensation.monthly && (
          compensation.monthly.combinedMonthlyGross ??
          compensation.monthly.grossMonthlyComp ??
          compensation.monthly.retiredPayGross ??
          compensation.monthly.vaCompensation
        )) || 0
      ),
      additionalIncomeMonthly: payload.financialInputs.additionalIncome,
      monthlyExpenses: payload.financialInputs.monthlyExpenses,
      monthlyDebt: payload.financialInputs.monthlyDebt,
      projectedHomePrice: payload.financialInputs.projectedHomePrice,
      downpayment: payload.financialInputs.downpayment,
      creditScore: payload.financialInputs.creditScore
    }
  });
}

function buildAskElenaPayload(profile, compensation) {
  const payload = buildGenericPayload(profile, compensation, "ASK_ELENA");

  return Object.assign({}, payload, {
    askElena: {
      bluf: payload.summary.headline,
      mode: profile.mode,
      rank: profile.rank,
      yearsOfService: profile.yearsOfService,
      currentBase: profile.currentBase,
      newBase: profile.newBase,
      dependents: profile.dependents,
      readiness: payload.readiness.readiness,
      residual: payload.readiness.residual,
      housingSafeTarget: payload.housing.safeHousingTarget,
      housingStretchTarget: payload.housing.stretchHousingTarget
    }
  });
}

function buildAiouPayload(profile, compensation) {
  const payload = buildGenericPayload(profile, compensation, "AIOU");

  return Object.assign({}, payload, {
    aiou: {
      mode: profile.mode,
      rank: profile.rank,
      yearsOfService: profile.yearsOfService,
      baselineMonthlyComp: round2(
        (compensation.monthly && (
          compensation.monthly.combinedMonthlyGross ??
          compensation.monthly.grossMonthlyComp ??
          compensation.monthly.retiredPayGross ??
          compensation.monthly.vaCompensation
        )) || 0
      ),
      base: profile.currentBase || profile.newBase || "",
      dependents: profile.dependents
    }
  });
}

function buildPayload(input, toolName) {
  const tool = inferToolName(toolName);
  const profile = BASELINE_PROFILE.buildCanonicalProfile(input);
  const compInput = BASELINE_PROFILE.toCompEngineInput(profile);
  const compensation = COMP_ENGINE.getCompensationProfile(compInput);

  if (tool === "FAD") {
    return buildFadPayload(profile, compensation);
  }

  if (tool === "ASK_ELENA") {
    return buildAskElenaPayload(profile, compensation);
  }

  if (tool === "AIOU") {
    return buildAiouPayload(profile, compensation);
  }

  return buildGenericPayload(profile, compensation, tool);
}

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") {
    return json(200, { ok: true });
  }

  if (event.httpMethod !== "POST") {
    return json(405, {
      ok: false,
      error: "Method not allowed. Use POST."
    });
  }

  try {
    const body = JSON.parse(event.body || "{}");
    const input = body.input || body;
    const toolName = body.tool || "GENERIC";

    const payload = buildPayload(input, toolName);

    return json(200, {
      ok: true,
      payload
    });
  } catch (err) {
    return json(400, {
      ok: false,
      error: err && err.message ? err.message : "Unknown error"
    });
  }
};
