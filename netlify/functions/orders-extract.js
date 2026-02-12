// netlify/functions/orders-extract.js
// PCS Orders Translator — Option A (no file storage)
// v1.1.0 — POST text -> structured JSON (safer extraction for AF PCS orders)

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

function normSpaces(s) {
  return String(s || "").replace(/\s+/g, " ").trim();
}

function toISO(ddMONyyyy) {
  // "18 AUG 2010" -> "2010-08-18"
  const m = /^\s*(\d{1,2})\s+(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\s+(\d{4})\s*$/i.exec(ddMONyyyy || "");
  if (!m) return "";
  const dd = String(m[1]).padStart(2, "0");
  const mon = m[2].toUpperCase();
  const yy = m[3];
  const map = { JAN:"01",FEB:"02",MAR:"03",APR:"04",MAY:"05",JUN:"06",JUL:"07",AUG:"08",SEP:"09",OCT:"10",NOV:"11",DEC:"12" };
  const mm = map[mon] || "01";
  return `${yy}-${mm}-${dd}`;
}

function extractRNLTD(text) {
  // Only accept a date if it appears near NLT/RNLTD/REPORT keywords.
  const t = text;

  const m1 = /(?:\bRNLTD\b|\bREPORT\s+NO\s+LATER\b|\bREPORT\s+NLT\b|\bNLT\b)\s*[:\-]?\s*([0-9]{1,2}\s+(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\s+\d{4}|\d{4}-\d{2}-\d{2})/i.exec(t);
  if (m1 && m1[1]) return normSpaces(m1[1]).toUpperCase();

  // Some PDFs show "NLT:" on one line, date on next line; allow short lookahead.
  const m2 = /\bNLT\s*:\s*\n\s*([0-9]{1,2}\s+(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\s+\d{4}|\d{4}-\d{2}-\d{2})/i.exec(t);
  if (m2 && m2[1]) return normSpaces(m2[1]).toUpperCase();

  return "";
}

function extractDependents(text) {
  const t = text.toUpperCase();
  if (t.includes("CONCURRENT TRAVEL IS AUTOMATIC")) return "Authorized (concurrent travel automatic)";
  if (/DEPENDENT\s+TRAVEL\s*:\s*X/i.test(text)) return "Authorized (check marked)";
  if (/DEPENDENT\s+TRAVEL/i.test(text) && /NOT\s+AUTHORIZED/i.test(text)) return "Not Authorized";
  return "";
}

function extractTravelMode(text) {
  // These orders often do not clearly state mode; attempt a light parse
  const m = /(MODE\s+OF\s+TRAVEL|TRAVEL\s+MODE)\s*[:\-]?\s*([A-Z0-9\/\-\s]{3,40})/i.exec(text);
  if (!m) return "";
  const v = normSpaces(m[2]);
  // avoid picking up junk
  if (v.length < 3) return "";
  return v;
}

function isStreety(line) {
  const L = line.toUpperCase();
  // Anything with a leading street number OR common street tokens should be rejected
  if (/\b\d{1,5}\b/.test(L)) return true;
  if (/\b(PL|PLACE|ST|STREET|RD|ROAD|AVE|AVENUE|DR|DRIVE|BLVD|LN|LANE|CT|COURT|CIR|CIRCLE|HWY|HIGHWAY)\b/.test(L)) return true;
  if (/\b(CHILD|SPOUSE)\b/.test(L)) return true;
  return false;
}

function isAdminBlock(line) {
  const L = line.toUpperCase();
  // AFPC relocations signature block should NOT be a losing/gaining location
  if (L.includes("AFPC")) return true;
  if (L.includes("RANDOLPH")) return true;
  if (L.includes("RELOCATIONS")) return true;
  return false;
}

function extractUnitLocationPairs(text) {
  // We want pairs like:
  //   "GBS 377 OP MED READINESS SQ FFNFM0"
  //   "KIRTLAND NM 871170000"
  // and
  //   "PAF 18 OP MED READINESS SQ FFM1L0"
  //   "KADENA JP 963680000"

  const lines = String(text || "")
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(Boolean);

  // Location line: "KADENA JP 963680000" or "AFPC RANDOLPH AFB TX 78150-0000"
  const locRe = /^([A-Z][A-Z0-9'\-\. ]{2,60})\s+(NM|TX|CA|FL|VA|WA|CO|AZ|NV|NC|SC|GA|AL|LA|OK|UT|ID|OR|IL|MD|PA|OH|MI|IN|MO|TN|KY|MS|AR|KS|NE|IA|MN|WI|ND|SD|NY|NJ|CT|MA|RI|VT|NH|ME|HI|AK|JP|DE|GB|IT|KR|BE|NL|ES)\s+(\d{5})(?:[-\s]?\d{4})?(\d{0,4})?$/;

  const pairs = [];

  for (let i = 0; i < lines.length; i++) {
    const m = locRe.exec(lines[i]);
    if (!m) continue;

    const place = normSpaces(m[1]);
    const region = m[2];
    const zip = m[3];

    const line = lines[i];

    // Hard rejects
    if (isStreety(line)) continue;
    if (isAdminBlock(line)) continue;

    // Find unit line above (look back up to 3 lines)
    let unitLine = "";
    for (let k = 1; k <= 3; k++) {
      const j = i - k;
      if (j < 0) break;
      const candidate = normSpaces(lines[j]);
      // Prefer unit-ish lines: SQ/WG/GP/CC/FSS/etc
      if (/\b(SQ|SQUADRON|WG|WING|GP|GROUP|FSS|AFS|CC|MAJCOM|OP MED|READINESS)\b/i.test(candidate)) {
        unitLine = candidate;
        break;
      }
    }

    pairs.push({
      unit: unitLine,
      place,
      region,
      zip,
      raw: line,
    });
  }

  // Deduplicate by place+region+zip (PDFs can repeat)
  const seen = new Set();
  const uniq = [];
  for (const p of pairs) {
    const key = `${p.place}|${p.region}|${p.zip}`;
    if (seen.has(key)) continue;
    seen.add(key);
    uniq.push(p);
  }

  return uniq;
}

function computeConfidence(extracted) {
  let score = 0;
  if (extracted?.losingLocation) score += 2;
  if (extracted?.gainingLocation) score += 2;
  if (extracted?.gainingUnit) score += 1;
  if (extracted?.losingUnit) score += 1;
  if (extracted?.dependents) score += 1;
  if (extracted?.rnltd) score += 1;

  if (score >= 7) return "high";
  if (score >= 4) return "medium";
  return "low";
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
      return respond(400, {
        ok: false,
        error: "Missing or too-short text",
        hint: "This endpoint expects { text }. If sending images/PDF base64, enable OCR server-side first."
      });
    }

    const text = redact ? redactPII(rawText) : rawText;

    const pairs = extractUnitLocationPairs(text);

    const losing = pairs[0] || null;
    const gaining = pairs[1] || null;

    const rnltdRaw = extractRNLTD(text);
    const rnltdISO = rnltdRaw.includes("-") ? rnltdRaw : toISO(rnltdRaw);

    const dependents = extractDependents(text);
    const travelMode = extractTravelMode(text);

    const extracted = {
      assignmentType: "PCS",
      conus: gaining ? !["JP","DE","GB","IT","KR","BE","NL","ES"].includes(gaining.region) : null,
      tourType: gaining ? (["JP","DE","GB","IT","KR","BE","NL","ES"].includes(gaining.region) ? "OCONUS tour" : "CONUS assignment") : "",
      losingUnit: losing?.unit || "",
      gainingUnit: gaining?.unit || "",
      losingLocation: losing ? `${losing.place} ${losing.region} ${losing.zip}` : "",
      gainingLocation: gaining ? `${gaining.place} ${gaining.region} ${gaining.zip}` : "",
      installation: gaining ? `${gaining.place} ${gaining.region} ${gaining.zip}` : "",
      rnltd: rnltdISO || "",           // ISO if available; otherwise blank
      rnltd_display: rnltdRaw || "",   // "DD MON YYYY" if found; otherwise blank
      dependents: dependents || "",
      travelMode: travelMode || "",
    };

    const confidence = computeConfidence(extracted);

    // Build BLUF without inventing missing dates
    const toTxt = extracted.gainingLocation || "your next duty location";
    const fromTxt = extracted.losingLocation || "your current unit";
    const whenTxt = extracted.rnltd_display || (extracted.rnltd ? extracted.rnltd : "Not listed on this form (confirm with MPF)");
    const tourTxt = extracted.tourType ? `(${extracted.tourType})` : "";

    const blufText = `Your Assignment: Move from ${fromTxt} to ${toTxt} ${tourTxt}. Report NLT: ${whenTxt}.`;

    const brief = {
      blufText,
      assignment: {
        from: fromTxt,
        to: toTxt,
        reportNoLater: whenTxt,
      },
      keyDetails: {
        reportNoLater: whenTxt,
        newUnit: extracted.gainingUnit || "Not detected (confirm gaining unit)",
        dependents: extracted.dependents || "Unknown",
        travel: extracted.travelMode || "Unknown",
      },
      nextSteps: [
        "Schedule MPF out-processing + final out appointment",
        "Start TMO counseling / DPS flow",
        "Confirm Finance items (DLA/TLE/TLA as applicable)",
      ],
      importantNotes: [
        "OCONUS moves often require extra steps (medical, passports, port-call). Start early.",
        "Keep a redacted copy for housing/utilities (never share SSN/DoD ID).",
        "Always verify critical dates and entitlements with MPF/TMO/Finance.",
      ],
    };

    return respond(200, {
      ok: true,
      meta: {
        filename,
        redactApplied: redact,
        source: "orders-extract.v1.1.0",
        confidence,
      },
      extracted, // ✅ for 2B “What It Means”
      brief,     // ✅ for 2A cards
    });

  } catch (e) {
    return respond(500, { ok: false, error: "Server error", detail: String(e?.message || e) });
  }
};
