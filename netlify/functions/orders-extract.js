// netlify/functions/orders-extract.js
// PCS Orders Translator — Option A (no file storage)
// v1.1.0 — POST {text} -> structured JSON (with redaction)
// ✅ ESM export (matches package.json: "type":"module")
// ✅ Returns fields that 2A paints: blufText, details{}, next_steps[], important_notes[]
// ✅ Also returns brief{} for backward compatibility
// ✅ If OCR/scanned PDF image is sent (pdf_base64/image_base64) -> 422 with clear message

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
  let t = String(raw);

  // SSN patterns
  t = t.replace(/\b\d{3}-\d{2}-\d{4}\b/g, "[REDACTED_SSN]");
  t = t.replace(/\b\d{3}\s?\d{2}\s?\d{4}\b/g, "[REDACTED_SSN]");

  // DoD ID / long numeric identifiers (8–12 digits)
  t = t.replace(/\b\d{8,12}\b/g, "[REDACTED_ID]");

  // Emails
  t = t.replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[REDACTED_EMAIL]");

  return t;
}

function pickFirstDate(text) {
  const m = text.match(/\b(\d{1,2})\s+(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\s+(\d{4})\b/i);
  if (!m) return null;
  const d = String(m[1]).padStart(2, "0");
  const mon = m[2].toUpperCase();
  const y = m[3];
  return `${d} ${mon} ${y}`;
}

function extractLocations(text) {
  const candidates = [];
  const re =
    /\b([A-Z][A-Z0-9'\- ]{2,30})\s+(NM|TX|CA|FL|VA|WA|CO|AZ|NV|NC|SC|GA|AL|LA|OK|UT|ID|OR|IL|MD|PA|OH|MI|IN|MO|TN|KY|MS|AR|KS|NE|IA|MN|WI|ND|SD|NY|NJ|CT|MA|RI|VT|NH|ME|HI|AK|JP|DE|GB|IT|KR|BE|NL|ES)\s+(\d{5})/g;

  let m;
  while ((m = re.exec(text)) !== null) {
    candidates.push({
      place: m[1].trim().replace(/\s{2,}/g, " "),
      region: m[2],
      zip: m[3],
    });
  }

  const losing = candidates[0] || null;
  const gaining = candidates[1] || null;
  return { losing, gaining, candidates };
}

function extractUnit(text) {
  // Try a few common patterns (very lightweight heuristic)
  const t = text.replace(/\s+/g, " ");

  const m1 = t.match(/\bGAINING\s+UNIT\b\s*[:\-]?\s*([A-Z0-9&'().,\- ]{4,80})/i);
  if (m1 && m1[1]) return m1[1].trim();

  const m2 = t.match(/\bUNIT\b\s*[:\-]?\s*([A-Z0-9&'().,\- ]{4,80})/i);
  if (m2 && m2[1]) return m2[1].trim();

  return null;
}

function extractDependents(text) {
  const t = text.toUpperCase();
  if (/(DEPENDENT|DEPENDENTS)\s+(AUTHORIZED|YES|AUTH)/.test(t)) return "Authorized";
  if (/(DEPENDENT|DEPENDENTS)\s+(NOT\s+AUTHORIZED|NO|NOT\s+AUTH)/.test(t)) return "Not Authorized";
  if (/DEPENDENT|DEPENDENTS|SPOUSE|CHILD/.test(t)) return "Likely Authorized (detected)";
  return "Unknown";
}

function extractTravelMode(text) {
  const t = text.replace(/\s+/g, " ");
  const m = t.match(/\b(MODE\s+OF\s+TRAVEL|TRAVEL\s+MODE)\b\s*[:\-]?\s*([A-Z0-9\/\-\s]{3,50})/i);
  if (m && m[2]) return m[2].trim();
  return "Unknown";
}

export const handler = async (event) => {
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

    const hasBase64 = !!(body.pdf_base64 || body.image_base64);
    const rawText = String(body.text || "");

    // If 2A fell back to base64, it means this was likely scanned/OCR needed.
    if ((!rawText || rawText.length < 50) && hasBase64) {
      return respond(422, {
        ok: false,
        error: "This file appears to be scanned (no selectable text). OCR is not enabled yet.",
        hint: "Try uploading a PDF with selectable text, or enable OCR in orders-extract later.",
        meta: { filename, redactApplied: redact, source: "orders-extract.v1.1.0" },
      });
    }

    if (!rawText || rawText.length < 50) {
      return respond(400, { ok: false, error: "Missing or too-short text" });
    }

    const text = redact ? redactPII(rawText) : rawText;

    const rnltd = pickFirstDate(text);
    const { losing, gaining } = extractLocations(text);

    const from = losing ? `${losing.place}, ${losing.region} ${losing.zip}` : "Unknown";
    const to = gaining ? `${gaining.place}, ${gaining.region} ${gaining.zip}` : "Unknown";

    const reportNoLater = rnltd || "Unknown";
    const unit = extractUnit(text) || (gaining ? `${gaining.place}` : "Unknown");
    const dependents = extractDependents(text);
    const travel = extractTravelMode(text);

    const blufText =
      (to !== "Unknown" && reportNoLater !== "Unknown")
        ? `Your Assignment: Move to ${to} by ${reportNoLater}.`
        : "Orders interpreted — review your brief below.";

    const next_steps = [
      "Schedule MPF out-processing + final out appointment",
      "Start TMO counseling / DPS move flow",
      "Confirm Finance items (DLA/TLE/TLA as applicable)",
    ];

    const important_notes = [
      "OCONUS moves often require extra steps (medical, passports, clearances).",
      "Keep a redacted copy for housing/utilities (never share SSN).",
      "Always verify critical dates with MPF/TMO/Finance.",
    ];

    // ✅ This structure matches your 2A painter paths
    const payload = {
      ok: true,
      meta: {
        filename,
        redactApplied: redact,
        source: "orders-extract.v1.1.0",
      },

      // 2A-friendly fields
      blufText,
      details: {
        rnltd: reportNoLater,
        unit,
        dependents,
        travel,
        losing: from,
        gaining: to,
      },
      next_steps,
      important_notes,

      // Back-compat / alternate consumption
      brief: {
        assignment: {
          from,
          to,
          reportNoLater,
        },
        keyDetails: {
          reportNoLater,
          losing: from,
          gaining: to,
          unit,
          dependents,
          travel,
        },
        nextSteps: next_steps,
        importantNotes: important_notes,
      },
    };

    return respond(200, payload);

  } catch (e) {
    return respond(500, { ok: false, error: "Server error", detail: String(e?.message || e) });
  }
};
