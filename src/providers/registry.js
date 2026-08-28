import * as smmxserver from "./smmxserver/index.js";

const PROVIDERS = new Map([
  [smmxserver.providerCode, smmxserver]
]);

function provider(providerCode) {
  const found = PROVIDERS.get(providerCode);

  if (!found) {
    throw new Error(`Unknown provider: ${providerCode}`);
  }

  return found;
}

export function listPanels(platformSlug, categorySlug) {
  const results = [];

  for (const item of PROVIDERS.values()) {
    results.push(
      ...item.listPanels(platformSlug, categorySlug)
    );
  }

  return results;
}

export function getPanel(providerCode, panelCode) {
  return provider(providerCode).getPanel(panelCode);
}

export async function getServices(providerCode, panelCode) {
  return provider(providerCode).getServices(panelCode);
}

export async function getService(
  providerCode,
  panelCode,
  serviceId
) {
  return provider(providerCode).getService(
    panelCode,
    serviceId
  );
}

export function calculateCharge(
  providerCode,
  quantity,
  sellingRate
) {
  return provider(providerCode).calculateCharge(
    quantity,
    sellingRate
  );
}

export async function createOrder(
  providerCode,
  data
) {
  return provider(providerCode).createOrder(data);
}

export async function getOrderStatus(
  providerCode,
  orderId
) {
  return provider(providerCode).getOrderStatus(orderId);
}

export function getProviderName(providerCode) {
  return provider(providerCode).providerName;
}

export async function requestRefill(providerCode, orderId) {
  return provider(providerCode).requestRefill(orderId);
}
export async function getRefillStatus(providerCode, refillId) {
  return provider(providerCode).getRefillStatus(refillId);
}
export async function requestCancel(providerCode, orderId) {
  return provider(providerCode).requestCancel(orderId);
}
