(() => {
  const root = document.getElementById("af-pt-shell");
  if (!root) return;

  const gender = root.querySelector("#gender");
  const heightSlider = root.querySelector("#heightSlider");
  const heightValue = root.querySelector("#heightValue");

  const ageGroup = root.querySelector("#ageGroup");
  const cardioEvent = root.querySelector("#cardioEvent");
  const strengthEvent = root.querySelector("#strengthEvent");
  const enduranceEvent = root.querySelector("#enduranceEvent");

  const waistSlider = root.querySelector("#waistSlider");
  const strengthSlider = root.querySelector("#strengthSlider");
  const coreSlider = root.querySelector("#coreSlider");
  const cardioSlider = root.querySelector("#cardioSlider");

  const waistValue = root.querySelector("#waistValue");
  const strengthValue = root.querySelector("#strengthValue");
  const coreValue = root.querySelector("#coreValue");
  const cardioValue = root.querySelector("#cardioValue");

  const strengthModeLabel = root.querySelector("#strengthModeLabel");
  const coreModeLabel = root.querySelector("#coreModeLabel");
  const cardioModeLabel = root.querySelector("#cardioModeLabel");

  const ratioValue = root.querySelector("#ratioValue");
  const bodyCompScoreText = root.querySelector("#bodyCompScoreText");

  const barBody = root.querySelector("#barBody");
  const barStrength = root.querySelector("#barStrength");
  const barCore = root.querySelector("#barCore");
  const barCardio = root.querySelector("#barCardio");

  const scoreRing = root.querySelector("#scoreRing");
  const scoreNumber = root.querySelector("#scoreNumber");
  const scoreLabel = root.querySelector("#scoreLabel");
  const nextAssessment = root.querySelector("#nextAssessment");

  const insightList = root.querySelector("#insightList");

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
    const mins = Math.floor(seconds / 60);
    const secs = Math.round(seconds % 60);
    return `${mins}:${String(secs).padStart(2, "0")}`;
  }

  function setSliderFill(slider){
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
    return `${normalizeAgeKey(ageGroup.value)}_${gender.value}`;
  }

  function walkAgeBucket(label){
    const raw = normalizeAgeKey(label);
    if (raw === "under25" || raw === "25-29") return "<30";
    if (raw === "30-34" || raw === "35-39") return "30-39";
    if (raw === "40-44" || raw === "45-49") return "40-49";
    if (raw === "50-54" || raw === "55-59") return "50-59";
    return "60+";
  }

  function scoreCategory(total, minimumsMet){
    if (!minimumsMet) return "Unsatisfactory";
    if (total >= 90) return "Excellent";
    if (total >= 75) return "Satisfactory";
    return "Unsatisfactory";
  }

  function nextAssessmentText(total, minimumsMet){
    return (minimumsMet && total >= 75)
      ? "Next assessment<br>in 6 months"
      : "Next assessment<br>in 3 months";
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

  // Official chart values
  const PUSH_MAX = buildMap([67,50,63,47,60,44,56,42,52,39,49,36,45,34,42,31,38,28]);
  const PUSH_MIN = buildMap([30,15,28,14,26,12,23,11,21,10,19,8,17,7,14,5,12,3]);

  const HRPU_MAX = buildMap([52,42,50,40,48,38,46,36,44,34,42,32,40,30,38,28,36,26]);
  const HRPU_MIN = buildMap([27,17,25,15,23,13,21,11,19,9,17,7,15,5,13,3,11,1]);

  const SITUP_MAX = buildMap([58,54,56,50,54,45,52,43,50,41,48,35,46,34,44,32,42,31]);
  const SITUP_MIN = buildMap([33,29,31,25,29,20,27,18,25,16,23,10,21,9,19,7,17,6]);

  const CRUNCH_MAX = buildMap([60,58,58,56,56,54,54,52,52,50,50,48,48,46,46,44,44,42]);
  const CRUNCH_MIN = buildMap([35,33,33,31,31,29,29,27,27,25,25,23,23,21,21,19,19,17]);

  const PLANK_MAX = buildMap([
    toSeconds("3:40"),toSeconds("3:35"),
    toSeconds("3:35"),toSeconds("3:30"),
    toSeconds("3:30"),toSeconds("3:25"),
    toSeconds("3:25"),toSeconds("3:20"),
    toSeconds("3:20"),toSeconds("3:15"),
    toSeconds("3:15"),toSeconds("3:10"),
    toSeconds("3:10"),toSeconds("3:05"),
    toSeconds("3:05"),toSeconds("3:00"),
    toSeconds("3:00"),toSeconds("2:55")
  ]);

  const PLANK_MIN = buildMap([
    toSeconds("1:35"),toSeconds("1:30"),
    toSeconds("1:30"),toSeconds("1:25"),
    toSeconds("1:25"),toSeconds("1:20"),
    toSeconds("1:20"),toSeconds("1:15"),
    toSeconds("1:15"),toSeconds("1:10"),
    toSeconds("1:10"),toSeconds("1:05"),
    toSeconds("1:05"),toSeconds("1:00"),
    toSeconds("1:00"),toSeconds(":55"),
    toSeconds(":55"),toSeconds(":50")
  ]);

  const RUN_ROWS = [
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
  ].map(([pts, vals]) => [pts, buildMap(vals.map(toSeconds))]);

  const HAMR_ROWS = [
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
  ].map(([pts, vals]) => [pts, buildMap(vals)]);

  const WALK_MAX = {
    male: {
      "<30": toSeconds("16:16"),
      "30-39": toSeconds("16:18"),
      "40-49": toSeconds("16:23"),
      "50-59": toSeconds("16:40"),
      "60+": toSeconds("16:58")
    },
    female: {
      "<30": toSeconds("17:22"),
      "30-39": toSeconds("17:28"),
      "40-49": toSeconds("17:49"),
      "50-59": toSeconds("18:11"),
      "60+": toSeconds("18:53")
    }
  };

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

  function componentMinimumsMet(scores, cardioMode){
    if (cardioMode === "walk") {
      return (
        scores.strengthScore >= 2.5 &&
        scores.coreScore >= 2.5 &&
        scores.walkPassed === true
      );
    }

    return (
      scores.strengthScore >= 2.5 &&
      scores.coreScore >= 2.5 &&
      scores.cardioScore >= 35.0
    );
  }

  function getCurrentStrengthBounds(){
    const key = pairKey();
    if (strengthEvent.value.includes("Hand-Release")){
      return { min: 0, max: HRPU_MAX[key], top: HRPU_MAX[key], passMin: HRPU_MIN[key] };
    }
    return { min: 0, max: PUSH_MAX[key], top: PUSH_MAX[key], passMin: PUSH_MIN[key] };
  }

  function getCurrentCoreBounds(){
    const key = pairKey();
    if (enduranceEvent.value.includes("Cross-Legged")){
      return { type: "reps", min: 0, max: CRUNCH_MAX[key], top: CRUNCH_MAX[key], passMin: CRUNCH_MIN[key] };
    }
    if (enduranceEvent.value.includes("Plank")){
      return { type: "time", min: 0, max: PLANK_MAX[key], top: PLANK_MAX[key], passMin: PLANK_MIN[key] };
    }
    return { type: "reps", min: 0, max: SITUP_MAX[key], top: SITUP_MAX[key], passMin: SITUP_MIN[key] };
  }

  function getCurrentWalkMax(){
    return WALK_MAX[gender.value][walkAgeBucket(ageGroup.value)];
  }

  function getCurrentCardioBounds(){
    const key = pairKey();

    if (cardioEvent.value.includes("HAMR")){
      const top = HAMR_ROWS[0][1][key];
      const passMin = HAMR_ROWS[HAMR_ROWS.length - 1][1][key];
      return { type: "hamr", min: 0, max: Math.max(100, top), top, passMin };
    }

    if (cardioEvent.value.includes("Walk")){
      const passMax = getCurrentWalkMax();
      return {
        type: "walk",
        min: 720,
        max: Math.max(1260, passMax + 180),
        top: 720,
        passMin: passMax
      };
    }

    const top = RUN_ROWS[0][1][key];
    const passMin = RUN_ROWS[RUN_ROWS.length - 1][1][key];
    return { type: "run", min: top, max: passMin, top, passMin };
  }

  function updateEventRanges(){
    const strengthBounds = getCurrentStrengthBounds();
    strengthSlider.min = strengthBounds.min;
    strengthSlider.max = strengthBounds.max;
    strengthSlider.step = 1;
    if (Number(strengthSlider.value) > strengthBounds.max) strengthSlider.value = strengthBounds.max;

    const coreBounds = getCurrentCoreBounds();
    coreSlider.min = coreBounds.min;
    coreSlider.max = coreBounds.max;
    coreSlider.step = coreBounds.type === "time" ? 5 : 1;
    if (Number(coreSlider.value) > coreBounds.max) coreSlider.value = coreBounds.max;

    const cardioBounds = getCurrentCardioBounds();
    cardioSlider.min = cardioBounds.min;
    cardioSlider.max = cardioBounds.max;
    cardioSlider.step = cardioBounds.type === "hamr" ? 1 : 1;

    if (Number(cardioSlider.value) < cardioBounds.min) cardioSlider.value = cardioBounds.min;
    if (Number(cardioSlider.value) > cardioBounds.max) cardioSlider.value = cardioBounds.max;
  }

  function computeScores(){
    const key = pairKey();

    const height = Number(heightSlider.value);
    const waist = Number(waistSlider.value);
    const strength = Number(strengthSlider.value);
    const core = Number(coreSlider.value);
    const cardio = Number(cardioSlider.value);

    const ratio = waist / height;
    const bodyScore = getWHtRScore(ratio);

    let strengthScore = 0.0;
    if (strengthEvent.value.includes("Hand-Release")){
      strengthScore = scoreRepLinear(strength, HRPU_MAX[key], HRPU_MIN[key]);
    } else {
      strengthScore = scoreRepLinear(strength, PUSH_MAX[key], PUSH_MIN[key]);
    }

    let coreScore = 0.0;
    if (enduranceEvent.value.includes("Cross-Legged")){
      coreScore = scoreRepLinear(core, CRUNCH_MAX[key], CRUNCH_MIN[key]);
    } else if (enduranceEvent.value.includes("Plank")){
      coreScore = scoreTimeLongerBetter(core, PLANK_MAX[key], PLANK_MIN[key]);
    } else {
      coreScore = scoreRepLinear(core, SITUP_MAX[key], SITUP_MIN[key]);
    }

    let cardioScore = 0.0;
    let cardioMode = "run";
    let walkPassed = null;
    let walkMax = null;

    if (cardioEvent.value.includes("HAMR")){
      cardioMode = "hamr";
      cardioScore = scoreCountHigherBetter(cardio, HAMR_ROWS, key);
    } else if (cardioEvent.value.includes("Walk")){
      cardioMode = "walk";
      walkMax = getCurrentWalkMax();
      walkPassed = cardio <= walkMax;
      cardioScore = walkPassed ? 50.0 : 0.0;
    } else {
      cardioMode = "run";
      cardioScore = scoreTimeLowerBetter(cardio, RUN_ROWS, key);
    }

    const total = clamp(bodyScore + strengthScore + coreScore + cardioScore, 0, 100);
    const minimumsMet = componentMinimumsMet(
      { strengthScore, coreScore, cardioScore, walkPassed },
      cardioMode
    );
    const category = cardioMode === "walk"
      ? (minimumsMet ? "Pass" : "Fail")
      : scoreCategory(total, minimumsMet);

    return {
      ratio,
      bodyScore,
      strengthScore,
      coreScore,
      cardioScore,
      total,
      category,
      minimumsMet,
      cardioMode,
      walkPassed,
      walkMax
    };
  }

  function buildInsights(scores){
    if (scores.cardioMode === "walk"){
      return {
        line1: scores.walkPassed
          ? "The 2.0 km walk time is within the official maximum standard."
          : "The 2.0 km walk time is outside the official maximum standard.",
        line2: "Walk is an alternate cardio path with age- and gender-based maximum times.",
        line3: scores.minimumsMet
          ? "Strength, core, and walk standards currently support a passing alternate assessment."
          : "One or more standards are below the current alternate assessment requirement."
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

  function updateUI(){
    setSliderFill(heightSlider);
    setSliderFill(waistSlider);
    setSliderFill(strengthSlider);
    setSliderFill(coreSlider);
    setSliderFill(cardioSlider);

    heightValue.textContent = `${heightSlider.value} in`;
    waistValue.textContent = `${waistSlider.value} in`;

    strengthModeLabel.textContent = strengthEvent.value;
    coreModeLabel.textContent = enduranceEvent.value;
    cardioModeLabel.textContent = cardioEvent.value;

    strengthValue.textContent = `${strengthSlider.value} reps`;

    if (enduranceEvent.value.includes("Plank")){
      coreValue.textContent = formatTime(Number(coreSlider.value));
    } else {
      coreValue.textContent = `${coreSlider.value} reps`;
    }

    const scores = computeScores();

    if (scores.cardioMode === "hamr"){
      cardioValue.textContent = `${cardioSlider.value} shuttles`;
    } else {
      cardioValue.textContent = formatTime(Number(cardioSlider.value));
    }

    ratioValue.textContent = scores.ratio.toFixed(2);
    bodyCompScoreText.textContent = `${scores.bodyScore.toFixed(1)} / 20`;

    if (scores.cardioMode === "walk"){
      scoreRing.style.setProperty("--pct", scores.walkPassed ? "100" : "0");
      scoreNumber.textContent = scores.walkPassed ? "PASS" : "FAIL";
      scoreLabel.textContent = "2.0 km Walk";
      nextAssessment.innerHTML = scores.walkMax
        ? `Official max time<br>${formatTime(scores.walkMax)}`
        : "Alternate cardio<br>standard";
    } else {
      scoreRing.style.setProperty("--pct", scores.total.toFixed(1));
      scoreNumber.textContent = scores.total.toFixed(1);
      scoreLabel.textContent = scores.category;
      nextAssessment.innerHTML = nextAssessmentText(scores.total, scores.minimumsMet);
    }

    barBody.style.height = `${(scores.bodyScore / 20) * 100}%`;
    barStrength.style.height = `${(scores.strengthScore / 15) * 100}%`;
    barCore.style.height = `${(scores.coreScore / 15) * 100}%`;
    barCardio.style.height = `${(scores.cardioScore / 50) * 100}%`;

    const insights = buildInsights(scores);
    insightList.innerHTML = `
      <li><span class="dot mint"></span><span>${insights.line1}</span></li>
      <li><span class="dot peach"></span><span>${insights.line2}</span></li>
      <li><span class="dot lav"></span><span>${insights.line3}</span></li>
    `;
  }

  [
    gender,
    heightSlider,
    ageGroup,
    cardioEvent,
    strengthEvent,
    enduranceEvent,
    waistSlider,
    strengthSlider,
    coreSlider,
    cardioSlider
  ].forEach((el) => {
    el.addEventListener("input", () => {
      if (
        el === gender ||
        el === ageGroup ||
        el === cardioEvent ||
        el === strengthEvent ||
        el === enduranceEvent
      ){
        updateEventRanges();
      }
      updateUI();
    });

    el.addEventListener("change", () => {
      if (
        el === gender ||
        el === ageGroup ||
        el === cardioEvent ||
        el === strengthEvent ||
        el === enduranceEvent
      ){
        updateEventRanges();
      }
      updateUI();
    });
  });

  updateEventRanges();
  updateUI();
})();
