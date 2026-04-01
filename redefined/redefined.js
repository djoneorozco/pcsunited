/* =========================================================
RE-Defined • PCSUnited Standalone App
redefined.js
========================================================= */

(function(){
  "use strict";

  if (window.REDEFINED_STANDALONE_V1) return;
  window.REDEFINED_STANDALONE_V1 = true;

  function getApiBase(){
    const host = String(location.hostname || "").toLowerCase();
    if (host.endsWith(".webflow.io")) {
      return "https://pcsunited.netlify.app/api/stage";
    }
    return "/api/stage";
  }

  const API = getApiBase();
  const MAX_FILE_BYTES = 4 * 1024 * 1024;
  const ALLOWED_MIME = new Set(["image/jpeg", "image/jpg", "image/png", "image/webp"]);

  const $ = (id) => document.getElementById(id);

  const els = {
    file: $("rd-file"),
    feature: $("rd-feature"),
    room: $("rd-room"),
    yard: $("rd-yard"),
    color: $("rd-color"),
    generate: $("rd-generate"),
    reset: $("rd-reset"),
    status: $("rd-status"),
    roomWrap: $("rd-room-wrap"),
    yardWrap: $("rd-yard-wrap"),
    styleWrap: $("rd-style-wrap"),
    colorWrap: $("rd-color-wrap"),
    compare: $("rd-compare"),
    before: $("rd-img-before"),
    after: $("rd-img-after"),
    divider: $("rd-divider"),
    handle: $("rd-handle"),
    range: $("rd-range"),
    placeholder: $("rd-placeholder"),
    metaFeature: $("rd-meta-feature"),
    metaStyle: $("rd-meta-style"),
    metaRoom: $("rd-meta-room")
  };

  let currentStyle = "modern";

  function setStatus(message, kind){
    els.status.textContent = message || "";
    els.status.className = "rd-status" + (kind ? " " + kind : "");
  }

  function sanitizeHexColor(value){
    const raw = String(value || "").trim();
    if (!raw) return "";
    const withHash = raw.startsWith("#") ? raw : ("#" + raw);
    return /^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/.test(withHash) ? withHash.toUpperCase() : "";
  }

  function fileToDataURL(file){
    return new Promise((resolve, reject) => {
      if (!file) {
        reject(new Error("Please choose an image first."));
        return;
      }

      if (file.size > MAX_FILE_BYTES) {
        reject(new Error("File exceeds 4 MB."));
        return;
      }

      if (file.type && !ALLOWED_MIME.has(file.type)) {
        reject(new Error("Please upload a JPG, PNG, or WEBP image."));
        return;
      }

      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error("Unable to read file."));
      reader.readAsDataURL(file);
    });
  }

  function showPlaceholder(){
    els.placeholder.classList.remove("hidden");
  }

  function hidePlaceholder(){
    els.placeholder.classList.add("hidden");
  }

  function updateMeta(){
    const feature = els.feature.value || "staging";
    const roomOrYard = feature === "landscape"
      ? (els.yard.value || "Front Yard")
      : (els.room.value || "livingroom");

    els.metaFeature.textContent = "Feature • " + feature;
    els.metaStyle.textContent = "Style • " + currentStyle;
    els.metaRoom.textContent = (feature === "landscape" ? "Yard • " : "Room • ") + roomOrYard;
  }

  function updateUI(){
    const feature = els.feature.value;

    els.roomWrap.style.display = (feature === "staging" || feature === "paint") ? "block" : "none";
    els.yardWrap.style.display = feature === "landscape" ? "block" : "none";
    els.styleWrap.style.display = (feature === "staging" || feature === "landscape") ? "block" : "none";
    els.colorWrap.style.display = feature === "paint" ? "block" : "none";

    updateMeta();
  }

  function setBusy(on){
    els.generate.disabled = !!on;
    els.reset.disabled = !!on;
    els.generate.textContent = on ? "Generating…" : "Generate Enhancement";
  }

  function setPct(pct){
    const value = Math.max(0, Math.min(100, Number(pct) || 0));
    els.before.style.opacity = "1";
    els.after.style.opacity = "1";
    els.compare.querySelector(".rd-front").style.clipPath = `inset(0 ${100 - value}% 0 0)`;
    els.divider.style.left = `${value}%`;
    els.handle.style.left = `${value}%`;
    els.range.value = String(value);
  }

  function handleClientX(clientX){
    const rect = els.compare.getBoundingClientRect();
    const pct = ((clientX - rect.left) / rect.width) * 100;
    setPct(pct);
  }

  function startDrag(e){
    e.preventDefault();

    const move = (ev) => {
      const point = ev.touches ? ev.touches[0] : ev;
      handleClientX(point.clientX);
    };

    const stop = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", stop);
      window.removeEventListener("touchmove", move);
      window.removeEventListener("touchend", stop);
    };

    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", stop);
    window.addEventListener("touchmove", move, { passive:false });
    window.addEventListener("touchend", stop);
  }

  function resetAll(){
    els.file.value = "";
    els.feature.value = "staging";
    els.room.value = "livingroom";
    els.yard.value = "Front Yard";
    els.color.value = "#D6D6D6";
    currentStyle = "modern";

    document.querySelectorAll(".rd-style-tile").forEach((tile) => {
      tile.classList.toggle("active", tile.dataset.style === "modern");
    });

    els.before.removeAttribute("src");
    els.after.removeAttribute("src");
    showPlaceholder();
    setPct(50);
    setStatus("", "");
    updateUI();
  }

  async function buildPayload(){
    const file = els.file.files && els.file.files[0];
    if (!file) {
      throw new Error("Please choose an image first.");
    }

    const original = await fileToDataURL(file);

    els.before.src = original;
    hidePlaceholder();

    const payload = {
      feature: els.feature.value,
      input_image_url: original,
      source: "pcsunited-redefined"
    };

    if (payload.feature === "staging") {
      payload.room_type = els.room.value;
      payload.design_style = currentStyle;
    } else if (payload.feature === "landscape") {
      payload.yard_type = els.yard.value;
      payload.design_style = currentStyle;
    } else if (payload.feature === "paint") {
      const hex = sanitizeHexColor(els.color.value);
      if (!hex) {
        throw new Error("Please enter a valid HEX paint color.");
      }
      payload.paint_color_hex = hex;
      payload.room_type = els.room.value;
    }

    return payload;
  }

  function extractImageUrl(data){
    return (
      data?.image_url ||
      data?.images?.[0]?.url ||
      data?.info?.images?.[0]?.url ||
      data?.url ||
      ""
    );
  }

  document.querySelectorAll(".rd-style-tile").forEach((tile) => {
    tile.addEventListener("click", () => {
      document.querySelectorAll(".rd-style-tile").forEach((t) => t.classList.remove("active"));
      tile.classList.add("active");
      currentStyle = tile.dataset.style || "modern";
      updateMeta();
    });
  });

  els.feature.addEventListener("change", updateUI);
  els.room.addEventListener("change", updateMeta);
  els.yard.addEventListener("change", updateMeta);

  els.color.addEventListener("blur", () => {
    const clean = sanitizeHexColor(els.color.value);
    if (els.color.value.trim() && clean) {
      els.color.value = clean;
    }
  });

  els.compare.addEventListener("mousedown", startDrag);
  els.compare.addEventListener("touchstart", startDrag, { passive:false });
  els.range.addEventListener("input", () => setPct(els.range.value));

  els.reset.addEventListener("click", resetAll);

  els.file.addEventListener("change", async () => {
    setStatus("", "");
    try {
      const file = els.file.files && els.file.files[0];
      if (!file) {
        resetAll();
        return;
      }

      const original = await fileToDataURL(file);
      els.before.src = original;
      els.after.removeAttribute("src");
      hidePlaceholder();
      setPct(50);
      setStatus("Image loaded. Ready to generate.", "warn");
    } catch (err) {
      resetAll();
      setStatus(err.message || "Unable to load image.", "error");
    }
  });

  els.generate.addEventListener("click", async () => {
    setBusy(true);
    setStatus("Generating enhancement…", "warn");

    try {
      const payload = await buildPayload();
      updateMeta();

      const resp = await fetch(API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      const text = await resp.text();
      let data = {};
      try {
        data = text ? JSON.parse(text) : {};
      } catch {
        data = { raw:text };
      }

      if (!resp.ok || data?.ok === false) {
        throw new Error(data?.error || data?.message || ("Generation failed with HTTP " + resp.status));
      }

      const img = extractImageUrl(data);
      if (!img) {
        throw new Error("No image returned by the staging service.");
      }

      els.after.src = img;
      hidePlaceholder();
      setPct(50);

      const before = els.before.getAttribute("src") || "";
      if (before && img && before === img) {
        setStatus("Request succeeded, but the returned image matches the original.", "warn");
      } else {
        setStatus("Enhancement complete ✓", "ok");
      }
    } catch (err) {
      setStatus(err.message || "Generation failed.", "error");
    } finally {
      setBusy(false);
    }
  });

  resetAll();
})();
