// netlify/functions/elena/skills/profile.js
// ============================================================
// PCSUnited • Elena Skill: PROFILE — v1.0.0
// PURPOSE:
// - Deterministically answer profile questions (rank, YOS, base, family, mode)
// - Uses Supabase by email (service role) so Elena can "know who the user is"
// ============================================================

import { createClient } from "@supabase/supabase-js";

export const SKILL_NAME = "profile";

function safeStr(x){
  const s = String(x ?? "").trim();
  return s || "";
}
function lower(x){ return safeStr(x).toLowerCase(); }

function normEmail(email){
  const e = lower(email);
  return e.includes("@") ? e : "";
}

function wantsProfile(text){
  const t = lower(text);

  // Rank / paygrade / “what is my rank”
  if (t.includes("my rank") || t.includes("rank?") || t.includes("rank ") || t.includes("paygrade") || t.includes("pay grade")) return true;

  // YOS
  if (t.includes("yos") || t.includes("years of service") || t.includes("time in service")) return true;

  // Base / location
  if (t.includes("my base") || t.includes("base?") || t.includes("installation") || t.includes("stationed") || t.includes("gaining base")) return true;

  // “my profile”
  if (t.includes("my profile") || t.includes("my pcsunited profile") || t.includes("who am i") || t.includes("do you know me")) return true;

  return false;
}

function getSupabase(){
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars.");
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

async function fetchProfileByEmail(email){
  const supabase = getSupabase();

  // Keep this list tight + canonical. Add fields when you need them.
  const { data, error } = await supabase
    .from("profiles")
    .select("email, first_name, last_name, full_name, mode, rank, rank_paygrade, yos, family, base, va_disability")
    .eq("email", email)
    .maybeSingle();

  if (error) throw new Error(error.message || "Supabase profile query failed.");
  return data || null;
}

function fallbackFromHint(ctx){
  // If Supabase fails, we can still answer from the client “profile hint”
  const p = ctx?.profile && typeof ctx.profile === "object" ? ctx.profile : null;
  if (!p) return null;

  const out = {
    email: normEmail(p.email),
    full_name: safeStr(p.full_name),
    first_name: safeStr(p.first_name),
    last_name: safeStr(p.last_name),
    mode: safeStr(p.mode),
    rank_paygrade: safeStr(p.rank_paygrade || p.rank),
    yos: (p.yos != null && Number.isFinite(Number(p.yos))) ? Number(p.yos) : null,
    base: safeStr(p.base),
    family: (p.family != null ? p.family : null),
  };

  // only return if it’s actually useful
  if (out.rank_paygrade || out.yos != null || out.base || out.full_name || out.first_name) return out;
  return null;
}

function buildProfileReply(text, profile){
  const t = lower(text);

  const name =
    safeStr(profile.first_name) ||
    safeStr(profile.full_name).split(" ")[0] ||
    "";

  const rank = safeStr(profile.rank_paygrade || profile.rank);
  const yos = (profile.yos != null && Number.isFinite(Number(profile.yos))) ? Number(profile.yos) : null;
  const base = safeStr(profile.base);
  const mode = safeStr(profile.mode);

  // Specific Q: rank
  if (t.includes("rank") || t.includes("paygrade") || t.includes("pay grade")) {
    if (rank) return `Yep${name ? `, ${name}` : ""}. Your PCSUnited profile shows your rank/paygrade as **${rank}**.`;
    return `I’m not seeing a rank saved in your PCSUnited profile yet. If you tell me your rank (ex: E-6), I can save it and use it for pay + BAH instantly.`;
  }

  // Specific Q: YOS
  if (t.includes("yos") || t.includes("years of service") || t.includes("time in service")) {
    if (yos != null) return `You’re sitting at **${yos}** years of service (YOS) on your PCSUnited profile.`;
    return `I don’t see your YOS saved yet. Tell me your years of service and I’ll lock it in for pay + retirement estimates.`;
  }

  // Specific Q: base
  if (t.includes("base") || t.includes("installation") || t.includes("stationed") || t.includes("gaining")) {
    if (base) return `Your PCSUnited profile has your base as **${base}**.`;
    return `I don’t see a base saved in your profile yet. Tell me your base (or ZIP for BAH) and I’ll use that as your default.`;
  }

  // General profile
  const bits = [];
  if (rank) bits.push(`Rank: **${rank}**`);
  if (yos != null) bits.push(`YOS: **${yos}**`);
  if (base) bits.push(`Base: **${base}**`);
  if (mode) bits.push(`Mode: **${mode}**`);

  if (bits.length) {
    return `Got you${name ? `, ${name}` : ""}. Here’s what I’m reading from your PCSUnited profile:\n${bits.map(b => `• ${b}`).join("\n")}`;
  }

  return `I can read your PCSUnited profile, but it looks like your key fields (rank/YOS/base) aren’t saved yet. Want to tell me your rank + YOS + base so I can store them and answer instantly going forward?`;
}

export async function canHandle({ message }) {
  return wantsProfile(message);
}

export async function handle({ message, email, context }) {
  const em = normEmail(email);

  // If no email, we cannot fetch Supabase profile.
  if (!em) {
    return {
      reply:
        "I can pull your PCSUnited profile, but I don’t have your login email in this chat session. " +
        "Log in first (or refresh once logged in) and ask again: “what is my rank?”",
      ui: { speed: 18, startDelay: 120 },
    };
  }

  try {
    const prof = await fetchProfileByEmail(em);

    if (prof) {
      return {
        reply: buildProfileReply(message, prof),
        data: { profile: prof },
        ui: { speed: 18, startDelay: 120 },
      };
    }

    // No row found
    const hint = fallbackFromHint(context);
    if (hint) {
      return {
        reply:
          "I didn’t find a Supabase profile row for your email yet, but I *can* see a local profile hint on this device. " +
          buildProfileReply(message, hint),
        data: { profile_hint: hint },
        ui: { speed: 18, startDelay: 120 },
      };
    }

    return {
      reply:
        "I didn’t find your PCSUnited profile in Supabase yet. If you just created the account, it may not be saved — " +
        "or the email differs. Tell me your rank (ex: E-6) + YOS and I’ll align it.",
      ui: { speed: 18, startDelay: 120 },
    };

  } catch (err) {
    // Fallback to hint if Supabase is misconfigured
    const hint = fallbackFromHint(context);
    if (hint) {
      return {
        reply:
          "I hit a cloud lookup snag, but I *can* still answer from your local session data. " +
          buildProfileReply(message, hint),
        data: { error: String(err?.message || err), profile_hint: hint },
        ui: { speed: 18, startDelay: 120 },
      };
    }

    return {
      reply:
        "Sorry Sir, Seems like I misplaced a file somewhere. This usually means Supabase env vars aren’t set on Netlify " +
        "(SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY), or the profiles table query failed.",
      data: { error: String(err?.message || err) },
      ui: { speed: 18, startDelay: 120 },
    };
  }
}
