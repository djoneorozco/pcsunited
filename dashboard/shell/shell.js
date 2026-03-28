(() => {
  "use strict";

  if (window.PCSU_2F_SHELL_BOOT && window.PCSU_2F_SHELL_BOOT.__mounted) return;
  window.PCSU_2F_SHELL_BOOT = { __mounted: true };

  function run2F() {
    try {
      if (
        window.PCSU_2F_STRATEGY_RENDERER &&
        typeof window.PCSU_2F_STRATEGY_RENDERER.renderStrategy === "function"
      ) {
        window.PCSU_2F_STRATEGY_RENDERER.renderStrategy();
        return true;
      }
    } catch (err) {
      console.error("PCSU shell 2F recall failed:", err);
    }
    return false;
  }

  function schedule2F() {
    run2F();
    setTimeout(run2F, 120);
    setTimeout(run2F, 450);
    setTimeout(run2F, 1000);
    setTimeout(run2F, 1800);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", schedule2F, { once: true });
  } else {
    schedule2F();
  }

  window.addEventListener("load", schedule2F);
  window.addEventListener("pcsunited:unlocked", schedule2F);
  window.addEventListener("pcsunited:bridge-ready", schedule2F);
  window.addEventListener("realtysass:bridge-ready", schedule2F);
  window.addEventListener("storage", schedule2F);
})();
