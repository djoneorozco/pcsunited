// baseline-profile.js
// ============================================================
// PCSUnited • Baseline Profile Engine
// v1.0.0
//
// PURPOSE
// - Normalize raw PCSUnited user input into one canonical profile shape
// - Serve as the source-of-truth profile adapter for:
//   * PCS Snapshot
//   * FAD
//   * Ask-Elena
//   * AIOU
//   * future PCSUnited SaaS tools
//
// DESIGN RULE
// - This file does NOT calculate pay, BAH, retirement, or VA.
// - This file only normalizes and validates user profile inputs.
// - This file should be safe to reuse across products.
//
// STORAGE GOAL
// - This file can be used with localStorage/sessionStorage,
//   but does not require storage by itself.
// ============================================================

(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.PCSU_BASELINE_PROFILE = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const PROFILE_VERSION = "pcsu-baseline-profile-1.0.0";

  const SUPPORTED_MODES = Object.freeze([
    "ACTIVE_DUTY",
    "VETERAN",
    "RETIRED"
  ]);

  const SUPPORTED_RETIREMENT_SYSTEMS = Object.freeze([
    "HIGH3",
    "BRS"
  ]);

  // ============================================================
  // //#1) BASE ALIAS MAP
  // //# Keep aligned with official-bah.js
  // ============================================================
  const BASE_ALIASES = Object.freeze({
    "Andrews": "Andrews AFB",
    "AndrewsAFB": "Andrews AFB",
    "Andrews AFB": "Andrews AFB",
    "Joint Base Andrews": "Andrews AFB",
    "JB Andrews": "Andrews AFB",

    "Barksdale": "Barksdale AFB",
    "BarksdaleAFB": "Barksdale AFB",
    "Barksdale AFB": "Barksdale AFB",

    "Beale": "Beale AFB",
    "BealeAFB": "Beale AFB",
    "Beale AFB": "Beale AFB",

    "Cannon": "Cannon AFB",
    "CannonAFB": "Cannon AFB",
    "Cannon AFB": "Cannon AFB",

    "Charleston": "Charleston AFB",
    "CharlestonAFB": "Charleston AFB",
    "Charleston AFB": "Charleston AFB",
    "Joint Base Charleston": "Charleston AFB",
    "JB Charleston": "Charleston AFB",

    "Davis-Monthan": "Davis-Monthan AFB",
    "DavisMonthan": "Davis-Monthan AFB",
    "DavisMonthanAFB": "Davis-Monthan AFB",
    "Davis-Monthan AFB": "Davis-Monthan AFB",
    "DMAFB": "Davis-Monthan AFB",

    "Dover": "Dover AFB",
    "DoverAFB": "Dover AFB",
    "Dover AFB": "Dover AFB",

    "Dyess": "Dyess AFB",
    "DyessAFB": "Dyess AFB",
    "Dyess AFB": "Dyess AFB",

    "Eglin": "Eglin AFB",
    "EglinAFB": "Eglin AFB",
    "Eglin AFB": "Eglin AFB",

    "Elmendorf": "Elmendorf AFB",
    "ElmendorfAFB": "Elmendorf AFB",
    "Elmendorf AFB": "Elmendorf AFB",
    "JBER": "Elmendorf AFB",
    "Joint Base Elmendorf-Richardson": "Elmendorf AFB",

    "F.E-Warren": "F.E-Warren AFB",
    "FE-Warren": "F.E-Warren AFB",
    "FEWarren": "F.E-Warren AFB",
    "FEWarrenAFB": "F.E-Warren AFB",
    "F.E-Warren AFB": "F.E-Warren AFB",
    "F E Warren": "F.E-Warren AFB",
    "Francis E. Warren": "F.E-Warren AFB",

    "Fairchild": "Fairchild AFB",
    "FairchildAFB": "Fairchild AFB",
    "Fairchild AFB": "Fairchild AFB",

    "Fort Sam Houston": "Fort-Sam-Houston AFB",
    "Fort-Sam-Houston": "Fort-Sam-Houston AFB",
    "FortSamHouston": "Fort-Sam-Houston AFB",
    "JBSA-Fort Sam Houston": "Fort-Sam-Houston AFB",
    "JBSA-Fort-Sam-Houston": "Fort-Sam-Houston AFB",

    "Holloman": "Holloman AFB",
    "HollomanAFB": "Holloman AFB",
    "Holloman AFB": "Holloman AFB",

    "Hurlburt": "Hurlburt AFB",
    "HurlburtAFB": "Hurlburt AFB",
    "Hurlburt AFB": "Hurlburt AFB",
    "Hurlburt Field": "Hurlburt AFB",

    "Keesler": "Keesler AFB",
    "KeeslerAFB": "Keesler AFB",
    "Keesler AFB": "Keesler AFB",

    "Kirtland": "Kirtland AFB",
    "KirtlandAFB": "Kirtland AFB",
    "Kirtland AFB": "Kirtland AFB",

    "Lackland": "Lackland AFB",
    "LacklandAFB": "Lackland AFB",
    "Lackland AFB": "Lackland AFB",
    "JBSA-Lackland": "Lackland AFB",
    "JBSA Lackland": "Lackland AFB",

    "Langley": "Langley AFB",
    "LangleyAFB": "Langley AFB",
    "Langley AFB": "Langley AFB",
    "Joint Base Langley-Eustis": "Langley AFB",

    "Laughlin": "Laughlin AFB",
    "LaughlinAFB": "Laughlin AFB",
    "Laughlin AFB": "Laughlin AFB",

    "Little Rock": "Little-Rock AFB",
    "LittleRock": "Little-Rock AFB",
    "LittleRockAFB": "Little-Rock AFB",
    "Little Rock AFB": "Little-Rock AFB",
    "Little-Rock": "Little-Rock AFB",

    "Luke": "Luke AFB",
    "LukeAFB": "Luke AFB",
    "Luke AFB": "Luke AFB",

    "MacDill": "MacDill AFB",
    "MacDillAFB": "MacDill AFB",
    "MacDill AFB": "MacDill AFB",

    "Malmstrom": "Malmstrom AFB",
    "MalmstromAFB": "Malmstrom AFB",
    "Malmstrom AFB": "Malmstrom AFB",

    "Maxwell": "Maxwell AFB",
    "MaxwellAFB": "Maxwell AFB",
    "Maxwell AFB": "Maxwell AFB",
    "Maxwell-Gunter": "Maxwell AFB",
    "Maxwell-Gunter AFB": "Maxwell AFB",
    "Gunter Annex": "Maxwell AFB",

    "McConnell": "McConnell AFB",
    "McConnellAFB": "McConnell AFB",
    "McConnell AFB": "McConnell AFB",

    "McGuire": "McGuire AFB",
    "McGuireAFB": "McGuire AFB",
    "McGuire AFB": "McGuire AFB",
    "JBMDL": "McGuire AFB",
    "Joint Base McGuire-Dix-Lakehurst": "McGuire AFB",

    "Minot": "Minot AFB",
    "MinotAFB": "Minot AFB",
    "Minot AFB": "Minot AFB",

    "Moody": "Moody AFB",
    "MoodyAFB": "Moody AFB",
    "Moody AFB": "Moody AFB",

    "Mountain Home": "Mountain-Home AFB",
    "MountainHome": "Mountain-Home AFB",
    "MountainHomeAFB": "Mountain-Home AFB",
    "Mountain Home AFB": "Mountain-Home AFB",
    "Mountain-Home": "Mountain-Home AFB",
    "Mountain-Home AFB": "Mountain-Home AFB",

    "Nellis": "Nellis AFB",
    "NellisAFB": "Nellis AFB",
    "Nellis AFB": "Nellis AFB",

    "Offutt": "Offutt AFB",
    "OffuttAFB": "Offutt AFB",
    "Offutt AFB": "Offutt AFB",

    "Peterson": "Peterson AFB",
    "PetersonAFB": "Peterson AFB",
    "Peterson AFB": "Peterson AFB",
    "Peterson SFB": "Peterson AFB",
    "Peterson Space Force Base": "Peterson AFB",

    "Randolph": "Randolph AFB",
    "RandolphAFB": "Randolph AFB",
    "Randolph AFB": "Randolph AFB",
    "JBSA-Randolph": "Randolph AFB",
    "JBSA Randolph": "Randolph AFB",

    "Robins": "Robins AFB",
    "RobinsAFB": "Robins AFB",
    "Robins AFB": "Robins AFB",

    "Scott": "Scott AFB",
    "ScottAFB": "Scott AFB",
    "Scott AFB": "Scott AFB",

    "Seymour Johnson": "Seymour-Johnson AFB",
    "SeymourJohnson": "Seymour-Johnson AFB",
    "SeymourJohnsonAFB": "Seymour-Johnson AFB",
    "Seymour Johnson AFB": "Seymour-Johnson AFB",
    "Seymour-Johnson": "Seymour-Johnson AFB",
    "Seymour-Johnson AFB": "Seymour-Johnson AFB",

    "Shaw": "Shaw AFB",
    "ShawAFB": "Shaw AFB",
    "Shaw AFB": "Shaw AFB",

    "Sheppard": "Sheppard AFB",
    "SheppardAFB": "Sheppard AFB",
    "Sheppard AFB": "Sheppard AFB",

    "Tinker": "Tinker AFB",
    "TinkerAFB": "Tinker AFB",
    "Tinker AFB": "Tinker AFB",

    "Travis": "Travis AFB",
    "TravisAFB": "Travis AFB",
    "Travis AFB": "Travis AFB",

    "Tyndall": "Tyndall AFB",
    "TyndallAFB": "Tyndall AFB",
    "Tyndall AFB": "Tyndall AFB",

    "Whiteman": "Whiteman AFB",
    "WhitemanAFB": "Whiteman AFB",
    "Whiteman AFB": "Whiteman AFB",

    "Wright-Patterson": "Wright-Patterson AFB",
    "WrightPatterson": "Wright-Patterson AFB",
    "WrightPattersonAFB": "Wright-Patterson AFB",
    "Wright-Patterson AFB": "Wright-Patterson AFB",
    "WPAFB": "Wright-Patterson AFB",

    "San Antonio": "Lackland AFB",
    "JBSA": "Lackland AFB"
  });

  // ============================================================
  // //#2) HELPERS
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

  function toNonNegativeNumber(value, fallback) {
    const n = toFiniteNumber(value, fallback);
    if (!Number.isFinite(n)) return fallback;
    return n < 0 ? fallback : n;
  }

  function toInteger(value, fallback) {
    const n = toFiniteNumber(value, fallback);
    if (!Number.isFinite(n)) return fallback;
    return Math.floor(n);
  }

  function toBoolean(value) {
    if (value === true) return true;
    if (value === false) return false;

    const s = normalizeUpper(value);

    return [
      "TRUE",
      "1",
      "YES",
      "Y",
      "WITH",
      "WITH_DEPENDENTS",
      "DEPENDENTS",
      "HAS_DEPENDENTS"
    ].includes(s);
  }

  function normalizeMode(mode) {
    const s = normalizeUpper(mode);

    if (["AD", "ACTIVE_DUTY", "ACTIVE DUTY"].includes(s)) return "ACTIVE_DUTY";
    if (["VETERAN", "VET"].includes(s)) return "VETERAN";
    if (["RETIRED", "RETIREE"].includes(s)) return "RETIRED";

    return "";
  }

  function normalizeRetirementSystem(retirementSystem) {
    const s = normalizeUpper(retirementSystem);

    if (!s) return "";

    if (s === "HIGH3" || s === "HIGH-3" || s === "HIGH 3") return "HIGH3";
    if (s === "BRS") return "BRS";

    return s;
  }

  function normalizeRank(rank) {
    const s = normalizeUpper(rank);
    const m = s.match(/^([EOW])\s*[-]?\s*(\d)(E)?$/);

    if (!m) return s.replace(/\s+/g, "");

    return `${m[1]}-${m[2]}${m[3] ? "E" : ""}`;
  }

  function canonicalizeBase(base) {
    const raw = normalizeString(base);
    const key = raw.replace(/\s+/g, " ").trim();

    const match = Object.keys(BASE_ALIASES).find(function (k) {
      return k.toLowerCase() === key.toLowerCase();
    });

    return match ? BASE_ALIASES[match] : raw;
  }

  function normalizeDependents(input) {
    return toBoolean(input) ? "with" : "without";
  }

  function normalizeFamily(input) {
    if (toBoolean(input)) return "with_dependents";
    return "without_dependents";
  }

  function ensureSupportedMode(mode) {
    if (!SUPPORTED_MODES.includes(mode)) {
      throw new Error(
        `Unsupported mode "${mode}". Supported modes: ${SUPPORTED_MODES.join(", ")}`
      );
    }
  }

  function ensureSupportedRetirementSystem(system) {
    if (!system) return;
    if (!SUPPORTED_RETIREMENT_SYSTEMS.includes(system)) {
      throw new Error(
        `Unsupported retirementSystem "${system}". Supported systems: ${SUPPORTED_RETIREMENT_SYSTEMS.join(", ")}`
      );
    }
  }

  // ============================================================
  // //#3) CORE NORMALIZER
  // ============================================================
  function buildCanonicalProfile(input) {
    if (!input || typeof input !== "object") {
      throw new Error("Input object is required.");
    }

    const mode = normalizeMode(
      input.mode ||
      input.type ||
      input.userType ||
      input.profileMode
    );

    if (!mode) {
      throw new Error("mode is required and must resolve to ACTIVE_DUTY, VETERAN, or RETIRED.");
    }

    ensureSupportedMode(mode);

    const rank = normalizeRank(
      input.rank ||
      input.rank_paygrade ||
      input.lastHeldRank ||
      input.last_held_rank ||
      ""
    );

    const yearsOfService = toNonNegativeNumber(
      input.yos ??
      input.yearsOfService ??
      input.years_service ??
      input.retirementYos,
      0
    );

    const currentBase = canonicalizeBase(
      input.base ||
      input.current_base ||
      input.currentBase ||
      input.dutyStation ||
      input.currentDutyStation ||
      ""
    );

    const newBase = canonicalizeBase(
      input.new_base ||
      input.newBase ||
      input.gaining_base ||
      input.gainingBase ||
      ""
    );

    const dependents = normalizeDependents(
      input.dependents ??
      input.hasDependents ??
      input.family ??
      input.withDependents
    );

    const family = normalizeFamily(
      input.dependents ??
      input.hasDependents ??
      input.family ??
      input.withDependents
    );

    const retirementSystem = normalizeRetirementSystem(
      input.retirementSystem ||
      input.retirement_system ||
      input.system ||
      ""
    );

    ensureSupportedRetirementSystem(retirementSystem);

    const vaRating = toInteger(
      input.vaRating ??
      input.va_rating ??
      input.rating,
      0
    );

    const spouse = toBoolean(
      input.spouse ??
      input.hasSpouse
    );

    const dependentParents = toInteger(
      input.dependentParents ??
      input.dependent_parents,
      0
    );

    const childrenUnder18 = toInteger(
      input.childrenUnder18 ??
      input.children_under_18,
      0
    );

    const childrenInSchoolOver18 = toInteger(
      input.childrenInSchoolOver18 ??
      input.children_in_school_over_18,
      0
    );

    const monthlyBasicPayAtRetirement = toFiniteNumber(
      input.monthlyBasicPayAtRetirement ??
      input.monthly_basic_pay_at_retirement,
      null
    );

    const high36MonthlyArray = Array.isArray(input.high36MonthlyArray)
      ? input.high36MonthlyArray.slice()
      : Array.isArray(input.high36_monthly_array)
      ? input.high36_monthly_array.slice()
      : [];

    const additionalIncome = toNonNegativeNumber(
      input.additionalIncome ??
      input.additional_income ??
      input.additional_monthly_income,
      0
    );

    const monthlyExpenses = toNonNegativeNumber(
      input.monthlyExpenses ??
      input.monthly_expenses ??
      input.expenses,
      0
    );

    const monthlyDebt = toNonNegativeNumber(
      input.monthlyDebt ??
      input.monthly_debt ??
      input.debt ??
      input.non_housing_debt,
      0
    );

    const downpayment = toNonNegativeNumber(
      input.downpayment ??
      input.downPayment ??
      input.dpAmt,
      0
    );

    const projectedHomePrice = toNonNegativeNumber(
      input.projectedHomePrice ??
      input.projected_home_price ??
      input.price,
      0
    );

    const creditScore = toInteger(
      input.creditScore ??
      input.credit_score,
      0
    );

    const profile = {
      profileVersion: PROFILE_VERSION,
      source: normalizeString(input.source || "baseline_profile"),
      ts: Date.now(),

      mode,
      rank,
      yearsOfService,

      currentBase,
      newBase,

      dependents,
      family,

      retirementSystem,

      vaRating,
      spouse,
      dependentParents,
      childrenUnder18,
      childrenInSchoolOver18,

      monthlyBasicPayAtRetirement,
      high36MonthlyArray,

      additionalIncome,
      monthlyExpenses,
      monthlyDebt,
      downpayment,
      projectedHomePrice,
      creditScore
    };

    return Object.freeze(profile);
  }

  // ============================================================
  // //#4) STORAGE HELPERS
  // ============================================================
  function writeProfileToStorage(profile, options) {
    const opts = options && typeof options === "object" ? options : {};
    const key = normalizeString(opts.key || "pcsunited.baseline_profile.v1");
    const storageType = normalizeUpper(opts.storage || "local");

    const payload = JSON.stringify(profile);

    if (storageType === "SESSION") {
      sessionStorage.setItem(key, payload);
      return key;
    }

    localStorage.setItem(key, payload);
    return key;
  }

  function readProfileFromStorage(options) {
    const opts = options && typeof options === "object" ? options : {};
    const key = normalizeString(opts.key || "pcsunited.baseline_profile.v1");
    const storageType = normalizeUpper(opts.storage || "local");

    try {
      const raw = storageType === "SESSION"
        ? sessionStorage.getItem(key)
        : localStorage.getItem(key);

      if (!raw) return null;

      return JSON.parse(raw);
    } catch (_err) {
      return null;
    }
  }

  function clearProfileFromStorage(options) {
    const opts = options && typeof options === "object" ? options : {};
    const key = normalizeString(opts.key || "pcsunited.baseline_profile.v1");
    const storageType = normalizeUpper(opts.storage || "local");

    if (storageType === "SESSION") {
      sessionStorage.removeItem(key);
      return key;
    }

    localStorage.removeItem(key);
    return key;
  }

  // ============================================================
  // //#5) BUILD + SAVE
  // ============================================================
  function buildAndStoreProfile(input, options) {
    const profile = buildCanonicalProfile(input);
    const key = writeProfileToStorage(profile, options);

    try {
      window.dispatchEvent(
        new CustomEvent("pcsunited:profile-ready", {
          detail: { key, profile }
        })
      );
    } catch (_err) {}

    return {
      key,
      profile
    };
  }

  // ============================================================
  // //#6) COMP-ENGINE ADAPTER
  // ============================================================
  function toCompEngineInput(profile) {
    if (!profile || typeof profile !== "object") {
      throw new Error("Profile object is required.");
    }

    return {
      mode: profile.mode,
      rank: profile.rank,
      yos: profile.yearsOfService,
      yearsOfService: profile.yearsOfService,

      base: profile.currentBase || profile.newBase || "",
      current_base: profile.currentBase || "",
      new_base: profile.newBase || "",

      dependents: profile.dependents,
      family: profile.family,

      retirementSystem: profile.retirementSystem,
      monthlyBasicPayAtRetirement: profile.monthlyBasicPayAtRetirement,
      high36MonthlyArray: profile.high36MonthlyArray,

      vaRating: profile.vaRating,
      spouse: profile.spouse,
      dependentParents: profile.dependentParents,
      childrenUnder18: profile.childrenUnder18,
      childrenInSchoolOver18: profile.childrenInSchoolOver18,

      additionalIncome: profile.additionalIncome,
      monthlyExpenses: profile.monthlyExpenses,
      monthlyDebt: profile.monthlyDebt,
      downpayment: profile.downpayment,
      projectedHomePrice: profile.projectedHomePrice,
      creditScore: profile.creditScore
    };
  }

  // ============================================================
  // //#7) LIGHT VALIDATION
  // ============================================================
  function validateProfile(profile) {
    if (!profile || typeof profile !== "object") {
      return {
        ok: false,
        errors: ["Profile is missing or invalid."]
      };
    }

    const errors = [];

    if (!profile.mode) errors.push("mode is required.");
    if (!profile.rank && profile.mode === "ACTIVE_DUTY") {
      errors.push("rank is required for ACTIVE_DUTY.");
    }

    if (profile.mode === "ACTIVE_DUTY" && !profile.currentBase) {
      errors.push("currentBase is required for ACTIVE_DUTY.");
    }

    if (profile.mode === "RETIRED" && profile.retirementSystem) {
      ensureSupportedRetirementSystem(profile.retirementSystem);
    }

    return {
      ok: errors.length === 0,
      errors
    };
  }

  // ============================================================
  // //#8) EXPORTS
  // ============================================================
  return Object.freeze({
    PROFILE_VERSION,
    SUPPORTED_MODES,
    SUPPORTED_RETIREMENT_SYSTEMS,
    BASE_ALIASES,

    normalizeString,
    normalizeRank,
    normalizeMode,
    normalizeRetirementSystem,
    normalizeDependents,
    normalizeFamily,
    canonicalizeBase,

    buildCanonicalProfile,
    buildAndStoreProfile,
    toCompEngineInput,
    validateProfile,

    writeProfileToStorage,
    readProfileFromStorage,
    clearProfileFromStorage
  });
});
