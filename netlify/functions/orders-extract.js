// netlify/functions/orders-extract.js
// PCS Orders Translator — Option A (no file storage)
// v1.1.0 — FIX: better duty location + RNLTD heuristics, add extracted schema

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

function respond(statusCode, payload) {
  return { statusCode, headers: CORS_HEADERS, body: JSON.stringify(payload) };
}

function redactPII(raw) {
  if (!raw) return "";
  let t = raw;

  // SSN
  t = t.replace(/\b\d{3}-\d{2}-\d{4}\b/g, "[REDACTED_SSN]");
  t = t.replace(/\b\d{3}\s?\d{2}\s?\d{4}\b/g, "[REDACTED_SSN]");

  // DoD ID / long numeric identifiers (8–12 digits)
  t = t.replace(/\b\d{8,12}\b/g, "[REDACTED_ID]");

  // Emails
  t = t.replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[REDACTED_EMAIL]");

  return t;
}

function normZip(z) {
  const s = String(z || "").trim();
  // handle 9-digit "871170000" => take first 5 if last 4 are zeros
  if (/^\d{9}$/.test(s) && s.endsWith("0000")) return s.slice(0, 5);
  if (/^\d{5}$/.test(s)) return s;
  if (/^\d{5}-\d{4}$/.test(s)) return s.slice(0, 5);
  return s;
}

function formatDMY(d, mon, y) {
  const dd = String(d).padStart(2, "0");
  return `${dd} ${String(mon).toUpperCase()} ${String(y)}`;
}

