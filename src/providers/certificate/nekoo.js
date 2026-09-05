const DEFAULT_BASE_URL = "https://apis.nekoo.eu.org/api/v1";
const REQUEST_TIMEOUT_MS = 20_000;

export class CertificateApiError extends Error {
  constructor(message, { status = 0, code = "api_error", detail = "" } = {}) {
    super(message);
    this.name = "CertificateApiError";
    this.status = Number(status) || 0;
    this.code = String(code || "api_error");
    this.detail = String(detail || "");
  }
}

function apiKey() {
  const key = process.env.certificate_api_key;
  if (!key) {
    throw new CertificateApiError(
      "certificate_api_key is missing",
      { code: "config_error" }
    );
  }
  return key;
}

function baseUrl() {
  return String(
    process.env.certificate_api_base || DEFAULT_BASE_URL
  ).replace(/\/+$/, "");
}

function normalizePlanName(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function near(a, b, tolerance = 0.06) {
  return Math.abs(Number(a) - Number(b)) <= tolerance;
}

export function certificatePlanMarkup({
  apiCost,
  planName = "",
  device = "iphone"
} = {}) {
  const cost = Number(apiCost || 0);
  const name = normalizePlanName(planName);
  const type = String(device || "iphone").toLowerCase() === "ipad"
    ? "ipad"
    : "iphone";

  // Prefer the warranty period from the live API plan name.
  // This keeps the markup stable even if Nekoo changes the API cost later.
  const fullWarranty =
    name.includes("full warranty") ||
    name.includes("full-warranty");

  const monthMatch = name.match(
    /(?:^|\D)(1|2|3|5|10)\s*(?:month|months|mo|ماه)(?:\D|$)/
  );
  const months = monthMatch ? Number(monthMatch[1]) : null;

  if (type === "iphone") {
    if (fullWarranty) return 18;
    if (months === 1) return 13;
    if (months === 2) return 14;
    if (months === 3) return 15.5;
    if (months === 5) return 17;
    if (months === 10) return 18;

    // Fallback for current Nekoo costs if wording is different.
    if (near(cost, 1.30)) return 13;
    if (near(cost, 1.80)) return 14;
    if (near(cost, 3.00)) return 15.5;
    if (near(cost, 5.00)) return 17;
    if (near(cost, 6.00)) return 18;
    if (near(cost, 10.00)) return 18;
  }

  if (type === "ipad") {
    if (months === 1) return 6;
    if (months === 10) return 7;

    // Fallback for current Nekoo costs.
    if (near(cost, 1.00)) return 6;
    if (near(cost, 3.00)) return 7;
  }

  // Safe fallback for an unexpected new plan.
  // Can be overridden from Railway without changing code.
  const fallback = Number(process.env.certificate_markup ?? 0);
  return Number.isFinite(fallback) && fallback >= 0 ? fallback : 0;
}

export function certificateSellingPrice(
  apiCost,
  planName = "",
  device = "iphone"
) {
  const cost = Number(apiCost || 0);
  const markup = certificatePlanMarkup({
    apiCost: cost,
    planName,
    device
  });

  return Number((cost + markup).toFixed(2));
}

async function request(path, { method = "GET", query = null, body = null } = {}) {
  const url = new URL(`${baseUrl()}${path}`);

  if (query && typeof query === "object") {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== "") {
        url.searchParams.set(key, String(value));
      }
    }
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const headers = {
      "X-API-Key": apiKey(),
      "Accept": "application/json"
    };

    const options = {
      method,
      headers,
      signal: controller.signal
    };

    if (body !== null) {
      headers["Content-Type"] = "application/json";
      options.body = JSON.stringify(body);
    }

    const response = await fetch(url, options);
    const text = await response.text();

    let data = null;
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      throw new CertificateApiError(
        "Certificate API returned invalid JSON",
        { status: response.status, code: "invalid_response" }
      );
    }

    if (!response.ok || data?.ok === false) {
      throw new CertificateApiError(
        data?.detail || data?.error || `Certificate API HTTP ${response.status}`,
        {
          status: response.status,
          code: data?.error || `http_${response.status}`,
          detail: data?.detail || ""
        }
      );
    }

    return data;
  } catch (error) {
    if (error instanceof CertificateApiError) {
      throw error;
    }

    if (error?.name === "AbortError") {
      throw new CertificateApiError(
        "Certificate API request timed out",
        { code: "timeout" }
      );
    }

    throw new CertificateApiError(
      String(error?.message || error || "Certificate API request failed"),
      { code: "network_error" }
    );
  } finally {
    clearTimeout(timer);
  }
}

export async function getCertificateProfile() {
  return request("/me");
}

export async function getCertificatePlans(device = "iphone") {
  const data = await request("/plans", {
    query: device ? { device } : null
  });

  const plans = Array.isArray(data?.plans) ? data.plans : [];

  return plans
    .map((plan) => ({
      id: String(plan?.id ?? ""),
      plan_name: String(plan?.plan_name ?? plan?.name ?? "Plan"),
      cost: Number(plan?.cost ?? 0)
    }))
    .filter(
      (plan) =>
        plan.id &&
        Number.isFinite(plan.cost) &&
        plan.cost >= 0
    );
}

export async function registerCertificate({ udid, plan }) {
  return request("/register", {
    method: "POST",
    body: {
      udid: String(udid),
      plan: String(plan)
    }
  });
}

export async function getCertificate({ udid = null, certificateId = null } = {}) {
  if (!udid && !certificateId) {
    throw new CertificateApiError(
      "udid or certificate_id is required",
      { code: "missing_lookup" }
    );
  }

  return request("/certificate", {
    query: udid
      ? { udid }
      : { certificate_id: certificateId }
  });
}

export async function getCertificateUsage(limit = 50) {
  const safeLimit = Math.max(1, Math.min(200, Number(limit) || 50));
  return request("/usage", {
    query: { limit: safeLimit }
  });
}
