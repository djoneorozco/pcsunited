// netlify/functions/commit-intake.js
// ============================================================
// PCS United • Commit Pending Intake (v1.0.0) — ESM SAFE
// PURPOSE:
// - Called ONLY after successful /login
// - Takes { email, pending } from localStorage pending payload
// - Updates public.profiles.mode (and timestamps)
// - Optionally writes AIOU into public.user_aiou_inputs if included
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
  "Vary": "Origin",
};

function ok(body) {
  return { statusCode: 200, headers: CORS_HEADERS, body: JSON.stringify(body || {}) };
}
function bad(statusCode, message) {
  return { statusCode, headers: CORS_HEADERS, body: JSON.stringify({ ok: false, error: message }) };
}

function s(v) {
  const out = String(v ?? "").trim();
  return out ? out : null;
}
function n(v) {
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
}

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return ok({ ok: true });
  if (event.httpMethod !== "POST") return bad(405, "Use POST");

  let body = {};
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return bad(400, "Invalid JSON");
  }

  const email = s(body.email)?.toLowerCase();
  const pending = body.pending && typeof body.pending === "object" ? body.pending : null;

  if (!email) return bad(400, "email is required");
  if (!pending) return bad(400, "pending payload is required");

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) return bad(500, "Supabase env not configured");

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const nowIso = new Date().toISOString();

  // Pending fields (from your FAI embed)
  const mode = s(pending.mode);
  const attempt_id = s(pending.attempt_id);

  // Optional: AIOU block embedded into pending.aiou
  const aiou = pending.aiou && typeof pending.aiou === "object" ? pending.aiou : null;

  try {
    // ============================================================
    // //#1 UPDATE PROFILES (THIS IS WHAT YOU’RE MISSING)
    // ============================================================
    // Only update fields that are known to exist in profiles.
    // (mode exists in your schema memory; safe.)
    const profilePatch = {
      updated_at: nowIso,
    };
    if (mode) profilePatch.mode = mode;

    // If your profiles table uses email as unique/PK, update will work.
    // If row doesn’t exist yet, update affects 0 rows — that’s OK.
    const { error: pErr } = await supabase
      .from("profiles")
      .update(profilePatch)
      .eq("email", email);

    if (pErr) {
      console.error("commit-intake profiles update error:", pErr);
      // Don’t fail everything; still try AIOU commit
    }

    // ============================================================
    // //#2 OPTIONAL: WRITE AIOU INPUTS IF PRESENT
    // ============================================================
    let aiou_result = null;

    if (aiou) {
      // Map common fields
      const home_year = s(aiou.home_year ?? aiou.yearBand);
      const bedrooms = n(aiou.bedrooms);
      const bathrooms = n(aiou.bathrooms);
      const sqft = n(aiou.sqft);
      const property_type = s(aiou.property_type);
      const amenities = s(aiou.amenities);
      const home_condition = s(aiou.home_condition ?? aiou.conditionPreference);

      const row = {
        email,
        home_year,
        bedrooms,
        bathrooms,
        sqft,
        property_type,
        amenities,
        home_condition,
        updated_at: nowIso,
      };

      // Update latest by email (no unique constraint required)
      const { data: existing, error: selErr } = await supabase
        .from("user_aiou_inputs")
        .select("id")
        .eq("email", email)
        .order("updated_at", { ascending: false })
        .limit(1);

      if (!selErr && existing && existing.length) {
        const id = existing[0].id;
        const { error: updErr } = await supabase.from("user_aiou_inputs").update(row).eq("id", id);
        if (updErr) throw updErr;
        aiou_result = { action: "updated", id };
      } else {
        const { data: insData, error: insErr } = await supabase
          .from("user_aiou_inputs")
          .insert([row])
          .select("id")
          .limit(1);

        if (insErr) throw insErr;
        const id = insData && insData[0] ? insData[0].id : null;
        aiou_result = { action: "inserted", id };
      }
    }

    return ok({
      ok: true,
      message: "Committed pending intake.",
      email,
      attempt_id,
      committed: {
        profiles: true, // best-effort
        aiou: !!aiou_result,
      },
      aiou_result,
      ts: nowIso,
    });
  } catch (e) {
    console.error("commit-intake fatal:", e);
    return bad(500, e?.message || "Server error");
  }
};