function pickRNLTD(text) {
  if (!text) return null;

  // 1) Explicit RNLTD patterns
  // e.g., "... RNLTD ... 15 SEP 2024"
  {
    const m = text.match(/\bRNLTD\b[\s\S]{0,80}\b(\d{1,2})\s+(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\s+(\d{2,4})\b/i);
    if (m) return formatDMY(m[1], m[2], m[3].length === 2 ? `20${m[3]}` : m[3]);
  }

  // 2) "REPORT ... NLT:" patterns (sometimes the label is separated)
  {
    const m = text.match(/\b(NLT|REPORT\s+TO\s+COMDR)[\s\S]{0,120}\b(\d{1,2})\s+(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\s+(\d{4})\b/i);
    if (m) return formatDMY(m[2], m[3], m[4]);
  }

  // 3) Fallback: "SECURITY ... <date> <date>" (common in parsed text)
  // Your PDF shows: "... SECURITY ... 18 AUG 2010 31 JAN 2025 ..."
  {
    const m = text.match(/\bSECURITY\b[\s\S]{0,80}\b(\d{1,2})\s+(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\s+(\d{4})\s+(\d{1,2})\s+(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\s+(\d{4})\b/i);
    if (m) {
      // interpret: first date = last investigation, second date = reporting anchor
      return formatDMY(m[4], m[5], m[6]);
    }
  }

  return null;
}

function looksLikeStreet(place) {
  if (!place) return false;
  // catches "SUNDROP PL SE", "MAIN ST", etc
  return /\b(PL|PLACE|ST|STREET|RD|ROAD|DR|DRIVE|AVE|AVENUE|BLVD|BOULEVARD|LN|LANE|CT|COURT|WAY|PKWY|PARKWAY)\b/i.test(place);
}

function extractDutyLocations(text) {
  // Match: PLACE REGION ZIP(5 or 9 or 5-4)
  const re = /\b([A-Z][A-Z0-9'\/\-\.\s]{2,40})\s+(NM|TX|CA|FL|VA|WA|CO|AZ|NV|NC|SC|GA|AL|LA|OK|UT|ID|OR|IL|MD|PA|OH|MI|IN|MO|TN|KY|MS|AR|KS|NE|IA|MN|WI|ND|SD|NY|NJ|CT|MA|RI|VT|NH|ME|HI|AK|JP|DE|GB|IT|KR|BE|NL|ES|AP|AE|AA)\s+(\d{5}(?:-\d{4})?|\d{9})/g;

  const candidates = [];
  let m;
  while ((m = re.exec(text)) !== null) {
    const place = m[1].trim().replace(/\s{2,}/g, " ");
    const region = m[2];
    const zipRaw = m[3];
    const zip = normZip(zipRaw);

    // scoring: prefer duty locations, punish street-like tokens
    let score = 0;

    const nonUS = /^(JP|DE|GB|IT|KR|BE|NL|ES)$/.test(region);
    if (nonUS) score += 8;

    if (/\b(AFB|AB|AFB,| AB,)\b/.test(place)) score += 6;

    if (!looksLikeStreet(place)) score += 4;
    else score -= 6;

    // If it's near "KIRTLAND" or "KADENA" in your doc, it’s almost certainly the station line
    if (/\bKIRTLAND\b/i.test(place)) score += 8;
    if (/\bKADENA\b/i.test(place)) score += 8;

    candidates.push({
      place,
      region,
      zip,
      idx: m.index,
      score,
      raw: `${place} ${region} ${zipRaw}`,
    });
  }

  if (!candidates.length) return { losing: null, gaining: null };

  // pick gaining = best non-US if available, else best overall
  const sorted = [...candidates].sort((a, b) => b.score - a.score);
  const bestNonUS = sorted.find((c) => /^(JP|DE|GB|IT|KR|BE|NL|ES)$/.test(c.region));
  const gaining = bestNonUS || sorted[0];

  // pick losing = best US candidate occurring before gaining (fallback best US overall)
  const usCandidates = sorted.filter((c) => !/^(JP|DE|GB|IT|KR|BE|NL|ES)$/.test(c.region));
  let losing = usCandidates.find((c) => c.idx < gaining.idx) || usCandidates[0] || null;

  // guard: if losing==gaining (can happen if only one match), null out losing
  if (losing && gaining && losing.idx === gaining.idx) losing = null;

  return { losing, gaining };
}

function extractUnits(text) {
  // Very light heuristics for your specific parse:
  // GBS ... (losing-ish) and PAF ... (gaining-ish) appear near station lines.
  let losingUnit = null;
  let gainingUnit = null;

  const gbs = text.match(/\bGBS\s+\d+\s+([A-Z0-9 \-\/]{4,80})\b/i);
  if (gbs) losingUnit = gbs[1].trim().replace(/\s{2,}/g, " ");

  const paf = text.match(/\bPAF\s+\d+\s+([A-Z0-9 \-\/]{4,80})\b/i);
  if (paf) gainingUnit = paf[1].trim().replace(/\s{2,}/g, " ");

  return { losingUnit, gainingUnit };
}

function extractDependents(text) {
  if (!text) return "Unknown";

  // if the form explicitly shows concurrent travel is automatic
  if (/\bCONCURRENT\s+TRAVEL\s+IS\s+AUTOMATIC\b/i.test(text)) {
    return "Authorized (Concurrent travel automatic)";
  }

  if (/\bDEPENDENT(S)?\b/i.test(text) && /\b(CHILD|SPOUSE)\b/i.test(text)) {
    return "Likely Authorized (dependents detected)";
  }

  return "Unknown";
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: CORS_HEADERS, body: "" };
  }
  if (event.httpMethod !== "POST") {
    return respond(405, { ok: false, error: "Method Not Allowed" });
  }

  try {
    const body = JSON.parse(event.body || "{}");
    const filename = body.filename || "orders.pdf";
    const redact = body.redact !== false; // default true
    const rawText = String(body.text || "");

    if (!rawText || rawText.length < 50) {
      return respond(400, { ok: false, error: "Missing or too-short text" });
    }

    const text = redact ? redactPII(rawText) : rawText;

    const { losing, gaining } = extractDutyLocations(text);
    const rnltd = pickRNLTD(text);
    const { losingUnit, gainingUnit } = extractUnits(text);
    const dependents = extractDependents(text);

    const losingStr = losing ? `${losing.place}, ${losing.region} ${losing.zip}` : "Unknown";
    const gainingStr = gaining ? `${gaining.place}, ${gaining.region} ${gaining.zip}` : "Unknown";

    // confidence (simple, deterministic)
    const conf =
      gaining && losing && rnltd ? "high" :
      gaining && losing ? "medium" :
      gaining ? "medium" : "low";

    const extracted = {
      losingLocation: losingStr,
      gainingLocation: gainingStr,
      gainingUnit: gainingUnit || "",
      losingUnit: losingUnit || "",
      rnltd: rnltd || "",
      dependents,
      // best-effort: infer CONUS/OCONUS from gaining region
      conus: gaining ? !/^(JP|DE|GB|IT|KR|BE|NL|ES)$/.test(gaining.region) : null,
      tourType: gaining ? (/^(JP|DE|GB|IT|KR|BE|NL|ES)$/.test(gaining.region) ? "OCONUS" : "CONUS") : "",
      travelMode: "", // not reliably present in your parse yet
      assignmentType: "PCS",
      installation: gaining ? gaining.place : "",
    };

    const payload = {
      ok: true,
      meta: {
        filename,
        redactApplied: redact,
        source: "orders-extract.v1.1.0",
        confidence: conf,
      },

      // ✅ Add extracted for modules like 2B/2C/2D
      extracted,

      // Keep brief for the Shell cards
      brief: {
        assignment: {
          from: losingStr,
          to: gainingStr,
          reportNoLater: rnltd || "Unknown",
        },
        keyDetails: {
          reportNoLater: rnltd || "Unknown",
          losing: losingStr,
          gaining: gainingStr,
          dependents,
          unit: gainingUnit || "",
        },
        nextSteps: [
          "Schedule MPF out-processing + final out appointment",
          "Start TMO counseling / DPS flow",
          "Confirm Finance items (DLA/TLE/TLA as applicable)",
        ],
        importantNotes: [
          "OCONUS moves often require extra steps (medical, passports, etc.)",
          "Keep a redacted copy for housing/utilities (never share SSN)",
          "Always verify critical dates with MPF/TMO/Finance",
        ],
      },
    };

    return respond(200, payload);

  } catch (e) {
    return respond(500, { ok: false, error: "Server error", detail: String(e?.message || e) });
  }
};
