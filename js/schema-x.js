/* ============================================================
  //#1) Brain Schema X
  //#2) PCSUnited / Affordability Zone / Strategy Brain Engine
  //#3) v1.0.0
  //#4) FULL READY-TO-PASTE FILE

  PURPOSE
  - Build a canonical Brain Schema X object from user / bridge / profile data
  - Use deterministic finance + fit + behavior logic
  - Produce analyst-style findings, scores, verdict, and AI payload
  - Safe for browser use
  - No external libraries required

  IMPORTANT
  - Deterministic math first
  - AI should only interpret this output, never calculate it
============================================================ */
(function (global) {
  "use strict";

  //#5) NAMESPACE
  const SchemaX = {};

  //#6) HELPERS
  function nowIso() {
    return new Date().toISOString();
  }

  function str(v) {
    return String(v == null ? "" : v).trim();
  }

  function lower(v) {
    return str(v).toLowerCase();
  }

  function n0(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }

  function numOrNull(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  function clamp(n, min, max) {
    return Math.max(min, Math.min(max, n));
  }

  function round2(n) {
    return Math.round((Number(n) || 0) * 100) / 100;
  }

  function pick(obj, keys) {
    if (!obj || typeof obj !== "object") return null;
    for (const key of keys) {
      const v = obj[key];
      if (v !== undefined && v !== null && v !== "") return v;
    }
    return null;
  }

  function deepClone(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  function sum(arr) {
    return (Array.isArray(arr) ? arr : []).reduce((a, b) => a + n0(b), 0);
  }

  function pct(numerator, denominator) {
    const d = n0(denominator);
    if (d <= 0) return 0;
    return n0(numerator) / d;
  }

  function safeArray(v) {
    return Array.isArray(v) ? v : [];
  }

  function titleCase(v) {
    const s = str(v).toLowerCase();
    if (!s) return "";
    return s
      .split(/\s+/)
      .map((part) => part ? part.charAt(0).toUpperCase() + part.slice(1) : "")
      .join(" ");
  }

  function creditBand(score) {
    const s = n0(score);
    if (s >= 760) return "excellent";
    if (s >= 720) return "good";
    if (s >= 680) return "fair";
    return "weak";
  }

  function aprFromScore(score) {
    const s = n0(score);
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

  function pmiExpected(score, downPct) {
    return n0(downPct) < 20 && n0(score) < 780;
  }

  function pmtMonthlyPI(loan, aprPct, years) {
    const L = Math.max(0, n0(loan));
    const apr = Math.max(0, n0(aprPct)) / 100;
    const n = Math.max(1, Math.round(n0(years || 30) * 12));
    const r = apr / 12;

    if (L <= 0) return 0;
    if (r <= 0) return L / n;

    const pow = Math.pow(1 + r, n);
    return L * (r * pow) / (pow - 1);
  }

  function estimateHousingAllIn(input) {
    const price = Math.max(0, n0(input.price));
    const down = Math.max(0, n0(input.downpayment_amount));
    const creditScore = clamp(n0(input.credit_score || 720), 300, 850);
    const apr = n0(input.apr_estimate) || aprFromScore(creditScore);
    const years = n0(input.term_years || 30) || 30;

    if (price <= 0) return 0;

    const loan = Math.max(0, price - down);
    const pi = pmtMonthlyPI(loan, apr, years);

    const taxRate = Math.max(0, n0(input.market_property_tax_rate || 0.012));
    const insRate = Math.max(0, n0(input.market_insurance_rate || 0.0035));
    const hoa = Math.max(0, n0(input.market_hoa_typical_monthly || 0));

    const taxMonthly = (price * taxRate) / 12;
    const insuranceMonthly = (price * insRate) / 12;

    let pmiMonthly = 0;
    const downPct = pct(down, price) * 100;
    if (pmiExpected(creditScore, downPct)) {
      pmiMonthly = (loan * 0.0085) / 12;
    }

    return round2(pi + taxMonthly + insuranceMonthly + hoa + pmiMonthly);
  }

  //#7) EMPTY SCHEMA
  SchemaX.empty = function empty() {
    return {
      schema_name: "Brain Schema X",
      schema_version: "1.0.0",
      generated_at: nowIso(),
      source: {
        product: "PCSUnited",
        module: "Affordability Zone & Strategy",
        engine_mode: "deterministic_plus_ai",
        environment: "webflow_or_netlify"
      },
      identity: {
        profile_id: null,
        email: "",
        first_name: "",
        last_name: "",
        full_name: "",
        mode: "",
        created_at: null
      },
      household: {
        rank: "",
        rank_paygrade: "",
        service_branch: "",
        years_of_service: 0,
        base: "",
        city_key: "",
        marital_status: "",
        spouse_present: false,
        dependents_total: 0,
        children_count: 0,
        household_size: 1,
        family_structure: "",
        va_disability_percent: 0,
        mobility_risk: "medium",
        pcs_expected_window_months: 12
      },
      income_profile: {
        base_pay_monthly: 0,
        bah_monthly: 0,
        bas_monthly: 0,
        va_disability_monthly: 0,
        spouse_income_monthly: 0,
        other_income_monthly: 0,
        gross_monthly_total: 0,
        stable_monthly_total: 0,
        income_confidence: "low",
        income_source_breakdown: {
          military: 0,
          allowances: 0,
          disability: 0,
          spouse: 0,
          other: 0
        }
      },
      expense_profile: {
        monthly_expenses_total: 0,
        utilities: 0,
        transportation: 0,
        food: 0,
        health: 0,
        insurance_non_housing: 0,
        childcare: 0,
        entertainment: 0,
        subscriptions: 0,
        shopping: 0,
        other: 0,
        expense_confidence: "low",
        expense_capture_method: "unknown"
      },
      debt_profile: {
        monthly_debt_total: 0,
        auto_loan: 0,
        credit_cards: 0,
        student_loans: 0,
        personal_loans: 0,
        other_debt: 0,
        debt_capture_complete: false,
        debt_confidence: "low",
        debt_mix: {
          installment_total: 0,
          revolving_total: 0,
          discretionary_like_total: 0
        }
      },
      housing_goal: {
        target_home_price: 0,
        downpayment_amount: 0,
        downpayment_percent: 0,
        target_bedrooms: 0,
        target_bathrooms: 0,
        target_sqft: 0,
        garage_spaces: 0,
        property_type: "",
        home_condition: "",
        amenities: [],
        must_have_count: 0,
        aspiration_level: "practical",
        housing_goal_confidence: "low"
      },
      market_context: {
        city_key: "",
        market_avg_home_price: 0,
        market_avg_rent: 0,
        market_avg_sqft: 0,
        market_avg_bedrooms: 0,
        market_property_tax_rate: 0,
        market_insurance_rate: 0,
        market_hoa_typical_monthly: 0,
        inventory_pressure: "medium",
        market_fit_band: "at_market"
      },
      credit_profile: {
        credit_score: 720,
        credit_band: "good",
        apr_estimate: 0,
        financing_strength: "moderate",
        pmi_expected: true,
        credit_improvement_potential: "medium"
      },
      timeline_profile: {
        time_to_buy: "unknown",
        urgency_level: "medium",
        timeline_months: 6,
        purchase_readiness_stage: "preparing"
      },
      behavior_profile: {
        entertainment_spend_monthly: 0,
        entertainment_share_of_expenses: 0,
        discretionary_spend_total: 0,
        discretionary_share_of_expenses: 0,
        fixed_spend_total: 0,
        fixed_share_of_expenses: 0,
        behavior_flags: [],
        cutback_opportunities: []
      },
      derived_metrics: {
        stable_income_monthly: 0,
        monthly_housing_payment_estimate: 0,
        monthly_housing_all_in: 0,
        monthly_total_obligations: 0,
        monthly_residual_after_expenses: 0,
        monthly_residual_after_housing: 0,
        monthly_free_cash_flow: 0,
        housing_ratio: 0,
        debt_ratio: 0,
        expense_ratio: 0,
        discretionary_ratio: 0,
        savings_ratio: 0,
        downpayment_ratio: 0,
        closing_buffer_months: 0,
        family_bedroom_ratio: 0,
        garage_excess_flag: false,
        home_size_efficiency_score: 0,
        aspiration_gap_dollars: 0,
        aspiration_gap_percent: 0
      },
      fit_analysis: {
        family_fit: {
          status: "reasonable",
          score: 0,
          reason: ""
        },
        budget_fit: {
          status: "safe",
          score: 0,
          reason: ""
        },
        debt_fit: {
          status: "manageable",
          score: 0,
          reason: ""
        },
        behavior_fit: {
          status: "mixed",
          score: 0,
          reason: ""
        },
        timeline_fit: {
          status: "near_ready",
          score: 0,
          reason: ""
        },
        market_fit: {
          status: "aligned",
          score: 0,
          reason: ""
        }
      },
      findings: [],
      scores: {
        affordability_score: 0,
        resilience_score: 0,
        fit_score: 0,
        behavior_score: 0,
        readiness_score: 0,
        overall_score: 0,
        grade: "F",
        confidence_level: "low"
      },
      scenario_options: [],
      verdict: {
        status: "CAUTION",
        headline: "",
        primary_reason: "",
        top_reasons: [],
        best_next_action: "",
        analyst_stance: "delay_and_prepare"
      },
      ai_brief_payload: {
        bluf_inputs: {
          status: "CAUTION",
          overall_score: 0,
          grade: "F"
        },
        profile_summary: {
          rank: "",
          years_of_service: 0,
          household_size: 1,
          base: ""
        },
        financial_summary: {
          stable_income_monthly: 0,
          monthly_expenses_total: 0,
          monthly_debt_total: 0,
          monthly_housing_all_in: 0,
          monthly_free_cash_flow: 0
        },
        housing_summary: {
          target_home_price: 0,
          target_bedrooms: 0,
          garage_spaces: 0
        },
        top_findings: [],
        scenario_options: [],
        tone_target: "professional_real_financial_analyst"
      }
    };
  };

  //#8) NORMALIZE RAW INPUT
  SchemaX.normalizeInput = function normalizeInput(raw) {
    const input = raw && typeof raw === "object" ? raw : {};

    const out = {
      profile_id: pick(input, ["profile_id", "id"]),
      email: lower(pick(input, ["email"])),
      first_name: str(pick(input, ["first_name"])),
      last_name: str(pick(input, ["last_name"])),
      full_name: str(pick(input, ["full_name", "name"])),

      mode: str(pick(input, ["mode"])),

      rank: str(pick(input, ["rank"])),
      rank_paygrade: str(pick(input, ["rank_paygrade", "paygrade"])),
      service_branch: str(pick(input, ["service_branch", "branch"])),
      years_of_service: n0(pick(input, ["years_of_service", "yos"])),
      base: str(pick(input, ["base"])),
      city_key: str(pick(input, ["city_key", "cityKey"])),
      marital_status: str(pick(input, ["marital_status"])),
      spouse_present: !!pick(input, ["spouse_present"]),
      dependents_total: n0(pick(input, ["dependents_total", "dependents", "family"])),
      children_count: n0(pick(input, ["children_count", "kids"])),
      household_size: n0(pick(input, ["household_size"])) || 1,
      va_disability_percent: n0(pick(input, ["va_disability_percent", "va_disability"])),

      base_pay_monthly: n0(pick(input, ["base_pay_monthly", "basePay", "base_pay"])),
      bah_monthly: n0(pick(input, ["bah_monthly", "bah"])),
      bas_monthly: n0(pick(input, ["bas_monthly", "bas"])),
      va_disability_monthly: n0(pick(input, ["va_disability_monthly", "disability_monthly", "disability"])),
      spouse_income_monthly: n0(pick(input, ["spouse_income_monthly", "spouse_income"])),
      other_income_monthly: n0(pick(input, ["other_income_monthly", "other_income", "add_income", "additional_income"])),

      monthly_expenses_total: n0(pick(input, ["monthly_expenses_total", "monthly_expenses", "expenses"])),
      utilities: n0(pick(input, ["utilities"])),
      transportation: n0(pick(input, ["transportation"])),
      food: n0(pick(input, ["food"])),
      health: n0(pick(input, ["health"])),
      insurance_non_housing: n0(pick(input, ["insurance_non_housing"])),
      childcare: n0(pick(input, ["childcare"])),
      entertainment: n0(pick(input, ["entertainment"])),
      subscriptions: n0(pick(input, ["subscriptions"])),
      shopping: n0(pick(input, ["shopping"])),
      other_expenses: n0(pick(input, ["other_expenses", "other"])),

      monthly_debt_total: n0(pick(input, ["monthly_debt_total", "monthly_debt", "debt", "debt_monthly", "debtPayments"])),
      auto_loan: n0(pick(input, ["auto_loan"])),
      credit_cards: n0(pick(input, ["credit_cards"])),
      student_loans: n0(pick(input, ["student_loans"])),
      personal_loans: n0(pick(input, ["personal_loans"])),
      other_debt: n0(pick(input, ["other_debt"])),

      target_home_price: n0(pick(input, ["target_home_price", "projected_home_price", "price", "home_price"])),
      downpayment_amount: n0(pick(input, ["downpayment_amount", "downpayment", "dpAmt", "savings"])),
      target_bedrooms: n0(pick(input, ["target_bedrooms", "bedrooms"])),
      target_bathrooms: n0(pick(input, ["target_bathrooms", "bathrooms"])),
      target_sqft: n0(pick(input, ["target_sqft", "sqft"])),
      garage_spaces: n0(pick(input, ["garage_spaces", "garage"])),
      property_type: str(pick(input, ["property_type"])),
      home_condition: str(pick(input, ["home_condition"])),
      amenities: Array.isArray(input.amenities)
        ? input.amenities
        : str(pick(input, ["amenities"]))
            .split(/[,;|]/g)
            .map((x) => str(x))
            .filter(Boolean),

      market_avg_home_price: n0(pick(input, ["market_avg_home_price", "avg_home_price"])),
      market_avg_rent: n0(pick(input, ["market_avg_rent", "avg_rent"])),
      market_avg_sqft: n0(pick(input, ["market_avg_sqft"])),
      market_avg_bedrooms: n0(pick(input, ["market_avg_bedrooms"])),
      market_property_tax_rate: n0(pick(input, ["market_property_tax_rate", "property_tax_rate"])) || 0.012,
      market_insurance_rate: n0(pick(input, ["market_insurance_rate", "insurance_rate"])) || 0.0035,
      market_hoa_typical_monthly: n0(pick(input, ["market_hoa_typical_monthly", "hoa_monthly"])),

      credit_score: clamp(n0(pick(input, ["credit_score", "creditScore", "fico"])) || 720, 300, 850),
      time_to_buy: str(pick(input, ["time_to_buy", "purchase_time"])),
      timeline_months: n0(pick(input, ["timeline_months"])) || 6
    };

    if (!out.household_size || out.household_size < 1) {
      const spouse = out.spouse_present ? 1 : 0;
      const kids = Math.max(0, out.children_count || out.dependents_total || 0);
      out.household_size = Math.max(1, 1 + spouse + kids);
    }

    if (out.monthly_debt_total <= 0) {
      out.monthly_debt_total = round2(
        out.auto_loan +
        out.credit_cards +
        out.student_loans +
        out.personal_loans +
        out.other_debt
      );
    }

    return out;
  };

  //#9) BUILD SCHEMA FROM NORMALIZED INPUT
  SchemaX.build = function build(rawInput) {
    const input = SchemaX.normalizeInput(rawInput);
    const schema = SchemaX.empty();

    //#9.1 identity
    schema.identity.profile_id = input.profile_id || null;
    schema.identity.email = input.email;
    schema.identity.first_name = input.first_name;
    schema.identity.last_name = input.last_name;
    schema.identity.full_name = input.full_name || [input.first_name, input.last_name].filter(Boolean).join(" ");
    schema.identity.mode = input.mode;
    schema.identity.created_at = nowIso();

    //#9.2 household
    schema.household.rank = input.rank;
    schema.household.rank_paygrade = input.rank_paygrade;
    schema.household.service_branch = input.service_branch;
    schema.household.years_of_service = input.years_of_service;
    schema.household.base = input.base;
    schema.household.city_key = input.city_key;
    schema.household.marital_status = input.marital_status;
    schema.household.spouse_present = !!input.spouse_present;
    schema.household.dependents_total = input.dependents_total;
    schema.household.children_count = input.children_count;
    schema.household.household_size = input.household_size;
    schema.household.va_disability_percent = input.va_disability_percent;
    schema.household.family_structure = buildFamilyStructure(schema.household);
    schema.household.mobility_risk = inferMobilityRisk(input.time_to_buy, input.years_of_service);
    schema.household.pcs_expected_window_months = inferPcsWindow(input.time_to_buy);

    //#9.3 income
    schema.income_profile.base_pay_monthly = input.base_pay_monthly;
    schema.income_profile.bah_monthly = input.bah_monthly;
    schema.income_profile.bas_monthly = input.bas_monthly;
    schema.income_profile.va_disability_monthly = input.va_disability_monthly;
    schema.income_profile.spouse_income_monthly = input.spouse_income_monthly;
    schema.income_profile.other_income_monthly = input.other_income_monthly;

    schema.income_profile.income_source_breakdown.military = round2(input.base_pay_monthly);
    schema.income_profile.income_source_breakdown.allowances = round2(input.bah_monthly + input.bas_monthly);
    schema.income_profile.income_source_breakdown.disability = round2(input.va_disability_monthly);
    schema.income_profile.income_source_breakdown.spouse = round2(input.spouse_income_monthly);
    schema.income_profile.income_source_breakdown.other = round2(input.other_income_monthly);

    schema.income_profile.gross_monthly_total = round2(
      input.base_pay_monthly +
      input.bah_monthly +
      input.bas_monthly +
      input.va_disability_monthly +
      input.spouse_income_monthly +
      input.other_income_monthly
    );

    schema.income_profile.stable_monthly_total = round2(schema.income_profile.gross_monthly_total);
    schema.income_profile.income_confidence = inferIncomeConfidence(schema.income_profile);

    //#9.4 expenses
    schema.expense_profile.utilities = input.utilities;
    schema.expense_profile.transportation = input.transportation;
    schema.expense_profile.food = input.food;
    schema.expense_profile.health = input.health;
    schema.expense_profile.insurance_non_housing = input.insurance_non_housing;
    schema.expense_profile.childcare = input.childcare;
    schema.expense_profile.entertainment = input.entertainment;
    schema.expense_profile.subscriptions = input.subscriptions;
    schema.expense_profile.shopping = input.shopping;
    schema.expense_profile.other = input.other_expenses;

    const expenseBucketsTotal = round2(
      input.utilities +
      input.transportation +
      input.food +
      input.health +
      input.insurance_non_housing +
      input.childcare +
      input.entertainment +
      input.subscriptions +
      input.shopping +
      input.other_expenses
    );

    schema.expense_profile.monthly_expenses_total = input.monthly_expenses_total > 0
      ? round2(input.monthly_expenses_total)
      : expenseBucketsTotal;

    schema.expense_profile.expense_confidence = inferExpenseConfidence(schema.expense_profile);
    schema.expense_profile.expense_capture_method = inferExpenseCaptureMethod(input, expenseBucketsTotal);

    //#9.5 debt
    schema.debt_profile.auto_loan = input.auto_loan;
    schema.debt_profile.credit_cards = input.credit_cards;
    schema.debt_profile.student_loans = input.student_loans;
    schema.debt_profile.personal_loans = input.personal_loans;
    schema.debt_profile.other_debt = input.other_debt;
    schema.debt_profile.monthly_debt_total = input.monthly_debt_total;
    schema.debt_profile.debt_capture_complete = inferDebtCaptureComplete(schema.debt_profile);
    schema.debt_profile.debt_confidence = inferDebtConfidence(schema.debt_profile);

    schema.debt_profile.debt_mix.installment_total = round2(
      input.auto_loan + input.student_loans + input.personal_loans
    );
    schema.debt_profile.debt_mix.revolving_total = round2(input.credit_cards);
    schema.debt_profile.debt_mix.discretionary_like_total = round2(input.personal_loans + input.credit_cards);

    //#9.6 housing goal
    schema.housing_goal.target_home_price = input.target_home_price;
    schema.housing_goal.downpayment_amount = input.downpayment_amount;
    schema.housing_goal.downpayment_percent = input.target_home_price > 0
      ? round2((input.downpayment_amount / input.target_home_price) * 100)
      : 0;
    schema.housing_goal.target_bedrooms = input.target_bedrooms;
    schema.housing_goal.target_bathrooms = input.target_bathrooms;
    schema.housing_goal.target_sqft = input.target_sqft;
    schema.housing_goal.garage_spaces = input.garage_spaces;
    schema.housing_goal.property_type = input.property_type;
    schema.housing_goal.home_condition = input.home_condition;
    schema.housing_goal.amenities = safeArray(input.amenities);
    schema.housing_goal.must_have_count = schema.housing_goal.amenities.length;
    schema.housing_goal.aspiration_level = inferAspirationLevel(schema);
    schema.housing_goal.housing_goal_confidence = inferHousingConfidence(schema.housing_goal);

    //#9.7 market
    schema.market_context.city_key = input.city_key;
    schema.market_context.market_avg_home_price = input.market_avg_home_price;
    schema.market_context.market_avg_rent = input.market_avg_rent;
    schema.market_context.market_avg_sqft = input.market_avg_sqft;
    schema.market_context.market_avg_bedrooms = input.market_avg_bedrooms;
    schema.market_context.market_property_tax_rate = input.market_property_tax_rate;
    schema.market_context.market_insurance_rate = input.market_insurance_rate;
    schema.market_context.market_hoa_typical_monthly = input.market_hoa_typical_monthly;
    schema.market_context.inventory_pressure = inferInventoryPressure(input.market_avg_home_price, input.target_home_price);
    schema.market_context.market_fit_band = inferMarketFitBand(input.target_home_price, input.market_avg_home_price);

    //#9.8 credit
    schema.credit_profile.credit_score = input.credit_score;
    schema.credit_profile.credit_band = creditBand(input.credit_score);
    schema.credit_profile.apr_estimate = aprFromScore(input.credit_score);
    schema.credit_profile.financing_strength = inferFinancingStrength(input.credit_score);
    schema.credit_profile.pmi_expected = pmiExpected(input.credit_score, schema.housing_goal.downpayment_percent);
    schema.credit_profile.credit_improvement_potential = inferCreditImprovementPotential(input.credit_score);

    //#9.9 timeline
    schema.timeline_profile.time_to_buy = input.time_to_buy || "unknown";
    schema.timeline_profile.timeline_months = input.timeline_months || mapTimeToMonths(input.time_to_buy);
    schema.timeline_profile.urgency_level = inferUrgencyLevel(schema.timeline_profile.time_to_buy);
    schema.timeline_profile.purchase_readiness_stage = inferPurchaseReadinessStage(schema);

    //#9.10 derived metrics
    schema.derived_metrics = buildDerivedMetrics(schema);

    //#9.11 behavior profile
    schema.behavior_profile = buildBehaviorProfile(schema);

    //#9.12 fit analysis
    schema.fit_analysis = buildFitAnalysis(schema);

    //#9.13 findings
    schema.findings = buildFindings(schema);

    //#9.14 scores
    schema.scores = buildScores(schema);

    //#9.15 scenarios
    schema.scenario_options = buildScenarioOptions(schema);

    //#9.16 verdict
    schema.verdict = buildVerdict(schema);

    //#9.17 AI payload
    schema.ai_brief_payload = buildAiBriefPayload(schema);

    return schema;
  };

  //#10) FAMILY STRUCTURE
  function buildFamilyStructure(household) {
    const parts = [];
    if (household.spouse_present) parts.push("spouse");
    if (household.children_count > 0) parts.push(`${household.children_count}_children`);
    if (!parts.length) return "individual";
    return parts.join("_plus_");
  }

  //#11) CONFIDENCE + INFERENCE HELPERS
  function inferIncomeConfidence(incomeProfile) {
    if (incomeProfile.stable_monthly_total >= 2000) return "high";
    if (incomeProfile.stable_monthly_total > 0) return "medium";
    return "low";
  }

  function inferExpenseConfidence(expenseProfile) {
    if (expenseProfile.monthly_expenses_total > 0) return "high";
    return "low";
  }

  function inferExpenseCaptureMethod(input, expenseBucketsTotal) {
    if (expenseBucketsTotal > 0 && input.monthly_expenses_total > 0) return "mixed";
    if (expenseBucketsTotal > 0) return "user_input";
    if (input.monthly_expenses_total > 0) return "user_input";
    return "unknown";
  }

  function inferDebtCaptureComplete(debtProfile) {
    const bucketTotal = n0(debtProfile.auto_loan) +
      n0(debtProfile.credit_cards) +
      n0(debtProfile.student_loans) +
      n0(debtProfile.personal_loans) +
      n0(debtProfile.other_debt);

    if (bucketTotal > 0) return true;
    if (debtProfile.monthly_debt_total > 0) return false;
    return false;
  }

  function inferDebtConfidence(debtProfile) {
    if (debtProfile.debt_capture_complete) return "high";
    if (debtProfile.monthly_debt_total > 0) return "medium";
    return "low";
  }

  function inferAspirationLevel(schema) {
    const price = n0(schema.housing_goal.target_home_price);
    const avg = n0(schema.market_context.market_avg_home_price);
    const beds = n0(schema.housing_goal.target_bedrooms);
    const hh = n0(schema.household.household_size);

    if ((avg > 0 && price > avg * 1.2) || (hh > 0 && beds >= hh + 2)) return "luxury";
    if ((avg > 0 && price > avg * 1.05) || (hh > 0 && beds > hh)) return "stretch";
    return "practical";
  }

  function inferHousingConfidence(housingGoal) {
    if (housingGoal.target_home_price > 0 && housingGoal.target_bedrooms > 0) return "high";
    if (housingGoal.target_home_price > 0) return "medium";
    return "low";
  }

  function inferInventoryPressure(avgPrice, targetPrice) {
    if (n0(avgPrice) <= 0 || n0(targetPrice) <= 0) return "medium";
    if (targetPrice > avgPrice * 1.15) return "high";
    if (targetPrice < avgPrice * 0.90) return "low";
    return "medium";
  }

  function inferMarketFitBand(targetPrice, avgPrice) {
    if (n0(avgPrice) <= 0 || n0(targetPrice) <= 0) return "at_market";
    if (targetPrice < avgPrice * 0.90) return "below_market";
    if (targetPrice > avgPrice * 1.10) return "above_market";
    return "at_market";
  }

  function inferFinancingStrength(score) {
    const s = n0(score);
    if (s >= 740) return "strong";
    if (s >= 680) return "moderate";
    return "weak";
  }

  function inferCreditImprovementPotential(score) {
    const s = n0(score);
    if (s < 680) return "high";
    if (s < 740) return "medium";
    return "low";
  }

  function mapTimeToMonths(timeToBuy) {
    const t = lower(timeToBuy);
    if (!t) return 6;
    if (t.includes("now")) return 1;
    if (t.includes("3")) return 3;
    if (t.includes("6")) return 6;
    if (t.includes("12")) return 12;
    return 6;
  }

  function inferUrgencyLevel(timeToBuy) {
    const t = lower(timeToBuy);
    if (t.includes("now") || t.includes("immediate")) return "high";
    if (t.includes("3")) return "medium";
    return "low";
  }

  function inferMobilityRisk(timeToBuy, yos) {
    const months = mapTimeToMonths(timeToBuy);
    if (months <= 6 && n0(yos) < 10) return "high";
    if (months <= 12) return "medium";
    return "low";
  }

  function inferPcsWindow(timeToBuy) {
    return mapTimeToMonths(timeToBuy);
  }

  function inferPurchaseReadinessStage(schema) {
    const freeCash = n0(schema.derived_metrics.monthly_free_cash_flow);
    const downPct = n0(schema.housing_goal.downpayment_percent);
    const credit = n0(schema.credit_profile.credit_score);

    if (freeCash > 750 && downPct >= 5 && credit >= 700) return "ready";
    if (freeCash > 250 && credit >= 680) return "near_ready";
    if (freeCash >= 0) return "preparing";
    return "not_ready";
  }

  //#12) DERIVED METRICS
  function buildDerivedMetrics(schema) {
    const stableIncome = n0(schema.income_profile.stable_monthly_total);
    const expenses = n0(schema.expense_profile.monthly_expenses_total);
    const debt = n0(schema.debt_profile.monthly_debt_total);
    const price = n0(schema.housing_goal.target_home_price);
    const down = n0(schema.housing_goal.downpayment_amount);

    const monthlyHousingAllIn = estimateHousingAllIn({
      price,
      downpayment_amount: down,
      credit_score: schema.credit_profile.credit_score,
      apr_estimate: schema.credit_profile.apr_estimate,
      market_property_tax_rate: schema.market_context.market_property_tax_rate,
      market_insurance_rate: schema.market_context.market_insurance_rate,
      market_hoa_typical_monthly: schema.market_context.market_hoa_typical_monthly,
      term_years: 30
    });

    const monthlyResidualAfterExpenses = round2(stableIncome - expenses - debt);
    const monthlyResidualAfterHousing = round2(stableIncome - monthlyHousingAllIn);
    const monthlyFreeCashFlow = round2(stableIncome - expenses - debt - monthlyHousingAllIn);

    const discretionary = round2(
      n0(schema.expense_profile.entertainment) +
      n0(schema.expense_profile.subscriptions) +
      n0(schema.expense_profile.shopping)
    );

    const closingBufferMonths = monthlyHousingAllIn > 0
      ? round2(down / monthlyHousingAllIn)
      : 0;

    const householdSize = Math.max(1, n0(schema.household.household_size));
    const familyBedroomRatio = round2(n0(schema.housing_goal.target_bedrooms) / householdSize);
    const garageExcess = n0(schema.housing_goal.garage_spaces) >= 3 && householdSize <= 4;

    const avgHome = n0(schema.market_context.market_avg_home_price);
    const aspirationGapDollars = avgHome > 0 ? round2(price - avgHome) : 0;
    const aspirationGapPercent = avgHome > 0 ? round2((price - avgHome) / avgHome) : 0;

    let homeSizeEfficiencyScore = 85;
    if (familyBedroomRatio > 1.25) homeSizeEfficiencyScore -= 20;
    if (familyBedroomRatio > 1.5) homeSizeEfficiencyScore -= 20;
    if (garageExcess) homeSizeEfficiencyScore -= 10;
    if (n0(schema.housing_goal.target_sqft) > 0 && householdSize <= 4 && n0(schema.housing_goal.target_sqft) > 2600) {
      homeSizeEfficiencyScore -= 15;
    }
    homeSizeEfficiencyScore = clamp(homeSizeEfficiencyScore, 0, 100);

    return {
      stable_income_monthly: round2(stableIncome),
      monthly_housing_payment_estimate: round2(monthlyHousingAllIn),
      monthly_housing_all_in: round2(monthlyHousingAllIn),
      monthly_total_obligations: round2(expenses + debt + monthlyHousingAllIn),
      monthly_residual_after_expenses: round2(monthlyResidualAfterExpenses),
      monthly_residual_after_housing: round2(monthlyResidualAfterHousing),
      monthly_free_cash_flow: round2(monthlyFreeCashFlow),
      housing_ratio: round2(pct(monthlyHousingAllIn, stableIncome)),
      debt_ratio: round2(pct(debt, stableIncome)),
      expense_ratio: round2(pct(expenses, stableIncome)),
      discretionary_ratio: round2(pct(discretionary, stableIncome)),
      savings_ratio: round2(pct(down, stableIncome)),
      downpayment_ratio: round2(pct(down, price)),
      closing_buffer_months: round2(closingBufferMonths),
      family_bedroom_ratio: round2(familyBedroomRatio),
      garage_excess_flag: garageExcess,
      home_size_efficiency_score: homeSizeEfficiencyScore,
      aspiration_gap_dollars: round2(aspirationGapDollars),
      aspiration_gap_percent: round2(aspirationGapPercent)
    };
  }

  //#13) BEHAVIOR PROFILE
  function buildBehaviorProfile(schema) {
    const expenses = n0(schema.expense_profile.monthly_expenses_total);
    const entertainment = n0(schema.expense_profile.entertainment);
    const subscriptions = n0(schema.expense_profile.subscriptions);
    const shopping = n0(schema.expense_profile.shopping);

    const discretionary = entertainment + subscriptions + shopping;
    const fixed = Math.max(0, expenses - discretionary);

    const flags = [];
    const cuts = [];

    const entertainmentShare = pct(entertainment, expenses);
    const discretionaryShare = pct(discretionary, expenses);

    if (entertainmentShare >= 0.20) flags.push("high_entertainment_spend");
    if (discretionaryShare >= 0.30) flags.push("high_discretionary_spend");
    if (discretionary > 0 && schema.derived_metrics.monthly_free_cash_flow < 250) {
      flags.push("discretionary_spend_is_reducing_readiness");
    }

    if (entertainment >= 300) {
      const suggestedReduction = entertainment >= 1000 ? 500 : Math.min(250, entertainment * 0.35);
      cuts.push({
        category: "Entertainment",
        current_monthly: round2(entertainment),
        suggested_reduction: round2(suggestedReduction),
        new_monthly: round2(Math.max(0, entertainment - suggestedReduction)),
        monthly_impact: round2(suggestedReduction)
      });
    }

    if (shopping >= 250) {
      const suggestedReduction = Math.min(200, shopping * 0.30);
      cuts.push({
        category: "Shopping",
        current_monthly: round2(shopping),
        suggested_reduction: round2(suggestedReduction),
        new_monthly: round2(Math.max(0, shopping - suggestedReduction)),
        monthly_impact: round2(suggestedReduction)
      });
    }

    return {
      entertainment_spend_monthly: round2(entertainment),
      entertainment_share_of_expenses: round2(entertainmentShare),
      discretionary_spend_total: round2(discretionary),
      discretionary_share_of_expenses: round2(discretionaryShare),
      fixed_spend_total: round2(fixed),
      fixed_share_of_expenses: round2(pct(fixed, expenses)),
      behavior_flags: flags,
      cutback_opportunities: cuts
    };
  }

  //#14) FIT ANALYSIS
  function buildFitAnalysis(schema) {
    return {
      family_fit: analyzeFamilyFit(schema),
      budget_fit: analyzeBudgetFit(schema),
      debt_fit: analyzeDebtFit(schema),
      behavior_fit: analyzeBehaviorFit(schema),
      timeline_fit: analyzeTimelineFit(schema),
      market_fit: analyzeMarketFit(schema)
    };
  }

  function analyzeFamilyFit(schema) {
    const hh = n0(schema.household.household_size);
    const beds = n0(schema.housing_goal.target_bedrooms);
    const sqft = n0(schema.housing_goal.target_sqft);
    const garage = n0(schema.housing_goal.garage_spaces);

    let status = "reasonable";
    let score = 82;
    let reason = "Home profile appears broadly aligned with household size.";

    if (hh <= 4 && beds >= 5) {
      status = "oversized";
      score = 55;
      reason = "Requested bedroom count appears above likely functional need for this household.";
    }

    if (hh <= 4 && sqft > 2600) {
      status = "oversized";
      score = Math.min(score, 52);
      reason = "Requested square footage appears larger than necessary for the current family profile.";
    }

    if (garage >= 3 && hh <= 4) {
      score -= 8;
      reason = reason + " Garage capacity also appears above likely need.";
    }

    score = clamp(score, 0, 100);
    return { status, score, reason };
  }

  function analyzeBudgetFit(schema) {
    const housingRatio = n0(schema.derived_metrics.housing_ratio);
    const freeCash = n0(schema.derived_metrics.monthly_free_cash_flow);

    let status = "safe";
    let score = 90;
    let reason = "Housing target is operating inside a healthy affordability band.";

    if (housingRatio > 0.38 || freeCash < 0) {
      status = "unsafe";
      score = 25;
      reason = "Housing target is above a safe affordability threshold or produces negative monthly free cash flow.";
    } else if (housingRatio > 0.33 || freeCash < 250) {
      status = "tight";
      score = 48;
      reason = "Housing target is possible, but leaves very limited monthly breathing room.";
    } else if (housingRatio > 0.28 || freeCash < 600) {
      status = "stretch";
      score = 68;
      reason = "Housing target is workable, but is closer to a stretch than a fully comfortable buy.";
    }

    return { status, score, reason };
  }

  function analyzeDebtFit(schema) {
    const debtRatio = n0(schema.derived_metrics.debt_ratio);
    const debt = n0(schema.debt_profile.monthly_debt_total);

    let status = "manageable";
    let score = 78;
    let reason = "Debt load appears manageable relative to monthly income.";

    if (debtRatio >= 0.25 || debt >= 2500) {
      status = "constraining";
      score = 38;
      reason = "Debt load is materially reducing flexibility and constraining what can be safely purchased.";
    } else if (debtRatio >= 0.15 || debt >= 1200) {
      status = "heavy";
      score = 58;
      reason = "Debt load is meaningful and should influence target home price discipline.";
    } else if (debtRatio >= 0.08) {
      status = "manageable";
      score = 72;
      reason = "Debt is manageable but should still be incorporated conservatively.";
    } else {
      status = "clean";
      score = 90;
      reason = "Debt profile is relatively light compared with income.";
    }

    return { status, score, reason };
  }

  function analyzeBehaviorFit(schema) {
    const discShare = n0(schema.behavior_profile.discretionary_share_of_expenses);
    const entShare = n0(schema.behavior_profile.entertainment_share_of_expenses);

    let status = "mixed";
    let score = 72;
    let reason = "Spending behavior is acceptable, but there may be room for improvement.";

    if (discShare >= 0.35 || entShare >= 0.25) {
      status = "risky";
      score = 35;
      reason = "Discretionary spending is unusually high and is weakening housing readiness.";
    } else if (discShare >= 0.25 || entShare >= 0.18) {
      status = "leaky";
      score = 52;
      reason = "Spending profile suggests meaningful leakage in discretionary categories.";
    } else if (discShare <= 0.12) {
      status = "disciplined";
      score = 88;
      reason = "Spending behavior appears disciplined and supportive of long-term affordability.";
    }

    return { status, score, reason };
  }

  function analyzeTimelineFit(schema) {
    const stage = schema.timeline_profile.purchase_readiness_stage;

    if (stage === "ready") {
      return { status: "ready", score: 90, reason: "Current profile appears operationally ready for purchase." };
    }
    if (stage === "near_ready") {
      return { status: "near_ready", score: 72, reason: "Current profile is close, but a few improvements would strengthen the position." };
    }
    if (stage === "preparing") {
      return { status: "premature", score: 50, reason: "Profile needs more preparation before purchase should be treated as fully safe." };
    }
    return { status: "unclear", score: 30, reason: "Current profile does not yet support a strong purchase-readiness conclusion." };
  }

  function analyzeMarketFit(schema) {
    const gapPct = n0(schema.derived_metrics.aspiration_gap_percent);

    if (gapPct > 0.15) {
      return { status: "misaligned", score: 42, reason: "Requested home price is meaningfully above the market baseline." };
    }
    if (gapPct > 0.05) {
      return { status: "borderline", score: 62, reason: "Requested home price is somewhat above the market baseline." };
    }
    return { status: "aligned", score: 84, reason: "Requested home price is reasonably aligned with the local market band." };
  }

  //#15) FINDINGS
  function buildFindings(schema) {
    const findings = [];

    function pushFinding(code, severity, category, title, detail, impact, actionability) {
      findings.push({
        code,
        severity,
        category,
        title,
        detail,
        impact,
        actionability
      });
    }

    const hh = n0(schema.household.household_size);
    const beds = n0(schema.housing_goal.target_bedrooms);
    const garage = n0(schema.housing_goal.garage_spaces);
    const sqft = n0(schema.housing_goal.target_sqft);
    const freeCash = n0(schema.derived_metrics.monthly_free_cash_flow);
    const housingRatio = n0(schema.derived_metrics.housing_ratio);
    const entertainment = n0(schema.expense_profile.entertainment);
    const entertainmentShare = n0(schema.behavior_profile.entertainment_share_of_expenses);
    const debt = n0(schema.debt_profile.monthly_debt_total);

    if (hh <= 4 && beds >= 5) {
      pushFinding(
        "HOUSE_OVERSIZED_FOR_FAMILY",
        "medium",
        "fit",
        "Requested home appears larger than household need",
        "A 5-bedroom target for this household may reflect aspiration more than functional necessity.",
        "Higher price, taxes, insurance, and maintenance than needed.",
        "high"
      );
    }

    if (garage >= 3 && hh <= 4) {
      pushFinding(
        "GARAGE_CAPACITY_ABOVE_LIKELY_NEED",
        "low",
        "fit",
        "Garage size appears above likely need",
        "A 3-car garage may be increasing cost without providing proportional household value.",
        "Can raise monthly payment and reduce affordability efficiency.",
        "medium"
      );
    }

    if (sqft > 2600 && hh <= 4) {
      pushFinding(
        "HOME_SIZE_EFFICIENCY_WARNING",
        "medium",
        "fit",
        "Target square footage may be inefficient",
        "Requested home size appears meaningfully above a likely efficient range for this household.",
        "Larger home means higher all-in ownership cost and maintenance burden.",
        "medium"
      );
    }

    if (debt >= 2500) {
      pushFinding(
        "HEAVY_MONTHLY_DEBT_LOAD",
        "high",
        "debt",
        "Debt load is constraining flexibility",
        "Current non-housing debt is high enough to materially affect a safe purchase target.",
        "Limits free cash flow and increases purchase risk.",
        "high"
      );
    }

    if (entertainment >= 500 || entertainmentShare >= 0.20) {
      pushFinding(
        "HIGH_ENTERTAINMENT_SPEND",
        "high",
        "behavior",
        "Entertainment spending is weakening affordability",
        "Entertainment appears to be taking an unusually large share of monthly expenses.",
        "Reducing this category could improve housing readiness quickly.",
        "high"
      );
    }

    if (housingRatio > 0.33) {
      pushFinding(
        "HOUSING_RATIO_ABOVE_PREFERRED_BAND",
        "high",
        "affordability",
        "Target housing cost is above the preferred range",
        "Projected housing payment is above a disciplined affordability band.",
        "Increases stress and reduces monthly resilience.",
        "high"
      );
    }

    if (freeCash < 0) {
      pushFinding(
        "NEGATIVE_FREE_CASH_FLOW",
        "high",
        "affordability",
        "Current scenario produces negative monthly free cash flow",
        "After expenses, debt, and housing, the monthly profile goes negative.",
        "This is a direct no-go condition unless inputs change.",
        "high"
      );
    } else if (freeCash < 250) {
      pushFinding(
        "THIN_MONTHLY_BUFFER",
        "medium",
        "resilience",
        "Monthly buffer is too thin",
        "Remaining monthly free cash flow is positive, but very limited.",
        "Small surprises could destabilize the budget.",
        "high"
      );
    }

    return findings;
  }

  //#16) SCORES
  function buildScores(schema) {
    const affordability = scoreAffordability(schema);
    const resilience = scoreResilience(schema);
    const fit = scoreFit(schema);
    const behavior = scoreBehavior(schema);
    const readiness = scoreReadiness(schema);

    const overall = round2(
      affordability * 0.30 +
      resilience * 0.25 +
      fit * 0.15 +
      behavior * 0.15 +
      readiness * 0.15
    );

    return {
      affordability_score: round2(affordability),
      resilience_score: round2(resilience),
      fit_score: round2(fit),
      behavior_score: round2(behavior),
      readiness_score: round2(readiness),
      overall_score: round2(overall),
      grade: scoreToGrade(overall),
      confidence_level: inferOverallConfidence(schema)
    };
  }

  function scoreAffordability(schema) {
    const ratio = n0(schema.derived_metrics.housing_ratio);
    const freeCash = n0(schema.derived_metrics.monthly_free_cash_flow);

    if (freeCash < 0 || ratio > 0.40) return 20;
    if (ratio > 0.35) return 40;
    if (ratio > 0.30) return 60;
    if (ratio > 0.28) return 75;
    return 90;
  }

  function scoreResilience(schema) {
    const freeCash = n0(schema.derived_metrics.monthly_free_cash_flow);
    const bufferMonths = n0(schema.derived_metrics.closing_buffer_months);

    let score = 40;
    if (freeCash >= 1000) score = 90;
    else if (freeCash >= 600) score = 78;
    else if (freeCash >= 250) score = 62;
    else if (freeCash >= 0) score = 45;
    else score = 20;

    if (bufferMonths >= 6) score += 8;
    else if (bufferMonths < 2) score -= 8;

    return clamp(score, 0, 100);
  }

  function scoreFit(schema) {
    const a = n0(schema.fit_analysis.family_fit.score);
    const b = n0(schema.fit_analysis.market_fit.score);
    return round2((a + b) / 2);
  }

  function scoreBehavior(schema) {
    return n0(schema.fit_analysis.behavior_fit.score);
  }

  function scoreReadiness(schema) {
    const t = n0(schema.fit_analysis.timeline_fit.score);
    const d = n0(schema.fit_analysis.debt_fit.score);
    return round2((t + d) / 2);
  }

  function scoreToGrade(score) {
    const s = n0(score);
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

  function inferOverallConfidence(schema) {
    const income = schema.income_profile.income_confidence;
    const expense = schema.expense_profile.expense_confidence;
    const debt = schema.debt_profile.debt_confidence;

    if (income === "high" && expense === "high" && debt === "high") return "high";
    if (income !== "low" && expense !== "low") return "medium";
    return "low";
  }

  //#17) SCENARIOS
  function buildScenarioOptions(schema) {
    const scenarios = [];

    const currentPrice = n0(schema.housing_goal.target_home_price);
    const currentDebt = n0(schema.debt_profile.monthly_debt_total);
    const currentExpenses = n0(schema.expense_profile.monthly_expenses_total);
    const currentEntertainment = n0(schema.expense_profile.entertainment);
    const stableIncome = n0(schema.income_profile.stable_monthly_total);

    const currentHousing = n0(schema.derived_metrics.monthly_housing_all_in);
    const currentFreeCash = n0(schema.derived_metrics.monthly_free_cash_flow);

    scenarios.push({
      name: "Current Target",
      target_home_price: round2(currentPrice),
      monthly_housing_all_in: round2(currentHousing),
      monthly_free_cash_flow: round2(currentFreeCash),
      verdict: scenarioVerdict(currentFreeCash)
    });

    if (currentEntertainment >= 300) {
      const reduction = currentEntertainment >= 1000 ? 500 : Math.min(250, currentEntertainment * 0.35);
      const newFreeCash = currentFreeCash + reduction;

      scenarios.push({
        name: `Reduce Entertainment by ${Math.round(reduction)}`,
        target_home_price: round2(currentPrice),
        monthly_housing_all_in: round2(currentHousing),
        monthly_free_cash_flow: round2(newFreeCash),
        verdict: scenarioVerdict(newFreeCash)
      });
    }

    if (currentPrice > 0) {
      const lowerPrice = Math.max(0, currentPrice - 30000);
      const lowerHousing = estimateHousingAllIn({
        price: lowerPrice,
        downpayment_amount: n0(schema.housing_goal.downpayment_amount),
        credit_score: schema.credit_profile.credit_score,
        apr_estimate: schema.credit_profile.apr_estimate,
        market_property_tax_rate: schema.market_context.market_property_tax_rate,
        market_insurance_rate: schema.market_context.market_insurance_rate,
        market_hoa_typical_monthly: schema.market_context.market_hoa_typical_monthly,
        term_years: 30
      });

      const newFreeCash = stableIncome - currentExpenses - currentDebt - lowerHousing;

      scenarios.push({
        name: "Lower Home Price by 30000",
        target_home_price: round2(lowerPrice),
        monthly_housing_all_in: round2(lowerHousing),
        monthly_free_cash_flow: round2(newFreeCash),
        verdict: scenarioVerdict(newFreeCash)
      });
    }

    return scenarios;
  }

  function scenarioVerdict(freeCash) {
    const fc = n0(freeCash);
    if (fc < 0) return "unsafe";
    if (fc < 250) return "tight";
    if (fc < 750) return "improved";
    return "safer";
  }

  //#18) VERDICT
  function buildVerdict(schema) {
    const overall = n0(schema.scores.overall_score);
    const freeCash = n0(schema.derived_metrics.monthly_free_cash_flow);
    const housingRatio = n0(schema.derived_metrics.housing_ratio);
    const topFindings = schema.findings.slice(0, 3).map((f) => f.title);

    let status = "CAUTION";
    let headline = "";
    let primaryReason = "";
    let bestNextAction = "";
    let analystStance = "delay_and_prepare";

    if (freeCash < 0 || housingRatio > 0.38) {
      status = "NO_GO";
      headline = "This target is not financially safe in its current form.";
      primaryReason = "The current scenario produces either excessive housing stress or negative monthly free cash flow.";
      bestNextAction = "Lower the target home price and reduce discretionary spending before moving forward.";
      analystStance = "do_not_buy_yet";
    } else if (overall >= 80 && freeCash >= 600 && housingRatio <= 0.30) {
      status = "GREEN";
      headline = "You are in a workable buying range, but discipline still matters.";
      primaryReason = "Income, debt, and housing costs are reasonably aligned for forward movement.";
      bestNextAction = "Stay inside the efficient range and avoid paying up for wants that do not materially improve fit.";
      analystStance = "disciplined_buy";
    } else {
      status = "CAUTION";
      headline = "You may be able to buy, but this scenario needs tighter discipline.";
      primaryReason = "The profile is close enough to move forward, but current fit, spending, or debt structure is limiting safety.";
      bestNextAction = "Tighten discretionary spending and/or reduce the target home profile before proceeding.";
      analystStance = "stretch_buy";
    }

    return {
      status,
      headline,
      primary_reason: primaryReason,
      top_reasons: topFindings,
      best_next_action: bestNextAction,
      analyst_stance: analystStance
    };
  }

  //#19) AI PAYLOAD
  function buildAiBriefPayload(schema) {
    return {
      bluf_inputs: {
        status: schema.verdict.status,
        overall_score: schema.scores.overall_score,
        grade: schema.scores.grade
      },
      profile_summary: {
        rank: schema.household.rank_paygrade || schema.household.rank,
        years_of_service: schema.household.years_of_service,
        household_size: schema.household.household_size,
        base: schema.household.base
      },
      financial_summary: {
        stable_income_monthly: schema.income_profile.stable_monthly_total,
        monthly_expenses_total: schema.expense_profile.monthly_expenses_total,
        monthly_debt_total: schema.debt_profile.monthly_debt_total,
        monthly_housing_all_in: schema.derived_metrics.monthly_housing_all_in,
        monthly_free_cash_flow: schema.derived_metrics.monthly_free_cash_flow
      },
      housing_summary: {
        target_home_price: schema.housing_goal.target_home_price,
        target_bedrooms: schema.housing_goal.target_bedrooms,
        garage_spaces: schema.housing_goal.garage_spaces
      },
      top_findings: schema.findings.slice(0, 5).map((f) => f.title),
      scenario_options: schema.scenario_options.map((s) => s.name),
      tone_target: "professional_real_financial_analyst"
    };
  }

  //#20) OPTIONAL STORAGE HELPERS
  SchemaX.saveToStorage = function saveToStorage(schema, key) {
    const k = str(key || "pcsunited.brain_schema_x.v1");
    try {
      localStorage.setItem(k, JSON.stringify(schema));
      return true;
    } catch (_) {
      return false;
    }
  };

  SchemaX.loadFromStorage = function loadFromStorage(key) {
    const k = str(key || "pcsunited.brain_schema_x.v1");
    try {
      const raw = localStorage.getItem(k);
      return raw ? JSON.parse(raw) : null;
    } catch (_) {
      return null;
    }
  };

  //#21) OPTIONAL EXPLAIN SUMMARY
  SchemaX.toSummary = function toSummary(schema) {
    if (!schema || typeof schema !== "object") return null;

    return {
      status: schema.verdict.status,
      headline: schema.verdict.headline,
      overall_score: schema.scores.overall_score,
      grade: schema.scores.grade,
      monthly_free_cash_flow: schema.derived_metrics.monthly_free_cash_flow,
      housing_ratio: schema.derived_metrics.housing_ratio,
      debt_ratio: schema.derived_metrics.debt_ratio,
      top_findings: schema.findings.slice(0, 3)
    };
  };

  //#22) EXPOSE
  global.BrainSchemaX = SchemaX;

})(typeof window !== "undefined" ? window : globalThis);
