// netlify/functions/commit-intake.js
// ============================================================
// PCSUnited • Commit Pending Intake (v1.1.0)
// PURPOSE:
// - Called AFTER successful /api/login password auth
// - Commits local pending payload to Supabase:
//    ✅ profiles (current state)
//    ✅ financial_intakes (history)
//    ✅ user_aiou_inputs (current state)
// ============================================================

import { createClient } from "@supabase/supabase-js";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
  "Vary": "Origin",
  "Content-Type": "application/json",
};

function respond(statusCode, payload) {
  return { statusCode, headers: CORS_HEADERS, body: JSON.stringify(payload || {}) };
}

function s(v){ return String(v ?? "").trim(); }
function n(v){
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
}

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return respond(200, { ok: true });
  if (event.httpMethod !== "POST") return respond(405, { ok: false, error: "Use POST" });

  let body = {};
  try { body = JSON.parse(event.body || "{}"); }
  catch { return respond(400, { ok:false, error:"Invalid JSON" }); }

  const email = s(body.email).toLowerCase();
  const pending = body.pending && typeof body.pending === "object" ? body.pending : null;

  if (!email) return respond(400, { ok:false, error:"email is required" });
  if (!pending) return respond(400, { ok:false, error:"pending object is required" });

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_KEY =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_KEY ||
    "";

  if (!SUPABASE_URL || !SERVICE_KEY){
    return respond(500, {
      ok:false,
      error:"Supabase env not configured",
      missing: {
        SUPABASE_URL: !SUPABASE_URL,
        SUPABASE_SERVICE_ROLE_KEY_or_SUPABASE_SERVICE_KEY: !SERVICE_KEY,
      }
    });
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession:false, autoRefreshToken:false }
  });

  // ------------------------------------------------------------
  // #1 Extract known pending shapes
  // ------------------------------------------------------------
  const fin = pending || {};
  const aiou = (pending.aiou && typeof pending.aiou === "object") ? pending.aiou : null;

  // FAI-style fields (from your FAI pending payload)
  const mode = s(fin.mode || fin.time_to_buy || "") || null;
  const monthly_expenses = n(fin.monthly_expenses ?? fin.expenses ?? fin.monthlyExpenses);
  const projected_home_price = n(fin.projected_home_price ?? fin.price ?? fin.projectedHomePrice);
  const downpayment = n(fin.downpayment ?? fin.dpAmt ?? fin.dp ?? fin.down);
  const credit_score = n(fin.credit_score ?? fin.creditScore ?? fin.score);

  // AIOU fields (from quiz pending.aiou)
  const bedrooms = aiou ? n(aiou.bedrooms) : null;
  const bathrooms = aiou ? n(aiou.bathrooms) : null;
  const sqft = aiou ? n(aiou.sqft) : null;
  const property_type = aiou ? (s(aiou.property_type) || null) : null;
  const amenities = aiou ? (s(aiou.amenities) || null) : null;
  const home_condition = aiou ? (s(aiou.home_condition) || null) : null;

  const nowIso = new Date().toISOString();

  // ------------------------------------------------------------
  // #2 Update profiles (current state)
  // ------------------------------------------------------------
  // NOTE: this assumes your profiles table includes these columns.
  // If any column doesn't exist, you'll get a clear DB error back.
  const profilePatch = {
    email,
    mode: mode || undefined,
    // common fields you showed in your UI/table screenshot
    time_to_buy: mode || undefined,
    downpayment: downpayment ?? undefined,
    credit_score: credit_score ?? undefined,
    bedrooms: bedrooms ?? undefined,
    bathrooms: bathrooms ?? undefined,
    sqft: sqft ?? undefined,
    property_type: property_type ?? undefined,
    amenities: amenities ?? undefined,
    home_condition: home_condition ?? undefined,
    updated_at: nowIso,
  };

  // remove undefined keys so PostgREST doesn't try to write them
  Object.keys(profilePatch).forEach(k => profilePatch[k] === undefined && delete profilePatch[k]);

  // ------------------------------------------------------------
  // #3 Write history row: financial_intakes (optional)
  // ------------------------------------------------------------
  const finHistory = {
    email,
    mode: mode || null,
    expenses: monthly_expenses ?? null,
    price: projected_home_price ?? null,
    downpayment: downpayment ?? null,
    credit_score: credit_score ?? null,
    source: s(fin.source || "pcsunited.commit-intake.v1.1.0") || "pcsunited.commit-intake.v1.1.0",
    intake_id: s(fin.attempt_id || fin.intake_id || "") || null,
  };

  // ------------------------------------------------------------
  // #4 Upsert user_aiou_inputs (current state)
  // ------------------------------------------------------------
  const aiouRow = aiou ? {
    email,
    time_to_buy: mode || aiou.time_to_buy || null,
    downpayment: downpayment ?? aiou.downpayment ?? null,
    credit_score: credit_score ?? aiou.credit_score ?? null,
    bedrooms,
    bathrooms,
    sqft,
    property_type,
    amenities,
    home_condition,
    updated_at: nowIso,
  } : null;

  try{
    // 4.1 profiles upsert
    const { error: profErr } = await supabase
      .from("profiles")
      .upsert(profilePatch, { onConflict: "email" });

    if (profErr) {
      console.error("commit-intake profiles upsert error:", profErr);
      return respond(500, { ok:false, error: profErr.message || "profiles upsert failed" });
    }

    // 4.2 financial_intakes insert (history) — only if we have at least one meaningful field
    const hasFin =
      monthly_expenses !== null ||
      projected_home_price !== null ||
      downpayment !== null ||
      credit_score !== null ||
      mode;

    if (hasFin){
      const { error: finErr } = await supabase
        .from("financial_intakes")
        .insert([finHistory]);

      if (finErr) {
        console.error("commit-intake financial_intakes insert error:", finErr);
        // don't hard-fail user; but return error for debugging
        return respond(500, { ok:false, error: finErr.message || "financial_intakes insert failed" });
      }
    }

    // 4.3 user_aiou_inputs upsert (current) — if present
    if (aiouRow){
      const { error: aiouErr } = await supabase
        .from("user_aiou_inputs")
        .upsert(aiouRow, { onConflict: "email" });

      if (aiouErr) {
        console.error("commit-intake user_aiou_inputs upsert error:", aiouErr);
        return respond(500, { ok:false, error: aiouErr.message || "user_aiou_inputs upsert failed" });
      }
    }

    // optional: return the profile row to cache client-side
    const { data: profileData } = await supabase
      .from("profiles")
      .select("*")
      .eq("email", email)
      .limit(1);

    return respond(200, {
      ok:true,
      message:"Committed pending intake.",
      committed: {
        profiles: true,
        financial_intakes: hasFin,
        user_aiou_inputs: !!aiouRow
      },
      profile: profileData && profileData[0] ? profileData[0] : null
    });

  }catch(e){
    console.error("commit-intake fatal:", e);
    return respond(500, { ok:false, error: "Server error" });
  }
};
