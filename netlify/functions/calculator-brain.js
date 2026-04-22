// netlify/functions/calculator-brain.js
// ============================================================
// PCSUnited • Calculator Brain
// Netlify Function Endpoint
// v1.0.0
//
// PURPOSE
// - Calculator-only serverless endpoint for PCSUnited quick calculators
// - Does NOT use baseline-profile.js
// - Uses comp-engine.js + official modules as source-of-truth
// - Supports modular calculator lanes for:
//   * BAH_BASE_PAY
//   * RETIREMENT
//   * VA_DISABILITY
//   * RETIREMENT_VA
//
// BASIC CALCULATOR FLOW
// - Webflow UI → calculator-brain.js → comp-engine.js
//   → official-bah / official-pay / official-va / official-retirement
// ============================================================

const COMP_ENGINE = require("./comp-engine");
const OFFICIAL_PAY = require("./official-pay");
const OFFICIAL_BAH = require("./official-bah");
const OFFICIAL_RETIREMENT = require("./official-retirement");
const OFFICIAL_VA = require("./official-va");

const BRAIN_VERSION = "pcsu-calculator-brain-1.0.0";
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

function toInteger(value, fallback) {
  const n = parseInt(String(value == null ? "" : value).replace(/[^\d-]/g, ""), 10);
  return Number.isFinite(n) ? n : fallback;
}

function round2(value) {
  return Number((Number(value) || 0).toFixed(2));
}

function inferToolName(toolName) {
  const s = normalizeUpper(toolName || "GENERIC");
  return [
    "BAH_BASE_PAY",
    "RETIREMENT",
    "VA_DISABILITY",
    "RETIREMENT_VA",
    "GENERIC"
  ].includes(s)
    ? s
    : "GENERIC";
}

function sourceVersions() {
  return {
    brainVersion: BRAIN_VERSION,
    compEngineVersion: COMP_ENGINE.ENGINE_VERSION || null,
    payVersion: OFFICIAL_PAY.RATE_VERSION || null,
    bahVersion: OFFICIAL_BAH.RATE_VERSION || null,
    retirementVersion: OFFICIAL_RETIREMENT.RATE_VERSION || null,
    vaVersion: OFFICIAL_VA.RATE_VERSION || null
  };
}

function normalizeRank(rank) {
  const s = normalizeUpper(rank);
  const m = s.match(/^([EOW])\s*[-]?\s*(\d)(E)?$/);

  if (!m) return s.replace(/\s+/g, "");

  return `${m[1]}-${m[2]}${m[3] ? "E" : ""}`;
}

function normalizeMode(mode) {
  const s = normalizeUpper(mode);

  if (["AD", "ACTIVE_DUTY", "ACTIVE DUTY"].includes(s)) return "ACTIVE_DUTY";
  if (["VETERAN", "VET"].includes(s)) return "VETERAN";
  if (["RETIRED", "RETIREE"].includes(s)) return "RETIRED";

  return s;
}

function normalizeRetirementSystem(retirementSystem) {
  const s = normalizeUpper(retirementSystem);

  if (s === "HIGH3" || s === "HIGH-3" || s === "HIGH 3") return "HIGH3";
  if (s === "BRS") return "BRS";

  return s || "HIGH3";
}

function normalizeDependents(input) {
  const s = normalizeUpper(input);
  return ["TRUE", "1", "YES", "Y", "WITH", "WITH_DEPENDENTS", "DEPENDENTS", "HAS_DEPENDENTS"].includes(s)
    ? "with"
    : "without";
}

