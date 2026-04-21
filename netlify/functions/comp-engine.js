// comp-engine.js
// ============================================================
// PCSUnited • Compensation Engine
// v1.0.1
//
// PURPOSE
// - Modular orchestration layer for PCSUnited financial calculations
// - Combines official-pay.js, official-bah.js, official-retirement.js,
//   and official-va.js into one reusable calculation engine
//
// DESIGN PRINCIPLE
// - This file is NOT the authority for rates.
// - This file only orchestrates official modules.
// - All hard numbers should come from the official-* files.
//
// SUPPORTED LANES
// - Active Duty monthly compensation
// - Veteran / retiree monthly compensation
// - Retirement + VA combined monthly compensation
// - Unified profile-based routing
//
// DEPENDENCIES EXPECTED
// - PCSU_OFFICIAL_PAY
// - PCSU_OFFICIAL_BAH
// - PCSU_OFFICIAL_RETIREMENT
// - PCSU_OFFICIAL_VA
// ============================================================

(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(
      require("./official-pay"),
      require("./official-bah"),
      require("./official-retirement"),
      require("./official-va")
    );
  } else {
    root.PCSU_COMP_ENGINE = factory(
      root.PCSU_OFFICIAL_PAY,
      root.PCSU_OFFICIAL_BAH,
      root.PCSU_OFFICIAL_RETIREMENT,
      root.PCSU_OFFICIAL_VA
    );
  }
})(typeof self !== "undefined" ? self : this, function (
  OFFICIAL_PAY,
  OFFICIAL_BAH,
  OFFICIAL_RETIREMENT,
  OFFICIAL_VA
) {
  "use strict";

  const ENGINE_VERSION = "pcsu-comp-engine-1.0.1";

  // ============================================================
  // //#1) DEPENDENCY CHECKS
  // ============================================================
  function assertDependency(dep, name) {
    if (!dep || typeof dep !== "object") {
      throw new Error(`${name} is required but not loaded.`);
    }
  }

  assertDependency(OFFICIAL_PAY, "PCSU_OFFICIAL_PAY");
  assertDependency(OFFICIAL_BAH, "PCSU_OFFICIAL_BAH");
  assertDependency(OFFICIAL_RETIREMENT, "PCSU_OFFICIAL_RETIREMENT");
  assertDependency(OFFICIAL_VA, "PCSU_OFFICIAL_VA");

  // ============================================================
  // //#2) HELPERS
  // ============================================================
  function normalizeString(value) {
    return String(value || "").trim();
  }

  function toBoolean(value) {
    if (value === true) return true;
    if (value === false) return false;

    const s = String(value || "").trim().toLowerCase();
    return ["true", "1", "yes", "y", "with", "with_dependents"].includes(s);
  }

  function round2(value) {
    return Number((Number(value) || 0).toFixed(2));
  }

  function safeNumber(value, fallback) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }

  function normalizeDependentsForBAH(input) {
    return toBoolean(input) ? "with" : "without";
  }

  function inferMode(mode) {
    const s = String(mode || "").trim().toUpperCase();

    if (["AD", "ACTIVE_DUTY", "ACTIVE DUTY"].includes(s)) return "ACTIVE_DUTY";
    if (["VETERAN", "VET"].includes(s)) return "VETERAN";
    if (["RETIRED", "RETIREE"].includes(s)) return "RETIRED";

    throw new Error(`Unsupported mode "${mode}".`);
  }

  function getSourceVersions() {
    return {
      engineVersion: ENGINE_VERSION,
      payVersion: OFFICIAL_PAY.RATE_VERSION || null,
      bahVersion: OFFICIAL_BAH.RATE_VERSION || null,
      retirementVersion: OFFICIAL_RETIREMENT.RATE_VERSION || null,
      vaVersion: OFFICIAL_VA.RATE_VERSION || null
    };
  }

  function getPayRecordFromOfficialPay(rank, yearsOfService) {
    if (typeof OFFICIAL_PAY.getPayRecord2026 === "function") {
      return OFFICIAL_PAY.getPayRecord2026(rank, yearsOfService);
    }

    if (typeof OFFICIAL_PAY.getPayRecord === "function") {
      return OFFICIAL_PAY.getPayRecord(rank, yearsOfService);
    }

    if (typeof OFFICIAL_PAY.getPay === "function") {
      return OFFICIAL_PAY.getPay({
        rank: rank,
        yearsOfService: yearsOfService
      });
    }

    throw new Error("official-pay.js does not expose a supported pay lookup function.");
  }

  function extractBasicPayMonthly(payRecord) {
    return round2(
      payRecord.basicPayMonthly ??
      payRecord.monthlyBasePay ??
      payRecord.basicPay ??
      0
    );
  }

  function extractBASMonthly(payRecord) {
    return round2(
      payRecord.basMonthly ??
      payRecord.monthlyBAS ??
      payRecord.bas ??
      0
    );
  }

  function extractYearsOfService(payRecord, fallback) {
    return payRecord.yearsOfService ?? fallback;
  }

  function extractRank(payRecord, fallback) {
    return payRecord.rank ?? fallback;
  }

  // ============================================================
  // //#3) ACTIVE DUTY MONTHLY COMP
  // ============================================================
  function getActiveDutyComp(input) {
    if (!input || typeof input !== "object") {
      throw new Error("Input object is required for getActiveDutyComp().");
    }

    const rank = normalizeString(input.rank);
    const yearsOfService = safeNumber(input.yos ?? input.yearsOfService, NaN);
    const base = normalizeString(input.base);
    const dependents = normalizeDependentsForBAH(
      input.dependents ?? input.hasDependents ?? input.family
    );

    if (!rank) throw new Error("rank is required.");
    if (!Number.isFinite(yearsOfService)) throw new Error("yos / yearsOfService is required.");
    if (!base) throw new Error("base is required.");

    const payRecord = getPayRecordFromOfficialPay(rank, yearsOfService);

    const bahResult = OFFICIAL_BAH.getBAH(base, rank, dependents);
    const bahRecord = OFFICIAL_BAH.getBahRecord(base, rank);

    const basicPayMonthly = extractBasicPayMonthly(payRecord);
    const basMonthly = extractBASMonthly(payRecord);
    const bahMonthly = round2(bahResult && bahResult.bah);

    const grossMonthlyComp = round2(
      basicPayMonthly + basMonthly + bahMonthly
    );

    return {
      lane: "ACTIVE_DUTY",
      mode: "ACTIVE_DUTY",
      rank: extractRank(payRecord, rank),
      yearsOfService: extractYearsOfService(payRecord, yearsOfService),
      base: OFFICIAL_BAH.canonicalizeBase(base),
      dependents,
      monthly: {
        basicPay: basicPayMonthly,
        bas: basMonthly,
        bah: bahMonthly,
        grossMonthlyComp: grossMonthlyComp
      },
      detail: {
        dutyZip: OFFICIAL_BAH.getDutyZip(base),
        bahRecord: bahRecord,
        bahLookup: bahResult,
        payRecord: payRecord
      },
      sourceVersions: getSourceVersions()
    };
  }

  // ============================================================
  // //#4) VA-ONLY MONTHLY COMP
  // ============================================================
  function getVAOnlyComp(input) {
    if (!input || typeof input !== "object") {
      throw new Error("Input object is required for getVAOnlyComp().");
    }

    const vaRecord = OFFICIAL_VA.getVACompensation({
      rating: input.vaRating ?? input.rating,
      spouse: input.spouse,
      dependentParents: input.dependentParents,
      childrenUnder18: input.childrenUnder18,
      childrenInSchoolOver18: input.childrenInSchoolOver18
    });

    return {
      lane: "VA_ONLY",
      mode: "VETERAN",
      monthly: {
        vaCompensation: round2(vaRecord.monthlyVA),
        grossMonthlyComp: round2(vaRecord.monthlyVA)
      },
      detail: {
        vaRecord: vaRecord
      },
      sourceVersions: getSourceVersions()
    };
  }

  // ============================================================
  // //#5) RETIREMENT-ONLY MONTHLY COMP
  // ============================================================
  function getRetirementOnlyComp(input) {
    if (!input || typeof input !== "object") {
      throw new Error("Input object is required for getRetirementOnlyComp().");
    }

    const retirementRecord = OFFICIAL_RETIREMENT.getRetirementPay({
      retirementSystem: input.retirementSystem,
      yearsOfService: input.yos ?? input.yearsOfService,
      monthlyBasicPayAtRetirement: input.monthlyBasicPayAtRetirement,
      high36MonthlyArray: input.high36MonthlyArray
    });

    return {
      lane: "RETIREMENT_ONLY",
      mode: "RETIRED",
      monthly: {
        retiredPayGross: round2(retirementRecord.grossMonthlyRetiredPay),
        grossMonthlyComp: round2(retirementRecord.grossMonthlyRetiredPay)
      },
      detail: {
        retirementRecord: retirementRecord
      },
      sourceVersions: getSourceVersions()
    };
  }

  // ============================================================
  // //#6) RETIREMENT + VA MONTHLY COMP
  // ============================================================
  function getRetiredVeteranComp(input) {
    if (!input || typeof input !== "object") {
      throw new Error("Input object is required for getRetiredVeteranComp().");
    }

    const retirementRecord = OFFICIAL_RETIREMENT.getRetirementPay({
      retirementSystem: input.retirementSystem,
      yearsOfService: input.yos ?? input.yearsOfService,
      monthlyBasicPayAtRetirement: input.monthlyBasicPayAtRetirement,
      high36MonthlyArray: input.high36MonthlyArray
    });

    const vaRecord = OFFICIAL_VA.getVACompensation({
      rating: input.vaRating ?? input.rating,
      spouse: input.spouse,
      dependentParents: input.dependentParents,
      childrenUnder18: input.childrenUnder18,
      childrenInSchoolOver18: input.childrenInSchoolOver18
    });

    const retiredPayGross = round2(retirementRecord.grossMonthlyRetiredPay);
    const vaCompensation = round2(vaRecord.monthlyVA);
    const combinedMonthlyGross = round2(retiredPayGross + vaCompensation);

    return {
      lane: "RETIRED_VETERAN",
      mode: "RETIRED",
      monthly: {
        retiredPayGross,
        vaCompensation,
        combinedMonthlyGross
      },
      detail: {
        retirementRecord,
        vaRecord
      },
      sourceVersions: getSourceVersions()
    };
  }

  // ============================================================
  // //#7) PROFILE ROUTER
  // ============================================================
  function getCompensationProfile(input) {
    if (!input || typeof input !== "object") {
      throw new Error("Input object is required for getCompensationProfile().");
    }

    const mode = inferMode(input.mode);

    if (mode === "ACTIVE_DUTY") {
      return getActiveDutyComp(input);
    }

    if (mode === "VETERAN") {
      const hasRetirementSystem = !!normalizeString(input.retirementSystem);
      const hasRetirementBase =
        Array.isArray(input.high36MonthlyArray) ||
        input.monthlyBasicPayAtRetirement != null;

      if (hasRetirementSystem && hasRetirementBase) {
        return getRetiredVeteranComp(input);
      }

      return getVAOnlyComp(input);
    }

    if (mode === "RETIRED") {
      const hasVARating = Number.isFinite(Number(input.vaRating ?? input.rating));

      if (hasVARating) {
        return getRetiredVeteranComp(input);
      }

      return getRetirementOnlyComp(input);
    }

    throw new Error(`Unable to route profile mode "${input.mode}".`);
  }

  // ============================================================
  // //#8) LIGHTWEIGHT CONVENIENCE HELPERS
  // ============================================================
  function getActiveDutyGrossMonthly(input) {
    return getActiveDutyComp(input).monthly.grossMonthlyComp;
  }

  function getRetiredGrossMonthly(input) {
    const result = getRetirementOnlyComp(input);
    return result.monthly.grossMonthlyComp;
  }

  function getVeteranGrossMonthly(input) {
    const result = getCompensationProfile(input);

    if (result.lane === "VA_ONLY") {
      return result.monthly.grossMonthlyComp;
    }

    if (result.lane === "RETIRED_VETERAN") {
      return result.monthly.combinedMonthlyGross;
    }

    if (result.monthly && Number.isFinite(Number(result.monthly.grossMonthlyComp))) {
      return result.monthly.grossMonthlyComp;
    }

    throw new Error("Unable to derive veteran gross monthly compensation.");
  }

  // ============================================================
  // //#9) EXPORTS
  // ============================================================
  return Object.freeze({
    ENGINE_VERSION,
    getSourceVersions,
    getActiveDutyComp,
    getVAOnlyComp,
    getRetirementOnlyComp,
    getRetiredVeteranComp,
    getCompensationProfile,
    getActiveDutyGrossMonthly,
    getRetiredGrossMonthly,
    getVeteranGrossMonthly
  });
});
