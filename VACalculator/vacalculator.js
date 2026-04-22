(() => {
  "use strict";

  //#1) BOOT
  function bootPCSURetVARuntime() {
    const ROOT = document.getElementById("pcsu-retva-shell");
    if (!ROOT) return;

    //#2) HELPERS
    const $ = (selector) => ROOT.querySelector(selector);

    const els = {
      rank: $("#retva-rank"),
      yos: $("#retva-yos"),
      system: $("#retva-system"),
      disability: $("#retva-disability"),
      household: $("#retva-household"),
      lane: $("#retva-lane"),
      concurrent: $("#retva-concurrent"),
      taxview: $("#retva-taxview"),

      totalHeroLabel: $("#retva-total-hero-label"),
      totalHeroValue: $("#retva-total-hero-value"),
      totalHeroSub: $("#retva-total-hero-sub"),

      infoRank: $("#retva-info-rank"),
      infoYos: $("#retva-info-yos"),
      infoSystem: $("#retva-info-system"),
      infoDisability: $("#retva-info-disability"),
      infoHousehold: $("#retva-info-household"),
      infoLane: $("#retva-info-lane"),
      infoConcurrent: $("#retva-info-concurrent"),

      retiredPayLabel: $("#retva-retiredpay-label"),
      retiredPayAmount: $("#retva-retiredpay-amount"),
      vaPayLabel: $("#retva-vapay-label"),
      vaPayAmount: $("#retva-vapay-amount"),
      combinedLabel: $("#retva-combined-label"),
      combinedAmount: $("#retva-combined-amount"),

      totalAmount: $("#retva-total-amount"),
      totalNote: $("#retva-total-note"),

      breakdownRetiredPay: $("#retva-breakdown-retiredpay"),
      breakdownVAPay: $("#retva-breakdown-vapay"),
      breakdownCombined: $("#retva-breakdown-combined"),

      barRetiredPay: $("#retva-bar-retiredpay"),
      barVAPay: $("#retva-bar-vapay"),
      barOffset: $("#retva-bar-offset"),

      barRetiredPayValue: $("#retva-bar-retiredpay-value"),
      barVAPayValue: $("#retva-bar-vapay-value"),
      barOffsetValue: $("#retva-bar-offset-value"),

      insightList: $("#retva-insight-list"),
      footerNote: $("#retva-footer-note"),
      scoreRing: $("#retva-scoreRing")
    };

    //#3) API
    // GitHub/static default. Override before this file loads if needed.
    // window.PCSU_API_ORIGIN = "https://your-domain.com";
    const API_ORIGIN = window.PCSU_API_ORIGIN || "https://pcsunited.netlify.app";
    const ENDPOINT = API_ORIGIN + "/.netlify/functions/opensource-brain";

    //#4) FORMATTERS
    function money0(value) {
      const n = Number(value || 0);
      return "$" + Math.round(n).toLocaleString();
    }

    function money2(value) {
      const n = Number(value || 0);
      return "$" + n.toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      });
    }

    function esc(value) {
      return String(value == null ? "" : value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
    }

    function clamp(value, min, max) {
      return Math.max(min, Math.min(max, value));
    }

    function pctOf(total, value) {
      const t = Number(total || 0);
      const v = Number(value || 0);
      if (!Number.isFinite(t) || t <= 0 || !Number.isFinite(v)) return 0;
      return (v / t) * 100;
    }

    function setText(el, value) {
      if (el) el.textContent = String(value == null ? "" : value);
    }

    function setBarHeight(el, percent) {
      if (!el) return;
      el.style.height = clamp(Number(percent || 0), 8, 100) + "%";
    }

    function setRing(total) {
      if (!els.scoreRing) return;
      const pct = clamp(Number(total || 0) / 100, 0, 100);
      els.scoreRing.style.setProperty("--pct", String(pct.toFixed(2)));
    }

    //#5) NORMALIZERS
    function parseYears(raw) {
      const n = parseInt(String(raw || "").replace(/[^\d]/g, ""), 10);
      return Number.isFinite(n) ? n : 20;
    }

    function parseRating(raw) {
      const n = parseInt(String(raw || "").replace(/[^\d]/g, ""), 10);
      return Number.isFinite(n) ? n : 0;
    }

    function normalizeRank(rawRank) {
      const raw = String(rawRank || "").trim().toUpperCase();
      if (!raw) return "E-6";
      if (/^[EWO]-\dE?$/.test(raw)) return raw;
      return raw.replace(/\s+/g, "").replace(/^([EWO])(\dE?)$/, "$1-$2");
    }

    function normalizeSystem(rawSystem) {
      const s = String(rawSystem || "").trim().toUpperCase();
      return s.includes("BLENDED") || s === "BRS" ? "BRS" : "HIGH3";
    }

    function normalizeLane(rawLane) {
      const s = String(rawLane || "").toLowerCase();
      if (s.includes("retirement only")) return "RETIREMENT_ONLY";
      if (s.includes("va disability only")) return "VA_ONLY";
      return "COMBINED";
    }

    function normalizeConcurrent(rawConcurrent) {
      const s = String(rawConcurrent || "").toLowerCase();
      if (s.includes("no concurrent")) return "NO_CONCURRENT";
      if (s.includes("advanced")) return "ADVANCED_REVIEW";
      return "CRDP_ESTIMATED";
    }

    function householdToDependents(rawHousehold) {
      const s = String(rawHousehold || "").toLowerCase();

      let spouse = false;
      let childrenUnder18 = 0;
      let dependentParents = 0;
      let childrenInSchoolOver18 = 0;

      if (s.includes("spouse")) spouse = true;
      if (s.includes("child")) childrenUnder18 = 1;

      return {
        spouse,
        dependentParents,
        childrenUnder18,
        childrenInSchoolOver18,
        label: rawHousehold || "Veteran Alone"
      };
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

    //#6) LOCAL ESTIMATE FALLBACK INPUT
    // Used only if the backend lane is unavailable but official local modules are present.
    function estimateMonthlyBasicPayAtRetirement(rank, yos) {
      const table = {
        "E-5": {20: 4310, 22: 4380, 24: 4450, 26: 4520, 28: 4590, 30: 4660},
        "E-6": {20: 4764, 22: 4860, 24: 4960, 26: 5060, 28: 5160, 30: 5260},
        "E-7": {20: 5314, 22: 5430, 24: 5550, 26: 5670, 28: 5790, 30: 5910},
        "E-8": {20: 6258, 22: 6385, 24: 6515, 26: 6645, 28: 6775, 30: 6905},
        "E-9": {20: 7438, 22: 7580, 24: 7720, 26: 7860, 28: 8000, 30: 8140},
        "O-1": {20: 4342, 22: 4342, 24: 4342, 26: 4342, 28: 4342, 30: 4342},
        "O-2": {20: 5462, 22: 5462, 24: 5462, 26: 5462, 28: 5462, 30: 5462},
        "O-3": {20: 7163, 22: 7163, 24: 7163, 26: 7163, 28: 7163, 30: 7163},
        "O-4": {20: 8258, 22: 8400, 24: 8540, 26: 8680, 28: 8820, 30: 8960},
        "O-5": {20: 9717, 22: 9890, 24: 10060, 26: 10230, 28: 10400, 30: 10570},
        "O-6": {20: 11864, 22: 12070, 24: 12270, 26: 12470, 28: 12670, 30: 12870}
      };

      const byRank = table[rank] || table["E-6"];
      const keys = Object.keys(byRank).map(Number).sort((a, b) => a - b);
      let chosen = keys[0];
      for (const key of keys) {
        if (yos >= key) chosen = key;
      }
      return byRank[chosen];
    }

    //#7) INSIGHTS
    function paintInsights(lines) {
      if (!els.insightList) return;

      const tones = ["mint", "peach", "lav"];
      els.insightList.innerHTML = (lines || []).slice(0, 3).map(function (line, i) {
        return [
          "<li>",
          '  <span class="dot ' + (tones[i] || "mint") + '"></span>',
          "  <span>" + esc(line) + "</span>",
          "</li>"
        ].join("");
      }).join("");
    }

    //#8) INPUT READER
    function readInputs() {
      const rank = normalizeRank(els.rank && els.rank.value);
      const yos = parseYears(els.yos && els.yos.value);
      const retirementSystem = normalizeSystem(els.system && els.system.value);
      const rating = parseRating(els.disability && els.disability.value);
      const household = householdToDependents(els.household && els.household.value);
      const lane = normalizeLane(els.lane && els.lane.value);
      const concurrent = normalizeConcurrent(els.concurrent && els.concurrent.value);

      return {
        mode: "VETERAN",
        rank,
        yearsOfService: yos,
        retirementSystem,
        rating,
        spouse: household.spouse,
        dependentParents: household.dependentParents,
        childrenUnder18: household.childrenUnder18,
        childrenInSchoolOver18: household.childrenInSchoolOver18,
        householdLabel: household.label,
        lane,
        concurrent,
        taxView: els.taxview && els.taxview.value ? els.taxview.value : "Gross Monthly View",
        monthlyBasicPayAtRetirement: estimateMonthlyBasicPayAtRetirement(rank, yos)
      };
    }

    //#9) LOADING STATE
    function paintLoading(payload) {
      setText(els.totalHeroLabel, "Total Monthly Income");
      setText(els.totalHeroValue, "Calculating...");
      setText(els.totalHeroSub, "Retirement Pay + VA Disability");

      setText(els.infoRank, payload.rank);
      setText(els.infoYos, String(payload.yearsOfService) + " Years");
      setText(els.infoSystem, payload.retirementSystem);
      setText(els.infoDisability, String(payload.rating) + "%");
      setText(els.infoHousehold, payload.householdLabel);
      setText(els.infoLane, payload.lane.replaceAll("_", " "));
      setText(els.infoConcurrent, payload.concurrent.replaceAll("_", " "));

      setText(els.retiredPayLabel, "Projected Monthly Retirement Pay");
      setText(els.retiredPayAmount, "...");
      setText(els.vaPayLabel, "Estimated Monthly VA Disability");
      setText(els.vaPayAmount, "...");
      setText(els.combinedLabel, "Projected Combined Monthly Income");
      setText(els.combinedAmount, "...");

      setText(els.totalAmount, "...");
      setText(els.totalNote, "Using PCSUnited Basic Calculator flow");

      setText(els.breakdownRetiredPay, "Retirement Component");
      setText(els.breakdownVAPay, "VA Disability Component");
      setText(els.breakdownCombined, "Combined Monthly View");

      setText(els.barRetiredPayValue, "...");
      setText(els.barVAPayValue, "...");
      setText(els.barOffsetValue, "Review");

      setBarHeight(els.barRetiredPay, 45);
      setBarHeight(els.barVAPay, 35);
      setBarHeight(els.barOffset, 16);
      setRing(4500);

      paintInsights([
        "This calculator uses the PCSUnited Basic Calculator flow through opensource-brain.js.",
        "opensource-brain.js should route into comp-engine.js, then official-retirement.js and official-va.js.",
        "That keeps this calculator aligned with the rest of PCSUnited."
      ]);

      setText(
        els.footerNote,
        "Running Basic Calculator flow: GitHub UI → opensource-brain.js → comp-engine.js → official-retirement / official-va."
      );
    }

    //#10) ERROR STATE
    function paintError(message, payload) {
      setText(els.totalHeroLabel, "Total Monthly Income");
      setText(els.totalHeroValue, "$0");
      setText(els.totalHeroSub, "Retirement Pay + VA Disability");

      setText(els.infoRank, payload.rank || "—");
      setText(els.infoYos, String(payload.yearsOfService || 0) + " Years");
      setText(els.infoSystem, payload.retirementSystem || "—");
      setText(els.infoDisability, String(payload.rating || 0) + "%");
      setText(els.infoHousehold, payload.householdLabel || "—");
      setText(els.infoLane, String(payload.lane || "—").replaceAll("_", " "));
      setText(els.infoConcurrent, String(payload.concurrent || "—").replaceAll("_", " "));

      setText(els.retiredPayLabel, "Projected Monthly Retirement Pay");
      setText(els.retiredPayAmount, "$0");
      setText(els.vaPayLabel, "Estimated Monthly VA Disability");
      setText(els.vaPayAmount, "$0.00");
      setText(els.combinedLabel, "Projected Combined Monthly Income");
      setText(els.combinedAmount, "$0.00");

      setText(els.totalAmount, "$0.00");
      setText(els.totalNote, "Unable to calculate");

      setText(els.breakdownRetiredPay, "Retirement Component");
      setText(els.breakdownVAPay, "VA Disability Component");
      setText(els.breakdownCombined, "Combined Monthly View");

      setText(els.barRetiredPayValue, "$0");
      setText(els.barVAPayValue, "$0");
      setText(els.barOffsetValue, "Review");

      setBarHeight(els.barRetiredPay, 10);
      setBarHeight(els.barVAPay, 10);
      setBarHeight(els.barOffset, 10);
      setRing(0);

      paintInsights([
        message || "We could not calculate this estimate.",
        "This calculator uses the backend flow, so check opensource-brain.js first.",
        "Then confirm opensource-brain.js is routing correctly into comp-engine.js and the official retirement and VA modules."
      ]);

      setText(
        els.footerNote,
        "Calculator unavailable. Check PCSUnited Basic Calculator flow."
      );
    }

    //#11) LOCAL OFFICIAL MODULE FALLBACK
    function runLocalOfficialFallback(payload) {
      const hasRet = typeof window.PCSU_OFFICIAL_RETIREMENT !== "undefined" &&
        window.PCSU_OFFICIAL_RETIREMENT &&
        typeof window.PCSU_OFFICIAL_RETIREMENT.getRetirementPay === "function";

      const hasVA = typeof window.PCSU_OFFICIAL_VA !== "undefined" &&
        window.PCSU_OFFICIAL_VA &&
        typeof window.PCSU_OFFICIAL_VA.getVACompensation === "function";

      if (!hasRet || !hasVA) {
        throw new Error("Backend unavailable and official local modules are not loaded.");
      }

      const ret = window.PCSU_OFFICIAL_RETIREMENT.getRetirementPay({
        retirementSystem: payload.retirementSystem,
        yearsOfService: payload.yearsOfService,
        monthlyBasicPayAtRetirement: payload.monthlyBasicPayAtRetirement
      });

      const va = window.PCSU_OFFICIAL_VA.getVACompensation({
        rating: payload.rating,
        spouse: payload.spouse,
        dependentParents: payload.dependentParents,
        childrenUnder18: payload.childrenUnder18,
        childrenInSchoolOver18: payload.childrenInSchoolOver18
      });

      return {
        ok: true,
        payload: {
          retirement: ret,
          va: va,
          summary: {
            lane: payload.lane,
            concurrent: payload.concurrent,
            totalMonthlyIncome:
              payload.lane === "RETIREMENT_ONLY"
                ? Number(ret.grossMonthlyRetiredPay || 0)
                : payload.lane === "VA_ONLY"
                  ? Number(va.monthlyVA || 0)
                  : Number(ret.grossMonthlyRetiredPay || 0) + Number(va.monthlyVA || 0)
          }
        }
      };
    }

    //#12) SUCCESS PAINTER
    function paintSuccess(payload, data, sourceLabel) {
      const responsePayload = (data && data.payload) || {};

      const retirement =
        responsePayload.retirement ||
        responsePayload.retirementPay ||
        responsePayload.retiredPay ||
        {};

      const va =
        responsePayload.va ||
        responsePayload.vaComp ||
        responsePayload.vaDisability ||
        {};

      const summary = responsePayload.summary || {};

      const retiredPayRaw =
        retirement.grossMonthlyRetiredPay ??
        retirement.monthlyRetiredPay ??
        retirement.monthlyRetirement ??
        0;

      const vaPayRaw =
        va.monthlyVA ??
        va.monthlyComp ??
        va.monthlyDisability ??
        0;

      const retiredPay = Number(retiredPayRaw || 0);
      const vaPay = Number(vaPayRaw || 0);

      let combined = Number(
        summary.totalMonthlyIncome ??
        summary.combinedMonthlyIncome ??
        (retiredPay + vaPay)
      );

      if (payload.lane === "RETIREMENT_ONLY") combined = retiredPay;
      if (payload.lane === "VA_ONLY") combined = vaPay;

      const offsetVisual = payload.concurrent === "NO_CONCURRENT" ? 0 : (payload.concurrent === "ADVANCED_REVIEW" ? 12 : 18);

      setText(els.totalHeroLabel, "Total Monthly Income");
      setText(els.totalHeroValue, money2(combined));
      setText(els.totalHeroSub, "Retirement Pay + VA Disability");

      setText(els.infoRank, payload.rank + " • " + rankTitle(payload.rank));
      setText(els.infoYos, String(payload.yearsOfService) + " Years");
      setText(els.infoSystem, payload.retirementSystem);
      setText(els.infoDisability, String(payload.rating) + "%");
      setText(els.infoHousehold, payload.householdLabel);
      setText(els.infoLane, payload.lane.replaceAll("_", " "));
      setText(els.infoConcurrent, payload.concurrent.replaceAll("_", " "));

      setText(els.retiredPayLabel, "Projected Monthly Retirement Pay");
      setText(els.retiredPayAmount, money0(retiredPay));

      setText(els.vaPayLabel, "Estimated Monthly VA Disability");
      setText(els.vaPayAmount, money2(vaPay));

      setText(els.combinedLabel, "Projected Combined Monthly Income");
      setText(els.combinedAmount, money2(combined));

      setText(els.totalAmount, money2(combined));
      setText(els.totalNote, "Retirement Pay + VA Disability");

      setText(els.breakdownRetiredPay, "Retirement Component");
      setText(els.breakdownVAPay, "VA Disability Component");
      setText(els.breakdownCombined, "Combined Monthly View");

      setText(els.barRetiredPayValue, money0(retiredPay));
      setText(els.barVAPayValue, money2(vaPay));
      setText(
        els.barOffsetValue,
        payload.concurrent === "NO_CONCURRENT"
          ? "None"
          : payload.concurrent === "ADVANCED_REVIEW"
            ? "Review"
            : "Est."
      );

      const totalForBars = Math.max(combined, retiredPay + vaPay, 1);

      setBarHeight(
        els.barRetiredPay,
        payload.lane === "VA_ONLY" ? 8 : pctOf(totalForBars, retiredPay)
      );

      setBarHeight(
        els.barVAPay,
        payload.lane === "RETIREMENT_ONLY" ? 8 : pctOf(totalForBars, vaPay)
      );

      setBarHeight(els.barOffset, offsetVisual);
      setRing(combined);

      const insights = [
        rankTitle(payload.rank) + " at " + payload.yearsOfService + " years under " + payload.retirementSystem + " is estimated at " + money0(retiredPay) + " in monthly gross retirement pay.",
        "Estimated VA disability compensation at " + payload.rating + "% for " + payload.householdLabel + " is " + money2(vaPay) + " per month.",
        "Projected monthly income in the selected " + payload.lane.replaceAll("_", " ").toLowerCase() + " lane is " + money2(combined) + "."
      ];

      if (payload.concurrent === "ADVANCED_REVIEW") {
        insights[2] = "Projected monthly income is " + money2(combined) + ", but concurrent receipt and offset details should be reviewed in the advanced lane.";
      }

      paintInsights(insights);

      setText(
        els.footerNote,
        sourceLabel === "LOCAL_OFFICIAL"
          ? "Estimate generated using local official modules. Preferred PCSUnited Basic Calculator flow backend was unavailable."
          : "Estimate generated using PCSUnited Basic Calculator flow through opensource-brain.js and comp-engine.js."
      );
    }

    //#13) MAIN RUNNER
    async function run() {
      const payload = readInputs();
      paintLoading(payload);

      try {
        const res = await fetch(ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            tool: "RETIREMENT_VA",
            input: payload
          })
        });

        const data = await res.json();

        if (!res.ok || !data || data.ok === false) {
          throw new Error(
            (data && (data.error || data.message)) ||
            "Function error."
          );
        }

        paintSuccess(payload, data, "BACKEND");
      } catch (backendErr) {
        try {
          const fallbackData = runLocalOfficialFallback(payload);
          paintSuccess(payload, fallbackData, "LOCAL_OFFICIAL");
        } catch (fallbackErr) {
          paintError(
            fallbackErr && fallbackErr.message
              ? fallbackErr.message
              : (backendErr && backendErr.message ? backendErr.message : "Unable to calculate estimate."),
            payload
          );
        }
      }
    }

    //#14) BIND EVENTS
    function bind() {
      ["rank", "yos", "system", "disability", "household", "lane", "concurrent", "taxview"].forEach(function (key) {
        const el = els[key];
        if (el) {
          el.addEventListener("change", run);
          el.addEventListener("input", run);
        }
      });
    }

    //#15) INIT
    bind();
    run();

    window.PCSU_RETVA = {
      run: run,
      endpoint: ENDPOINT
    };
  }

  //#16) DOM READY
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bootPCSURetVARuntime, { once: true });
  } else {
    bootPCSURetVARuntime();
  }
})();
