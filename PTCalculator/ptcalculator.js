(() => {
  const root = document.getElementById("af-pt-shell");
  if (!root) return;

  //#1) ELEMENTS
  const els = {
    gender: root.querySelector("#gender"),
    ageGroup: root.querySelector("#ageGroup"),
    heightSlider: root.querySelector("#heightSlider"),
    heightValue: root.querySelector("#heightValue"),

    cardioEvent: root.querySelector("#cardioEvent"),
    strengthEvent: root.querySelector("#strengthEvent"),
    enduranceEvent: root.querySelector("#enduranceEvent"),

    waistSlider: root.querySelector("#waistSlider"),
    strengthSlider: root.querySelector("#strengthSlider"),
    coreSlider: root.querySelector("#coreSlider"),
    cardioSlider: root.querySelector("#cardioSlider"),

    waistValue: root.querySelector("#waistValue"),
    strengthValue: root.querySelector("#strengthValue"),
    coreValue: root.querySelector("#coreValue"),
    cardioValue: root.querySelector("#cardioValue"),

    strengthModeLabel: root.querySelector("#strengthModeLabel"),
    coreModeLabel: root.querySelector("#coreModeLabel"),
    cardioModeLabel: root.querySelector("#cardioModeLabel"),

    ratioValue: root.querySelector("#ratioValue"),
    bodyCompScoreText: root.querySelector("#bodyCompScoreText"),

    barBody: root.querySelector("#barBody"),
    barStrength: root.querySelector("#barStrength"),
    barCore: root.querySelector("#barCore"),
    barCardio: root.querySelector("#barCardio"),

    scoreRing: root.querySelector("#scoreRing"),
    scoreNumber: root.querySelector("#scoreNumber"),
    scoreLabel: root.querySelector("#scoreLabel"),
    nextAssessment: root.querySelector("#nextAssessment"),

    insightList: root.querySelector("#insightList"),

    waistMeta: root.querySelector("#waistMeta"),
    strengthMeta: root.querySelector("#strengthMeta"),
    coreMeta: root.querySelector("#coreMeta"),
    cardioMeta: root.querySelector("#cardioMeta"),

    strengthTicks: root.querySelector("#strengthTicks"),
    coreTicks: root.querySelector("#coreTicks"),
    cardioTicks: root.querySelector("#cardioTicks")
  };

  //#2) CONFIG
  const DEBUG = false;

  const POLICY = {
    satisfactoryMonths: 6,
    unsatMonths: 3
  };

  const ORDER = [
    "under25_male","under25_female",
    "25-29_male","25-29_female",
    "30-34_male","30-34_female",
    "35-39_male","35-39_female",
    "40-44_male","40-44_female",
    "45-49_male","45-49_female",
    "50-54_male","50-54_female",
    "55-59_male","55-59_female",
    "60plus_male","60plus_female"
  ];

  //#3) HELPERS
  function clamp(value, min, max){
    return Math.min(Math.max(value, min), max);
  }

  function toSeconds(mmss){
    if (typeof mmss === "number") return mmss;
    let s = String(mmss).trim().replace("*", "");
    if (s.startsWith(":")) s = "0" + s;
    const parts = s.split(":");
    return (Number(parts[0]) * 60) + Number(parts[1]);
  }

  function formatTime(seconds){
    const safe = Math.max(0, Math.round(Number(seconds) || 0));
    const mins = Math.floor(safe / 60);
    const secs = safe % 60;
    return `${mins}:${String(secs).padStart(2, "0")}`;
  }

  function formatInches(value){
    return `${Number(value).toFixed(1)} in`;
  }

  function setSliderFill(slider){
    if (!slider) return;
    const min = Number(slider.min);
    const max = Number(slider.max);
    const val = Number(slider.value);
    const pct = ((val - min) / (max - min || 1)) * 100;
    slider.style.setProperty("--fill", `${pct}%`);
  }

  function normalizeAgeKey(label){
    const raw = String(label).replace(/–/g, "-").trim().toLowerCase();
    if (raw.includes("under")) return "under25";
    if (raw.includes("60")) return "60plus";
    return raw;
  }

  function buildMap(arr){
    const out = {};
    ORDER.forEach((key, i) => {
      out[key] = arr[i];
    });
    return out;
  }

  function pairKey(){
    return `${normalizeAgeKey(els.ageGroup.value)}_${els.gender.value}`;
  }

  function setTickLabels(container, labels){
    if (!container) return;
    const spans = container.querySelectorAll("span");
    spans.forEach((span, i) => {
      span.textContent = labels[i] ?? "";
    });
  }

  function buildLinearNumberTicks(maxValue){
    const values = [
      0,
      Math.round(maxValue * 0.2),
      Math.round(maxValue * 0.4),
      Math.round(maxValue * 0.6),
      Math.round(maxValue * 0.8),
      Math.round(maxValue)
    ];
    return values.map(String);
  }

  function buildTimeTicks(minSec, maxSec){
    const steps = 6;
    const out = [];
    for (let i = 0; i < steps; i += 1){
      const ratio = i / (steps - 1);
      const value = Math.round(minSec + ((maxSec - minSec) * ratio));
      out.push(formatTime(value));
    }
    return out;
  }

  function buildHamrTicks(maxCount){
    const values = [
      0,
      Math.round(maxCount * 0.2),
      Math.round(maxCount * 0.4),
      Math.round(maxCount * 0.6),
      Math.round(maxCount * 0.8),
      Math.round(maxCount)
    ];
    return values.map(String);
  }

  function safeText(node, value){
    if (node) node.textContent = value;
  }

  function safeHtml(node, value){
    if (node) node.innerHTML = value;
  }

  function debugLog(...args){
    if (DEBUG) console.log("[AF-PT]", ...args);
  }

  //#4) OFFICIAL TABLES
  const TABLES = {
    push: {
      max: buildMap([67,50,63,47,60,44,56,42,52,39,49,36,45,34,42,31,38,28]),
      min: buildMap([30,15,28,14,26,12,23,11,21,10,19,8,17,7,14,5,12,3])
    },
    hrpu: {
      max: buildMap([52,42,50,40,48,38,46,36,44,34,42,32,40,30,38,28,36,26]),
      min: buildMap([27,17,25,15,23,13,21,11,19,9,17,7,15,5,13,3,11,1])
    },
    situp: {
      max: buildMap([60,58,58,56,56,54,54,52,52,50,50,48,48,46,46,44,44,42]),
      min: buildMap([33,29,31,25,29,20,27,18,25,16,23,10,21,9,19,7,17,6])
    },
    crunch: {
      max: buildMap([58,54,56,50,54,45,52,43,50,41,48,35,46,34,44,32,42,31]),
      min: buildMap([33,29,31,25,29,20,27,18,25,16,23,10,21,9,19,7,17,6])
    },
    plank: {
      max: buildMap([
        toSeconds("3:40"),toSeconds("3:35"),
        toSeconds("3:35"),toSeconds("3:30"),
        toSeconds("3:30"),toSeconds("3:25"),
        toSeconds("3:25"),toSeconds("3:20"),
        toSeconds("3:20"),toSeconds("3:15"),
        toSeconds("3:15"),toSeconds("3:10"),
        toSeconds("3:10"),toSeconds("3:05"),
        toSeconds("3:05"),toSeconds("3:00"),
        toSeconds("3:00"),toSeconds("2:55")
      ]),
      min: buildMap([
        toSeconds("1:35"),toSeconds("1:30"),
        toSeconds("1:30"),toSeconds("1:25"),
        toSeconds("1:25"),toSeconds("1:20"),
        toSeconds("1:20"),toSeconds("1:15"),
        toSeconds("1:15"),toSeconds("1:10"),
        toSeconds("1:10"),toSeconds("1:05"),
        toSeconds("1:05"),toSeconds("1:00"),
        toSeconds("1:00"),toSeconds("0:55"),
        toSeconds("0:55"),toSeconds("0:50")
      ])
    },
    run: [
      [50.0, ["13:25","15:30","13:35","15:55","13:42","16:10","13:56","16:12","14:05","16:45","14:30","16:55","15:09","17:10","15:28","17:43","16:58","18:20"]],
      [49.5, ["13:44","16:00","13:54","16:24","14:03","16:40","14:18","16:43","14:29","17:15","14:54","17:26","15:32","17:43","15:52","18:16","17:19","18:54"]],
      [49.0, ["14:03","16:29","14:13","16:54","14:24","17:11","14:40","17:14","14:53","17:46","15:18","17:57","15:55","18:16","16:17","18:49","17:40","19:28"]],
      [48.0, ["14:22","16:59","14:32","17:23","14:45","17:41","15:02","17:45","15:17","18:16","15:42","18:28","16:18","18:48","16:41","19:22","18:01","20:02"]],
      [47.0, ["14:41","17:29","14:51","17:52","15:06","18:11","15:24","18:16","15:41","18:46","16:05","18:59","16:41","19:21","17:06","19:54","18:22","20:36"]],
      [46.0, ["15:00","17:58","15:10","18:21","15:28","18:41","15:46","18:47","16:05","19:17","16:29","19:30","17:04","19:54","17:30","20:27","18:44","21:10"]],
      [45.0, ["15:19","18:28","15:29","18:51","15:49","19:12","16:08","19:17","16:29","19:47","16:53","20:01","17:27","20:27","17:54","21:00","19:05","21:44"]],
      [44.0, ["15:38","18:58","15:48","19:20","16:10","19:42","16:30","19:48","16:53","20:17","17:17","20:32","17:50","20:59","18:19","21:33","19:26","22:18"]],
      [43.0, ["15:57","19:27","16:07","19:49","16:31","20:12","16:52","20:19","17:17","20:48","17:41","21:03","18:13","21:32","18:43","22:06","19:47","22:52"]],
      [42.0, ["16:16","19:57","16:26","20:18","16:52","20:42","17:14","20:50","17:41","21:18","18:05","21:34","18:36","22:05","19:08","22:39","20:08","23:26"]],
      [41.0, ["16:35","20:27","16:45","20:48","17:13","21:13","17:36","21:21","18:05","21:49","18:29","22:05","19:00","22:38","19:32","23:12","20:29","24:00"]],
      [40.0, ["16:54","20:56","17:04","21:17","17:34","21:43","17:58","21:52","18:28","22:19","18:52","22:36","19:23","23:10","19:56","23:44","20:50","24:34"]],
      [39.0, ["17:13","21:26","17:23","21:46","17:55","22:13","18:20","22:23","18:52","22:49","19:16","23:07","19:46","23:43","20:21","24:17","21:11","25:08"]],
      [38.5, ["17:32","21:55","17:42","22:15","18:16","22:43","18:42","22:54","19:16","23:20","19:40","23:38","20:09","24:16","20:45","24:50","21:32","25:42"]],
      [38.0, ["17:51","22:25","18:01","22:45","18:37","23:14","19:04","23:25","19:40","23:50","20:04","24:09","20:32","24:49","21:10","25:23","21:53","26:16"]],
      [37.5, ["18:10","22:55","18:20","23:14","18:59","23:44","19:26","23:56","20:04","24:20","20:28","24:40","20:55","25:21","21:34","25:56","22:15","26:50"]],
      [37.0, ["18:29","23:24","18:39","23:43","19:20","24:14","19:48","24:26","20:28","24:51","20:52","25:11","21:18","25:54","21:58","26:29","22:27","27:24"]],
      [36.5, ["18:48","23:54","18:58","24:12","19:41","24:44","20:10","24:57","20:52","25:21","21:15","25:42","21:41","26:27","22:23","27:01","22:36","27:58"]],
      [36.0, ["19:07","24:24","19:17","24:42","20:02","25:15","20:32","25:28","21:16","25:51","21:39","26:13","22:04","27:00","22:47","27:34","23:18","28:32"]],
      [35.5, ["19:36","24:53","19:36","25:11","20:23","25:45","20:54","25:59","21:40","26:22","22:03","26:44","22:27","27:32","23:12","28:07","23:39","29:06"]],
      [35.0, ["19:45","25:23","19:55","25:40","20:44","26:15","21:16","26:30","22:04","26:52","22:27","27:15","22:50","28:05","23:36","28:40","24:00","29:40"]]
    ].map(([pts, vals]) => [pts, buildMap(vals.map(toSeconds))]),
    hamr: [
      [50.0, [87,68,85,65,84,63,82,63,81,59,77,58,71,57,69,53,65,50]],
      [49.5, [84,65,82,62,81,60,79,60,77,56,73,55,68,53,66,50,62,47]],
      [49.0, [81,61,79,58,78,57,75,56,73,53,70,52,65,50,63,47,59,44]],
      [48.0, [78,58,76,55,75,53,72,53,70,50,67,49,62,47,60,44,56,41]],
      [47.0, [75,55,74,52,72,51,69,50,67,47,64,46,60,44,57,42,54,38]],
      [46.0, [72,52,71,50,69,48,66,47,64,45,61,44,57,42,55,39,52,36]],
      [45.0, [70,49,69,47,66,45,64,45,61,42,58,41,55,39,52,37,49,34]],
      [44.0, [67,46,66,44,63,43,61,42,58,40,56,39,53,37,50,34,47,32]],
      [43.0, [65,44,64,42,61,40,59,40,56,38,53,37,50,35,48,32,45,29]],
      [42.0, [63,41,62,40,59,38,56,37,53,35,51,34,48,32,45,30,43,27]],
      [41.0, [60,39,59,38,56,36,54,35,51,33,49,32,46,30,43,28,41,26]],
      [40.0, [58,37,57,36,54,34,52,33,49,31,47,30,44,28,41,26,39,24]],
      [39.0, [56,35,55,34,52,32,50,31,47,30,45,29,42,26,40,25,38,22]],
      [38.5, [54,33,53,32,50,30,48,29,45,28,43,27,40,25,38,23,36,20]],
      [38.0, [52,31,52,30,48,28,46,28,43,26,41,25,39,23,36,21,34,19]],
      [37.5, [51,29,50,28,46,26,44,26,41,24,39,23,37,21,34,20,33,18]],
      [37.0, [49,28,48,26,44,25,42,24,39,23,37,22,35,20,33,18,31,17]],
      [36.5, [47,26,46,25,43,23,40,23,37,21,36,20,34,18,31,17,30,14]],
      [36.0, [46,24,45,23,41,22,39,21,36,20,34,19,32,17,30,15,28,13]],
      [35.5, [44,23,43,22,39,20,37,20,34,19,32,18,31,16,28,14,27,12]],
      [35.0, [42,21,42,20,38,19,36,18,32,17,31,16,30,14,27,13,26,11]]
    ].map(([pts, vals]) => [pts, buildMap(vals)])
  };

  //#5) PUBLIC-CALCULATOR GUARDRAILS
  function disableWalkOptionForPublicCalculator(){
    if (!els.cardioEvent) return;
    [...els.cardioEvent.options].forEach((opt) => {
      if (/2\s*km\s*walk/i.test(opt.textContent || "")) {
        opt.disabled = true;
        opt.hidden = true;
        if (opt.selected) {
          els.cardioEvent.value = "2.0 Mile Run";
        }
      }
    });
  }

  //#6) RULE HELPERS
  function scoreCategory(total, minimumsMet){
    if (!minimumsMet) return "Unsatisfactory";
    if (total >= 90) return "Excellent";
    if (total >= 75) return "Satisfactory";
    return "Unsatisfactory";
  }

  function nextAssessmentText(total, minimumsMet){
    return (minimumsMet && total >= 75)
      ? `Next assessment<br>in ${POLICY.satisfactoryMonths} months`
      : `Next assessment<br>in ${POLICY.unsatMonths} months`;
  }

  function getWHtRScore(ratio){
    if (ratio <= 0.49) return 20.0;
    if (ratio <= 0.50) return 19.0;
    if (ratio <= 0.51) return 18.0;
    if (ratio <= 0.52) return 17.0;
    if (ratio <= 0.53) return 16.0;
    if (ratio <= 0.54) return 15.0;
    if (ratio <= 0.55) return 12.5;
    if (ratio <= 0.56) return 10.0;
    if (ratio <= 0.57) return 7.5;
    if (ratio <= 0.58) return 5.0;
    if (ratio <= 0.59) return 2.5;
    return 0.0;
  }

  // Exact for current chart structure:
  // - reps: each row changes by 1 rep = 0.5 points
  // - plank: each row changes by 5 sec = 0.5 points
  function scoreRepLinear(reps, topRep, minRep){
    if (reps >= topRep) return 15.0;
    if (reps < minRep) return 0.0;
    const stepsDown = topRep - reps;
    return clamp(15.0 - (stepsDown * 0.5), 2.5, 15.0);
  }

  function scoreTimeLongerBetter(sec, topSec, minSec){
    if (sec >= topSec) return 15.0;
    if (sec < minSec) return 0.0;
    const stepsDown = Math.floor((topSec - sec) / 5);
    return clamp(15.0 - (stepsDown * 0.5), 2.5, 15.0);
  }

  function scoreTimeLowerBetter(sec, rows, key){
    for (const [pts, map] of rows){
      if (sec <= map[key]) return pts;
    }
    return 0.0;
  }

  function scoreCountHigherBetter(count, rows, key){
    for (const [pts, map] of rows){
      if (count >= map[key]) return pts;
    }
    return 0.0;
  }

  function componentMinimumsMet(scores){
    return (
      scores.strengthPassed &&
      scores.corePassed &&
      scores.cardioPassed
    );
  }

  function getCurrentStrengthBounds(){
    const key = pairKey();

    if (els.strengthEvent.value.includes("Hand-Release")){
      return {
        mode: "hrpu",
        min: 0,
        max: TABLES.hrpu.max[key],
        top: TABLES.hrpu.max[key],
        passMin: TABLES.hrpu.min[key]
      };
    }

    return {
      mode: "push",
      min: 0,
      max: TABLES.push.max[key],
      top: TABLES.push.max[key],
      passMin: TABLES.push.min[key]
    };
  }

  function getCurrentCoreBounds(){
    const key = pairKey();

    if (els.enduranceEvent.value.includes("Cross-Legged")){
      return {
        mode: "crunch",
        type: "reps",
        min: 0,
        max: TABLES.crunch.max[key],
        top: TABLES.crunch.max[key],
        passMin: TABLES.crunch.min[key]
      };
    }

    if (els.enduranceEvent.value.includes("Plank")){
      return {
        mode: "plank",
        type: "time",
        min: 0,
        max: TABLES.plank.max[key],
        top: TABLES.plank.max[key],
        passMin: TABLES.plank.min[key]
      };
    }

    return {
      mode: "situp",
      type: "reps",
      min: 0,
      max: TABLES.situp.max[key],
      top: TABLES.situp.max[key],
      passMin: TABLES.situp.min[key]
    };
  }

  function getCurrentCardioBounds(){
    const key = pairKey();

    if (els.cardioEvent.value.includes("HAMR")){
      const top = TABLES.hamr[0][1][key];
      const passMin = TABLES.hamr[TABLES.hamr.length - 1][1][key];
      return {
        mode: "hamr",
        type: "hamr",
        min: 0,
        max: top,
        top,
        passMin
      };
    }

    const top = TABLES.run[0][1][key];
    const passMin = TABLES.run[TABLES.run.length - 1][1][key];
    return {
      mode: "run",
      type: "run",
      min: top,
      max: passMin,
      top,
      passMin
    };
  }

  function validateSelectionState(){
    const warnings = [];
    const key = pairKey();

    if (!ORDER.includes(key)){
      warnings.push("Selected age/gender pair is not supported.");
    }

    const strengthBounds = getCurrentStrengthBounds();
    if (!Number.isFinite(strengthBounds.top) || !Number.isFinite(strengthBounds.passMin)){
      warnings.push("Missing strength standard for selected demographic.");
    }

    const coreBounds = getCurrentCoreBounds();
    if (!Number.isFinite(coreBounds.top) || !Number.isFinite(coreBounds.passMin)){
      warnings.push("Missing core standard for selected demographic.");
    }

    const cardioBounds = getCurrentCardioBounds();
    if (!Number.isFinite(cardioBounds.top) || !Number.isFinite(cardioBounds.passMin)){
      warnings.push("Missing cardio standard for selected demographic.");
    }

    return warnings;
  }

  //#7) UI RANGE / TICKS
  function updateRangeMeta(){
    const height = Number(els.heightSlider.value);

    const waistBest = 0.49 * height;
    const waistMinPass = 0.59 * height;
    safeText(els.waistMeta, `Best: ≤ ${formatInches(waistBest)} • Minimum Passing: ≤ ${formatInches(waistMinPass)}`);

    const strengthBounds = getCurrentStrengthBounds();
    safeText(els.strengthMeta, `Best: ${strengthBounds.top} reps • Minimum Passing: ${strengthBounds.passMin} reps`);

    const coreBounds = getCurrentCoreBounds();
    if (coreBounds.type === "time") {
      safeText(els.coreMeta, `Best: ${formatTime(coreBounds.top)} • Minimum Passing: ${formatTime(coreBounds.passMin)}`);
    } else {
      safeText(els.coreMeta, `Best: ${coreBounds.top} reps • Minimum Passing: ${coreBounds.passMin} reps`);
    }

    const cardioBounds = getCurrentCardioBounds();
    if (cardioBounds.type === "hamr") {
      safeText(els.cardioMeta, `Best: ${cardioBounds.top} shuttles • Minimum Passing: ${cardioBounds.passMin} shuttles`);
    } else {
      safeText(els.cardioMeta, `Best: ${formatTime(cardioBounds.top)} • Minimum Passing: ${formatTime(cardioBounds.passMin)}`);
    }
  }

  function updateTickRows(){
    const strengthBounds = getCurrentStrengthBounds();
    setTickLabels(els.strengthTicks, buildLinearNumberTicks(strengthBounds.top));

    const coreBounds = getCurrentCoreBounds();
    if (coreBounds.type === "time"){
      setTickLabels(els.coreTicks, buildTimeTicks(coreBounds.min, coreBounds.top));
    } else {
      setTickLabels(els.coreTicks, buildLinearNumberTicks(coreBounds.top));
    }

    const cardioBounds = getCurrentCardioBounds();
    if (cardioBounds.type === "hamr"){
      setTickLabels(els.cardioTicks, buildHamrTicks(cardioBounds.top));
    } else {
      setTickLabels(els.cardioTicks, buildTimeTicks(cardioBounds.min, cardioBounds.max));
    }
  }

  function normalizeCurrentValues(){
    const strengthBounds = getCurrentStrengthBounds();
    const coreBounds = getCurrentCoreBounds();
    const cardioBounds = getCurrentCardioBounds();

    els.strengthSlider.value = String(clamp(Number(els.strengthSlider.value), strengthBounds.min, strengthBounds.max));
    els.coreSlider.value = String(clamp(Number(els.coreSlider.value), coreBounds.min, coreBounds.max));
    els.cardioSlider.value = String(clamp(Number(els.cardioSlider.value), cardioBounds.min, cardioBounds.max));
  }

  function updateEventRanges(){
    const strengthBounds = getCurrentStrengthBounds();
    els.strengthSlider.min = strengthBounds.min;
    els.strengthSlider.max = strengthBounds.max;
    els.strengthSlider.step = 1;

    const coreBounds = getCurrentCoreBounds();
    els.coreSlider.min = coreBounds.min;
    els.coreSlider.max = coreBounds.max;
    els.coreSlider.step = coreBounds.type === "time" ? 5 : 1;

    const cardioBounds = getCurrentCardioBounds();
    els.cardioSlider.min = cardioBounds.min;
    els.cardioSlider.max = cardioBounds.max;
    els.cardioSlider.step = 1;

    normalizeCurrentValues();
    updateTickRows();
  }

  //#8) SCORING ENGINE
  function computeScores(){
    const warnings = validateSelectionState();
    const key = pairKey();

    const height = Number(els.heightSlider.value);
    const waist = Number(els.waistSlider.value);
    const strength = Number(els.strengthSlider.value);
    const core = Number(els.coreSlider.value);
    const cardio = Number(els.cardioSlider.value);

    const ratio = waist / height;
    const bodyScore = getWHtRScore(ratio);

    const strengthBounds = getCurrentStrengthBounds();
    const coreBounds = getCurrentCoreBounds();
    const cardioBounds = getCurrentCardioBounds();

    let strengthScore = 0.0;
    if (strengthBounds.mode === "hrpu"){
      strengthScore = scoreRepLinear(strength, TABLES.hrpu.max[key], TABLES.hrpu.min[key]);
    } else {
      strengthScore = scoreRepLinear(strength, TABLES.push.max[key], TABLES.push.min[key]);
    }

    let coreScore = 0.0;
    if (coreBounds.mode === "crunch"){
      coreScore = scoreRepLinear(core, TABLES.crunch.max[key], TABLES.crunch.min[key]);
    } else if (coreBounds.mode === "plank"){
      coreScore = scoreTimeLongerBetter(core, TABLES.plank.max[key], TABLES.plank.min[key]);
    } else {
      coreScore = scoreRepLinear(core, TABLES.situp.max[key], TABLES.situp.min[key]);
    }

    let cardioScore = 0.0;
    let cardioMode = "run";

    if (cardioBounds.mode === "hamr"){
      cardioMode = "hamr";
      cardioScore = scoreCountHigherBetter(cardio, TABLES.hamr, key);
    } else {
      cardioMode = "run";
      cardioScore = scoreTimeLowerBetter(cardio, TABLES.run, key);
    }

    const strengthPassed = strengthScore >= 2.5;
    const corePassed = coreScore >= 2.5;
    const cardioPassed = cardioScore >= 35.0;

    const minimumsMet = componentMinimumsMet({
      strengthPassed,
      corePassed,
      cardioPassed
    });

    const total = clamp(bodyScore + strengthScore + coreScore + cardioScore, 0, 100);
    const category = scoreCategory(total, minimumsMet);

    const result = {
      ratio,
      bodyScore,
      strengthScore,
      coreScore,
      cardioScore,
      total,
      category,
      minimumsMet,
      cardioMode,
      strengthPassed,
      corePassed,
      cardioPassed,
      warnings,
      breakdown: {
        body: bodyScore,
        strength: strengthScore,
        core: coreScore,
        cardio: cardioScore
      }
    };

    debugLog("computeScores", result);
    return result;
  }

  //#9) INSIGHTS
  function buildInsights(scores){
    if (scores.warnings.length){
      return {
        line1: scores.warnings[0],
        line2: scores.warnings[1] || "Review selected standards and supported event configuration.",
        line3: "Calculator output may be incomplete until all official values are available."
      };
    }

    const lines = [];
    if (!scores.minimumsMet){
      lines.push("One or more components are below the current minimum passing standard.");
    } else if (scores.total >= 90){
      lines.push("This combination projects an excellent official result.");
    } else if (scores.total >= 75){
      lines.push("This combination projects a satisfactory official result.");
    } else {
      lines.push("The current combination projects an unsatisfactory result.");
    }

    if (scores.bodyScore >= 15){
      lines.push("Body composition remains within a solid scoring range.");
    } else if (scores.bodyScore >= 10){
      lines.push("Body composition is moderate, with additional points still available.");
    } else {
      lines.push("Body composition is one of the largest scoring opportunities right now.");
    }

    const weakest = Math.min(scores.strengthScore, scores.coreScore, scores.cardioScore);
    if (weakest === scores.cardioScore){
      lines.push("Cardio is the clearest lever for raising the composite score fastest.");
    } else if (weakest === scores.coreScore){
      lines.push("Improving core performance would be one of the fastest ways to raise the total.");
    } else {
      lines.push("Improving strength output would be one of the fastest ways to raise the total.");
    }

    return {
      line1: lines[0],
      line2: lines[1],
      line3: lines[2]
    };
  }

  //#10) UI RENDER
  function updateUI(){
    setSliderFill(els.heightSlider);
    setSliderFill(els.waistSlider);
    setSliderFill(els.strengthSlider);
    setSliderFill(els.coreSlider);
    setSliderFill(els.cardioSlider);

    safeText(els.heightValue, `${els.heightSlider.value} in`);
    safeText(els.waistValue, `${els.waistSlider.value} in`);

    safeText(els.strengthModeLabel, els.strengthEvent.value);
    safeText(els.coreModeLabel, els.enduranceEvent.value);
    safeText(els.cardioModeLabel, els.cardioEvent.value);

    safeText(els.strengthValue, `${els.strengthSlider.value} reps`);

    if (els.enduranceEvent.value.includes("Plank")){
      safeText(els.coreValue, formatTime(Number(els.coreSlider.value)));
    } else {
      safeText(els.coreValue, `${els.coreSlider.value} reps`);
    }

    const scores = computeScores();

    if (scores.cardioMode === "hamr"){
      safeText(els.cardioValue, `${els.cardioSlider.value} shuttles`);
    } else {
      safeText(els.cardioValue, formatTime(Number(els.cardioSlider.value)));
    }

    safeText(els.ratioValue, scores.ratio.toFixed(2));
    safeText(els.bodyCompScoreText, `${scores.bodyScore.toFixed(1)} / 20`);

    if (els.scoreRing) els.scoreRing.style.setProperty("--pct", scores.total.toFixed(1));
    safeText(els.scoreNumber, scores.total.toFixed(1));
    safeText(els.scoreLabel, scores.category);
    safeHtml(els.nextAssessment, nextAssessmentText(scores.total, scores.minimumsMet));

    if (els.barBody) els.barBody.style.height = `${(scores.breakdown.body / 20) * 100}%`;
    if (els.barStrength) els.barStrength.style.height = `${(scores.breakdown.strength / 15) * 100}%`;
    if (els.barCore) els.barCore.style.height = `${(scores.breakdown.core / 15) * 100}%`;
    if (els.barCardio) els.barCardio.style.height = `${(scores.breakdown.cardio / 50) * 100}%`;

    updateRangeMeta();

    const insights = buildInsights(scores);
    safeHtml(els.insightList, `
      <li><span class="dot mint"></span><span>${insights.line1}</span></li>
      <li><span class="dot peach"></span><span>${insights.line2}</span></li>
      <li><span class="dot lav"></span><span>${insights.line3}</span></li>
    `);
  }

  //#11) EVENTS
  [
    els.gender,
    els.heightSlider,
    els.ageGroup,
    els.cardioEvent,
    els.strengthEvent,
    els.enduranceEvent,
    els.waistSlider,
    els.strengthSlider,
    els.coreSlider,
    els.cardioSlider
  ].forEach((el) => {
    if (!el) return;

    el.addEventListener("input", () => {
      if (
        el === els.gender ||
        el === els.ageGroup ||
        el === els.cardioEvent ||
        el === els.strengthEvent ||
        el === els.enduranceEvent
      ){
        updateEventRanges();
      }
      updateUI();
    });

    el.addEventListener("change", () => {
      if (
        el === els.gender ||
        el === els.ageGroup ||
        el === els.cardioEvent ||
        el === els.strengthEvent ||
        el === els.enduranceEvent
      ){
        updateEventRanges();
      }
      updateUI();
    });
  });

  //#12) INIT
  disableWalkOptionForPublicCalculator();
  updateEventRanges();
  updateUI();
})();
