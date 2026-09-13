const REST_BASE =
  process.env.HEROSMS_API_BASE ||
  "https://hero-sms.com/api/v1";

const LEGACY_BASE =
  process.env.HEROSMS_LEGACY_BASE ||
  "https://hero-sms.com/stubs/handler_api.php";

const REQUEST_TIMEOUT_MS = 20_000;
const CATALOG_CACHE_MS = 60_000;
const OFFERS_CACHE_MS = 30_000;

const cache = {
  services: null,
  servicesAt: 0,
  countries: null,
  countriesAt: 0,
  offers: new Map()
};

export class HeroSmsApiError extends Error {
  constructor(
    message,
    {
      status = 0,
      code = "api_error",
      details = "",
      payload = null
    } = {}
  ) {
    super(message);
    this.name = "HeroSmsApiError";
    this.status = Number(status) || 0;
    this.code = String(code || "api_error");
    this.details = String(details || "");
    this.payload = payload;
  }
}

function apiKey() {
  const key =
    process.env.HEROSMS_API_KEY ||
    process.env.hero_sms_api_key;

  if (!key) {
    throw new HeroSmsApiError(
      "HEROSMS_API_KEY is missing",
      { code: "config_error" }
    );
  }

  return String(key).trim();
}

function withTimeout() {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    REQUEST_TIMEOUT_MS
  );

  return { controller, timer };
}

function parseErrorPayload(
  status,
  payload,
  fallback = "HeroSMS API error"
) {
  const title =
    payload && typeof payload === "object"
      ? payload.title || payload.error || payload.status
      : "";

  const details =
    payload && typeof payload === "object"
      ? payload.details || payload.message || ""
      : String(payload || "");

  return new HeroSmsApiError(
    details || title || fallback,
    {
      status,
      code: title || `http_${status}`,
      details,
      payload
    }
  );
}

