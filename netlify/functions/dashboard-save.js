// netlify/functions/dashboard-save.js
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
  "Content-Type": "application/json"
};

function json(statusCode, body) {
  return {
    statusCode,
    headers: corsHeaders,
    body: JSON.stringify(body)
  };
}

function normEmail(v) {
  return String(v || "").trim().toLowerCase();
}

function nOrNull(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function iOrNull(v) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : null;
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function textOrNull(v) {
  const s = String(v ?? "").trim();
  return s ? s : null;
}

const MODULES = {
  "2C-1": {
    allowedPatchKeys: [
      "additional_income",
      "savings",
      "total_monthly_expenses"
    ],
    buildProfileUpdate(patch) {
      const out = {};

      if ("additional_income" in patch) {
        out.additional_income = Math.max(0, nOrNull(patch.additional_income) ?? 0);
      }

      if ("savings" in patch) {
        out.savings = Math.max(0, nOrNull(patch.savings) ?? 0);
      }

      if ("total_monthly_expenses" in patch) {
        out.total_monthly_expenses = Math.max(0, nOrNull(patch.total_monthly_expenses) ?? 0);
      }

      return out;
    }
  },

  "2D": {
    allowedPatchKeys: [
      "projected_home_price",
      "downpayment",
      "credit_score",
      "term_years",
      "property_tax_annual",
      "insurance_annual",
      "hoa_monthly",
      "pmi_monthly"
    ],
    buildProfileUpdate(patch) {
      const out = {};

      if ("projected_home_price" in patch) {
        out.projected_home_price = Math.max(0, iOrNull(patch.projected_home_price) ?? 0);
      }

      if ("downpayment" in patch) {
        out.downpayment = Math.max(0, iOrNull(patch.downpayment) ?? 0);
      }

      if ("credit_score" in patch) {
        out.credit_score = clamp(iOrNull(patch.credit_score) ?? 720, 300, 850);
      }

      // only keep these if those columns actually exist in profiles
      // remove them later if your profiles table does not have them
      if ("term_years" in patch) {
        out.term_years = clamp(iOrNull(patch.term_years) ?? 30, 1, 40);
      }

      if ("property_tax_annual" in patch) {
        out.property_tax_annual = Math.max(0, iOrNull(patch.property_tax_annual) ?? 0);
      }

      if ("insurance_annual" in patch) {
        out.insurance_annual = Math.max(0, iOrNull(patch.insurance_annual) ?? 0);
      }

      if ("hoa_monthly" in patch) {
        out.hoa_monthly = Math.max(0, iOrNull(patch.hoa_monthly) ?? 0);
      }

      if ("pmi_monthly" in patch) {
        out.pmi_monthly = Math.max(0, iOrNull(patch.pmi_monthly) ?? 0);
      }

      return out;
    }
  },

  "housing-options": {
    allowedPatchKeys: [
      "bedrooms",
      "bathrooms",
      "sqft",
      "property_type",
      "home_condition",
      "amenities"
    ],
    buildProfileUpdate(patch) {
      const out = {};

      if ("bedrooms" in patch) out.bedrooms = Math.max(0, iOrNull(patch.bedrooms) ?? 0);
      if ("bathrooms" in patch) out.bathrooms = Math.max(0, nOrNull(patch.bathrooms) ?? 0);
      if ("sqft" in patch) out.sqft = Math.max(0, iOrNull(patch.sqft) ?? 0);
      if ("property_type" in patch) out.property_type = textOrNull(patch.property_type);
      if ("home_condition" in patch) out.home_condition = textOrNull(patch.home_condition);

      if ("amenities" in patch) {
        out.amenities = Array.isArray(patch.amenities)
          ? patch.amenities.join(", ")
          : textOrNull(patch.amenities);
      }

      return out;
    }
  }
};

function sanitizePatchForModule(moduleName, patch) {
  const spec = MODULES[moduleName];
  if (!spec) return { safePatch: {}, profileUpdate: {} };

  const safePatch = {};
  for (const key of spec.allowedPatchKeys) {
    if (Object.prototype.hasOwnProperty.call(patch, key)) {
      safePatch[key] = patch[key];
    }
  }

  const profileUpdate = spec.buildProfileUpdate(safePatch);
  return { safePatch, profileUpdate };
}

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 204,
      headers: corsHeaders,
      body: ""
    };
  }

  if (event.httpMethod !== "POST") {
    return json(405, { ok: false, error: "Method not allowed" });
  }

  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return json(500, { ok: false, error: "Missing Supabase environment variables" });
  }

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return json(400, { ok: false, error: "Invalid JSON body" });
  }

  const email = normEmail(body.email);
  const moduleName = String(body.module || "").trim();
  const patch = body.patch && typeof body.patch === "object" ? body.patch : {};

  if (!email) return json(400, { ok: false, error: "Missing email" });
  if (!moduleName) return json(400, { ok: false, error: "Missing module" });
  if (!MODULES[moduleName]) {
    return json(400, { ok: false, error: `Unsupported module: ${moduleName}` });
  }

  const { safePatch, profileUpdate } = sanitizePatchForModule(moduleName, patch);

  if (!Object.keys(profileUpdate).length) {
    return json(400, {
      ok: false,
      error: "No allowed fields to save for this module"
    });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  try {
    const { data: existing, error: existingErr } = await supabase
      .from("profiles")
      .select("*")
      .eq("email", email)
      .maybeSingle();

    if (existingErr) {
      return json(500, { ok: false, error: existingErr.message || "Failed to load profile" });
    }

    if (!existing) {
      return json(404, { ok: false, error: `No profile found for ${email}` });
    }

    const { data: updated, error: updateErr } = await supabase
      .from("profiles")
      .update(profileUpdate)
      .eq("email", email)
      .select("*")
      .single();

    if (updateErr) {
      return json(500, { ok: false, error: updateErr.message || "Failed to update profile" });
    }

    return json(200, {
      ok: true,
      module: moduleName,
      email,
      safePatch,
      saved: profileUpdate,
      profile: updated
    });
  } catch (err) {
    return json(500, {
      ok: false,
      error: err?.message || "Unexpected server error"
    });
  }
}
