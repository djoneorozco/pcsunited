// A.I.O.U → Executive Buyer Memo (5 paragraphs) — CORS-hardened (v1.2)
// UPDATE (v1.2):
// - ✅ Writes to Supabase public.profiles (upsert by email)
// - Accepts optional house/conditionPreference signals and tailors the playbook paragraph.
// - Backwards compatible: if not provided, defaults to your original guidance.

import { createClient } from "@supabase/supabase-js";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

/* ---------------- CORS helpers ---------------- */
const corsHeaders = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
  "Vary": "Origin",
};
const ok = (bodyObj) => ({ statusCode: 200, headers: corsHeaders, body: JSON.stringify(bodyObj) });
const bad = (code, message) => ({ statusCode: code, headers: corsHeaders, body: JSON.stringify({ ok: false, error: message }) });

/* ---------------- tiny utils ---------------- */
const lastNameOf = (full) => String(full || "").trim().split(/\s+/).slice(-1)[0] || "Client";
const toCurrency = (n, d = 0) => (Number(n) || 0).toLocaleString("en-US", {
  style: "currency", currency: "USD", minimumFractionDigits: d, maximumFractionDigits: d
});
const housingLane = (incomeMonthly) => ({ laneMin: incomeMonthly * 0.28, laneMax: incomeMonthly * 0.33 });

const safeStr = (v) => String(v ?? "").trim();
const isEmail = (s) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(s || "").trim());

function pickEmail(brief) {
  // Preferred: brief.email (your quiz should send this)
  const a = safeStr(brief?.email).toLowerCase();
  if (isEmail(a)) return a;

  // Fallbacks (non-breaking)
  const b = safeStr(brief?.profile?.email).toLowerCase();
  if (isEmail(b)) return b;

  const c = safeStr(brief?.identity?.email).toLowerCase();
  if (isEmail(c)) return c;

  return "";
}

// ensure exactly 5 <p> blocks without dependencies
function enforceFiveParagraphsFromText(text, fallbackBlocks) {
  let parts = String(text || "").split(/\n{2,}/).map(s => s.trim()).filter(Boolean);
  if (parts.length < 5) parts = fallbackBlocks.slice(0, 5);
  while (parts.length < 5) parts.push("");
  if (parts.length > 5) parts = parts.slice(0, 5);
  return parts.map(p => `<p>${p.replace(/</g, "&lt;")}</p>`).join("");
}

/* ---------------- condition guidance (NEW) ---------------- */
function conditionGuidance(conditionPreference, yearBand) {
  const c = String(conditionPreference || "").trim().toLowerCase();

  if (c === "new") {
    return {
      label: "New Home",
      yearText: yearBand || "0–1 years",
      playbook: "Focus on new builds or nearly-new homes. Verify builder reputation, HOA rules, and what is actually included (upgrades, lot premium). Treat inspection as a 'quality control' step (punch list, drainage, roofline, grading), and keep reserves for moving + initial setup rather than repairs."
    };
  }
  if (c === "light") {
    return {
      label: "Light Touch-Ups",
      yearText: yearBand || "2–7 years",
      playbook: "Target move-in-ready homes where the work is cosmetic: paint, fixtures, small landscaping, minor flooring. Still inspect the big systems (roof age, HVAC, water heater), but avoid projects that require multiple trades or extended timelines."
    };
  }
  if (c === "value_add" || c === "value-add" || c === "valueadd") {
    return {
      label: "$25K+ Upgrades",
      yearText: yearBand || "8+ years",
      playbook: "You’re open to value-add. That means you must protect your budget: require clean inspection scope, price concessions/credits, and carry a realistic reserve (at least $25K+) for repairs and upgrades. Prioritize structural/mechanical health first (roof, HVAC, plumbing, foundation) before cosmetic dreams."
    };
  }

  // default behavior (back-compat)
  return {
    label: "Balanced",
    yearText: yearBand || "5–10 years (or quality renovation)",
    playbook: "Focus on 5–10 year-old homes or quality renovations (clean inspection; recent roof/HVAC/water heater). Prefer open kitchen/living or outdoor space over an extra unused bedroom. Lock your top 3 must-haves (safety, location, design) before touring."
  };
}

