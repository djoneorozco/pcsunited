// netlify/functions/elena/router.js
// ============================================================
// PCSUnited • Elena Router (CommonJS) — v1.1.0
// PURPOSE:
// - Provide ./elena/router.js exactly where ask-elena.js expects it
// - Load modular skills in ./skills/*
// - NEW: profile skill answers "what is my rank/yos/base" via Supabase
// ============================================================

"use strict";

const path = require("path");
const fs = require("fs");

/* ============================================================
  //#1 Helpers
============================================================ */
function safeStr(x){
  const s = String(x ?? "").trim();
  return s || "";
}
function lower(x){ return safeStr(x).toLowerCase(); }

function fileExists(fp){
  try { return fs.existsSync(fp); } catch(_) { return false; }
}

function requireFresh(fullPath){
  // Bust cache so deploy/dev changes reflect
  try { delete require.cache[require.resolve(fullPath)]; } catch(_) {}
  const mod = require(fullPath);
  return (mod && mod.default) ? mod.default : mod;
}

/* ============================================================
  //#2 Skill loader
============================================================ */
const SKILLS_DIR = path.join(__dirname, "skills");

function isSkill(mod){
  return !!(
    mod &&
    typeof mod === "object" &&
    typeof mod.canHandle === "function" &&
    typeof mod.handle === "function"
  );
}

function loadSkills(){
  const skills = [];
  const meta = { dir: SKILLS_DIR, loaded: [], errors: [] };

  if (!fileExists(SKILLS_DIR)){
    meta.errors.push(`Skills dir missing: ${SKILLS_DIR}`);
    return { skills, meta };
  }

  let files = [];
  try {
    files = fs.readdirSync(SKILLS_DIR).filter(f => f.endsWith(".js") && !f.startsWith("."));
  } catch (e){
    meta.errors.push(`Cannot read skills dir: ${String(e)}`);
    return { skills, meta };
  }

  for (const f of files){
    const full = path.join(SKILLS_DIR, f);
    try{
      const mod = requireFresh(full);
      if (!isSkill(mod)){
        meta.errors.push(`Invalid skill export in ${f} (needs canHandle + handle).`);
        continue;
      }
      const name = safeStr(mod.SKILL_NAME || f.replace(/\.js$/i,""));
      const priority = Number(mod.PRIORITY || 0) || 0;
      skills.push({ name, priority, mod });
      meta.loaded.push(name);
    } catch (e){
      meta.errors.push(`Failed loading ${f}: ${String(e)}`);
    }
  }

  // Priority DESC (highest first)
  skills.sort((a,b) => (b.priority||0) - (a.priority||0));

  return { skills, meta };
}

/* ============================================================
  //#3 Route
============================================================ */
async function route(message, ctx){
  const text = safeStr(message);
  const context = (ctx && typeof ctx === "object") ? ctx : {};
  const t = lower(text);

  const { skills, meta } = loadSkills();

  // If nothing loads, fallback
  if (!skills.length){
    return {
      reply:
        "I can help — tell me what lane this is in:\n" +
        "1) Pay / promotion pay\n" +
        "2) Base / city estimates\n" +
        "3) Your PCSUnited profile\n\n" +
        "If it’s pay-related, include: rank (now + next), YOS, and base or ZIP for BAH.",
      intent: "fallback",
      debug: { note: "No skills loaded", meta }
    };
  }

  // Run skills
  for (const s of skills){
    try{
      const can = await s.mod.canHandle({ message: text, email: context.email, context });
      if (!can) continue;

      const out = await s.mod.handle({ message: text, email: context.email, context });

      const reply = safeStr(out && out.reply);
      if (reply){
        return {
          reply,
          intent: safeStr(out.intent) || `skill:${s.name}`,
          data: out.data,
          ui: out.ui,
          debug: { matched: s.name, skillsLoaded: meta.loaded, meta }
        };
      }
    } catch (e){
      return {
        reply:
          "I hit a routing snag on that one. Try asking one question at a time — rank, YOS, base, pay, or city targets.",
        intent: `skill_error:${s.name}`,
        data: { error: String(e) },
        debug: { matched: s.name, meta }
      };
    }
  }

  // Default fallback
  return {
    reply:
      "I can help — tell me what lane this is in:\n" +
      "1) Pay / promotion pay\n" +
      "2) Base / city estimates\n" +
      "3) Your PCSUnited profile\n\n" +
      "If it’s pay-related, include: rank (now + next), YOS, and base or ZIP for BAH.",
    intent: "fallback",
    debug: { note: "No skill matched", meta }
  };
}

module.exports = { route };
