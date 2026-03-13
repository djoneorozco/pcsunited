// netlify/functions/aiou-profile.js
// ============================================================
// PCS United • AIOU Profile Hydrator (v1.0.1)
// PURPOSE:
// - Given { email }, fetch profile context from Supabase
// - Fetch latest user_aiou_inputs row (if present)
// - ✅ FIX: Fetch latest financial_intakes row (if present) to hydrate Budget Max
// - Return normalized fields for AIOU "Profile & Goals"
//
// BODY (POST JSON):
// { "email": "user@email.com" }
//
// RETURNS:
// {
//   ok: true,
//   data: {
//     firstName, lastName,
//     bedroomsWanted, budgetMax,
//     preferredSetting, safetyPriority
//   },
//   raw: { profile, aiou_input, financial_intake }
// }
//
// ENV REQUIRED:
//   SUPABASE_URL
//   SUPABASE_SERVICE_KEY
// ============================================================

const { createClient } = require("@supabase/supabase-js");

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

function respond(statusCode, payload) {
  return {
    statusCode,
    headers: CORS_HEADERS,
    body: JSON.stringify(payload || {}),
  };
}

function s(v) {
  const out = String(v ?? "").trim();
  return out ? out : "";
}

function n(v) {
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
}

function splitName(full) {
  const f = s(full);
  if (!f) return { firstName: "", lastName: "" };
  const parts = f.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return { firstName: parts[0], lastName: "" };
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
}

// ============================================================
// ✅ Helper: fetch latest row by email with defensive ordering
// - Tries order columns in sequence (created_at -> updated_at), then falls back
// ============================================================
async function fetchLatestByEmail(supabase, table, email, orderCols = ["created_at", "updated_at"]) {
  for (const col of orderCols) {
    try {
      const { data, error } = await supabase
        .from(table)
        .select("*")
        .eq("email", email)
        .order(col, { ascending: false })
        .limit(1);

      if (!error && data && data[0]) return data[0];
      if (error) {
        // If column doesn't exist, try next; otherwise break to fallback
        const msg = String(error.message || "").toLowerCase();
        if (msg.includes("does not exist") || msg.includes("column") || msg.includes("schema cache")) continue;
      }
    } catch (_) {
      // try next
    }
  }

  // fallback: no ordering (still returns some row if present)
  try {
    const { data, error } = await supabase
      .from(table)
      .select("*")
      .eq("email", email)
      .limit(1);

    if (!error && data && data[0]) return data[0];
  } catch (_) {}

  return null;
}

exports.handler = async (event) => {
  // ============================================================
  // //#0 CORS + METHOD
  // ============================================================
  if (event.httpMethod === "OPTIONS") return respond(200, { ok: true });
  if (event.httpMethod !== "POST") return respond(405, { ok: false, error: "Method not allowed" });

  // ============================================================
  // //#1 INPUT
  // ============================================================
  let body = {};
  try {
    body = JSON.parse(event.body || "{}");
  } catch (_) {
    return respond(400, { ok: false, error: "Invalid JSON body" });
  }

  const email = s(body.email).toLowerCase();
  if (!email) return respond(400, { ok: false, error: "email is required" });

  // ============================================================
  // //#2 SUPABASE
  // ============================================================
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return respond(500, { ok: false, error: "Supabase env not configured" });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    // ============================================================
    // //#3 FETCH PROFILE
    // ============================================================
    const { data: проф, error: профErr } = await supabase
      .from("profiles")
      .select("*")
      .eq("email", email)
      .limit(1);

    if (профErr) {
      console.error("aiou-profile profiles select error:", профErr);
      return respond(500, { ok: false, error: профErr.message || "Profile query failed" });
    }

    const profile = (проф && проф[0]) ? проф[0] : null;

    // ============================================================
    // //#4 FETCH LATEST AIOU INPUT (OPTIONAL)
    // ============================================================
    let aiou_input = null;
    try {
      aiou_input = await fetchLatestByEmail(supabase, "user_aiou_inputs", email, ["updated_at", "created_at"]);
    } catch (_) {
      // optional table; ignore if missing
    }

    // ============================================================
    // //#4.5 ✅ FIX: FETCH LATEST FINANCIAL INTAKE (OPTIONAL)
    // - Used to hydrate Budget (max $) from financial_intakes.price
    // ============================================================
    let financial_intake = null;
    try {
      financial_intake = await fetchLatestByEmail(supabase, "financial_intakes", email, ["updated_at", "created_at"]);
    } catch (_) {
      // optional table; ignore if missing
    }

    // ============================================================
    // //#5 NORMALIZE FIELDS (DEFENSIVE)
    // ============================================================
    // Names: prefer explicit first/last if you ever add them later,
    // else derive from full_name.
    const explicitFirst = s(profile?.first_name);
    const explicitLast  = s(profile?.last_name);

    const derived = splitName(profile?.full_name);

    const firstName = explicitFirst || derived.firstName || "";
    const lastName  = explicitLast  || derived.lastName  || "";

    // Bedrooms wanted:
    // prefer latest aiou_input.bedrooms, else common profile keys if you add later.
    const bedroomsWanted =
      n(aiou_input?.bedrooms) ??
      n(profile?.bedrooms_wanted) ??
      n(profile?.desired_bedrooms) ??
      n(profile?.bedrooms) ??
      null;

    // ✅ Budget max:
    // prefer latest financial_intakes.price (authoritative for "Budget (max $)")
    // then fall back to any stored AIOU/profile fields.
    const budgetMax =
      n(financial_intake?.price) ??
      n(financial_intake?.budget_max) ??
      n(aiou_input?.budget_max) ??
      n(profile?.projected_home_price) ??
      n(profile?.price) ??
      n(profile?.home_price) ??
      null;

    // Preferred setting + safety:
    // prefer aiou_input if you add those columns there later, else profile, else defaults
    const preferredSetting =
      s(aiou_input?.preferred_setting) ||
      s(aiou_input?.setting) ||
      s(profile?.preferred_setting) ||
      s(profile?.setting) ||
      "city";

    const safetyPriority =
      n(aiou_input?.safety_priority) ??
      n(aiou_input?.safety) ??
      n(profile?.safety_priority) ??
      n(profile?.safety) ??
      5;

    return respond(200, {
      ok: true,
      data: {
        firstName,
        lastName,
        bedroomsWanted,
        budgetMax,
        preferredSetting,
        safetyPriority
      },
      raw: {
        profile,
        aiou_input,
        financial_intake
      }
    });
  } catch (e) {
    console.error("aiou-profile fatal:", e);
    return respond(500, { ok: false, error: "Server error" });
  }
};
