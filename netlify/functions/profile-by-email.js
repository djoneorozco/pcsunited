// netlify/functions/profile-by-email.js
// ============================================================
// PCSUnited • profile-by-email
// - POST { email }
// - Returns a MERGED profile object from:
//    1) public.profiles
//    2) public.user_financial_inputs   (latest by updated_at)
//    3) public.financial_intakes       (first matching row fallback)
//    4) public.user_aiou_inputs        (latest by updated_at)
// - CORS + OPTIONS support
//
// WHY THIS VERSION EXISTS
// - Your old version only queried `profiles`
// - That meant the User page never received saved financial inputs
// - This version merges the latest known financial + preference data
//
// IMPORTANT
// - If income / debt are NOT stored in Supabase, this function cannot invent them
// - FAD income still should come from /api/brain -> brain.pay.total
// ============================================================

const { createClient } = require("@supabase/supabase-js");

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
  "Vary": "Origin",
  "Content-Type": "application/json"
};

function respond(statusCode, payload) {
  return {
    statusCode,
    headers: CORS_HEADERS,
    body: JSON.stringify(payload || {})
  };
}

function firstRow(data) {
  return Array.isArray(data) && data.length ? data[0] : null;
}

function cleanString(v) {
  return v === undefined || v === null ? "" : String(v).trim();
}

