import crypto from "crypto";

const API_URL = "https://api.heleket.com/v1/payment";

function merchantId() {
  const value = process.env.HELEKET_MERCHANT_ID;
  if (!value) {
    throw new Error("HELEKET_MERCHANT_ID is missing");
  }
  return value;
}

function apiKey() {
  const value = process.env.HELEKET_PAYMENT_API_KEY;
  if (!value) {
    throw new Error("HELEKET_PAYMENT_API_KEY is missing");
  }
  return value;
}

function md5(value) {
  return crypto
    .createHash("md5")
    .update(value)
    .digest("hex");
}

function signBody(jsonBody) {
  const base64 = Buffer
    .from(jsonBody, "utf8")
    .toString("base64");

  return md5(base64 + apiKey());
}

export function publicBaseUrl() {
  const explicit = String(
    process.env.PUBLIC_BASE_URL ?? ""
  )
    .trim()
    .replace(/\/+$/, "");

  if (explicit) {
    return explicit.startsWith("http")
      ? explicit
      : `https://${explicit}`;
  }

  const railway = String(
    process.env.RAILWAY_PUBLIC_DOMAIN ?? ""
  )
    .trim()
    .replace(/\/+$/, "");

  if (!railway) {
    return null;
  }

  return railway.startsWith("http")
    ? railway
    : `https://${railway}`;
}

export async function createHeleketInvoice({
  amount,
  orderId,
  telegramId
}) {
  const baseUrl = publicBaseUrl();

  if (!baseUrl) {
    throw new Error(
      "PUBLIC_DOMAIN_MISSING"
    );
  }

  const payload = {
    amount: Number(amount).toFixed(2),
    currency: "USD",
    order_id: String(orderId),
    url_callback: `${baseUrl}/webhooks/heleket`,
    url_success: `${baseUrl}/heleket/success`,
    url_return: `${baseUrl}/heleket/return`,
    is_payment_multiple: true,
    additional_data: `telegram_${telegramId}`
  };

  const jsonBody = JSON.stringify(payload);
  const sign = signBody(jsonBody);

  const response = await fetch(API_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      merchant: merchantId(),
      sign
    },
    body: jsonBody
  });

  const text = await response.text();

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(
      `Invalid Heleket response: ${text.slice(0, 200)}`
    );
  }

  if (!response.ok) {
    throw new Error(
      `Heleket HTTP ${response.status}: ${text.slice(0, 300)}`
    );
  }

  if (data?.state !== 0 || !data?.result?.url) {
    const message =
      data?.message ||
      data?.result?.message ||
      JSON.stringify(data).slice(0, 300);

    throw new Error(
      `Heleket invoice error: ${message}`
    );
  }

  return data.result;
}

export function verifyHeleketWebhook(payload) {
  if (
    !payload ||
    typeof payload !== "object" ||
    Array.isArray(payload)
  ) {
    return false;
  }

  const receivedSign = String(
    payload.sign ?? ""
  );

  if (!receivedSign) {
    return false;
  }

  const unsigned = { ...payload };
  delete unsigned.sign;

  // Heleket documents PHP-style escaped slashes for webhook signing.
  const jsonBody = JSON
    .stringify(unsigned)
    .replace(/\//g, "\\/");

  const expected = signBody(jsonBody);

  const a = Buffer.from(receivedSign, "utf8");
  const b = Buffer.from(expected, "utf8");

  if (a.length !== b.length) {
    return false;
  }

  return crypto.timingSafeEqual(a, b);
}