function canonicalizeBase(base) {
  const raw = normalizeString(base);

  const aliases = {
    "JBSA-LACKLAND": "Lackland AFB",
    "JBSA LACKLAND": "Lackland AFB",
    "LACKLAND": "Lackland AFB",
    "LACKLAND AFB": "Lackland AFB",

    "JBSA-RANDOLPH": "Randolph AFB",
    "JBSA RANDOLPH": "Randolph AFB",
    "RANDOLPH": "Randolph AFB",
    "RANDOLPH AFB": "Randolph AFB",

    "JBSA-FORT SAM HOUSTON": "Fort-Sam-Houston AFB",
    "JBSA-FORT-SAM-HOUSTON": "Fort-Sam-Houston AFB",
    "FORT SAM HOUSTON": "Fort-Sam-Houston AFB",
    "FORT-SAM-HOUSTON": "Fort-Sam-Houston AFB",

    "DAVIS-MONTHAN": "Davis-Monthan AFB",
    "DAVIS MONTHAN": "Davis-Monthan AFB",
    "DAVIS-MONTHAN AFB": "Davis-Monthan AFB",
    "DMAFB": "Davis-Monthan AFB",

    "NELLIS": "Nellis AFB",
    "NELLIS AFB": "Nellis AFB",

    "ANDREWS": "Andrews AFB",
    "ANDREWS AFB": "Andrews AFB",

    "LUKE": "Luke AFB",
    "LUKE AFB": "Luke AFB",

    "TRAVIS": "Travis AFB",
    "TRAVIS AFB": "Travis AFB",

    "PETERSON": "Peterson AFB",
    "PETERSON AFB": "Peterson AFB",
    "PETERSON SFB": "Peterson AFB",

    "LANGLEY": "Langley AFB",
    "LANGLEY AFB": "Langley AFB",

    "MACDILL": "MacDill AFB",
    "MACDILL AFB": "MacDill AFB",

    "OFFUTT": "Offutt AFB",
    "OFFUTT AFB": "Offutt AFB"
  };

  return aliases[normalizeUpper(raw)] || raw;
}

function rankTitle(rank) {
  const map = {
    "E-1": "Airman Basic",
    "E-2": "Airman",
    "E-3": "Airman First Class",
    "E-4": "Senior Airman",
    "E-5": "Staff Sergeant",
    "E-6": "Technical Sergeant",
    "E-7": "Master Sergeant",
    "E-8": "Senior Master Sergeant",
    "E-9": "Chief Master Sergeant",
    "W-1": "Warrant Officer 1",
    "W-2": "Chief Warrant Officer 2",
    "W-3": "Chief Warrant Officer 3",
    "W-4": "Chief Warrant Officer 4",
    "W-5": "Chief Warrant Officer 5",
    "O-1": "Second Lieutenant",
    "O-2": "First Lieutenant",
    "O-3": "Captain",
    "O-4": "Major",
    "O-5": "Lieutenant Colonel",
    "O-6": "Colonel",
    "O-7": "Brigadier General"
  };

  return map[rank] || rank;
}

function profileFromBahBasePayInput(input) {
  return {
    mode: "ACTIVE_DUTY",
    rank: normalizeRank(input.rank || "E-5"),
    yearsOfService: toFiniteNumber(input.yos ?? input.yearsOfService, 0),
    currentBase: canonicalizeBase(input.base || input.currentBase || input.current_base || ""),
    dependents: normalizeDependents(input.dependents ?? input.family ?? input.hasDependents)
  };
}

function profileFromRetirementInput(input) {
  return {
    mode: "RETIRED",
    rank: normalizeRank(input.rank || "E-6"),
    yearsOfService: toFiniteNumber(input.yos ?? input.yearsOfService, 20),
    retirementSystem: normalizeRetirementSystem(input.retirementSystem || input.retirement_system),
    monthlyBasicPayAtRetirement: null
  };
}

function profileFromVAInput(input) {
  return {
    mode: "VETERAN",
    vaRating: toInteger(input.vaRating ?? input.va_rating ?? input.rating, 0),
    spouse: !!input.spouse,
    dependentParents: toInteger(input.dependentParents ?? input.dependent_parents, 0),
    childrenUnder18: toInteger(input.childrenUnder18 ?? input.children_under_18, 0),
    childrenInSchoolOver18: toInteger(input.childrenInSchoolOver18 ?? input.children_in_school_over_18, 0)
  };
}

function profileFromRetirementVAInput(input) {
  const retirement = profileFromRetirementInput(input);
  const va = profileFromVAInput(input);

  return Object.assign({}, retirement, va, {
    mode: "RETIRED"
  });
}

function enrichRetirementPayBasis(profile) {
  const enriched = Object.assign({}, profile);

  if (
    (enriched.mode === "RETIRED" || enriched.mode === "VETERAN") &&
    !Number.isFinite(Number(enriched.monthlyBasicPayAtRetirement)) &&
    Array.isArray(enriched.high36MonthlyArray) !== true
  ) {
    const payRecord = OFFICIAL_PAY.getPayRecord2026(
      enriched.rank,
      enriched.yearsOfService
    );

    enriched.monthlyBasicPayAtRetirement = round2(payRecord.basicPayMonthly || 0);
  }

  return enriched;
}

