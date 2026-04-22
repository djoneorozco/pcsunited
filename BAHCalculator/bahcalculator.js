(() => {
  "use strict";

  //#1) BOOT
  function bootPCSUBAHRuntime() {
    const ROOT = document.getElementById("pcsu-bah-shell");
    if (!ROOT) return;

    //#2) HELPERS
    const $ = (selector) => ROOT.querySelector(selector);

    const els = {
      paygrade: $("#bah-paygrade"),
      yos: $("#bah-yos"),
      location: $("#bah-location"),
      dependents: $("#bah-dependents"),

      totalHeroLabel: $("#bah-total-hero-label"),
      totalHeroValue: $("#bah-total-hero-value"),
      totalHeroSub: $("#bah-total-hero-sub"),

      infoStatus: $("#bah-info-status"),
      infoDependency: $("#bah-info-dependency"),
      infoLocation: $("#bah-info-location"),
      infoRank: $("#bah-info-rank"),
      infoYos: $("#bah-info-yos"),

      payLabel: $("#bah-pay-label"),
      payAmount: $("#bah-pay-amount"),
      basePayLabel: $("#bah-basepay-label"),
      basePayAmount: $("#bah-basepay-amount"),
      basLabel: $("#bah-bas-label"),
      basAmount: $("#bah-bas-amount"),

      totalAmount: $("#bah-total-amount"),
      totalNote: $("#bah-total-note"),

      breakdownBah: $("#bah-breakdown-bah"),
      breakdownBasePay: $("#bah-breakdown-basepay"),
      breakdownBas: $("#bah-breakdown-bas"),

      barBah: $("#bah-bar-bah"),
      barBasePay: $("#bah-bar-basepay"),
      barBas: $("#bah-bar-bas"),

      barBahValue: $("#bah-bar-bah-value"),
      barBasePayValue: $("#bah-bar-basepay-value"),
      barBasValue: $("#bah-bar-bas-value"),

      insightList: $("#bah-insight-list"),
      footerNote: $("#bah-footer-note"),
      scoreRing: $("#scoreRing")
    };

    //#3) API
    // For GitHub Pages or static hosting, use the live PCSUnited function by default.
    // You can override this before bahcalculator.js loads:
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
    function parseYearsOfService(raw) {
      const n = parseInt(String(raw || "").replace(/[^\d]/g, ""), 10);
      return Number.isFinite(n) ? n : 0;
    }

    function normalizeRank(rawRank) {
      const raw = String(rawRank || "").trim().toUpperCase();
      if (!raw) return "E-5";
      if (/^[EWO]-\dE?$/.test(raw)) return raw;
      return raw.replace(/\s+/g, "").replace(/^([EWO])(\dE?)$/, "$1-$2");
    }

    function normalizeBase(rawBase) {
      const raw = String(rawBase || "").trim();

      const aliasMap = {
        "JBSA-Lackland": "Lackland AFB",
        "JBSA Lackland": "Lackland AFB",
        "JBSA-Randolph": "Randolph AFB",
        "JBSA Randolph": "Randolph AFB",
        "JBSA-Fort Sam Houston": "Fort-Sam-Houston AFB",
        "JBSA-Fort-Sam-Houston": "Fort-Sam-Houston AFB"
      };

      return aliasMap[raw] || raw;
    }

    function normalizeDependents(raw) {
      const s = String(raw || "").toLowerCase();
      return s.includes("without") ? "without" : "with";
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

    //#6) INSIGHTS
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

    //#7) INPUT READER
    function readInputs() {
      return {
        mode: "ACTIVE_DUTY",
        rank: normalizeRank(els.paygrade && els.paygrade.value),
        yos: parseYearsOfService(els.yos && els.yos.value),
        base: normalizeBase(els.location && els.location.value),
        dependents: normalizeDependents(els.dependents && els.dependents.value)
      };
    }

    //#8) LOADING STATE
    function paintLoading(payload) {
      setText(els.totalHeroLabel, "Total Monthly Military Pay");
      setText(els.totalHeroValue, "Calculating...");
      setText(els.totalHeroSub, "Base Pay + BAH + BAS");

      setText(els.infoStatus, "Active Duty");
      setText(els.infoDependency, payload.dependents === "with" ? "With Dependents" : "Without Dependents");
      setText(els.infoLocation, payload.base);
      setText(els.infoRank, payload.rank);
      setText(els.infoYos, String(payload.yos) + " Years");

      setText(els.payLabel, "Projected Monthly BAH");
      setText(els.payAmount, "...");
      setText(els.basePayLabel, "Estimated Monthly Base Pay");
      setText(els.basePayAmount, "...");
      setText(els.basLabel, "Estimated Monthly BAS");
      setText(els.basAmount, "...");
      setText(els.totalAmount, "...");
      setText(els.totalNote, "Using PCSUnited Basic Calculator flow");

      setText(els.breakdownBah, "BAH Component");
      setText(els.breakdownBasePay, "Base Pay Component");
      setText(els.breakdownBas, "BAS Component");

      setText(els.barBahValue, "...");
      setText(els.barBasePayValue, "...");
      setText(els.barBasValue, "...");

      setBarHeight(els.barBah, 45);
      setBarHeight(els.barBasePay, 45);
      setBarHeight(els.barBas, 20);
      setRing(4500);

      paintInsights([
        "This calculator uses the PCSUnited Basic Calculator flow through opensource-brain.js.",
        "opensource-brain.js should route into comp-engine.js, then official-pay.js and official-bah.js.",
        "That keeps this calculator aligned with the rest of PCSUnited."
      ]);

      setText(
        els.footerNote,
        "Running Basic Calculator flow: GitHub UI → opensource-brain.js → comp-engine.js → official-pay / official-bah."
      );
    }

    //#9) ERROR STATE
    function paintError(message, payload) {
      setText(els.totalHeroLabel, "Total Monthly Military Pay");
      setText(els.totalHeroValue, "$0");
      setText(els.totalHeroSub, "Base Pay + BAH + BAS");

      setText(els.infoStatus, "Active Duty");
      setText(els.infoDependency, payload.dependents === "with" ? "With Dependents" : "Without Dependents");
      setText(els.infoLocation, payload.base || "—");
      setText(els.infoRank, payload.rank || "—");
      setText(els.infoYos, String(payload.yos || 0) + " Years");

      setText(els.payLabel, "Projected Monthly BAH");
      setText(els.payAmount, "$0");
      setText(els.basePayLabel, "Estimated Monthly Base Pay");
      setText(els.basePayAmount, "$0");
      setText(els.basLabel, "Estimated Monthly BAS");
      setText(els.basAmount, "$0.00");

      setText(els.totalAmount, "$0");
      setText(els.totalNote, "Unable to calculate");

      setText(els.breakdownBah, "BAH Component");
      setText(els.breakdownBasePay, "Base Pay Component");
      setText(els.breakdownBas, "BAS Component");

      setText(els.barBahValue, "$0");
      setText(els.barBasePayValue, "$0");
      setText(els.barBasValue, "$0");

      setBarHeight(els.barBah, 10);
      setBarHeight(els.barBasePay, 10);
      setBarHeight(els.barBas, 10);
      setRing(0);

      paintInsights([
        message || "We could not calculate this estimate.",
        "This calculator uses the backend flow, so check opensource-brain.js first.",
        "Then confirm opensource-brain.js is routing correctly into comp-engine.js and the official modules."
      ]);

      setText(
        els.footerNote,
        "Calculator unavailable. Check PCSUnited Basic Calculator flow."
      );
    }

    //#10) SUCCESS STATE
    function paintSuccess(payload, data) {
      const responsePayload = (data && data.payload) || {};
      const profile = responsePayload.profile || {};
      const compensation = responsePayload.compensation || {};
      const monthly = compensation.monthly || {};
      const detail = compensation.detail || {};
      const bahRecord = detail.bahRecord || {};

      const bah = Number(monthly.bah || 0);
      const basePay = Number(monthly.basicPay || 0);
      const bas = Number(monthly.bas || 0);
      const total = Number(
        monthly.grossMonthlyComp ||
        monthly.combinedMonthlyGross ||
        (bah + basePay + bas)
      );

      const displayBase =
        profile.currentBase ||
        profile.base ||
        bahRecord.base ||
        payload.base;

      const displayZip =
        bahRecord.dutyZip ||
        detail.dutyZip ||
        "";

      const displayMha =
        bahRecord.mhaName ||
        compensation.mhaName ||
        "";

      setText(els.totalHeroLabel, "Total Monthly Military Pay");
      setText(els.totalHeroValue, money2(total));
      setText(els.totalHeroSub, "Base Pay + BAH + BAS");

      setText(els.infoStatus, "Active Duty");
      setText(els.infoDependency, payload.dependents === "with" ? "With Dependents" : "Without Dependents");
      setText(
        els.infoLocation,
        displayMha ? (displayBase + " • " + displayMha) : displayBase
      );
      setText(els.infoRank, payload.rank + " • " + rankTitle(payload.rank));
      setText(els.infoYos, String(payload.yos) + " Years");

      setText(els.payLabel, "Projected Monthly BAH");
      setText(els.payAmount, money0(bah));
      setText(els.basePayLabel, "Estimated Monthly Base Pay");
      setText(els.basePayAmount, money0(basePay));
      setText(els.basLabel, "Estimated Monthly BAS");
      setText(els.basAmount, money2(bas));

      setText(els.totalAmount, money2(total));
      setText(els.totalNote, "Base Pay + BAH + BAS");

      setText(els.breakdownBah, "BAH Component");
      setText(els.breakdownBasePay, "Base Pay Component");
      setText(els.breakdownBas, "BAS Component");

      setText(els.barBahValue, money0(bah));
      setText(els.barBasePayValue, money0(basePay));
      setText(els.barBasValue, money2(bas));

      setBarHeight(els.barBah, pctOf(total, bah));
      setBarHeight(els.barBasePay, pctOf(total, basePay));
      setBarHeight(els.barBas, pctOf(total, bas));
      setRing(total);

      paintInsights([
        rankTitle(payload.rank) + " at " + payload.yos + " years of service is estimated at " + money0(basePay) + " in monthly base pay.",
        "Projected BAH for " + displayBase + (displayZip ? " (" + displayZip + ")" : "") + " is " + money0(bah) + " " + (payload.dependents === "with" ? "with dependents." : "without dependents."),
        "Estimated monthly military compensation is " + money2(total) + ", including BAS of " + money2(bas) + "."
      ]);

      setText(
        els.footerNote,
        "Estimate generated using PCSUnited Basic Calculator flow through opensource-brain.js and comp-engine.js."
      );
    }

    //#11) MAIN RUNNER
    async function run() {
      const payload = readInputs();
      paintLoading(payload);

      try {
        const res = await fetch(ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            tool: "PCS_SNAPSHOT",
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

        paintSuccess(payload, data);
      } catch (err) {
        paintError(
          err && err.message ? err.message : "Unable to calculate estimate.",
          payload
        );
      }
    }

    //#12) BIND EVENTS
    function bind() {
      ["paygrade", "yos", "location", "dependents"].forEach(function (key) {
        const el = els[key];
        if (el) {
          el.addEventListener("change", run);
          el.addEventListener("input", run);
        }
      });
    }

    //#13) INIT
    bind();
    run();

    window.PCSU_AURORA_BAH = {
      run: run,
      endpoint: ENDPOINT
    };
  }

  //#14) DOM READY
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bootPCSUBAHRuntime, { once: true });
  } else {
    bootPCSUBAHRuntime();
  }
})();