/* ---------------- Supabase: upsert into public.profiles ---------------- */
async function upsertProfile({ email, firstName, lastName }) {
  if (!email) return { skipped: true, reason: "No email provided" };
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return { skipped: true, reason: "Supabase env vars not configured (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)" };
    // NOTE: not throwing so memo still returns even if Supabase isn't set up yet
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const first = safeStr(firstName);
  const last = safeStr(lastName);
  const payload = { email };

  // avoid overwriting existing names with blanks
  if (first) payload.first_name = first;
  if (last) payload.last_name = last;

  const full = [first, last].filter(Boolean).join(" ").trim();
  if (full) payload.full_name = full;

  if (Object.keys(payload).length <= 1) {
    return { skipped: true, reason: "No profile fields to update (names empty)" };
  }

  const { error } = await supabase
    .from("profiles")
    .upsert(payload, { onConflict: "email" });

  if (error) {
    return { ok: false, error: error.message };
  }
  return { ok: true };
}

/* ---------------- entry (ESM-safe for PCSUnited) ---------------- */
export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: corsHeaders, body: "" };
  if (event.httpMethod !== "POST") return bad(405, "Use POST");
  if (!OPENAI_API_KEY) return bad(500, "OPENAI_API_KEY not configured");

  let brief = {};
  try { brief = JSON.parse(event.body || "{}"); }
  catch { return bad(400, "Invalid JSON"); }

  const { profile = {}, scores = {}, archetype = "", psych = {}, house = {} } = brief;

  const first = String(profile.firstName || "").trim() || "Client";
  const last  = lastNameOf(`${profile.firstName || ""} ${profile.lastName || ""}`);
  const budgetMax = Number(profile.budgetMax || 0);
  const bedrooms  = Number(profile.bedrooms || 0);
  const setting   = String(profile.setting || "city");
  const safetyPriority = Number(profile.safetyPriority || 3);

  // NEW: accept condition fields if present
  const conditionPreference =
    house.conditionPreference ??
    profile.conditionPreference ??
    brief.conditionPreference ??
    null;

  const yearBand =
    house.yearBand ??
    brief.yearBand ??
    null;

  const cond = conditionGuidance(conditionPreference, yearBand);

  // Heuristic monthly income if not provided
  const assumedIncomeMonthly = Math.max(3500, Math.min(12000, budgetMax / 60));
  const lane = housingLane(assumedIncomeMonthly);

  // ✅ Email for profile write
  const email = pickEmail(brief);

  // Local fallback memo (5 blocks) — UPDATED P4 to reflect condition if provided
  const localBlocks = [
    `<strong>${last}</strong>, this memo turns your A.I.O.U profile into a plan. Archetype: <strong>${archetype || "Balanced Explorer"}</strong>. We’ll match homes to how you live and avoid regret buys.`,
    `Targets: keep housing near <strong>28–33%</strong> of income. With ~${toCurrency(assumedIncomeMonthly,0)}/mo income, aim for <strong>${toCurrency(lane.laneMin,0)}–${toCurrency(lane.laneMax,0)}</strong> all-in (PITI/HOA/PMI). Shop <strong>under</strong> your max price to leave room for inspection and upgrades.`,
    `Key risks: stretching budget for style, thin reserves, and surprise repair costs. We size payment first, then pick homes that fit your style and hosting needs.`,
    `${cond.playbook} Keep your touring decision rule simple: if it violates safety/location/payment, it’s a no—no matter how pretty it looks.`,
    `Next steps: pre-underwrite in the lane above, preview homes that hit your must-haves, and use seller credits/points to balance cash vs rate. CFPB: https://www.consumerfinance.gov/  • Free credit reports: https://www.annualcreditreport.com/`,
  ];

  const systemPrompt = `
You are "Elena", an Executive Real Estate Strategist. Write EXACTLY 5 short paragraphs, plain English, no headings.
P1: Greet with last name + purpose; mention archetype in one sentence.
P2: Dollar targets: housing lane 28–33% using monthly income estimate; show min–max in USD; advise shopping below max price.
P3: 2–3 biggest risks/blind spots tuned to scores.
P4: Action playbook tailored to conditionPreference:
    - If New Home: builder diligence + inspection for QC + inclusion list.
    - If Light Touch-Ups: cosmetic upgrades + big system checks.
    - If $25K+ Upgrades: reserve discipline + scope control + credits.
    Include 1–2 credible links (CFPB, AnnualCreditReport).
P5: Closing + next steps.
Style: crisp, friendly, no jargon, whole dollars only.
`;

  const userPrompt = `
INPUT:
${JSON.stringify({
  email: email || null,
  profile: { first, last, bedrooms, budgetMax, setting, safetyPriority },
  house: {
    conditionPreference: conditionPreference || null,
    yearBand: yearBand || null,
    guidanceLabel: cond.label,
    typicalYearText: cond.yearText
  },
  scores,
  archetype,
  psych,
  computed: {
    assumedIncomeMonthly: Math.round(assumedIncomeMonthly),
    housingLaneMin: Math.round(lane.laneMin),
    housingLaneMax: Math.round(lane.laneMax),
    guidance: {
      preferSetting: setting,
      conditionLabel: cond.label,
      yearBandText: cond.yearText
    }
  }
}, null, 2)}
Write the five paragraphs now.`;

  async function callOpenAI() {
    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0.4,
        messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }],
      }),
    });
    if (!resp.ok) throw new Error(`OpenAI HTTP ${resp.status} ${await resp.text()}`);
    const data = await resp.json();
    return data?.choices?.[0]?.message?.content?.trim() || "";
  }

  // ✅ Attempt profile write early (doesn't block memo)
  let profileWrite = { skipped: true, reason: "Not attempted" };
  try {
    if (isEmail(email)) {
      profileWrite = await upsertProfile({
        email,
        firstName: profile.firstName,
        lastName: profile.lastName
      });
    } else {
      profileWrite = { skipped: true, reason: "Missing/invalid email in brief payload" };
    }
  } catch (e) {
    profileWrite = { ok: false, error: String(e.message || e) };
  }

  try {
    const memoText = await callOpenAI();
    const memoHtml = enforceFiveParagraphsFromText(memoText, localBlocks);
    return ok({
      ok: true,
      memo: memoText,
      memoHtml,
      profileWrite,
      meta: {
        email: isEmail(email) ? email : null,
        archetype,
        scores,
        condition: {
          conditionPreference: conditionPreference || null,
          yearBand: yearBand || null,
          label: cond.label,
          typicalYearText: cond.yearText
        },
        assumedIncomeMonthly: Math.round(assumedIncomeMonthly),
        lane: { minMonthly: Math.round(lane.laneMin), maxMonthly: Math.round(lane.laneMax) }
      }
    });
  } catch (e) {
    const memoHtml = enforceFiveParagraphsFromText("", localBlocks);
    return ok({
      ok: false,
      error: String(e.message || e),
      memo: localBlocks.join("\n\n"),
      memoHtml,
      profileWrite,
      meta: {
        email: isEmail(email) ? email : null,
        fallback: true,
        archetype,
        scores,
        condition: {
          conditionPreference: conditionPreference || null,
          yearBand: yearBand || null,
          label: cond.label,
          typicalYearText: cond.yearText
        },
        assumedIncomeMonthly: Math.round(assumedIncomeMonthly),
        lane: { minMonthly: Math.round(lane.laneMin), maxMonthly: Math.round(lane.laneMax) }
      }
    });
  }
};
