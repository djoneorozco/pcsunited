{
  "schema_name": "Brain Schema X",
  "schema_version": "1.0.0",
  "generated_at": "ISO_TIMESTAMP",
  "source": {
    "product": "PCSUnited",
    "module": "Affordability Zone & Strategy",
    "engine_mode": "deterministic_plus_ai",
    "environment": "webflow_or_netlify"
  },
  "identity": {
    "profile_id": null,
    "email": "",
    "first_name": "",
    "last_name": "",
    "full_name": "",
    "mode": "",
    "created_at": null
  },
  "household": {
    "rank": "",
    "rank_paygrade": "",
    "service_branch": "",
    "years_of_service": 0,
    "base": "",
    "city_key": "",
    "marital_status": "",
    "spouse_present": false,
    "dependents_total": 0,
    "children_count": 0,
    "household_size": 1,
    "family_structure": "",
    "va_disability_percent": 0,
    "mobility_risk": "medium",
    "pcs_expected_window_months": 12
  },
  "income_profile": {
    "base_pay_monthly": 0,
    "bah_monthly": 0,
    "bas_monthly": 0,
    "va_disability_monthly": 0,
    "spouse_income_monthly": 0,
    "other_income_monthly": 0,
    "gross_monthly_total": 0,
    "stable_monthly_total": 0,
    "income_confidence": "low",
    "income_source_breakdown": {
      "military": 0,
      "allowances": 0,
      "disability": 0,
      "spouse": 0,
      "other": 0
    }
  },
  "expense_profile": {
    "monthly_expenses_total": 0,
    "utilities": 0,
    "transportation": 0,
    "food": 0,
    "health": 0,
    "insurance_non_housing": 0,
    "childcare": 0,
    "entertainment": 0,
    "subscriptions": 0,
    "shopping": 0,
    "other": 0,
    "expense_confidence": "low",
    "expense_capture_method": "unknown"
  },
  "debt_profile": {
    "monthly_debt_total": 0,
    "auto_loan": 0,
    "credit_cards": 0,
    "student_loans": 0,
    "personal_loans": 0,
    "other_debt": 0,
    "debt_capture_complete": false,
    "debt_confidence": "low",
    "debt_mix": {
      "installment_total": 0,
      "revolving_total": 0,
      "discretionary_like_total": 0
    }
  },
  "housing_goal": {
    "target_home_price": 0,
    "downpayment_amount": 0,
    "downpayment_percent": 0,
    "target_bedrooms": 0,
    "target_bathrooms": 0,
    "target_sqft": 0,
    "garage_spaces": 0,
    "property_type": "",
    "home_condition": "",
    "amenities": [],
    "must_have_count": 0,
    "aspiration_level": "practical",
    "housing_goal_confidence": "low"
  },
  "market_context": {
    "city_key": "",
    "market_avg_home_price": 0,
    "market_avg_rent": 0,
    "market_avg_sqft": 0,
    "market_avg_bedrooms": 0,
    "market_property_tax_rate": 0,
    "market_insurance_rate": 0,
    "market_hoa_typical_monthly": 0,
    "inventory_pressure": "medium",
    "market_fit_band": "at_market"
  },
  "credit_profile": {
    "credit_score": 720,
    "credit_band": "good",
    "apr_estimate": 0,
    "financing_strength": "moderate",
    "pmi_expected": true,
    "credit_improvement_potential": "medium"
  },
  "timeline_profile": {
    "time_to_buy": "unknown",
    "urgency_level": "medium",
    "timeline_months": 6,
    "purchase_readiness_stage": "preparing"
  },
  "behavior_profile": {
    "entertainment_spend_monthly": 0,
    "entertainment_share_of_expenses": 0,
    "discretionary_spend_total": 0,
    "discretionary_share_of_expenses": 0,
    "fixed_spend_total": 0,
    "fixed_share_of_expenses": 0,
    "behavior_flags": [],
    "cutback_opportunities": []
  },
  "derived_metrics": {
    "stable_income_monthly": 0,
    "monthly_housing_payment_estimate": 0,
    "monthly_housing_all_in": 0,
    "monthly_total_obligations": 0,
    "monthly_residual_after_expenses": 0,
    "monthly_residual_after_housing": 0,
    "monthly_free_cash_flow": 0,
    "housing_ratio": 0,
    "debt_ratio": 0,
    "expense_ratio": 0,
    "discretionary_ratio": 0,
    "savings_ratio": 0,
    "downpayment_ratio": 0,
    "closing_buffer_months": 0,
    "family_bedroom_ratio": 0,
    "garage_excess_flag": false,
    "home_size_efficiency_score": 0,
    "aspiration_gap_dollars": 0,
    "aspiration_gap_percent": 0
  },
  "fit_analysis": {
    "family_fit": {
      "status": "reasonable",
      "score": 0,
      "reason": ""
    },
    "budget_fit": {
      "status": "safe",
      "score": 0,
      "reason": ""
    },
    "debt_fit": {
      "status": "manageable",
      "score": 0,
      "reason": ""
    },
    "behavior_fit": {
      "status": "mixed",
      "score": 0,
      "reason": ""
    },
    "timeline_fit": {
      "status": "near_ready",
      "score": 0,
      "reason": ""
    },
    "market_fit": {
      "status": "aligned",
      "score": 0,
      "reason": ""
    }
  },
  "findings": [],
  "scores": {
    "affordability_score": 0,
    "resilience_score": 0,
    "fit_score": 0,
    "behavior_score": 0,
    "readiness_score": 0,
    "overall_score": 0,
    "grade": "F",
    "confidence_level": "low"
  },
  "scenario_options": [],
  "verdict": {
    "status": "CAUTION",
    "headline": "",
    "primary_reason": "",
    "top_reasons": [],
    "best_next_action": "",
    "analyst_stance": "delay_and_prepare"
  },
  "ai_brief_payload": {
    "bluf_inputs": {
      "status": "CAUTION",
      "overall_score": 0,
      "grade": "F"
    },
    "profile_summary": {
      "rank": "",
      "years_of_service": 0,
      "household_size": 1,
      "base": ""
    },
    "financial_summary": {
      "stable_income_monthly": 0,
      "monthly_expenses_total": 0,
      "monthly_debt_total": 0,
      "monthly_housing_all_in": 0,
      "monthly_free_cash_flow": 0
    },
    "housing_summary": {
      "target_home_price": 0,
      "target_bedrooms": 0,
      "garage_spaces": 0
    },
    "top_findings": [],
    "scenario_options": [],
    "tone_target": "professional_real_financial_analyst"
  }
}
