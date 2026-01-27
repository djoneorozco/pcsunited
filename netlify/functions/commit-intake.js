// netlify/functions/commit-intake.js
// ============================================================
// PCSUnited • Commit Pending Intake (v1.2.0) — NO UNIQUE REQUIRED
// PURPOSE:
// - Called AFTER successful /api/login password auth
// - Commits local pending payload to Supabase:
//    ✅ profiles (current state)  -> UPDATE by id (selected via email)
//    ✅ financial_intakes (history)
//    ✅ user_aiou_inputs (current state) -> UPDATE by id (selected via email)
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

function cleanUndefined(obj){
  const o = { ...obj };
  Object.keys(o).forEach(k => o[k] === undefined && delete o[k]);
  return o;
}

async function selectLatestIdByEmail(supabase, table, email){
  const { data, error } = await supabase
    .from(table)
    .select("id")
    .eq("email", email)
    .order("updated_at", { ascending: false })
    .limit(1);

  if (error) return { id: null, error };
  const id = (data && data[0] && data[0].id) ? data[0].id : null;
  return { id, error: null };
}

export const handler = async (event) => {
  // ============================================================
  // //#0 CORS + METHOD
  // ============================================================
  if (event.httpMethod === "OPTIONS") return respond(200, { ok: true });
  if (event.httpMethod !== "POST") return respond(405, { ok: false, error: "Use POST" });

  // ============================================================
  // //#1 PARSE BODY
  // ============================================================
  let body = {};
  try { body = JSON.parse(event.body || "{}"); }
  catch { return respond(400, { ok:false, error:"Invalid JSON" }); }

  const email = s(body.email).toLowerCase();
  const pending = body.pending && typeof body.pending === "object" ? body.pending : null;

  if (!email) return respond(400, { ok:false, error:"email is required" });
  if (!pending) return respond(400, { ok:false, error:"pending object is required" });

  // ============================================================
  // //#2 SUPABASE CLIENT
  // ============================================================
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

  // ============================================================
  // //#3 EXTRACT PENDING SHAPES (FAI + AIOU)
  // ============================================================
  const fin = pending || {};
  const aiou = (pending.aiou && typeof pending.aiou === "object") ? pending.aiou : null;

  const mode = s(fin.mode || fin.time_to_buy || "") || null;

  const monthly_expenses      = n(fin.monthly_expenses ?? fin.expenses ?? fin.monthlyExpenses);
  const projected_home_price  = n(fin.projected_home_price ?? fin.price ?? fin.projectedHomePrice);
  const downpayment           = n(fin.downpayment ?? fin.dpAmt ?? fin.dp ?? fin.down);
  const credit_score          = n(fin.credit_score ?? fin.creditScore ?? fin.score);

  const bedrooms        = aiou ? n(aiou.bedrooms) : null;
  const bathrooms       = aiou ? n(aiou.bathrooms) : null;
  const sqft            = aiou ? n(aiou.sqft) : null;
  const property_type   = aiou ? (s(aiou.property_type) || null) : null;
  const amenities       = aiou ? (s(aiou.amenities) || null) : null;
  const home_condition  = aiou ? (s(aiou.home_condition) || null) : null;

  const nowIso = new Date().toISOString();

  // ============================================================
  // //#4 BUILD ROWS
  // ============================================================
  // A) profiles PATCH
  const profilePatch = cleanUndefined({
    email,
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
  });

  // B) financial_intakes HISTORY
  const finHistory = {
    email,
    mode: mode || null,
    expenses: monthly_expenses ?? null,
    price: projected_home_price ?? null,
    downpayment: downpayment ?? null,
    credit_score: credit_score ?? null,
    source: s(fin.source || "pcsunited.commit-intake.v1.2.0") || "pcsunited.commit-intake.v1.2.0",
    intake_id: s(fin.attempt_id || fin.intake_id || "") || null,
  };

  // C) user_aiou_inputs PATCH
  const aiouPatch = aiou ? cleanUndefined({
    email,
    time_to_buy: mode || aiou.time_to_buy || undefined,
    downpayment: downpayment ?? aiou.downpayment ?? undefined,
    credit_score: credit_score ?? aiou.credit_score ?? undefined,
    bedrooms: bedrooms ?? undefined,
    bathrooms: bathrooms ?? undefined,
    sqft: sqft ?? undefined,
    property_type: property_type ?? undefined,
    amenities: amenities ?? undefined,
    home_condition: home_condition ?? undefined,
    updated_at: nowIso,
  }) : null;

  const hasFin =
    monthly_expenses !== null ||
    projected_home_price !== null ||
    downpayment !== null ||
    credit_score !== null ||
    !!mode;

  // ============================================================
  // //#5 WRITE: PROFILES (UPDATE by id else INSERT)
  // ============================================================
  try {
    const profPick = await selectLatestIdByEmail(supabase, "profiles", email);

    if (profPick.error){
      console.error("commit-intake profiles select error:", profPick.error);
      return respond(500, { ok:false, error: profPick.error.message || "profiles select failed" });
    }

    if (profPick.id){
      const { error: updErr } = await supabase
        .from("profiles")
        .update(profilePatch)
        .eq("id", profPick.id);

      if (updErr){
        console.error("commit-intake profiles update error:", updErr);
        return respond(500, { ok:false, error: updErr.message || "profiles update failed" });
      }
    } else {
      const { error: insErr } = await supabase
        .from("profiles")
        .insert([profilePatch]);

      if (insErr){
        console.error("commit-intake profiles insert error:", insErr);
        return respond(500, { ok:false, error: insErr.message || "profiles insert failed" });
      }
    }

    // ============================================================
    // //#6 WRITE: FINANCIAL INTAKES (HISTORY)
    // ============================================================
    if (hasFin){
      const { error: finErr } = await supabase
        .from("financial_intakes")
        .insert([finHistory]);

      if (finErr){
        console.error("commit-intake financial_intakes insert error:", finErr);
        return respond(500, { ok:false, error: finErr.message || "financial_intakes insert failed" });
      }
    }

    // ============================================================
    // //#7 WRITE: USER_AIOU_INPUTS (UPDATE by id else INSERT)
    // ============================================================
    if (aiouPatch){
      const aiouPick = await selectLatestIdByEmail(supabase, "user_aiou_inputs", email);

      if (aiouPick.error){
        console.error("commit-intake user_aiou_inputs select error:", aiouPick.error);
        return respond(500, { ok:false, error: aiouPick.error.message || "user_aiou_inputs select failed" });
      }

      if (aiouPick.id){
        const { error: aUpd } = await supabase
          .from("user_aiou_inputs")
          .update(aiouPatch)
          .eq("id", aiouPick.id);

        if (aUpd){
          console.error("commit-intake user_aiou_inputs update error:", aUpd);
          return respond(500, { ok:false, error: aUpd.message || "user_aiou_inputs update failed" });
        }
      } else {
        const { error: aIns } = await supabase
          .from("user_aiou_inputs")
          .insert([aiouPatch]);

        if (aIns){
          console.error("commit-intake user_aiou_inputs insert error:", aIns);
          return respond(500, { ok:false, error: aIns.message || "user_aiou_inputs insert failed" });
        }
      }
    }

    // ============================================================
    // //#8 RETURN PROFILE (FOR CLIENT CACHE)
    // ============================================================
    const { data: profileData } = await supabase
      .from("profiles")
      .select("*")
      .eq("email", email)
      .order("updated_at", { ascending: false })
      .limit(1);

    return respond(200, {
      ok:true,
      message:"Committed pending intake.",
      committed: {
        profiles: true,
        financial_intakes: hasFin,
        user_aiou_inputs: !!aiouPatch
      },
      profile: profileData && profileData[0] ? profileData[0] : null
    });

  } catch (e) {
    console.error("commit-intake fatal:", e);
    return respond(500, { ok:false, error:"Server error" });
  }
};
