import { INSTAGRAM_PANELS } from "./instagram.js";
import { FACEBOOK_PANELS } from "./facebook.js";
import { TIKTOK_PANELS } from "./tiktok.js";
import { YOUTUBE_PANELS } from "./youtube.js";
import {
  getAllServices,
  createSmmxOrder,
  getSmmxOrderStatus,
  getSmmxBalance
} from "./client.js";

export const providerCode = "smmx";
export const providerName = "smmxserver";

const PANEL_LIST = [
  ...INSTAGRAM_PANELS,
  ...FACEBOOK_PANELS,
  ...TIKTOK_PANELS,
  ...YOUTUBE_PANELS
];

const PANELS = new Map(
  PANEL_LIST.map((panel) => [
    panel.code,
    {
      ...panel,
      idSet: new Set(panel.ids)
    }
  ])
);

function panelConfig(panelCode) {
  const panel = PANELS.get(panelCode);

  if (!panel) {
    throw new Error(`Unknown smmxserver panel: ${panelCode}`);
  }

  return panel;
}

export function listPanels(platformSlug, categorySlug) {
  return PANEL_LIST
    .filter(
      (panel) =>
        panel.platformSlug === platformSlug &&
        panel.categorySlug === categorySlug
    )
    .map((panel) => ({
      providerCode,
      providerName,
      panelCode: panel.code,
      panelName: panel.panelName,
      label: panel.label,
      emoji: panel.emoji
    }));
}

export function getPanel(panelCode) {
  const panel = panelConfig(panelCode);

  return {
    providerCode,
    providerName,
    panelCode: panel.code,
    panelName: panel.panelName,
    platformSlug: panel.platformSlug,
    categorySlug: panel.categorySlug,
    label: panel.label,
    emoji: panel.emoji,
    pricing: panel.pricing
  };
}

function normalizeService(item, panel) {
  const providerRate = Number(item.rate ?? 0);
  const providerMin = Number(item.min ?? 0);
  const providerMax = Number(item.max ?? 0);

  const sellingRate = Number((
    panel.pricing.mode === "multiply"
      ? providerRate * panel.pricing.value
      : providerRate + panel.pricing.value
  ).toFixed(4));

  const min = Math.max(
    100,
    Number.isFinite(providerMin) && providerMin > 0
      ? providerMin
      : 100
  );

  const max = Math.min(
    1_000_000,
    Number.isFinite(providerMax) && providerMax > 0
      ? providerMax
      : 1_000_000
  );

  const type = String(item.type ?? "");
  const normalizedType = type.toLowerCase();

  const customComments =
    panel.categorySlug === "comments" &&
    (
      normalizedType.includes("custom comment") ||
      normalizedType.includes("custom comments")
    );

  return {
    providerCode,
    providerName,
    panelCode: panel.code,
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

export async function getServices(panelCode) {
  const panel = panelConfig(panelCode);
  const services = await getAllServices();

  return services
    .filter((item) => panel.idSet.has(Number(item.service)))
    .map((item) => normalizeService(item, panel))
    .filter((item) => item.max >= item.min)
    .sort((a, b) => a.service - b.service);
}

export async function getService(panelCode, serviceId) {
  const services = await getServices(panelCode);

  return services.find(
    (service) => service.service === Number(serviceId)
  ) ?? null;
}

export function calculateCharge(quantity, sellingRate) {
  return Number(
    ((Number(quantity) / 1000) * Number(sellingRate)).toFixed(4)
  );
}

export async function createOrder(data) {
  return createSmmxOrder(data);
}

export async function getOrderStatus(orderId) {
  return getSmmxOrderStatus(orderId);
}

export async function getBalance() {
  return getSmmxBalance();
}
