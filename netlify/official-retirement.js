// official-retirement.js
// ============================================================
// PCSUnited • Official Active Duty Regular Retirement Engine
// v1.0.0
//
// PURPOSE
// - Single source of truth for ACTIVE DUTY REGULAR retirement
// - Supports HIGH3 and BRS only
// - Returns GROSS retired pay only
// - No reserve retirement
// - No medical/disability retirement
// - No CSB/REDUX
// - No SBP, taxes, CRDP, CRSC, VA offset, or deductions
//
// INPUT MODES
// 1) Exact High-3 / BRS base mode:
//    pass high36MonthlyArray: [36 monthly basic pay values]
//
// 2) Estimate mode:
//    pass monthlyBasicPayAtRetirement
//
// NOTES
// - If high36MonthlyArray is provided, it is always used.
// - If not provided, monthlyBasicPayAtRetirement is used as an estimate proxy.
// - Gross retired pay is rounded DOWN to the nearest whole dollar.
// ============================================================

(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.PCSU_OFFICIAL_RETIREMENT = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const RATE_VERSION = "official-retirement-2026.1";

  const SUPPORTED_SYSTEMS = Object.freeze(["HIGH3", "BRS"]);

  // ============================================================
  // //#1) HELPERS
  // ============================================================

  function normalizeSystem(retirementSystem) {
    const s = String(retirementSystem || "").trim().toUpperCase();
    if (!SUPPORTED_SYSTEMS.includes(s)) {
      throw new Error(
        `Unsupported retirementSystem "${retirementSystem}". Supported systems: ${SUPPORTED_SYSTEMS.join(", ")}`
      );
    }
    return s;
  }

  function toFiniteNumber(value, fieldName) {
    const n = Number(value);
    if (!Number.isFinite(n)) {
      throw new Error(`${fieldName} must be a finite number.`);
    }
    return n;
  }

  function toPositiveMoney(value, fieldName) {
    const n = toFiniteNumber(value, fieldName);
    if (n <= 0) {
      throw new Error(`${fieldName} must be greater than 0.`);
    }
    return n;
  }

  function toNonNegativeYears(value, fieldName) {
    const n = toFiniteNumber(value, fieldName);
    if (n < 0) {
      throw new Error(`${fieldName} must be 0 or greater.`);
    }
    return n;
  }

  function floorCurrency(amount) {
    return Math.floor(Number(amount) || 0);
  }

  function round2(amount) {
    return Number((Number(amount) || 0).toFixed(2));
  }

  function validateHigh36Array(high36MonthlyArray) {
    if (!Array.isArray(high36MonthlyArray)) {
      throw new Error("high36MonthlyArray must be an array when provided.");
    }

    if (high36MonthlyArray.length === 0) {
      throw new Error("high36MonthlyArray cannot be empty.");
    }

    const cleaned = high36MonthlyArray.map(function (value, idx) {
      return toPositiveMoney(value, `high36MonthlyArray[${idx}]`);
    });

    return cleaned;
  }

  // ============================================================
  // //#2) CORE FORMULA HELPERS
  // ============================================================

  function getMultiplier(retirementSystem, yearsOfService) {
    const system = normalizeSystem(retirementSystem);
    const yos = toNonNegativeYears(yearsOfService, "yearsOfService");

    if (system === "HIGH3") {
      return round2(yos * 0.025);
    }

    if (system === "BRS") {
      return round2(yos * 0.02);
    }

    throw new Error(`No multiplier rule found for system "${system}".`);
  }

  function getRetiredPayBase(input) {
    const high36 = input && input.high36MonthlyArray;
    const monthlyBasicPayAtRetirement = input && input.monthlyBasicPayAtRetirement;

    if (Array.isArray(high36) && high36.length > 0) {
      const cleaned = validateHigh36Array(high36);
      const sum = cleaned.reduce(function (acc, value) {
        return acc + value;
      }, 0);

      return {
        retiredPayBase: round2(sum / cleaned.length),
        baseMethod: "HIGH36_AVERAGE",
        monthsUsed: cleaned.length
      };
    }

    if (monthlyBasicPayAtRetirement != null) {
      const monthly = toPositiveMoney(
        monthlyBasicPayAtRetirement,
        "monthlyBasicPayAtRetirement"
      );

      return {
        retiredPayBase: round2(monthly),
        baseMethod: "FINAL_MONTH_ESTIMATE",
        monthsUsed: 1
      };
    }

    throw new Error(
      "Provide either high36MonthlyArray or monthlyBasicPayAtRetirement."
    );
  }

  // ============================================================
  // //#3) MAIN API
  // ============================================================

  function getRetirementPay(input) {
    if (!input || typeof input !== "object") {
      throw new Error("Input object is required.");
    }

    const retirementSystem = normalizeSystem(input.retirementSystem);
    const yearsOfService = toNonNegativeYears(input.yearsOfService, "yearsOfService");

    const baseInfo = getRetiredPayBase(input);
    const multiplier = getMultiplier(retirementSystem, yearsOfService);

    const grossMonthlyRetiredPayRaw = baseInfo.retiredPayBase * multiplier;
    const grossMonthlyRetiredPay = floorCurrency(grossMonthlyRetiredPayRaw);

    return {
      retirementSystem,
      yearsOfService: round2(yearsOfService),
      multiplier: round2(multiplier),
      retiredPayBase: round2(baseInfo.retiredPayBase),
      baseMethod: baseInfo.baseMethod,
      monthsUsedForBase: baseInfo.monthsUsed,
      grossMonthlyRetiredPay,
      grossMonthlyRetiredPayRaw: round2(grossMonthlyRetiredPayRaw),
      rateVersion: RATE_VERSION
    };
  }

  // ============================================================
  // //#4) EXPORTS
  // ============================================================

  return Object.freeze({
    RATE_VERSION,
    SUPPORTED_SYSTEMS,
    normalizeSystem,
    getMultiplier,
    getRetiredPayBase,
    getRetirementPay
  });
});
