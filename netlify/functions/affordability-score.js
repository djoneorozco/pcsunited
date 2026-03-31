// netlify/functions/affordability-score.js
// ============================================================
// PCSUnited • Affordability Score Engine
// v1.1.0
//
// UPDATE
// - Stops over-crediting Additional Monthly Income
// - Adds explicit cap on usable additional income in grade math
// - Uses raw total income for display math only
// - Uses capped/discounted additional income for grading + price range
//
// PURPOSE
// - Central scoring engine for 2C / Affordability Zone & Strategy
// - Calculates:
//   1) Monthly Load Ratio
//   2) Residual Monthly Income
//   3) Financial Health score + grade
//   4) Recommended price range
//   5) Explanation flags / reasons
// ============================================================

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
  "Content-Type": "application/json"
};

function json(statusCode, body) {
  return {
    statusCode,
    headers: corsHeaders,
    body: JSON.stringify(body)
  };
}

function n0(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function round0(v) {
  return Math.round(n0(v));
}

function pct(v) {
  return Math.round((Number(v) || 0) * 100);
}

function normalizeInput(body) {
  const totalMonthlyIncome = Math.max(0, n0(
    body.total_monthly_income ??
    body.totalMonthlyIncome ??
    body.monthly_income ??
    body.monthlyIncome ??
    body.income ??
    body.pay_total
  ));

  const additionalMonthlyIncome = Math.max(0, n0(
    body.additional_monthly_income ??
    body.additionalMonthlyIncome ??
    body.additional_income ??
    body.additionalIncome
  ));

  const monthlyExpenses = Math.max(0, n0(
    body.monthly_expenses ??
    body.monthlyExpenses ??
    body.expenses
  ));

  const monthlyDebt = Math.max(0, n0(
    body.monthly_debt ??
    body.monthlyDebt ??
    body.debt ??
    body.debt_monthly ??
    body.debtPayments ??
    body.non_housing_debt ??
    body.nonHousingDebt
  ));

  const projectedMortgageAmount = Math.max(0, n0(
    body.projected_mortgage_amount ??
    body.projectedMortgageAmount ??
    body.housing_monthly ??
    body.housingMonthly ??
    body.mortgage ??
    body.monthly_housing
  ));

  const savings = Math.max(0, n0(
    body.savings
  ));

  const additionalIncomeStability = String(
    body.additional_income_stability ??
    body.additionalIncomeStability ??
    "unknown"
  ).trim().toLowerCase();

  const targetHomePrice = Math.max(0, n0(
    body.target_home_price ??
    body.targetHomePrice ??
    body.projected_home_price ??
    body.projectedHomePrice ??
    body.price
  ));

  return {
    total_monthly_income: round0(totalMonthlyIncome),
    additional_monthly_income: round0(additionalMonthlyIncome),
    monthly_expenses: round0(monthlyExpenses),
    monthly_debt: round0(monthlyDebt),
    projected_mortgage_amount: round0(projectedMortgageAmount),
    savings: round0(savings),
    additional_income_stability: additionalIncomeStability,
    target_home_price: round0(targetHomePrice)
  };
}

function getStableAdditionalIncome(additionalIncome, baseIncome, stability) {
  const s = String(stability || "").toLowerCase();
  const addl = Math.max(0, n0(additionalIncome));
  const base = Math.max(0, n0(baseIncome));

  let multiplier = 0.8;
  if (s === "stable" || s === "verified" || s === "recurring") multiplier = 1.0;
  else if (s === "likely" || s === "mostly_stable") multiplier = 0.85;
  else if (s === "variable" || s === "side" || s === "uncertain") multiplier = 0.7;

  const discounted = addl * multiplier;

  // Hard cap: only count up to 50% of base income toward scoring.
  // This keeps a huge side-income number from overpowering the model.
  const capByBaseIncome = base * 0.5;

  // Absolute monthly cap for now. Easy to tune later.
  const hardMonthlyCap = 5000;

  return Math.max(0, Math.min(discounted, capByBaseIncome, hardMonthlyCap));
}

function scoreBand(value, bands) {
  for (const band of bands) {
    if (value <= band.max) return band.score;
  }
  return bands[bands.length - 1].score;
}

function scoreBandMin(value, bands) {
  for (const band of bands) {
    if (value >= band.min) return band.score;
  }
  return bands[bands.length - 1].score;
}

function gradeFromScore(score) {
  const s = round0(score);

  if (s >= 97) return "A+";
  if (s >= 93) return "A";
  if (s >= 90) return "A-";
  if (s >= 87) return "B+";
  if (s >= 83) return "B";
  if (s >= 80) return "B-";
  if (s >= 77) return "C+";
  if (s >= 73) return "C";
  if (s >= 70) return "C-";
  if (s >= 67) return "D+";
  if (s >= 63) return "D";
  if (s >= 60) return "D-";
  return "F";
}

function applyGradeCap(score, capGrade, capsApplied, reason) {
  const gradeCeilings = {
    "A+": 99,
    "A": 96,
    "A-": 92,
    "B+": 89,
    "B": 86,
    "B-": 82,
    "C+": 79,
    "C": 76,
    "C-": 72,
    "D+": 69,
    "D": 66,
    "D-": 62,
    "F": 59
  };

  const ceiling = gradeCeilings[capGrade];
  if (ceiling == null) return score;

  const next = Math.min(score, ceiling);
  if (next !== score) {
    capsApplied.push({
      cap_grade: capGrade,
      reason
    });
  }
  return next;
}

function priceRangeFromLoad(loadRatio) {
  if (loadRatio <= 0.35) {
    return { tier: "strong", low: 420000, high: 460000 };
  }
  if (loadRatio <= 0.45) {
    return { tier: "solid", low: 380000, high: 420000 };
  }
  if (loadRatio <= 0.55) {
    return { tier: "cautious", low: 340000, high: 380000 };
  }
  return { tier: "stretched", low: 280000, high: 340000 };
}

function buildReasons(metrics, scoring) {
  const reasons = [];

  if (metrics.monthly_load_ratio_for_grade <= 0.35) {
    reasons.push("Monthly load is comfortably inside a healthy range.");
  } else if (metrics.monthly_load_ratio_for_grade <= 0.45) {
    reasons.push("Monthly load is manageable, but should still be monitored.");
  } else if (metrics.monthly_load_ratio_for_grade <= 0.55) {
    reasons.push("Monthly load is elevated and leaves less room for surprises.");
  } else {
    reasons.push("Monthly load is heavy relative to usable income and creates pressure on flexibility.");
  }

  if (metrics.housing_ratio <= 0.30) {
    reasons.push("Projected housing cost is in a more conservative range.");
  } else if (metrics.housing_ratio <= 0.38) {
    reasons.push("Projected housing cost is workable, but is beginning to pressure the budget.");
  } else {
    reasons.push("Projected housing cost is high relative to usable income.");
  }

  if (metrics.reserves_months >= 6) {
    reasons.push("Savings provide a strong reserve cushion.");
  } else if (metrics.reserves_months >= 3) {
    reasons.push("Savings provide a decent reserve cushion, but not an elite one.");
  } else if (metrics.reserves_months > 0) {
    reasons.push("Savings cushion is thin for the current expense level.");
  } else {
    reasons.push("There is no visible reserve cushion supporting the budget.");
  }

  if (metrics.residual_monthly_income >= 2500) {
    reasons.push("Residual monthly income is strong after current obligations.");
  } else if (metrics.residual_monthly_income >= 1000) {
    reasons.push("Residual monthly income is positive, but not highly resilient.");
  } else if (metrics.residual_monthly_income >= 0) {
    reasons.push("Residual monthly income is narrow and may not absorb surprises well.");
  } else {
    reasons.push("Residual monthly income is negative, which signals affordability stress.");
  }

  if (metrics.additional_income_credit_ratio < 1) {
    reasons.push("Additional income was discounted for scoring so the grade does not over-credit variable or unusually large side income.");
  }

  if (scoring.caps_applied.length) {
    for (const cap of scoring.caps_applied) {
      reasons.push(cap.reason);
    }
  }

  return reasons;
}

function runScoring(input) {
  const stableAdditionalIncome = getStableAdditionalIncome(
    input.additional_monthly_income,
    input.total_monthly_income,
    input.additional_income_stability
  );

  const totalIncomeRaw = input.total_monthly_income + input.additional_monthly_income;
  const totalIncomeForGrade = input.total_monthly_income + stableAdditionalIncome;

  const totalMonthlyExpenses =
    input.monthly_expenses +
    input.monthly_debt +
    input.projected_mortgage_amount;

  // Display ratio uses actual entered total income
  const monthlyLoadRatio = totalIncomeRaw > 0 ? totalMonthlyExpenses / totalIncomeRaw : 0;

  // Grading ratio uses usable/capped income
  const monthlyLoadRatioForGrade = totalIncomeForGrade > 0 ? totalMonthlyExpenses / totalIncomeForGrade : 0;

  const housingRatio = totalIncomeForGrade > 0 ? input.projected_mortgage_amount / totalIncomeForGrade : 0;
  const debtOnlyRatio = totalIncomeForGrade > 0 ? input.monthly_debt / totalIncomeForGrade : 0;
  const residualMonthlyIncome = totalIncomeRaw - totalMonthlyExpenses;
  const reservesMonths = totalMonthlyExpenses > 0 ? input.savings / totalMonthlyExpenses : 0;
  const additionalIncomeCreditRatio = input.additional_monthly_income > 0
    ? stableAdditionalIncome / input.additional_monthly_income
    : 1;

  const housingScore = scoreBand(housingRatio, [
    { max: 0.28, score: 100 },
    { max: 0.32, score: 90 },
    { max: 0.36, score: 75 },
    { max: 0.40, score: 55 },
    { max: Infinity, score: 25 }
  ]);

  const loadScore = scoreBand(monthlyLoadRatioForGrade, [
    { max: 0.35, score: 100 },
    { max: 0.45, score: 88 },
    { max: 0.55, score: 72 },
    { max: 0.65, score: 50 },
    { max: Infinity, score: 20 }
  ]);

  const debtScore = scoreBand(debtOnlyRatio, [
    { max: 0.10, score: 100 },
    { max: 0.20, score: 90 },
    { max: 0.30, score: 75 },
    { max: 0.40, score: 55 },
    { max: Infinity, score: 25 }
  ]);

  const residualScore = scoreBandMin(residualMonthlyIncome, [
    { min: 3000, score: 100 },
    { min: 2000, score: 90 },
    { min: 1000, score: 75 },
    { min: 500, score: 60 },
    { min: 0, score: 45 },
    { min: -Infinity, score: 10 }
  ]);

  const reserveScore = scoreBandMin(reservesMonths, [
    { min: 6, score: 100 },
    { min: 3, score: 82 },
    { min: 1, score: 60 },
    { min: 0.25, score: 35 },
    { min: 0, score: 15 },
    { min: -Infinity, score: 15 }
  ]);

  const weightedScore =
    (housingScore * 0.25) +
    (loadScore * 0.25) +
    (debtScore * 0.15) +
    (residualScore * 0.20) +
    (reserveScore * 0.15);

  let finalScore = round0(weightedScore);
  const capsApplied = [];

  if (residualMonthlyIncome < 0) {
    finalScore = applyGradeCap(
      finalScore,
      "D",
      capsApplied,
      "Negative residual cash flow caps the grade at D."
    );
  } else if (residualMonthlyIncome < 500) {
    finalScore = applyGradeCap(
      finalScore,
      "C-",
      capsApplied,
      "Residual cash flow under $500 caps the grade at C-."
    );
  }

  if (monthlyLoadRatioForGrade > 0.80) {
    finalScore = applyGradeCap(
      finalScore,
      "F",
      capsApplied,
      "Monthly load above 80% of usable income caps the grade at F."
    );
  } else if (monthlyLoadRatioForGrade > 0.65) {
    finalScore = applyGradeCap(
      finalScore,
      "D",
      capsApplied,
      "Monthly load above 65% of usable income caps the grade at D."
    );
  } else if (monthlyLoadRatioForGrade > 0.55) {
    finalScore = applyGradeCap(
      finalScore,
      "C+",
      capsApplied,
      "Monthly load above 55% of usable income caps the grade at C+."
    );
  }

  if (reservesMonths < 1 && monthlyLoadRatioForGrade > 0.50) {
    finalScore = applyGradeCap(
      finalScore,
      "C",
      capsApplied,
      "Thin reserves combined with elevated monthly load cap the grade at C."
    );
  }

  if (housingRatio > 0.40) {
    finalScore = applyGradeCap(
      finalScore,
      "C",
      capsApplied,
      "Housing cost above 40% of usable income caps the grade at C."
    );
  }

  finalScore = clamp(finalScore, 0, 99);
  const finalGrade = gradeFromScore(finalScore);

  // Recommendation should also follow usable income, not raw side-income spikes
  const priceRange = priceRangeFromLoad(monthlyLoadRatioForGrade);

  return {
    inputs: input,
    metrics: {
      total_income: round0(totalIncomeRaw),
      total_income_for_grade: round0(totalIncomeForGrade),
      stable_additional_income_used: round0(stableAdditionalIncome),
      additional_income_credit_ratio: Number(additionalIncomeCreditRatio.toFixed(4)),
      total_monthly_expenses: round0(totalMonthlyExpenses),
      monthly_load_ratio: Number(monthlyLoadRatio.toFixed(4)),
      monthly_load_pct: pct(monthlyLoadRatio),
      monthly_load_ratio_for_grade: Number(monthlyLoadRatioForGrade.toFixed(4)),
      monthly_load_pct_for_grade: pct(monthlyLoadRatioForGrade),
      housing_ratio: Number(housingRatio.toFixed(4)),
      housing_pct: pct(housingRatio),
      debt_only_ratio: Number(debtOnlyRatio.toFixed(4)),
      debt_only_pct: pct(debtOnlyRatio),
      reserves_months: Number(reservesMonths.toFixed(2)),
      residual_monthly_income: round0(residualMonthlyIncome)
    },
    scoring: {
      score: finalScore,
      grade: finalGrade,
      caps_applied: capsApplied,
      category_scores: {
        housing: round0(housingScore),
        monthly_load: round0(loadScore),
        debt_only: round0(debtScore),
        residual: round0(residualScore),
        reserves: round0(reserveScore)
      }
    },
    recommendation: {
      tier: priceRange.tier,
      price_range: {
        low: priceRange.low,
        high: priceRange.high,
        label: ""
      }
    }
  };
}

function buildPrettyPriceLabel(low, high) {
  function shortMoney(n) {
    const val = round0(n);
    if (val >= 1000) {
      return `$${Math.round(val / 1000)}K`;
    }
    return `$${val}`;
  }
  return `${shortMoney(low)} - ${shortMoney(high)}`;
}

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 204,
      headers: corsHeaders,
      body: ""
    };
  }

  if (event.httpMethod !== "POST") {
    return json(405, { ok: false, error: "Method not allowed" });
  }

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return json(400, { ok: false, error: "Invalid JSON body" });
  }

  try {
    const input = normalizeInput(body);
    const result = runScoring(input);

    result.recommendation.price_range.label = buildPrettyPriceLabel(
      result.recommendation.price_range.low,
      result.recommendation.price_range.high
    );

    result.reasons = buildReasons(result.metrics, result.scoring);

    return json(200, {
      ok: true,
      ...result
    });
  } catch (err) {
    return json(500, {
      ok: false,
      error: err?.message || "Unexpected scoring error"
    });
  }
}
