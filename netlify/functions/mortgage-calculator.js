// netlify/functions/mortgage-calculator.js
// ============================================================
// PCSUnited • Mortgage Calculator Engine
// v1.0.0
//
// PURPOSE
// - Canonical mortgage math engine for PCSUnited
// - Used by Housing Calculator (2D) as source of truth
// - Returns:
//   1) APR used
//   2) Down payment amount + percent
//   3) Loan amount
//   4) Monthly P&I
//   5) Monthly tax / insurance / HOA / PMI
//   6) Total monthly mortgage payment
//   7) Full amortization totals
//
// NOTES
// - Safe for Netlify Functions
// - No Supabase dependency
// - Can accept city defaults supplied by client or future city lookup
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

// ------------------------------------------------------------
// #1) HELPERS
// ------------------------------------------------------------
function n0(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function round2(v) {
  return Math.round((Number(v) || 0) * 100) / 100;
}

function round0(v) {
  return Math.round(Number(v) || 0);
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function pctFromAmount(amount, base) {
  const a = Math.max(0, n0(amount));
  const b = Math.max(0, n0(base));
  if (b <= 0) return 0;
  return (a / b) * 100;
}

function amountFromPct(base, pct) {
  const b = Math.max(0, n0(base));
  const p = clamp(n0(pct), 0, 100);
  return b * (p / 100);
}

function shortMoney(v) {
  const n = round0(v);
  return `$${n.toLocaleString("en-US")}`;
}

// ------------------------------------------------------------
// #2) APR LOGIC
// ------------------------------------------------------------
function aprFromScore(score, aprOverride) {
  const forced = n0(aprOverride);
  if (forced > 0) return round2(forced);

  const s = round0(score) || 720;

  if (s >= 780) return 6.10;
  if (s >= 760) return 6.25;
  if (s >= 740) return 6.45;
  if (s >= 720) return 6.65;
  if (s >= 700) return 6.95;
  if (s >= 680) return 7.25;
  if (s >= 660) return 7.55;
  if (s >= 640) return 7.85;
  return 8.25;
}

// ------------------------------------------------------------
// #3) PMI LOGIC
// ------------------------------------------------------------
function monthlyPmiEstimate({
  price,
  loanAmount,
  downPct,
  creditScore,
  loanType,
  pmiMonthlyOverride
}) {
  const forced = n0(pmiMonthlyOverride);
  if (forced > 0) return round2(forced);

  const homePrice = Math.max(0, n0(price));
  const loan = Math.max(0, n0(loanAmount));
  const dp = clamp(n0(downPct), 0, 100);
  const score = round0(creditScore) || 720;
  const lt = String(loanType || "conventional").trim().toLowerCase();

  // VA assumed no monthly PMI
  if (lt === "va") return 0;

  // If 20%+ down, no PMI
  if (dp >= 20) return 0;

  let annualRate = 0.0;

  if (dp >= 15) annualRate = 0.0035;
  else if (dp >= 10) annualRate = 0.0050;
  else if (dp >= 5) annualRate = 0.0070;
  else annualRate = 0.0090;

  if (score < 680) annualRate += 0.0010;
  if (score < 640) annualRate += 0.0015;

  const annual = loan * annualRate;
  return round2(annual / 12);
}

// ------------------------------------------------------------
// #4) PAYMENT MATH
// ------------------------------------------------------------
function monthlyPrincipalInterest(loanAmount, aprPct, termYears) {
  const L = Math.max(0, n0(loanAmount));
  const apr = Math.max(0, n0(aprPct)) / 100;
  const years = Math.max(1, round0(termYears) || 30);
  const n = years * 12;
  const r = apr / 12;

  if (L <= 0) return 0;
  if (r <= 0) return L / n;

  const pow = Math.pow(1 + r, n);
  return L * (r * pow) / (pow - 1);
}

function amortizationTotals(loanAmount, aprPct, termYears) {
  const L = Math.max(0, n0(loanAmount));
  const apr = Math.max(0, n0(aprPct)) / 100;
  const years = Math.max(1, round0(termYears) || 30);
  const n = years * 12;
  const r = apr / 12;

  if (L <= 0) {
    return {
      months: n,
      monthly_pi: 0,
      total_payments_pi: 0,
      total_interest: 0
    };
  }

  if (r <= 0) {
    const monthlyPI = L / n;
    return {
      months: n,
      monthly_pi: round2(monthlyPI),
      total_payments_pi: round2(monthlyPI * n),
      total_interest: 0
    };
  }

  const monthlyPI = monthlyPrincipalInterest(L, aprPct, years);

  let balance = L;
  let totalInterest = 0;

  for (let i = 0; i < n; i++) {
    const interest = balance * r;
    const principal = monthlyPI - interest;
    totalInterest += interest;
    balance = Math.max(0, balance - principal);
  }

  return {
    months: n,
    monthly_pi: round2(monthlyPI),
    total_payments_pi: round2(monthlyPI * n),
    total_interest: round2(totalInterest)
  };
}

// ------------------------------------------------------------
// #5) INPUT NORMALIZATION
// ------------------------------------------------------------
function normalizeInput(body) {
  const price = Math.max(
    0,
    n0(
      body.price ??
      body.projected_home_price ??
      body.projectedHomePrice ??
      body.homePrice
    )
  );

  const downAmountRaw = Math.max(
    0,
    n0(
      body.downpayment ??
      body.downPayment ??
      body.dpAmt
    )
  );

  const downPctRaw = n0(
    body.downPct ??
    body.down_pct ??
    body.down_payment_pct
  );

  const creditScore = clamp(
    round0(
      body.credit_score ??
      body.creditScore ??
      body.score ??
      body.fico ??
      720
    ),
    300,
    850
  );

  const termYears = clamp(
    round0(
      body.term_years ??
      body.termYears ??
      30
    ),
    1,
    40
  );

  const propertyTaxAnnual = Math.max(
    0,
    n0(
      body.property_tax_annual ??
      body.taxAnnual ??
      body.tax_annual
    )
  );

  const insuranceAnnual = Math.max(
    0,
    n0(
      body.insurance_annual ??
      body.insAnnual ??
      body.ins_annual
    )
  );

  const hoaMonthly = Math.max(
    0,
    n0(
      body.hoa_monthly ??
      body.hoaMonthly ??
      body.hoa
    )
  );

  const aprOverride = Math.max(
    0,
    n0(
      body.apr_override ??
      body.aprOverride ??
      body.apr
    )
  );

  const pmiMonthlyOverride = Math.max(
    0,
    n0(
      body.pmi_monthly ??
      body.pmiMonthly ??
      body.pmi
    )
  );

  const loanType = String(
    body.loan_type ??
    body.loanType ??
    "conventional"
  ).trim().toLowerCase();

  const cityDefaults = (body.city_defaults && typeof body.city_defaults === "object")
    ? body.city_defaults
    : {};

  const cityTaxAnnual = Math.max(
    0,
    n0(
      cityDefaults.property_tax_annual ??
      cityDefaults.tax_annual ??
      cityDefaults.taxAnnual
    )
  );

  const cityInsuranceAnnual = Math.max(
    0,
    n0(
      cityDefaults.insurance_annual ??
      cityDefaults.insAnnual
    )
  );

  const cityHoaMonthly = Math.max(
    0,
    n0(
      cityDefaults.hoa_monthly ??
      cityDefaults.hoaMonthly ??
      cityDefaults.hoa
    )
  );

  const taxAnnualFinal = propertyTaxAnnual > 0 ? propertyTaxAnnual : cityTaxAnnual;
  const insuranceAnnualFinal = insuranceAnnual > 0 ? insuranceAnnual : cityInsuranceAnnual;
  const hoaMonthlyFinal = hoaMonthly > 0 ? hoaMonthly : cityHoaMonthly;

  let downpayment = 0;
  let downPct = 0;

  if (downAmountRaw > 0) {
    downpayment = downAmountRaw;
    downPct = pctFromAmount(downpayment, price);
  } else if (downPctRaw > 0) {
    downPct = clamp(downPctRaw, 0, 100);
    downpayment = amountFromPct(price, downPct);
  }

  downpayment = round2(downpayment);
  downPct = round2(downPct);

  return {
    price: round2(price),
    downpayment,
    downPct,
    credit_score: creditScore,
    term_years: termYears,
    property_tax_annual: round2(taxAnnualFinal),
    insurance_annual: round2(insuranceAnnualFinal),
    hoa_monthly: round2(hoaMonthlyFinal),
    apr_override: round2(aprOverride),
    pmi_monthly_override: round2(pmiMonthlyOverride),
    loan_type: loanType,
    city_defaults: cityDefaults
  };
}

// ------------------------------------------------------------
// #6) CORE CALCULATION
// ------------------------------------------------------------
function calculateMortgage(input) {
  const price = Math.max(0, input.price);
  const downpayment = Math.max(0, input.downpayment);
  const downPct = clamp(input.downPct, 0, 100);
  const loanAmount = Math.max(0, price - downpayment);

  const apr = aprFromScore(input.credit_score, input.apr_override);

  const monthlyPI = monthlyPrincipalInterest(
    loanAmount,
    apr,
    input.term_years
  );

  const monthlyTax = input.property_tax_annual / 12;
  const monthlyInsurance = input.insurance_annual / 12;

  const monthlyPMI = monthlyPmiEstimate({
    price,
    loanAmount,
    downPct,
    creditScore: input.credit_score,
    loanType: input.loan_type,
    pmiMonthlyOverride: input.pmi_monthly_override
  });

  const amort = amortizationTotals(
    loanAmount,
    apr,
    input.term_years
  );

  const totalMonthlyPayment =
    monthlyPI +
    monthlyTax +
    monthlyInsurance +
    input.hoa_monthly +
    monthlyPMI;

  const totalTaxPaid = monthlyTax * amort.months;
  const totalInsurancePaid = monthlyInsurance * amort.months;
  const totalHoaPaid = input.hoa_monthly * amort.months;
  const totalPmiPaid = monthlyPMI * amort.months;

  const totalOutOfPocket =
    amort.total_payments_pi +
    totalTaxPaid +
    totalInsurancePaid +
    totalHoaPaid +
    totalPmiPaid;

  return {
    inputs: input,
    mortgage: {
      price: round2(price),
      downpayment: round2(downpayment),
      downpayment_pct: round2(downPct),
      loan_amount: round2(loanAmount),
      credit_score: input.credit_score,
      loan_type: input.loan_type,
      apr: round2(apr),
      term_years: input.term_years
    },
    monthly: {
      principal_interest: round2(monthlyPI),
      property_tax: round2(monthlyTax),
      insurance: round2(monthlyInsurance),
      hoa: round2(input.hoa_monthly),
      pmi: round2(monthlyPMI),
      total_payment: round2(totalMonthlyPayment)
    },
    totals: {
      months: amort.months,
      principal_interest_total: round2(amort.total_payments_pi),
      total_interest: round2(amort.total_interest),
      property_tax_total: round2(totalTaxPaid),
      insurance_total: round2(totalInsurancePaid),
      hoa_total: round2(totalHoaPaid),
      pmi_total: round2(totalPmiPaid),
      out_of_pocket_total: round2(totalOutOfPocket)
    },
    summary: {
      payment_label: shortMoney(totalMonthlyPayment),
      apr_label: `${round2(apr).toFixed(2)}%`
    }
  };
}

// ------------------------------------------------------------
// #7) HANDLER
// ------------------------------------------------------------
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

    if (input.price <= 0) {
      return json(400, {
        ok: false,
        error: "Home price is required and must be greater than 0"
      });
    }

    const result = calculateMortgage(input);

    return json(200, {
      ok: true,
      ...result
    });
  } catch (err) {
    return json(500, {
      ok: false,
      error: err?.message || "Unexpected mortgage calculation error"
    });
  }
}