async function requestRest(
  path,
  {
    method = "GET",
    query = null,
    body = null
  } = {}
) {
  const url = new URL(
    `${String(REST_BASE).replace(/\/+$/, "")}${path}`
  );

  if (query && typeof query === "object") {
    for (const [key, value] of Object.entries(query)) {
      if (
        value !== undefined &&
        value !== null &&
        value !== ""
      ) {
        url.searchParams.set(key, String(value));
      }
    }
  }

  const { controller, timer } = withTimeout();

  try {
    const headers = {
      Authorization: `ApiKey ${apiKey()}`,
      Accept: "application/json"
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
    const raw = await response.text();

    let payload = null;

    if (raw) {
      try {
        payload = JSON.parse(raw);
      } catch {
        payload = raw;
      }
    } else {
      payload = {};
    }

    if (!response.ok) {
      throw parseErrorPayload(
        response.status,
        payload,
        `HeroSMS HTTP ${response.status}`
      );
    }

    return payload;
  } catch (error) {
    if (error instanceof HeroSmsApiError) {
      throw error;
    }

    if (error?.name === "AbortError") {
      throw new HeroSmsApiError(
        "HeroSMS request timed out",
        { code: "timeout" }
      );
    }

    throw new HeroSmsApiError(
      String(
        error?.message ||
        error ||
        "HeroSMS network error"
      ),
      { code: "network_error" }
    );
  } finally {
    clearTimeout(timer);
  }
}

async function requestLegacy(action, params = {}) {
  const url = new URL(LEGACY_BASE);

  url.searchParams.set("action", action);
  url.searchParams.set("api_key", apiKey());

  for (const [key, value] of Object.entries(params)) {
    if (
      value !== undefined &&
      value !== null &&
      value !== ""
    ) {
      url.searchParams.set(key, String(value));
    }
  }

  const { controller, timer } = withTimeout();

  try {
    const response = await fetch(
      url,
      {
        headers: {
          Accept: "application/json"
        },
        signal: controller.signal
      }
    );

    const raw = await response.text();

    let payload = null;
    try {
      payload = raw ? JSON.parse(raw) : {};
    } catch {
      payload = raw;
    }

    if (!response.ok) {
      throw parseErrorPayload(
        response.status,
        payload,
        `HeroSMS legacy HTTP ${response.status}`
      );
    }

    if (
      typeof payload === "string" &&
      /^(BAD_|NO_|ERROR|WRONG_|ACCESS_DENIED|ACCOUNT_)/i.test(
        payload
      )
    ) {
      throw new HeroSmsApiError(
        payload,
        {
          code: payload.split(":")[0],
          payload
        }
      );
    }

    return payload;
  } catch (error) {
    if (error instanceof HeroSmsApiError) {
      throw error;
    }

    if (error?.name === "AbortError") {
      throw new HeroSmsApiError(
        "HeroSMS request timed out",
        { code: "timeout" }
      );
    }

    throw new HeroSmsApiError(
      String(
        error?.message ||
        error ||
        "HeroSMS network error"
      ),
      { code: "network_error" }
    );
  } finally {
    clearTimeout(timer);
  }
}

export function virtualNumberSellingPrice(providerPrice) {
  const price = Number(providerPrice || 0);

  if (!Number.isFinite(price) || price < 0) {
    return 0;
  }

  // Exact business rule: API price + 40%.
  return Number((price * 1.4).toFixed(4));
}

export function extractProviderPrice(offer) {
  if (!offer || typeof offer !== "object") {
    return 0;
  }

  const priceMap =
    offer.map && typeof offer.map === "object"
      ? offer.map
      : {};

  const availablePrices =
    Object.entries(priceMap)
      .filter(([, count]) => Number(count) > 0)
      .map(([price]) => Number(price))
      .filter(
        (price) =>
          Number.isFinite(price) &&
          price > 0
      );

  if (availablePrices.length) {
    return Math.min(...availablePrices);
  }

  const candidates = [
    offer?.prices?.min,
    offer?.prices?.default,
    offer?.prices?.retail
  ]
    .map(Number)
    .filter(
      (price) =>
        Number.isFinite(price) &&
        price > 0
    );

  return candidates.length
    ? Math.min(...candidates)
    : 0;
}

export async function getHeroSmsServices({
  fresh = false
} = {}) {
  const now = Date.now();

  if (
    !fresh &&
    cache.services &&
    now - cache.servicesAt < CATALOG_CACHE_MS
  ) {
    return cache.services;
  }

  const payload =
    await requestLegacy(
      "getServicesList",
      { lang: "en" }
    );

  const services = Array.isArray(payload?.services)
    ? payload.services
    : Array.isArray(payload)
      ? payload
      : [];

  const normalized = services
    .map((item) => ({
      code: String(
        item?.code || item?.id || ""
      ).trim(),
      name: String(
        item?.name ||
        item?.title ||
        item?.code ||
        ""
      ).trim()
    }))
    .filter(
      (item) =>
        item.code &&
        item.name
    );

  cache.services = normalized;
  cache.servicesAt = now;

  return normalized;
}

export async function getHeroSmsCountries({
  fresh = false
} = {}) {
  const now = Date.now();

  if (
    !fresh &&
    cache.countries &&
    now - cache.countriesAt < CATALOG_CACHE_MS
  ) {
    return cache.countries;
  }

  const payload =
    await requestLegacy("getCountries");

  const countries =
    Array.isArray(payload)
      ? payload
      : Array.isArray(payload?.countries)
        ? payload.countries
        : [];

  const normalized = countries
    .map((item) => ({
      id: Number(item?.id),
      name: String(
        item?.eng ||
        item?.name ||
        item?.rus ||
        item?.id ||
        ""
      ).trim(),
      visible:
        item?.visible === undefined
          ? true
          : Number(item.visible) === 1
    }))
    .filter(
      (item) =>
        Number.isFinite(item.id) &&
        item.name &&
        item.visible
    );

  cache.countries = normalized;
  cache.countriesAt = now;

  return normalized;
}

export async function getHeroSmsOffers({
  verificationType = "sms",
  service = "",
  country = "",
  fresh = false
} = {}) {
  const type =
    verificationType === "call"
      ? "call"
      : "sms";

  const key =
    `${type}|${service || "*"}|${country || "*"}`;

  const cached = cache.offers.get(key);
  const now = Date.now();

  if (
    !fresh &&
    cached &&
    now - cached.at < OFFERS_CACHE_MS
  ) {
    return cached.value;
  }

  const payload =
    await requestRest(
      `/activations/offers/${type}`,
      {
        query: {
          services: service || undefined,
          countries:
            country !== "" &&
            country !== null &&
            country !== undefined
              ? country
              : undefined
        }
      }
    );

  const value = {
    data:
      payload?.data &&
      typeof payload.data === "object"
        ? payload.data
        : {},
    meta: payload?.meta || {}
  };

  cache.offers.set(
    key,
    {
      at: now,
      value
    }
  );

  return value;
}

export async function getVirtualNumberServices({
  fresh = false
} = {}) {
  const [services, offers] =
    await Promise.all([
      getHeroSmsServices({ fresh }),
      getHeroSmsOffers({ fresh })
    ]);

  const availableCodes =
    new Set(
      Object.keys(offers.data || {})
    );

  const byCode =
    new Map(
      services.map(
        (service) => [
          service.code,
          service
        ]
      )
    );

  const result = [];

  for (const code of availableCodes) {
    const countries =
      offers.data?.[code] || {};

    const packageCount =
      Object.values(countries)
        .filter((offer) =>
          extractProviderPrice(offer) > 0 &&
          Number(
            offer?.counts?.total || 0
          ) > 0
        )
        .length;

    if (!packageCount) {
      continue;
    }

    const known = byCode.get(code);

    result.push({
      code,
      name:
        known?.name ||
        code.toUpperCase(),
      packageCount
    });
  }

  return result.sort(
    (a, b) =>
      a.name.localeCompare(
        b.name,
        "en",
        { sensitivity: "base" }
      )
  );
}

export async function getVirtualNumberPackages(
  serviceCode,
  {
    fresh = false
  } = {}
) {
  const code =
    String(serviceCode || "").trim();

  if (!code) {
    return [];
  }

  const [countries, offers] =
    await Promise.all([
      getHeroSmsCountries({ fresh }),
      getHeroSmsOffers({
        service: code,
        fresh
      })
    ]);

  const countryMap =
    new Map(
      countries.map(
        (country) => [
          String(country.id),
          country
        ]
      )
    );

  const serviceOffers =
    offers.data?.[code] || {};

  const packages = [];

  for (
    const [countryId, offer]
    of Object.entries(serviceOffers)
  ) {
    const providerPrice =
      extractProviderPrice(offer);

    const available =
      Number(
        offer?.counts?.total || 0
      );

    if (
      providerPrice <= 0 ||
      available <= 0
    ) {
      continue;
    }

    const country =
      countryMap.get(
        String(countryId)
      );

    packages.push({
      serviceCode: code,
      countryId:
        Number(countryId),
      countryName:
        country?.name ||
        `Country ${countryId}`,
      providerPrice,
      sellingPrice:
        virtualNumberSellingPrice(
          providerPrice
        ),
      available
    });
  }

  return packages.sort(
    (a, b) =>
      a.countryName.localeCompare(
        b.countryName,
        "en",
        { sensitivity: "base" }
      )
  );
}

export async function getVirtualNumberPackage(
  serviceCode,
  countryId,
  {
    fresh = true
  } = {}
) {
  const code =
    String(serviceCode || "").trim();

  const country =
    Number(countryId);

  const offers =
    await getHeroSmsOffers({
      service: code,
      country,
      fresh
    });

  const offer =
    offers.data?.[code]?.[
      String(country)
    ];

  if (!offer) {
    return null;
  }

  const providerPrice =
    extractProviderPrice(offer);

  const available =
    Number(
      offer?.counts?.total || 0
    );

  if (
    providerPrice <= 0 ||
    available <= 0
  ) {
    return null;
  }

  const countries =
    await getHeroSmsCountries();

  const countryInfo =
    countries.find(
      (item) =>
        Number(item.id) === country
    );

  return {
    serviceCode: code,
    countryId: country,
    countryName:
      countryInfo?.name ||
      `Country ${country}`,
    providerPrice,
    sellingPrice:
      virtualNumberSellingPrice(
        providerPrice
      ),
    available
  };
}

export async function buyVirtualNumber({
  serviceCode,
  countryId,
  providerPrice
}) {
  const payload =
    await requestRest(
      "/activations",
      {
        method: "POST",
        body: {
          service:
            String(serviceCode),
          country:
            Number(countryId),
          amount: 1,
          fixedPrice:
            Number(providerPrice),
          verificationType: "sms"
        }
      }
    );

  const activation =
    Array.isArray(payload?.data)
      ? payload.data[0]
      : null;

  if (!activation?.id) {
    throw new HeroSmsApiError(
      "HeroSMS returned no activation",
      {
        code: "invalid_response",
        payload
      }
    );
  }

  return activation;
}

export async function getVirtualNumberLastOtp(
  activationId
) {
  const payload =
    await requestRest(
      `/activations/${encodeURIComponent(
        String(activationId)
      )}/otp/last`
    );

  return payload?.data || null;
}

export async function getVirtualNumberOtpList(
  activationId
) {
  const payload =
    await requestRest(
      `/activations/${encodeURIComponent(
        String(activationId)
      )}/otp`
    );

  return Array.isArray(payload?.data)
    ? payload.data
    : [];
}

export async function cancelVirtualNumber(
  activationId
) {
  return requestRest(
    `/activations/${encodeURIComponent(
      String(activationId)
    )}`,
    { method: "DELETE" }
  );
}

export async function finishVirtualNumber(
  activationId
) {
  return requestRest(
    `/activations/${encodeURIComponent(
      String(activationId)
    )}/finish`,
    { method: "POST" }
  );
}
