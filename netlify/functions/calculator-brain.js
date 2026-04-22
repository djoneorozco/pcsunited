// netlify/functions/calculator-brain.js
// ============================================================
// PCSUnited • Calculator Brain
// Netlify Function Endpoint
// v1.0.2
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

const BRAIN_VERSION = "pcsu-calculator-brain-1.0.2";
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

function hasUsableNumber(value) {
  return Number.isFinite(Number(value)) && Number(value) > 0;
}

function inferToolName(toolName) {
  const s = normalizeUpper(toolName || "GENERIC");

  if (s === "BAH_BASE_PAY") return "BAH_BASE_PAY";
  if (s === "RETIREMENT") return "RETIREMENT";
  if (s === "VA_DISABILITY") return "VA_DISABILITY";
  if (s === "RETIREMENT_VA") return "RETIREMENT_VA";

  return "GENERIC";
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

function normalizeRetirementSystem(retirementSystem) {
  const s = normalizeUpper(retirementSystem);

  if (s === "HIGH3" || s === "HIGH-3" || s === "HIGH 3") return "HIGH3";
  if (s === "BRS") return "BRS";

  return s || "HIGH3";
}

function normalizeDependents(input) {
  const s = normalizeUpper(input);

  return [
    "TRUE",
    "1",
    "YES",
    "Y",
    "WITH",
    "WITH_DEPENDENTS",
    "DEPENDENTS",
    "HAS_DEPENDENTS"
  ].includes(s)
    ? "with"
    : "without";
}

const BASE_ALIASES = Object.freeze({
  "ANDREWS": "Andrews AFB",
  "ANDREWSAFB": "Andrews AFB",
  "ANDREWS AFB": "Andrews AFB",
  "JOINT BASE ANDREWS": "Andrews AFB",
  "JB ANDREWS": "Andrews AFB",

  "BARKSDALE": "Barksdale AFB",
  "BARKSDALEAFB": "Barksdale AFB",
  "BARKSDALE AFB": "Barksdale AFB",

  "BEALE": "Beale AFB",
  "BEALEAFB": "Beale AFB",
  "BEALE AFB": "Beale AFB",

  "CANNON": "Cannon AFB",
  "CANNONAFB": "Cannon AFB",
  "CANNON AFB": "Cannon AFB",

  "CHARLESTON": "Charleston AFB",
  "CHARLESTONAFB": "Charleston AFB",
  "CHARLESTON AFB": "Charleston AFB",
  "JOINT BASE CHARLESTON": "Charleston AFB",

  "DAVIS-MONTHAN": "Davis-Monthan AFB",
  "DAVISMONTHAN": "Davis-Monthan AFB",
  "DAVISMONTHANAFB": "Davis-Monthan AFB",
  "DAVIS-MONTHAN AFB": "Davis-Monthan AFB",
  "DMAFB": "Davis-Monthan AFB",

  "DOVER": "Dover AFB",
  "DOVERAFB": "Dover AFB",
  "DOVER AFB": "Dover AFB",

  "DYESS": "Dyess AFB",
  "DYESSAFB": "Dyess AFB",
  "DYESS AFB": "Dyess AFB",

  "EGLIN": "Eglin AFB",
  "EGLINAFB": "Eglin AFB",
  "EGLIN AFB": "Eglin AFB",

  "ELMENDORF": "Elmendorf AFB",
  "ELMENDORFAFB": "Elmendorf AFB",
  "ELMENDORF AFB": "Elmendorf AFB",
  "JOINT BASE ELMENDORF-RICHARDSON": "Elmendorf AFB",
  "JBER": "Elmendorf AFB",

  "F.E-WARREN": "F.E-Warren AFB",
  "FE-WARREN": "F.E-Warren AFB",
  "FEWARREN": "F.E-Warren AFB",
  "FEWARRENAFB": "F.E-Warren AFB",
  "F E WARREN": "F.E-Warren AFB",
  "F.E-WARREN AFB": "F.E-Warren AFB",

  "FAIRCHILD": "Fairchild AFB",
  "FAIRCHILDAFB": "Fairchild AFB",
  "FAIRCHILD AFB": "Fairchild AFB",

  "FORT-SAM-HOUSTON": "Fort-Sam-Houston AFB",
  "FORT SAM HOUSTON": "Fort-Sam-Houston AFB",
  "FORTSAMHOUSTON": "Fort-Sam-Houston AFB",
  "FORTSAMHOUSTONAFB": "Fort-Sam-Houston AFB",
  "FORT SAM HOUSTON AFB": "Fort-Sam-Houston AFB",
  "JBSA-FORT-SAM-HOUSTON": "Fort-Sam-Houston AFB",
  "JBSA FORT SAM HOUSTON": "Fort-Sam-Houston AFB",

  "HOLLOMAN": "Holloman AFB",
  "HOLLOMANAFB": "Holloman AFB",
  "HOLLOMAN AFB": "Holloman AFB",

  "HURLBURT": "Hurlburt AFB",
  "HURLBURTAFB": "Hurlburt AFB",
  "HURLBURT AFB": "Hurlburt AFB",
  "HURLBURT FIELD": "Hurlburt AFB",

  "KEESLER": "Keesler AFB",
  "KEESLERAFB": "Keesler AFB",
  "KEESLER AFB": "Keesler AFB",

  "KIRTLAND": "Kirtland AFB",
  "KIRTLANDAFB": "Kirtland AFB",
  "KIRTLAND AFB": "Kirtland AFB",

  "LACKLAND": "Lackland AFB",
  "LACKLANDAFB": "Lackland AFB",
  "LACKLAND AFB": "Lackland AFB",
  "JBSA-LACKLAND": "Lackland AFB",
  "JBSA LACKLAND": "Lackland AFB",
  "JOINT BASE SAN ANTONIO LACKLAND": "Lackland AFB",

  "LANGLEY": "Langley AFB",
  "LANGLEYAFB": "Langley AFB",
  "LANGLEY AFB": "Langley AFB",
  "JOINT BASE LANGLEY-EUSTIS": "Langley AFB",

  "LAUGHLIN": "Laughlin AFB",
  "LAUGHLINAFB": "Laughlin AFB",
  "LAUGHLIN AFB": "Laughlin AFB",

  "LITTLE-ROCK": "Little-Rock AFB",
  "LITTLEROCK": "Little-Rock AFB",
  "LITTLEROCKAFB": "Little-Rock AFB",
  "LITTLE ROCK": "Little-Rock AFB",
  "LITTLE ROCK AFB": "Little-Rock AFB",

  "LUKE": "Luke AFB",
  "LUKEAFB": "Luke AFB",
  "LUKE AFB": "Luke AFB",

  "MACDILL": "MacDill AFB",
  "MACDILLAFB": "MacDill AFB",
  "MACDILL AFB": "MacDill AFB",

  "MALMSTROM": "Malmstrom AFB",
  "MALMSTROMAFB": "Malmstrom AFB",
  "MALMSTROM AFB": "Malmstrom AFB",

  "MAXWELL": "Maxwell AFB",
  "MAXWELLAFB": "Maxwell AFB",
  "MAXWELL AFB": "Maxwell AFB",

  "MCCONNELL": "McConnell AFB",
  "MCCONNELLAFB": "McConnell AFB",
  "MCCONNELL AFB": "McConnell AFB",

  "MCGUIRE": "McGuire AFB",
  "MCGUIREAFB": "McGuire AFB",
  "MCGUIRE AFB": "McGuire AFB",
  "JOINT BASE MCGUIRE-DIX-LAKEHURST": "McGuire AFB",
  "JBMDL": "McGuire AFB",

  "MINOT": "Minot AFB",
  "MINOTAFB": "Minot AFB",
  "MINOT AFB": "Minot AFB",

  "MOODY": "Moody AFB",
  "MOODYAFB": "Moody AFB",
  "MOODY AFB": "Moody AFB",

  "MOUNTAIN-HOME": "Mountain-Home AFB",
  "MOUNTAINHOME": "Mountain-Home AFB",
  "MOUNTAIN HOME": "Mountain-Home AFB",
  "MOUNTAINHOMEAFB": "Mountain-Home AFB",
  "MOUNTAIN HOME AFB": "Mountain-Home AFB",

  "NELLIS": "Nellis AFB",
  "NELLISAFB": "Nellis AFB",
  "NELLIS AFB": "Nellis AFB",

  "OFFUTT": "Offutt AFB",
  "OFFUTTAFB": "Offutt AFB",
  "OFFUTT AFB": "Offutt AFB",

  "PETERSON": "Peterson AFB",
  "PETERSONAFB": "Peterson AFB",
  "PETERSON AFB": "Peterson AFB",
  "PETERSON SPACE FORCE BASE": "Peterson AFB",
  "PETERSON SFB": "Peterson AFB",

  "RANDOLPH": "Randolph AFB",
  "RANDOLPHAFB": "Randolph AFB",
  "RANDOLPH AFB": "Randolph AFB",
  "JBSA-RANDOLPH": "Randolph AFB",
  "JBSA RANDOLPH": "Randolph AFB",
  "JOINT BASE SAN ANTONIO RANDOLPH": "Randolph AFB",

  "ROBINS": "Robins AFB",
  "ROBINSAFB": "Robins AFB",
  "ROBINS AFB": "Robins AFB",

  "SCOTT": "Scott AFB",
  "SCOTTAFB": "Scott AFB",
  "SCOTT AFB": "Scott AFB",

  "SEYMOUR-JOHNSON": "Seymour-Johnson AFB",
  "SEYMOURJOHNSON": "Seymour-Johnson AFB",
  "SEYMOURJOHNSONAFB": "Seymour-Johnson AFB",
  "SEYMOUR-JOHNSON AFB": "Seymour-Johnson AFB",

  "SHAW": "Shaw AFB",
  "SHAWAFB": "Shaw AFB",
  "SHAW AFB": "Shaw AFB",

  "SHEPPARD": "Sheppard AFB",
  "SHEPPARDAFB": "Sheppard AFB",
  "SHEPPARD AFB": "Sheppard AFB",

  "TINKER": "Tinker AFB",
  "TINKERAFB": "Tinker AFB",
  "TINKER AFB": "Tinker AFB",

  "TRAVIS": "Travis AFB",
  "TRAVISAFB": "Travis AFB",
  "TRAVIS AFB": "Travis AFB",

  "TYNDALL": "Tyndall AFB",
  "TYNDALLAFB": "Tyndall AFB",
  "TYNDALL AFB": "Tyndall AFB",

  "WHITEMAN": "Whiteman AFB",
  "WHITEMANAFB": "Whiteman AFB",
  "WHITEMAN AFB": "Whiteman AFB",

  "WRIGHT-PATTERSON": "Wright-Patterson AFB",
  "WRIGHTPATTERSON": "Wright-Patterson AFB",
  "WRIGHTPATTERSONAFB": "Wright-Patterson AFB",
  "WRIGHT-PATTERSON AFB": "Wright-Patterson AFB",
  "WPAFB": "Wright-Patterson AFB"
});

function canonicalizeBase(base) {
  const raw = normalizeString(base);
  const key = normalizeUpper(raw);

  if (!raw) return "";

  if (typeof OFFICIAL_BAH.canonicalizeBase === "function") {
    try {
      return OFFICIAL_BAH.canonicalizeBase(raw);
    } catch (_err) {}
  }

  return BASE_ALIASES[key] || raw;
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
    monthlyBasicPayAtRetirement: toFiniteNumber(
      input.monthlyBasicPayAtRetirement ?? input.monthly_basic_pay_at_retirement,
      null
    ),
    high36MonthlyArray: Array.isArray(input.high36MonthlyArray)
      ? input.high36MonthlyArray.slice()
      : Array.isArray(input.high36_monthly_array)
      ? input.high36_monthly_array.slice()
      : undefined
  };
}