function toNumberOrNull(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function mergeProfile({
  profileRow,
  userFinancialRow,
  financialIntakeRow,
  aiouRow
}) {
  const p = profileRow || {};
  const uf = userFinancialRow || {};
  const fi = financialIntakeRow || {};
  const ai = aiouRow || {};

  // ------------------------------------------------------------
  // 1) Base identity/service fields from profiles
  // ------------------------------------------------------------
  const merged = {
    ...p
  };

  // Canonical basics
  merged.email = cleanString(p.email || "");
  merged.first_name = cleanString(p.first_name || "");
  merged.last_name = cleanString(p.last_name || "");
  merged.full_name =
    cleanString(p.full_name || "") ||
    [cleanString(p.first_name), cleanString(p.last_name)].filter(Boolean).join(" ");

  merged.phone = cleanString(p.phone || "");
  merged.rank = cleanString(p.rank || "");
  merged.rank_paygrade = cleanString(p.rank_paygrade || "");
  merged.base = cleanString(p.base || "");
  merged.mode = cleanString(p.mode || "");
  merged.family = toNumberOrNull(p.family);
  merged.yos = toNumberOrNull(p.yos);
  merged.va_disability = toNumberOrNull(p.va_disability);

  // ------------------------------------------------------------
  // 2) Financial fields
  // Priority:
  //    user_financial_inputs
  //    financial_intakes
  //    profiles fallback if present
  // ------------------------------------------------------------
  merged.monthly_expenses =
    toNumberOrNull(uf.monthly_expenses) ??
    toNumberOrNull(fi.expenses) ??
    toNumberOrNull(p.monthly_expenses) ??
    null;

  merged.projected_home_price =
    toNumberOrNull(uf.projected_home_price) ??
    toNumberOrNull(fi.price) ??
    toNumberOrNull(p.projected_home_price) ??
    null;

  merged.downpayment =
    toNumberOrNull(uf.downpayment) ??
    toNumberOrNull(fi.downpayment) ??
    toNumberOrNull(p.downpayment) ??
    null;

  merged.credit_score =
    toNumberOrNull(uf.credit_score) ??
    toNumberOrNull(fi.credit_score) ??
    toNumberOrNull(p.credit_score) ??
    null;

  merged.time_to_buy =
    cleanString(uf.purchase_time || "") ||
    cleanString(p.time_to_buy || "");

  // ------------------------------------------------------------
  // 3) House preference / AIOU fields
  // Priority:
  //    user_aiou_inputs
  //    profiles fallback
  // ------------------------------------------------------------
  merged.bedrooms =
    toNumberOrNull(ai.bedrooms) ??
    toNumberOrNull(p.bedrooms) ??
    null;

  merged.bathrooms =
    toNumberOrNull(ai.bathrooms) ??
    toNumberOrNull(p.bathrooms) ??
    null;

  merged.sqft =
    toNumberOrNull(ai.sqft) ??
    toNumberOrNull(p.sqft) ??
    null;

  merged.property_type =
    cleanString(ai.property_type || "") ||
    cleanString(p.property_type || "");

  merged.amenities =
    cleanString(ai.amenities || "") ||
    cleanString(p.amenities || "");

  merged.home_condition =
    cleanString(ai.home_year || "") || // keeping your current schema naming
    cleanString(p.home_condition || "");

  // ------------------------------------------------------------
  // 4) Helpful aliases for frontend compatibility
  // ------------------------------------------------------------
  merged.price = merged.projected_home_price;
  merged.homePrice = merged.projected_home_price;

  merged.expenses = merged.monthly_expenses;
  merged.monthlyExpenses = merged.monthly_expenses;

  merged.dpAmt = merged.downpayment;
  merged.downPayment = merged.downpayment;

  merged.creditScore = merged.credit_score;

  merged.propertyType = merged.property_type;
  merged.homeCondition = merged.home_condition;

  merged.pcs_base = merged.base;
  merged.pcsBase = merged.base;

  // ------------------------------------------------------------
  // 5) Income / Debt passthrough if they actually exist
  // NOTE:
  // This does NOT compute military pay.
  // If these columns are absent in DB, they stay null.
  // ------------------------------------------------------------
  merged.income =
    toNumberOrNull(uf.income) ??
    toNumberOrNull(fi.income) ??
    toNumberOrNull(p.income) ??
    toNumberOrNull(p.monthly_income) ??
    toNumberOrNull(p.monthlyIncome) ??
    null;

  merged.monthly_income = merged.income;
  merged.monthlyIncome = merged.income;
  merged.total_monthly_income = merged.income;
  merged.totalMonthlyIncome = merged.income;

  merged.debt =
    toNumberOrNull(uf.debt) ??
    toNumberOrNull(fi.debt) ??
    toNumberOrNull(p.debt) ??
    toNumberOrNull(p.monthly_debt) ??
    toNumberOrNull(p.monthlyDebt) ??
    null;

  merged.monthly_debt = merged.debt;
  merged.monthlyDebt = merged.debt;
  merged.debt_monthly = merged.debt;

  return merged;
}

exports.handler = async function (event) {
  // ------------------------------------------------------------
  // 0) CORS preflight
  // ------------------------------------------------------------
  if (event.httpMethod === "OPTIONS") {
    return respond(200, {});
  }

  // ------------------------------------------------------------
  // 1) Enforce POST
  // ------------------------------------------------------------
  if (event.httpMethod !== "POST") {
    return respond(405, { ok: false, error: "Method not allowed" });
  }

  // ------------------------------------------------------------
  // 2) Parse body
  // ------------------------------------------------------------
  let body = {};
  try {
    body = JSON.parse(event.body || "{}");
  } catch (_) {
    return respond(400, { ok: false, error: "Invalid JSON body" });
  }

  const email = String(body.email || "").trim().toLowerCase();
  if (!email) {
    return respond(400, { ok: false, error: "Email is required" });
  }

  // ------------------------------------------------------------
  // 3) Env
  // ------------------------------------------------------------
  const SUPABASE_URL =
    process.env.SUPABASE_URL ||
    process.env.SUPABASE_PROJECT_URL ||
    "";

  const SUPABASE_SERVICE_KEY =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_KEY ||
    "";

  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return respond(500, {
      ok: false,
      error: "Missing Supabase env vars (need SUPABASE_URL and a service key).",
      missing: {
        SUPABASE_URL: !SUPABASE_URL,
        SUPABASE_SERVICE_ROLE_KEY_or_SERVICE_KEY: !SUPABASE_SERVICE_KEY
      }
    });
  }

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false }
    });

    // ----------------------------------------------------------
    // 4) Query all relevant tables
    // ----------------------------------------------------------
    const [
      profileRes,
      userFinancialRes,
      financialIntakeRes,
      aiouRes
    ] = await Promise.all([
      supabase
        .from("profiles")
        .select("*")
        .eq("email", email)
        .maybeSingle(),

      supabase
        .from("user_financial_inputs")
        .select("*")
        .eq("email", email)
        .order("updated_at", { ascending: false })
        .limit(1),

      supabase
        .from("financial_intakes")
        .select("*")
        .eq("email", email)
        .limit(1),

      supabase
        .from("user_aiou_inputs")
        .select("*")
        .eq("email", email)
        .order("updated_at", { ascending: false })
        .limit(1)
    ]);

    if (profileRes.error) {
      return respond(500, { ok: false, error: profileRes.error.message });
    }
    if (userFinancialRes.error) {
      return respond(500, { ok: false, error: userFinancialRes.error.message });
    }
    if (financialIntakeRes.error) {
      return respond(500, { ok: false, error: financialIntakeRes.error.message });
    }
    if (aiouRes.error) {
      return respond(500, { ok: false, error: aiouRes.error.message });
    }

    const profileRow = profileRes.data || null;
    const userFinancialRow = firstRow(userFinancialRes.data);
    const financialIntakeRow = firstRow(financialIntakeRes.data);
    const aiouRow = firstRow(aiouRes.data);

    const mergedProfile = mergeProfile({
      profileRow,
      userFinancialRow,
      financialIntakeRow,
      aiouRow
    });

    return respond(200, {
      ok: true,
      email,
      profile: mergedProfile,
      debug: {
        has_profile: !!profileRow,
        has_user_financial_inputs: !!userFinancialRow,
        has_financial_intakes: !!financialIntakeRow,
        has_user_aiou_inputs: !!aiouRow,
        income_found: mergedProfile.income != null,
        debt_found: mergedProfile.debt != null
      }
    });
  } catch (e) {
    return respond(500, { ok: false, error: e?.message || "Server error" });
  }
};
