/* ============================================================
   RS • AIOU Loader v1.0
   - Loads the heavy AIOU portal script ONLY after login exists
   - Triggers on:
     (1) localStorage[loginKey]
     (2) event "realtysass:unlocked"
   ============================================================ */
(function () {
  "use strict";

  if (window.__RS_AIOU_LOADER_MOUNTED__) return;
  window.__RS_AIOU_LOADER_MOUNTED__ = true;

  const cfg = window.RS_AIOU_LOADER_CONFIG || {};
  const hostQuizSrc = String(cfg.hostQuizSrc || "").trim();
  const loginKey = String(cfg.loginKey || "realtysass.loginEmail").trim();

  if (!hostQuizSrc) {
    console.warn("[AIOU Loader] Missing hostQuizSrc.");
    return;
  }

  function getLoginEmail() {
    try {
      return String(localStorage.getItem(loginKey) || "").trim();
    } catch (_) {
      return "";
    }
  }

  function alreadyLoaded() {
    return !!document.querySelector('script[data-aiou-portal="1"]');
  }

  function injectPortal() {
    if (alreadyLoaded()) return;

    const s = document.createElement("script");
    s.src = hostQuizSrc + (hostQuizSrc.includes("?") ? "&" : "?") + "v=" + Date.now();
    s.async = true;
    s.defer = true;
    s.dataset.aiouPortal = "1";

    s.onload = () => {
      console.log("[AIOU Loader] Portal loaded.");
      // If portal exposes a mount hook, call it; otherwise it self-mounts.
      try {
        if (window.RS_AIOU_PORTAL && typeof window.RS_AIOU_PORTAL.mount === "function") {
          window.RS_AIOU_PORTAL.mount();
        }
      } catch (_) {}
    };

    s.onerror = () => {
      console.error("[AIOU Loader] Failed to load portal script:", s.src);
    };

    document.head.appendChild(s);
  }

  function readyToMount() {
    return !!getLoginEmail();
  }

  function maybeMount() {
    if (readyToMount()) {
      injectPortal();
      return true;
    }
    return false;
  }

  // Try immediately
  if (maybeMount()) return;

  // Listen for your login overlay event
  function onUnlocked() {
    if (maybeMount()) cleanup();
  }
  window.addEventListener("realtysass:unlocked", onUnlocked);

  // Fallback poll (in case event fires before listener attaches)
  const poll = setInterval(() => {
    if (maybeMount()) cleanup();
  }, 250);

  function cleanup() {
    clearInterval(poll);
    window.removeEventListener("realtysass:unlocked", onUnlocked);
  }
})();
