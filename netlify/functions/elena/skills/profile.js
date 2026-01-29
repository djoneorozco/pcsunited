// netlify/functions/elena/skills/profile.js
// ============================================================
// Skill: profile
// PURPOSE:
// - Answer "my rank / my YOS / my base / my profile" using Supabase profiles table
// ============================================================

"use strict";

function safeStr(x) {
  const s = String(x ?? "").trim();
  return s || "";
}
function lower(x) {
  return safeStr(x).toLowerCase();
}

function wantsRank(text) {
  const t = lower(text);
  return (
    t.includes("my rank") ||
    t.includes("what is my rank") ||
    (t.includes("rank") && t.includes("my")) ||
    t.includes("rank_paygrade") ||
    t.includes("paygrade")
  );
}

function wantsProfile(text) {
  const t = lower(text);
  return (
    wantsRank(t) ||
    t.includes("my profile") ||
    t.includes("who am i") ||
    t.includes("what do you know about me") ||
    t.includes("my yos") ||
    t.includes("years of service") ||
    t.includes("my base") ||
    t.includes("my family") ||
    t.includes("dependents")
  );
}

module.exports = {
  id: "profile",
  priority: 100, // run early

  match: (text, ctx) => {
    if (!text) return false;
    return wantsProfile(text);
  },

  handle: async (text, ctx, helpers = {}) => {
    const email = safeStr(ctx?.email).toLowerCase();
    if (!email || !email.includes("@")) {
      return {
        intent: "profile_missing_email",
        reply:
          "I can pull your PCSUnited profile, but I don’t have your email identity in this request. Log in first, then try again.",
      };
    }

    const supabase = helpers?.supabase;
    if (!supabase) {
      return {
        intent: "profile_supabase_not_configured",
        reply:
          "I can see your login identity, but Supabase isn’t available in this function environment yet. Make sure SUPABASE_URL and SUPABASE_SERVICE_KEY are set in Netlify.",
      };
    }

    const { data, error } = await supabase
      .from("profiles")
      .select("email, full_name, first_name, last_name, mode, rank, rank_paygrade, yos, base, family, va_disability")
      .eq("email", email)
      .maybeSingle();

    if (error) {
      return {
        intent: "profile_supabase_error",
        reply: "I tried to load your profile, but Supabase returned an error. Try again in a moment.",
        data: { error: String(error?.message || error) },
      };
    }

    if (!data) {
      return {
        intent: "profile_not_found",
        reply:
          "I found your login identity, but I don’t see a profile row for that email in Supabase yet. If you just signed up, try logging out and back in once.",
      };
    }

    const rank = safeStr(data.rank_paygrade || data.rank || "");
    const yos = (data.yos != null && Number.isFinite(Number(data.yos))) ? Number(data.yos) : null;
    const base = safeStr(data.base || "");
    const mode = safeStr(data.mode || "");

    // If user asked rank specifically, keep it tight and confident
    if (wantsRank(text)) {
      if (rank) {
        const bits = [];
        if (yos != null) bits.push(`YOS ${yos}`);
        if (base) bits.push(base);
        const tail = bits.length ? ` (${bits.join(" • ")})` : "";
        return {
          intent: "profile_rank",
          reply: `Your rank is **${rank}**${tail}.`,
          data: { rank, yos, base, mode },
        };
      }
      return {
        intent: "profile_rank_missing",
        reply:
          "I pulled your profile, but rank / paygrade is blank right now. Update it on your Profile Page and I’ll use it instantly.",
        data: { yos, base, mode },
      };
    }

    // Otherwise, summary
    const name = safeStr(data.first_name || data.full_name || "there");
    const lines = [];
    lines.push(`Here’s what I have for you, ${name}:`);
    lines.push(`• Rank: ${rank || "—"}`);
    lines.push(`• YOS: ${yos != null ? yos : "—"}`);
    lines.push(`• Base: ${base || "—"}`);
    lines.push(`• Mode: ${mode || "—"}`);

    return {
      intent: "profile_summary",
      reply: lines.join("\n"),
      data: { rank, yos, base, mode },
    };
  },
};
