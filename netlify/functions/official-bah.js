// official-bah.js
// ============================================================
// PCSUnited • Official BAH Engine
// v1.0.0
//
// PURPOSE
// - Single source of truth for 2026 official BAH
// - PCSUnited base scope only (44 supported bases)
// - Uses canonical base aliases + duty ZIP normalization
// - Returns exact with / without dependent BAH by rank
//
// LOOKUP RULE
// - user/base alias
// - -> canonical PCSUnited base
// - -> duty ZIP
// - -> official BAH base record
// - -> rank
// - -> with / without dependents
// - -> exact monthly BAH
//
// NOTES
// - This file does NOT calculate pay.
// - This file does NOT calculate BAS.
// - This file does NOT calculate VA or retirement.
// - This file is BAH authority only.
// ============================================================

(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.PCSU_OFFICIAL_BAH = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const RATE_VERSION = "official-bah-2026.1";

  const SUPPORTED_RANKS = Object.freeze([
    "E-1","E-2","E-3","E-4","E-5","E-6","E-7","E-8","E-9",
    "W-1","W-2","W-3","W-4","W-5",
    "O-1E","O-2E","O-3E",
    "O-1","O-2","O-3","O-4","O-5","O-6","O-7"
  ]);

  // ============================================================
  // //#1) HELPERS
  // ============================================================
  function normalizeString(value) {
    return String(value || "").trim();
  }

  function normalizeRank(rank) {
    const s = String(rank || "").toUpperCase().trim();
    const m = s.match(/^([EOW])\s*[-]?\s*(\d)(E)?$/);
    if (!m) return s.replace(/\s+/g, "");
    return `${m[1]}-${m[2]}${m[3] ? "E" : ""}`;
  }

  function normalizeDependents(dependents) {
    const raw = String(dependents || "").trim().toLowerCase();

    if (["yes", "with", "with_dependents", "true", "1"].includes(raw)) {
      return "with";
    }

    if (["no", "without", "without_dependents", "false", "0"].includes(raw)) {
      return "without";
    }

    throw new Error(
      'Dependents must be one of: "yes", "no", "with_dependents", "without_dependents".'
    );
  }

  function assertSupportedRank(rank) {
    if (!SUPPORTED_RANKS.includes(rank)) {
      throw new Error(
        `Unsupported rank "${rank}". Supported ranks: ${SUPPORTED_RANKS.join(", ")}`
      );
    }
  }

  // ============================================================
  // //#2) CANONICAL BASE ALIAS MAP
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

  function canonicalizeBase(base) {
    const raw = normalizeString(base);
    return BASE_ALIASES[raw] || raw;
  }

  // ============================================================
  // //#3) DUTY ZIP MAP
  // ============================================================
  const BASE_TO_ZIP = Object.freeze({
    "Andrews AFB": "20762",
    "Barksdale AFB": "71110",
    "Beale AFB": "95903",
    "Cannon AFB": "88103",
    "Charleston AFB": "29404",
    "Davis-Monthan AFB": "85707",
    "Dover AFB": "19902",
    "Dyess AFB": "79607",
    "Eglin AFB": "32542",
    "Elmendorf AFB": "99506",
    "F.E-Warren AFB": "82005",
    "Fairchild AFB": "99011",
    "Fort-Sam-Houston AFB": "78234",
    "Holloman AFB": "88330",
    "Hurlburt AFB": "32544",
    "Keesler AFB": "39534",
    "Kirtland AFB": "87117",
    "Lackland AFB": "78236",
    "Langley AFB": "23665",
    "Laughlin AFB": "78843",
    "Little-Rock AFB": "72099",
    "Luke AFB": "85309",
    "MacDill AFB": "33621",
    "Malmstrom AFB": "59402",
    "Maxwell AFB": "36112",
    "McConnell AFB": "67221",
    "McGuire AFB": "08641",
    "Minot AFB": "58705",
    "Moody AFB": "31699",
    "Mountain-Home AFB": "83648",
    "Nellis AFB": "89191",
    "Offutt AFB": "68113",
    "Peterson AFB": "80914",
    "Randolph AFB": "78150",
    "Robins AFB": "31098",
    "Scott AFB": "62225",
    "Seymour-Johnson AFB": "27531",
    "Shaw AFB": "29152",
    "Sheppard AFB": "76311",
    "Tinker AFB": "73145",
    "Travis AFB": "94535",
    "Tyndall AFB": "32403",
    "Whiteman AFB": "65305",
    "Wright-Patterson AFB": "45433"
  });

  function getDutyZip(base) {
    const canonicalBase = canonicalizeBase(base);

    if (!BASE_TO_ZIP[canonicalBase]) {
      throw new Error(`No duty ZIP found for base "${base}".`);
    }

    return BASE_TO_ZIP[canonicalBase];
  }

  // ============================================================
  // //#4) OFFICIAL BAH DATA — FIRST BLOCK OF BASE RECORDS
  // ============================================================
  const BAH_2026_BY_BASE = {
    "Andrews AFB": {
      base: "Andrews AFB",
      dutyZip: "20762",
      mhaCode: "DC053",
      mhaName: "WASHINGTON, DC METRO AREA",
      with: {
        "E-1": 3096, "E-2": 3096, "E-3": 3096, "E-4": 3096, "E-5": 3132,
        "E-6": 3759, "E-7": 3855, "E-8": 3957, "E-9": 4128,
        "W-1": 3780, "W-2": 3894, "W-3": 4023, "W-4": 4167, "W-5": 4350,
        "O-1E": 3870, "O-2E": 4002, "O-3E": 4197,
        "O-1": 3213, "O-2": 3753, "O-3": 4020, "O-4": 4410, "O-5": 4692, "O-6": 4731, "O-7": 4770
      },
      without: {
        "E-1": 2409, "E-2": 2409, "E-3": 2409, "E-4": 2409, "E-5": 2832,
        "E-6": 3057, "E-7": 3099, "E-8": 3261, "E-9": 3447,
        "W-1": 3096, "W-2": 3258, "W-3": 3471, "W-4": 3777, "W-5": 3876,
        "O-1E": 3129, "O-2E": 3405, "O-3E": 3753,
        "O-1": 3054, "O-2": 3126, "O-3": 3531, "O-4": 3855, "O-5": 3909, "O-6": 3999, "O-7": 4071
      }
    },

    "Barksdale AFB": {
      base: "Barksdale AFB",
      dutyZip: "71110",
      mhaCode: "LA117",
      mhaName: "SHREVEPORT/BARKSDALE AFB, LA",
      with: {
        "E-1": 1701, "E-2": 1701, "E-3": 1701, "E-4": 1701, "E-5": 1845,
        "E-6": 2028, "E-7": 2112, "E-8": 2208, "E-9": 2352,
        "W-1": 2043, "W-2": 2151, "W-3": 2271, "W-4": 2382, "W-5": 2520,
        "O-1E": 2127, "O-2E": 2250, "O-3E": 2403,
        "O-1": 1875, "O-2": 2025, "O-3": 2268, "O-4": 2562, "O-5": 2778, "O-6": 2799, "O-7": 2817
      },
      without: {
        "E-1": 1242, "E-2": 1242, "E-3": 1242, "E-4": 1242, "E-5": 1344,
        "E-6": 1410, "E-7": 1557, "E-8": 1740, "E-9": 1911,
        "W-1": 1476, "W-2": 1737, "W-3": 1902, "W-4": 2019, "W-5": 2115,
        "O-1E": 1818, "O-2E": 1986, "O-3E": 2148,
        "O-1": 1407, "O-2": 1734, "O-3": 1893, "O-4": 2166, "O-5": 2358, "O-6": 2379, "O-7": 2397
      }
    },

    "Beale AFB": {
      base: "Beale AFB",
      dutyZip: "95903",
      mhaCode: "CA033",
      mhaName: "BEALE AFB, CA",
      with: {
        "E-1": 2733, "E-2": 2733, "E-3": 2733, "E-4": 2733, "E-5": 2967,
        "E-6": 3132, "E-7": 3150, "E-8": 3159, "E-9": 3195,
        "W-1": 3147, "W-2": 3156, "W-3": 3168, "W-4": 3216, "W-5": 3315,
        "O-1E": 3153, "O-2E": 3162, "O-3E": 3231,
        "O-1": 2994, "O-2": 3129, "O-3": 3165, "O-4": 3342, "O-5": 3492, "O-6": 3522, "O-7": 3546
      },
      without: {
        "E-1": 2133, "E-2": 2133, "E-3": 2133, "E-4": 2133, "E-5": 2367,
        "E-6": 2523, "E-7": 2742, "E-8": 3006, "E-9": 3042,
        "W-1": 2661, "W-2": 3003, "W-3": 3051, "W-4": 3123, "W-5": 3132,
        "O-1E": 2964, "O-2E": 3033, "O-3E": 3120,
        "O-1": 2496, "O-2": 2892, "O-3": 3066, "O-4": 3126, "O-5": 3135, "O-6": 3138, "O-7": 3171
      }
    },

    "Cannon AFB": {
      base: "Cannon AFB",
      dutyZip: "88103",
      mhaCode: "NM207",
      mhaName: "CANNON AFB/CLOVIS, NM",
      with: {
        "E-1": 1260, "E-2": 1260, "E-3": 1260, "E-4": 1260, "E-5": 1365,
        "E-6": 1593, "E-7": 1695, "E-8": 1806, "E-9": 1890,
        "W-1": 1611, "W-2": 1740, "W-3": 1878, "W-4": 1893, "W-5": 1917,
        "O-1E": 1713, "O-2E": 1857, "O-3E": 1896,
        "O-1": 1401, "O-2": 1590, "O-3": 1875, "O-4": 1920, "O-5": 1944, "O-6": 1956, "O-7": 1968
      },
      without: {
        "E-1": 990, "E-2": 990, "E-3": 990, "E-4": 990, "E-5": 1128,
        "E-6": 1284, "E-7": 1320, "E-8": 1428, "E-9": 1518,
        "W-1": 1302, "W-2": 1410, "W-3": 1509, "W-4": 1527, "W-5": 1551,
        "O-1E": 1398, "O-2E": 1503, "O-3E": 1542,
        "O-1": 1158, "O-2": 1281, "O-3": 1506, "O-4": 1551, "O-5": 1575, "O-6": 1587, "O-7": 1602
      }
    },

    "Charleston AFB": {
      base: "Charleston AFB",
      dutyZip: "29404",
      mhaCode: "SC259",
      mhaName: "CHARLESTON, SC",
      with: {
        "E-1": 2220, "E-2": 2220, "E-3": 2220, "E-4": 2220, "E-5": 2385,
        "E-6": 2616, "E-7": 2652, "E-8": 2694, "E-9": 2769,
        "W-1": 2634, "W-2": 2667, "W-3": 2724, "W-4": 2790, "W-5": 2880,
        "O-1E": 2655, "O-2E": 2712, "O-3E": 2802,
        "O-1": 2421, "O-2": 2613, "O-3": 2721, "O-4": 2904, "O-5": 3039, "O-6": 3060, "O-7": 3081
      },
      without: {
        "E-1": 1722, "E-2": 1722, "E-3": 1722, "E-4": 1722, "E-5": 1914,
        "E-6": 2115, "E-7": 2244, "E-8": 2373, "E-9": 2538,
        "W-1": 2124, "W-2": 2367, "W-3": 2532, "W-4": 2667, "W-5": 2769,
        "O-1E": 2337, "O-2E": 2517, "O-3E": 2718,
        "O-1": 1935, "O-2": 2112, "O-3": 2526, "O-4": 2808, "O-5": 3018, "O-6": 3042, "O-7": 3060
      }
    },

    "Davis-Monthan AFB": {
      base: "Davis-Monthan AFB",
      dutyZip: "85707",
      mhaCode: "AZ015",
      mhaName: "DAVIS-MONTHAN AFB, AZ",
      with: {
        "E-1": 1695, "E-2": 1695, "E-3": 1695, "E-4": 1695, "E-5": 1905,
        "E-6": 2121, "E-7": 2145, "E-8": 2178, "E-9": 2253,
        "W-1": 2136, "W-2": 2157, "W-3": 2202, "W-4": 2274, "W-5": 2373,
        "O-1E": 2148, "O-2E": 2190, "O-3E": 2289,
        "O-1": 1938, "O-2": 2118, "O-3": 2199, "O-4": 2400, "O-5": 2550, "O-6": 2568, "O-7": 2583
      },
      without: {
        "E-1": 1272, "E-2": 1272, "E-3": 1272, "E-4": 1272, "E-5": 1428,
        "E-6": 1587, "E-7": 1701, "E-8": 1953, "E-9": 2007,
        "W-1": 1632, "W-2": 1950, "W-3": 2019, "W-4": 2118, "W-5": 2151,
        "O-1E": 1902, "O-2E": 1995, "O-3E": 2109,
        "O-1": 1482, "O-2": 1839, "O-3": 2037, "O-4": 2139, "O-5": 2154, "O-6": 2175, "O-7": 2211
      }
    },

    "Dover AFB": {
      base: "Dover AFB",
      dutyZip: "19902",
      mhaCode: "DE054",
      mhaName: "DOVER AFB/REHOBOTH, DE",
      with: {
        "E-1": 2160, "E-2": 2160, "E-3": 2160, "E-4": 2160, "E-5": 2277,
        "E-6": 2493, "E-7": 2694, "E-8": 2916, "E-9": 3063,
        "W-1": 2511, "W-2": 2787, "W-3": 3060, "W-4": 3066, "W-5": 3075,
        "O-1E": 2736, "O-2E": 3018, "O-3E": 3069,
        "O-1": 2310, "O-2": 2490, "O-3": 3051, "O-4": 3078, "O-5": 3081, "O-6": 3105, "O-7": 3123
      },
      without: {
        "E-1": 1782, "E-2": 1782, "E-3": 1782, "E-4": 1782, "E-5": 1947,
        "E-6": 2052, "E-7": 2163, "E-8": 2325, "E-9": 2379,
        "W-1": 2133, "W-2": 2322, "W-3": 2391, "W-4": 2535, "W-5": 2745,
        "O-1E": 2274, "O-2E": 2367, "O-3E": 2481,
        "O-1": 2043, "O-2": 2241, "O-3": 2409, "O-4": 2706, "O-5": 2832, "O-6": 3039, "O-7": 3090
      }
    },

    "Dyess AFB": {
      base: "Dyess AFB",
      dutyZip: "79607",
      mhaCode: "TX270",
      mhaName: "ABILENE/DYESS AFB, TX",
      with: {
        "E-1": 1458, "E-2": 1458, "E-3": 1458, "E-4": 1458, "E-5": 1554,
        "E-6": 2214, "E-7": 2238, "E-8": 2247, "E-9": 2298,
        "W-1": 2235, "W-2": 2244, "W-3": 2256, "W-4": 2325, "W-5": 2448,
        "O-1E": 2241, "O-2E": 2250, "O-3E": 2343,
        "O-1": 1635, "O-2": 2205, "O-3": 2253, "O-4": 2484, "O-5": 2676, "O-6": 2694, "O-7": 2712
      },
      without: {
        "E-1": 1098, "E-2": 1098, "E-3": 1098, "E-4": 1098, "E-5": 1188,
        "E-6": 1599, "E-7": 1668, "E-8": 1824, "E-9": 1866,
        "W-1": 1620, "W-2": 1821, "W-3": 1857, "W-4": 1932, "W-5": 1974,
        "O-1E": 1827, "O-2E": 1884, "O-3E": 1959,
        "O-1": 1278, "O-2": 1605, "O-3": 1860, "O-4": 1980, "O-5": 2019, "O-6": 2094, "O-7": 2121
      }
    },

    "Eglin AFB": {
      base: "Eglin AFB",
      dutyZip: "32542",
      mhaCode: "FL056",
      mhaName: "EGLIN AFB, FL",
      with: {
        "E-1": 2340, "E-2": 2340, "E-3": 2340, "E-4": 2340, "E-5": 2433,
        "E-6": 2526, "E-7": 2841, "E-8": 3189, "E-9": 3447,
        "W-1": 2544, "W-2": 2985, "W-3": 3414, "W-4": 3456, "W-5": 3516,
        "O-1E": 2910, "O-2E": 3351, "O-3E": 3468,
        "O-1": 2451, "O-2": 2523, "O-3": 3399, "O-4": 3528, "O-5": 3612, "O-6": 3642, "O-7": 3669
      },
      without: {
        "E-1": 2007, "E-2": 2007, "E-3": 2007, "E-4": 2007, "E-5": 2157,
        "E-6": 2250, "E-7": 2340, "E-8": 2457, "E-9": 2586,
        "W-1": 2322, "W-2": 2454, "W-3": 2589, "W-4": 2604, "W-5": 2922,
        "O-1E": 2430, "O-2E": 2514, "O-3E": 2601,
        "O-1": 2244, "O-2": 2406, "O-3": 2592, "O-4": 2865, "O-5": 3066, "O-6": 3393, "O-7": 3453
      }
    },

    "Elmendorf AFB": {
      base: "Elmendorf AFB",
      dutyZip: "99506",
      mhaCode: "AK404",
      mhaName: "ANCHORAGE, AK",
      with: {
        "E-1": 2277, "E-2": 2277, "E-3": 2277, "E-4": 2277, "E-5": 2874,
        "E-6": 2892, "E-7": 3045, "E-8": 3240, "E-9": 3486,
        "W-1": 2895, "W-2": 3123, "W-3": 3369, "W-4": 3528, "W-5": 3723,
        "O-1E": 3078, "O-2E": 3333, "O-3E": 3558,
        "O-1": 2886, "O-2": 2889, "O-3": 3360, "O-4": 3789, "O-5": 4095, "O-6": 4131, "O-7": 4161
      },
      without: {
        "E-1": 1707, "E-2": 1707, "E-3": 1707, "E-4": 1707, "E-5": 2157,
        "E-6": 2169, "E-7": 2283, "E-8": 2430, "E-9": 2616,
        "W-1": 2172, "W-2": 2385, "W-3": 2619, "W-4": 2901, "W-5": 3087,
        "O-1E": 2310, "O-2E": 2523, "O-3E": 2853,
        "O-1": 2166, "O-2": 2286, "O-3": 2643, "O-4": 3051, "O-5": 3162, "O-6": 3348, "O-7": 3405
      }
    },

    "F.E-Warren AFB": {
      base: "F.E-Warren AFB",
      dutyZip: "82005",
      mhaCode: "WY324",
      mhaName: "CHEYENNE, WY",
      with: {
        "E-1": 1656, "E-2": 1656, "E-3": 1656, "E-4": 1656, "E-5": 1728,
        "E-6": 2280, "E-7": 2307, "E-8": 2316, "E-9": 2343,
        "W-1": 2301, "W-2": 2310, "W-3": 2322, "W-4": 2400, "W-5": 2541,
        "O-1E": 2307, "O-2E": 2316, "O-3E": 2427,
        "O-1": 1800, "O-2": 2271, "O-3": 2319, "O-4": 2565, "O-5": 2772, "O-6": 2790, "O-7": 2808
      },
      without: {
        "E-1": 1251, "E-2": 1251, "E-3": 1251, "E-4": 1251, "E-5": 1350,
        "E-6": 1686, "E-7": 1767, "E-8": 1932, "E-9": 2022,
        "W-1": 1704, "W-2": 1929, "W-3": 2019, "W-4": 2124, "W-5": 2181,
        "O-1E": 1944, "O-2E": 2019, "O-3E": 2145,
        "O-1": 1437, "O-2": 1674, "O-3": 2016, "O-4": 2208, "O-5": 2229, "O-6": 2247, "O-7": 2295
      }
    },

    "Fairchild AFB": {
      base: "Fairchild AFB",
      dutyZip: "99011",
      mhaCode: "WA310",
      mhaName: "SPOKANE, WA",
      with: {
        "E-1": 2049, "E-2": 2049, "E-3": 2049, "E-4": 2049, "E-5": 2220,
        "E-6": 2562, "E-7": 2643, "E-8": 2730, "E-9": 2856,
        "W-1": 2580, "W-2": 2670, "W-3": 2772, "W-4": 2874, "W-5": 3003,
        "O-1E": 2670, "O-2E": 2781, "O-3E": 2910,
        "O-1": 2292, "O-2": 2559, "O-3": 2763, "O-4": 3051, "O-5": 3261, "O-6": 3282, "O-7": 3300
      },
      without: {
        "E-1": 1545, "E-2": 1545, "E-3": 1545, "E-4": 1545, "E-5": 1689,
        "E-6": 1806, "E-7": 1953, "E-8": 2136, "E-9": 2250,
        "W-1": 1830, "W-2": 2133, "W-3": 2244, "W-4": 2388, "W-5": 2490,
        "O-1E": 2112, "O-2E": 2232, "O-3E": 2397,
        "O-1": 1758, "O-2": 2046, "O-3": 2262, "O-4": 2436, "O-5": 2460, "O-6": 2496, "O-7": 2544
      }
    },

    "Fort-Sam-Houston AFB": {
      base: "Fort-Sam-Houston AFB",
      dutyZip: "78234",
      mhaCode: "TX285",
      mhaName: "SAN ANTONIO, TX",
      with: {
        "E-1": 1773, "E-2": 1773, "E-3": 1773, "E-4": 1773, "E-5": 1914,
        "E-6": 2166, "E-7": 2211, "E-8": 2259, "E-9": 2331,
        "W-1": 2184, "W-2": 2229, "W-3": 2286, "W-4": 2364, "W-5": 2469,
        "O-1E": 2223, "O-2E": 2280, "O-3E": 2391,
        "O-1": 1947, "O-2": 2163, "O-3": 2283, "O-4": 2496, "O-5": 2652, "O-6": 2670, "O-7": 2688
      },
      without: {
        "E-1": 1374, "E-2": 1374, "E-3": 1374, "E-4": 1374, "E-5": 1530,
        "E-6": 1626, "E-7": 1668, "E-8": 1746, "E-9": 1806,
        "W-1": 1665, "W-2": 1743, "W-3": 1812, "W-4": 1950, "W-5": 2109,
        "O-1E": 1692, "O-2E": 1788, "O-3E": 1908,
        "O-1": 1623, "O-2": 1689, "O-3": 1833, "O-4": 2076, "O-5": 2169, "O-6": 2325, "O-7": 2361
      }
    },

    "Holloman AFB": {
      base: "Holloman AFB",
      dutyZip: "88330",
      mhaCode: "NM205",
      mhaName: "HOLLOMAN AFB/ALAMOGORDO, NM",
      with: {
        "E-1": 1419, "E-2": 1419, "E-3": 1419, "E-4": 1419, "E-5": 1590,
        "E-6": 1869, "E-7": 1890, "E-8": 1899, "E-9": 1980,
        "W-1": 1887, "W-2": 1896, "W-3": 1908, "W-4": 2007, "W-5": 2136,
        "O-1E": 1893, "O-2E": 1902, "O-3E": 2028,
        "O-1": 1632, "O-2": 1866, "O-3": 1905, "O-4": 2175, "O-5": 2376, "O-6": 2394, "O-7": 2406
      },
      without: {
        "E-1": 1107, "E-2": 1107, "E-3": 1107, "E-4": 1107, "E-5": 1260,
        "E-6": 1434, "E-7": 1506, "E-8": 1692, "E-9": 1704,
        "W-1": 1452, "W-2": 1689, "W-3": 1701, "W-4": 1812, "W-5": 1932,
        "O-1E": 1695, "O-2E": 1707, "O-3E": 1821,
        "O-1": 1284, "O-2": 1413, "O-3": 1695, "O-4": 1971, "O-5": 2034, "O-6": 2142, "O-7": 2172
      }
    },

    "Hurlburt AFB": {
      base: "Hurlburt AFB",
      dutyZip: "32544",
      mhaCode: "FL056",
      mhaName: "EGLIN AFB, FL",
      with: {
        "E-1": 2340, "E-2": 2340, "E-3": 2340, "E-4": 2340, "E-5": 2433,
        "E-6": 2526, "E-7": 2841, "E-8": 3189, "E-9": 3447,
        "W-1": 2544, "W-2": 2985, "W-3": 3414, "W-4": 3456, "W-5": 3516,
        "O-1E": 2910, "O-2E": 3351, "O-3E": 3468,
        "O-1": 2451, "O-2": 2523, "O-3": 3399, "O-4": 3528, "O-5": 3612, "O-6": 3642, "O-7": 3669
      },
      without: {
        "E-1": 2007, "E-2": 2007, "E-3": 2007, "E-4": 2007, "E-5": 2157,
        "E-6": 2250, "E-7": 2340, "E-8": 2457, "E-9": 2586,
        "W-1": 2322, "W-2": 2454, "W-3": 2589, "W-4": 2604, "W-5": 2922,
        "O-1E": 2430, "O-2E": 2514, "O-3E": 2601,
        "O-1": 2244, "O-2": 2406, "O-3": 2592, "O-4": 2865, "O-5": 3066, "O-6": 3393, "O-7": 3453
      }
    },

    "Keesler AFB": {
      base: "Keesler AFB",
      dutyZip: "39534",
      mhaCode: "MS168",
      mhaName: "GULFPORT, MS",
      with: {
        "E-1": 2118, "E-2": 2118, "E-3": 2118, "E-4": 2118, "E-5": 2244,
        "E-6": 2307, "E-7": 2331, "E-8": 2358, "E-9": 2403,
        "W-1": 2319, "W-2": 2343, "W-3": 2379, "W-4": 2433, "W-5": 2520,
        "O-1E": 2331, "O-2E": 2367, "O-3E": 2448,
        "O-1": 2208, "O-2": 2286, "O-3": 2388, "O-4": 2550, "O-5": 2673, "O-6": 2694, "O-7": 2712
      },
      without: {
        "E-1": 1629, "E-2": 1629, "E-3": 1629, "E-4": 1629, "E-5": 1740,
        "E-6": 1800, "E-7": 1899, "E-8": 1977, "E-9": 2007,
        "W-1": 1815, "W-2": 1974, "W-3": 2010, "W-4": 2034, "W-5": 2067,
        "O-1E": 1968, "O-2E": 2004, "O-3E": 2040,
        "O-1": 1713, "O-2": 1788, "O-3": 2016, "O-4": 2187, "O-5": 2232, "O-6": 2280, "O-7": 2319
      }
    },

    "Kirtland AFB": {
      base: "Kirtland AFB",
      dutyZip: "87117",
      mhaCode: "NM206",
      mhaName: "ALBUQUERQUE/KIRTLAND AFB, NM",
      with: {
        "E-1": 1992, "E-2": 1992, "E-3": 1992, "E-4": 1992, "E-5": 2211,
        "E-6": 2328, "E-7": 2352, "E-8": 2379, "E-9": 2472,
        "W-1": 2343, "W-2": 2361, "W-3": 2400, "W-4": 2502, "W-5": 2631,
        "O-1E": 2355, "O-2E": 2391, "O-3E": 2520,
        "O-1": 2235, "O-2": 2325, "O-3": 2397, "O-4": 2670, "O-5": 2871, "O-6": 2892, "O-7": 2910
      },
      without: {
        "E-1": 1548, "E-2": 1548, "E-3": 1548, "E-4": 1548, "E-5": 1686,
        "E-6": 1764, "E-7": 1872, "E-8": 1989, "E-9": 2139,
        "W-1": 1788, "W-2": 1971, "W-3": 2148, "W-4": 2244, "W-5": 2355,
        "O-1E": 1959, "O-2E": 2142, "O-3E": 2238,
        "O-1": 1731, "O-2": 1779, "O-3": 2139, "O-4": 2475, "O-5": 2718, "O-6": 2742, "O-7": 2763
      }
    },

    "Lackland AFB": {
      base: "Lackland AFB",
      dutyZip: "78236",
      mhaCode: "TX285",
      mhaName: "SAN ANTONIO, TX",
      with: {
        "E-1": 1773, "E-2": 1773, "E-3": 1773, "E-4": 1773, "E-5": 1914,
        "E-6": 2166, "E-7": 2211, "E-8": 2259, "E-9": 2331,
        "W-1": 2184, "W-2": 2229, "W-3": 2286, "W-4": 2364, "W-5": 2469,
        "O-1E": 2223, "O-2E": 2280, "O-3E": 2391,
        "O-1": 1947, "O-2": 2163, "O-3": 2283, "O-4": 2496, "O-5": 2652, "O-6": 2670, "O-7": 2688
      },
      without: {
        "E-1": 1374, "E-2": 1374, "E-3": 1374, "E-4": 1374, "E-5": 1530,
        "E-6": 1626, "E-7": 1668, "E-8": 1746, "E-9": 1806,
        "W-1": 1665, "W-2": 1743, "W-3": 1812, "W-4": 1950, "W-5": 2109,
        "O-1E": 1692, "O-2E": 1788, "O-3E": 1908,
        "O-1": 1623, "O-2": 1689, "O-3": 1833, "O-4": 2076, "O-5": 2169, "O-6": 2325, "O-7": 2361
      }
    },

    "Langley AFB": {
      base: "Langley AFB",
      dutyZip: "23665",
      mhaCode: "VA297",
      mhaName: "HAMPTON/NEWPORT NEWS, VA",
      with: {
        "E-1": 2205, "E-2": 2205, "E-3": 2205, "E-4": 2205, "E-5": 2433,
        "E-6": 2646, "E-7": 2736, "E-8": 2832, "E-9": 2997,
        "W-1": 2664, "W-2": 2826, "W-3": 3003, "W-4": 3135, "W-5": 3300,
        "O-1E": 2790, "O-2E": 2979, "O-3E": 3168,
        "O-1": 2460, "O-2": 2640, "O-3": 2991, "O-4": 3354, "O-5": 3612, "O-6": 3642, "O-7": 3672
      },
      without: {
        "E-1": 1686, "E-2": 1686, "E-3": 1686, "E-4": 1686, "E-5": 1851,
        "E-6": 1965, "E-7": 2061, "E-8": 2223, "E-9": 2295,
        "W-1": 2046, "W-2": 2211, "W-3": 2304, "W-4": 2442, "W-5": 2616,
        "O-1E": 2187, "O-2E": 2304, "O-3E": 2475,
        "O-1": 1944, "O-2": 2133, "O-3": 2328, "O-4": 2640, "O-5": 2817, "O-6": 3027, "O-7": 3063
      }
    },

    "Laughlin AFB": {
      base: "Laughlin AFB",
      dutyZip: "78843",
      mhaCode: "TX278",
      mhaName: "LAUGHLIN AFB/DEL RIO, TX",
      with: {
        "E-1": 1371, "E-2": 1371, "E-3": 1371, "E-4": 1371, "E-5": 1470,
        "E-6": 1704, "E-7": 1854, "E-8": 2019, "E-9": 2238,
        "W-1": 1722, "W-2": 1923, "W-3": 2127, "W-4": 2280, "W-5": 2466,
        "O-1E": 1884, "O-2E": 2097, "O-3E": 2307,
        "O-1": 1506, "O-2": 1701, "O-3": 2121, "O-4": 2526, "O-5": 2820, "O-6": 2841, "O-7": 2859
      },
      without: {
        "E-1": 1053, "E-2": 1053, "E-3": 1053, "E-4": 1053, "E-5": 1146,
        "E-6": 1287, "E-7": 1377, "E-8": 1518, "E-9": 1659,
        "W-1": 1308, "W-2": 1470, "W-3": 1674, "W-4": 1836, "W-5": 1968,
        "O-1E": 1458, "O-2E": 1644, "O-3E": 1860,
        "O-1": 1170, "O-2": 1290, "O-3": 1659, "O-4": 1983, "O-5": 2046, "O-6": 2058, "O-7": 2073
      }
    },

    "Little-Rock AFB": {
      base: "Little-Rock AFB",
      dutyZip: "72099",
      mhaCode: "AR010",
      mhaName: "LITTLE ROCK, AR",
      with: {
        "E-1": 1758, "E-2": 1758, "E-3": 1758, "E-4": 1758, "E-5": 1848,
        "E-6": 1941, "E-7": 1959, "E-8": 1968, "E-9": 2061,
        "W-1": 1956, "W-2": 1965, "W-3": 1977, "W-4": 2100, "W-5": 2274,
        "O-1E": 1962, "O-2E": 1971, "O-3E": 2127,
        "O-1": 1869, "O-2": 1938, "O-3": 1974, "O-4": 2328, "O-5": 2598, "O-6": 2619, "O-7": 2634
      },
      without: {
        "E-1": 1341, "E-2": 1341, "E-3": 1341, "E-4": 1341, "E-5": 1548,
        "E-6": 1671, "E-7": 1758, "E-8": 1875, "E-9": 1887,
        "W-1": 1740, "W-2": 1872, "W-3": 1893, "W-4": 1932, "W-5": 1947,
        "O-1E": 1845, "O-2E": 1884, "O-3E": 1929,
        "O-1": 1665, "O-2": 1824, "O-3": 1902, "O-4": 1935, "O-5": 1950, "O-6": 1965, "O-7": 1977
      }
    },

    "Luke AFB": {
      base: "Luke AFB",
      dutyZip: "85309",
      mhaCode: "AZ013",
      mhaName: "PHOENIX, AZ",
      with: {
        "E-1": 2061, "E-2": 2061, "E-3": 2061, "E-4": 2061, "E-5": 2289,
        "E-6": 2457, "E-7": 2475, "E-8": 2484, "E-9": 2517,
        "W-1": 2472, "W-2": 2481, "W-3": 2493, "W-4": 2535, "W-5": 2622,
        "O-1E": 2478, "O-2E": 2487, "O-3E": 2547,
        "O-1": 2319, "O-2": 2454, "O-3": 2490, "O-4": 2646, "O-5": 2775, "O-6": 2796, "O-7": 2814
      },
      without: {
        "E-1": 1587, "E-2": 1587, "E-3": 1587, "E-4": 1587, "E-5": 1740,
        "E-6": 1857, "E-7": 2070, "E-8": 2331, "E-9": 2367,
        "W-1": 1992, "W-2": 2328, "W-3": 2376, "W-4": 2448, "W-5": 2460,
        "O-1E": 2286, "O-2E": 2358, "O-3E": 2445,
        "O-1": 1830, "O-2": 2217, "O-3": 2391, "O-4": 2451, "O-5": 2463, "O-6": 2466, "O-7": 2487
      }
    },

    "MacDill AFB": {
      base: "MacDill AFB",
      dutyZip: "33621",
      mhaCode: "FL066",
      mhaName: "TAMPA, FL",
      with: {
        "E-1": 2520, "E-2": 2520, "E-3": 2520, "E-4": 2520, "E-5": 2709,
        "E-6": 3042, "E-7": 3066, "E-8": 3075, "E-9": 3123,
        "W-1": 3063, "W-2": 3072, "W-3": 3084, "W-4": 3141, "W-5": 3231,
        "O-1E": 3069, "O-2E": 3078, "O-3E": 3156,
        "O-1": 2757, "O-2": 3039, "O-3": 3081, "O-4": 3255, "O-5": 3390, "O-6": 3417, "O-7": 3441
      },
      without: {
        "E-1": 1932, "E-2": 1932, "E-3": 1932, "E-4": 1932, "E-5": 2187,
        "E-6": 2346, "E-7": 2526, "E-8": 2781, "E-9": 2874,
        "W-1": 2463, "W-2": 2778, "W-3": 2886, "W-4": 3039, "W-5": 3054,
        "O-1E": 2706, "O-2E": 2853, "O-3E": 3036,
        "O-1": 2328, "O-2": 2649, "O-3": 2919, "O-4": 3042, "O-5": 3057, "O-6": 3060, "O-7": 3102
      }
    },

    "Malmstrom AFB": {
      base: "Malmstrom AFB",
      dutyZip: "59402",
      mhaCode: "MT175",
      mhaName: "MALMSTROM SFB/GREAT FALLS, MT",
      with: {
        "E-1": 1539, "E-2": 1539, "E-3": 1539, "E-4": 1539, "E-5": 1608,
        "E-6": 1821, "E-7": 1980, "E-8": 2160, "E-9": 2346,
        "W-1": 1839, "W-2": 2052, "W-3": 2274, "W-4": 2373, "W-5": 2496,
        "O-1E": 2013, "O-2E": 2241, "O-3E": 2391,
        "O-1": 1641, "O-2": 1818, "O-3": 2268, "O-4": 2532, "O-5": 2724, "O-6": 2745, "O-7": 2760
      },
      without: {
        "E-1": 1266, "E-2": 1266, "E-3": 1266, "E-4": 1266, "E-5": 1392,
        "E-6": 1470, "E-7": 1539, "E-8": 1656, "E-9": 1761,
        "W-1": 1530, "W-2": 1653, "W-3": 1764, "W-4": 1851, "W-5": 2022,
        "O-1E": 1605, "O-2E": 1698, "O-3E": 1809,
        "O-1": 1467, "O-2": 1590, "O-3": 1767, "O-4": 1989, "O-5": 2088, "O-6": 2253, "O-7": 2289
      }
    },

    "Maxwell AFB": {
      base: "Maxwell AFB",
      dutyZip: "36112",
      mhaCode: "AL005",
      mhaName: "MONTGOMERY, AL",
      with: {
        "E-1": 1605, "E-2": 1605, "E-3": 1605, "E-4": 1605, "E-5": 1683,
        "E-6": 1758, "E-7": 1818, "E-8": 1887, "E-9": 2034,
        "W-1": 1773, "W-2": 1845, "W-3": 1935, "W-4": 2073, "W-5": 2244,
        "O-1E": 1827, "O-2E": 1920, "O-3E": 2100,
        "O-1": 1701, "O-2": 1755, "O-3": 1932, "O-4": 2298, "O-5": 2565, "O-6": 2583, "O-7": 2598
      },
      without: {
        "E-1": 1269, "E-2": 1269, "E-3": 1269, "E-4": 1269, "E-5": 1431,
        "E-6": 1527, "E-7": 1605, "E-8": 1704, "E-9": 1713,
        "W-1": 1590, "W-2": 1701, "W-3": 1719, "W-4": 1764, "W-5": 1833,
        "O-1E": 1680, "O-2E": 1710, "O-3E": 1746,
        "O-1": 1524, "O-2": 1662, "O-3": 1725, "O-4": 1815, "O-5": 1923, "O-6": 1938, "O-7": 1950
      }
    },

    "McConnell AFB": {
      base: "McConnell AFB",
      dutyZip: "67221",
      mhaCode: "KS101",
      mhaName: "WICHITA/MCCONNELL AFB, KS",
      with: {
        "E-1": 1320, "E-2": 1320, "E-3": 1320, "E-4": 1320, "E-5": 1377,
        "E-6": 1689, "E-7": 1779, "E-8": 1878, "E-9": 2022,
        "W-1": 1710, "W-2": 1821, "W-3": 1941, "W-4": 2052, "W-5": 2190,
        "O-1E": 1797, "O-2E": 1923, "O-3E": 2073,
        "O-1": 1422, "O-2": 1686, "O-3": 1938, "O-4": 2232, "O-5": 2445, "O-6": 2463, "O-7": 2478
      },
      without: {
        "E-1": 1002, "E-2": 1002, "E-3": 1002, "E-4": 1002, "E-5": 1053,
        "E-6": 1341, "E-7": 1419, "E-8": 1491, "E-9": 1611,
        "W-1": 1362, "W-2": 1443, "W-3": 1572, "W-4": 1707, "W-5": 1842,
        "O-1E": 1509, "O-2E": 1641, "O-3E": 1794,
        "O-1": 1113, "O-2": 1338, "O-3": 1572, "O-4": 1878, "O-5": 2100, "O-6": 2121, "O-7": 2136
      }
    },

    "McGuire AFB": {
      base: "McGuire AFB",
      dutyZip: "08641",
      mhaCode: "NJ204",
      mhaName: "JB MCGUIRE-DIX-LAKEHURST, NJ",
      with: {
        "E-1": 2715, "E-2": 2715, "E-3": 2715, "E-4": 2715, "E-5": 2823,
        "E-6": 3444, "E-7": 3486, "E-8": 3525, "E-9": 3642,
        "W-1": 3465, "W-2": 3501, "W-3": 3555, "W-4": 3678, "W-5": 3831,
        "O-1E": 3489, "O-2E": 3543, "O-3E": 3702,
        "O-1": 2904, "O-2": 3438, "O-3": 3552, "O-4": 3882, "O-5": 4122, "O-6": 4155, "O-7": 4188
      },
      without: {
        "E-1": 2148, "E-2": 2148, "E-3": 2148, "E-4": 2148, "E-5": 2235,
        "E-6": 2682, "E-7": 2730, "E-8": 2799, "E-9": 2937,
        "W-1": 2706, "W-2": 2772, "W-3": 2874, "W-4": 2985, "W-5": 3132,
        "O-1E": 2745, "O-2E": 2844, "O-3E": 2997,
        "O-1": 2319, "O-2": 2676, "O-3": 2886, "O-4": 3210, "O-5": 3444, "O-6": 3789, "O-7": 3831
      }
    },

    "Minot AFB": {
      base: "Minot AFB",
      dutyZip: "58705",
      mhaCode: "ND191",
      mhaName: "MINOT AFB, ND",
      with: {
        "E-1": 1428, "E-2": 1428, "E-3": 1428, "E-4": 1428, "E-5": 1548,
        "E-6": 1980, "E-7": 2052, "E-8": 2127, "E-9": 2229,
        "W-1": 2001, "W-2": 2082, "W-3": 2178, "W-4": 2247, "W-5": 2343,
        "O-1E": 2064, "O-2E": 2163, "O-3E": 2262,
        "O-1": 1605, "O-2": 1977, "O-3": 2175, "O-4": 2367, "O-5": 2508, "O-6": 2526, "O-7": 2541
      },
      without: {
        "E-1": 1089, "E-2": 1089, "E-3": 1089, "E-4": 1089, "E-5": 1191,
        "E-6": 1320, "E-7": 1374, "E-8": 1527, "E-9": 1611,
        "W-1": 1338, "W-2": 1524, "W-3": 1623, "W-4": 1773, "W-5": 1848,
        "O-1E": 1458, "O-2E": 1590, "O-3E": 1755,
        "O-1": 1245, "O-2": 1431, "O-3": 1650, "O-4": 1830, "O-5": 1869, "O-6": 1938, "O-7": 1968
      }
    },

    "Moody AFB": {
      base: "Moody AFB",
      dutyZip: "31699",
      mhaCode: "GA081",
      mhaName: "MOODY AFB, GA",
      with: {
        "E-1": 1503, "E-2": 1503, "E-3": 1503, "E-4": 1503, "E-5": 1524,
        "E-6": 1917, "E-7": 1950, "E-8": 1980, "E-9": 2097,
        "W-1": 1938, "W-2": 1962, "W-3": 2007, "W-4": 2130, "W-5": 2289,
        "O-1E": 1953, "O-2E": 1995, "O-3E": 2157,
        "O-1": 1578, "O-2": 1914, "O-3": 2004, "O-4": 2340, "O-5": 2589, "O-6": 2607, "O-7": 2622
      },
      without: {
        "E-1": 1320, "E-2": 1320, "E-3": 1320, "E-4": 1320, "E-5": 1416,
        "E-6": 1479, "E-7": 1512, "E-8": 1608, "E-9": 1722,
        "W-1": 1509, "W-2": 1605, "W-3": 1737, "W-4": 1920, "W-5": 1956,
        "O-1E": 1524, "O-2E": 1695, "O-3E": 1911,
        "O-1": 1476, "O-2": 1521, "O-3": 1773, "O-4": 1941, "O-5": 1959, "O-6": 1980, "O-7": 2013
      }
    },

    "Mountain-Home AFB": {
      base: "Mountain-Home AFB",
      dutyZip: "83648",
      mhaCode: "ID086",
      mhaName: "MOUNTAIN HOME AFB, ID",
      with: {
        "E-1": 1563, "E-2": 1563, "E-3": 1563, "E-4": 1563, "E-5": 1605,
        "E-6": 2187, "E-7": 2238, "E-8": 2292, "E-9": 2418,
        "W-1": 2208, "W-2": 2259, "W-3": 2328, "W-4": 2451, "W-5": 2610,
        "O-1E": 2244, "O-2E": 2316, "O-3E": 2478,
        "O-1": 1680, "O-2": 2181, "O-3": 2325, "O-4": 2658, "O-5": 2901, "O-6": 2925, "O-7": 2943
      },
      without: {
        "E-1": 1521, "E-2": 1521, "E-3": 1521, "E-4": 1521, "E-5": 1524,
        "E-6": 1641, "E-7": 1680, "E-8": 1725, "E-9": 1899,
        "W-1": 1656, "W-2": 1722, "W-3": 1920, "W-4": 2196, "W-5": 2250,
        "O-1E": 1686, "O-2E": 1860, "O-3E": 2181,
        "O-1": 1527, "O-2": 1683, "O-3": 1977, "O-4": 2232, "O-5": 2259, "O-6": 2304, "O-7": 2343
      }
    },

    "Nellis AFB": {
      base: "Nellis AFB",
      dutyZip: "89191",
      mhaCode: "NV212",
      mhaName: "NELLIS AFB/LAS VEGAS, NV",
      with: {
        "E-1": 1941, "E-2": 1941, "E-3": 1941, "E-4": 1941, "E-5": 2070,
        "E-6": 2208, "E-7": 2268, "E-8": 2337, "E-9": 2445,
        "W-1": 2223, "W-2": 2298, "W-3": 2385, "W-4": 2469, "W-5": 2577,
        "O-1E": 2277, "O-2E": 2370, "O-3E": 2487,
        "O-1": 2094, "O-2": 2205, "O-3": 2382, "O-4": 2610, "O-5": 2775, "O-6": 2796, "O-7": 2814
      },
      without: {
        "E-1": 1461, "E-2": 1461, "E-3": 1461, "E-4": 1461, "E-5": 1566,
        "E-6": 1689, "E-7": 1803, "E-8": 1935, "E-9": 1986,
        "W-1": 1710, "W-2": 1929, "W-3": 1983, "W-4": 2070, "W-5": 2139,
        "O-1E": 1884, "O-2E": 1968, "O-3E": 2076,
        "O-1": 1560, "O-2": 1794, "O-3": 2001, "O-4": 2121, "O-5": 2139, "O-6": 2145, "O-7": 2169
      }
    },


        "Offutt AFB": {
      base: "Offutt AFB",
      dutyZip: "68113",
      mhaCode: "NE192",
      mhaName: "OMAHA/OFFUTT AFB, NE",
      with: {
        "E-1": 1887, "E-2": 1887, "E-3": 1887, "E-4": 1887, "E-5": 2085,
        "E-6": 2376, "E-7": 2457, "E-8": 2547, "E-9": 2706,
        "W-1": 2394, "W-2": 2493, "W-3": 2604, "W-4": 2742, "W-5": 2913,
        "O-1E": 2472, "O-2E": 2586, "O-3E": 2769,
        "O-1": 2127, "O-2": 2373, "O-3": 2601, "O-4": 2967, "O-5": 3231, "O-6": 3258, "O-7": 3279
      },
      without: {
        "E-1": 1491, "E-2": 1491, "E-3": 1491, "E-4": 1491, "E-5": 1674,
        "E-6": 1797, "E-7": 1836, "E-8": 1908, "E-9": 1959,
        "W-1": 1803, "W-2": 1890, "W-3": 1938, "W-4": 2034, "W-5": 2151,
        "O-1E": 1866, "O-2E": 1917, "O-3E": 2019,
        "O-1": 1794, "O-2": 1833, "O-3": 1956, "O-4": 2196, "O-5": 2289, "O-6": 2451, "O-7": 2499
      }
    },

    "Peterson AFB": {
      base: "Peterson AFB",
      dutyZip: "80914",
      mhaCode: "CO046",
      mhaName: "COLORADO SPRINGS, CO",
      with: {
        "E-1": 2160, "E-2": 2160, "E-3": 2160, "E-4": 2160, "E-5": 2358,
        "E-6": 2433, "E-7": 2487, "E-8": 2553, "E-9": 2646,
        "W-1": 2448, "W-2": 2514, "W-3": 2598, "W-4": 2664, "W-5": 2754,
        "O-1E": 2496, "O-2E": 2583, "O-3E": 2679,
        "O-1": 2376, "O-2": 2430, "O-3": 2595, "O-4": 2778, "O-5": 2913, "O-6": 2934, "O-7": 2955
      },
      without: {
        "E-1": 1689, "E-2": 1689, "E-3": 1689, "E-4": 1689, "E-5": 1860,
        "E-6": 1980, "E-7": 2166, "E-8": 2379, "E-9": 2388,
        "W-1": 2103, "W-2": 2376, "W-3": 2394, "W-4": 2436, "W-5": 2502,
        "O-1E": 2355, "O-2E": 2385, "O-3E": 2418,
        "O-1": 1959, "O-2": 2295, "O-3": 2397, "O-4": 2484, "O-5": 2517, "O-6": 2574, "O-7": 2616
      }
    },

    "Randolph AFB": {
      base: "Randolph AFB",
      dutyZip: "78150",
      mhaCode: "TX285",
      mhaName: "SAN ANTONIO, TX",
      with: {
        "E-1": 1773, "E-2": 1773, "E-3": 1773, "E-4": 1773, "E-5": 1914,
        "E-6": 2166, "E-7": 2211, "E-8": 2259, "E-9": 2331,
        "W-1": 2184, "W-2": 2229, "W-3": 2286, "W-4": 2364, "W-5": 2469,
        "O-1E": 2223, "O-2E": 2280, "O-3E": 2391,
        "O-1": 1947, "O-2": 2163, "O-3": 2283, "O-4": 2496, "O-5": 2652, "O-6": 2670, "O-7": 2688
      },
      without: {
        "E-1": 1374, "E-2": 1374, "E-3": 1374, "E-4": 1374, "E-5": 1530,
        "E-6": 1626, "E-7": 1668, "E-8": 1746, "E-9": 1806,
        "W-1": 1665, "W-2": 1743, "W-3": 1812, "W-4": 1950, "W-5": 2109,
        "O-1E": 1692, "O-2E": 1788, "O-3E": 1908,
        "O-1": 1623, "O-2": 1689, "O-3": 1833, "O-4": 2076, "O-5": 2169, "O-6": 2325, "O-7": 2361
      }
    },

    "Robins AFB": {
      base: "Robins AFB",
      dutyZip: "31098",
      mhaCode: "GA076",
      mhaName: "ROBINS AFB, GA",
      with: {
        "E-1": 1692, "E-2": 1692, "E-3": 1692, "E-4": 1692, "E-5": 1800,
        "E-6": 1878, "E-7": 1992, "E-8": 2118, "E-9": 2283,
        "W-1": 1893, "W-2": 2043, "W-3": 2202, "W-4": 2313, "W-5": 2451,
        "O-1E": 2013, "O-2E": 2178, "O-3E": 2334,
        "O-1": 1818, "O-2": 1875, "O-3": 2199, "O-4": 2496, "O-5": 2709, "O-6": 2730, "O-7": 2745
      },
      without: {
        "E-1": 1341, "E-2": 1341, "E-3": 1341, "E-4": 1341, "E-5": 1491,
        "E-6": 1590, "E-7": 1695, "E-8": 1824, "E-9": 1833,
        "W-1": 1668, "W-2": 1821, "W-3": 1839, "W-4": 1896, "W-5": 2019,
        "O-1E": 1797, "O-2E": 1830, "O-3E": 1866,
        "O-1": 1581, "O-2": 1770, "O-3": 1842, "O-4": 1992, "O-5": 2064, "O-6": 2181, "O-7": 2217
      }
    },

    "Scott AFB": {
      base: "Scott AFB",
      dutyZip: "62225",
      mhaCode: "IL093",
      mhaName: "SCOTT AFB, IL",
      with: {
        "E-1": 1536, "E-2": 1536, "E-3": 1536, "E-4": 1536, "E-5": 1542,
        "E-6": 1998, "E-7": 2076, "E-8": 2157, "E-9": 2325,
        "W-1": 2019, "W-2": 2109, "W-3": 2211, "W-4": 2367, "W-5": 2562,
        "O-1E": 2088, "O-2E": 2193, "O-3E": 2397,
        "O-1": 1602, "O-2": 1995, "O-3": 2208, "O-4": 2625, "O-5": 2928, "O-6": 2952, "O-7": 2970
      },
      without: {
        "E-1": 1233, "E-2": 1233, "E-3": 1233, "E-4": 1233, "E-5": 1422,
        "E-6": 1530, "E-7": 1557, "E-8": 1638, "E-9": 1770,
        "W-1": 1551, "W-2": 1635, "W-3": 1788, "W-4": 2013, "W-5": 2094,
        "O-1E": 1566, "O-2E": 1740, "O-3E": 1992,
        "O-1": 1527, "O-2": 1560, "O-3": 1830, "O-4": 2073, "O-5": 2196, "O-6": 2214, "O-7": 2229
      }
    },

    "Seymour-Johnson AFB": {
      base: "Seymour-Johnson AFB",
      dutyZip: "27531",
      mhaCode: "NC183",
      mhaName: "SEYMOUR JOHNSON AFB, NC",
      with: {
        "E-1": 1500, "E-2": 1500, "E-3": 1500, "E-4": 1500, "E-5": 1521,
        "E-6": 1950, "E-7": 2052, "E-8": 2160, "E-9": 2295,
        "W-1": 1971, "W-2": 2094, "W-3": 2229, "W-4": 2322, "W-5": 2436,
        "O-1E": 2067, "O-2E": 2208, "O-3E": 2340,
        "O-1": 1578, "O-2": 1947, "O-3": 2226, "O-4": 2472, "O-5": 2649, "O-6": 2667, "O-7": 2685
      },
      without: {
        "E-1": 1131, "E-2": 1131, "E-3": 1131, "E-4": 1131, "E-5": 1158,
        "E-6": 1533, "E-7": 1620, "E-8": 1716, "E-9": 1848,
        "W-1": 1551, "W-2": 1662, "W-3": 1782, "W-4": 1884, "W-5": 1974,
        "O-1E": 1638, "O-2E": 1755, "O-3E": 1881,
        "O-1": 1185, "O-2": 1530, "O-3": 1782, "O-4": 2010, "O-5": 2178, "O-6": 2196, "O-7": 2211
      }
    },

    "Shaw AFB": {
      base: "Shaw AFB",
      dutyZip: "29152",
      mhaCode: "SC263",
      mhaName: "SUMTER/SHAW AFB, SC",
      with: {
        "E-1": 1440, "E-2": 1440, "E-3": 1440, "E-4": 1440, "E-5": 1503,
        "E-6": 1947, "E-7": 1986, "E-8": 2025, "E-9": 2139,
        "W-1": 1968, "W-2": 2001, "W-3": 2055, "W-4": 2169, "W-5": 2316,
        "O-1E": 1989, "O-2E": 2043, "O-3E": 2193,
        "O-1": 1563, "O-2": 1944, "O-3": 2052, "O-4": 2361, "O-5": 2589, "O-6": 2607, "O-7": 2625
      },
      without: {
        "E-1": 1074, "E-2": 1074, "E-3": 1074, "E-4": 1074, "E-5": 1110,
        "E-6": 1536, "E-7": 1605, "E-8": 1719, "E-9": 1740,
        "W-1": 1551, "W-2": 1716, "W-3": 1728, "W-4": 1818, "W-5": 1902,
        "O-1E": 1710, "O-2E": 1722, "O-3E": 1812,
        "O-1": 1131, "O-2": 1533, "O-3": 1725, "O-4": 1935, "O-5": 1959, "O-6": 1983, "O-7": 2022
      }
    },

    "Sheppard AFB": {
      base: "Sheppard AFB",
      dutyZip: "76311",
      mhaCode: "TX288",
      mhaName: "WICHITA FLS/SHEPPARD AFB, TX",
      with: {
        "E-1": 1392, "E-2": 1392, "E-3": 1392, "E-4": 1392, "E-5": 1491,
        "E-6": 2112, "E-7": 2190, "E-8": 2271, "E-9": 2427,
        "W-1": 2133, "W-2": 2223, "W-3": 2328, "W-4": 2463, "W-5": 2634,
        "O-1E": 2202, "O-2E": 2310, "O-3E": 2490,
        "O-1": 1572, "O-2": 2106, "O-3": 2325, "O-4": 2691, "O-5": 2955, "O-6": 2979, "O-7": 2997
      },
      without: {
        "E-1": 1044, "E-2": 1044, "E-3": 1044, "E-4": 1044, "E-5": 1182,
        "E-6": 1584, "E-7": 1644, "E-8": 1704, "E-9": 1821,
        "W-1": 1602, "W-2": 1668, "W-3": 1827, "W-4": 2127, "W-5": 2208,
        "O-1E": 1653, "O-2E": 1764, "O-3E": 2106,
        "O-1": 1290, "O-2": 1647, "O-3": 1887, "O-4": 2187, "O-5": 2229, "O-6": 2304, "O-7": 2343
      }
    },

    "Tinker AFB": {
      base: "Tinker AFB",
      dutyZip: "73145",
      mhaCode: "OK239",
      mhaName: "OKLAHOMA CITY, OK",
      with: {
        "E-1": 1758, "E-2": 1758, "E-3": 1758, "E-4": 1758, "E-5": 1944,
        "E-6": 2136, "E-7": 2175, "E-8": 2217, "E-9": 2271,
        "W-1": 2157, "W-2": 2193, "W-3": 2250, "W-4": 2340, "W-5": 2463,
        "O-1E": 2184, "O-2E": 2238, "O-3E": 2361,
        "O-1": 1995, "O-2": 2154, "O-3": 2259, "O-4": 2514, "O-5": 2700, "O-6": 2718, "O-7": 2736
      },
      without: {
        "E-1": 1338, "E-2": 1338, "E-3": 1338, "E-4": 1338, "E-5": 1494,
        "E-6": 1656, "E-7": 1707, "E-8": 1764, "E-9": 1827,
        "W-1": 1671, "W-2": 1746, "W-3": 1824, "W-4": 1956, "W-5": 2109,
        "O-1E": 1728, "O-2E": 1806, "O-3E": 1941,
        "O-1": 1599, "O-2": 1695, "O-3": 1821, "O-4": 2055, "O-5": 2148, "O-6": 2316, "O-7": 2340
      }
    },

    "Travis AFB": {
      base: "Travis AFB",
      dutyZip: "94535",
      mhaCode: "CA036",
      mhaName: "VALLEJO/TRAVIS AFB, CA",
      with: {
        "E-1": 3090, "E-2": 3090, "E-3": 3090, "E-4": 3090, "E-5": 3369,
        "E-6": 3498, "E-7": 3516, "E-8": 3525, "E-9": 3597,
        "W-1": 3513, "W-2": 3522, "W-3": 3540, "W-4": 3621, "W-5": 3729,
        "O-1E": 3519, "O-2E": 3531, "O-3E": 3636,
        "O-1": 3393, "O-2": 3495, "O-3": 3537, "O-4": 3762, "O-5": 3927, "O-6": 3960, "O-7": 3987
      },
      without: {
        "E-1": 2412, "E-2": 2412, "E-3": 2412, "E-4": 2412, "E-5": 2664,
        "E-6": 2838, "E-7": 3099, "E-8": 3402, "E-9": 3426,
        "W-1": 2997, "W-2": 3399, "W-3": 3435, "W-4": 3489, "W-5": 3510,
        "O-1E": 3366, "O-2E": 3420, "O-3E": 3486,
        "O-1": 2805, "O-2": 3279, "O-3": 3444, "O-4": 3498, "O-5": 3513, "O-6": 3516, "O-7": 3576
      }
    },

    "Tyndall AFB": {
      base: "Tyndall AFB",
      dutyZip: "32403",
      mhaCode: "FL063",
      mhaName: "PANAMA CITY, FL",
      with: {
        "E-1": 2058, "E-2": 2058, "E-3": 2058, "E-4": 2058, "E-5": 2163,
        "E-6": 2442, "E-7": 2538, "E-8": 2643, "E-9": 2766,
        "W-1": 2460, "W-2": 2580, "W-3": 2712, "W-4": 2787, "W-5": 2886,
        "O-1E": 2556, "O-2E": 2691, "O-3E": 2802,
        "O-1": 2202, "O-2": 2439, "O-3": 2709, "O-4": 2913, "O-5": 3060, "O-6": 3084, "O-7": 3105
      },
      without: {
        "E-1": 1713, "E-2": 1713, "E-3": 1713, "E-4": 1713, "E-5": 1863,
        "E-6": 1959, "E-7": 2058, "E-8": 2223, "E-9": 2298,
        "W-1": 2037, "W-2": 2220, "W-3": 2310, "W-4": 2460, "W-5": 2562,
        "O-1E": 2160, "O-2E": 2280, "O-3E": 2433,
        "O-1": 1953, "O-2": 2133, "O-3": 2337, "O-4": 2538, "O-5": 2595, "O-6": 2691, "O-7": 2736
      }
    },

    "Whiteman AFB": {
      base: "Whiteman AFB",
      dutyZip: "65305",
      mhaCode: "MO162",
      mhaName: "WHITEMAN AFB, MO",
      with: {
        "E-1": 1449, "E-2": 1449, "E-3": 1449, "E-4": 1449, "E-5": 1611,
        "E-6": 1929, "E-7": 2043, "E-8": 2166, "E-9": 2322,
        "W-1": 1950, "W-2": 2094, "W-3": 2247, "W-4": 2349, "W-5": 2478,
        "O-1E": 2064, "O-2E": 2223, "O-3E": 2370,
        "O-1": 1656, "O-2": 1926, "O-3": 2244, "O-4": 2517, "O-5": 2715, "O-6": 2736, "O-7": 2751
      },
      without: {
        "E-1": 1092, "E-2": 1092, "E-3": 1092, "E-4": 1092, "E-5": 1233,
        "E-6": 1416, "E-7": 1506, "E-8": 1599, "E-9": 1710,
        "W-1": 1428, "W-2": 1542, "W-3": 1641, "W-4": 1749, "W-5": 1860,
        "O-1E": 1551, "O-2E": 1656, "O-3E": 1770,
        "O-1": 1272, "O-2": 1410, "O-3": 1656, "O-4": 1869, "O-5": 2016, "O-6": 2034, "O-7": 2052
      }
    },

    "Wright-Patterson AFB": {
      base: "Wright-Patterson AFB",
      dutyZip: "45433",
      mhaCode: "OH231",
      mhaName: "WRIGHT-PATTERSON AFB, OH",
      with: {
        "E-1": 1533, "E-2": 1533, "E-3": 1533, "E-4": 1533, "E-5": 1650,
        "E-6": 1851, "E-7": 1938, "E-8": 2037, "E-9": 2196,
        "W-1": 1866, "W-2": 1977, "W-3": 2100, "W-4": 2232, "W-5": 2397,
        "O-1E": 1953, "O-2E": 2082, "O-3E": 2259,
        "O-1": 1683, "O-2": 1848, "O-3": 2097, "O-4": 2448, "O-5": 2703, "O-6": 2724, "O-7": 2742
      },
      without: {
        "E-1": 1164, "E-2": 1164, "E-3": 1164, "E-4": 1164, "E-5": 1320,
        "E-6": 1443, "E-7": 1506, "E-8": 1590, "E-9": 1704,
        "W-1": 1455, "W-2": 1590, "W-3": 1701, "W-4": 1842, "W-5": 1980,
        "O-1E": 1572, "O-2E": 1698, "O-3E": 1881,
        "O-1": 1368, "O-2": 1440, "O-3": 1782, "O-4": 2013, "O-5": 2058, "O-6": 2073, "O-7": 2109
      }
    }
  };
  
  function listSupportedBases() {
    return Object.keys(BAH_2026_BY_BASE);
  }

  function assertSupportedBase(base) {
    if (!BAH_2026_BY_BASE[base]) {
      throw new Error(`Unsupported PCSUnited base "${base}".`);
    }
  }

  function getBaseRecord(base) {
    const canonicalBase = canonicalizeBase(base);
    assertSupportedBase(canonicalBase);
    return BAH_2026_BY_BASE[canonicalBase];
  }

  function getBahRecord(base, rank) {
    const canonicalBase = canonicalizeBase(base);
    const rankKey = normalizeRank(rank);

    assertSupportedBase(canonicalBase);
    assertSupportedRank(rankKey);

    const record = BAH_2026_BY_BASE[canonicalBase];

    return {
      base: record.base,
      dutyZip: record.dutyZip,
      mhaCode: record.mhaCode,
      mhaName: record.mhaName,
      rank: rankKey,
      withDependents: record.with[rankKey],
      withoutDependents: record.without[rankKey]
    };
  }

  function getBAH(base, rank, dependents) {
    const canonicalBase = canonicalizeBase(base);
    const rankKey = normalizeRank(rank);
    const depKey = normalizeDependents(dependents);

    assertSupportedBase(canonicalBase);
    assertSupportedRank(rankKey);

    const record = BAH_2026_BY_BASE[canonicalBase];
    const branch = depKey === "with" ? record.with : record.without;
    const value = branch[rankKey];

    if (typeof value !== "number") {
      throw new Error(
        `No BAH value found for base "${canonicalBase}", rank "${rankKey}", dependents "${depKey}".`
      );
    }

    return {
      base: canonicalBase,
      dutyZip: record.dutyZip,
      mhaCode: record.mhaCode,
      mhaName: record.mhaName,
      rank: rankKey,
      dependents: depKey,
      bah: value,
      rateVersion: RATE_VERSION
    };
  }

  return Object.freeze({
    RATE_VERSION,
    SUPPORTED_RANKS,
    BASE_ALIASES,
    BASE_TO_ZIP,
    BAH_2026_BY_BASE,
    normalizeString,
    normalizeRank,
    normalizeDependents,
    canonicalizeBase,
    getDutyZip,
    listSupportedBases,
    getBaseRecord,
    getBahRecord,
    getBAH
  });
});
 
