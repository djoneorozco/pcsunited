// netlify/functions/elena/router.js
// ============================================================
// PCSUnited • Elena Router — Modular Skill Dispatcher
// Version: v1.0.0
//
// PURPOSE:
//  - Keep ask-elena.js small by routing questions to skill modules
//  - Skills live in: netlify/functions/elena/skills/*.js
//  - Each skill decides if it can handle a message (match) and returns a reply (handle)
//
// SKILL CONTRACT (recommended):
// module.exports = {
//   id: "pay",                  // required
//   priority: 50,               // optional (higher runs first), default 0
//   match: (text, ctx) => bool, // required
//   handle: async (text, ctx, helpers) => ({ reply, intent, data?, debug? }) // required
// }
//
// Notes:
//  - Router is CommonJS (require/module.exports) for Netlify Functions compatibility.
//  - Router auto-loads skills at runtime and caches them.
//  - Router never throws outward—errors are trapped and returned as safe replies.
// ============================================================

"use strict";

const fs = require("fs");
const path = require("path");

/* ============================================================
   //#1 — Config
============================================================ */
const SKILLS_DIR = path.join(__dirname, "skills");
const DATA_DIR = path.join(__dirname, "data");

// Cache across warm invocations
let __SKILLS_CACHE__ = null;
let __SKILLS_CACHE_META__ = null;

/* ============================================================
   //#2 — Small utilities
============================================================ */
function safeStr(x) {
  const s = String(x ?? "").trim();
  return s || "";
}

function lower(x) {
  return safeStr(x).toLowerCase();
}

function nowISO() {
  return new Date().toISOString();
}

function fileExists(fp) {
  try {
    return fs.existsSync(fp);
  } catch (_) {
    return false;
  }
}

function readJsonIfExists(fp) {
  try {
    if (!fileExists(fp)) return null;
    const raw = fs.readFileSync(fp, "utf8");
    return JSON.parse(raw);
  } catch (_) {
    return null;
  }
}

/* ============================================================
   //#3 — Skill loading (auto-discover + cache)
============================================================ */
function isSkillExport(obj) {
  return !!(
    obj &&
    typeof obj === "object" &&
    typeof obj.id === "string" &&
    obj.id.trim() &&
    typeof obj.match === "function" &&
    typeof obj.handle === "function"
  );
}

function loadSkillsFresh() {
  const result = [];
  const meta = {
    loadedAt: nowISO(),
    skillsDir: SKILLS_DIR,
    count: 0,
    ids: [],
    errors: [],
  };

  if (!fileExists(SKILLS_DIR)) {
    meta.errors.push(`Skills directory not found: ${SKILLS_DIR}`);
    meta.count = 0;
    meta.ids = [];
    return { skills: [], meta };
  }

  let files = [];
  try {
    files = fs.readdirSync(SKILLS_DIR);
  } catch (err) {
    meta.errors.push(`Cannot read skills directory: ${String(err)}`);
    return { skills: [], meta };
  }

  // Only .js files, ignore router.js, hidden, etc.
  const jsFiles = files
    .filter((f) => f.endsWith(".js"))
    .filter((f) => !f.startsWith("."));

  for (const file of jsFiles) {
    const full = path.join(SKILLS_DIR, file);
    try {
      // Bust require cache so edits deploy cleanly in dev;
      // In Netlify prod, warm invocations will still reuse cache unless code changes.
      delete require.cache[require.resolve(full)];

      const mod = require(full);
      // allow default export style: { default: { ... } }
      const skill = mod && mod.default ? mod.default : mod;

      if (!isSkillExport(skill)) {
        meta.errors.push(`Invalid skill export in ${file} (missing id/match/handle).`);
        continue;
      }

      // Normalize
      const normalized = {
        id: String(skill.id).trim(),
        priority: Number(skill.priority) || 0,
        match: skill.match,
        handle: skill.handle,
        description: safeStr(skill.description || ""),
      };

      result.push(normalized);
      meta.ids.push(normalized.id);
    } catch (err) {
      meta.errors.push(`Failed to load skill ${file}: ${String(err)}`);
    }
  }

  // Higher priority first, then stable alphabetical
  result.sort((a, b) => {
    const dp = (b.priority || 0) - (a.priority || 0);
    if (dp !== 0) return dp;
    return String(a.id).localeCompare(String(b.id));
  });

  meta.count = result.length;
  return { skills: result, meta };
}

function getSkillsCached({ forceReload = false } = {}) {
  if (!forceReload && __SKILLS_CACHE__ && Array.isArray(__SKILLS_CACHE__)) {
    return { skills: __SKILLS_CACHE__, meta: __SKILLS_CACHE_META__ || null };
  }

  const fresh = loadSkillsFresh();
  __SKILLS_CACHE__ = fresh.skills;
  __SKILLS_CACHE_META__ = fresh.meta;
  return fresh;
}

/* ============================================================
   //#4 — Knowledge pack loader (optional)
   - Put JSON in: netlify/functions/elena/data/*.json
   - Skills can use ctx.knowledge to answer without bloating code.
============================================================ */
function loadKnowledgePacks() {
  const knowledge = {
    // Always provide a place for structured knowledge
    packs: {},
    meta: { dir: DATA_DIR, loadedAt: nowISO(), files: [], errors: [] },
  };

  if (!fileExists(DATA_DIR)) return knowledge;

  let files = [];
  try {
    files = fs.readdirSync(DATA_DIR).filter((f) => f.endsWith(".json") && !f.startsWith("."));
  } catch (err) {
    knowledge.meta.errors.push(`Cannot read data dir: ${String(err)}`);
    return knowledge;
  }

  for (const f of files) {
    const full = path.join(DATA_DIR, f);
    const key = f.replace(/\.json$/i, "");
    const obj = readJsonIfExists(full);
    if (obj === null) {
      knowledge.meta.errors.push(`Failed to parse JSON: ${f}`);
      continue;
    }
    knowledge.packs[key] = obj;
    knowledge.meta.files.push(f);
  }

  return knowledge;
}

