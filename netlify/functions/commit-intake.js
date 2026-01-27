// netlify/functions/commit-intake.js
// ============================================================
// PCS United • Commit Pending Intake to Supabase (v1.0.0)
// PURPOSE:
// - Called ONLY after password login success
// - Takes localStorage pending payload (FAI + optional AIOU)
// - Updates:
//    1) public.profiles (CURRENT STATE)  ✅
//    2) public.financial_intakes (HISTORY) optional
//    3) public.user_aiou_inputs (AIOU) optional
//
// BODY (POST JSON):
// { email: "user@x.com", pending: {...} }
//
// ENV REQUIRED:
//   SUPABASE_URL
//   SUPABASE_SERVICE_KEY
// ============================================================

import { createClient } from "@supabase/supabase-js";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
  "Access-Control-Max-Age": "86400",
  "Vary": "Origin",
};

function respond(statusCode, payload) {
  return { statusCode, headers: CORS_HEADERS, body: JSON.stringify(payload || {}) };
}

function s(v) {
  const out = String(v ?? "").trim();
  return out ? out : null;
}
function n(v) {
  const out = Number(v);
  return Number.isFinite(out) ? out : null;
}
function lowerEmail(v) {
  const out = s(v);
  return out ? out.toLowerCase() : null;
}

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return respond(200, { ok: true });
  if (event.httpMethod !== "POST") return respond(405, { ok: false, error: "Method not allowed" });

  let body = {};
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return respond(400, { ok: false, error: "Invalid JSON body" });
  }

  const email = lowerEmail(body.email);
  const pending = body.pending && typeof body.pending === "object" ? body.pending : null;

  if (!email) return respond(400, { ok: false, error: "email is required" });
  if (!pending) return respond(400, { ok: false, error: "pending payload is required" });

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return respond(500, { ok: false, error: "Supabase env not configured" });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // ------------------------------------------------------------
  // 1) Normalize pending payload (FAI + AIOU)
  // ------------------------------------------------------------
  const mode = s(pending.mode); // ready | soon | unsure
  const monthly_expenses = n(pending.monthly_expenses);
  const projected_home_price = n(pending.projected_home_price);
  const downpayment = n(pending.downpayment);
  const credit_score = n(pending.credit_score);

  // AIOU may be nested in pending.aiou or pending.aiou.data depending on your wrapper
  const aiouRaw =
    (pending.aiou && typeof pending.aiou === "object" ? pending.aiou : null) ||
    null;

  // Support either direct fields or wrapped formats
  const aiou = aiouRaw?.data && typeof aiouRaw.data === "object" ? aiouRaw.data : aiouRaw;

  const bedrooms = n(aiou?.bedrooms);
  const bathrooms = n(aiou?.bathrooms);
  const sqft = n(aiou?.sqft);
  const property_type = s(aiou?.property_type);
  const amenities = s(aiou?.amenities);

  // Your profiles table screenshot shows home_condition (NOT home_year)
  const home_condition =
    s(aiou?.home_condition) ||
    s(aiou?.conditionPreference) ||
    null;

  const home_year =
    s(aiou?.home_year) ||
    s(aiou?.yearBand) ||
    null;

  const nowIso = new Date().toISOString();

  // ------------------------------------------------------------
  // 2) Update PROFILES (THIS is the missing piece)
  //    We patch only the fields you have in the table editor.
  // ------------------------------------------------------------
  const profilePatch = {
    email,
    time_to_buy: mode,                 // matches your screenshot field
    monthly_expenses,                  // if exists (safe if column exists)
    projected_home_price,              // if exists (safe if column exists)
    downpayment,
    credit_score,
    bedrooms,
    bathrooms,
    sqft,
    property_type,
    amenities,
    home_condition,
    // home_year: only include if you actually have this column
    // Comment OUT if your profiles table does not have home_year.
    home_year,
    updated_at: nowIso,
  };

  // IMPORTANT: If your profiles table does NOT have monthly_expenses/projected_home_price/home_year,
  // Supabase will error. If you’re not sure, remove those three fields.
  // (Your screenshot confirms: downpayment, credit_score, time_to_buy, bedrooms, bathrooms, sqft,
  //  property_type, amenities, home_condition exist.)

  try {
    // Patch existing profile row
    // If a profile row might not exist yet, switch to upsert and ensure email is unique.
    const { error: profErr } = await supabase
      .from("profiles")
      .update(profilePatch)
      .eq("email", email);

    if (profErr) {
      console.error("commit-intake profiles.update error:", profErr);
      return respond(500, { ok: false, error: profErr.message || "profiles update failed" });
    }

    // ------------------------------------------------------------
    // 3) Optional: Write FINANCIAL INTAKES history (if you want)
    // ------------------------------------------------------------
    // If your financial_intakes table schema differs, adjust here.
    const intakeRow = {
      email,
      mode,
      expenses: monthly_expenses,
      price: projected_home_price,
      downpayment,
      credit_score,
      source: s(pending.source) || "pcsunited.commit-intake",
      intake_id: s(pending.attempt_id) || null,
    };

    const { error: finErr } = await supabase
      .from("financial_intakes")
      .insert([intakeRow]);

    if (finErr) {
      // Don’t fail the whole commit if history insert fails
      console.warn("commit-intake financial_intakes insert warning:", finErr);
    }

    // ------------------------------------------------------------
    // 4) Optional: Mirror AIOU into user_aiou_inputs (if present)
    // ------------------------------------------------------------
    if (aiou && typeof aiou === "object") {
      const aiouRow = {
        email,
        home_year,
        bedrooms,
        bathrooms,
        sqft,
        property_type,
        amenities,
        updated_at: nowIso,
      };

      // Update latest row by email else insert (no unique constraint required)
      const { data: existing, error: selErr } = await supabase
        .from("user_aiou_inputs")
        .select("id")
        .eq("email", email)
        .order("updated_at", { ascending: false })
        .limit(1);

      if (!selErr && existing && existing.length) {
        const { error: updErr } = await supabase
          .from("user_aiou_inputs")
          .update(aiouRow)
          .eq("id", existing[0].id);

        if (updErr) console.warn("commit-intake user_aiou_inputs update warning:", updErr);
      } else {
        const { error: insErr } = await supabase
          .from("user_aiou_inputs")
          .insert([aiouRow]);

        if (insErr) console.warn("commit-intake user_aiou_inputs insert warning:", insErr);
      }
    }

    // Return the patched profile fields so UI can cache them if needed
    return respond(200, {
      ok: true,
      message: "Committed intake to profiles.",
      email,
      profile: profilePatch,
    });

  } catch (e) {
    console.error("commit-intake fatal:", e);
    return respond(500, { ok: false, error: "Server error" });
  }
};