function toCompEngineInput(profile, tool) {
  if (tool === "BAH_BASE_PAY") {
    return {
      mode: "ACTIVE_DUTY",
      rank: profile.rank,
      yos: profile.yearsOfService,
      yearsOfService: profile.yearsOfService,
      base: profile.currentBase,
      dependents: profile.dependents
    };
  }

  if (tool === "RETIREMENT") {
    return {
      mode: "RETIRED",
      retirementSystem: profile.retirementSystem,
      yos: profile.yearsOfService,
      yearsOfService: profile.yearsOfService,
      monthlyBasicPayAtRetirement: profile.monthlyBasicPayAtRetirement,
      high36MonthlyArray: Array.isArray(profile.high36MonthlyArray) ? profile.high36MonthlyArray : undefined
    };
  }

  if (tool === "VA_DISABILITY") {
    return {
      mode: "VETERAN",
      vaRating: profile.vaRating,
      spouse: !!profile.spouse,
      dependentParents: toInteger(profile.dependentParents, 0),
      childrenUnder18: toInteger(profile.childrenUnder18, 0),
      childrenInSchoolOver18: toInteger(profile.childrenInSchoolOver18, 0)
    };
  }

  if (tool === "RETIREMENT_VA") {
    return {
      mode: "RETIRED",
      retirementSystem: profile.retirementSystem,
      yos: profile.yearsOfService,
      yearsOfService: profile.yearsOfService,
      monthlyBasicPayAtRetirement: profile.monthlyBasicPayAtRetirement,
      high36MonthlyArray: Array.isArray(profile.high36MonthlyArray) ? profile.high36MonthlyArray : undefined,
      vaRating: profile.vaRating,
      spouse: !!profile.spouse,
      dependentParents: toInteger(profile.dependentParents, 0),
      childrenUnder18: toInteger(profile.childrenUnder18, 0),
      childrenInSchoolOver18: toInteger(profile.childrenInSchoolOver18, 0)
    };
  }

  throw new Error(`Unsupported calculator tool "${tool}".`);
}

