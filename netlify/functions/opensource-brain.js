// opensource-brain.js
// ============================================================
// PCSUnited • Open Source Brain
// v1.0.0
//
// PURPOSE
// - Safe next-generation orchestration layer for PCSUnited
// - Keeps legacy brain.js untouched
// - Uses modular official engines as source-of-truth
//
// DEPENDENCIES
// - baseline-profile.js
// - comp-engine.js
// - official-pay.js
// - official-bah.js
// - official-retirement.js
// - official-va.js
//
// DESIGN RULES
// - No hardcoded compensation math here
// - No rate authority lives here
// - No DOM/UI logic
// - No network fetch required
// - Read-only orchestration only
//
// PRIMARY JOBS
// - Normalize raw profile input
// - Route compensation calculations
// - Build reusable tool payloads for:
//   * PCS Snapshot
//   * FAD
//   * Ask-Elena
//   * AIOU
//   * future PCSUnited SaaS tools
// ============================================================

(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(
      require("./baseline-profile"),
      require("./comp-engine"),
      require("./official-pay"),
      require("./official-bah"),
      require("./official-retirement"),
      require("./official-va")
    );
  } else {
    root.PCSU_OPEN_BRAIN = factory(
      root.PCSU_BASELINE_PROFILE,
      root.PCSU_COMP_ENGINE,
      root.PCSU_OFFICIAL_PAY,
      root.PCSU_OFFICIAL_BAH,
      root.PCSU_OFFICIAL_RETIREMENT,
      root.PCSU_OFFICIAL_VA
    );
  }
})(typeof self !== "undefined" ? self : this, function (
  BASELINE_PROFILE,
  COMP_ENGINE,
  OFFICIAL_PAY,
  OFFICIAL_BAH,
  OFFICIAL_RETIREMENT,
  OFFICIAL_VA
) {
  "use strict";

  const BRAIN_VERSION = "pcsu-open-brain-1.0.0";

  // ============================================================
  // //#1) DEPENDENCY CHECKS
  // ============================================================
  function assertDependency(dep, name) {
    if (!dep || typeof dep !== "object") {
      throw new Error(`${name} is required but not loaded.`);
    }
  }

  assertDependency(BASELINE_PROFILE, "PCSU_BASELINE_PROFILE");
  assertDependency(COMP_ENGINE, "PCSU_COMP_ENGINE");
  assertDependency(OFFICIAL_PAY, "PCSU_OFFICIAL_PAY");
  assertDependency(OFFICIAL_BAH, "PCSU_OFFICIAL_BAH");
  assertDependency(OFFICIAL_RETIREMENT, "PCSU_OFFICIAL_RETIREMENT");
  assertDependency(OFFICIAL_VA, "PCSU_OFFICIAL_VA");

  // ============================================================
  // //#2) CONSTANTS
  // ============================================================
  const SUPPORTED_TOOLS = Object.freeze([
    "PCS_SNAPSHOT",
    "FAD",
    "ASK_ELENA",
    "AIOU",
    "GENERIC"
  ]);

  // ============================================================
  // //#3) HELPERS
  // ============================================================
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
    return SUPPORTED_TOOLS.includes(s) ? s : "GENERIC";
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

  // ============================================================
  // //#4) PROFILE + COMP PIPELINE
  // ============================================================
  function buildProfile(input) {
    return BASELINE_PROFILE.buildCanonicalProfile(input);
  }

  function getComp(input) {
    const profile = buildProfile(input);
    const compInput = BASELINE_PROFILE.toCompEngineInput(profile);
    const compensation = COMP_ENGINE.getCompensationProfile(compInput);

    return {
      profile,
      compensation,
      sourceVersions: sourceVersions()
    };
  }

  // ============================================================
  // //#5) TOOL-SPECIFIC BUILDERS
  // ============================================================
  function getActiveDutySnapshot(input) {
    const profile = buildProfile(input);
    if (profile.mode !== "ACTIVE_DUTY") {
      throw new Error("getActiveDutySnapshot() requires mode ACTIVE_DUTY.");
    }

    const compInput = BASELINE_PROFILE.toCompEngineInput(profile);
    const compensation = COMP_ENGINE.getActiveDutyComp(compInput);

    return {
      tool: "PCS_SNAPSHOT",
      lane: "ACTIVE_DUTY",
      profile,
      compensation,
      summary: buildSummaryFromComp(profile, compensation),
      housing: buildHousingBaseline(profile, compensation),
      financialInputs: buildFinancialInputs(profile),
      readiness: buildReadinessSignals(profile, compensation),
      sourceVersions: sourceVersions()
    };
  }

  function getVeteranSnapshot(input) {
    const profile = buildProfile(input);
    if (profile.mode !== "VETERAN") {
      throw new Error("getVeteranSnapshot() requires mode VETERAN.");
    }

    const compInput = BASELINE_PROFILE.toCompEngineInput(profile);
    const compensation = COMP_ENGINE.getCompensationProfile(compInput);

    return {
      tool: "PCS_SNAPSHOT",
      lane: compensation.lane,
      profile,
      compensation,
      summary: buildSummaryFromComp(profile, compensation),
      housing: buildHousingBaseline(profile, compensation),
      financialInputs: buildFinancialInputs(profile),
      readiness: buildReadinessSignals(profile, compensation),
      sourceVersions: sourceVersions()
    };
  }

  function getRetiredSnapshot(input) {
    const profile = buildProfile(input);
    if (profile.mode !== "RETIRED") {
      throw new Error("getRetiredSnapshot() requires mode RETIRED.");
    }

    const compInput = BASELINE_PROFILE.toCompEngineInput(profile);
    const compensation = COMP_ENGINE.getCompensationProfile(compInput);

    return {
      tool: "PCS_SNAPSHOT",
      lane: compensation.lane,
      profile,
      compensation,
      summary: buildSummaryFromComp(profile, compensation),
      housing: buildHousingBaseline(profile, compensation),
      financialInputs: buildFinancialInputs(profile),
      readiness: buildReadinessSignals(profile, compensation),
      sourceVersions: sourceVersions()
    };
  }

  // ============================================================
  // //#6) GENERIC TOOL PAYLOADS
  // ============================================================
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
        incomeMonthly:
          payload.readiness.totalIncome,
        baselineCompMonthly:
          round2(
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
        baselineMonthlyComp:
          round2(
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

  function getToolPayload(input, toolName) {
    const tool = inferToolName(toolName);
    const profile = buildProfile(input);
    const compInput = BASELINE_PROFILE.toCompEngineInput(profile);
    const compensation = COMP_ENGINE.getCompensationProfile(compInput);

    if (tool === "PCS_SNAPSHOT") {
      if (profile.mode === "ACTIVE_DUTY") {
        return getActiveDutySnapshot(input);
      }
      if (profile.mode === "VETERAN") {
        return getVeteranSnapshot(input);
      }
      return getRetiredSnapshot(input);
    }

    if (tool === "FAD") {
      return buildFadPayload(profile, compensation);
    }

    if (tool === "ASK_ELENA") {
      return buildAskElenaPayload(profile, compensation);
    }

    if (tool === "AIOU") {
      return buildAiouPayload(profile, compensation);
    }

    return buildGenericPayload(profile, compensation, "GENERIC");
  }

  // ============================================================
  // //#7) PUBLIC EXPORTS
  // ============================================================
  return Object.freeze({
    BRAIN_VERSION,
    SUPPORTED_TOOLS,
    sourceVersions,
    buildProfile,
    getComp,
    getActiveDutySnapshot,
    getVeteranSnapshot,
    getRetiredSnapshot,
    getToolPayload
  });
});
