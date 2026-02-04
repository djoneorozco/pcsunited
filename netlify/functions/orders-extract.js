// netlify/functions/orders-extract.js
// PCS Orders Translator — Option A (no file storage)
// v1.0.0 — POST text -> structured JSON (with redaction)

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

function respond(statusCode, payload) {
  return { statusCode, headers: CORS_HEADERS, body: JSON.stringify(payload) };
}

function redactPII(raw) {
  if (!raw) return "";

  let t = raw;

  // SSN patterns (very rough; safe enough for redaction)
  t = t.replace(/\b\d{3}-\d{2}-\d{4}\b/g, "[REDACTED_SSN]");
  t = t.replace(/\b\d{3}\s?\d{2}\s?\d{4}\b/g, "[REDACTED_SSN]");

  // DoD ID / long numeric identifiers (8–12 digits)
  t = t.replace(/\b\d{8,12}\b/g, "[REDACTED_ID]");

  // Emails
  t = t.replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[REDACTED_EMAIL]");

  return t;
}

function pickFirstDate(text) {
  // Looks for patterns like "31 JAN 2025"
  const m = text.match(/\b(\d{1,2})\s+(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\s+(\d{4})\b/i);
  if (!m) return null;
  const d = String(m[1]).padStart(2, "0");
  const mon = m[2].toUpperCase();
  const y = m[3];
  return `${d} ${mon} ${y}`;
}

function extractLocations(text) {
  // Very simple “LOSING” / “GAINING” style inference based on your sample:
  // finds "... KIRTLAND NM 87117..." then "... KADENA JP 96368..."
  const candidates = [];
  const re = /\b([A-Z][A-Z0-9'\- ]{2,30})\s+(NM|TX|CA|FL|VA|WA|CO|AZ|NV|NC|SC|GA|AL|LA|OK|UT|ID|OR|IL|MD|PA|OH|MI|IN|MO|TN|KY|MS|AR|KS|NE|IA|MN|WI|ND|SD|NY|NJ|CT|MA|RI|VT|NH|ME|HI|AK|JP|DE|GB|IT|KR|BE|NL|ES)\s+(\d{5})/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    candidates.push({
      place: m[1].trim().replace(/\s{2,}/g, " "),
      region: m[2],
      zip: m[3],
    });
  }

  // heuristic: first is losing, second is gaining
  const losing = candidates[0] || null;
  const gaining = candidates[1] || null;

  return { losing, gaining };
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

    const rnltd = pickFirstDate(text); // heuristic
    const { losing, gaining } = extractLocations(text);

    const assignment = {
      from: losing ? `${losing.place}, ${losing.region} ${losing.zip}` : "Unknown",
      to: gaining ? `${gaining.place}, ${gaining.region} ${gaining.zip}` : "Unknown",
      reportNoLater: rnltd || "Unknown",
    };

    // Minimal “Brief” payload (2A/2B/2C/2D can paint these)
    const payload = {
      ok: true,
      meta: {
        filename,
        redactApplied: redact,
        source: "orders-extract.v1.0.0",
      },
      brief: {
        assignment,
        keyDetails: {
          reportNoLater: assignment.reportNoLater,
          losing: assignment.from,
          gaining: assignment.to,
          dependents: /CHILD|SPOUSE|DEPENDENT/i.test(text) ? "Likely Authorized (detected dependents)" : "Unknown",
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
