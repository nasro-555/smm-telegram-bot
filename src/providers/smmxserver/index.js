import { INSTAGRAM_PANELS } from "./instagram.js";
import { FACEBOOK_PANELS } from "./facebook.js";
import { TIKTOK_PANELS } from "./tiktok.js";
import { YOUTUBE_PANELS } from "./youtube.js";
import { TELEGRAM_PANELS } from "./telegram.js";
import { TWITTER_PANELS } from "./twitter.js";
import {
  getAllServices,
  createSmmxOrder,
  getSmmxOrderStatus,
  getSmmxBalance,
  requestSmmxRefill,
  getSmmxRefillStatus,
  requestSmmxCancel
} from "./client.js";

export const providerCode = "smmx";
export const providerName = "smmxserver";

const SOURCE_PANELS = [
  ...INSTAGRAM_PANELS,
  ...FACEBOOK_PANELS,
  ...TIKTOK_PANELS,
  ...YOUTUBE_PANELS,
  ...TELEGRAM_PANELS,
  ...TWITTER_PANELS
];

const PANEL_GROUPS = {
  igf: [
    { code: "igfhq", label: "HQ Account", ids: [5911, 9238, 9239, 9240, 9241, 9242] },
    { code: "igfold", label: "Old Account", ids: [10373, 10374, 10375, 10376, 12327, 12328, 12329, 12330] },
    { code: "igfind", label: "India Account", ids: [8613, 8614, 8615, 8616, 8617] }
  ],
  igl: [
    { code: "iglin", label: "India Like Accounts", ids: [3374, 3375, 3376, 3377, 3378, 3379] },
    { code: "iglar", label: "Arab Accounts", ids: [11882, 11883, 11884, 11885, 11886, 11887] },
    { code: "iglhq", label: "HQ Accounts", ids: [12270, 12271, 12272, 12273, 12274, 12275] },
    { code: "iglpr", label: "Provider", ids: [9730, 9731, 9732, 9733, 9734, 9735] }
  ],
  igv: [
    { code: "igvins", label: "Instant Start", ids: [3209, 3210, 11165, 11164] },
    { code: "igvww", label: "World Wide [Target]", ids: [12214, 12215, 12216, 12217, 12218, 12219, 12220, 12221, 12222, 12223] },
    { code: "igvstory", label: "Story View", ids: [11399, 11400] }
  ],
  igc: [
    { code: "igcrand", label: "Random", ids: [2970, 2971, 2972, 2973, 2974, 2975] },
    { code: "igcreal", label: "Random Real Accounts", ids: [12065, 12066, 12067, 12068] },
    { code: "igclike", label: "Comment Like", ids: [2672, 2673, 2674], emoji: "❤️" }
  ],
  fbf: [
    { code: "fbfnorm", label: "Normal", ids: [6690, 7928, 7929, 7930, 7931, 7932, 7933] },
    { code: "fbfcheap", label: "Very Cheap", ids: [1847, 1848, 1849, 1850, 1851, 1852] },
    { code: "fbfhq", label: "HQ Accounts", ids: [7314, 7315, 7316, 7317, 7318, 7319] },
    { code: "fbfprs2", label: "Provider S2", ids: [9904, 9905, 9906, 9907, 9908, 9909] },
    { code: "fbfrocket", label: "Rocket Speed", ids: [1703, 1704, 1705, 1706, 1707, 1708], emoji: "🚀" },
    { code: "fbfhqs2", label: "HQ Accounts S2", ids: [12173, 12174, 12175, 12176, 12177, 12178] },
    { code: "fbfhqs3", label: "HQ Accounts S3", ids: [3201, 3202, 3203, 3204, 3205, 3206] }
  ],
  fbl: [
    { code: "fblworld", label: "Cheapest in the World", ids: [5051, 5052, 5053, 5054, 5055, 5056, 5057] },
    { code: "fblcheap", label: "Cheapest", ids: [11958, 11959, 11960, 11961, 11962, 11963, 11964] }
  ],
  ttf: [
    { code: "ttfreal", label: "Real Accounts", ids: [12000, 12001, 12002, 12003, 12004] },
    { code: "ttfnodrop", label: "Almost No Drop", ids: [3380, 3381, 3382, 3383, 3384, 3385] },
    { code: "ttflowdrop", label: "Very Low Drop", ids: [8352, 8353, 8354] },
    { code: "ttfusa", label: "USA 🇺🇸 + Mix", ids: [8355, 8356, 8357, 8358, 8359, 8360] }
  ],
  ttl: [
    { code: "ttlhq", label: "HQ Accounts", ids: [9791, 9792, 9793, 9794, 9795, 9796] },
    { code: "ttlusa", label: "USA 🇺🇸", ids: [8346, 8347, 8348, 8349, 8350, 8351] }
  ],
  ttv: [
    { code: "ttvcheap", label: "Very Cheap", ids: [11863, 11864, 11865, 11866, 11867, 11868, 11889, 11890] },
    { code: "ttvfast", label: "Super Fast", ids: [10483, 10484] }
  ],
  ttlive: [
    { code: "ttlivec", label: "Live Stream Comment", ids: [2253], emoji: "💬" },
    { code: "ttlivel", label: "Live Stream Like", ids: [2252], emoji: "❤️" },
    { code: "ttlivevp", label: "Live Stream View Provider", ids: [11949, 11950, 11951, 11952, 11953], emoji: "👁" },
    { code: "ttlivev", label: "Live Stream View", ids: [8973, 8974, 8975, 8976, 8977, 8978, 8979], emoji: "👁" }
  ],
  yts: [
    { code: "ytssuper", label: "Super Instant", ids: [12007, 12008, 12009, 12010, 12011] },
    { code: "ytshq", label: "HQ Accounts", ids: [12142, 12143, 12144, 12145, 12146] },
    { code: "ytslow", label: "Low Quality", ids: [2679, 12036, 12333, 12035, 12334] }
  ],
  tgm: [
    { code: "tgmins", label: "Instant", ids: [2692, 2693, 2694, 2695, 2697] },
    { code: "tgmhq", label: "HQ Accounts", ids: [11369, 11370, 11371, 11372, 11373, 11374] },
    { code: "tgmrec", label: "Recommended", ids: [1233, 1234, 1235, 1236, 1237] },
    { code: "tgmprov", label: "Provider", ids: [1749, 1750, 1751, 1752, 1753] },
    { code: "tgmfast", label: "Fast New", ids: [11965, 11966, 11967, 11968, 11969, 11970] }
  ],
  tgpm: [
    { code: "tgpmprov", label: "Provider New", ids: [12310, 12311, 12312, 12313, 12314, 12315] },
    { code: "tgpmprice", label: "Best Price", ids: [2699, 2700, 2701] }
  ],
  tgr: [
    {
      code: "tgrs1",
      label: "Pack of Random Reactions S1",
      ids: [
        6172, 6173, 6174, 6175, 6176, 6177, 6178, 6179,
        12365, 12366, 12367, 12368, 12369, 12370, 12371, 12372,
        12373, 12374, 12375, 12376, 12377, 12378, 12379, 12380,
        12381, 12382, 12383, 12384, 12385, 12386, 12387, 12388,
        12389
      ]
    },
    {
      code: "tgrs2",
      label: "Pack of Reactions S2",
      ids: [
        12390, 12391, 12392, 12393, 12394, 12395, 12396, 12397,
        12398, 12399, 12400, 12401, 12402, 12403, 12404, 12405,
        12406, 12407, 12408, 12409, 12410, 12411, 12412, 12413,
        12414, 12415, 12416, 12417, 12418, 12419, 12420, 12421,
        12422, 12423, 12424, 12425, 12426, 12427, 12428, 12429,
        12430, 12431, 12432, 12433, 12434, 12435, 12436
      ]
    },
    {
      code: "tgrrand",
      label: "Random",
      ids: [
        12461, 12462, 12463, 12464, 12465, 12466, 12467, 12468,
        12469, 12470, 12471, 12472, 12473, 12474, 12475, 12476,
        12477, 12478, 12479, 12480, 12481, 12482, 12483, 12484,
        12485, 12486, 12487, 12488, 12489, 12490, 12491, 12492,
        12493, 12494
      ]
    }
  ],
  tgsr: [
    {
      code: "tgsrs1",
      label: "Pack S1",
      ids: [
        11069, 11070, 11071, 11072, 11073, 11074, 11075, 11076,
        11077, 11078, 11079, 11080, 11081, 11082, 11083, 11084,
        11085, 11086, 11087, 11088, 11089, 11090, 11091, 11092,
        11093, 11094, 11095, 11096, 11097, 11098, 11099, 11100
      ]
    },
    {
      code: "tgsrs2",
      label: "Pack S2",
      ids: [
        11101, 11102, 11103, 11104, 11105, 11106, 11107, 11108,
        11109, 11110, 11111, 11112, 11113, 11114, 11115, 11116,
        11117, 11118, 11119, 11120, 11121, 11122, 11123, 11124,
        11125, 11126, 11127, 11128, 11129, 11130, 11131, 11132,
        11133, 11134, 11135, 11136, 11137, 11138, 11139, 11140,
        11141, 11142, 11143, 11144
      ]
    }
  ],
  twl: [
    { code: "twllow", label: "Low Drop", ids: [11347, 11348, 11349, 11350, 11351, 11352] },
    { code: "twlhq", label: "HQ Accounts", ids: [11361, 11362, 11363, 11364] },
    { code: "twlprov", label: "Provider", ids: [12349, 12350, 12351, 12352, 12353] }
  ],
  two: [
    { code: "twostat", label: "Statistics 📊", ids: [11425, 11426, 11427, 11428, 11429, 11430, 11431], emoji: "📊" },
    { code: "twomix", label: "Mix [Check Detail]", ids: [11473, 11474, 11475, 11476, 11477, 11478] }
  ]
};

