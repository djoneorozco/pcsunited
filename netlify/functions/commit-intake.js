// netlify/functions/commit-intake.js
// ============================================================
// PCSUnited • Commit Pending Intake (v1.1)
// PURPOSE (HARDENED):
// - Called ONLY after successful email/password login.
// - Updates ONE row in public.profiles (current state)
// - Inserts ONE row into public.financial_intakes (history)
// - Upserts public.user_aiou_inputs (if any AIOU exists)
// - ✅ MIRRORS latest user_aiou_inputs → profiles (so profiles ALWAYS updates)
//
// INPUT (POST JSON):
// { email: "user@email.com", pending: {...} }
//
// RETURNS:
// {
//   ok:true,
//   profile?:{...},
//   wrote:{ profile:true, history:true/false, aiou:true/false, mirrored:true/false },
//   warning?:string
// }
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

function s(v) {
  const x = (v == null) ? "" : String(v);
  const t = x.trim();
  return t ? t : null;
}

// Normalize AIOU payload shapes so we don’t miss fields
// Accepts:
// pending.aiou
// pending.aiou.data
// pending.aiou.aiou
function normalizeAiou(pending) {
  const a = pending && pending.aiou;
  if (!a || typeof a !== "object") return null;

  // common wrappers
  if (a.data && typeof a.data === "object") return a.data;
  if (a.aiou && typeof a.aiou === "object") return a.aiou;

  return a;
}

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: cors, body: "" };
  if (event.httpMethod !== "POST") return j({ ok: false, error: "Method not allowed" }, 405);

  try {
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SERVICE_KEY =
      process.env.SUPABASE_SERVICE_ROLE_KEY ||
      process.env.SUPABASE_SERVICE_KEY ||
      process.env.SUPABASE_SERVICE_KEY_PCSUNITED ||
      process.env.SUPABASE_KEY;

    if (!SUPABASE_URL || !SERVICE_KEY) {
      return j({ ok: false, error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars." }, 500);
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { persistSession: false },
      global: { headers: { "X-Client-Info": "pcsunited-commit-intake-v1.1" } }
    });

    const body = JSON.parse(event.body || "{}");
    const email = String(body.email || "").trim().toLowerCase();
    const pending = body.pending && typeof body.pending === "object" ? body.pending : null;

    if (!email) return j({ ok: false, error: "Missing email" }, 400);
    if (!pending) return j({ ok: false, error: "Missing pending payload" }, 400);

    const wrote = { profile: false, history: false, aiou: false, mirrored: false };

    // ============================================================
    // //#1 Normalize FINANCIAL fields
    // ============================================================
    const time_to_buy = s(pending.mode);

    const monthly_expenses = n(pending.monthly_expenses);
    const projected_home_price = n(pending.projected_home_price);
    const downpayment = n(pending.downpayment);
    const credit_score = i(pending.credit_score);

    // ============================================================
    // //#2 Normalize AIOU fields (robust)
    // ============================================================
    const aiou = normalizeAiou(pending);

    const home_condition = aiou ? s(aiou.home_condition) : null;
    const bedrooms = aiou && aiou.bedrooms != null ? i(aiou.bedrooms) : null;
    const bathrooms = aiou && aiou.bathrooms != null ? n(aiou.bathrooms) : null;
    const sqft = aiou && aiou.sqft != null ? i(aiou.sqft) : null;
    const property_type = aiou ? s(aiou.property_type) : null;
    const amenities = aiou ? s(aiou.amenities) : null;

    // ============================================================
    // //#3 Find existing profile by email
    // ============================================================
    const { data: existingProfile, error: selErr } = await supabase
      .from("profiles")
      .select("id,email")
      .eq("email", email)
      .maybeSingle();

    if (selErr) return j({ ok: false, error: "profiles select failed: " + selErr.message }, 500);

    // Patch only fields we own here (safe nulls allowed)
    const profilePatch = {
      email,
      time_to_buy,
      monthly_expenses,
      projected_home_price,
      downpayment,
      credit_score,

      // AIOU mirrored fields in profiles (if your schema has them)
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
      wrote.profile = true;
    } else {
      const { data: ins, error: insErr } = await supabase
        .from("profiles")
        .insert(profilePatch)
        .select("*")
        .maybeSingle();

      if (insErr) return j({ ok: false, error: "profiles insert failed: " + insErr.message }, 500);
      profileRow = ins || null;
      wrote.profile = true;
    }

    // ============================================================
    // //#4 Insert history row into financial_intakes (best-effort)
    // ============================================================
    const attemptId = s(pending.attempt_id);
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

    if (!histErr) wrote.history = true;

    // ============================================================
    // //#5 Upsert user_aiou_inputs (best-effort)
    // ============================================================
    if (aiou && typeof aiou === "object") {
      const aiouPayload = {
        email,
        home_year: aiou.home_year ? String(aiou.home_year) : null,
        bedrooms,
        bathrooms,
        sqft,
        property_type,
        amenities,
        updated_at: new Date().toISOString()
      };

      const { data: aiouExisting, error: aiouSelErr } = await supabase
        .from("user_aiou_inputs")
        .select("id,email")
        .eq("email", email)
        .maybeSingle();

      if (!aiouSelErr) {
        if (aiouExisting && aiouExisting.id) {
          await supabase.from("user_aiou_inputs").update(aiouPayload).eq("id", aiouExisting.id);
          wrote.aiou = true;
        } else {
          await supabase.from("user_aiou_inputs").insert(aiouPayload);
          wrote.aiou = true;
        }
      }
    }

    // ============================================================
    // //#6 ✅ MIRROR latest user_aiou_inputs → profiles (guarantees profiles fills)
    // ============================================================
    // Even if AIOU was saved via a different flow, profiles gets populated here.
    const { data: latestAiou } = await supabase
      .from("user_aiou_inputs")
      .select("home_year,bedrooms,bathrooms,sqft,property_type,amenities,updated_at")
      .eq("email", email)
      .maybeSingle();

    if (latestAiou && (latestAiou.bedrooms != null || latestAiou.bathrooms != null || latestAiou.sqft != null || latestAiou.property_type || latestAiou.amenities)) {
      const mirrorPatch = {
        bedrooms: latestAiou.bedrooms ?? bedrooms ?? null,
        bathrooms: latestAiou.bathrooms ?? bathrooms ?? null,
        sqft: latestAiou.sqft ?? sqft ?? null,
        property_type: latestAiou.property_type ?? property_type ?? null,
        amenities: latestAiou.amenities ?? amenities ?? null,
        home_condition // only lives in profiles in your schema
      };

      const { error: mirErr } = await supabase
        .from("profiles")
        .update(mirrorPatch)
        .eq("email", email);

      if (!mirErr) {
        wrote.mirrored = true;
        // refresh profileRow for response
        const { data: refreshed } = await supabase
          .from("profiles")
          .select("*")
          .eq("email", email)
          .maybeSingle();
        if (refreshed) profileRow = refreshed;
      }
    }

    // ============================================================
    // //#7 Return result (with warning if history insert failed)
    // ============================================================
    if (histErr) {
      return j({
        ok: true,
        profile: profileRow,
        wrote,
        warning: "financial_intakes insert failed: " + histErr.message
      });
    }

    return j({ ok: true, profile: profileRow, wrote });

  } catch (e) {
    return j({ ok: false, error: e.message || "Unknown error" }, 500);
  }
}
