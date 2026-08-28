const API_URL = "https://smmxserver.com/api/v2";

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

export async function createSmmxOrder({
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

export async function getSmmxOrderStatus(orderId) {
  return post({
    action: "status",
    order: orderId
  });
}

export async function getSmmxBalance() {
  return post({ action: "balance" });
}

export async function requestSmmxRefill(orderId) {
  const data = await post({ action: "refill", order: orderId });
  if (!data || data.refill == null) {
    throw new Error(data?.error ? String(data.error) : "Provider did not return a refill ID");
  }
  return data;
}

export async function getSmmxRefillStatus(refillId) {
  return post({ action: "refill_status", refill: refillId });
}

export async function requestSmmxCancel(orderId) {
  const data = await post({ action: "cancel", orders: String(orderId) });
  const result = Array.isArray(data) ? (data.find((item) => String(item?.order) === String(orderId)) ?? data[0]) : data;
  if (!result) throw new Error("Provider returned an empty cancel response");
  if (result.error) throw new Error(String(result.error));
  const cancelValue = result.cancel;
  if (cancelValue === false || cancelValue === 0 || cancelValue === "0") {
    throw new Error("Cancel is no longer available for this order");
  }
  return result;
}