function expandPanel(panel) {
  const groups = PANEL_GROUPS[panel.code];

  if (!groups) {
    return [panel];
  }

  return groups.map((group) => ({
    ...panel,
    code: group.code,
    label: group.label,
    panelName: group.label,
    emoji: group.emoji ?? panel.emoji,
    ids: group.ids
  }));
}

const EXTRA_PANELS = [
  {
    code: "igshare",
    platformSlug: "instagram",
    categorySlug: "shares",
    label: "اشتراک گذاری ویدیو یا عکس",
    emoji: "↗️",
    panelName: "اشتراک گذاری ویدیو یا عکس",
    pricing: { mode: "multiply", value: 2 },
    ids: [12114, 12115, 11852, 11853]
  }
];

const PANEL_LIST = [
  ...SOURCE_PANELS.flatMap(expandPanel),
  ...EXTRA_PANELS
];

// Keep original grouped panel codes available for old Telegram buttons/messages.
const PANEL_LOOKUP_LIST = [
  ...PANEL_LIST,
  ...SOURCE_PANELS.filter((panel) => PANEL_GROUPS[panel.code])
];

const PANELS = new Map(
  PANEL_LOOKUP_LIST.map((panel) => [
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

export async function requestRefill(orderId) { return requestSmmxRefill(orderId); }
export async function getRefillStatus(refillId) { return getSmmxRefillStatus(refillId); }
export async function requestCancel(orderId) { return requestSmmxCancel(orderId); }
