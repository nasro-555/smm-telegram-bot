const API_URL = "https://smmxserver.com/api/v2";

export const SMMX_SERVICE_GROUPS = {
  followers: {
    label: "فالوور",
    emoji: "👥",
    panelName: "پنل فالورای شماره یک",
    pricing: { mode: "add", value: 0.80 },
    ids: new Set([
      5911, 9238, 9239, 9240, 9241, 9242,
      10373, 10374, 10375, 10376,
      8613, 8614, 8615, 8616, 8617,
      12327, 12328, 12329, 12330
    ])
  },

  likes: {
    label: "لایک",
    emoji: "❤️",
    panelName: "پنل لایک شماره یک",
    pricing: { mode: "multiply", value: 2 },
    ids: new Set([
      3374, 3375, 3376, 3377, 3378, 3379,
      11882, 11883, 11884, 11885, 11886, 11887,
      12270, 12271, 12272, 12273, 12274, 12275,
      9730, 9731, 9732, 9733, 9734, 9735
    ])
  },

  views: {
    label: "ویو",
    emoji: "👁",
    panelName: "پنل ویو شماره یک",
    pricing: { mode: "multiply", value: 2 },
    ids: new Set([
      3209, 3210, 11165, 11164,
      12214, 12215, 12216, 12217, 12218,
      12219, 12220, 12221, 12222, 12223,
      11399, 11400
    ])
  },

  comments: {
    label: "کامنت",
    emoji: "💬",
    panelName: "پنل کامنت شماره یک",
    pricing: { mode: "add", value: 0.20 },
    ids: new Set([
      2970, 2971, 2972, 2973, 2974, 2975,
      12065, 12066, 12067, 12068,
      2672, 2673, 2674
    ])
  }
};

let cache = {
  at: 0,
  services: []
};

function apiKey() {
  const key = process.env.SMMXSERVER_API_KEY;
  if (!key) {
    throw new Error("SMMXSERVER_API_KEY is missing");
  }
  return key;
}

function groupConfig(kind) {
  const config = SMMX_SERVICE_GROUPS[kind];
  if (!config) {
    throw new Error(`Unknown SMMX service group: ${kind}`);
  }
  return config;
}

async function post(params) {
  const body = new URLSearchParams({
    key: apiKey(),
    ...Object.fromEntries(
      Object.entries(params)
        .filter(([, value]) => value !== undefined && value !== null)
        .map(([key, value]) => [key, String(value)])
    )
  });

  const response = await fetch(API_URL, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "user-agent": "SMM-Telegram-Bot/1.0"
    },
    body
  });

  if (!response.ok) {
    throw new Error(`SMMX HTTP ${response.status}`);
  }

  const text = await response.text();

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Invalid SMMX response: ${text.slice(0, 200)}`);
  }

  if (
    data &&
    typeof data === "object" &&
    !Array.isArray(data) &&
    data.error
  ) {
    throw new Error(String(data.error));
  }

  return data;
}

export async function getAllServices(force = false) {
  const now = Date.now();

  if (
    !force &&
    cache.services.length &&
    now - cache.at < 60_000
  ) {
    return cache.services;
  }

  const data = await post({ action: "services" });

  if (!Array.isArray(data)) {
    throw new Error("SMMX services response is not an array");
  }

  cache = {
    at: now,
    services: data
  };

  return data;
}

function normalizeService(item, kind) {
  const config = groupConfig(kind);

  const providerRate = Number(item.rate ?? 0);
  const providerMin = Number(item.min ?? 0);
  const providerMax = Number(item.max ?? 0);

  // Customer sees only this final rate.
  const sellingRate = Number((
    config.pricing.mode === "multiply"
      ? providerRate * config.pricing.value
      : providerRate + config.pricing.value
  ).toFixed(4));

  // User rule: never below 100, unless provider itself requires more.
  const min = Math.max(
    100,
    Number.isFinite(providerMin) && providerMin > 0
      ? providerMin
      : 100
  );

  // User rule: never above 1,000,000, and respect provider max.
  const max = Math.min(
    1_000_000,
    Number.isFinite(providerMax) && providerMax > 0
      ? providerMax
      : 1_000_000
  );

  const type = String(item.type ?? "");
  const normalizedType = type.toLowerCase();

  const customComments =
    kind === "comments" &&
    (
      normalizedType.includes("custom comment") ||
      normalizedType.includes("custom comments")
    );

  return {
    kind,
    service: Number(item.service),
    name: String(item.name ?? `Service ${item.service}`),
    type,
    category: String(item.category ?? ""),
    providerRate,
    sellingRate,
    min,
    max,
    refill: item.refill ?? null,
    cancel: item.cancel ?? null,
    customComments
  };
}

export async function getServices(kind) {
  const config = groupConfig(kind);
  const services = await getAllServices();

  return services
    .filter((item) => config.ids.has(Number(item.service)))
    .map((item) => normalizeService(item, kind))
    .filter((item) => item.max >= item.min)
    .sort((a, b) => a.service - b.service);
}

export async function getService(kind, serviceId) {
  const list = await getServices(kind);
  return list.find(
    (service) => service.service === Number(serviceId)
  ) ?? null;
}

export function getGroup(kind) {
  const config = groupConfig(kind);
  return {
    label: config.label,
    emoji: config.emoji,
    panelName: config.panelName,
    pricing: config.pricing
  };
}

export function calculateCustomerCharge(quantity, sellingRate) {
  return Number(
    ((Number(quantity) / 1000) * Number(sellingRate)).toFixed(4)
  );
}

export async function createOrder({
  service,
  link,
  quantity,
  comments
}) {
  const params = {
    action: "add",
    service,
    link
  };

  if (comments) {
    params.comments = comments;
  } else {
    params.quantity = quantity;
  }

  const data = await post(params);

  if (!data || data.order == null) {
    throw new Error("Provider did not return an order ID");
  }

  return data;
}

export async function getOrderStatus(orderId) {
  return post({
    action: "status",
    order: orderId
  });
}

export async function getProviderBalance() {
  return post({
    action: "balance"
  });
}