function buildSummaryFromComp(profile, compensation, tool) {
  const monthly = (compensation && compensation.monthly) || {};

  const summary = {
    mode: profile.mode || "",
    tool,
    headline: "",
    monthlyIncome: null,
    monthlyHousingAllowance: null,
    monthlyFoodAllowance: null,
    monthlyRetiredPay: null,
    monthlyVA: null,
    combinedMonthlyGross: null
  };

  if (tool === "BAH_BASE_PAY") {
    summary.monthlyIncome = round2(monthly.grossMonthlyComp || 0);
    summary.monthlyHousingAllowance = round2(monthly.bah || 0);
    summary.monthlyFoodAllowance = round2(monthly.bas || 0);
    summary.combinedMonthlyGross = round2(monthly.grossMonthlyComp || 0);
    summary.headline =
      `Estimated monthly active-duty compensation is $${summary.combinedMonthlyGross.toLocaleString()}.`;
    return summary;
  }

  if (tool === "VA_DISABILITY" || compensation.lane === "VA_ONLY") {
    summary.monthlyVA = round2(monthly.vaCompensation || monthly.grossMonthlyComp || 0);
    summary.combinedMonthlyGross = round2(summary.monthlyVA);
    summary.headline =
      `Estimated monthly VA compensation is $${summary.monthlyVA.toLocaleString()}.`;
    return summary;
  }

  if (tool === "RETIREMENT" || compensation.lane === "RETIREMENT_ONLY") {
    summary.monthlyRetiredPay = round2(monthly.retiredPayGross || monthly.grossMonthlyComp || 0);
    summary.combinedMonthlyGross = round2(summary.monthlyRetiredPay);
    summary.headline =
      `Estimated monthly retired pay is $${summary.monthlyRetiredPay.toLocaleString()}.`;
    return summary;
  }

  if (tool === "RETIREMENT_VA" || compensation.lane === "RETIRED_VETERAN") {
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

function buildGenericPayload(profile, compensation, tool) {
  return {
    tool,
    profile,
    compensation,
    summary: buildSummaryFromComp(profile, compensation, tool),
    sourceVersions: sourceVersions()
  };
}

function buildBahBasePayPayload(profile, compensation) {
  const payload = buildGenericPayload(profile, compensation, "BAH_BASE_PAY");
  const monthly = (compensation && compensation.monthly) || {};
  const detail = (compensation && compensation.detail) || {};

  return Object.assign({}, payload, {
    calculator: {
      mode: "ACTIVE_DUTY",
      rank: profile.rank,
      rankTitle: rankTitle(profile.rank),
      yearsOfService: profile.yearsOfService,
      base: profile.currentBase,
      dependents: profile.dependents,
      bah: round2(monthly.bah || 0),
      basicPay: round2(monthly.basicPay || 0),
      bas: round2(monthly.bas || 0),
      grossMonthlyComp: round2(monthly.grossMonthlyComp || 0),
      dutyZip: detail.dutyZip || null,
      bahRecord: detail.bahRecord || null
    }
  });
}

function buildRetirementPayload(profile, compensation) {
  const payload = buildGenericPayload(profile, compensation, "RETIREMENT");
  const monthly = (compensation && compensation.monthly) || {};
  const detail = (compensation && compensation.detail) || {};

  return Object.assign({}, payload, {
    calculator: {
      mode: "RETIRED",
      rank: profile.rank,
      rankTitle: rankTitle(profile.rank),
      yearsOfService: profile.yearsOfService,
      retirementSystem: profile.retirementSystem,
      monthlyBasicPayAtRetirement: round2(profile.monthlyBasicPayAtRetirement || 0),
      retiredPayGross: round2(monthly.retiredPayGross || monthly.grossMonthlyComp || 0),
      retirementRecord: detail.retirementRecord || null
    }
  });
}

function buildVADisabilityPayload(profile, compensation) {
  const payload = buildGenericPayload(profile, compensation, "VA_DISABILITY");
  const monthly = (compensation && compensation.monthly) || {};
  const detail = (compensation && compensation.detail) || {};

  return Object.assign({}, payload, {
    calculator: {
      mode: "VETERAN",
      vaRating: profile.vaRating,
      spouse: !!profile.spouse,
      dependentParents: profile.dependentParents,
      childrenUnder18: profile.childrenUnder18,
      childrenInSchoolOver18: profile.childrenInSchoolOver18,
      vaCompensation: round2(monthly.vaCompensation || monthly.grossMonthlyComp || 0),
      vaRecord: detail.vaRecord || null
    }
  });
}

function buildRetirementVAPayload(profile, compensation) {
  const payload = buildGenericPayload(profile, compensation, "RETIREMENT_VA");
  const monthly = (compensation && compensation.monthly) || {};
  const detail = (compensation && compensation.detail) || {};

  return Object.assign({}, payload, {
    calculator: {
      mode: "RETIRED",
      rank: profile.rank,
      rankTitle: rankTitle(profile.rank),
      yearsOfService: profile.yearsOfService,
      retirementSystem: profile.retirementSystem,
      vaRating: profile.vaRating,
      spouse: !!profile.spouse,
      dependentParents: profile.dependentParents,
      childrenUnder18: profile.childrenUnder18,
      childrenInSchoolOver18: profile.childrenInSchoolOver18,
      monthlyBasicPayAtRetirement: round2(profile.monthlyBasicPayAtRetirement || 0),
      retiredPayGross: round2(monthly.retiredPayGross || 0),
      vaCompensation: round2(monthly.vaCompensation || 0),
      combinedMonthlyGross: round2(monthly.combinedMonthlyGross || 0),
      retirementRecord: detail.retirementRecord || null,
      vaRecord: detail.vaRecord || null
    }
  });
}

function buildPayload(input, toolName) {
  const tool = inferToolName(toolName);
  let profile = null;

  if (tool === "BAH_BASE_PAY") {
    profile = profileFromBahBasePayInput(input);
  } else if (tool === "RETIREMENT") {
    profile = profileFromRetirementInput(input);
  } else if (tool === "VA_DISABILITY") {
    profile = profileFromVAInput(input);
  } else if (tool === "RETIREMENT_VA") {
    profile = profileFromRetirementVAInput(input);
  } else {
    throw new Error(`Unsupported calculator tool "${tool}".`);
  }

  profile = enrichRetirementPayBasis(profile);

  const compInput = toCompEngineInput(profile, tool);
  const compensation = COMP_ENGINE.getCompensationProfile(compInput);

  if (tool === "BAH_BASE_PAY") {
    return buildBahBasePayPayload(profile, compensation);
  }

  if (tool === "RETIREMENT") {
    return buildRetirementPayload(profile, compensation);
  }

  if (tool === "VA_DISABILITY") {
    return buildVADisabilityPayload(profile, compensation);
  }

  if (tool === "RETIREMENT_VA") {
    return buildRetirementVAPayload(profile, compensation);
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
