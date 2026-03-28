// netlify/functions/login.js
// ============================================================
// PCSUnited • login
// - POST { email, password }
// - Authenticates with Supabase Auth (email/password)
// - Returns a MERGED profile object from:
//    1) public.profiles
//    2) public.user_financial_inputs   (latest by updated_at)
//    3) public.financial_intakes       (first matching row fallback)
//    4) public.user_aiou_inputs        (latest by updated_at)
// - CORS + OPTIONS support
//
// ENV VARS
// REQUIRED:
// - SUPABASE_URL (or SUPABASE_PROJECT_URL)
// - SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SERVICE_KEY)
//
// OPTIONAL:
// - SUPABASE_ANON_KEY
// - PUBLIC_SUPABASE_ANON_KEY
// - NEXT_PUBLIC_SUPABASE_ANON_KEY
//
// NOTE:
// - If anon key is missing, auth falls back to service key so older
//   PCSUnited deployments do not break.
// ============================================================

const { createClient } = require("@supabase/supabase-js");

//#1) ALLOWED ORIGINS
const ALLOWED_ORIGINS = new Set([
  "https://pcsunited.com",
  "https://www.pcsunited.com",
  "https://pcsunited.netlify.app",
  "https://pcs-united.webflow.io",
  "https://pcsu.webflow.io",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "http://localhost:8888",
  "http://127.0.0.1:8888"
]);

//#2) CORS HELPERS
function getRequestOrigin(event) {
  return (
    event?.headers?.origin ||
    event?.headers?.Origin ||
    ""
  ).trim();
}

function getCorsHeaders(event) {
  const origin = getRequestOrigin(event);

  const allowOrigin = ALLOWED_ORIGINS.has(origin)
    ? origin
    : "https://pcsunited.com";

  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
    "Content-Type": "application/json"
  };
}

function respond(event, statusCode, payload) {
  return {
    statusCode,
    headers: getCorsHeaders(event),
    body: JSON.stringify(payload || {})
  };
}

//#3) SMALL UTILS
function firstRow(data) {
  return Array.isArray(data) && data.length ? data[0] : null;
}

function cleanString(v) {
  return v === undefined || v === null ? "" : String(v).trim();
}

function toNumberOrNull(v) {
  if (v === "" || v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function safeLower(v) {
  return cleanString(v).toLowerCase();
}

//#4) PROFILE MERGE
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

  const merged = {
    ...p
  };

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
    cleanString(ai.home_year || "") ||
    cleanString(p.home_condition || "");

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

//#5) ENV HELPERS
function getSupabaseUrl() {
  return (
    process.env.SUPABASE_URL ||
    process.env.SUPABASE_PROJECT_URL ||
    ""
  ).trim();
}

function getServiceKey() {
  return (
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_KEY ||
    ""
  ).trim();
}

function getAnonKey() {
  return (
    process.env.SUPABASE_ANON_KEY ||
    process.env.PUBLIC_SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    ""
  ).trim();
}

function getAuthKey() {
  const anon = getAnonKey();
  const service = getServiceKey();
  return anon || service || "";
}

//#6) CLIENT FACTORIES
function makeAdminClient(url, serviceKey) {
  return createClient(url, serviceKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  });
}

function makeAuthClient(url, authKey) {
  return createClient(url, authKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false
    }
  });
}

//#7) PROFILE FETCH
async function fetchMergedProfileByEmail(admin, email) {
  const [
    profileRes,
    userFinancialRes,
    financialIntakeRes,
    aiouRes
  ] = await Promise.all([
    admin
      .from("profiles")
      .select("*")
      .eq("email", email)
      .maybeSingle(),

    admin
      .from("user_financial_inputs")
      .select("*")
      .eq("email", email)
      .order("updated_at", { ascending: false })
      .limit(1),

    admin
      .from("financial_intakes")
      .select("*")
      .eq("email", email)
      .limit(1),

    admin
      .from("user_aiou_inputs")
      .select("*")
      .eq("email", email)
      .order("updated_at", { ascending: false })
      .limit(1)
  ]);

  if (profileRes.error) throw new Error(profileRes.error.message);
  if (userFinancialRes.error) throw new Error(userFinancialRes.error.message);
  if (financialIntakeRes.error) throw new Error(financialIntakeRes.error.message);
  if (aiouRes.error) throw new Error(aiouRes.error.message);

  const profileRow = profileRes.data || null;
  const userFinancialRow = firstRow(userFinancialRes.data);
  const financialIntakeRow = firstRow(financialIntakeRes.data);
  const aiouRow = firstRow(aiouRes.data);

  return {
    mergedProfile: mergeProfile({
      profileRow,
      userFinancialRow,
      financialIntakeRow,
      aiouRow
    }),
    debug: {
      has_profile: !!profileRow,
      has_user_financial_inputs: !!userFinancialRow,
      has_financial_intakes: !!financialIntakeRow,
      has_user_aiou_inputs: !!aiouRow
    }
  };
}

//#8) MAIN HANDLER
exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 204,
      headers: getCorsHeaders(event),
      body: ""
    };
  }

  if (event.httpMethod !== "POST") {
    return respond(event, 405, {
      ok: false,
      error: "Method not allowed"
    });
  }

  let body = {};
  try {
    body = JSON.parse(event.body || "{}");
  } catch (_) {
    return respond(event, 400, {
      ok: false,
      error: "Invalid JSON body"
    });
  }

  const email = safeLower(body.email || "");
  const password = cleanString(body.password || "");

  if (!email || !password) {
    return respond(event, 400, {
      ok: false,
      error: "Email and password are required"
    });
  }

  const SUPABASE_URL = getSupabaseUrl();
  const SERVICE_KEY = getServiceKey();
  const AUTH_KEY = getAuthKey();

  if (!SUPABASE_URL || !SERVICE_KEY) {
    return respond(event, 500, {
      ok: false,
      error: "Missing Supabase env vars",
      missing: {
        SUPABASE_URL: !SUPABASE_URL,
        SUPABASE_SERVICE_ROLE_KEY_or_SERVICE_KEY: !SERVICE_KEY
      }
    });
  }

  try {
    const admin = makeAdminClient(SUPABASE_URL, SERVICE_KEY);
    const authClient = makeAuthClient(SUPABASE_URL, AUTH_KEY);

    const { data: authData, error: authError } =
      await authClient.auth.signInWithPassword({
        email,
        password
      });

    if (authError || !authData?.user) {
      return respond(event, 401, {
        ok: false,
        error: authError?.message || "Invalid email or password"
      });
    }

    const authUser = authData.user;
    const session = authData.session || null;

    const { mergedProfile, debug } = await fetchMergedProfileByEmail(admin, email);

    return respond(event, 200, {
      ok: true,
      email,
      user: {
        id: authUser.id,
        email: authUser.email || email
      },
      profile: mergedProfile,
      session: {
        access_token: session?.access_token || "",
        refresh_token: session?.refresh_token || "",
        expires_at: session?.expires_at || null,
        expires_in: session?.expires_in || null,
        token_type: session?.token_type || "bearer"
      },
      debug: {
        ...debug,
        auth_user_found: !!authUser,
        used_auth_key: getAnonKey() ? "anon" : "service_fallback",
        income_found: mergedProfile.income != null,
        debt_found: mergedProfile.debt != null
      }
    });
  } catch (e) {
    return respond(event, 500, {
      ok: false,
      error: e?.message || "Server error"
    });
  }
};
