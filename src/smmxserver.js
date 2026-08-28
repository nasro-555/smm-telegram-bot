const API_URL = "https://smmxserver.com/api/v2";

export const SMMX_FOLLOWER_SERVICE_IDS = new Set([
  5911, 9238, 9239, 9240, 9241, 9242,
  10373, 10374, 10375, 10376,
  8613, 8614, 8615, 8616, 8617,
  12327, 12328, 12329, 12330
]);

let cache = { at: 0, services: [] };

function apiKey() {
  const key = process.env.SMMXSERVER_API_KEY;
  if (!key) throw new Error("SMMXSERVER_API_KEY is missing");
  return key;
}

async function post(params) {
  const body = new URLSearchParams({
    key: apiKey(),
    ...Object.fromEntries(
      Object.entries(params).map(([k, v]) => [k, String(v)])
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

  if (!response.ok) throw new Error(`SMMX HTTP ${response.status}`);

  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Invalid SMMX response: ${text.slice(0, 200)}`);
  }

  if (data && typeof data === "object" && !Array.isArray(data) && data.error) {
    throw new Error(String(data.error));
  }

  return data;
}

export async function getAllServices(force = false) {
  const now = Date.now();

  if (!force && cache.services.length && now - cache.at < 60_000) {
    return cache.services;
  }

  const data = await post({ action: "services" });

  if (!Array.isArray(data)) {
    throw new Error("SMMX services response is not an array");
  }

  cache = { at: now, services: data };
  return data;
}

export async function getFollowerServices() {
  const services = await getAllServices();

  return services
    .filter((item) => SMMX_FOLLOWER_SERVICE_IDS.has(Number(item.service)))
    .map(normalizeService)
    .filter((item) => item.max >= item.min)
    .sort((a, b) => a.service - b.service);
}

export async function getFollowerService(serviceId) {
  const list = await getFollowerServices();
  return list.find((s) => s.service === Number(serviceId)) ?? null;
}

function normalizeService(item) {
  const providerRate = Number(item.rate ?? 0);
  const providerMin = Number(item.min ?? 0);
  const providerMax = Number(item.max ?? 0);

  const sellingRate = providerRate + 1;

  const min = Math.max(
    100,
    Number.isFinite(providerMin) ? providerMin : 100
  );

  const max = Math.min(
    1_000_000,
    Number.isFinite(providerMax) && providerMax > 0
      ? providerMax
      : 1_000_000
  );

  return {
    service: Number(item.service),
    name: String(item.name ?? `Service ${item.service}`),
    type: String(item.type ?? ""),
    category: String(item.category ?? ""),
    providerRate,
    sellingRate,
    min,
    max,
    refill: item.refill ?? null,
    cancel: item.cancel ?? null
  };
}

export function calculateCustomerCharge(quantity, sellingRate) {
  return Number(((Number(quantity) / 1000) * Number(sellingRate)).toFixed(4));
}

export async function createOrder({ service, link, quantity }) {
  const data = await post({
    action: "add",
    service,
    link,
    quantity
  });

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
  return post({ action: "balance" });
}

