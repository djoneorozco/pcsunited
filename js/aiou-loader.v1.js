/*! ============================================================
PCS United • AIOU Loader v1.0
- Prevents blank pages by showing a visible "Loading/Locked/Error" screen
- Loads the big hosted quiz only after login key exists
============================================================ */
(function(){
  "use strict";

  const CFG = Object.assign({
    hostQuizSrc: "https://theorozcorealty.netlify.app/js/aiou-portal.v3.1.js",
    loginKey: "realtysass.loginEmail",
    zIndex: 2147483000
  }, (window.RS_AIOU_LOADER_CONFIG || {}));

  function el(tag, props){
    const n = document.createElement(tag);
    if (props) Object.assign(n, props);
    return n;
  }

  function readLoginEmail(){
    try { return String(localStorage.getItem(CFG.loginKey) || "").trim(); }
    catch(_) { return ""; }
  }

  function mountShell(){
    if (document.getElementById("rs-aiou-loader-root")) return document.getElementById("rs-aiou-loader-root");

    const root = el("div");
    root.id = "rs-aiou-loader-root";
    root.style.cssText = [
      "position:fixed",
      "inset:0",
      "background:#0b0e1a",
      "color:#e9ecff",
      "z-index:"+CFG.zIndex,
      "display:flex",
      "align-items:center",
      "justify-content:center",
      "font-family:Inter,system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif",
      "padding:24px"
    ].join(";");

    const card = el("div");
    card.style.cssText = [
      "max-width:720px",
      "width:100%",
      "background:linear-gradient(180deg, rgba(255,255,255,.06), rgba(255,255,255,.03))",
      "border:1px solid rgba(255,255,255,.10)",
      "border-radius:18px",
      "box-shadow:0 24px 48px rgba(0,0,0,.8)",
      "padding:22px"
    ].join(";");

    const h = el("div",{ textContent:"AIOU QUIZ" });
    h.style.cssText = "font-weight:900; letter-spacing:.08em; font-size:14px; color:#8ef3c5; margin-bottom:10px;";

    const title = el("div",{ textContent:"Loading…" });
    title.id = "rs-aiou-loader-title";
    title.style.cssText = "font-weight:900; font-size:22px; margin-bottom:8px; text-transform:uppercase;";

    const msg = el("div",{ textContent:"Checking login + loading the hosted quiz file." });
    msg.id = "rs-aiou-loader-msg";
    msg.style.cssText = "color:#a8b0d6; font-size:13px; line-height:1.5; margin-bottom:14px;";

    const actions = el("div");
    actions.style.cssText = "display:flex; gap:10px; flex-wrap:wrap;";

    const btnReload = el("button",{ textContent:"Reload" });
    btnReload.style.cssText = "padding:10px 14px; border-radius:12px; border:1px solid rgba(255,255,255,.14); background:#0f1324; color:#e9ecff; font-weight:800; cursor:pointer;";
    btnReload.onclick = ()=>location.reload();

    const btnCreate = el("a",{ textContent:"Create Account", href:"/create-account" });
    btnCreate.style.cssText = "padding:10px 14px; border-radius:12px; border:1px solid rgba(255,255,255,.14); background:#0f1324; color:#e9ecff; font-weight:800; text-decoration:none; display:inline-flex; align-items:center;";

    actions.appendChild(btnReload);
    actions.appendChild(btnCreate);

    card.appendChild(h);
    card.appendChild(title);
    card.appendChild(msg);
    card.appendChild(actions);
    root.appendChild(card);
    document.body.appendChild(root);

    return root;
  }

  function setState(title, message){
    const root = mountShell();
    const t = root.querySelector("#rs-aiou-loader-title");
    const m = root.querySelector("#rs-aiou-loader-msg");
    if (t) t.textContent = title;
    if (m) m.textContent = message;
  }

  function loadHostedQuiz(){
    setState("Loading quiz…", "Hosted JS is being downloaded now.");
    const s = el("script");
    s.src = CFG.hostQuizSrc;
    s.onload = ()=>{
      // If the big quiz loads, it will render its own full-screen UI.
      // We remove loader to avoid stacking.
      const root = document.getElementById("rs-aiou-loader-root");
      if (root) root.remove();
    };
    s.onerror = ()=>{
      setState(
        "Could not load AIOU file",
        "Your hosted JS returned 404/blocked. Open the quiz file URL directly to verify it exists: " + CFG.hostQuizSrc
      );
    };
    document.head.appendChild(s);
  }

  function waitForLoginThenLoad(){
    const email = readLoginEmail();
    if (email) return loadHostedQuiz();

    setState(
      "Sign in required",
      "This quiz is gated. Please sign in first. If you expected a login box and don’t see one, your login embed isn’t running on this page."
    );

    // Listen for your unlock event + poll as backup
    function tryNow(){
      const e = readLoginEmail();
      if (e) {
        window.removeEventListener("realtysass:unlocked", tryNow);
        loadHostedQuiz();
      }
    }
    window.addEventListener("realtysass:unlocked", tryNow);
    setInterval(tryNow, 250);
  }

  // boot
  mountShell();
  waitForLoginThenLoad();

})();
