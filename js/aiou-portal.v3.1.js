/*! ============================================================
PCS United • AIOU Portal (Hosted) v3.1
- Runs as external JS to avoid Webflow 50k limit
- Waits for login: localStorage.realtysass.loginEmail OR event "realtysass:unlocked"
- Builds full-screen portal (HTML + CSS) in JS
- Prefills from:
  (1) Financial Dashboard (optional DOM scrape)
  (2) localStorage realtysass.aiou_house_intake.v1
  (3) Supabase via POST /api/aiou-profile (Netlify function)
- Scores via /functions/aiou-score OR local fallback
- Sends memo via /functions/aiou-report

Usage (Webflow embed):
<script>
  window.RS_AIOU_CONFIG = {
    apiBase: "https://theorozcorealty.netlify.app/api",
    scoreEndpoint: "https://theorozcorealty.netlify.app/.netlify/functions/aiou-score",
    reportEndpoint:"https://theorozcorealty.netlify.app/.netlify/functions/aiou-report",
    zIndex: 2147483000
  };
</script>
<script src="https://theorozcorealty.netlify.app/js/aiou-portal.v3.1.js"></script>
============================================================ */

(function(){
  "use strict";

  // ============================================================
  // //#1 CONFIG
  // ============================================================
  const CFG = Object.assign({
    apiBase: (function(){
      const h = String(location.hostname || "").toLowerCase();
      if (h.includes("webflow.io")) return "https://theorozcorealty.netlify.app/api";
      return "/api";
    })(),
    scoreEndpoint: "https://theorozcorealty.netlify.app/.netlify/functions/aiou-score",
    reportEndpoint:"https://theorozcorealty.netlify.app/.netlify/functions/aiou-report",
    zIndex: 2147483000,
    loginKey: "realtysass.loginEmail",
    houseKey: "realtysass.aiou_house_intake.v1",
    bridgeKey:"realtysass.bridge"
  }, (window.RS_AIOU_CONFIG || {}));

  if (window.__RS_AIOU_PORTAL_HOSTED__) return;
  window.__RS_AIOU_PORTAL_HOSTED__ = true;

  // ============================================================
  // //#2 LOGIN GATE
  // ============================================================
  function hasLogin(){
    try{
      const v = (localStorage.getItem(CFG.loginKey) || "").trim();
      if (v) return true;
    }catch(_){}
    try{
      if (window.RS_AUTH && window.RS_AUTH.ok === true) return true;
    }catch(_){}
    return false;
  }

  function waitForLoginThen(fn){
    if (hasLogin()) return fn();

    const onUnlock = () => { if (hasLogin()) cleanupAndRun(); };
    const poll = setInterval(()=>{ if (hasLogin()) cleanupAndRun(); }, 200);

    function cleanupAndRun(){
      clearInterval(poll);
      try{ window.removeEventListener("realtysass:unlocked", onUnlock); }catch(_){}
      fn();
    }

    try{ window.addEventListener("realtysass:unlocked", onUnlock); }catch(_){}
  }

  // ============================================================
  // //#3 HELPERS
  // ============================================================
  const $ = (root, sel)=>root.querySelector(sel);
  const $$ = (root, sel)=>Array.from(root.querySelectorAll(sel));

  function readJSON(key, fallback){
    try { return JSON.parse(localStorage.getItem(key) || "null") ?? fallback; }
    catch(_) { return fallback; }
  }

  function getLoginEmail(){
    try{ return String(localStorage.getItem(CFG.loginKey) || "").trim().toLowerCase(); }
    catch(_){ return ""; }
  }

  function setIfEmpty(inputEl, val){
    if (!inputEl) return;
    const cur = ("value" in inputEl) ? String(inputEl.value || "").trim() : "";
    const next = String(val ?? "").trim();
    if (!cur && next) inputEl.value = next;
  }

  function setNumberIfEmpty(inputEl, val){
    if (!inputEl) return;
    const cur = String(inputEl.value || "").trim();
    if (cur !== "") return;
    const n = Number(val);
    if (Number.isFinite(n) && n > 0) inputEl.value = String(Math.round(n));
  }

  function setSelectIfDefault(selectEl, val, defaultVal){
    if (!selectEl) return;
    const cur = String(selectEl.value || "").trim();
    const next = String(val ?? "").trim().toLowerCase();
    if (cur && cur !== defaultVal) return;
    if (!next) return;
    const opts = Array.from(selectEl.options || []).map(o => String(o.value || "").toLowerCase());
    if (opts.includes(next)) selectEl.value = next;
  }

  function mmss(ms){
    const s = Math.max(0, Math.ceil(ms/1000));
    const m = Math.floor(s/60);
    const r = s % 60;
    return m+":"+String(r).padStart(2,'0');
  }

  // ============================================================
  // //#4 INJECT STYLES
  // ============================================================
  function injectStyles(){
    if (document.getElementById("rs-aiou-style")) return;
    const style = document.createElement("style");
    style.id = "rs-aiou-style";
    style.textContent = `
#aiou-portal, #aiou-portal * { box-sizing:border-box; font-family: Inter, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif; }
:root{
  --bg:#0b0e1a; --panel:#101426; --panel-2:#0f1324;
  --ink:#e9ecff; --muted:#a8b0d6; --border:rgba(255,255,255,.10);
  --accent:#8ef3c5; --accent2:#6aa7ff; --danger:#ff8aa6;
  --chip-bg-start:#6aa7ff; --chip-bg-end:#4f86ff;
}
#aiou-portal{
  position:fixed; inset:0; z-index:${CFG.zIndex};
  background:var(--bg); color:var(--ink);
  overflow-y:auto; isolation:isolate;
  -webkit-font-smoothing:antialiased; -moz-osx-font-smoothing:grayscale;
  padding:24px 0 80px;
}
.aiou-wrap{
  width:100%; max-width:1400px; min-width:1024px;
  margin:0 auto; padding:0 24px;
  display:grid; grid-template-columns:minmax(360px,1fr) minmax(360px,1fr);
  grid-auto-rows:min-content; gap:24px;
}
@media(max-width:1100px){ .aiou-wrap{min-width:0; max-width:100%; grid-template-columns:1fr;} }
.aiou-card{
  background:
    radial-gradient(circle at 0% 0%, rgba(255,255,255,.07) 0%, rgba(0,0,0,0) 60%),
    linear-gradient(180deg,rgba(255,255,255,.04),rgba(255,255,255,.015) 60%,rgba(0,0,0,0) 100%);
  background-color:#101426;
  border:1px solid var(--border);
  border-radius:18px;
  box-shadow:0 24px 48px rgba(0,0,0,.8);
  padding:20px 20px 16px;
  position:relative;
}
.aiou-card.fullrow{ grid-column:1/-1; }
.overallTimer{ position:absolute; top:20px; right:20px; display:flex; align-items:center; gap:10px; text-align:right; }
.overallTimer .hint{ font-size:12px; color:var(--muted); line-height:1.3; }
.overallTimer .badge{
  font-size:11px; font-weight:900; padding:5px 8px 4px; border-radius:999px;
  background:linear-gradient(180deg,var(--chip-bg-start),var(--chip-bg-end));
  color:#06112b; min-width:44px; text-align:center;
  box-shadow:0 8px 24px rgba(0,0,0,.8);
}
.aiou-title-block h1{ margin:0 0 12px; font-size:22px; font-weight:900; line-height:1.25; letter-spacing:.2px; text-transform:uppercase; padding-right:110px; }
@media(max-width:600px){ .aiou-title-block h1{font-size:20px; padding-right:0;} }
.aiou-desc{ color:var(--muted); font-size:13px; line-height:1.5; margin:0 0 12px; max-width:480px; }
.aiou-bar{ display:flex; gap:10px; flex-wrap:wrap; margin-top:12px; }
.aiou-btn{
  border:1px solid rgba(255,255,255,.14); background:var(--panel-2); color:var(--ink);
  padding:10px 14px; border-radius:12px; cursor:pointer;
  font-weight:800; font-size:13px; line-height:1.2;
}
.aiou-btn.primary{
  background:linear-gradient(180deg,var(--chip-bg-start),var(--chip-bg-end));
  border:none; color:#06112b; box-shadow:0 16px 32px rgba(0,0,0,.8);
}
.aiou-btn.warn{ background:transparent; border-color:var(--danger); color:var(--danger); }
.aiou-card h2{ margin:0 0 6px; font-size:14px; font-weight:800; text-transform:uppercase; }
.aiou-card .blurb{ color:var(--muted); font-size:12px; line-height:1.4; margin:0 0 16px; max-width:520px; }
.aiou-grid{ display:grid; grid-template-columns:1fr 1fr; gap:14px; }
@media(max-width:600px){ .aiou-grid{ grid-template-columns:1fr; } }
label.aiou-label{ font-size:12px; font-weight:600; color:var(--ink); display:block; margin-bottom:6px; }
.aiou-input, .aiou-select{
  width:100%; padding:10px 12px; font-size:13px; line-height:1.3;
  border-radius:12px; border:1px solid rgba(255,255,255,.14);
  background:rgba(255,255,255,.06); color:var(--ink);
  box-shadow:0 16px 32px rgba(0,0,0,.6) inset;
}
.aiou-input::placeholder{ color:#c9d2ff88; }
.qtopbar{ position:absolute; left:16px; right:16px; top:10px; height:6px; background:rgba(255,255,255,.10); border-radius:999px; overflow:hidden; }
.qtopbar > i{ display:block; height:100%; width:100%; background:linear-gradient(90deg,var(--accent),var(--accent2)); transform-origin:left; }
#qTitle{ margin:24px 0 4px; font-size:15px; font-weight:800; text-transform:uppercase; }
#qText{ color:var(--muted); font-size:13px; line-height:1.5; margin:0 0 12px; max-width:600px; }
.hidden{ display:none !important; }
.dualpref{ display:grid; grid-template-columns:1fr 1fr; grid-template-rows:auto auto; gap:12px; align-items:center; margin-top:10px; }
@media(max-width:800px){ .dualpref{ grid-template-columns:1fr; } }
.dualpref figure{ margin:0; }
.dualpref img{
  width:100%; max-height:280px; border-radius:12px; border:1px solid var(--border);
  object-fit:cover; background:#0b0e1a; box-shadow:0 24px 48px rgba(0,0,0,.8);
  cursor:pointer;
}
.dualpref figcaption{ text-align:center; font-size:12px; color:var(--muted); margin-top:6px; }
.sliderRow{ grid-column:1/-1; display:flex; align-items:center; gap:12px; }
.sliderRow .end{ font-size:12px; font-weight:700; color:var(--muted); }
.rangeWrap{ flex:1 1 auto; display:flex; align-items:center; gap:8px; width:100%; }
input[type=range]{ appearance:none; width:100%; height:4px; background:rgba(255,255,255,.18); border-radius:999px; }
input[type=range]::-webkit-slider-thumb{
  -webkit-appearance:none; width:18px; height:18px; border-radius:50%;
  background:var(--accent2); box-shadow:0 8px 16px rgba(0,0,0,.8); cursor:pointer; border:0;
}
input[type=range]::-moz-range-thumb{
  width:18px; height:18px; border-radius:50%;
  background:var(--accent2); box-shadow:0 8px 16px rgba(0,0,0,.8); cursor:pointer; border:0;
}
.scale{ display:grid; grid-template-columns:repeat(11,1fr); gap:8px; margin:16px 0 0; max-width:600px; }
.pill{
  text-align:center; padding:10px 0; border-radius:10px; font-size:12px;
  border:1px solid rgba(255,255,255,.16); background:rgba(255,255,255,.06);
  cursor:pointer; box-shadow:0 16px 32px rgba(0,0,0,.6) inset; color:var(--ink);
}
.pill[data-sel="1"]{
  outline:2px solid var(--accent2);
  color:#06112b; background:linear-gradient(180deg,var(--chip-bg-start),var(--chip-bg-end));
  border:none; box-shadow:0 16px 32px rgba(0,0,0,.8);
}
.quiz-controls{ display:flex; gap:10px; flex-wrap:wrap; margin-top:16px; }
.quiz-hint{ font-size:12px; color:var(--muted); margin-top:6px; max-width:520px; }
.kpi-row{ display:flex; flex-wrap:wrap; gap:10px; margin:16px 0 12px; }
.kpi-chip{
  background:rgba(255,255,255,.05);
  border:1px solid rgba(255,255,255,.12);
  border-radius:12px;
  padding:12px;
  min-width:140px;
  box-shadow:0 24px 48px rgba(0,0,0,.8);
}
.kpi-chip h3{ margin:0 0 6px; font-size:11px; font-weight:700; color:var(--muted); text-transform:uppercase; letter-spacing:.2px; }
.kpi-chip div{ font-size:18px; font-weight:900; color:var(--ink); }
.consistency-block, .arch-block, .mbti-block{ font-size:12px; line-height:1.5; color:var(--muted); margin-bottom:8px; }
.arch-block, .mbti-block{ color:var(--ink); font-weight:800; }
.flag{ color:var(--danger); font-weight:800; }
.ok{ color:#58f7b7; font-weight:800; }
#jsonReportBox{
  background:rgba(255,255,255,.05);
  border:1px solid rgba(255,255,255,.12);
  border-radius:12px;
  font-size:12px; line-height:1.5; color:var(--ink);
  padding:16px; min-height:200px;
  box-shadow:0 24px 48px rgba(0,0,0,.8) inset, 0 24px 48px rgba(0,0,0,.8);
  white-space:normal;
}
`;
    document.head.appendChild(style);

    // Ensure font loaded (safe no-op if already)
    if (!document.getElementById("rs-aiou-font")) {
      const link = document.createElement("link");
      link.id = "rs-aiou-font";
      link.rel = "stylesheet";
      link.href = "https://fonts.googleapis.com/css2?family=Inter:wght@400;600;800;900&display=swap";
      document.head.appendChild(link);
    }
  }

  // ============================================================
  // //#5 TEMPLATE
  // ============================================================
  function buildPortal(){
    injectStyles();

    const existing = document.getElementById("aiou-portal");
    if (existing) existing.remove();

    const portal = document.createElement("div");
    portal.id = "aiou-portal";
    portal.innerHTML = `
      <div class="aiou-wrap">
        <div class="aiou-card" id="introCard">
          <div class="overallTimer">
            <span class="hint">About <span id="overallHint">~3 min</span></span>
            <span class="badge" id="overallClock">3:00</span>
          </div>

          <div class="aiou-title-block">
            <h1>A.I.O.U • TIMED<br>BUYER<br>PSYCHOLOGY TEST</h1>
            <p class="aiou-desc">
              Each question is timed (<b>10 seconds</b>). Choose from <b>-5</b> to <b>+5</b>.
              Some items repeat in different words to check consistency.
            </p>
          </div>

          <div class="aiou-bar">
            <button class="aiou-btn primary" id="startQuiz">Start Timed Quiz</button>
            <button class="aiou-btn" id="closePortal">Close</button>
          </div>
        </div>

        <div class="aiou-card" id="profileCard">
          <h2>Profile & Goals</h2>
          <p class="blurb">
            We use this context to generate your personalized Buyer Memo at the end.
            (Auto-filled when possible.)
          </p>

          <div class="aiou-grid">
            <div>
              <label class="aiou-label">First Name</label>
              <input id="firstName" class="aiou-input" type="text" placeholder="e.g., Alex">
            </div>
            <div>
              <label class="aiou-label">Last Name</label>
              <input id="lastName" class="aiou-input" type="text" placeholder="e.g., Rivera">
            </div>

            <div>
              <label class="aiou-label">Bedrooms wanted</label>
              <input id="bedrooms" class="aiou-input" type="number" min="0" step="1" placeholder="e.g., 4">
            </div>
            <div>
              <label class="aiou-label">Budget (max $)</label>
              <input id="budget" class="aiou-input" type="number" min="0" step="1000" placeholder="e.g., 450000">
            </div>

            <div>
              <label class="aiou-label">Preferred setting</label>
              <select id="setting" class="aiou-select">
                <option value="city">City</option>
                <option value="suburb">Suburb</option>
                <option value="rural">Rural</option>
              </select>
            </div>
            <div>
              <label class="aiou-label">Safety priority (1–5)</label>
              <select id="safety" class="aiou-select">
                <option>1</option><option>2</option><option>3</option>
                <option>4</option><option selected>5</option>
              </select>
            </div>
          </div>
        </div>

        <div class="aiou-card fullrow hidden" id="quizCard" style="position:relative;">
          <div class="qtopbar"><i id="qTopTimer"></i></div>
          <div id="qTitle">Question</div>
          <div id="qText" class="aiou-desc" style="margin-bottom:12px;"></div>

          <div id="visualArea" class="hidden">
            <div class="dualpref">
              <figure>
                <img id="vImgA"
                  src="https://cdn.prod.website-files.com/68cecb820ec3dbdca3ef9099/68f9a10aab47946a36f5c135_04d878cc02583fb9bfda33ddbd28d91a_MinorFixesHome.jpg"
                  alt="May Require Fixes (Option A)">
                <figcaption>May Require Fixes</figcaption>
              </figure>

              <figure>
                <img id="vImgB"
                  src="https://cdn.prod.website-files.com/68cecb820ec3dbdca3ef9099/68f9a113c4924ecebad2319a_a0cc3184b96f525ed5a278c3bac62891_BrandNewHome.jpg"
                  alt="Brand New Home (Option B)">
                <figcaption>Brand New Home</figcaption>
              </figure>

              <div class="sliderRow">
                <span class="end">Needs Fixes</span>
                <div class="rangeWrap">
                  <input id="vSlider" type="range" min="-5" max="5" value="0" step="1">
                </div>
                <span class="end">Brand New</span>
              </div>
            </div>
            <div class="aiou-desc" id="vLabel" style="text-align:center;margin-top:8px;">Neutral</div>
          </div>

          <div class="scale" id="scaleBlock"></div>

          <div class="quiz-controls">
            <button class="aiou-btn" id="skip">Skip</button>
            <button class="aiou-btn warn" id="reset">Reset</button>
          </div>
          <div class="quiz-hint">
            No answer = neutral (0) after 10 seconds. “Skip” moves on immediately.
          </div>
        </div>

        <div class="aiou-card fullrow hidden" id="resultsCard">
          <h2>Results</h2>
          <p class="blurb">Your buyer psychology profile and personalized memo.</p>

          <div class="kpi-row">
            <div class="kpi-chip"><h3>OPENNESS</h3><div id="kO">—</div></div>
            <div class="kpi-chip"><h3>CONSCIENTIOUSNESS</h3><div id="kC">—</div></div>
            <div class="kpi-chip"><h3>EXTRAVERSION</h3><div id="kE">—</div></div>
            <div class="kpi-chip"><h3>AGREEABLENESS</h3><div id="kA">—</div></div>
            <div class="kpi-chip"><h3>RISK AVERSION</h3><div id="kN">—</div></div>
          </div>

          <div id="consistency" class="consistency-block"></div>
          <div id="archetype" class="arch-block" style="font-weight:900;"></div>
          <div id="mbti" class="mbti-block"></div>

          <div id="jsonReportBox">(Generating your personalized memo…)</div>
        </div>
      </div>
    `;
    document.body.appendChild(portal);
    return portal;
  }

  // ============================================================
  // //#6 PREFILL SOURCES
  // ============================================================
  function prefillFromFinancial(portal){
    const rsRoot = document.querySelector('#rs-shell');
    function readField(sel){
      if(!rsRoot) return '';
      const el = rsRoot.querySelector(sel);
      if(!el) return '';
      if('value' in el && el.value != null && String(el.value).trim() !== '') return String(el.value).trim();
      if('textContent' in el && el.textContent) return String(el.textContent).trim();
      return '';
    }
    const first = readField('.pf-fname');
    const last  = readField('.pf-lname');
    const price = readField('#h-price');

    const aiouFirst = $(portal, '#firstName');
    const aiouLast  = $(portal, '#lastName');
    const aiouBudget= $(portal, '#budget');

    if (aiouFirst && first && !aiouFirst.value) aiouFirst.value = first;
    if (aiouLast  && last  && !aiouLast.value ) aiouLast.value  = last;
    if (aiouBudget&& price && !aiouBudget.value) aiouBudget.value = price;
  }

  function prefillFromAIOUHouse(portal){
    const aiouHouse = readJSON(CFG.houseKey, {}) || {};
    const bridge = readJSON(CFG.bridgeKey, {}) || {};
    const bridgeHouse = (bridge && bridge.house) ? bridge.house : {};

    const bedsFromIntake = (aiouHouse.bedrooms ?? bridgeHouse.bedrooms ?? null);
    const sliderFromIntake = (aiouHouse.styleVsPriceSlider ?? bridge._aiouStyleVsPriceSlider ?? null);

    const elBeds = $(portal, '#bedrooms');
    if (elBeds && (String(elBeds.value||'').trim()==='')){
      if (bedsFromIntake != null && Number(bedsFromIntake) > 0){
        elBeds.value = String(Math.round(Number(bedsFromIntake)));
      }
    }

    if (sliderFromIntake != null && Number.isFinite(Number(sliderFromIntake))){
      window.__STYLE_V_PRICE = Math.max(-5, Math.min(5, Number(sliderFromIntake)));
    }
  }

  async function hydrateProfileFromSupabase(portal){
    const email = getLoginEmail();
    if (!email) return;

    try{
      const r = await fetch(`${CFG.apiBase}/aiou-profile`, {
        method:"POST",
        headers:{ "Content-Type":"application/json" },
        body: JSON.stringify({ email })
      });

      const j = await r.json().catch(()=> ({}));
      if (!r.ok || !j || j.ok !== true) throw new Error((j && j.error) ? j.error : ("HTTP "+r.status));

      const d = j.data || {};
      setIfEmpty($(portal,'#firstName'), d.firstName);
      setIfEmpty($(portal,'#lastName'),  d.lastName);
      setNumberIfEmpty($(portal,'#bedrooms'), d.bedroomsWanted);

      const bg = $(portal,'#budget');
      if (bg && String(bg.value||'').trim()===''){
        const b = Number(d.budgetMax);
        if (Number.isFinite(b) && b > 0) bg.value = String(Math.round(b));
      }

      setSelectIfDefault($(portal,'#setting'), d.preferredSetting, "city");

      const sf = $(portal,'#safety');
      if (sf){
        const cur = String(sf.value || "5");
        const next = Number(d.safetyPriority);
        if (cur === "5" && Number.isFinite(next) && next >= 1 && next <= 5){
          sf.value = String(Math.round(next));
        }
      }
    }catch(e){
      console.warn("AIOU Supabase hydrate failed:", e && e.message ? e.message : e);
    }
  }

  // ============================================================
  // //#7 QUIZ DATA + SCORING (same behavior)
  // ============================================================
  const Q = [
    { id:'V1', type:'visual', dim:'O', text:'Choose between Brand New Home vs May Require Fixes.', rev:false },

    { id:'O1',  dim:'O', text:'I prefer a home that looks new or freshly renovated rather than plain but practical.', rev:false, ctrlPair:'O1b' },
    { id:'O1b', dim:'O', text:'I’m fine with a simple, ordinary-looking home if it works.',                         rev:true,  ctrlPair:'O1'  },
    { id:'O2',  dim:'O', text:'Special features (big windows, open kitchen, modern finishes) are worth paying more.', rev:false },
    { id:'O3',  dim:'O', text:'I want a home that feels different from most homes I’ve seen.',                      rev:false },

    { id:'C1',  dim:'C', text:'If a place is just above my budget, I would still try to get it.', rev:true,  ctrlPair:'C1b' },
    { id:'C1b', dim:'C', text:'I will not go over my budget, even if I love the home.',          rev:false, ctrlPair:'C1'  },
    { id:'C2',  dim:'C', text:'Lower monthly costs matter more to me than extra style.',          rev:false },

    { id:'E1',  dim:'E', text:'I often picture hosting dinners, parties, or family gatherings at home.', rev:false, ctrlPair:'E1b' },
    { id:'E1b', dim:'E', text:'I rarely imagine hosting people at my home.',                             rev:true,  ctrlPair:'E1'  },
    { id:'E2',  dim:'E', text:'I would trade an extra bedroom for a bigger living room or outdoor area.', rev:false },

    { id:'A1',  dim:'A', text:'I can be flexible on details if the main things are met.', rev:false, ctrlPair:'A1b' },
    { id:'A1b', dim:'A', text:'Once I set my must-haves, I won’t bend on them.',          rev:true,  ctrlPair:'A1'  },

    { id:'N1',  dim:'N', text:'Buying a home that needs repairs would stress me out.',         rev:false, ctrlPair:'N1b' },
    { id:'N1b', dim:'N', text:'A home that needs repairs doesn’t worry me much.',              rev:true,  ctrlPair:'N1'  },
    { id:'N2',  dim:'N', text:'I’d rather choose a 5–10 year-old home that’s already proven than brand-new.', rev:false },
    { id:'N3',  dim:'N', text:'I prefer a quieter, safer area even if it’s farther from restaurants and events.', rev:false },

    { id:'X1',  dim:'O', text:'If I must choose, I’ll pick style and layout over getting the lowest possible price.', rev:false }
  ];

  function buildScalePills(portal, onPick){
    const block = $(portal,'#scaleBlock');
    block.innerHTML = '';
    for (let v=-5; v<=5; v++){
      const pill = document.createElement('div');
      pill.className = 'pill';
      pill.textContent = String(v);
      pill.dataset.val = String(v);
      pill.dataset.sel = '0';
      pill.addEventListener('click', ()=>onPick(v));
      block.appendChild(pill);
    }
  }

  function scoreAllLocal(answers){
    const dims={O:[],C:[],E:[],A:[],N:[]};
    const qMap=Object.fromEntries(Q.map(q=>[q.id,q]));
    Q.forEach(q=>{
      if(q.type==='visual') return;
      let v=answers[q.id]; if(v==null) v=0;
      if(q.rev) v=-v;
      const mapped=((v+5)*0.4)+1;
      if(dims[q.dim]) dims[q.dim].push(mapped);
    });

    const avg=a=>a.reduce((x,y)=>x+y,0)/a.length || 3;
    const S={ O:+avg(dims.O).toFixed(2), C:+avg(dims.C).toFixed(2), E:+avg(dims.E).toFixed(2), A:+avg(dims.A).toFixed(2), N:+avg(dims.N).toFixed(2) };

    const v = Number(window.__STYLE_V_PRICE || 0);
    S.O = +(Math.max(1, Math.min(5, S.O + (v/12.5)))).toFixed(2);

    const flags=[];
    const handled=new Set();
    Q.forEach(q=>{
      if(q.ctrlPair && !handled.has(q.id)){
        const a=answers[q.id];
        const b=answers[q.ctrlPair];
        if(a!=null && b!=null){
          const aAdj=q.rev? -a:a;
          const bAdj=(qMap[q.ctrlPair].rev? -b:b);
          if(Math.abs(aAdj-bAdj)>=6) flags.push(`${q.id}/${q.ctrlPair}`);
        }
        handled.add(q.id); handled.add(q.ctrlPair);
      }
    });

    return {scores:S, inconsistencies:flags};
  }

  async function scoreViaServer(payload){
    const r = await fetch(CFG.scoreEndpoint, {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify(payload)
    });
    if(!r.ok) throw new Error('Score server returned ' + r.status);
    const data = await r.json();
    if (!data || data.ok !== true) throw new Error((data && data.error) ? data.error : 'Score response not ok');
    return data;
  }

  async function sendToLLM(brief, portal){
    const box = $(portal,'#jsonReportBox');
    box.textContent = '(Generating your personalized memo…)';
    const r = await fetch(CFG.reportEndpoint,{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify(brief)
    });
    if(!r.ok) throw new Error('Report server returned ' + r.status);
    const data = await r.json().catch(()=> ({}));
    const html = data.memoHtml || (data.memo ? `<p>${String(data.memo).replace(/</g,'&lt;')}</p>` : '<p>No memo returned.</p>');
    box.innerHTML = html;
  }

  // ============================================================
  // //#8 RUN PORTAL
  // ============================================================
  waitForLoginThen(async function(){
    const portal = buildPortal();

    // Prefill order
    try{ prefillFromFinancial(portal); }catch(_){}
    try{ prefillFromAIOUHouse(portal); }catch(_){}
    try{ await hydrateProfileFromSupabase(portal); }catch(_){}

    // State
    let answers = {};
    let idx = 0;
    let timer = null;
    let tLeft = 10;
    let overallTimer = null;
    let overallLeftMs = Q.length * 10000;

    if (window.__STYLE_V_PRICE == null) window.__STYLE_V_PRICE = 0;

    function startPerQuestionTimer(){
      clearInterval(timer);
      tLeft = 10;
      const bar = $(portal,'#qTopTimer');
      if (bar) bar.style.transform='scaleX(1)';
      timer = setInterval(()=>{
        tLeft -= 0.05;
        const frac = Math.max(0, tLeft/10);
        if (bar) bar.style.transform = `scaleX(${frac})`;
        if (tLeft<=0){
          clearInterval(timer);
          recordAnswer(null);
        }
      },50);
    }

    function initVisualSlider(){
      const s = $(portal,'#vSlider');
      const lbl = $(portal,'#vLabel');
      const imgA= $(portal,'#vImgA');
      const imgB= $(portal,'#vImgB');

      function explain(v){
        if (v <= -3) return "Prefers Needs Fixes strongly (Option A)";
        if (v === -2 || v === -1) return "Leans Needs Fixes (Option A)";
        if (v === 0) return "Neutral";
        if (v === 1 || v === 2) return "Leans Brand New (Option B)";
        return "Prefers Brand New strongly (Option B)";
      }
      function update(){
        const val = Number(s.value||0);
        window.__STYLE_V_PRICE = val;
        if (lbl) lbl.textContent = explain(val);
      }
      if (s){
        s.value = String(window.__STYLE_V_PRICE || 0);
        s.addEventListener('input', update);
        update();
      }
      if (imgA) imgA.addEventListener('click', ()=>{ s.value = Math.max(-5,(Number(s.value)||0)-1); s.dispatchEvent(new Event('input')); });
      if (imgB) imgB.addEventListener('click', ()=>{ s.value = Math.min(5,(Number(s.value)||0)+1); s.dispatchEvent(new Event('input')); });
    }

    function renderQuestion(){
      const q = Q[idx];
      $(portal,'#qTitle').textContent = `Question ${idx+1} / ${Q.length}`;
      $(portal,'#qText').textContent = (q.type==='visual')
        ? 'Where are you between these two options right now?'
        : q.text;

      const visual = $(portal,'#visualArea');
      const scale  = $(portal,'#scaleBlock');

      if(q.type==='visual'){
        visual.classList.remove('hidden');
        scale.classList.add('hidden');
        initVisualSlider();
      } else {
        visual.classList.add('hidden');
        scale.classList.remove('hidden');
        buildScalePills(portal, (v)=>selectValue(v));
        // restore previous
        $$(portal,'.pill').forEach(p=>p.dataset.sel='0');
        const prev = answers[q.id];
        if(prev!=null){
          const el = $$(portal,'.pill').find(x=>Number(x.dataset.val)===prev);
          if(el) el.dataset.sel='1';
        }
      }

      startPerQuestionTimer();
    }

    function recordAnswer(v){
      const q = Q[idx];
      if(q.type==='visual'){
        const s = $(portal,'#vSlider');
        const raw = (v===null ? 0 : Number(s.value||0));
        answers[q.id] = raw;
        window.__STYLE_V_PRICE = raw;
      } else {
        answers[q.id] = (v===null ? 0 : Number(v));
      }

      idx++;
      if(idx < Q.length) renderQuestion();
      else finishQuiz();
    }

    function selectValue(v){
      clearInterval(timer);
      $$(portal,'.pill').forEach(p=>p.dataset.sel='0');
      const el = $$(portal,'.pill').find(x=>Number(x.dataset.val)===v);
      if(el) el.dataset.sel='1';
      recordAnswer(v);
    }

    async function finishQuiz(){
      $(portal,'#quizCard').classList.add('hidden');
      if (overallTimer) clearInterval(overallTimer);

      $(portal,'#resultsCard').classList.remove('hidden');
      $(portal,'#jsonReportBox').textContent = '(Generating your personalized memo…)';

      const profile = {
        firstName: $(portal,'#firstName').value.trim(),
        lastName:  $(portal,'#lastName').value.trim(),
        bedrooms:  Number($(portal,'#bedrooms').value||0),
        budgetMax: Number($(portal,'#budget').value||0),
        setting:   $(portal,'#setting').value,
        safetyPriority: Number($(portal,'#safety').value||3)
      };

      const styleVsPriceSlider = Number(window.__STYLE_V_PRICE ?? 0);

      const scorePayload = {
        answers: Object.assign({}, answers),
        styleVsPriceSlider
      };

      let scored;
      try{
        scored = await scoreViaServer(scorePayload);
      }catch(_){
        const local = scoreAllLocal(answers);
        scored = { ok:true, scores:local.scores, inconsistencies:local.inconsistencies, archetype:"Balanced Explorer" };
      }

      const scores = scored.scores || {O:3,C:3,E:3,A:3,N:3};
      $(portal,'#kO').textContent = Number(scores.O).toFixed(2);
      $(portal,'#kC').textContent = Number(scores.C).toFixed(2);
      $(portal,'#kE').textContent = Number(scores.E).toFixed(2);
      $(portal,'#kA').textContent = Number(scores.A).toFixed(2);
      $(portal,'#kN').textContent = Number(scores.N).toFixed(2);

      const inconsistencies = scored.inconsistencies || [];
      $(portal,'#consistency').innerHTML = inconsistencies.length
        ? `<span class="flag">⚠ Consistency flags:</span> ${inconsistencies.join(", ")}`
        : `<span class="ok">✓ Responses appear consistent across rephrased items.</span>`;

      const archetype = scored.archetype || "Balanced Explorer";
      $(portal,'#archetype').textContent = `Archetype: ${archetype}`;

      // minimal mbti display (server can return richer; we keep safe)
      if (scored.mbti && scored.mbti.type){
        $(portal,'#mbti').innerHTML = `MBTI: <b>${scored.mbti.type}</b><br><span style="color:var(--muted);font-weight:400;">${scored.mbti.blurb || ""}</span>`;
      } else {
        $(portal,'#mbti').innerHTML = `MBTI: <b>—</b>`;
      }

      const brief = {
        version:"aiou.hosted.v3.1",
        ts:new Date().toISOString(),
        profile,
        scores,
        archetype,
        psych:{ totalItems: Q.length, inconsistencies, answers: Object.assign({}, answers) },
        visual:{ styleVsPriceSlider }
      };

      try{
        await sendToLLM(brief, portal);
      }catch(e){
        $(portal,'#jsonReportBox').innerHTML = `<span class="flag">Error: ${String(e && e.message ? e.message : e)}</span>`;
      }
    }

    function startQuizFlow(){
      answers = {};
      idx = 0;
      Q.forEach(q=>answers[q.id]=undefined);

      overallLeftMs = Q.length * 10000;
      $(portal,'#overallClock').textContent = mmss(overallLeftMs);

      if (overallTimer) clearInterval(overallTimer);
      overallTimer = setInterval(()=>{
        overallLeftMs -= 200;
        if (overallLeftMs <= 0){
          overallLeftMs = 0;
          clearInterval(overallTimer);
        }
        $(portal,'#overallClock').textContent = mmss(overallLeftMs);
      },200);

      $(portal,'#quizCard').classList.remove('hidden');
      $(portal,'#resultsCard').classList.add('hidden');

      renderQuestion();
    }

    // Wire buttons
    $(portal,'#startQuiz').addEventListener('click', startQuizFlow);
    $(portal,'#skip').addEventListener('click', ()=>recordAnswer(null));
    $(portal,'#reset').addEventListener('click', ()=>{ if (overallTimer) clearInterval(overallTimer); startQuizFlow(); });
    $(portal,'#closePortal').addEventListener('click', ()=>{ if (overallTimer) clearInterval(overallTimer); portal.remove(); });

    // Start hidden cards
    $(portal,'#quizCard').classList.add('hidden');
    $(portal,'#resultsCard').classList.add('hidden');
  });

})();
