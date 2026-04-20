<script>
(function () {
  "use strict";

  /* =========================================================
    PCSUnited • Aurora BAH Calculator Runtime
    v2.0.0
    SNAPSHOT-LOGIC VERSION

    PURPOSE
    - Reuses PCS Snapshot calculation pattern
    - No bah-calculator.js required
    - Loads militaryPayTables.json directly
    - Loads base index directly
    - Calculates:
      • BAH
      • Base Pay
      • BAS
      • Total Monthly Military Pay
    - Paints the Aurora Webflow shell

    EXPECTED SHELL IDS
    - #bah-paygrade
    - #bah-yos
    - #bah-location
    - #bah-dependents

    - #bah-hero-label
    - #bah-hero-value
    - #bah-hero-fill

    - #bah-info-status
    - #bah-info-dependency
    - #bah-info-location
    - #bah-info-rank
    - #bah-info-yos

    - #bah-pay-amount
    - #bah-basepay-amount
    - #bah-total-amount
    - #bah-total-note

    - #bah-breakdown-title
    - #bah-breakdown-bah
    - #bah-breakdown-basepay
    - #bah-breakdown-bas

    - #bah-bar-bah
    - #bah-bar-basepay
    - #bah-bar-bas

    - #bah-insight-list
    - #bah-footer-note
  ========================================================= */

  const MILPAY_JSON_URL = "https://raw.githubusercontent.com/djoneorozco/OrozcoRealty/main/netlify/functions/data/militaryPayTables.json";
  const BASE_INDEX_URL = "https://raw.githubusercontent.com/djoneorozco/pcsunited/main/netlify/functions/cities/index.byBase.json";
  const CITY_GITHUB_RAW_BASE = "https://raw.githubusercontent.com/djoneorozco/pcsunited/main/netlify/functions/cities/";

  const DEFAULT_BASE = "Lackland AFB";
  const DEFAULT_FILE_KEY = "Lackland";
  const DEFAULT_ZIP = "78236";

  let LOADED_PAY = null;
  let BASE_INDEX = { bases: {}, aliases: {} };
  let LAST_KEY = "";
  let IS_LOADING = false;

  const $ = (s) => document.querySelector(s);
  const safeText = (s, v) => { const e = $(s); if (e) e.textContent = v == null ? "" : String(v); };
  const safeHTML = (s, v) => { const e = $(s); if (e) e.innerHTML = v == null ? "" : String(v); };

  const money0 = n => {
    const x = Number(n);
    return Number.isFinite(x) ? "$" + Math.round(x).toLocaleString() : "$0";
  };

  const money2 = n => {
    const x = Number(n);
    return Number.isFinite(x) ? "$" + x.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "$0.00";
  };

  const clamp = (n, a, b) => Math.max(a, Math.min(b, n));

  function pctOf(total, value) {
    const t = Number(total || 0);
    const v = Number(value || 0);
    if (!Number.isFinite(t) || t <= 0 || !Number.isFinite(v)) return 0;
    return (v / t) * 100;
  }

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  async function load(url) {
    const r = await fetch(url, { cache: "no-store" });
    if (!r.ok) throw new Error("load fail " + url + " (" + r.status + ")");
    const ct = (r.headers.get("content-type") || "").toLowerCase();
    if (ct.includes("text/html")) throw new Error("non-json response " + url + " (html)");
    return r.json();
  }

  async function loadBaseIndex() {
    if (Object.keys(BASE_INDEX.bases || {}).length) return BASE_INDEX;
    BASE_INDEX = await fetch(BASE_INDEX_URL, { cache: "no-store" })
      .then(r => r.json())
      .catch(() => ({ bases: {}, aliases: {} }));
    return BASE_INDEX;
  }

  function idx() {
    return BASE_INDEX || { bases: {}, aliases: {} };
  }

  function baseName(raw) {
    const s = String(raw || "").trim();
    if (!s) return "";
    const i = idx();
    const b = i.bases || {};
    const a = i.aliases || {};
    return b[s] ? s : (a[s] || s);
  }

  function fileKeyFromBase(raw) {
    const rec = (idx().bases || {})[baseName(raw)];
    return (rec && rec.file) || "";
  }

  function zipFromBase(raw) {
    const rec = (idx().bases || {})[baseName(raw)];
    return (rec && rec.zip) || "";
  }

  const fallbackBase = raw => baseName(raw) || DEFAULT_BASE;
  const fallbackFileKey = raw => fileKeyFromBase(raw) || DEFAULT_FILE_KEY;
  const fallbackZip = raw => zipFromBase(raw) || DEFAULT_ZIP;

  async function loadCityExact(fileKey) {
    const k = String(fileKey || "").trim() || DEFAULT_FILE_KEY;
    return load(`${CITY_GITHUB_RAW_BASE}${encodeURIComponent(k)}.json`);
  }

  function normRank(r) {
    const s = String(r || "").toUpperCase().trim();
    const m =
      s.match(/^([EO])\s*-\s*(\d+)$/) ||
      s.match(/^([EO])(\d+)$/) ||
      s.match(/^(W)\s*-\s*(\d+)$/) ||
      s.match(/^(W)(\d+)$/);
    return m ? m[1] + "-" + m[2] : s.replace(/\s+/g, "");
  }

  const isE = r => String(r || "").startsWith("E-");

  function pickYOS(y, table) {
    const ks = Object.keys(table || {})
      .map(k => parseInt(k, 10))
      .filter(n => !isNaN(n))
      .sort((a, b) => a - b);

    if (!ks.length) return String(y || 2);

    let chosen = ks[0];
    for (const k of ks) {
      if (k <= y) chosen = k;
    }
    return String(chosen);
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

  async function calcBahFromPay(pay, opts) {
    const rankKey = normRank(opts.rank);
    const table = (pay.BASEPAY && pay.BASEPAY[rankKey]) ? pay.BASEPAY[rankKey] : {};
    const yKey = pickYOS(parseInt(opts.yos, 10), table);
    const basePay = Number(table[yKey] || 0) || 0;
    const bas = isE(rankKey)
      ? Number((pay.BAS && pay.BAS.enlisted) || 0)
      : Number((pay.BAS && pay.BAS.officer) || 0);

    const zip = String(opts.zip || fallbackZip(opts.baseLoc) || DEFAULT_ZIP).trim();
    const rec = (((pay || {}).BAH || {}).by_zip || {})[zip] || null;
    const grp = (parseInt(opts.family, 10) > 1) ? (rec && rec.with) : (rec && rec.without);

    let bah = 0;
    if (grp && grp[rankKey] != null) bah = Number(grp[rankKey]) || 0;

    return {
      bah,
      basePay,
      bas,
      zip,
      rankKey,
      yKey,
      locationLabel: rec ? (rec.location || rec.base || opts.baseLoc || zip) : (opts.baseLoc || zip)
    };
  }

  function readInputs() {
    const rankRaw = ($("#bah-paygrade") && $("#bah-paygrade").value) || "E-5";
    const yosRaw = ($("#bah-yos") && $("#bah-yos").value) || "6 Years";
    const baseRaw = ($("#bah-location") && $("#bah-location").value) || DEFAULT_BASE;
    const depRaw = ($("#bah-dependents") && $("#bah-dependents").value) || "With Dependents";

    const rank = normRank(rankRaw);
    const yos = parseInt(String(yosRaw).replace(/[^\d]/g, ""), 10) || 6;
    const base = fallbackBase(baseRaw);
    const family = String(depRaw).toLowerCase().includes("with") ? 2 : 1;

    return { rank, yos, base, family };
  }

  function setBar(selector, pct) {
    const el = $(selector);
    if (!el) return;
    el.style.width = clamp(Number(pct || 0), 8, 100) + "%";
  }

  function paintInsights(lines) {
    const tones = ["cyan", "peach", "lav"];
    safeHTML("#bah-insight-list", (lines || []).slice(0, 3).map((line, i) => `
      <div class="insight-item">
        <span class="insight-dot ${tones[i] || "cyan"}"></span>
        <div class="insight-text">${esc(line)}</div>
      </div>
    `).join(""));
  }

  function paintLoading(payload) {
    safeText("#bah-hero-label", "Projected Housing Support");
    safeText("#bah-hero-value", "Calculating...");
    const fill = $("#bah-hero-fill");
    if (fill) fill.style.width = "40%";

    safeText("#bah-info-status", "Active Duty");
    safeText("#bah-info-dependency", payload.family > 1 ? "With Dependents" : "Without Dependents");
    safeText("#bah-info-location", payload.base);
    safeText("#bah-info-rank", payload.rank);
    safeText("#bah-info-yos", payload.yos + " Years");

    safeText("#bah-pay-amount", "...");
    safeText("#bah-basepay-amount", "...");
    safeText("#bah-total-amount", "...");
    safeText("#bah-total-note", "Using PCS Snapshot logic");

    safeText("#bah-breakdown-title", "Compensation Breakdown");
    safeText("#bah-breakdown-bah", "...");
    safeText("#bah-breakdown-basepay", "...");
    safeText("#bah-breakdown-bas", "...");

    setBar("#bah-bar-bah", 50);
    setBar("#bah-bar-basepay", 50);
    setBar("#bah-bar-bas", 20);

    paintInsights([
      "We’re calculating your estimated BAH and military pay using the same pay-table logic already used in PCS Snapshot.",
      "This Aurora calculator is a lighter front-end view, not a separate compensation system.",
      "If a selected base is missing from the current mapped dataset, the calculator will show a safe fallback message."
    ]);

    safeText("#bah-footer-note", "Loading estimate from the same PCS Snapshot data path.");
  }

  function paintError(message, payload) {
    safeText("#bah-hero-label", "Projected Housing Support");
    safeText("#bah-hero-value", "Unavailable");
    const fill = $("#bah-hero-fill");
    if (fill) fill.style.width = "12%";

    safeText("#bah-info-status", "Active Duty");
    safeText("#bah-info-dependency", payload.family > 1 ? "With Dependents" : "Without Dependents");
    safeText("#bah-info-location", payload.base || "—");
    safeText("#bah-info-rank", payload.rank || "—");
    safeText("#bah-info-yos", (payload.yos || 0) + " Years");

    safeText("#bah-pay-amount", "$0");
    safeText("#bah-basepay-amount", "$0");
    safeText("#bah-total-amount", "$0");
    safeText("#bah-total-note", "Unable to calculate");

    safeText("#bah-breakdown-title", "Compensation Breakdown");
    safeText("#bah-breakdown-bah", "$0");
    safeText("#bah-breakdown-basepay", "$0");
    safeText("#bah-breakdown-bas", "$0");

    setBar("#bah-bar-bah", 10);
    setBar("#bah-bar-basepay", 10);
    setBar("#bah-bar-bas", 10);

    paintInsights([
      message || "We could not calculate this estimate.",
      "This usually means the selected base is not mapped yet, or the pay-table source could not be loaded.",
      "The calculator is intentionally using the same PCS Snapshot source logic to keep results consistent."
    ]);

    safeText("#bah-footer-note", "Calculator temporarily unavailable. Check source data or base mapping.");
  }

  async function paintSuccess(payload, pay) {
    const cityFileKey = fallbackFileKey(payload.base);
    let city = null;

    try {
      city = await loadCityExact(cityFileKey);
    } catch (e) {
      city = null;
    }

    const result = await calcBahFromPay(pay, {
      rank: payload.rank,
      yos: payload.yos,
      family: payload.family,
      baseLoc: payload.base,
      zip: fallbackZip(payload.base)
    });

    const bah = Number(result.bah || 0);
    const basePay = Number(result.basePay || 0);
    const bas = Number(result.bas || 0);
    const total = Number((bah + basePay + bas).toFixed(2));

    const locationLabel =
      (city && (city.place || city.city || city.name)) ||
      result.locationLabel ||
      payload.base;

    safeText("#bah-hero-label", "Projected Housing Support");
    safeText("#bah-hero-value", money0(bah) + " / month");
    const fill = $("#bah-hero-fill");
    if (fill) fill.style.width = clamp(Math.round(pctOf(total || 1, bah)), 18, 90) + "%";

    safeText("#bah-info-status", "Active Duty");
    safeText("#bah-info-dependency", payload.family > 1 ? "With Dependents" : "Without Dependents");
    safeText("#bah-info-location", locationLabel);
    safeText("#bah-info-rank", payload.rank + " • " + rankTitle(payload.rank));
    safeText("#bah-info-yos", payload.yos + " Years");

    safeText("#bah-pay-amount", money0(bah));
    safeText("#bah-basepay-amount", money0(basePay));
    safeText("#bah-total-amount", money2(total));
    safeText("#bah-total-note", "Includes BAS of " + money2(bas));

    safeText("#bah-breakdown-title", "Compensation Breakdown");
    safeText("#bah-breakdown-bah", money0(bah));
    safeText("#bah-breakdown-basepay", money0(basePay));
    safeText("#bah-breakdown-bas", money2(bas));

    setBar("#bah-bar-bah", pctOf(total, bah));
    setBar("#bah-bar-basepay", pctOf(total, basePay));
    setBar("#bah-bar-bas", pctOf(total, bas));

    const lines = [
      `${rankTitle(payload.rank)} at ${payload.yos} years of service is estimated at ${money0(basePay)} in monthly base pay.`,
      `Projected BAH for ${locationLabel} (${result.zip}) is ${money0(bah)} ${payload.family > 1 ? "with dependents" : "without dependents"}.`,
      `Estimated monthly military compensation is ${money2(total)}, including BAS of ${money2(bas)}.`
    ];

    paintInsights(lines);

    safeText(
      "#bah-footer-note",
      `Estimate generated using PCS Snapshot logic and militaryPayTables.json for ${payload.base}.`
    );
  }

  async function bootRun() {
    const payload = readInputs();
    const key = JSON.stringify(payload);
    if (IS_LOADING && key === LAST_KEY) return;

    LAST_KEY = key;
    IS_LOADING = true;
    paintLoading(payload);

    try {
      await loadBaseIndex();
      if (!LOADED_PAY) LOADED_PAY = await load(MILPAY_JSON_URL);
      await paintSuccess(payload, LOADED_PAY);
    } catch (err) {
      console.error("Aurora BAH Calculator error:", err);
      paintError(err && err.message ? err.message : "Unable to calculate estimate.", payload);
    } finally {
      IS_LOADING = false;
    }
  }

  function bind() {
    ["#bah-paygrade", "#bah-yos", "#bah-location", "#bah-dependents"].forEach(sel => {
      const el = $(sel);
      if (el) el.addEventListener("change", bootRun);
    });
  }

  function boot() {
    bind();
    bootRun();
    window.PCSU_AURORA_BAH = {
      run: bootRun,
      reloadPayTables: async function () {
        LOADED_PAY = await load(MILPAY_JSON_URL);
        return LOADED_PAY;
      }
    };
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
})();
</script>