function profileFromVAInput(input) {
  return {
    mode: "VETERAN",
    vaRating: toInteger(input.vaRating ?? input.va_rating ?? input.rating, 0),
    spouse: !!input.spouse,
    dependentParents: toInteger(input.dependentParents ?? input.dependent_parents, 0),
    childrenUnder18: toInteger(input.childrenUnder18 ?? input.children_under_18, 0),
    childrenInSchoolOver18: toInteger(
      input.childrenInSchoolOver18 ?? input.children_in_school_over_18,
      0
    )
  };
}

function profileFromRetirementVAInput(input) {
  const retirement = profileFromRetirementInput(input);
  const va = profileFromVAInput(input);

  return Object.assign({}, retirement, va, {
    mode: "RETIRED"
  });
}

function tryDeriveMonthlyBasicPay(rank, yearsOfService) {
  if (!rank || !hasUsableNumber(yearsOfService)) return null;

  try {
    if (typeof OFFICIAL_PAY.getPayRecord2026 === "function") {
      const rec = OFFICIAL_PAY.getPayRecord2026(rank, yearsOfService);
      if (rec && hasUsableNumber(rec.basicPayMonthly)) {
        return round2(rec.basicPayMonthly);
      }
      if (rec && hasUsableNumber(rec.monthlyBasicPay)) {
        return round2(rec.monthlyBasicPay);
      }
    }
  } catch (_err) {}

  try {
    if (typeof OFFICIAL_PAY.getMonthlyBasicPay === "function") {
      const value = OFFICIAL_PAY.getMonthlyBasicPay(rank, yearsOfService);
      if (hasUsableNumber(value)) {
        return round2(value);
      }
    }
  } catch (_err) {}

  try {
    if (typeof OFFICIAL_PAY.getBasicPayMonthly === "function") {
      const value = OFFICIAL_PAY.getBasicPayMonthly(rank, yearsOfService);
      if (hasUsableNumber(value)) {
        return round2(value);
      }
    }
  } catch (_err) {}

  return null;
}

