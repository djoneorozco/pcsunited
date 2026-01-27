// netlify/functions/commit-intake.js
// ============================================================
// PCSUnited • Commit Pending Intake (v1.0)
// PURPOSE:
// - Called ONLY after successful email/password login.
// - Updates ONE row in public.profiles (current state)
// - Inserts ONE row into public.financial_intakes (history)
// - Optionally upserts public.user_aiou_inputs (if pending.aiou exists)
//
// INPUT (POST JSON):
// { email: "user@email.com", pending: {...} }
//
// RETURNS:
// { ok:true, profile?:{...} }
// ============================================================

import { createClient } from "@supabase/supabase-js";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400"
};

function j(body, status = 200) {
  return {
    statusCode: status,
    headers: { "Content-Type": "application/json", ...cors },
    body: JSON.stringify(body)
  };
}

function n(v) {
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
}
function i(v) {
  const x = Math.round(Number(v));
  return Number.isFinite(x) ? x : null;
}

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: cors, body: "" };
  if (event.httpMethod !== "POST") return j({ ok: false, error: "Method not allowed" }, 405);

  try {
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SERVICE_KEY =
      process.env.SUPABASE_SERVICE_ROLE_KEY ||
      process.env.SUPABASE_SERVICE_KEY ||
      process.env.SUPABASE_KEY;

    if (!SUPABASE_URL || !SERVICE_KEY) {
      return j({ ok: false, error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars." }, 500);
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { persistSession: false },
      global: { headers: { "X-Client-Info": "pcsunited-commit-intake" } }
    });

    const body = JSON.parse(event.body || "{}");
    const email = String(body.email || "").trim().toLowerCase();
    const pending = body.pending && typeof body.pending === "object" ? body.pending : null;

    if (!email) return j({ ok: false, error: "Missing email" }, 400);
    if (!pending) return j({ ok: false, error: "Missing pending payload" }, 400);

    // ============================================================
    // //#1 Normalize FAI fields
    // ============================================================
    const time_to_buy = String(pending.mode || "").trim() || null;

    const monthly_expenses = n(pending.monthly_expenses);
    const projected_home_price = n(pending.projected_home_price);
    const downpayment = n(pending.downpayment);
    const credit_score = i(pending.credit_score);

    const home_condition = pending.aiou && pending.aiou.home_condition ? String(pending.aiou.home_condition) : null;
    const bedrooms = pending.aiou && pending.aiou.bedrooms != null ? i(pending.aiou.bedrooms) : null;
    const bathrooms = pending.aiou && pending.aiou.bathrooms != null ? n(pending.aiou.bathrooms) : null;
    const sqft = pending.aiou && pending.aiou.sqft != null ? i(pending.aiou.sqft) : null;
    const property_type = pending.aiou && pending.aiou.property_type ? String(pending.aiou.property_type) : null;
    const amenities = pending.aiou && pending.aiou.amenities ? String(pending.aiou.amenities) : null;

    // ============================================================
    // //#2 Upsert Profiles (by email) WITHOUT requiring unique index
    // ============================================================
    const { data: existingProfile, error: selErr } = await supabase
      .from("profiles")
      .select("id,email")
      .eq("email", email)
      .maybeSingle();

    if (selErr) return j({ ok: false, error: "profiles select failed: " + selErr.message }, 500);

    const profilePatch = {
      email,
      time_to_buy,
      monthly_expenses,
      projected_home_price,
      downpayment,
      credit_score,
      bedrooms,
      bathrooms,
      sqft,
      property_type,
      amenities,
      home_condition
    };

    let profileRow = null;

    if (existingProfile && existingProfile.id) {
      const { data: upd, error: updErr } = await supabase
        .from("profiles")
        .update(profilePatch)
        .eq("id", existingProfile.id)
        .select("*")
        .maybeSingle();

      if (updErr) return j({ ok: false, error: "profiles update failed: " + updErr.message }, 500);
      profileRow = upd || null;
    } else {
      const { data: ins, error: insErr } = await supabase
        .from("profiles")
        .insert(profilePatch)
        .select("*")
        .maybeSingle();

      if (insErr) return j({ ok: false, error: "profiles insert failed: " + insErr.message }, 500);
      profileRow = ins || null;
    }

    // ============================================================
    // //#3 Insert History Row into financial_intakes
    // ============================================================
    const attemptId = String(pending.attempt_id || "").trim() || null;

    const historyRow = {
      email,
      mode: time_to_buy,
      expenses: monthly_expenses,
      price: projected_home_price,
      downpayment,
      credit_score,
      source: String(pending.source || "pcsunited.financial.intake.v1"),
      intake_id: attemptId
    };

    const { error: histErr } = await supabase
      .from("financial_intakes")
      .insert(historyRow);

    // If a unique constraint exists later, you can change this to upsert.
    if (histErr) {
      // Don’t fail profile update if history insert is blocked by schema/rls/etc.
      // Return warning-like behavior.
      return j({
        ok: true,
        profile: profileRow,
        warning: "financial_intakes insert failed: " + histErr.message
      });
    }

    // ============================================================
    // //#4 Optional: Upsert user_aiou_inputs by email (best-effort)
    // ============================================================
    if (pending.aiou && typeof pending.aiou === "object") {
      const aiouPayload = {
        email,
        home_year: pending.aiou.home_year ? String(pending.aiou.home_year) : null,
        bedrooms,
        bathrooms,
        sqft,
        property_type,
        amenities,
        updated_at: new Date().toISOString()
      };

      // Upsert strategy without relying on unique constraints:
      const { data: aiouExisting, error: aiouSelErr } = await supabase
        .from("user_aiou_inputs")
        .select("id,email")
        .eq("email", email)
        .maybeSingle();

      if (!aiouSelErr) {
        if (aiouExisting && aiouExisting.id) {
          await supabase.from("user_aiou_inputs").update(aiouPayload).eq("id", aiouExisting.id);
        } else {
          await supabase.from("user_aiou_inputs").insert(aiouPayload);
        }
      }
    }

    return j({ ok: true, profile: profileRow });

  } catch (e) {
    return j({ ok: false, error: e.message || "Unknown error" }, 500);
  }
}
