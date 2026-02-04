// netlify/functions/orders-extract.js
// ============================================================
// PCSUnited • Orders Extract (Option A: upload -> extract -> return JSON -> discard)
// v0.2 — FIX: CORS preflight (OPTIONS) + multipart parsing + safe no-storage flow
//
// Accepts: multipart/form-data with file field name "file"
// Optional: redact=true/false
//
// Returns JSON:
// { ok, meta:{...}, extracted:{...}, rawTextPreview, warnings:[...] }
//
// NOTE: This baseline intentionally does NOT store the file anywhere.
// ============================================================

import Busboy from "busboy";

// ---- CORS (allow your known origins; keep * if you’re okay with public access)
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
  "Content-Type": "application/json",
};

function json(statusCode, payload) {
  return {
    statusCode,
    headers: CORS_HEADERS,
    body: JSON.stringify(payload),
  };
}

function parseMultipart(event) {
  return new Promise((resolve, reject) => {
    const contentType =
      event.headers["content-type"] || event.headers["Content-Type"];
    if (!contentType || !contentType.includes("multipart/form-data")) {
      return reject(
        new Error("Expected multipart/form-data. Send file using FormData().")
      );
    }

    const bb = Busboy({ headers: { "content-type": contentType } });

    const fields = {};
    let fileBuffer = null;
    let fileInfo = null;

    bb.on("field", (name, val) => {
      fields[name] = val;
    });

    bb.on("file", (name, file, info) => {
      const { filename, mimeType } = info;
      const chunks = [];
      file.on("data", (d) => chunks.push(d));
      file.on("end", () => {
        fileBuffer = Buffer.concat(chunks);
        fileInfo = { fieldname: name, filename, mimeType, size: fileBuffer.length };
      });
    });

    bb.on("error", reject);
    bb.on("finish", () => resolve({ fields, fileBuffer, fileInfo }));

    // Netlify provides body as base64 for binary/multipart often.
    const body = event.isBase64Encoded
      ? Buffer.from(event.body || "", "base64")
      : Buffer.from(event.body || "", "utf8");

    bb.end(body);
  });
}

export async function handler(event) {
  try {
    // ✅ Fix 405 preflight
    if (event.httpMethod === "OPTIONS") {
      return { statusCode: 204, headers: CORS_HEADERS, body: "" };
    }

    if (event.httpMethod !== "POST") {
      return json(405, {
        ok: false,
        error: "Method Not Allowed",
        expected: "POST",
        got: event.httpMethod,
      });
    }

    const { fields, fileBuffer, fileInfo } = await parseMultipart(event);

    if (!fileBuffer || !fileInfo) {
      return json(400, {
        ok: false,
        error: "No file received.",
        hint: 'Send multipart/form-data with field name "file".',
      });
    }

    // Basic file type guard
    const isPdf =
      fileInfo.mimeType === "application/pdf" ||
      (fileInfo.filename || "").toLowerCase().endsWith(".pdf");
    const isImage =
      (fileInfo.mimeType || "").startsWith("image/") ||
      /\.(png|jpg|jpeg|webp)$/i.test(fileInfo.filename || "");

    if (!isPdf && !isImage) {
      return json(400, {
        ok: false,
        error: "Unsupported file type.",
        allowed: ["application/pdf", "image/*"],
        received: fileInfo.mimeType,
        filename: fileInfo.filename,
      });
    }

    const redact = String(fields.redact ?? "true") === "true";

    // ============================================================
    // TODO: REAL EXTRACTION
    // - For PDF: extract text (pdf-parse or similar)
    // - For Image: OCR (Tesseract or external service)
    //
    // Baseline now returns a placeholder to prove end-to-end wiring.
    // ============================================================

    const warnings = [];
    if (fileInfo.size > 10 * 1024 * 1024) {
      warnings.push("Large file: extraction may take longer.");
    }

    // Placeholder "extracted" payload structure that 2A can paint into your shell IDs
    const extracted = {
      assignment: {
        location: "Kadena AB, Japan",
        rnltd: null,
        unit: null,
        dependents: "Authorized (example)",
        travelMode: isPdf ? "See orders" : "See image",
      },
      nextSteps: [
        "Schedule TMO counseling / DPS setup",
        "Contact Finance (DLA / travel pay / GTCC questions)",
        "Confirm passports / medical clearance (OCONUS)",
      ],
      importantNotes: [
        "Verify RNLTD and earliest depart date with MPF",
        "Keep receipts for baggage fees if applicable",
        "Japan housing is smaller—plan shipment carefully",
      ],
    };

    return json(200, {
      ok: true,
      meta: {
        filename: fileInfo.filename,
        mimeType: fileInfo.mimeType,
        bytes: fileInfo.size,
        redact,
        stored: false, // ✅ Option A guarantee
      },
      extracted,
      rawTextPreview: null, // fill later once PDF parsing is added
      warnings,
    });
  } catch (err) {
    return json(500, {
      ok: false,
      error: "orders-extract failed",
      message: err?.message || String(err),
    });
  }
}
