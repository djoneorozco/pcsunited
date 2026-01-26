/* ============================================================
   RS • AIOU Portal v3.1 (Hosted)
   - Full-screen AIOU overlay
   - Prefills Profile & Goals from Supabase using loginEmail
   - Keeps AIOU House Intake prefill
   ============================================================ */
(function () {
  "use strict";

  // Expose a tiny API so the loader can call mount() safely
  window.RS_AIOU_PORTAL = window.RS_AIOU_PORTAL || {};

  const DEFAULTS = {
    apiBase: "https://theorozcorealty.netlify.app/api",
    profileByEmailPath: "/profile-by-email",
    loginKey: "realtysass.loginEmail",
    houseIntakeKey: "realtysass.aiou_house_intake.v1",
    bridgeKey: "realtysass.bridge",
    scoreEndpoint: "https://theorozcorealty.netlify.app/.netlify/functions/aiou-score",
    reportEndpoint: "https://theorozcorealty.netlify.app/.netlify/functions/aiou-report"
  };

  const cfg = Object.assign({}, DEFAULTS, (window.RS_AIOU_PORTAL_CONFIG || {}));

  function readJSON(key, fallback) {
    try {
      return JSON.parse(localStorage.getItem(key) || "null") ?? fallback;
    } catch (_) {
      return fallback;
    }
  }

  function getLoginEmail() {
    try {
      return String(localStorage.getItem(cfg.loginKey) || "").trim();
    } catch (_) {
      return "";
    }
  }

  function safeText(v) {
    return String(v == null ? "" : v).trim();
  }

  function parseFirstName(fullName) {
    const s = safeText(fullName);
    if (!s) return "";
    return s.split(/\s+/)[0] || "";
  }

  function parseLastName(fullName) {
    const s = safeText(fullName);
    if (!s) return "";
    const parts = s.split(/\s+/).filter(Boolean);
    if (parts.length <= 1) return "";
    return parts.slice(1).join(" ");
  }

  async function fetchProfileFromSupabase(email) {
    // 1) Try cached profile (from your login endpoint)
    const cached = readJSON("realtysass.profile.v1", null);
    if (cached && (cached.email || cached.full_name || cached.fullName)) return cached;

    // 2) Call your API profile-by-email
    const url = cfg.apiBase.replace(/\/$/, "") + cfg.profileByEmailPath;
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email })
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error("profile-by-email " + r.status);
    if (data && data.ok === true && data.profile) return data.profile;

    // Some implementations return just {profile: {...}}
    if (data && data.profile) return data.profile;

    return null;
  }

  function extractHouseContext() {
    const aiouHouse = readJSON(cfg.houseIntakeKey, {}) || {};
    const bridge = readJSON(cfg.bridgeKey, {}) || {};
    const bridgeHouse = bridge && bridge.house ? bridge.house : {};

    return {
      bedrooms: aiouHouse.bedrooms ?? bridgeHouse.bedrooms ?? null,
      bathrooms: aiouHouse.bathrooms ?? bridgeHouse.bathrooms ?? null,
      sqft: aiouHouse.sqft ?? bridgeHouse.sqft ?? null,
      propertyType: aiouHouse.propertyType ?? bridgeHouse.propertyType ?? "",
      amenities: Array.isArray(aiouHouse.amenities)
        ? aiouHouse.amenities
        : (Array.isArray(bridgeHouse.amenities) ? bridgeHouse.amenities : []),
      conditionPreference: aiouHouse.conditionPreference ?? bridgeHouse.conditionPreference ?? null,
      yearBand: aiouHouse.yearBand ?? bridgeHouse.yearBand ?? null,
      styleVsPriceSlider: (aiouHouse.styleVsPriceSlider ?? bridge._aiouStyleVsPriceSlider ?? null)
    };
  }

  function mountPortal() {
    if (window.__RS_AIOU_PORTAL_MOUNTED__) return;
    window.__RS_AIOU_PORTAL_MOUNTED__ = true;

    // Create portal
    const portal = document.createElement("div");
    portal.id = "aiou-portal";
    document.body.appendChild(portal);

    // Styles + UI
    portal.innerHTML = `
      <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;800;900&display=swap" rel="stylesheet"/>
      <style>
        #aiou-portal, #aiou-portal *{ box-sizing:border-box; font-family:Inter,system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif; }
        :root{
          --bg:#0b0e1a; --panel:#101426; --panel2:#0f1324;
          --ink:#e9ecff; --muted:#a8b0d6; --border:rgba(255,255,255,.10);
          --accent:#8ef3c5; --accent2:#6aa7ff; --danger:#ff8aa6;
        }
        #aiou-portal{
          position:fixed; inset:0; z-index:2147483000;
          background:var(--bg); color:var(--ink); overflow-y:auto; padding:24px 0 80px;
          -webkit-font-smoothing:antialiased; -moz-osx-font-smoothing:grayscale;
        }
        .aiou-wrap{
          width:100%; max-width:1400px; min-width:1024px; margin:0 auto; padding:0 24px;
          display:grid; grid-template-columns:minmax(360px,1fr) minmax(360px,1fr);
          grid-auto-rows:min-content; gap:24px;
        }
        @media(max-width:1100px){
          .aiou-wrap{ min-width:0; max-width:100%; grid-template-columns:1fr; }
        }
        .aiou-card{
          background:
            radial-gradient(circle at 0% 0%, rgba(255,255,255,.07) 0%, rgba(0,0,0,0) 60%),
            linear-gradient(180deg,rgba(255,255,255,.04),rgba(255,255,255,.015) 60%,rgba(0,0,0,0) 100%);
          background-color:var(--panel);
          border:1px solid var(--border);
          border-radius:18px;
          box-shadow:0 24px 48px rgba(0,0,0,.8);
          padding:20px 20px 16px;
          position:relative;
        }
        .fullrow{ grid-column:1 / -1; }
        h1{ margin:0 0 12px; font-size:22px; font-weight:900; text-transform:uppercase; letter-spacing:.2px; padding-right:110px; }
        h2{ margin:0 0 6px; font-size:14px; font-weight:800; text-transform:uppercase; }
        .desc{ color:var(--muted); font-size:13px; line-height:1.5; margin:0 0 12px; max-width:520px; }
        .overallTimer{ position:absolute; top:20px; right:20px; display:flex; gap:10px; align-items:center; }
        .overallTimer .hint{ font-size:12px; color:var(--muted); }
        .overallTimer .badge{
          font-size:11px; font-weight:900; padding:5px 8px 4px; border-radius:999px;
          background:linear-gradient(180deg,var(--accent2),#4f86ff); color:#06112b;
          min-width:44px; text-align:center; box-shadow:0 8px 24px rgba(0,0,0,.8);
        }
        .bar{ display:flex; gap:10px; flex-wrap:wrap; margin-top:12px; }
        .btn{
          border:1px solid rgba(255,255,255,.14); background:var(--panel2); color:var(--ink);
          padding:10px 14px; border-radius:12px; cursor:pointer; font-weight:800; font-size:13px;
        }
        .btn.primary{ background:linear-gradient(180deg,var(--accent2),#4f86ff); border:none; color:#06112b; box-shadow:0 16px 32px rgba(0,0,0,.8); }
        .btn.warn{ background:transparent; border-color:var(--danger); color:var(--danger); }
        .grid{ display:grid; grid-template-columns:1fr 1fr; gap:14px; }
        @media(max-width:600px){ .grid{ grid-template-columns:1fr; } }
        label{ font-size:12px; font-weight:600; color:var(--ink); display:block; margin-bottom:6px; }
        input, select{
          width:100%; padding:10px 12px; font-size:13px; border-radius:12px;
          border:1px solid rgba(255,255,255,.14); background:rgba(255,255,255,.06); color:var(--ink);
          box-shadow:0 16px 32px rgba(0,0,0,.6) inset;
        }
        .hidden{ display:none !important; }
      </style>

      <div class="aiou-wrap">
        <div class="aiou-card" id="introCard">
          <div class="overallTimer">
            <span class="hint">About <span id="overallHint">~3 min</span></span>
            <span class="badge" id="overallClock">3:00</span>
          </div>
          <h1>A.I.O.U • TIMED<br>BUYER<br>PSYCHOLOGY TEST</h1>
          <p class="desc">Each question is timed (<b>10 seconds</b>). Choose from <b>-5</b> to <b>+5</b>.</p>
          <div class="bar">
            <button class="btn primary" id="startQuiz">Start Timed Quiz</button>
            <button class="btn" id="closePortal">Close</button>
          </div>
        </div>

        <div class="aiou-card" id="profileCard">
          <h2>Profile & Goals</h2>
          <p class="desc">We auto-fill from your account when possible.</p>
          <div class="grid">
            <div>
              <label>First Name</label>
              <input id="firstName" type="text" placeholder="e.g., Alex">
            </div>
            <div>
              <label>Last Name</label>
              <input id="lastName" type="text" placeholder="e.g., Rivera">
            </div>
            <div>
              <label>Bedrooms wanted</label>
              <input id="bedrooms" type="number" min="0" step="1" placeholder="e.g., 4">
            </div>
            <div>
              <label>Budget (max $)</label>
              <input id="budget" type="number" min="0" step="1000" placeholder="e.g., 450000">
            </div>
            <div>
              <label>Preferred setting</label>
              <select id="setting">
                <option value="city">City</option>
                <option value="suburb">Suburb</option>
                <option value="rural">Rural</option>
              </select>
            </div>
            <div>
              <label>Safety priority (1–5)</label>
              <select id="safety">
                <option>1</option><option>2</option><option>3</option><option>4</option><option selected>5</option>
              </select>
            </div>
          </div>
        </div>

        <div class="aiou-card fullrow hidden" id="quizCard">
          <h2>Quiz</h2>
          <p class="desc">Quiz engine loads after you hit Start.</p>
        </div>

        <div class="aiou-card fullrow hidden" id="resultsCard">
          <h2>Results</h2>
          <div id="resultsBox" class="desc">(Results will appear here.)</div>
        </div>
      </div>
    `;

    const $ = (sel) => portal.querySelector(sel);

    // Close handler
    $("#closePortal").addEventListener("click", () => portal.remove());

    // Prefill from Supabase + house intake
    (async function hydrate() {
      const email = getLoginEmail();
      if (!email) return;

      // House intake prefill (beds + slider seed if you extend later)
      const house = extractHouseContext();
      if (house.bedrooms != null && Number(house.bedrooms) > 0 && !safeText($("#bedrooms").value)) {
        $("#bedrooms").value = String(Math.round(Number(house.bedrooms)));
      }

      try {
        const profile = await fetchProfileFromSupabase(email);
        if (!profile) return;

        const fn =
          safeText(profile.first_name) ||
          safeText(profile.firstName) ||
          parseFirstName(profile.full_name || profile.fullName);

        const ln =
          safeText(profile.last_name) ||
          safeText(profile.lastName) ||
          parseLastName(profile.full_name || profile.fullName);

        const budget =
          profile.projected_home_price ??
          profile.price ??
          profile.projectedMortgage ??
          profile.projected_mortgage ??
          "";

        if (fn && !safeText($("#firstName").value)) $("#firstName").value = fn;
        if (ln && !safeText($("#lastName").value)) $("#lastName").value = ln;

        if (budget && !safeText($("#budget").value)) {
          // Keep numeric-ish
          const b = Number(String(budget).replace(/[^\d.]/g, ""));
          if (Number.isFinite(b) && b > 0) $("#budget").value = String(Math.round(b));
        }
      } catch (e) {
        console.warn("[AIOU Portal] Profile hydrate failed:", e.message || e);
      }
    })();

    // Minimal “Start” hook (your full quiz engine can live here next)
    $("#startQuiz").addEventListener("click", () => {
      $("#quizCard").classList.remove("hidden");
      $("#resultsCard").classList.remove("hidden");
      $("#resultsBox").textContent = "Quiz engine mounted (hosted bundle working). Next: paste in full AIOU quiz logic here.";
    });
  }

  // Auto-mount only if login exists (keeps your gating behavior)
  window.RS_AIOU_PORTAL.mount = function () {
    const email = getLoginEmail();
    if (!email) {
      console.log("[AIOU Portal] Login not found yet. Waiting…");
      return;
    }
    mountPortal();
  };

  // Try mount immediately (loader calls mount too)
  try {
    window.RS_AIOU_PORTAL.mount();
  } catch (_) {}
})();