function enrichRetirementPayBasis(profile, tool) {
  const enriched = Object.assign({}, profile);

  if (tool !== "RETIREMENT" && tool !== "RETIREMENT_VA") {
    return enriched;
  }

  const hasHigh36 =
    Array.isArray(enriched.high36MonthlyArray) &&
    enriched.high36MonthlyArray.length > 0;

  const hasMonthlyBasis = hasUsableNumber(enriched.monthlyBasicPayAtRetirement);

  if (hasHigh36 || hasMonthlyBasis) {
    return enriched;
  }

  if (!enriched.rank) {
    throw new Error("rank is required for retirement calculators.");
  }

  if (!hasUsableNumber(enriched.yearsOfService)) {
    throw new Error("yearsOfService is required for retirement calculators.");
  }

  const derived = tryDeriveMonthlyBasicPay(
    enriched.rank,
    enriched.yearsOfService
  );

  if (!hasUsableNumber(derived)) {
    throw new Error(
      `Unable to derive monthlyBasicPayAtRetirement for ${enriched.rank} at ${enriched.yearsOfService} years.`
    );
  }

  enriched.monthlyBasicPayAtRetirement = derived;
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
      currentBase: profile.currentBase,
      dependents: profile.dependents
    };
  }

  if (tool === "RETIREMENT") {
    return {
      mode: "RETIRED",
      retirementSystem: profile.retirementSystem,
      rank: profile.rank,
      yos: profile.yearsOfService,
      yearsOfService: profile.yearsOfService,
      monthlyBasicPayAtRetirement: profile.monthlyBasicPayAtRetirement,
      high36MonthlyArray: Array.isArray(profile.high36MonthlyArray)
        ? profile.high36MonthlyArray
        : undefined
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
      rank: profile.rank,
      yos: profile.yearsOfService,
      yearsOfService: profile.yearsOfService,
      monthlyBasicPayAtRetirement: profile.monthlyBasicPayAtRetirement,
      high36MonthlyArray: Array.isArray(profile.high36MonthlyArray)
        ? profile.high36MonthlyArray
        : undefined,
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
    summary.combinedMonthlyGross = round2(
      monthly.combinedMonthlyGross ||
      monthly.grossMonthlyComp ||
      (monthly.retiredPayGross || 0) + (monthly.vaCompensation || 0)
    );
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
      retiredPayGross: round2(
        monthly.retiredPayGross ||
        monthly.grossMonthlyComp ||
        0
      ),
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
      combinedMonthlyGross: round2(
        monthly.combinedMonthlyGross ||
        monthly.grossMonthlyComp ||
        (monthly.retiredPayGross || 0) + (monthly.vaCompensation || 0)
      ),
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

  profile = enrichRetirementPayBasis(profile, tool);

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
