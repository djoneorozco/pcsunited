// ============================================================
// PCS Orders Translator — orders-extract
// v1.0.0
// Purpose:
// - Convert raw PCS orders text into structured Orders JSON
// - No storage, no logging, no PII persistence
// ============================================================

export async function handler(event) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  try {
    const { text, filename } = JSON.parse(event.body || "{}");
    if (!text) throw new Error("Missing text");

    const upper = text.toUpperCase();

    /* ============================================================
      #1 Deterministic Field Extraction
    ============================================================ */
    const find = (re) => {
      const m = upper.match(re);
      return m ? m[1].trim() : "";
    };

    const rnltd =
      find(/REPORT NO LATER THAN DATE[:\s]+(\d{1,2}\s\w+\s\d{4})/) ||
      find(/RNLTD[:\s]+(\d{1,2}\s\w+\s\d{4})/);

    const dependents =
      /DEPENDENTS AUTHORIZED/.test(upper)
        ? "Authorized"
        : /DEPENDENTS NOT AUTHORIZED/.test(upper)
        ? "Not Authorized"
        : "";

    const conus =
      /OCONUS|OVERSEAS|OUTSIDE CONTINENTAL/.test(upper)
        ? false
        : true;

    const assignmentType =
      /PERMANENT CHANGE OF STATION/.test(upper)
        ? "PCS"
        : "Assignment";

    const gainingUnit = find(/GAINING UNIT[:\s]+([A-Z0-9\s]+)/);
    const installation = find(/TO[:\s]+([A-Z\s]+BASE|[A-Z\s]+AFB|[A-Z\s]+AB)/);

    /* ============================================================
      #2 Build Output
    ============================================================ */
    const ordersJson = {
      meta: {
        filename,
        confidence: "medium",
        ts: Date.now()
      },

      extracted: {
        assignmentType,
        conus,
        gainingUnit,
        installation,
        rnltd: rnltd || "",
        dependents,
        tourType: conus ? "CONUS" : "OCONUS",
        travelMode: /POV/.test(upper) ? "POV Authorized" : ""
      },

      brief: {
        bluf: `This appears to be a ${assignmentType} ${
          conus ? "within CONUS" : "to an OCONUS location"
        }. Your report-no-later date is ${rnltd || "not clearly stated"}.
        Dependents: ${dependents || "not specified"}.`,
        details: {
          rnltd: rnltd || "",
          unit: gainingUnit,
          dependents,
          travel: /POV/.test(upper) ? "POV Authorized" : "Standard travel"
        }
      },

      checklist: {
        now72: [
          "Contact MPF to confirm assignment details",
          "Schedule TMO counseling",
          "Notify chain of command"
        ],
        next14: [
          "Coordinate finance briefing",
          "Begin housing research",
          "Review travel options"
        ],
        next30: [
          "Finalize travel dates",
          "Arrange lodging",
          "Prepare HHG shipment"
        ]
      },

      questions: {
        mpf: [
          "Can you confirm my RNLTD and reporting window?",
          "Are dependents fully authorized for this assignment?"
        ],
        tmo: [
          "What is my HHG weight allowance?",
          "Am I authorized POV shipment?"
        ],
        finance: [
          "When should I apply for DLA?",
          "What temporary lodging allowances apply?"
        ]
      }
    };

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*"
      },
      body: JSON.stringify(ordersJson)
    };

  } catch (err) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: "Unable to process orders" })
    };
  }
}