/* ============================================================
   //#5 — Built-in fallback responder (only used when no skill matches)
============================================================ */
function builtInFallback(text, ctx) {
  const t = lower(text);

  // Simple guardrails & helpful prompts.
  if (t.includes("va loan") || t.includes("va loans")) {
    return {
      intent: "fallback_va_loan",
      reply:
        "I can help — which part of VA loans are you asking about: eligibility, funding fee, entitlement, assumable loans, or how it affects your max purchase price? If you share your credit score + down payment plan, I can anchor the answer to your affordability rails too.",
      data: { topic: "va_loan" },
      debug: { fallback: true },
    };
  }

  if (t.includes("pcs") || t.includes("moving") || t.includes("orders")) {
    return {
      intent: "fallback_pcs",
      reply:
        "Got it. For PCS planning, tell me: your gaining base/location, your timeline, and whether you want to rent first or buy right away. I can map the steps + the financial guardrails from your profile.",
      data: { topic: "pcs" },
      debug: { fallback: true },
    };
  }

  if (t.includes("promotion") || t.includes("promote") || t.includes("testing") || t.includes("waps")) {
    return {
      intent: "fallback_promotions",
      reply:
        "I can help with promotion planning. Tell me your rank, career field (AFSC/MOS), and your target cycle. Do you want a study plan, a timeline, or a ‘what matters most’ checklist?",
      data: { topic: "promotions" },
      debug: { fallback: true },
    };
  }

  // Default generic fallback
  const name = safeStr(ctx?.profile?.first_name) || "there";
  return {
    intent: "fallback_general",
    reply:
      `I’m with you, ${name}. Tell me what you’re trying to decide: (1) pay/housing cap, (2) VA loan strategy, (3) PCS move plan, or (4) base/location guidance — and I’ll route it.`,
    data: { topic: "general" },
    debug: { fallback: true },
  };
}

/* ============================================================
   //#6 — Router entrypoint
============================================================ */
async function route(text, ctx, helpers = {}) {
  const message = safeStr(text);
  const safeCtx = ctx && typeof ctx === "object" ? ctx : {};
  const debugBase = {
    routerVersion: "v1.0.0",
    at: nowISO(),
    skillsDir: SKILLS_DIR,
    hasHelpers: !!helpers && Object.keys(helpers).length > 0,
  };

  // Attach knowledge packs (optional) so every skill can use them
  // NOTE: This is loaded each invocation to stay simple; you can cache later if desired.
  safeCtx.knowledge = safeCtx.knowledge || loadKnowledgePacks();

  // Load skills (cached)
  const { skills, meta } = getSkillsCached({ forceReload: false });

  // If no skills exist, do built-in fallback
  if (!skills || skills.length === 0) {
    const fb = builtInFallback(message, safeCtx);
    return {
      reply: fb.reply,
      intent: fb.intent || "fallback",
      data: fb.data || undefined,
      debug: Object.assign({}, debugBase, {
        loadedSkills: 0,
        skillIds: [],
        skillLoadMeta: meta || null,
        note: "No skills loaded. Using router built-in fallback.",
      }),
    };
  }

  // Evaluate match in priority order
  const t0 = Date.now();
  for (const skill of skills) {
    let matched = false;
    try {
      matched = !!skill.match(message, safeCtx);
    } catch (err) {
      // Bad skill match should not break routing
      continue;
    }

    if (!matched) continue;

    // Handle
    try {
      const out = await skill.handle(message, safeCtx, helpers);

      // Minimal validation
      const reply = safeStr(out?.reply);
      if (!reply) {
        // Skill matched but returned no reply; continue scanning others
        continue;
      }

      return {
        reply,
        intent: safeStr(out?.intent) || `skill:${skill.id}`,
        data: out?.data || undefined,
        debug: Object.assign({}, debugBase, {
          matchedSkill: skill.id,
          matchedPriority: skill.priority || 0,
          loadedSkills: skills.length,
          skillIds: skills.map((s) => s.id),
          skillLoadMeta: meta || null,
          routeMs: Date.now() - t0,
          skillDebug: out?.debug || undefined,
        }),
      };
    } catch (err) {
      // Skill matched but crashed—return safe, but include debug.
      return {
        intent: `skill_error:${skill.id}`,
        reply:
          "I hit a routing snag on that one. Try asking it a bit simpler (one question at a time), or tell me which category it is: pay, VA loan, PCS move, base/location, or promotions.",
        data: { error: String(err), skill: skill.id },
        debug: Object.assign({}, debugBase, {
          matchedSkill: skill.id,
          error: String(err),
          loadedSkills: skills.length,
          skillIds: skills.map((s) => s.id),
          skillLoadMeta: meta || null,
        }),
      };
    }
  }

  // No skill matched → built-in fallback
  const fb = builtInFallback(message, safeCtx);
  return {
    reply: fb.reply,
    intent: fb.intent || "fallback",
    data: fb.data || undefined,
    debug: Object.assign({}, debugBase, {
      loadedSkills: skills.length,
      skillIds: skills.map((s) => s.id),
      skillLoadMeta: meta || null,
      note: "No skill matched. Using router built-in fallback.",
      routeMs: Date.now() - t0,
    }),
  };
}

/* ============================================================
   //#7 — Exports
============================================================ */
module.exports = {
  route,

  // Optional helpers (handy for debugging locally)
  __debug: {
    getSkillsCached,
    loadSkillsFresh,
    loadKnowledgePacks,
  },
};
