import "dotenv/config";
import { Telegraf, Markup } from "telegraf";
import {
  initDatabase,
  ensureUser,
  query,
  pool,
  getSession,
  setSession,
  clearSession
} from "./db.js";
import {
  mainMenu,
  platformKeyboard,
  categoryKeyboard,
  customEmojiCallback,
  categoryEmojiId,
  platformEmojiId,
  CUSTOM_EMOJI,
  persistentMenu
} from "./keyboards.js";
import {
  listPanels,
  getPanel,
  getServices,
  getService,
  calculateCharge,
  createOrder as createProviderOrder,
  getOrderStatus as getProviderOrderStatus,
  getProviderName,
  requestRefill as requestProviderRefill,
  requestCancel as requestProviderCancel
} from "./providers/registry.js";
import {
  createHeleketInvoice,
  publicBaseUrl
} from "./payments/heleket/client.js";
import {
  startHeleketServer
} from "./payments/heleket/server.js";
import {
  CertificateApiError,
  getCertificateProfile,
  getCertificatePlans,
  registerCertificate,
  getCertificate,
  certificateSellingPrice
} from "./providers/certificate/nekoo.js";
import {
  HeroSmsApiError,
  getVirtualNumberServices,
  getVirtualNumberPackages,
  getVirtualNumberPackage,
  buyVirtualNumber,
  getVirtualNumberLastOtp,
  cancelVirtualNumber
} from "./providers/virtual_number/herosms.js";

if (!process.env.BOT_TOKEN) {
  throw new Error("BOT_TOKEN is missing");
}

const bot = new Telegraf(process.env.BOT_TOKEN);

const ERROR_CUSTOM_EMOJI_ID = "5348027250446967673";

function replaceRedCrossInKeyboard(replyMarkup) {
  const keyboard = replyMarkup?.inline_keyboard;

  if (!Array.isArray(keyboard)) {
    return replyMarkup;
  }

  for (const row of keyboard) {
    if (!Array.isArray(row)) continue;

    for (const button of row) {
      if (
        typeof button?.text === "string" &&
        button.text.includes("❌")
      ) {
        button.text = button.text
          .replace(/❌/g, "")
          .trim();

        if (!button.icon_custom_emoji_id) {
          button.icon_custom_emoji_id =
            ERROR_CUSTOM_EMOJI_ID;
        }
      }
    }
  }

  return replyMarkup;
}

const originalTelegramCallApi =
  bot.telegram.callApi.bind(bot.telegram);

bot.telegram.callApi = async (
  method,
  payload = {}
) => {
  const nextPayload = {
    ...payload
  };

  if (
    (
      method === "sendMessage" ||
      method === "editMessageText"
    ) &&
    typeof nextPayload.text === "string" &&
    nextPayload.text.includes("❌")
  ) {
    if (nextPayload.parse_mode === "HTML") {
      nextPayload.text =
        nextPayload.text.replace(
          /❌/g,
          tgEmoji(
            ERROR_CUSTOM_EMOJI_ID,
            "❌"
          )
        );
    } else if (!nextPayload.parse_mode) {
      nextPayload.text =
        escapeHtml(nextPayload.text)
          .replace(
            /❌/g,
            tgEmoji(
              ERROR_CUSTOM_EMOJI_ID,
              "❌"
            )
          );

      nextPayload.parse_mode = "HTML";
    }
  }

  if (nextPayload.reply_markup) {
    nextPayload.reply_markup =
      replaceRedCrossInKeyboard(
        nextPayload.reply_markup
      );
  }

  return originalTelegramCallApi(
    method,
    nextPayload
  );
};

bot.use(async (ctx, next) => {
  if (ctx.message?.entities) {
    console.log(
      "EMOJI_ENTITIES:",
      JSON.stringify(ctx.message.entities)
    );
  }

  return next();
});

function modeCode(mode) {
  return mode === "price" ? "p" : "o";
}

function modeName(code) {
  return code === "p" ? "price" : "order";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function tgEmoji(id, fallback) {
  return `<tg-emoji emoji-id="${String(id)}">${fallback}</tg-emoji>`;
}

const ORDER_RESULT_EMOJI = {
  success: "5206607081334906820",
  orderId: "5965485570124681987",
  quantity: "5071491301443110142",
  amount: "5388803751559586023",
  status: "5927294695158847101",
  link: "6001078118725456537",
  serviceBullet: "5237813295800408632"
};

function htmlOrderSummaryTitle() {
  return `${tgEmoji(CUSTOM_EMOJI.menu.orders, "📦")} خلاصه سفارش`;
}

function htmlOrderConfirmQuestion() {
  return `${tgEmoji(ORDER_RESULT_EMOJI.success, "✅")} سفارش را تأیید می‌کنید؟`;
}

function confirmOrderButton() {
  return customEmojiCallback(
    "تأیید سفارش",
    "provider:confirm",
    ORDER_RESULT_EMOJI.success
  );
}

const SERVICE_TEXT_EMOJI = {
  rocket: "6228656087709520666",
  danger: "5210854838350403906"
};

function htmlServiceName(value) {
  const safe = escapeHtml(value);

  return safe
    .replace(
      /🚀/g,
      tgEmoji(SERVICE_TEXT_EMOJI.rocket, "🚀")
    )
    .replace(
      /⚠️/g,
      tgEmoji(SERVICE_TEXT_EMOJI.danger, "⚠️")
    )
    .replace(
      /⚠/g,
      tgEmoji(SERVICE_TEXT_EMOJI.danger, "⚠️")
    );
}

function normalizeName(value) {
  return String(value ?? "").toLowerCase().replace(/\s+/g, " ").trim();
}

function platformFallback(name) {
  const value = normalizeName(name);
  if (value === "instagram") return "📸";
  if (value === "facebook") return "📘";
  if (value === "tiktok") return "🎵";
  if (value === "youtube") return "▶️";
  if (value === "telegram") return "✈️";
  if (["twitter / x", "twitter", "x"].includes(value)) return "✖️";
  if (value === "whatsapp") return "💬";
  if (["kick", "kik"].includes(value)) return "💚";
  if (value === "threads") return "🧵";
  if (["linkedin", "linkdin"].includes(value)) return "💼";
  if (["google maps", "google map"].includes(value)) return "📍";
  if (value === "likee") return "❤️";
  if (value === "snapchat") return "👻";
  return "📱";
}

function categoryFallback(name) {
  const value = normalizeName(name);
  if (
    value.includes("فالوور") ||
    value.includes("ممبر") ||
    value.includes("subscriber") ||
    value.includes("member") ||
    value.includes("سابسکرایبر")
  ) return "👥";
  if (
    value.includes("لایک") ||
    value.includes("like") ||
    value.includes("ری‌اکشن") ||
    value.includes("reaction")
  ) return "❤️";
  if (value.includes("کامنت") || value.includes("comment")) return "💬";
  if (value.includes("ویو") || value.includes("view")) return "👁";
  if (value.includes("live")) return "🔴";
  return tgEmoji(ORDER_RESULT_EMOJI.serviceBullet, "🔹");
}

function htmlPlatform(name) {
  const id = platformEmojiId(name);
  const fallback = platformFallback(name);
  const icon = id ? tgEmoji(id, fallback) : fallback;
  return `${icon} ${escapeHtml(name)}`;
}

function htmlCategory(name) {
  const id = categoryEmojiId(name);
  const fallback = categoryFallback(name);
  const icon = id ? tgEmoji(id, fallback) : fallback;
  return `${icon} ${htmlServiceName(name)}`;
}

function htmlMenuTitle(key, text) {
  const map = {
    newOrder: [CUSTOM_EMOJI.menu.newOrder, "🛒"],
    prices: [CUSTOM_EMOJI.menu.prices, "🏷️"],
    orders: [CUSTOM_EMOJI.menu.orders, "📦"],
    balance: [CUSTOM_EMOJI.menu.balance, "💰"],
    deposit: [CUSTOM_EMOJI.menu.deposit, "💳"],
    support: [CUSTOM_EMOJI.menu.support, "🎧"]
  };

  const [id, fallback] = map[key] ?? [null, "✨"];
  const icon = id ? tgEmoji(id, fallback) : fallback;
  return `${icon} ${escapeHtml(text)}`;
}

function htmlInfoLine(key, label, value) {
  const map = {
    price: [CUSTOM_EMOJI.info.price, "💵"],
    min: [CUSTOM_EMOJI.info.min, "⬇️"],
    max: [CUSTOM_EMOJI.info.max, "⬆️"],
    orderType: [CUSTOM_EMOJI.info.orderType, "📝"]
  };

  const [id, fallback] = map[key] ?? [null, tgEmoji(ORDER_RESULT_EMOJI.serviceBullet, "🔹")];
  const icon = id ? tgEmoji(id, fallback) : fallback;
  return `${icon} ${escapeHtml(label)}: ${escapeHtml(value)}`;
}

function htmlText(text, keyboard) {
  return {
    parse_mode: "HTML",
    ...(keyboard ?? {})
  };
}

function htmlErrorMessage(message) {
  const clean = String(message ?? "")
    .replace(/^❌\s*/, "");

  return `${tgEmoji(ERROR_CUSTOM_EMOJI_ID, "❌")} ${escapeHtml(clean)}`;
}

async function replyError(ctx, message, keyboard = null) {
  const text = htmlErrorMessage(message);

  return ctx.reply(
    text,
    htmlText(text, keyboard ?? undefined)
  );
}

async function editError(ctx, message, keyboard = null) {
  const text = htmlErrorMessage(message);

  return ctx.editMessageText(
    text,
    htmlText(text, keyboard ?? undefined)
  );
}

async function answerCb(ctx, text) {
  try {
    if (ctx.callbackQuery) {
      await ctx.answerCbQuery(text);
    }
  } catch {}
}

const REFILL_WAIT_MS = 48 * 60 * 60 * 1000;

function orderControlKeyboard(order) {
  const rows = [];
  if (order.refill_supported && !order.refill_id) {
    rows.push([Markup.button.callback("♻️ جبران ریزش", `order:refill:${order.id}`)]);
  }
  if (order.cancel_supported && !order.cancel_closed && !order.cancel_requested_at) {
    rows.push([
      customEmojiCallback(
        "ثبت کنسل",
        `order:cancel_api:${order.id}`,
        ERROR_CUSTOM_EMOJI_ID
      )
    ]);
  }
  rows.push(...mainMenu().reply_markup.inline_keyboard);
  return Markup.inlineKeyboard(rows);
}

async function loadUserOrder(telegramId, orderId) {
  const result = await query(
    `SELECT id, telegram_id, provider_name, provider_order_id, created_at, refill_supported, cancel_supported, cancel_closed, cancel_requested_at, refill_id, refill_requested_at
     FROM orders WHERE id = $1 AND telegram_id = $2`,
    [orderId, telegramId]
  );
  return result.rows[0] ?? null;
}

async function home(ctx) {
  await clearSession(ctx.from.id);

  const text =
    `${tgEmoji(CUSTOM_EMOJI.info.welcome, "👋")} خوش آمدید به AFPLAY\n\n` +
    "یکی از گزینه‌های زیر را انتخاب کنید:";

  const options = htmlText(text, mainMenu());

  if (ctx.callbackQuery) {
    await ctx.editMessageText(text, options);
  } else {
    await ctx.reply(
      "منوی سریع AFPLAY فعال شد.",
      persistentMenu()
    );

    await ctx.reply(text, options);
  }
}

async function platforms(ctx, mode) {
  const result = await query(
    `SELECT id, name, emoji
     FROM platforms
     WHERE status = TRUE
     ORDER BY sort_order, id`
  );

  const platformTitleEmoji = tgEmoji(
    CUSTOM_EMOJI.info.platformTitle,
    "📱"
  );

  const title =
    mode === "order"
      ? `${platformTitleEmoji} برای کدام برنامه می‌خواهید سفارش ثبت کنید؟`
      : `${platformTitleEmoji} قیمت خدمات کدام برنامه را می‌خواهید؟`;

  await ctx.editMessageText(
    title,
    htmlText(title, platformKeyboard(result.rows, mode))
  );
}

async function categories(ctx, mode, platformId) {
  const platformResult = await query(
    `SELECT id, name, emoji
     FROM platforms
     WHERE id = $1 AND status = TRUE`,
    [platformId]
  );

  if (!platformResult.rowCount) {
    return ctx.editMessageText(
      "❌ پلتفرم پیدا نشد.",
      mainMenu()
    );
  }

  const categoriesResult = await query(
    `SELECT id, name, emoji
     FROM categories
     WHERE platform_id = $1 AND status = TRUE
     ORDER BY sort_order, id`,
    [platformId]
  );

  const platform = platformResult.rows[0];

  const title =
    `${htmlPlatform(platform.name)}\n\n` +
    (mode === "order"
      ? "نوع خدمات را انتخاب کنید:"
      : "قیمت کدام خدمات را می‌خواهید؟");

  await ctx.editMessageText(
    title,
    htmlText(
      title,
      categoryKeyboard(
        categoriesResult.rows,
        mode,
        platformId
      )
    )
  );
}

async function categoryInfo(platformId, categoryId) {
  const result = await query(
    `SELECT
       p.slug AS platform_slug,
       p.name AS platform_name,
       c.slug AS category_slug,
       c.name AS category_name,
       c.emoji AS category_emoji
     FROM platforms p
     JOIN categories c ON c.platform_id = p.id
     WHERE p.id = $1 AND c.id = $2`,
    [platformId, categoryId]
  );

  return result.rows[0] ?? null;
}

function serviceTitle(info, serviceName) {
  if (!info) {
    return escapeHtml(serviceName);
  }

  return (
    `${htmlPlatform(info.platform_name)}\n` +
    `${htmlCategory(serviceName)}`
  );
}

async function servicePanels(
  ctx,
  mode,
  platformId,
  categoryId
) {
  const info = await categoryInfo(
    platformId,
    categoryId
  );

  if (!info) {
    return ctx.editMessageText(
      "❌ دسته‌بندی پیدا نشد.",
      mainMenu()
    );
  }

  const panels = listPanels(
    info.platform_slug,
    info.category_slug
  );

  if (panels.length === 1) {
    const panel = panels[0];

    return providerPanel(
      ctx,
      panel.providerCode,
      panel.panelCode,
      mode,
      platformId,
      categoryId,
      0
    );
  }

  const rows = panels.map((panel) => {
    const iconId =
      categoryEmojiId(panel.label) ??
      categoryEmojiId(info.category_name);

    return [
      customEmojiCallback(
        panel.panelName,
        `pv:${panel.providerCode}:${panel.panelCode}:${modeCode(mode)}:${platformId}:${categoryId}`,
        iconId
      )
    ];
  });

  rows.push([
    customEmojiCallback(
      "برگشت",
      `${mode}:platform:${platformId}`,
      CUSTOM_EMOJI.back
    )
  ]);

  const title =
    `${htmlPlatform(info.platform_name)}\n` +
    `${htmlCategory(info.category_name)}\n\n`;

  if (!panels.length) {
    const text = title + "هنوز سرویسی برای این بخش اضافه نشده است.";
    return ctx.editMessageText(
      text,
      htmlText(text, Markup.inlineKeyboard(rows))
    );
  }

  const text = title + "پنل موردنظر را انتخاب کنید:";

  await ctx.editMessageText(
    text,
    htmlText(text, Markup.inlineKeyboard(rows))
  );
}

function shortName(name, max = 38) {
  // Normalize through UTF-8 first so any lone/broken surrogate
  // coming from a provider becomes the replacement character.
  const clean = Buffer
    .from(String(name ?? ""), "utf8")
    .toString("utf8")
    .replace(/\s+/g, " ")
    .trim();

  // Do not cut an emoji / flag / joined emoji sequence in half.
  const segmenter = new Intl.Segmenter(
    "en",
    { granularity: "grapheme" }
  );

  const graphemes = Array.from(
    segmenter.segment(clean),
    (part) => part.segment
  );

  return graphemes.length > max
    ? graphemes.slice(0, max - 1).join("") + "…"
    : clean;
}

async function providerPanel(
  ctx,
  providerCode,
  panelCode,
  mode,
  platformId,
  categoryId,
  page = 0
) {
  try {
    const panel = getPanel(
      providerCode,
      panelCode
    );

    const info = await categoryInfo(
      platformId,
      categoryId
    );

    const services = await getServices(
      providerCode,
      panelCode
    );

    if (!services.length) {
      return ctx.editMessageText(
        "❌ فعلاً هیچ سرویسی از این پنل در دسترس نیست.",
        Markup.inlineKeyboard([
          [
            customEmojiCallback(
              "برگشت",
              `${mode}:category:${platformId}:${categoryId}`,
              CUSTOM_EMOJI.back
            )
          ]
        ])
      );
    }

    const PAGE_SIZE = 12;
    const totalPages = Math.max(
      1,
      Math.ceil(services.length / PAGE_SIZE)
    );

    const safePage = Math.min(
      Math.max(Number(page) || 0, 0),
      totalPages - 1
    );

    const startIndex =
      safePage * PAGE_SIZE;

    const pageServices =
      services.slice(
        startIndex,
        startIndex + PAGE_SIZE
      );

    const rows = pageServices.map(
      (service) => [
        Markup.button.callback(
          `${shortName(service.name)} | $${service.sellingRate.toFixed(2)}/1K`,
          `ps:${providerCode}:${panelCode}:${modeCode(mode)}:${platformId}:${categoryId}:${service.service}:${safePage}`
        )
      ]
    );

    if (totalPages > 1) {
      const nav = [];

      if (safePage > 0) {
        nav.push(
          Markup.button.callback(
            "⬅️ قبلی",
            `pvp:${providerCode}:${panelCode}:${modeCode(mode)}:${platformId}:${categoryId}:${safePage - 1}`
          )
        );
      }

      if (safePage < totalPages - 1) {
        nav.push(
          Markup.button.callback(
            "بعدی ➡️",
            `pvp:${providerCode}:${panelCode}:${modeCode(mode)}:${platformId}:${categoryId}:${safePage + 1}`
          )
        );
      }

      if (nav.length) {
        rows.push(nav);
      }
    }

    rows.push([
      customEmojiCallback(
        "برگشت",
        `${mode}:category:${platformId}:${categoryId}`,
        CUSTOM_EMOJI.back
      )
    ]);

    const text =
      `${htmlPlatform(info?.platform_name ?? panel.platformSlug)}\n` +
      `${htmlCategory(panel.panelName)}\n\n` +
      "یکی از سرویس‌ها را انتخاب کنید:" +
      (
        totalPages > 1
          ? `\nصفحه ${safePage + 1} از ${totalPages}`
          : ""
      );

    await ctx.editMessageText(
      text,
      htmlText(
        text,
        Markup.inlineKeyboard(rows)
      )
    );
  } catch (error) {
    console.error(
      `${providerCode}/${panelCode} services error:`,
      error
    );

    await ctx.editMessageText(
      "❌ فعلاً اتصال به این پنل ممکن نیست. کمی بعد دوباره امتحان کنید.",
      mainMenu()
    );
  }
}

async function providerService(
  ctx,
  providerCode,
  panelCode,
  mode,
  platformId,
  categoryId,
  serviceId,
  sourcePage = 0
) {
  try {
    const service = await getService(
      providerCode,
      panelCode,
      serviceId
    );

    if (!service) {
      return ctx.editMessageText(
        "❌ این سرویس در دسترس نیست.",
        mainMenu()
      );
    }

    const info = await categoryInfo(
      platformId,
      categoryId
    );

    let extra = "";

    if (service.customComments) {
      extra =
        `\n${htmlInfoLine("orderType", "نوع سفارش", "کامنت دلخواه")}` +
        "\nهر کامنت را در یک خط جدا وارد می‌کنید.";
    }

    const text =
      `${serviceTitle(info, service.name)}\n\n` +
      `${htmlInfoLine("price", "قیمت هر 1000", `$${service.sellingRate.toFixed(2)}`)}\n` +
      `${htmlInfoLine("min", "حداقل سفارش", service.min.toLocaleString("en-US"))}\n` +
      `${htmlInfoLine("max", "حداکثر سفارش", service.max.toLocaleString("en-US"))}` +
      extra;

    await ctx.editMessageText(
      text,
      htmlText(
        text,
        Markup.inlineKeyboard([
          [
            customEmojiCallback(
              "ایجاد سفارش",
              `po:${providerCode}:${panelCode}:${platformId}:${categoryId}:${service.service}`,
              CUSTOM_EMOJI.menu.newOrder
            )
          ],
          [
            customEmojiCallback(
              "برگشت",
              `pvp:${providerCode}:${panelCode}:${modeCode(mode)}:${platformId}:${categoryId}:${sourcePage}`,
              CUSTOM_EMOJI.back
            )
          ]
        ])
      )
    );
  } catch (error) {
    console.error(
      `${providerCode}/${panelCode} service error:`,
      error
    );

    await ctx.editMessageText(
      "❌ دریافت اطلاعات این سرویس ممکن نشد.",
      mainMenu()
    );
  }
}


const VIRTUAL_NUMBER_PAGE_SIZE = 10;
const VIRTUAL_NUMBER_AUTO_CANCEL_MS = 10 * 60 * 1000;
const VIRTUAL_NUMBER_WORKER_INTERVAL_MS = 30 * 1000;

function virtualNumberTitle(
  label = "شماره مجازی"
) {
  return (
    `${tgEmoji(
      CUSTOM_EMOJI.menu.virtualNumber,
      "📱"
    )} ${escapeHtml(label)}`
  );
}

function virtualServiceEmojiId(value) {
  return platformEmojiId(value);
}

function virtualServiceFallback(value) {
  const id = virtualServiceEmojiId(value);
  return id ? platformFallback(value) : "📱";
}

function htmlVirtualServiceName(value) {
  const name = String(value || "-");
  const id = virtualServiceEmojiId(name);
  const fallback = virtualServiceFallback(name);
  const icon = id ? tgEmoji(id, fallback) : fallback;
  return `${icon} ${escapeHtml(name)}`;
}

function virtualServiceButton(text, callbackData, value) {
  const id = virtualServiceEmojiId(value);
  if (id) {
    return customEmojiCallback(text, callbackData, id);
  }

  return Markup.button.callback(`📱 ${text}`, callbackData);
}

function formatVirtualNumberPrice(value) {
  const number = Number(value || 0);

  if (!Number.isFinite(number)) {
    return "0.00";
  }

  return number.toFixed(2);
}


let countryFlagLookup = null;

function flagFromRegionCode(code) {
  return String(code || "")
    .toUpperCase()
    .replace(/[A-Z]/g, (char) =>
      String.fromCodePoint(127397 + char.charCodeAt(0))
    );
}

function buildCountryFlagLookup() {
  const map = new Map();

  try {
    const displayNames = new Intl.DisplayNames(
      ["en"],
      { type: "region" }
    );

    for (let a = 65; a <= 90; a += 1) {
      for (let b = 65; b <= 90; b += 1) {
        const code = String.fromCharCode(a, b);
        const label = displayNames.of(code);

        if (!label || label === code || /Unknown Region/i.test(label)) {
          continue;
        }

        map.set(normalizeName(label), flagFromRegionCode(code));
      }
    }
  } catch {}

  const aliases = {
    "usa": "🇺🇸",
    "united states of america": "🇺🇸",
    "uk": "🇬🇧",
    "russia": "🇷🇺",
    "south korea": "🇰🇷",
    "north korea": "🇰🇵",
    "iran": "🇮🇷",
    "bolivia": "🇧🇴",
    "venezuela": "🇻🇪",
    "vietnam": "🇻🇳",
    "laos": "🇱🇦",
    "moldova": "🇲🇩",
    "syria": "🇸🇾",
    "tanzania": "🇹🇿"
  };

  for (const [name, flag] of Object.entries(aliases)) {
    map.set(name, flag);
  }

  return map;
}

function countryFlag(name) {
  if (!countryFlagLookup) {
    countryFlagLookup = buildCountryFlagLookup();
  }

  return countryFlagLookup.get(normalizeName(name)) || "🌐";
}

function countryPlain(name, phoneCode = null) {
  const code = Number(phoneCode);
  const suffix = Number.isFinite(code) && code > 0
    ? ` +${code}`
    : "";
  return `${countryFlag(name)} ${String(name || "-")}${suffix}`;
}

function htmlCountry(name, phoneCode = null) {
  return escapeHtml(countryPlain(name, phoneCode));
}

function formatVirtualCountdown(dueAt) {
  const due = dueAt ? new Date(dueAt).getTime() : 0;
  if (!Number.isFinite(due) || due <= 0) return null;

  const remaining = Math.max(0, due - Date.now());
  const totalSeconds = Math.ceil(remaining / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function virtualNumberPublicOrderId(id) {
  return `AF-VN-${Number(id)}`;
}

function socialPublicOrderId(id) {
  return `AF-SMM-${Number(id)}`;
}

function certificatePublicOrderId(id) {
  return `AF-CERT-${Number(id)}`;
}

const DISPLAY_TIMEZONE =
  process.env.DISPLAY_TIMEZONE || "Asia/Kabul";

function formatOrderTime(value) {
  if (!value) return "-";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";

  try {
    return new Intl.DateTimeFormat(
      "en-GB",
      {
        timeZone: DISPLAY_TIMEZONE,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false
      }
    ).format(date);
  } catch {
    return date.toISOString().replace("T", " ").slice(0, 19) + " UTC";
  }
}

function genericStatusLabel(value) {
  const status = normalizeName(value).replace(/_/g, " ");

  if (["completed", "complete", "success", "done", "signed"].includes(status)) {
    return "✅ تکمیل شده";
  }
  if (["processing", "in progress", "inprogress", "active"].includes(status)) {
    return "🟡 در حال انجام";
  }
  if (["pending", "queued", "waiting"].includes(status)) {
    return "⏳ در انتظار";
  }
  if (["cancelled", "canceled", "cancelled/refunded", "refunded"].includes(status)) {
    return "❌ لغو شده";
  }
  if (["partial", "partially completed"].includes(status)) {
    return "⚠️ بخشی تکمیل شده";
  }
  if (["failed", "error"].includes(status)) {
    return "⚠️ ناموفق";
  }
  if (status === "cancel requested") {
    return "🟡 درخواست لغو ثبت شده";
  }

  return value ? escapeHtml(String(value)) : "-";
}

function virtualNumberApiErrorText(error) {
  const code =
    String(
      error?.code ||
      error?.message ||
      ""
    ).toUpperCase();

  const providerDetail = String(
    error?.details ||
    error?.message ||
    ""
  )
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 320);

  if (
    code.includes("NO_BALANCE") ||
    error?.status === 402
  ) {
    return (
      "خرید توسط سرویس‌دهنده رد شد: موجودی حساب HeroSMS کافی نیست. " +
      "مبلغ مشتری به کیف پول AFPLAY برگشت داده شد."
    );
  }

  if (
    code.includes("NO_NUMBERS") ||
    code.includes("OFFER_NOT_FOUND") ||
    error?.status === 404
  ) {
    return (
      "خرید رد شد: برای این سرویس/کشور فعلاً شماره موجود نیست. " +
      "یک کشور یا سرویس دیگر را انتخاب کنید."
    );
  }

  if (
    code.includes("WRONG_MAX_PRICE") ||
    code.includes("PRICE") && code.includes("WRONG")
  ) {
    return (
      "خرید رد شد: قیمت شماره در HeroSMS تغییر کرده است. " +
      "به لیست کشورها برگردید تا قیمت تازه دریافت شود."
    );
  }

  if (
    code.includes("BAD_SERVICE") ||
    code.includes("INVALID_SERVICE")
  ) {
    return "خرید رد شد: سرویس انتخاب‌شده توسط HeroSMS معتبر نیست.";
  }

  if (
    code.includes("BAD_COUNTRY") ||
    code.includes("INVALID_COUNTRY")
  ) {
    return "خرید رد شد: کشور انتخاب‌شده توسط HeroSMS معتبر نیست.";
  }

  if (
    error?.status === 422 ||
    code.includes("UNPROCESSABLE") ||
    code.includes("VALIDATION")
  ) {
    return providerDetail
      ? `خرید توسط HeroSMS رد شد. دلیل: ${providerDetail}`
      : "خرید توسط HeroSMS رد شد چون اطلاعات درخواست معتبر نبود.";
  }

  if (
    code.includes("RATE_LIMIT") ||
    error?.status === 429
  ) {
    return (
      "HeroSMS موقتاً تعداد درخواست‌ها را محدود کرده است. " +
      "کمی بعد دوباره امتحان کنید."
    );
  }

  if (
    code.includes("UNAUTH") ||
    code.includes("CONFIG_ERROR") ||
    error?.status === 401
  ) {
    return (
      "اتصال HeroSMS تأیید نشد. API Key یا تنظیمات اتصال را بررسی کنید."
    );
  }

  if (
    code.includes("TIMEOUT") ||
    code.includes("NETWORK") ||
    error?.status >= 500
  ) {
    return (
      "HeroSMS موقتاً پاسخ درست نمی‌دهد. " +
      (providerDetail ? `جزئیات: ${providerDetail}` : "کمی بعد دوباره امتحان کنید.")
    );
  }

  if (providerDetail) {
    return `HeroSMS درخواست را رد کرد. دلیل: ${providerDetail}`;
  }

  return "HeroSMS درخواست را رد کرد، اما دلیل مشخصی برنگرداند.";
}

async function showVirtualNumberServices(
  ctx,
  page = 0,
  { edit = true } = {}
) {
  try {
    const services =
      await getVirtualNumberServices();

    if (!services.length) {
      const text =
        `${virtualNumberTitle()}\n\n` +
        "فعلاً هیچ سرویس فعالی از API دریافت نشد.";

      const options = htmlText(
        text,
        Markup.inlineKeyboard([
          [
            customEmojiCallback(
              "شماره‌های من",
              "vn:my:0",
              CUSTOM_EMOJI.menu.virtualNumber
            )
          ],
          [
            customEmojiCallback(
              "برگشت",
              "menu:home",
              CUSTOM_EMOJI.back
            )
          ]
        ])
      );

      return edit && ctx.callbackQuery
        ? ctx.editMessageText(
            text,
            options
          )
        : ctx.reply(
            text,
            options
          );
    }

    await setSession(
      ctx.from.id,
      "vn_services",
      { services }
    );

    const totalPages =
      Math.max(
        1,
        Math.ceil(
          services.length /
          VIRTUAL_NUMBER_PAGE_SIZE
        )
      );

    const safePage =
      Math.min(
        Math.max(
          Number(page) || 0,
          0
        ),
        totalPages - 1
      );

    const start =
      safePage *
      VIRTUAL_NUMBER_PAGE_SIZE;

    const pageServices =
      services.slice(
        start,
        start +
        VIRTUAL_NUMBER_PAGE_SIZE
      );

    const rows =
      pageServices.map(
        (service, offset) => [
          virtualServiceButton(
            `${shortName(
              service.name,
              34
            )} (${service.packageCount})`,
            `vn:s:${start + offset}:${safePage}`,
            service.name
          )
        ]
      );

    if (totalPages > 1) {
      const nav = [];

      if (safePage > 0) {
        nav.push(
          Markup.button.callback(
            "⬅️ قبلی",
            `vn:sp:${safePage - 1}`
          )
        );
      }

      if (
        safePage <
        totalPages - 1
      ) {
        nav.push(
          Markup.button.callback(
            "بعدی ➡️",
            `vn:sp:${safePage + 1}`
          )
        );
      }

      if (nav.length) {
        rows.push(nav);
      }
    }

    rows.push([
      customEmojiCallback(
        "شماره‌های من",
        "vn:my:0",
        CUSTOM_EMOJI.menu.virtualNumber
      )
    ]);

    rows.push([
      customEmojiCallback(
        "برگشت",
        "menu:home",
        CUSTOM_EMOJI.back
      )
    ]);

    const balance =
      await getUserBalance(
        ctx.from.id
      );

    const text =
      `${virtualNumberTitle()}\n\n` +
      `موجودی کیف پول شما: $${balance.toFixed(2)}\n` +
      "سرویس موردنظر را انتخاب کنید:" +
      (
        totalPages > 1
          ? `\nصفحه ${safePage + 1} از ${totalPages}`
          : ""
      );

    const options = htmlText(
      text,
      Markup.inlineKeyboard(rows)
    );

    return edit && ctx.callbackQuery
      ? ctx.editMessageText(
          text,
          options
        )
      : ctx.reply(
          text,
          options
        );
  } catch (error) {
    console.error(
      "HeroSMS services error:",
      error?.code || "error",
      error?.message || error
    );

    const message =
      virtualNumberApiErrorText(
        error
      );

    return edit && ctx.callbackQuery
      ? editError(
          ctx,
          message,
          mainMenu()
        )
      : replyError(
          ctx,
          message,
          mainMenu()
        );
  }
}

async function showVirtualNumberPackages(
  ctx,
  service,
  page = 0,
  { edit = true } = {}
) {
  try {
    const packages =
      await getVirtualNumberPackages(
        service.code
      );

    if (!packages.length) {
      const text =
        `${virtualNumberTitle()}\n\n` +
        `${htmlVirtualServiceName(service.name)}\n\n` +
        "فعلاً هیچ کشور دارای شماره برای این سرویس نیست.";

      const options = htmlText(
        text,
        Markup.inlineKeyboard([
          [
            Markup.button.callback(
              "برگشت به سرویس‌ها",
              "vn:services"
            )
          ]
        ])
      );

      return edit && ctx.callbackQuery
        ? ctx.editMessageText(
            text,
            options
          )
        : ctx.reply(
            text,
            options
          );
    }

    const enriched =
      packages.map(
        (item) => ({
          ...item,
          serviceName:
            service.name
        })
      );

    await setSession(
      ctx.from.id,
      "vn_packages",
      {
        service,
        packages: enriched
      }
    );

    const totalPages =
      Math.max(
        1,
        Math.ceil(
          enriched.length /
          VIRTUAL_NUMBER_PAGE_SIZE
        )
      );

    const safePage =
      Math.min(
        Math.max(
          Number(page) || 0,
          0
        ),
        totalPages - 1
      );

    const start =
      safePage *
      VIRTUAL_NUMBER_PAGE_SIZE;

    const pagePackages =
      enriched.slice(
        start,
        start +
        VIRTUAL_NUMBER_PAGE_SIZE
      );

    const rows =
      pagePackages.map(
        (item, offset) => [
          Markup.button.callback(
            `${shortName(
              countryPlain(item.countryName),
              28
            )} | $${formatVirtualNumberPrice(
              item.sellingPrice
            )}`,
            `vn:p:${start + offset}:${safePage}`
          )
        ]
      );

    if (totalPages > 1) {
      const nav = [];

      if (safePage > 0) {
        nav.push(
          Markup.button.callback(
            "⬅️ قبلی",
            `vn:pp:${safePage - 1}`
          )
        );
      }

      if (
        safePage <
        totalPages - 1
      ) {
        nav.push(
          Markup.button.callback(
            "بعدی ➡️",
            `vn:pp:${safePage + 1}`
          )
        );
      }

      if (nav.length) {
        rows.push(nav);
      }
    }

    rows.push([
      Markup.button.callback(
        "برگشت به سرویس‌ها",
        "vn:services"
      )
    ]);

    const text =
      `${virtualNumberTitle()}\n\n` +
      `سرویس: ${htmlVirtualServiceName(service.name)}\n` +
      "کشور و بسته موردنظر را انتخاب کنید." +
      (
        totalPages > 1
          ? `\nصفحه ${safePage + 1} از ${totalPages}`
          : ""
      );

    const options = htmlText(
      text,
      Markup.inlineKeyboard(rows)
    );

    return edit && ctx.callbackQuery
      ? ctx.editMessageText(
          text,
          options
        )
      : ctx.reply(
          text,
          options
        );
  } catch (error) {
    console.error(
      "HeroSMS packages error:",
      error?.code || "error",
      error?.message || error
    );

    return editError(
      ctx,
      virtualNumberApiErrorText(
        error
      ),
      mainMenu()
    );
  }
}

async function renderVirtualNumberChoice(
  ctx,
  data,
  { edit = true } = {}
) {
  const balance =
    await getUserBalance(
      ctx.from.id
    );

  const price =
    Number(
      data?.selling_price || 0
    );

  const shortfall =
    Math.max(
      0,
      Number(
        (
          price - balance
        ).toFixed(4)
      )
    );

  if (shortfall > 0) {
    await setSession(
      ctx.from.id,
      "vn_precheck",
      data
    );

    const text =
      `${virtualNumberTitle()}\n\n` +
      `سرویس: ${htmlVirtualServiceName(data.service_name)}\n` +
      `کشور: ${htmlCountry(data.country_name)}\n` +
      `قیمت: $${formatVirtualNumberPrice(price)}\n` +
      `موجودی شما: $${balance.toFixed(2)}\n` +
      `کسری موجودی: $${formatVirtualNumberPrice(shortfall)}\n\n` +
      "برای ادامه ابتدا موجودی کیف پول را افزایش دهید.";

    const options = htmlText(
      text,
      Markup.inlineKeyboard([
        [
          customEmojiCallback(
            "افزایش موجودی با کریپتو و تتر",
            "vn:topup",
            CUSTOM_EMOJI.menu.deposit
          )
        ],
        [
          Markup.button.callback(
            "انتخاب بسته دیگر",
            "vn:services"
          )
        ],
        [
          customEmojiCallback(
            "خانه",
            "menu:home",
            CUSTOM_EMOJI.back
          )
        ]
      ])
    );

    return edit && ctx.callbackQuery
      ? ctx.editMessageText(
          text,
          options
        )
      : ctx.reply(
          text,
          options
        );
  }

  await setSession(
    ctx.from.id,
    "vn_confirm",
    data
  );

  const text =
    `${virtualNumberTitle()}\n\n` +
    `سرویس: ${htmlVirtualServiceName(data.service_name)}\n` +
    `کشور: ${htmlCountry(data.country_name)}\n` +
    `قیمت: $${formatVirtualNumberPrice(price)}\n` +
    `موجودی شما: $${balance.toFixed(2)}\n\n` +
    "خرید این شماره را تأیید می‌کنید؟";

  const options = htmlText(
    text,
    Markup.inlineKeyboard([
      [
        Markup.button.callback(
          "✅ خرید شماره",
          "vn:confirm"
        )
      ],
      [
        Markup.button.callback(
          "انتخاب بسته دیگر",
          "vn:services"
        )
      ],
      [
        customEmojiCallback(
          "لغو",
          "menu:home",
          CUSTOM_EMOJI.back
        )
      ]
    ])
  );

  return edit && ctx.callbackQuery
    ? ctx.editMessageText(
        text,
        options
      )
    : ctx.reply(
        text,
        options
      );
}

function virtualNumberStatusLabel(order) {
  const status = normalizeName(order?.status).replace(/_/g, " ");

  if (status === "failed") {
    return order?.refunded
      ? "💰 ناموفق / مبلغ برگشت داده شد"
      : "⚠️ ناموفق";
  }
  if (order?.refunded || status === "cancelled" || status === "canceled") {
    return "💰 لغو شده / مبلغ برگشت داده شد";
  }
  if (status === "otp received") {
    return "✅ تکمیل شده / کد دریافت شده";
  }
  if (status === "cancelling") {
    return "🟡 در حال لغو";
  }
  if (status === "cancel failed") {
    return "⚠️ لغو ناموفق";
  }
  if (status === "purchasing") {
    return "⏳ در حال خرید";
  }
  if (status === "active") {
    return "⏳ منتظر SMS";
  }

  return genericStatusLabel(order?.status);
}

function extractVirtualOtp(otp) {
  return {
    code: String(
      otp?.smsCode ||
      otp?.code ||
      ""
    ).trim(),
    text: String(
      otp?.smsText ||
      otp?.text ||
      ""
    ).trim()
  };
}

async function saveVirtualOtp(orderId, otp) {
  const { code, text } = extractVirtualOtp(otp);

  if (!code && !text) return null;

  const result = await query(
    `UPDATE virtual_number_orders
     SET otp_code = $1,
         otp_text = $2,
         otp_received_at = COALESCE(otp_received_at, NOW()),
         status = 'otp_received',
         auto_cancel_due_at = NULL,
         auto_cancel_error = NULL,
         updated_at = NOW()
     WHERE id = $3
     RETURNING *`,
    [code || null, text || null, orderId]
  );

  return result.rows[0] ?? null;
}

async function virtualNumberOrderText(order) {
  const countdown =
    order?.status === "active" &&
    !order?.otp_code &&
    !order?.otp_text &&
    !order?.refunded
      ? formatVirtualCountdown(order?.auto_cancel_due_at)
      : null;

  let text =
    `${virtualNumberTitle()}\n\n` +
    `${tgEmoji(ORDER_RESULT_EMOJI.orderId, "🆔")} Order ID: <code>${escapeHtml(
      virtualNumberPublicOrderId(order?.id)
    )}</code>\n` +
    `سرویس: ${htmlVirtualServiceName(
      order?.service_name ||
      order?.service_code ||
      "-"
    )}\n` +
    `کشور: ${htmlCountry(
      order?.country_name || "-",
      order?.country_phone_code
    )}\n` +
    `شماره: <code>${escapeHtml(order?.phone_number || "-")}</code>\n` +
    `${tgEmoji(ORDER_RESULT_EMOJI.amount, "💵")} مبلغ: $${formatVirtualNumberPrice(
      order?.charge || 0
    )}\n` +
    `زمان خرید: ${escapeHtml(formatOrderTime(order?.created_at))}\n` +
    `${tgEmoji(ORDER_RESULT_EMOJI.status, "⏳")} وضعیت: ${virtualNumberStatusLabel(order)}`;

  if (countdown) {
    text += `\n⏳ زمان تا لغو خودکار: <code>${countdown}</code>`;
  }

  if (order?.otp_code) {
    text += `\nکد: <code>${escapeHtml(order.otp_code)}</code>`;
  }

  if (order?.otp_text) {
    text += `\nپیام: ${escapeHtml(order.otp_text)}`;
  }

  if (order?.otp_received_at) {
    text += `\nزمان دریافت کد: ${escapeHtml(formatOrderTime(order.otp_received_at))}`;
  }

  if (order?.cancelled_at) {
    text += `\nزمان لغو: ${escapeHtml(formatOrderTime(order.cancelled_at))}`;
  }

  if (order?.refunded && order?.refunded_at) {
    text += `\n💰 برگشت وجه: $${formatVirtualNumberPrice(order.charge || 0)}` +
      `\nزمان برگشت وجه: ${escapeHtml(formatOrderTime(order.refunded_at))}`;
  }

  if (order?.auto_cancel_error && !order?.refunded) {
    text += `\nدلیل لغو نشدن: ${escapeHtml(order.auto_cancel_error)}`;
  }

  return text;
}

function virtualNumberActionRows(order) {
  const rows = [];
  const active =
    order &&
    !order.refunded &&
    ["active", "cancel_failed"].includes(String(order.status || ""));

  if (active && !order.otp_code && !order.otp_text) {
    rows.push([
      Markup.button.callback(
        "دریافت کد SMS",
        `vn:otp:${order.id}`
      )
    ]);
    rows.push([
      Markup.button.callback(
        "لغو شماره",
        `vn:cancel:${order.id}`
      )
    ]);
  }

  return rows;
}

function virtualNumberOrderKeyboard(
  order,
  extraRows = [],
  includeNavigation = true
) {
  const rows = [
    ...virtualNumberActionRows(order),
    ...extraRows
  ];

  if (includeNavigation) {
    rows.push([
      customEmojiCallback(
        "شماره‌های من",
        "vn:my:0",
        CUSTOM_EMOJI.menu.virtualNumber
      )
    ]);
    rows.push([
      customEmojiCallback(
        "خانه",
        "menu:home",
        CUSTOM_EMOJI.back
      )
    ]);
  }

  return Markup.inlineKeyboard(rows);
}

async function refundVirtualNumberOrder(
  orderId,
  errorPayload = null
) {
  const client =
    await pool.connect();

  try {
    await client.query("BEGIN");

    const result =
      await client.query(
        `SELECT *
         FROM virtual_number_orders
         WHERE id = $1
         FOR UPDATE`,
        [orderId]
      );

    if (!result.rowCount) {
      await client.query("ROLLBACK");
      return;
    }

    const order =
      result.rows[0];

    if (!order.refunded) {
      await client.query(
        `UPDATE users
         SET balance = balance + $1
         WHERE telegram_id = $2`,
        [
          Number(order.charge || 0),
          order.telegram_id
        ]
      );
    }

    await client.query(
      `UPDATE virtual_number_orders
       SET status = 'failed',
           refunded = TRUE,
           refunded_at = COALESCE(refunded_at, NOW()),
           provider_payload = COALESCE($1::jsonb, provider_payload),
           updated_at = NOW()
       WHERE id = $2`,
      [
        errorPayload
          ? JSON.stringify(
              errorPayload
            )
          : null,
        orderId
      ]
    );

    await client.query("COMMIT");
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {}

    throw error;
  } finally {
    client.release();
  }
}

function virtualCancelErrorText(error) {
  return String(
    error?.details ||
    error?.message ||
    error?.code ||
    "لغو این شماره توسط سرویس‌دهنده رد شد."
  ).trim();
}

function isVirtualOtpMissingError(error) {
  const code = String(error?.code || "").toUpperCase();
  return (
    error instanceof HeroSmsApiError && error.status === 404
  ) || code.includes("NO_OTP") || code.includes("OTP_NOT_FOUND");
}

function isTransientVirtualCancelError(error) {
  const code = String(error?.code || error?.message || "").toUpperCase();
  return (
    code.includes("EARLY_CANCEL_DENIED") ||
    code.includes("TIMEOUT") ||
    code.includes("NETWORK") ||
    code.includes("RATE_LIMIT") ||
    Number(error?.status || 0) === 429 ||
    Number(error?.status || 0) >= 500
  );
}

async function cancelAndRefundVirtualNumber(
  orderId,
  {
    telegramId = null,
    auto = false,
    checkOtp = false
  } = {}
) {
  const params = [Number(orderId)];
  let where = "id = $1";

  if (telegramId !== null) {
    params.push(Number(telegramId));
    where += ` AND telegram_id = $${params.length}`;
  }

  const existing = await query(
    `SELECT *
     FROM virtual_number_orders
     WHERE ${where}
     LIMIT 1`,
    params
  );

  if (!existing.rowCount) {
    return { ok: false, reason: "not_found", order: null };
  }

  let order = existing.rows[0];

  if (order.refunded) {
    return { ok: true, reason: "already_refunded", order };
  }

  if (order.otp_code || order.otp_text || order.status === "otp_received") {
    return { ok: false, reason: "otp_received", order };
  }

  if (!order.activation_id) {
    return { ok: false, reason: "missing_activation", order };
  }

  if (checkOtp) {
    try {
      const otp = await getVirtualNumberLastOtp(order.activation_id);
      const saved = await saveVirtualOtp(order.id, otp);
      if (saved) {
        return { ok: false, reason: "otp_received", order: saved };
      }
    } catch (error) {
      if (!isVirtualOtpMissingError(error)) {
        await query(
          `UPDATE virtual_number_orders
           SET auto_cancel_attempted_at = NOW(),
               auto_cancel_error = $1,
               updated_at = NOW()
           WHERE id = $2`,
          [virtualCancelErrorText(error), order.id]
        );

        return {
          ok: false,
          reason: "otp_check_failed",
          error,
          order
        };
      }
    }
  }

  const claimed = await query(
    `UPDATE virtual_number_orders
     SET status = 'cancelling',
         auto_cancel_attempted_at = CASE WHEN $2 THEN NOW() ELSE auto_cancel_attempted_at END,
         updated_at = NOW()
     WHERE id = $1
       AND refunded = FALSE
       AND otp_code IS NULL
       AND otp_text IS NULL
       AND status IN ('active','cancel_failed')
     RETURNING *`,
    [order.id, Boolean(auto)]
  );

  if (!claimed.rowCount) {
    const latest = await query(
      `SELECT * FROM virtual_number_orders WHERE id = $1`,
      [order.id]
    );
    return {
      ok: false,
      reason: "not_cancellable",
      order: latest.rows[0] ?? order
    };
  }

  order = claimed.rows[0];

  try {
    await cancelVirtualNumber(order.activation_id);
  } catch (error) {
    const transient = isTransientVirtualCancelError(error);
    const message = virtualCancelErrorText(error);

    const failed = await query(
      `UPDATE virtual_number_orders
       SET status = $1,
           auto_cancel_error = $2,
           updated_at = NOW()
       WHERE id = $3
       RETURNING *`,
      [
        transient ? "active" : "cancel_failed",
        message,
        order.id
      ]
    );

    return {
      ok: false,
      reason: transient ? "retryable" : "provider_rejected",
      error,
      order: failed.rows[0] ?? order
    };
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const locked = await client.query(
      `SELECT *
       FROM virtual_number_orders
       WHERE id = $1
       FOR UPDATE`,
      [order.id]
    );

    if (!locked.rowCount) {
      await client.query("ROLLBACK");
      return { ok: false, reason: "not_found", order: null };
    }

    const current = locked.rows[0];

    if (!current.refunded) {
      await client.query(
        `UPDATE users
         SET balance = balance + $1
         WHERE telegram_id = $2`,
        [Number(current.charge || 0), current.telegram_id]
      );
    }

    const updated = await client.query(
      `UPDATE virtual_number_orders
       SET status = 'cancelled',
           refunded = TRUE,
           refunded_at = COALESCE(refunded_at, NOW()),
           cancelled_at = COALESCE(cancelled_at, NOW()),
           auto_cancel_due_at = NULL,
           auto_cancel_error = NULL,
           updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [current.id]
    );

    await client.query("COMMIT");

    return {
      ok: true,
      reason: "refunded",
      order: updated.rows[0] ?? current
    };
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {}
    throw error;
  } finally {
    client.release();
  }
}

async function editVirtualStatusMessage(order) {
  if (!order?.telegram_chat_id || !order?.telegram_message_id) return;

  const text = await virtualNumberOrderText(order);
  const keyboard = virtualNumberOrderKeyboard(
    order,
    [],
    false
  );

  try {
    await bot.telegram.callApi(
      "editMessageText",
      {
        chat_id: order.telegram_chat_id,
        message_id: order.telegram_message_id,
        text,
        parse_mode: "HTML",
        reply_markup: keyboard.reply_markup
      }
    );

    await query(
      `UPDATE virtual_number_orders
       SET timer_message_updated_at = NOW()
       WHERE id = $1`,
      [order.id]
    );
  } catch (error) {
    const message = String(error?.message || error || "");

    if (message.toLowerCase().includes("message is not modified")) {
      await query(
        `UPDATE virtual_number_orders
         SET timer_message_updated_at = NOW()
         WHERE id = $1`,
        [order.id]
      ).catch(() => {});
      return;
    }

    if (
      message.toLowerCase().includes("message to edit not found") ||
      message.toLowerCase().includes("message can't be edited")
    ) {
      await query(
        `UPDATE virtual_number_orders
         SET telegram_message_id = NULL,
             timer_message_updated_at = NOW()
         WHERE id = $1`,
        [order.id]
      ).catch(() => {});
    }
  }
}

async function showMyVirtualNumbers(
  ctx,
  page = 0,
  { edit = true } = {}
) {
  const countResult = await query(
    `SELECT COUNT(*)::int AS total
     FROM virtual_number_orders
     WHERE telegram_id = $1`,
    [ctx.from.id]
  );

  const total = Number(countResult.rows[0]?.total || 0);

  if (!total) {
    const text =
      `${virtualNumberTitle("شماره‌های من")}\n\n` +
      "هنوز شماره‌ای خریداری نکرده‌اید.";

    const options = htmlText(
      text,
      Markup.inlineKeyboard([
        [Markup.button.callback("خرید شماره", "vn:services")],
        [customEmojiCallback("خانه", "menu:home", CUSTOM_EMOJI.back)]
      ])
    );

    return edit && ctx.callbackQuery
      ? ctx.editMessageText(text, options)
      : ctx.reply(text, options);
  }

  const safePage = Math.min(
    Math.max(Number(page) || 0, 0),
    total - 1
  );

  const result = await query(
    `SELECT *
     FROM virtual_number_orders
     WHERE telegram_id = $1
     ORDER BY created_at DESC, id DESC
     LIMIT 1 OFFSET $2`,
    [ctx.from.id, safePage]
  );

  const order = result.rows[0];
  const text = await virtualNumberOrderText(order);
  const nav = [];

  if (safePage > 0) {
    nav.push(
      Markup.button.callback("⬅️ جدیدتر", `vn:my:${safePage - 1}`)
    );
  }

  nav.push(
    Markup.button.callback(`${safePage + 1} / ${total}`, "vn:noop")
  );

  if (safePage < total - 1) {
    nav.push(
      Markup.button.callback("قدیمی‌تر ➡️", `vn:my:${safePage + 1}`)
    );
  }

  const options = htmlText(
    text,
    virtualNumberOrderKeyboard(order, [nav])
  );

  return edit && ctx.callbackQuery
    ? ctx.editMessageText(text, options)
    : ctx.reply(text, options);
}

let virtualNumberWorkerRunning = false;
let virtualNumberWorkerTimer = null;

async function runVirtualNumberWorker() {
  if (virtualNumberWorkerRunning) return;
  virtualNumberWorkerRunning = true;

  try {
    const due = await query(
      `SELECT *
       FROM virtual_number_orders
       WHERE refunded = FALSE
         AND status = 'active'
         AND activation_id IS NOT NULL
         AND otp_code IS NULL
         AND otp_text IS NULL
         AND auto_cancel_due_at IS NOT NULL
         AND auto_cancel_due_at <= NOW()
         AND (
           auto_cancel_attempted_at IS NULL OR
           auto_cancel_attempted_at <= NOW() - INTERVAL '60 seconds'
         )
       ORDER BY auto_cancel_due_at ASC
       LIMIT 20`
    );

    for (const order of due.rows) {
      const result = await cancelAndRefundVirtualNumber(
        order.id,
        { auto: true, checkOtp: true }
      );

      if (result?.order) {
        await editVirtualStatusMessage(result.order).catch(() => {});
      }

      if (result?.reason === "refunded" && result.order) {
        const notice =
          `${virtualNumberTitle()}\n\n` +
          `سفارش <code>${escapeHtml(virtualNumberPublicOrderId(result.order.id))}</code> پس از ۱۰ دقیقه بدون دریافت OTP خودکار لغو شد.\n` +
          `💰 $${formatVirtualNumberPrice(result.order.charge)} به کیف پول شما برگشت.`;

        await bot.telegram.sendMessage(
          result.order.telegram_id,
          notice,
          { parse_mode: "HTML" }
        ).catch(() => {});
      } else if (result?.reason === "otp_received" && result.order) {
        const notice =
          `${virtualNumberTitle()}\n\n` +
          `برای سفارش <code>${escapeHtml(virtualNumberPublicOrderId(result.order.id))}</code> کد دریافت شد و لغو خودکار متوقف شد.` +
          (result.order.otp_code
            ? `\nکد: <code>${escapeHtml(result.order.otp_code)}</code>`
            : "");

        await bot.telegram.sendMessage(
          result.order.telegram_id,
          notice,
          { parse_mode: "HTML" }
        ).catch(() => {});
      }
    }

    const timers = await query(
      `SELECT *
       FROM virtual_number_orders
       WHERE refunded = FALSE
         AND status = 'active'
         AND otp_code IS NULL
         AND otp_text IS NULL
         AND auto_cancel_due_at > NOW()
         AND telegram_chat_id IS NOT NULL
         AND telegram_message_id IS NOT NULL
         AND (
           timer_message_updated_at IS NULL OR
           timer_message_updated_at <= NOW() - INTERVAL '55 seconds'
         )
       ORDER BY auto_cancel_due_at ASC
       LIMIT 50`
    );

    for (const order of timers.rows) {
      await editVirtualStatusMessage(order).catch(() => {});
    }
  } catch (error) {
    console.error(
      "Virtual number worker error:",
      error?.message || error
    );
  } finally {
    virtualNumberWorkerRunning = false;
  }
}

function startVirtualNumberWorker() {
  if (virtualNumberWorkerTimer) return;

  runVirtualNumberWorker().catch(() => {});
  virtualNumberWorkerTimer = setInterval(
    () => runVirtualNumberWorker().catch(() => {}),
    VIRTUAL_NUMBER_WORKER_INTERVAL_MS
  );

  if (typeof virtualNumberWorkerTimer.unref === "function") {
    virtualNumberWorkerTimer.unref();
  }
}


bot.use(async (ctx, next) => {
  if (ctx.from) {
    await ensureUser(ctx.from);
  }

  return next();
});

bot.start(home);

bot.action("menu:home", async (ctx) => {
  await answerCb(ctx);
  await home(ctx);
});

bot.action("menu:new_order", async (ctx) => {
  await answerCb(ctx);
  await platforms(ctx, "order");
});

bot.action("menu:prices", async (ctx) => {
  await answerCb(ctx);
  await platforms(ctx, "price");
});

bot.action("menu:virtual_number", async (ctx) => {
  await answerCb(ctx);
  await clearSession(ctx.from.id);

  return showVirtualNumberServices(
    ctx,
    0,
    { edit: true }
  );
});

bot.action("vn:services", async (ctx) => {
  await answerCb(ctx);

  return showVirtualNumberServices(
    ctx,
    0,
    { edit: true }
  );
});


bot.action(/^vn:my:(\d+)$/, async (ctx) => {
  await answerCb(ctx);
  return showMyVirtualNumbers(
    ctx,
    Number(ctx.match[1]),
    { edit: true }
  );
});

bot.action("vn:noop", async (ctx) => {
  await answerCb(ctx);
});

bot.action(/^vn:sp:(\d+)$/, async (ctx) => {
  await answerCb(ctx);

  return showVirtualNumberServices(
    ctx,
    Number(ctx.match[1]),
    { edit: true }
  );
});

bot.action(
  /^vn:s:(\d+):(\d+)$/,
  async (ctx) => {
    await answerCb(ctx);

    const session =
      await getSession(
        ctx.from.id
      );

    const services =
      Array.isArray(
        session.data?.services
      )
        ? session.data.services
        : [];

    const service =
      services[
        Number(ctx.match[1])
      ];

    if (
      session.state !==
        "vn_services" ||
      !service
    ) {
      return editError(
        ctx,
        "لیست سرویس‌ها منقضی شده است. دوباره این بخش را باز کنید.",
        mainMenu()
      );
    }

    return showVirtualNumberPackages(
      ctx,
      service,
      0,
      { edit: true }
    );
  }
);

bot.action(
  /^vn:pp:(\d+)$/,
  async (ctx) => {
    await answerCb(ctx);

    const session =
      await getSession(
        ctx.from.id
      );

    if (
      session.state !==
        "vn_packages" ||
      !session.data?.service
    ) {
      return editError(
        ctx,
        "لیست بسته‌ها منقضی شده است.",
        mainMenu()
      );
    }

    return showVirtualNumberPackages(
      ctx,
      session.data.service,
      Number(ctx.match[1]),
      { edit: true }
    );
  }
);

bot.action(
  /^vn:p:(\d+):(\d+)$/,
  async (ctx) => {
    await answerCb(ctx);

    const session =
      await getSession(
        ctx.from.id
      );

    const packages =
      Array.isArray(
        session.data?.packages
      )
        ? session.data.packages
        : [];

    const selected =
      packages[
        Number(ctx.match[1])
      ];

    if (
      session.state !==
        "vn_packages" ||
      !selected
    ) {
      return editError(
        ctx,
        "این بسته منقضی شده است. دوباره انتخاب کنید.",
        mainMenu()
      );
    }

    const data = {
      service_code:
        selected.serviceCode,
      service_name:
        selected.serviceName,
      country_id:
        Number(
          selected.countryId
        ),
      country_name:
        selected.countryName,
      provider_price:
        Number(
          selected.providerPrice
        ),
      selling_price:
        Number(
          selected.sellingPrice
        ),
      request_token:
        `vn_${ctx.from.id}_${Date.now()}_${selected.serviceCode}_${selected.countryId}`
    };

    return renderVirtualNumberChoice(
      ctx,
      data,
      { edit: true }
    );
  }
);

bot.action("vn:resume", async (ctx) => {
  await answerCb(ctx);

  const session =
    await getSession(
      ctx.from.id
    );

  if (
    session.state !==
      "vn_precheck" &&
    session.state !==
      "vn_confirm"
  ) {
    return editError(
      ctx,
      "اطلاعات خرید پیدا نشد. دوباره بسته را انتخاب کنید.",
      mainMenu()
    );
  }

  return renderVirtualNumberChoice(
    ctx,
    session.data,
    { edit: true }
  );
});

bot.action("vn:topup", async (ctx) => {
  await answerCb(ctx);

  if (!publicBaseUrl()) {
    return editError(
      ctx,
      "دامنه عمومی Railway هنوز ساخته نشده است.",
      mainMenu()
    );
  }

  const session =
    await getSession(
      ctx.from.id
    );

  if (
    session.state !==
      "vn_precheck"
  ) {
    return editError(
      ctx,
      "اطلاعات بسته پیدا نشد.",
      mainMenu()
    );
  }

  const balance =
    await getUserBalance(
      ctx.from.id
    );

  const price =
    Number(
      session.data
        ?.selling_price || 0
    );

  const shortfall =
    Math.max(
      0,
      Number(
        (
          price - balance
        ).toFixed(4)
      )
    );

  if (shortfall <= 0) {
    return renderVirtualNumberChoice(
      ctx,
      session.data,
      { edit: true }
    );
  }

  const amount =
    Math.max(1, shortfall);

  const orderId =
    `dep_${ctx.from.id}_${Date.now()}`;

  try {
    await query(
      `INSERT INTO deposits (
         telegram_id,
         provider,
         external_order_id,
         amount_usd,
         status
       )
       VALUES (
         $1,
         'heleket',
         $2,
         $3,
         'creating'
       )`,
      [
        ctx.from.id,
        orderId,
        amount
      ]
    );

    const invoice =
      await createHeleketInvoice({
        amount,
        orderId,
        telegramId:
          ctx.from.id
      });

    await query(
      `UPDATE deposits
       SET invoice_uuid = $1,
           status = $2,
           provider_payload = $3::jsonb,
           updated_at = NOW()
       WHERE external_order_id = $4`,
      [
        String(
          invoice.uuid ?? ""
        ),
        String(
          invoice.status ??
          invoice.payment_status ??
          "check"
        ),
        JSON.stringify(invoice),
        orderId
      ]
    );

    const text =
      `${virtualNumberTitle()}\n\n` +
      `کسری موجودی: $${formatVirtualNumberPrice(shortfall)}\n` +
      `فاکتور: $${amount.toFixed(2)}\n\n` +
      "پس از تأیید پرداخت، روی «بازگشت به خرید» بزنید.";

    return ctx.editMessageText(
      text,
      htmlText(
        text,
        Markup.inlineKeyboard([
          [
            Markup.button.url(
              "پرداخت با کریپتو و تتر",
              invoice.url
            )
          ],
          [
            Markup.button.callback(
              "بازگشت به خرید",
              "vn:resume"
            )
          ],
          [
            customEmojiCallback(
              "خانه",
              "menu:home",
              CUSTOM_EMOJI.back
            )
          ]
        ])
      )
    );
  } catch (error) {
    console.error(
      "Virtual number topup error:",
      error?.message || error
    );

    await query(
      `UPDATE deposits
       SET status = 'failed',
           provider_payload = $1::jsonb,
           updated_at = NOW()
       WHERE external_order_id = $2`,
      [
        JSON.stringify({
          error: String(
            error?.message ||
            error
          )
        }),
        orderId
      ]
    ).catch(() => {});

    return editError(
      ctx,
      "ساخت فاکتور پرداخت ممکن نشد.",
      mainMenu()
    );
  }
});

bot.action("vn:confirm", async (ctx) => {
  await answerCb(
    ctx,
    "در حال خرید شماره..."
  );

  const claimed =
    await query(
      `UPDATE user_sessions
       SET state = 'vn_purchasing',
           updated_at = NOW()
       WHERE telegram_id = $1
         AND state = 'vn_confirm'
       RETURNING data`,
      [ctx.from.id]
    );

  if (!claimed.rowCount) {
    return editError(
      ctx,
      "این خرید قبلاً پردازش شده یا منقضی شده است.",
      mainMenu()
    );
  }

  const data =
    claimed.rows[0].data || {};

  let orderRow = null;

  try {
    const current =
      await getVirtualNumberPackage(
        data.service_code,
        data.country_id,
        { fresh: true }
      );

    if (!current) {
      await setSession(
        ctx.from.id,
        "vn_precheck",
        data
      );

      return editError(
        ctx,
        "این بسته همین حالا ناموجود شد. مبلغی از کیف پول کم نشده است.",
        mainMenu()
      );
    }

    const currentData = {
      ...data,
      provider_price:
        Number(
          current.providerPrice
        ),
      selling_price:
        Number(
          current.sellingPrice
        ),
      country_name:
        current.countryName ||
        data.country_name
    };

    if (
      Math.abs(
        Number(
          currentData.selling_price
        ) -
        Number(
          data.selling_price
        )
      ) > 0.00005
    ) {
      currentData.request_token =
        `vn_${ctx.from.id}_${Date.now()}_${data.service_code}_${data.country_id}`;

      await setSession(
        ctx.from.id,
        "vn_confirm",
        currentData
      );

      return renderVirtualNumberChoice(
        ctx,
        currentData,
        { edit: true }
      );
    }

    const client =
      await pool.connect();

    try {
      await client.query("BEGIN");

      const debit =
        await client.query(
          `UPDATE users
           SET balance = balance - $1
           WHERE telegram_id = $2
             AND balance >= $1
           RETURNING balance`,
          [
            Number(
              currentData
                .selling_price
            ),
            ctx.from.id
          ]
        );

      if (!debit.rowCount) {
        await client.query("ROLLBACK");

        await setSession(
          ctx.from.id,
          "vn_precheck",
          currentData
        );

        return renderVirtualNumberChoice(
          ctx,
          currentData,
          { edit: true }
        );
      }

      const inserted =
        await client.query(
          `INSERT INTO virtual_number_orders (
             telegram_id,
             request_token,
             service_code,
             service_name,
             country_id,
             country_name,
             provider_cost,
             charge,
             status
           )
           VALUES (
             $1,$2,$3,$4,$5,$6,$7,$8,'purchasing'
           )
           ON CONFLICT (request_token)
           DO NOTHING
           RETURNING *`,
          [
            ctx.from.id,
            String(
              currentData
                .request_token
            ),
            String(
              currentData
                .service_code
            ),
            String(
              currentData
                .service_name || ""
            ),
            Number(
              currentData
                .country_id
            ),
            String(
              currentData
                .country_name || ""
            ),
            Number(
              currentData
                .provider_price
            ),
            Number(
              currentData
                .selling_price
            )
          ]
        );

      if (!inserted.rowCount) {
        await client.query(
          `UPDATE users
           SET balance = balance + $1
           WHERE telegram_id = $2`,
          [
            Number(
              currentData
                .selling_price
            ),
            ctx.from.id
          ]
        );

        await client.query("COMMIT");

        return editError(
          ctx,
          "این خرید قبلاً ثبت شده است.",
          mainMenu()
        );
      }

      orderRow =
        inserted.rows[0];

      await client.query("COMMIT");
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {}
      throw error;
    } finally {
      client.release();
    }

    let activation;

    try {
      activation =
        await buyVirtualNumber({
          serviceCode:
            currentData.service_code,
          countryId:
            currentData.country_id,
          providerPrice:
            currentData.provider_price
        });
    } catch (error) {
      await refundVirtualNumberOrder(
        orderRow.id,
        {
          code:
            error?.code ||
            "provider_error",
          message:
            error?.message ||
            String(error)
        }
      );

      await setSession(
        ctx.from.id,
        "vn_confirm",
        currentData
      );

      return editError(
        ctx,
        virtualNumberApiErrorText(
          error
        ),
        mainMenu()
      );
    }

    const activationId =
      String(
        activation.id ||
        activation.activationId ||
        ""
      );

    const phone =
      String(
        activation.phone ||
        activation.phoneNumber ||
        ""
      );

    const providerCost =
      Number(
        activation.price ??
        activation.activationCost ??
        currentData.provider_price
      );

    const updated =
      await query(
        `UPDATE virtual_number_orders
         SET activation_id = $1,
             phone_number = $2,
             provider_cost = $3,
             currency = $4,
             country_phone_code = $5,
             status = 'active',
             auto_cancel_due_at = NOW() + INTERVAL '10 minutes',
             auto_cancel_attempted_at = NULL,
             auto_cancel_error = NULL,
             provider_payload = $6::jsonb,
             updated_at = NOW()
         WHERE id = $7
         RETURNING *`,
        [
          activationId,
          phone,
          providerCost,
          Number(
            activation.currency || 840
          ),
          Number(activation.countryPhoneCode || 0) || null,
          JSON.stringify(
            activation
          ),
          orderRow.id
        ]
      );

    await clearSession(
      ctx.from.id
    );

    const order =
      updated.rows[0] || {
        ...orderRow,
        activation_id:
          activationId,
        phone_number: phone,
        provider_cost:
          providerCost,
        country_phone_code:
          Number(activation.countryPhoneCode || 0) || null,
        status: "active",
        auto_cancel_due_at: new Date(
          Date.now() + VIRTUAL_NUMBER_AUTO_CANCEL_MS
        )
      };

    const successText =
      `${virtualNumberTitle()}\n\n` +
      `${tgEmoji(ORDER_RESULT_EMOJI.success, "✅")} شماره با موفقیت خریداری شد.\n` +
      `${tgEmoji(ORDER_RESULT_EMOJI.orderId, "🆔")} Order ID: <code>${escapeHtml(
        virtualNumberPublicOrderId(order.id)
      )}</code>\n\n` +
      "وضعیت شماره در پیام جداگانه پایین نمایش داده می‌شود.";

    await ctx.editMessageText(
      successText,
      htmlText(successText, mainMenu())
    );

    const text = await virtualNumberOrderText(order);
    const statusMessage = await ctx.reply(
      text,
      htmlText(
        text,
        virtualNumberOrderKeyboard(
          order,
          [],
          false
        )
      )
    );

    await query(
      `UPDATE virtual_number_orders
       SET telegram_chat_id = $1,
           telegram_message_id = $2,
           timer_message_updated_at = NOW(),
           updated_at = NOW()
       WHERE id = $3`,
      [
        statusMessage.chat?.id || ctx.chat?.id || ctx.from.id,
        statusMessage.message_id,
        order.id
      ]
    );

    return statusMessage;
  } catch (error) {
    console.error(
      "Virtual number confirm error:",
      error?.code || "error",
      error?.message || error
    );

    if (orderRow?.id) {
      await refundVirtualNumberOrder(
        orderRow.id,
        {
          code:
            error?.code ||
            "internal_error",
          message:
            error?.message ||
            String(error)
        }
      ).catch(() => {});
    }

    await clearSession(
      ctx.from.id
    );

    return editError(
      ctx,
      virtualNumberApiErrorText(
        error
      ),
      mainMenu()
    );
  }
});

bot.action(
  /^vn:otp:(\d+)$/,
  async (ctx) => {
    await answerCb(
      ctx,
      "در حال بررسی کد..."
    );

    const result = await query(
      `SELECT *
       FROM virtual_number_orders
       WHERE id = $1
         AND telegram_id = $2`,
      [Number(ctx.match[1]), ctx.from.id]
    );

    if (!result.rowCount) {
      return editError(
        ctx,
        "سفارش پیدا نشد.",
        mainMenu()
      );
    }

    const order = result.rows[0];

    if (order.refunded || order.status === "cancelled") {
      return ctx.answerCbQuery(
        "این شماره قبلاً لغو و Refund شده است.",
        { show_alert: true }
      );
    }

    if (!order.activation_id) {
      return editError(
        ctx,
        "شناسه فعال‌سازی پیدا نشد.",
        mainMenu()
      );
    }

    try {
      const otp = await getVirtualNumberLastOtp(order.activation_id);
      const saved = await saveVirtualOtp(order.id, otp);

      if (!saved) {
        return ctx.answerCbQuery(
          "کد هنوز نرسیده است.",
          { show_alert: true }
        );
      }

      const currentMessageId = ctx.callbackQuery?.message?.message_id;

      if (
        saved.telegram_message_id &&
        Number(saved.telegram_message_id) !== Number(currentMessageId)
      ) {
        await editVirtualStatusMessage(saved).catch(() => {});
      }

      const text = await virtualNumberOrderText(saved);
      return ctx.editMessageText(
        text,
        htmlText(
          text,
          virtualNumberOrderKeyboard(saved)
        )
      );
    } catch (error) {
      if (isVirtualOtpMissingError(error)) {
        return ctx.answerCbQuery(
          "کد هنوز دریافت نشده است.",
          { show_alert: true }
        );
      }

      console.error(
        "Virtual number OTP error:",
        error?.code || "error",
        error?.message || error
      );

      return ctx.answerCbQuery(
        "فعلاً دریافت کد ممکن نشد.",
        { show_alert: true }
      );
    }
  }
);

bot.action(
  /^vn:cancel:(\d+)$/,
  async (ctx) => {
    await answerCb(
      ctx,
      "در حال لغو شماره..."
    );

    try {
      const result = await cancelAndRefundVirtualNumber(
        Number(ctx.match[1]),
        {
          telegramId: ctx.from.id,
          auto: false,
          checkOtp: true
        }
      );

      if (result.reason === "not_found") {
        return editError(
          ctx,
          "سفارش پیدا نشد.",
          mainMenu()
        );
      }

      if (result.reason === "otp_received") {
        if (result.order) {
          await editVirtualStatusMessage(result.order).catch(() => {});
        }

        return ctx.answerCbQuery(
          "برای این شماره OTP دریافت شده و دیگر خودکار Refund نمی‌شود.",
          { show_alert: true }
        );
      }

      if (
        result.reason === "provider_rejected" ||
        result.reason === "retryable" ||
        result.reason === "otp_check_failed"
      ) {
        return ctx.answerCbQuery(
          virtualCancelErrorText(result.error).slice(0, 180),
          { show_alert: true }
        );
      }

      if (result.reason === "missing_activation") {
        return ctx.answerCbQuery(
          "شناسه فعال‌سازی پیدا نشد.",
          { show_alert: true }
        );
      }

      if (result.reason === "not_cancellable") {
        return ctx.answerCbQuery(
          "این شماره در حال حاضر قابل لغو نیست.",
          { show_alert: true }
        );
      }

      const order = result.order;

      if (!order) {
        return editError(
          ctx,
          "لغو شماره ممکن نشد.",
          mainMenu()
        );
      }

      const currentMessageId = ctx.callbackQuery?.message?.message_id;
      if (
        order.telegram_message_id &&
        Number(order.telegram_message_id) !== Number(currentMessageId)
      ) {
        await editVirtualStatusMessage(order).catch(() => {});
      }

      const text = await virtualNumberOrderText(order);
      return ctx.editMessageText(
        text,
        htmlText(
          text,
          virtualNumberOrderKeyboard(order)
        )
      );
    } catch (error) {
      console.error(
        "Virtual number cancel error:",
        error?.message || error
      );

      return editError(
        ctx,
        "لغو شماره ممکن نشد.",
        mainMenu()
      );
    }
  }
);

bot.action("order:platforms", async (ctx) => {
  await answerCb(ctx);
  await platforms(ctx, "order");
});

bot.action("price:platforms", async (ctx) => {
  await answerCb(ctx);
  await platforms(ctx, "price");
});

bot.action(/^order:platform:(\d+)$/, async (ctx) => {
  await answerCb(ctx);
  await categories(
    ctx,
    "order",
    Number(ctx.match[1])
  );
});

bot.action(/^price:platform:(\d+)$/, async (ctx) => {
  await answerCb(ctx);
  await categories(
    ctx,
    "price",
    Number(ctx.match[1])
  );
});

bot.action(/^order:category:(\d+):(\d+)$/, async (ctx) => {
  await answerCb(ctx);
  await servicePanels(
    ctx,
    "order",
    Number(ctx.match[1]),
    Number(ctx.match[2])
  );
});

bot.action(/^price:category:(\d+):(\d+)$/, async (ctx) => {
  await answerCb(ctx);
  await servicePanels(
    ctx,
    "price",
    Number(ctx.match[1]),
    Number(ctx.match[2])
  );
});

bot.action(/^order:back_categories:(\d+)$/, async (ctx) => {
  await answerCb(ctx);
  await categories(
    ctx,
    "order",
    Number(ctx.match[1])
  );
});

bot.action(/^price:back_categories:(\d+)$/, async (ctx) => {
  await answerCb(ctx);
  await categories(
    ctx,
    "price",
    Number(ctx.match[1])
  );
});

bot.action(
  /^pv:([a-z0-9]+):([a-z0-9]+):([op]):(\d+):(\d+)$/,
  async (ctx) => {
    await answerCb(
      ctx,
      "در حال دریافت سرویس‌ها..."
    );

    await providerPanel(
      ctx,
      ctx.match[1],
      ctx.match[2],
      modeName(ctx.match[3]),
      Number(ctx.match[4]),
      Number(ctx.match[5]),
      0
    );
  }
);

bot.action(
  /^pvp:([a-z0-9]+):([a-z0-9]+):([op]):(\d+):(\d+):(\d+)$/,
  async (ctx) => {
    await answerCb(ctx);

    await providerPanel(
      ctx,
      ctx.match[1],
      ctx.match[2],
      modeName(ctx.match[3]),
      Number(ctx.match[4]),
      Number(ctx.match[5]),
      Number(ctx.match[6])
    );
  }
);


bot.action(
  /^ps:([a-z0-9]+):([a-z0-9]+):([op]):(\d+):(\d+):(\d+):(\d+)$/,
  async (ctx) => {
    await answerCb(ctx);

    await providerService(
      ctx,
      ctx.match[1],
      ctx.match[2],
      modeName(ctx.match[3]),
      Number(ctx.match[4]),
      Number(ctx.match[5]),
      Number(ctx.match[6]),
      Number(ctx.match[7])
    );
  }
);

bot.action(
  /^po:([a-z0-9]+):([a-z0-9]+):(\d+):(\d+):(\d+)$/,
  async (ctx) => {
    await answerCb(ctx);

    try {
      const providerCode = ctx.match[1];
      const panelCode = ctx.match[2];
      const platformId = Number(ctx.match[3]);
      const categoryId = Number(ctx.match[4]);
      const serviceId = Number(ctx.match[5]);

      const service = await getService(
        providerCode,
        panelCode,
        serviceId
      );

      if (!service) {
        return ctx.editMessageText(
          "❌ سرویس در دسترس نیست.",
          mainMenu()
        );
      }

      const info = await categoryInfo(
        platformId,
        categoryId
      );

      const sessionData = {
        provider_code: providerCode,
        provider_name: getProviderName(providerCode),
        panel_code: panelCode,
        platform_id: platformId,
        category_id: categoryId,
        provider_service_id: String(service.service),
        service_name: service.name,
        provider_rate: service.providerRate,
        selling_rate: service.sellingRate,
        min: service.min,
        max: service.max,
        custom_comments: service.customComments,
        refill_supported: Boolean(service.refill),
        cancel_supported: Boolean(service.cancel)
      };

      if (service.customComments) {
        await setSession(
          ctx.from.id,
          "provider_custom_link",
          sessionData
        );

        const text =
          `${serviceTitle(info, service.name)}\n\n` +
          `${htmlInfoLine("price", "قیمت هر 1000", `$${service.sellingRate.toFixed(2)}`)}\n` +
          `${htmlInfoLine("min", "حداقل سفارش", service.min.toLocaleString("en-US"))}\n` +
          `${htmlInfoLine("max", "حداکثر سفارش", service.max.toLocaleString("en-US"))}\n` +
          `${htmlInfoLine("orderType", "نوع سفارش", "کامنت دلخواه")}\n\n` +
          "ابتدا لینک موردنظر را ارسال کنید.\n\n" +
          "برای لغو: /cancel";

        return ctx.editMessageText(
          text,
          htmlText(text)
        );
      }

      await setSession(
        ctx.from.id,
        "provider_quantity",
        sessionData
      );

      const text =
        `${serviceTitle(info, service.name)}\n\n` +
        `${htmlInfoLine("price", "قیمت هر 1000", `$${service.sellingRate.toFixed(2)}`)}\n` +
        `${htmlInfoLine("min", "حداقل سفارش", service.min.toLocaleString("en-US"))}\n` +
        `${htmlInfoLine("max", "حداکثر سفارش", service.max.toLocaleString("en-US"))}\n\n` +
        "تعداد موردنظر را به صورت عدد ارسال کنید.\n\n" +
        "برای لغو: /cancel";

      await ctx.editMessageText(
        text,
        htmlText(text)
      );
    } catch (error) {
      console.error(
        "Start provider order error:",
        error
      );

      await editError(
        ctx,
        "شروع سفارش ممکن نشد.",
        mainMenu()
      );
    }
  }
);

bot.command("cancel", async (ctx) => {
  await clearSession(ctx.from.id);

  await replyError(
    ctx,
    "سفارش لغو شد.",
    mainMenu()
  );
});

async function replyMenuPlatforms(ctx, mode) {
  await clearSession(ctx.from.id);

  const result = await query(
    `SELECT id, name, emoji
     FROM platforms
     WHERE status = TRUE
     ORDER BY sort_order, id`
  );

  const icon = tgEmoji(
    CUSTOM_EMOJI.info.platformTitle,
    "📱"
  );

  const title =
    mode === "order"
      ? `${icon} برای کدام برنامه می‌خواهید سفارش ثبت کنید؟`
      : `${icon} قیمت خدمات کدام برنامه را می‌خواهید؟`;

  return ctx.reply(
    title,
    htmlText(
      title,
      platformKeyboard(result.rows, mode)
    )
  );
}

async function replyMenuBalance(ctx) {
  await clearSession(ctx.from.id);

  const result = await query(
    `SELECT balance
     FROM users
     WHERE telegram_id = $1`,
    [ctx.from.id]
  );

  const balance = Number(
    result.rows[0]?.balance ?? 0
  );

  const text =
    `${htmlMenuTitle("balance", "کیف پول")}\\n\\n` +
    `موجودی شما: $${balance.toFixed(2)}\\n\\n` +
    `${htmlMenuTitle("deposit", "افزایش موجودی")}\\n` +
    "از طریق دکمه زیر";

  return ctx.reply(
    text,
    htmlText(
      text,
      Markup.inlineKeyboard([
        [
          customEmojiCallback(
            "Heleket [ارز دیجیتال]",
            "deposit:heleket",
            CUSTOM_EMOJI.menu.deposit
          )
        ],
        [
          customEmojiCallback(
            "برگشت",
            "menu:home",
            CUSTOM_EMOJI.back
          )
        ]
      ])
    )
  );
}

async function unifiedOrderCount(telegramId) {
  const result = await query(
    `SELECT (
       (SELECT COUNT(*) FROM orders WHERE telegram_id = $1) +
       (SELECT COUNT(*) FROM virtual_number_orders WHERE telegram_id = $1) +
       (SELECT COUNT(*) FROM certificate_orders WHERE telegram_id = $1)
     )::int AS total`,
    [telegramId]
  );

  return Number(result.rows[0]?.total || 0);
}

async function unifiedOrderRef(telegramId, offset) {
  const result = await query(
    `WITH all_orders AS (
       SELECT 'social'::text AS kind, id, created_at
       FROM orders
       WHERE telegram_id = $1

       UNION ALL

       SELECT 'virtual'::text AS kind, id, created_at
       FROM virtual_number_orders
       WHERE telegram_id = $1

       UNION ALL

       SELECT 'certificate'::text AS kind, id, created_at
       FROM certificate_orders
       WHERE telegram_id = $1
     )
     SELECT kind, id, created_at
     FROM all_orders
     ORDER BY created_at DESC, id DESC
     LIMIT 1 OFFSET $2`,
    [telegramId, offset]
  );

  return result.rows[0] ?? null;
}

async function refreshSocialOrderStatus(order) {
  if (!order?.provider_order_id) return order;

  const providerName = normalizeName(order.provider_name);
  const providerCode = providerName.includes("smmx") ? "smmx" : null;
  if (!providerCode) return order;

  try {
    const providerStatus = await Promise.race([
      getProviderOrderStatus(
        providerCode,
        order.provider_order_id
      ),
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error("Provider status timeout")),
          8_000
        )
      )
    ]);

    const status = String(providerStatus?.status || "").trim();
    if (!status) return order;

    const updated = await query(
      `UPDATE orders
       SET status = $1,
           updated_at = NOW()
       WHERE id = $2
       RETURNING *`,
      [status, order.id]
    );

    return {
      ...order,
      ...(updated.rows[0] || {}),
      provider_status_payload: providerStatus
    };
  } catch (error) {
    console.error(
      "Order history status refresh error:",
      error?.message || error
    );
    return order;
  }
}

async function loadUnifiedOrder(telegramId, ref) {
  if (!ref) return null;

  if (ref.kind === "social") {
    const result = await query(
      `SELECT
         o.*,
         p.name AS platform_name,
         c.name AS category_name
       FROM orders o
       LEFT JOIN platforms p ON p.id = o.platform_id
       LEFT JOIN categories c ON c.id = o.category_id
       WHERE o.id = $1
         AND o.telegram_id = $2`,
      [ref.id, telegramId]
    );

    const order = result.rows[0] ?? null;
    if (!order) return null;
    return {
      kind: "social",
      order: await refreshSocialOrderStatus(order)
    };
  }

  if (ref.kind === "virtual") {
    const result = await query(
      `SELECT *
       FROM virtual_number_orders
       WHERE id = $1
         AND telegram_id = $2`,
      [ref.id, telegramId]
    );

    return result.rowCount
      ? { kind: "virtual", order: result.rows[0] }
      : null;
  }

  if (ref.kind === "certificate") {
    const result = await query(
      `SELECT *
       FROM certificate_orders
       WHERE id = $1
         AND telegram_id = $2`,
      [ref.id, telegramId]
    );

    return result.rowCount
      ? { kind: "certificate", order: result.rows[0] }
      : null;
  }

  return null;
}

function unifiedSocialOrderText(order) {
  let text =
    `${htmlMenuTitle("orders", "سفارش‌های من")}\n\n` +
    `${tgEmoji(ORDER_RESULT_EMOJI.orderId, "🆔")} Order ID: <code>${escapeHtml(
      socialPublicOrderId(order.id)
    )}</code>\n` +
    `نوع: سوشیال مدیا\n` +
    `برنامه: ${htmlPlatform(order.platform_name || "Social Media")}\n` +
    `سرویس: ${htmlServiceName(order.service_name || "Service")}\n` +
    `${tgEmoji(ORDER_RESULT_EMOJI.link, "🔗")} لینک: ${escapeHtml(order.link || "-")}\n` +
    `${tgEmoji(ORDER_RESULT_EMOJI.quantity, "📊")} تعداد: ${Number(order.quantity || 0).toLocaleString("en-US")}\n` +
    `${tgEmoji(ORDER_RESULT_EMOJI.amount, "💵")} مبلغ: $${Number(order.charge || 0).toFixed(2)}\n` +
    `زمان ثبت: ${escapeHtml(formatOrderTime(order.created_at))}\n` +
    `${tgEmoji(ORDER_RESULT_EMOJI.status, "⏳")} وضعیت: ${genericStatusLabel(order.status)}`;

  if (order.cancel_requested_at) {
    text += `\nزمان درخواست لغو: ${escapeHtml(formatOrderTime(order.cancel_requested_at))}`;
  }

  if (order.refill_requested_at) {
    text += `\nزمان درخواست جبران: ${escapeHtml(formatOrderTime(order.refill_requested_at))}`;
  }

  return text;
}

function unifiedVirtualOrderText(order) {
  let text =
    `${htmlMenuTitle("orders", "سفارش‌های من")}\n\n` +
    `${tgEmoji(ORDER_RESULT_EMOJI.orderId, "🆔")} Order ID: <code>${escapeHtml(
      virtualNumberPublicOrderId(order.id)
    )}</code>\n` +
    `نوع: ${virtualNumberTitle()}\n` +
    `سرویس: ${htmlVirtualServiceName(order.service_name || order.service_code || "-")}\n` +
    `کشور: ${htmlCountry(
      order.country_name || "-",
      order.country_phone_code
    )}\n` +
    `شماره: <code>${escapeHtml(order.phone_number || "-")}</code>\n` +
    `${tgEmoji(ORDER_RESULT_EMOJI.amount, "💵")} مبلغ: $${formatVirtualNumberPrice(order.charge || 0)}\n` +
    `زمان خرید: ${escapeHtml(formatOrderTime(order.created_at))}\n` +
    `${tgEmoji(ORDER_RESULT_EMOJI.status, "⏳")} وضعیت: ${virtualNumberStatusLabel(order)}`;

  const countdown =
    order.status === "active" && !order.refunded
      ? formatVirtualCountdown(order.auto_cancel_due_at)
      : null;

  if (countdown) {
    text += `\n⏳ زمان تا لغو خودکار: <code>${countdown}</code>`;
  }

  if (order.otp_code) {
    text += `\nکد دریافت‌شده: <code>${escapeHtml(order.otp_code)}</code>`;
  }

  if (order.otp_text) {
    text += `\nپیام: ${escapeHtml(order.otp_text)}`;
  }

  if (order.otp_received_at) {
    text += `\nزمان دریافت کد: ${escapeHtml(formatOrderTime(order.otp_received_at))}`;
  }

  if (order.cancelled_at) {
    text += `\nزمان لغو: ${escapeHtml(formatOrderTime(order.cancelled_at))}`;
  }

  if (order.refunded) {
    text += `\n💰 مبلغ برگشتی: $${formatVirtualNumberPrice(order.charge || 0)}`;
    if (order.refunded_at) {
      text += `\nزمان برگشت وجه: ${escapeHtml(formatOrderTime(order.refunded_at))}`;
    }
  }

  if (order.auto_cancel_error && !order.refunded) {
    text += `\nدلیل لغو نشدن: ${escapeHtml(order.auto_cancel_error)}`;
  }

  return text;
}

function unifiedCertificateOrderText(order) {
  let text =
    `${htmlMenuTitle("orders", "سفارش‌های من")}\n\n` +
    `${tgEmoji(ORDER_RESULT_EMOJI.orderId, "🆔")} Order ID: <code>${escapeHtml(
      certificatePublicOrderId(order.id)
    )}</code>\n` +
    `نوع: ${tgEmoji(CUSTOM_EMOJI.menu.certificate, "📜")} Certificate آیفون / آیپد\n` +
    `پلن: ${escapeHtml(order.plan_name || "-")}\n` +
    `UDID: <code>${escapeHtml(order.udid || "-")}</code>\n` +
    `${tgEmoji(ORDER_RESULT_EMOJI.amount, "💵")} مبلغ: $${Number(order.charge || 0).toFixed(2)}\n` +
    `زمان ثبت: ${escapeHtml(formatOrderTime(order.created_at))}\n` +
    `${tgEmoji(ORDER_RESULT_EMOJI.status, "⏳")} وضعیت: ${
      order.certificate_id && !order.expired
        ? "✅ صادر شده"
        : genericStatusLabel(order.status)
    }`;

  if (order.registered_at) {
    text += `\nزمان ثبت Certificate: ${escapeHtml(formatOrderTime(order.registered_at))}`;
  }

  if (order.certificate_id) {
    text += `\nCertificate ID: <code>${escapeHtml(order.certificate_id)}</code>`;
  }

  return text;
}

function unifiedOrderActionRows(item) {
  if (!item?.order) return [];

  if (item.kind === "virtual") {
    return virtualNumberActionRows(item.order);
  }

  if (item.kind === "social") {
    const order = item.order;
    const rows = [];

    if (order.refill_supported && !order.refill_id) {
      rows.push([
        Markup.button.callback(
          "♻️ جبران ریزش",
          `order:refill:${order.id}`
        )
      ]);
    }

    if (
      order.cancel_supported &&
      !order.cancel_closed &&
      !order.cancel_requested_at
    ) {
      rows.push([
        customEmojiCallback(
          "ثبت کنسل",
          `order:cancel_api:${order.id}`,
          ERROR_CUSTOM_EMOJI_ID
        )
      ]);
    }

    return rows;
  }

  return [];
}

async function showUnifiedOrders(
  ctx,
  page = 0,
  { edit = true } = {}
) {
  const total = await unifiedOrderCount(ctx.from.id);

  if (!total) {
    const text =
      `${htmlMenuTitle("orders", "سفارش‌های من")}\n\n` +
      "هنوز سفارشی ندارید.";

    const options = htmlText(text, mainMenu());
    return edit && ctx.callbackQuery
      ? ctx.editMessageText(text, options)
      : ctx.reply(text, options);
  }

  const safePage = Math.min(
    Math.max(Number(page) || 0, 0),
    total - 1
  );

  const ref = await unifiedOrderRef(ctx.from.id, safePage);
  const item = await loadUnifiedOrder(ctx.from.id, ref);

  if (!item) {
    return editError(
      ctx,
      "اطلاعات این سفارش پیدا نشد.",
      mainMenu()
    );
  }

  let text;
  if (item.kind === "social") {
    text = unifiedSocialOrderText(item.order);
  } else if (item.kind === "virtual") {
    text = unifiedVirtualOrderText(item.order);
  } else {
    text = unifiedCertificateOrderText(item.order);
  }

  const nav = [];
  if (safePage > 0) {
    nav.push(
      Markup.button.callback("⬅️ جدیدتر", `orders:p:${safePage - 1}`)
    );
  }

  nav.push(
    Markup.button.callback(`${safePage + 1} / ${total}`, "orders:noop")
  );

  if (safePage < total - 1) {
    nav.push(
      Markup.button.callback("قدیمی‌تر ➡️", `orders:p:${safePage + 1}`)
    );
  }

  const rows = [
    ...unifiedOrderActionRows(item),
    nav,
    [
      customEmojiCallback(
        "خانه",
        "menu:home",
        CUSTOM_EMOJI.back
      )
    ]
  ];

  const options = htmlText(
    text,
    Markup.inlineKeyboard(rows)
  );

  return edit && ctx.callbackQuery
    ? ctx.editMessageText(text, options)
    : ctx.reply(text, options);
}

async function replyMenuOrders(ctx) {
  await clearSession(ctx.from.id);
  return showUnifiedOrders(
    ctx,
    0,
    { edit: false }
  );
}

async function replyMenuDeposit(ctx) {
  await clearSession(ctx.from.id);

  const text =
    `${htmlMenuTitle("deposit", "افزایش موجودی")}\\n\\n` +
    "روش پرداخت را انتخاب کنید:";

  return ctx.reply(
    text,
    htmlText(
      text,
      Markup.inlineKeyboard([
        [
          customEmojiCallback(
            "Heleket",
            "deposit:heleket",
            CUSTOM_EMOJI.menu.deposit
          )
        ],
        [
          customEmojiCallback(
            "برگشت",
            "menu:home",
            CUSTOM_EMOJI.back
          )
        ]
      ])
    )
  );
}

async function replyMenuSupport(ctx) {
  await clearSession(ctx.from.id);

  const support =
    process.env.SUPPORT_USERNAME ||
    "@World_panel";

  const text =
    `${htmlMenuTitle("support", "پشتیبانی")}\\n\\n` +
    `یوزرنیم پشتیبانی: ${escapeHtml(support)}`;

  return ctx.reply(
    text,
    htmlText(
      text,
      Markup.inlineKeyboard([
        [
          Markup.button.url(
            "پیام به پشتیبانی",
            "https://t.me/World_panel"
          )
        ],
        ...mainMenu().reply_markup.inline_keyboard
      ])
    )
  );
}

const CERTIFICATE_PAGE_SIZE = 8;

function certificateApiErrorText(error) {
  const code = String(error?.code || "");

  const map = {
    invalid_json: "پاسخ سرویس Certificate نامعتبر بود.",
    missing_udid: "UDID ارسال نشده است.",
    missing_plan: "پلن Certificate مشخص نشده است.",
    invalid_udid: "فرمت UDID درست نیست. دوباره بررسی و ارسال کنید.",
    invalid_plan: "این پلن دیگر معتبر نیست. لیست پلن‌ها را دوباره باز کنید.",
    unauthorized: "اتصال Certificate در حال حاضر فعال نیست. با پشتیبانی تماس بگیرید.",
    insufficient_balance: "خرید Certificate موقتاً در دسترس نیست. با پشتیبانی تماس بگیرید.",
    plan_locked: "این پلن برای حساب فروشنده قفل است. پلن دیگری انتخاب کنید.",
    not_found: "Certificate پیدا نشد.",
    rate_limited: "درخواست‌ها زیاد شده است. کمی بعد دوباره امتحان کنید.",
    upstream_error: "سرور Certificate موقتاً در دسترس نیست. کمی بعد دوباره امتحان کنید.",
    timeout: "پاسخ سرویس Certificate دیر رسید. کمی بعد دوباره امتحان کنید.",
    network_error: "اتصال به سرویس Certificate ممکن نشد.",
    config_error: "تنظیمات Certificate کامل نیست. با پشتیبانی تماس بگیرید."
  };

  return map[code] || "عملیات Certificate انجام نشد. کمی بعد دوباره امتحان کنید.";
}

function safeCertificateFilePart(value) {
  return String(value || "certificate")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .slice(0, 48) || "certificate";
}

function certificateListFromResponse(data) {
  if (Array.isArray(data?.certificates)) {
    return data.certificates.filter(Boolean);
  }

  if (data?.certificate && typeof data.certificate === "object") {
    return [data.certificate];
  }

  if (
    data &&
    typeof data === "object" &&
    (data.id || data.certificate_id) &&
    (data.p12 || data.mobileprovision || data.status)
  ) {
    return [data];
  }

  return [];
}

function activeCertificateFromResponse(data) {
  return certificateListFromResponse(data).find((item) => {
    const status = String(item?.status || "").toLowerCase();
    const provisionValid = item?.provision_valid !== false;
    const expired = item?.expired === true;
    return provisionValid && !expired && (!status || status === "signed" || status === "active");
  }) ?? null;
}

function certificateWarrantyText(seconds) {
  const value = Math.max(0, Number(seconds) || 0);
  const days = Math.floor(value / 86400);
  const hours = Math.floor((value % 86400) / 3600);

  if (days > 0) return `${days} روز و ${hours} ساعت`;
  if (hours > 0) return `${hours} ساعت`;
  return "کمتر از یک ساعت";
}

function decodeCertificateBase64(value) {
  if (!value || typeof value !== "string") return null;

  const clean = value
    .replace(/^data:[^;]+;base64,/i, "")
    .replace(/\s+/g, "");

  if (!clean) return null;

  try {
    const buffer = Buffer.from(clean, "base64");
    return buffer.length >= 16 ? buffer : null;
  } catch {
    return null;
  }
}

async function sendCertificateFiles(ctx, certificate, certificateId = null) {
  const id = safeCertificateFilePart(
    certificateId || certificate?.id || "certificate"
  );

  const files = [
    ["p12", `${id}.p12`, "P12 Certificate"],
    ["mobileprovision", `${id}.mobileprovision`, "MobileProvision"],
    ["devp12", `${id}-dev.p12`, "Developer P12"],
    ["devmp", `${id}-dev.mobileprovision`, "Developer MobileProvision"]
  ];

  let sent = 0;

  for (const [field, filename, caption] of files) {
    const buffer = decodeCertificateBase64(certificate?.[field]);
    if (!buffer) continue;

    await ctx.replyWithDocument(
      {
        source: buffer,
        filename
      },
      { caption }
    );
    sent += 1;
  }

  if (!sent) {
    await ctx.reply(
      "Certificate ثبت شده است، اما API در این پاسخ فایل قابل دانلود برنگرداند. کمی بعد دوباره از بخش Certificate تلاش کنید."
    );
  }
}

function certificateInfoText({
  certificate,
  certificateId,
  charge = 0,
  alreadyRegistered = false
}) {
  const id = String(
    certificateId || certificate?.id || "-"
  );
  const status = String(certificate?.status || "unknown");
  const password = String(certificate?.p12_password ?? "-");
  const warranty = certificateWarrantyText(
    certificate?.warranty_remaining_seconds
  );

  return (
    `✅ Certificate آماده شد.\n\n` +
    `🆔 Certificate ID: ${escapeHtml(id)}\n` +
    `📌 وضعیت: ${escapeHtml(status)}\n` +
    `💵 مبلغ: $${Number(charge).toFixed(2)}\n` +
    `🛡 گارانتی باقی‌مانده: ${escapeHtml(warranty)}\n` +
    `🔐 پسورد P12: ${escapeHtml(password)}` +
    (alreadyRegistered
      ? "\n\nاین Certificate از قبل برای حساب شما ثبت شده بود و دوباره هزینه‌ای دریافت نشد."
      : "")
  );
}

async function getUserBalance(telegramId) {
  const result = await query(
    `SELECT balance FROM users WHERE telegram_id = $1`,
    [telegramId]
  );

  return Number(result.rows[0]?.balance ?? 0);
}

function certificateTitle(label = "Certificate") {
  return `${tgEmoji(CUSTOM_EMOJI.menu.certificate, "📜")} ${escapeHtml(label)}`;
}

async function showCertificateDevices(ctx, { edit = true } = {}) {
  const balance = await getUserBalance(ctx.from.id);

  const text =
    `${certificateTitle("Certificate آیفون / آیپد")}\n\n` +
    `موجودی کیف پول شما: $${balance.toFixed(2)}\n` +
    "نوع دستگاه را انتخاب کنید:";

  const options = htmlText(
    text,
    Markup.inlineKeyboard([
      [
        customEmojiCallback(
          "iPhone",
          "cert:device:iphone",
          CUSTOM_EMOJI.menu.iphone
        ),
        customEmojiCallback(
          "iPad",
          "cert:device:ipad",
          CUSTOM_EMOJI.menu.ipad
        )
      ],
      [
        customEmojiCallback(
          "برگشت",
          "menu:home",
          CUSTOM_EMOJI.back
        )
      ]
    ])
  );

  return edit && ctx.callbackQuery
    ? ctx.editMessageText(text, options)
    : ctx.reply(text, options);
}


function certificateCustomerPlan(plan, device = "iphone") {
  const rawName = String(plan?.plan_name || "");
  const name = rawName
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  // These provider plans are not products we sell.
  if (
    /dev\s*[|/\\]?\s*dis/i.test(rawName) ||
    name.includes("developer") ||
    name.includes("distribution")
  ) {
    return null;
  }

  const safeDevice =
    String(device).toLowerCase() === "ipad" ? "ipad" : "iphone";

  let warrantyLabel = null;

  if (safeDevice === "iphone") {
    if (
      /\binfinity\b/i.test(rawName) ||
      name.includes("full warranty")
    ) {
      warrantyLabel = "full warranty";
    } else if (/\b10\s*m\b/i.test(rawName)) {
      warrantyLabel = "10 months warranty";
    } else if (/\b(?:5|6)\s*m\b/i.test(rawName)) {
      // Nekoo currently calls this iOS 6M; our sold package is 5 months warranty.
      warrantyLabel = "5 months warranty";
    } else if (/\b3\s*m\b/i.test(rawName)) {
      warrantyLabel = "3 months warranty";
    } else if (/\b2\s*m\b/i.test(rawName)) {
      warrantyLabel = "2 months warranty";
    } else if (/\b1\s*m\b/i.test(rawName)) {
      warrantyLabel = "1 month warranty";
    }
  } else {
    if (/\b10\s*m\b/i.test(rawName)) {
      warrantyLabel = "10 months warranty";
    } else if (/\b1\s*m\b/i.test(rawName)) {
      warrantyLabel = "1 month warranty";
    }
  }

  // Unknown/provider-only plans stay hidden instead of being sold by accident.
  if (!warrantyLabel) {
    return null;
  }

  const sellingPrice = certificateSellingPrice(
    plan.cost,
    plan.plan_name,
    safeDevice
  );

  const priceText = Number(sellingPrice)
    .toFixed(2)
    .replace(/\.00$/, "")
    .replace(/(\.\d)0$/, "$1");

  return {
    id: plan.id,
    plan_name: plan.plan_name,
    display_name:
      `1 year ${priceText}$ with ${warrantyLabel}`,
    cost: Number(plan.cost),
    selling_price: Number(sellingPrice)
  };
}

async function showCertificatePlans(ctx, device = "iphone", page = 0, { edit = true } = {}) {
  try {
    const safeDevice = String(device).toLowerCase() === "ipad" ? "ipad" : "iphone";
    const deviceLabel = safeDevice === "ipad" ? "iPad" : "iPhone";
    const plans = await getCertificatePlans(safeDevice);

    if (!plans.length) {
      const text =
        `${certificateTitle(`Certificate ${deviceLabel}`)}\n\nفعلاً هیچ پلن فعالی از API دریافت نشد.`;

      const options = Markup.inlineKeyboard([
        [customEmojiCallback("برگشت", "menu:home", CUSTOM_EMOJI.back)]
      ]);

      return edit && ctx.callbackQuery
        ? ctx.editMessageText(text, options)
        : ctx.reply(text, options);
    }

    const normalizedPlans = plans
      .map((plan) => certificateCustomerPlan(plan, safeDevice))
      .filter(Boolean);

    if (!normalizedPlans.length) {
      const text =
        `${certificateTitle(`Certificate ${deviceLabel}`)}\n\n` +
        "فعلاً هیچ‌کدام از پکیج‌های قابل فروش ما در API فعال نیست.";

      const options = Markup.inlineKeyboard([
        [customEmojiCallback("برگشت", "menu:home", CUSTOM_EMOJI.back)]
      ]);

      return edit && ctx.callbackQuery
        ? ctx.editMessageText(text, options)
        : ctx.reply(text, options);
    }

    await setSession(
      ctx.from.id,
      "certificate_plans",
      {
        device: safeDevice,
        plans: normalizedPlans
      }
    );

    const totalPages = Math.max(
      1,
      Math.ceil(normalizedPlans.length / CERTIFICATE_PAGE_SIZE)
    );
    const safePage = Math.min(
      Math.max(Number(page) || 0, 0),
      totalPages - 1
    );
    const start = safePage * CERTIFICATE_PAGE_SIZE;
    const pagePlans = normalizedPlans.slice(
      start,
      start + CERTIFICATE_PAGE_SIZE
    );

    const rows = pagePlans.map((plan, offset) => [
      Markup.button.callback(
        shortName(plan.display_name, 52),
        `cert:plan:${start + offset}:${safePage}`
      )
    ]);

    if (totalPages > 1) {
      const nav = [];
      if (safePage > 0) {
        nav.push(
          Markup.button.callback(
            "⬅️ قبلی",
            `cert:plans:${safeDevice}:${safePage - 1}`
          )
        );
      }
      if (safePage < totalPages - 1) {
        nav.push(
          Markup.button.callback(
            "بعدی ➡️",
            `cert:plans:${safeDevice}:${safePage + 1}`
          )
        );
      }
      rows.push(nav);
    }

    rows.push([
      customEmojiCallback(
        "برگشت",
        "menu:home",
        CUSTOM_EMOJI.back
      )
    ]);

    const balance = await getUserBalance(ctx.from.id);
    const text =
      `${certificateTitle(`Certificate ${deviceLabel}`)}\n\n` +
      `موجودی کیف پول شما: $${balance.toFixed(2)}\n` +
      "یکی از پلن‌های زیر را انتخاب کنید:" +
      (totalPages > 1
        ? `\nصفحه ${safePage + 1} از ${totalPages}`
        : "");

    const options = htmlText(
      text,
      Markup.inlineKeyboard(rows)
    );

    return edit && ctx.callbackQuery
      ? ctx.editMessageText(text, options)
      : ctx.reply(text, options);
  } catch (error) {
    console.error(
      "Certificate plans error:",
      error?.code || "error",
      error?.message || error
    );

    const message = certificateApiErrorText(error);
    return edit && ctx.callbackQuery
      ? editError(ctx, message, mainMenu())
      : replyError(ctx, message, mainMenu());
  }
}

async function renderCertificateConfirm(ctx, data, { edit = true } = {}) {
  const balance = await getUserBalance(ctx.from.id);
  const price = Number(data.selling_price || 0);
  const shortfall = Math.max(0, Number((price - balance).toFixed(2)));

  const text =
    `📜 تأیید خرید Certificate\n\n` +
    `پلن: ${escapeHtml(data.display_name || data.plan_name)}\n` +
    `UDID: <code>${escapeHtml(data.udid)}</code>\n` +
    `قیمت: $${price.toFixed(2)}\n` +
    `موجودی شما: $${balance.toFixed(2)}` +
    (shortfall > 0
      ? `\n\n❌ موجودی کافی نیست. $${shortfall.toFixed(2)} کم دارید.`
      : "\n\nخرید را تأیید می‌کنید؟");

  const rows = [];

  if (shortfall <= 0) {
    rows.push([
      Markup.button.callback(
        "✅ تأیید خرید",
        "cert:confirm"
      )
    ]);
  } else {
    rows.push([
      customEmojiCallback(
        "افزایش موجودی با کریپتو و تتر",
        "cert:heleket_topup",
        CUSTOM_EMOJI.menu.deposit
      )
    ]);
  }

  rows.push([
    Markup.button.callback("انتخاب پلن / دستگاه دیگر", "menu:certificate")
  ]);
  rows.push([
    customEmojiCallback("لغو", "menu:home", CUSTOM_EMOJI.back)
  ]);

  const options = htmlText(
    text,
    Markup.inlineKeyboard(rows)
  );

  return edit && ctx.callbackQuery
    ? ctx.editMessageText(text, options)
    : ctx.reply(text, options);
}

async function renderCertificateBalancePrecheck(
  ctx,
  data,
  { edit = true } = {}
) {
  const balance = await getUserBalance(ctx.from.id);
  const price = Number(data?.selling_price || 0);
  const shortfall = Math.max(
    0,
    Number((price - balance).toFixed(2))
  );

  if (shortfall <= 0) {
    const selectedDevice =
      data?.device === "ipad" ? "ipad" : "iphone";
    const selectedDeviceLabel =
      selectedDevice === "ipad" ? "iPad" : "iPhone";

    await setSession(
      ctx.from.id,
      "certificate_udid",
      {
        device: selectedDevice,
        selected_plan: data.selected_plan
      }
    );

    const text =
      `${certificateTitle(data.display_name || data.selected_plan?.plan_name || "Certificate")}\n\n` +
      `قیمت نهایی: $${price.toFixed(2)}\n` +
      `موجودی شما: $${balance.toFixed(2)}\n\n` +
      `UDID ${selectedDeviceLabel} را ارسال کنید.\n\n` +
      "برای لغو: /cancel";

    const options = htmlText(text);

    return edit && ctx.callbackQuery
      ? ctx.editMessageText(text, options)
      : ctx.reply(text, options);
  }

  const text =
    `${certificateTitle(data.display_name || data.selected_plan?.plan_name || "Certificate")}\n\n` +
    `قیمت پکیج: $${price.toFixed(2)}\n` +
    `موجودی شما: $${balance.toFixed(2)}\n` +
    `کسری موجودی: $${shortfall.toFixed(2)}\n\n` +
    "برای ادامه ابتدا موجودی کیف پول را افزایش دهید.";

  const options = htmlText(
    text,
    Markup.inlineKeyboard([
      [
        customEmojiCallback(
          "افزایش موجودی با کریپتو و تتر",
          "cert:heleket_topup",
          CUSTOM_EMOJI.menu.deposit
        )
      ],
      [
        Markup.button.callback(
          "انتخاب پلن / دستگاه دیگر",
          "menu:certificate"
        )
      ],
      [
        customEmojiCallback(
          "لغو",
          "menu:home",
          CUSTOM_EMOJI.back
        )
      ]
    ])
  );

  return edit && ctx.callbackQuery
    ? ctx.editMessageText(text, options)
    : ctx.reply(text, options);
}

async function handleCertificateUdid(ctx, text, session) {
  const udid = String(text || "").trim();

  if (!/^[A-Za-z0-9-]{20,64}$/.test(udid)) {
    return replyError(
      ctx,
      "فرمت UDID درست نیست. UDID کامل دستگاه را دوباره ارسال کنید."
    );
  }

  const plan = session.data?.selected_plan;
  if (!plan?.id) {
    await clearSession(ctx.from.id);
    return replyError(
      ctx,
      "پلن انتخاب‌شده پیدا نشد. دوباره از بخش Certificate وارد شوید.",
      mainMenu()
    );
  }

  // Privacy rule: only allow free re-download when this Telegram user
  // previously purchased the same UDID through this bot.
  const owned = await query(
    `SELECT id, certificate_id, udid
     FROM certificate_orders
     WHERE telegram_id = $1
       AND UPPER(udid) = UPPER($2)
       AND certificate_id IS NOT NULL
     ORDER BY id DESC
     LIMIT 1`,
    [ctx.from.id, udid]
  );

  if (owned.rowCount) {
    try {
      const lookup = await getCertificate({ udid });
      const certificate = activeCertificateFromResponse(lookup);

      if (certificate) {
        await clearSession(ctx.from.id);

        const info = certificateInfoText({
          certificate,
          certificateId: certificate.id || owned.rows[0].certificate_id,
          charge: 0,
          alreadyRegistered: true
        });

        await ctx.reply(info, { parse_mode: "HTML" });
        await sendCertificateFiles(
          ctx,
          certificate,
          certificate.id || owned.rows[0].certificate_id
        );
        return;
      }
    } catch (error) {
      if (!(error instanceof CertificateApiError) || error.code !== "not_found") {
        console.error(
          "Certificate owned lookup error:",
          error?.code || "error",
          error?.message || error
        );
      }
    }
  }

  const balance = await getUserBalance(ctx.from.id);
  const sellingPrice = Number(plan.selling_price || 0);

  const data = {
    device: session.data?.device === "ipad" ? "ipad" : "iphone",
    udid,
    plan_id: plan.id,
    plan_name: plan.plan_name,
    display_name: plan.display_name || plan.plan_name,
    api_cost: Number(plan.cost || 0),
    selling_price: sellingPrice
  };

  await setSession(
    ctx.from.id,
    "certificate_confirm",
    data
  );

  if (balance + 1e-9 < sellingPrice) {
    return renderCertificateConfirm(ctx, data, { edit: false });
  }

  return renderCertificateConfirm(ctx, data, { edit: false });
}

async function saveCertificateOrder(client, {
  telegramId,
  certificateId,
  udid,
  planId,
  planName,
  apiCost,
  charge,
  alreadyRegistered,
  certificate
}) {
  let registeredAt = null;
  if (certificate?.registered_at) {
    const parsedRegisteredAt = new Date(certificate.registered_at);
    if (!Number.isNaN(parsedRegisteredAt.getTime())) {
      registeredAt = parsedRegisteredAt;
    }
  }

  return client.query(
    `INSERT INTO certificate_orders (
       telegram_id,
       provider,
       certificate_id,
       udid,
       plan_id,
       plan_name,
       api_cost,
       charge,
       status,
       already_registered,
       provision_valid,
       expired,
       pname,
       registered_at,
       warranty_remaining_seconds
     )
     VALUES (
       $1,'nekoo',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14
     )
     RETURNING id`,
    [
      telegramId,
      certificateId,
      udid,
      planId,
      planName,
      Number(apiCost || 0),
      Number(charge || 0),
      String(certificate?.status || "signed"),
      Boolean(alreadyRegistered),
      certificate?.provision_valid ?? null,
      certificate?.expired ?? null,
      certificate?.pname ?? null,
      registeredAt,
      Number(certificate?.warranty_remaining_seconds || 0)
    ]
  );
}

async function showMyCertificates(ctx) {
  const result = await query(
    `SELECT DISTINCT ON (certificate_id)
       id,
       certificate_id,
       udid,
       plan_name,
       status,
       charge,
       created_at
     FROM certificate_orders
     WHERE telegram_id = $1
       AND certificate_id IS NOT NULL
     ORDER BY certificate_id, created_at DESC
     LIMIT 10`,
    [ctx.from.id]
  );

  if (!result.rowCount) {
    const text =
      "📜 Certificateهای من\n\nهنوز Certificate ثبت‌شده‌ای در حساب شما نیست.";

    return ctx.editMessageText(
      text,
      Markup.inlineKeyboard([
        [Markup.button.callback("خرید Certificate", "menu:certificate")],
        [customEmojiCallback("برگشت", "menu:home", CUSTOM_EMOJI.back)]
      ])
    );
  }

  const rows = result.rows.map((row) => [
    Markup.button.callback(
      `${shortName(row.plan_name || "Certificate", 22)} | ${String(row.certificate_id).slice(0, 12)}`,
      `cert:download:${row.id}`
    )
  ]);

  rows.push([Markup.button.callback("خرید Certificate جدید", "menu:certificate")]);
  rows.push([customEmojiCallback("برگشت", "menu:home", CUSTOM_EMOJI.back)]);

  const text =
    "📜 Certificateهای من\n\nبرای دریافت دوباره فایل‌ها، یکی را انتخاب کنید:";

  return ctx.editMessageText(
    text,
    Markup.inlineKeyboard(rows)
  );
}

bot.action("menu:certificate", async (ctx) => {
  await answerCb(ctx);
  await clearSession(ctx.from.id);
  await showCertificateDevices(ctx, { edit: true });
});

bot.action(/^cert:device:(iphone|ipad)$/, async (ctx) => {
  await answerCb(ctx);
  await showCertificatePlans(
    ctx,
    ctx.match[1],
    0,
    { edit: true }
  );
});

bot.action(/^cert:plans:(iphone|ipad):(\d+)$/, async (ctx) => {
  await answerCb(ctx);
  await showCertificatePlans(
    ctx,
    ctx.match[1],
    Number(ctx.match[2]),
    { edit: true }
  );
});

bot.action(/^cert:plan:(\d+):(\d+)$/, async (ctx) => {
  await answerCb(ctx);

  const session = await getSession(ctx.from.id);
  const plans = Array.isArray(session.data?.plans)
    ? session.data.plans
    : [];
  const index = Number(ctx.match[1]);
  const plan = plans[index];

  if (session.state !== "certificate_plans" || !plan) {
    return editError(
      ctx,
      "لیست پلن‌ها منقضی شده است. دوباره Certificate را باز کنید.",
      mainMenu()
    );
  }

  const device =
    session.data?.device === "ipad" ? "ipad" : "iphone";

  const data = {
    device,
    selected_plan: plan,
    plan_id: plan.id,
    plan_name: plan.plan_name,
    display_name: plan.display_name || plan.plan_name,
    api_cost: Number(plan.cost || 0),
    selling_price: Number(plan.selling_price || 0)
  };

  const balance = await getUserBalance(ctx.from.id);

  if (balance + 1e-9 < data.selling_price) {
    await setSession(
      ctx.from.id,
      "certificate_precheck",
      data
    );

    return renderCertificateBalancePrecheck(
      ctx,
      data,
      { edit: true }
    );
  }

  await setSession(
    ctx.from.id,
    "certificate_udid",
    {
      device,
      selected_plan: plan
    }
  );

  const selectedDeviceLabel =
    device === "ipad" ? "iPad" : "iPhone";

  const text =
    `${certificateTitle(plan.display_name || plan.plan_name)}\n\n` +
    `قیمت نهایی: $${Number(plan.selling_price).toFixed(2)}\n` +
    `موجودی شما: $${balance.toFixed(2)}\n\n` +
    `UDID ${selectedDeviceLabel} را ارسال کنید.\n\n` +
    "برای لغو: /cancel";

  await ctx.editMessageText(
    text,
    htmlText(text)
  );
});

bot.action("cert:my", async (ctx) => {
  await answerCb(ctx);
  await clearSession(ctx.from.id);
  await showMyCertificates(ctx);
});

bot.action(/^cert:download:(\d+)$/, async (ctx) => {
  await answerCb(ctx, "در حال دریافت Certificate...");

  const result = await query(
    `SELECT id, certificate_id, udid, plan_name
     FROM certificate_orders
     WHERE id = $1 AND telegram_id = $2`,
    [Number(ctx.match[1]), ctx.from.id]
  );

  if (!result.rowCount) {
    return editError(ctx, "Certificate پیدا نشد.", mainMenu());
  }

  const row = result.rows[0];

  try {
    const response = await getCertificate({
      certificateId: row.certificate_id
    });
    const certificate =
      activeCertificateFromResponse(response) ||
      certificateListFromResponse(response)[0];

    if (!certificate) {
      return editError(
        ctx,
        "API اطلاعات Certificate را برنگرداند.",
        mainMenu()
      );
    }

    const text = certificateInfoText({
      certificate,
      certificateId: row.certificate_id,
      charge: 0,
      alreadyRegistered: true
    });

    await ctx.editMessageText(
      text,
      htmlText(
        text,
        Markup.inlineKeyboard([
          [customEmojiCallback("خانه", "menu:home", CUSTOM_EMOJI.back)]
        ])
      )
    );

    await sendCertificateFiles(
      ctx,
      certificate,
      row.certificate_id
    );
  } catch (error) {
    console.error(
      "Certificate re-download error:",
      error?.code || "error",
      error?.message || error
    );
    await editError(
      ctx,
      certificateApiErrorText(error),
      mainMenu()
    );
  }
});

bot.action("cert:resume", async (ctx) => {
  await answerCb(ctx);
  const session = await getSession(ctx.from.id);

  if (session.state === "certificate_precheck") {
    return renderCertificateBalancePrecheck(
      ctx,
      session.data,
      { edit: true }
    );
  }

  if (session.state !== "certificate_confirm") {
    return editError(
      ctx,
      "اطلاعات خرید Certificate پیدا نشد. دوباره پلن را انتخاب کنید.",
      mainMenu()
    );
  }

  await renderCertificateConfirm(
    ctx,
    session.data,
    { edit: true }
  );
});

bot.action("cert:heleket_topup", async (ctx) => {
  await answerCb(ctx);

  if (!publicBaseUrl()) {
    return editError(
      ctx,
      "دامنه عمومی Railway هنوز ساخته نشده است.",
      mainMenu()
    );
  }

  const session = await getSession(ctx.from.id);
  if (
    session.state !== "certificate_confirm" &&
    session.state !== "certificate_precheck"
  ) {
    return editError(
      ctx,
      "اطلاعات خرید Certificate پیدا نشد.",
      mainMenu()
    );
  }

  const balance = await getUserBalance(ctx.from.id);
  const price = Number(session.data?.selling_price || 0);
  const shortfall = Math.max(0, Number((price - balance).toFixed(2)));

  if (shortfall <= 0) {
    if (session.state === "certificate_precheck") {
      return renderCertificateBalancePrecheck(
        ctx,
        session.data,
        { edit: true }
      );
    }

    return renderCertificateConfirm(
      ctx,
      session.data,
      { edit: true }
    );
  }

  const amount = Math.max(1, shortfall);
  const orderId = `dep_${ctx.from.id}_${Date.now()}`;

  try {
    await query(
      `INSERT INTO deposits (
         telegram_id,
         provider,
         external_order_id,
         amount_usd,
         status
       )
       VALUES ($1,'heleket',$2,$3,'creating')`,
      [ctx.from.id, orderId, amount]
    );

    const invoice = await createHeleketInvoice({
      amount,
      orderId,
      telegramId: ctx.from.id
    });

    await query(
      `UPDATE deposits
       SET invoice_uuid = $1,
           status = $2,
           provider_payload = $3::jsonb,
           updated_at = NOW()
       WHERE external_order_id = $4`,
      [
        String(invoice.uuid ?? ""),
        String(invoice.status ?? invoice.payment_status ?? "check"),
        JSON.stringify(invoice),
        orderId
      ]
    );

    const text =
      `💳 شارژ کیف پول برای Certificate\n\n` +
      `مبلغ کمبود: $${shortfall.toFixed(2)}\n` +
      `فاکتور Heleket: $${amount.toFixed(2)}\n\n` +
      "پس از تأیید پرداخت، روی «بازگشت به خرید» بزنید.";

    return ctx.editMessageText(
      text,
      Markup.inlineKeyboard([
        [Markup.button.url("پرداخت با Heleket", invoice.url)],
        [Markup.button.callback("بازگشت به خرید", "cert:resume")],
        [customEmojiCallback("خانه", "menu:home", CUSTOM_EMOJI.back)]
      ])
    );
  } catch (error) {
    console.error(
      "Certificate Heleket topup error:",
      error?.message || error
    );

    await query(
      `UPDATE deposits
       SET status = 'failed',
           provider_payload = $1::jsonb,
           updated_at = NOW()
       WHERE external_order_id = $2`,
      [
        JSON.stringify({ error: String(error?.message || error) }),
        orderId
      ]
    ).catch(() => {});

    return editError(
      ctx,
      "ساخت فاکتور Heleket ممکن نشد.",
      mainMenu()
    );
  }
});

bot.action("cert:confirm", async (ctx) => {
  await answerCb(ctx, "در حال ثبت Certificate...");

  const session = await getSession(ctx.from.id);
  if (session.state !== "certificate_confirm") {
    return editError(
      ctx,
      "این خرید منقضی شده است. دوباره پلن را انتخاب کنید.",
      mainMenu()
    );
  }

  const data = session.data;

  try {
    // Refresh plans right before registration because Nekoo explicitly says
    // plan IDs may change and should not be hardcoded.
    const device = data.device === "ipad" ? "ipad" : "iphone";
    const currentPlans = await getCertificatePlans(device);
    const currentPlan = currentPlans.find(
      (plan) => String(plan.id) === String(data.plan_id)
    );

    if (!currentPlan) {
      await clearSession(ctx.from.id);
      return editError(
        ctx,
        "این پلن دیگر در API فعال نیست. دوباره از لیست پلن‌ها انتخاب کنید.",
        mainMenu()
      );
    }

    const publicCurrentPlan = certificateCustomerPlan(
      currentPlan,
      device
    );

    if (!publicCurrentPlan) {
      await clearSession(ctx.from.id);
      return ctx.editMessageText(
        "این پکیج دیگر در لیست محصولات قابل فروش نیست. دوباره Certificate را باز کنید.",
        mainMenu()
      );
    }

    const sellingPrice = publicCurrentPlan.selling_price;
    data.display_name = publicCurrentPlan.display_name;
    const profile = await getCertificateProfile();

    if (profile?.api_enabled === false) {
      return editError(
        ctx,
        "خرید Certificate موقتاً در دسترس نیست. با پشتیبانی تماس بگیرید.",
        mainMenu()
      );
    }

    if (Number(profile?.balance ?? 0) + 1e-9 < Number(currentPlan.cost)) {
      return editError(
        ctx,
        "خرید Certificate موقتاً در دسترس نیست. با پشتیبانی تماس بگیرید.",
        mainMenu()
      );
    }

    const client = await pool.connect();
    let response;
    let certificate;
    let charge = sellingPrice;
    let alreadyRegistered = false;

    try {
      await client.query("BEGIN");

      const userResult = await client.query(
        `SELECT balance
         FROM users
         WHERE telegram_id = $1
         FOR UPDATE`,
        [ctx.from.id]
      );

      const balance = Number(userResult.rows[0]?.balance ?? 0);
      if (balance + 1e-9 < sellingPrice) {
        await client.query("ROLLBACK");
        await setSession(
          ctx.from.id,
          "certificate_confirm",
          {
            ...data,
            api_cost: Number(currentPlan.cost),
            selling_price: sellingPrice
          }
        );
        return renderCertificateConfirm(
          ctx,
          {
            ...data,
            api_cost: Number(currentPlan.cost),
            selling_price: sellingPrice
          },
          { edit: true }
        );
      }

      response = await registerCertificate({
        udid: data.udid,
        plan: currentPlan.id
      });

      certificate =
        response?.certificate ||
        certificateListFromResponse(response)[0] ||
        null;

      if (!certificate) {
        throw new CertificateApiError(
          "Certificate API did not return certificate data",
          { code: "invalid_response" }
        );
      }

      alreadyRegistered =
        response?.already_registered === true ||
        Number(response?.cost ?? NaN) === 0;

      if (alreadyRegistered) {
        // Never expose an already-existing certificate to a different bot user.
        const ownership = await client.query(
          `SELECT id
           FROM certificate_orders
           WHERE telegram_id = $1
             AND UPPER(udid) = UPPER($2)
           LIMIT 1`,
          [ctx.from.id, data.udid]
        );

        if (!ownership.rowCount) {
          await client.query("ROLLBACK");
          await clearSession(ctx.from.id);
          return ctx.editMessageText(
            "این UDID از قبل در سرویس Certificate ثبت شده است. برای حفظ امنیت فایل‌ها، بازیابی خودکار فقط برای خریدهای قبلی همین حساب تلگرام انجام می‌شود. لطفاً با پشتیبانی تماس بگیرید.",
            mainMenu()
          );
        }

        charge = 0;
      } else {
        await client.query(
          `UPDATE users
           SET balance = balance - $1
           WHERE telegram_id = $2`,
          [sellingPrice, ctx.from.id]
        );
      }

      const certificateId = String(
        response?.certificate_id || certificate?.id || ""
      );

      await saveCertificateOrder(client, {
        telegramId: ctx.from.id,
        certificateId,
        udid: data.udid,
        planId: currentPlan.id,
        planName: data.display_name || currentPlan.plan_name,
        apiCost: Number(response?.cost ?? currentPlan.cost ?? 0),
        charge,
        alreadyRegistered,
        certificate
      });

      await client.query("COMMIT");
      await clearSession(ctx.from.id);

      const successText = certificateInfoText({
        certificate,
        certificateId,
        charge,
        alreadyRegistered
      });

      await ctx.editMessageText(
        successText,
        htmlText(
          successText,
          Markup.inlineKeyboard([
            [Markup.button.callback("Certificateهای من", "cert:my")],
            [customEmojiCallback("خانه", "menu:home", CUSTOM_EMOJI.back)]
          ])
        )
      );

      await sendCertificateFiles(
        ctx,
        certificate,
        certificateId
      );
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {}
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error(
      "Certificate confirm error:",
      error?.code || "error",
      error?.message || error
    );

    return editError(
      ctx,
      certificateApiErrorText(error),
      mainMenu()
    );
  }
});

bot.on("text", async (ctx) => {
  const session = await getSession(
    ctx.from.id
  );

  const text = ctx.message.text.trim();

  if (text === "لیست محصولات") {
    return replyMenuPlatforms(
      ctx,
      "order"
    );
  }

  if (
    text === "📜 Certificate آیفون / آیپد" ||
    text === "Certificate آیفون / آیپد" ||
    text === "📜 Certificate آیفون" ||
    text === "Certificate آیفون"
  ) {
    await clearSession(ctx.from.id);
    return showCertificateDevices(
      ctx,
      { edit: false }
    );
  }

  if (text === "شماره مجازی") {
    await clearSession(ctx.from.id);

    return showVirtualNumberServices(
      ctx,
      0,
      { edit: false }
    );
  }

  if (text === "قیمت بسته‌ها") {
    return replyMenuPlatforms(
      ctx,
      "price"
    );
  }

  if (text === "کیف پول") {
    return replyMenuBalance(ctx);
  }

  if (text === "سفارش‌های من") {
    return replyMenuOrders(ctx);
  }

  if (text === "افزایش موجودی") {
    return replyMenuDeposit(ctx);
  }

  if (text === "پشتیبانی") {
    return replyMenuSupport(ctx);
  }

  if (session.state === "certificate_udid") {
    return handleCertificateUdid(
      ctx,
      text,
      session
    );
  }

  if (session.state === "deposit_heleket_amount") {
    const amount = Number(
      text.replace(",", ".")
    );

    if (
      !Number.isFinite(amount) ||
      amount < 1 ||
      amount > 10000
    ) {
      return ctx.reply(
        "❌ مبلغ باید یک عدد بین 1 تا 10,000 دلار باشد."
      );
    }

    const orderId =
      `dep_${ctx.from.id}_${Date.now()}`;

    try {
      await query(
        `INSERT INTO deposits (
           telegram_id,
           provider,
           external_order_id,
           amount_usd,
           status
         )
         VALUES ($1,'heleket',$2,$3,'creating')`,
        [
          ctx.from.id,
          orderId,
          amount
        ]
      );

      const invoice =
        await createHeleketInvoice({
          amount,
          orderId,
          telegramId: ctx.from.id
        });

      await query(
        `UPDATE deposits
         SET invoice_uuid = $1,
             status = $2,
             provider_payload = $3::jsonb,
             updated_at = NOW()
         WHERE external_order_id = $4`,
        [
          String(invoice.uuid ?? ""),
          String(
            invoice.status ??
            invoice.payment_status ??
            "check"
          ),
          JSON.stringify(invoice),
          orderId
        ]
      );

      await clearSession(
        ctx.from.id
      );

      const invoiceText =
        `✅ فاکتور Heleket ساخته شد.\n\n` +
        `${tgEmoji(ORDER_RESULT_EMOJI.amount, "💵")} مبلغ: $${amount.toFixed(2)}\n` +
        "پس از تأیید پرداخت، موجودی شما خودکار افزایش می‌یابد.";

      return ctx.reply(
        invoiceText,
        htmlText(
          invoiceText,
          Markup.inlineKeyboard([
          [
            Markup.button.url(
              "💳 پرداخت با Heleket",
              invoice.url
            )
          ],
          [
            customEmojiCallback(
              "برگشت",
              "menu:home",
              CUSTOM_EMOJI.back
            )
          ]
        ])
        )
      );
    } catch (error) {
      console.error(
        "Heleket invoice create error:",
        error
      );

      await query(
        `UPDATE deposits
         SET status = 'failed',
             provider_payload = $1::jsonb,
             updated_at = NOW()
         WHERE external_order_id = $2`,
        [
          JSON.stringify({
            error: String(
              error.message || error
            )
          }),
          orderId
        ]
      ).catch(() => {});

      return ctx.reply(
        "❌ ساخت فاکتور Heleket ممکن نشد. کمی بعد دوباره امتحان کنید.",
        mainMenu()
      );
    }
  }

  if (session.state === "provider_quantity") {
    const quantity = Number(text);
    const min = Number(session.data.min);
    const max = Number(session.data.max);

    if (!Number.isInteger(quantity)) {
      return replyError(
        ctx,
        "تعداد باید یک عدد صحیح باشد."
      );
    }

    if (quantity < min) {
      return replyError(
        ctx,
        `حداقل سفارش این سرویس ${min.toLocaleString("en-US")} عدد است.`
      );
    }

    if (quantity > max) {
      return replyError(
        ctx,
        `حداکثر سفارش این سرویس ${max.toLocaleString("en-US")} عدد است.`
      );
    }

    const charge = calculateCharge(
      session.data.provider_code,
      quantity,
      Number(session.data.selling_rate)
    );

    const balanceResult = await query(
      `SELECT balance FROM users WHERE telegram_id = $1`,
      [ctx.from.id]
    );

    const balance = Number(
      balanceResult.rows[0]?.balance ?? 0
    );

    if (balance + 1e-9 < charge) {
      const shortfall = Number(
        (charge - balance).toFixed(2)
      );

      await setSession(
        ctx.from.id,
        "provider_quantity",
        {
          ...session.data,
          pending_quantity: quantity,
          pending_charge: charge,
          pending_shortfall: shortfall
        }
      );

      const insufficientText =
        `${tgEmoji(ORDER_RESULT_EMOJI.quantity, "📊")} تعداد: ${quantity.toLocaleString("en-US")}\n` +
        `${tgEmoji(ORDER_RESULT_EMOJI.amount, "💵")} قیمت نهایی: $${charge.toFixed(2)}\n` +
        `${tgEmoji(CUSTOM_EMOJI.menu.balance, "💰")} موجودی شما: $${balance.toFixed(2)}\n\n` +
        `${tgEmoji(ERROR_CUSTOM_EMOJI_ID, "❌")} موجودی حساب شما کافی نیست.\n` +
        `برای این سفارش $${charge.toFixed(2)} موجودی لازم دارید و $${shortfall.toFixed(2)} کم دارید.\n\n` +
        "از دکمه زیر حساب خود را با Heleket شارژ کنید:";

      return ctx.reply(
        insufficientText,
        htmlText(
          insufficientText,
          Markup.inlineKeyboard([
            [
              customEmojiCallback(
                "شارژ با Heleket",
                "provider:heleket_topup",
                CUSTOM_EMOJI.menu.deposit
              )
            ],
            [
              customEmojiCallback(
                "لغو",
                "menu:home",
                CUSTOM_EMOJI.back
              )
            ]
          ])
        )
      );
    }

    const {
      pending_quantity,
      pending_charge,
      pending_shortfall,
      ...cleanSessionData
    } = session.data;

    await setSession(
      ctx.from.id,
      "provider_link",
      {
        ...cleanSessionData,
        quantity,
        charge
      }
    );

    const quantityText =
      `${tgEmoji(ORDER_RESULT_EMOJI.quantity, "📊")} تعداد: ${quantity.toLocaleString("en-US")}\n` +
      `${tgEmoji(ORDER_RESULT_EMOJI.amount, "💵")} قیمت نهایی: $${charge.toFixed(2)}\n` +
      `${tgEmoji(CUSTOM_EMOJI.menu.balance, "💰")} موجودی شما: $${balance.toFixed(2)}\n\n` +
      `${tgEmoji(ORDER_RESULT_EMOJI.link, "🔗")} حالا لینک موردنظر را ارسال کنید.`;

    return ctx.reply(
      quantityText,
      htmlText(quantityText)
    );
  }

  if (session.state === "provider_link") {
    if (text.length < 5) {
      return replyError(
        ctx,
        "لینک معتبر نیست. دوباره ارسال کنید."
      );
    }

    const data = {
      ...session.data,
      link: text
    };

    await setSession(
      ctx.from.id,
      "provider_confirm",
      data
    );

    const confirmText =
      `${htmlOrderSummaryTitle()}\n\n` +
      `${tgEmoji(ORDER_RESULT_EMOJI.serviceBullet, "🔹")} سرویس: ${htmlServiceName(data.service_name)}\n` +
      `${tgEmoji(ORDER_RESULT_EMOJI.quantity, "📊")} تعداد: ${Number(data.quantity).toLocaleString("en-US")}\n` +
      `${tgEmoji(ORDER_RESULT_EMOJI.amount, "💵")} قیمت نهایی: $${Number(data.charge).toFixed(2)}\n` +
      `${tgEmoji(ORDER_RESULT_EMOJI.link, "🔗")} لینک: ${escapeHtml(data.link)}\n\n` +
      htmlOrderConfirmQuestion();

    return ctx.reply(
      confirmText,
      htmlText(
        confirmText,
        Markup.inlineKeyboard([
          [
            confirmOrderButton()
          ],
          [
            customEmojiCallback(
              "لغو",
              "order:cancel",
              ERROR_CUSTOM_EMOJI_ID
            )
          ]
        ])
      )
    );
  }

  if (session.state === "provider_custom_link") {
    if (text.length < 5) {
      return replyError(
        ctx,
        "لینک معتبر نیست. دوباره ارسال کنید."
      );
    }

    await setSession(
      ctx.from.id,
      "provider_custom_comments",
      {
        ...session.data,
        link: text
      }
    );

    return ctx.reply(
      "💬 حالا متن کامنت‌ها را ارسال کنید.\n\n" +
      "هر کامنت باید در یک خط جدا باشد."
    );
  }

  if (session.state === "provider_custom_comments") {
    const comments = text
      .split(/\r?\n/)
      .map((comment) => comment.trim())
      .filter(Boolean);

    const quantity = comments.length;
    const min = Number(session.data.min);
    const max = Number(session.data.max);

    if (quantity < min) {
      return ctx.reply(
        `❌ حداقل این سرویس ${min.toLocaleString("en-US")} کامنت است.\n` +
        `شما ${quantity.toLocaleString("en-US")} کامنت فرستادید.`
      );
    }

    if (quantity > max) {
      return ctx.reply(
        `❌ حداکثر این سرویس ${max.toLocaleString("en-US")} کامنت است.`
      );
    }

    const charge = calculateCharge(
      session.data.provider_code,
      quantity,
      Number(session.data.selling_rate)
    );

    const data = {
      ...session.data,
      quantity,
      comments: comments.join("\n"),
      charge
    };

    await setSession(
      ctx.from.id,
      "provider_confirm",
      data
    );

    const confirmText =
      `${htmlOrderSummaryTitle()}\n\n` +
      `${tgEmoji(ORDER_RESULT_EMOJI.serviceBullet, "🔹")} سرویس: ${htmlServiceName(data.service_name)}\n` +
      `${tgEmoji(ORDER_RESULT_EMOJI.quantity, "📊")} تعداد کامنت: ${quantity.toLocaleString("en-US")}\n` +
      `${tgEmoji(ORDER_RESULT_EMOJI.amount, "💵")} قیمت نهایی: $${charge.toFixed(2)}\n` +
      `${tgEmoji(ORDER_RESULT_EMOJI.link, "🔗")} لینک: ${escapeHtml(data.link)}\n\n` +
      htmlOrderConfirmQuestion();

    return ctx.reply(
      confirmText,
      htmlText(
        confirmText,
        Markup.inlineKeyboard([
          [
            confirmOrderButton()
          ],
          [
            customEmojiCallback(
              "لغو",
              "order:cancel",
              ERROR_CUSTOM_EMOJI_ID
            )
          ]
        ])
      )
    );
  }
});

bot.action("order:cancel", async (ctx) => {
  await answerCb(ctx);
  await clearSession(ctx.from.id);

  await editError(
    ctx,
    "سفارش لغو شد.",
    mainMenu()
  );
});

bot.action("provider:confirm", async (ctx) => {
  await answerCb(
    ctx,
    "در حال ثبت سفارش..."
  );

  const session = await getSession(
    ctx.from.id
  );

  if (session.state !== "provider_confirm") {
    return ctx.editMessageText(
      "❌ این سفارش منقضی شده است.",
      mainMenu()
    );
  }

  const data = session.data;
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const userResult = await client.query(
      `SELECT balance
       FROM users
       WHERE telegram_id = $1
       FOR UPDATE`,
      [ctx.from.id]
    );

    const balance = Number(
      userResult.rows[0]?.balance ?? 0
    );

    const charge = Number(data.charge);

    if (balance < charge) {
      await client.query("ROLLBACK");

      const insufficientText =
        `${tgEmoji(ERROR_CUSTOM_EMOJI_ID, "❌")} موجودی کافی نیست.\n\n` +
        `💵 موجودی شما: $${balance.toFixed(2)}\n` +
        `${tgEmoji(ORDER_RESULT_EMOJI.amount, "💵")} مبلغ سفارش: $${charge.toFixed(2)}`;

      return ctx.editMessageText(
        insufficientText,
        htmlText(insufficientText, mainMenu())
      );
    }

    const providerResult =
      await createProviderOrder(
        data.provider_code,
        {
          service: data.provider_service_id,
          link: data.link,
          quantity: data.quantity,
          comments: data.comments
        }
      );

    await client.query(
      `UPDATE users
       SET balance = balance - $1
       WHERE telegram_id = $2`,
      [charge, ctx.from.id]
    );

    const inserted =
      await client.query(
        `INSERT INTO orders (
           telegram_id,
           platform_id,
           category_id,
           link,
           quantity,
           charge,
           status,
           provider_order_id,
           provider_name,
           provider_service_id,
           service_name,
           provider_rate,
           selling_rate,
           refill_supported,
           cancel_supported
         )
         VALUES (
           $1,$2,$3,$4,$5,$6,'pending',$7,
           $8,$9,$10,$11,$12,$13,$14
         )
         RETURNING id`,
        [
          ctx.from.id,
          data.platform_id,
          data.category_id,
          data.link,
          data.quantity,
          charge,
          String(providerResult.order),
          data.provider_name,
          data.provider_service_id,
          data.service_name,
          data.provider_rate,
          data.selling_rate,
          Boolean(data.refill_supported),
          Boolean(data.cancel_supported)
        ]
      );

    await client.query("COMMIT");
    await clearSession(ctx.from.id);

    const successText =
      `${tgEmoji(ORDER_RESULT_EMOJI.success, "✅")} سفارش ثبت شد.\n\n` +
      `${tgEmoji(ORDER_RESULT_EMOJI.orderId, "🆔")} Order ID: <code>${escapeHtml(
        socialPublicOrderId(inserted.rows[0].id)
      )}</code>\n` +
      `${tgEmoji(ORDER_RESULT_EMOJI.quantity, "📊")} تعداد: ${Number(data.quantity).toLocaleString("en-US")}\n` +
      `${tgEmoji(ORDER_RESULT_EMOJI.amount, "💵")} مبلغ: $${charge.toFixed(2)}\n` +
      `${tgEmoji(ORDER_RESULT_EMOJI.status, "⏳")} وضعیت: Pending`;

    const orderControl = {
      id: inserted.rows[0].id,
      refill_supported: Boolean(data.refill_supported),
      cancel_supported: Boolean(data.cancel_supported),
      cancel_closed: false,
      cancel_requested_at: null,
      refill_id: null
    };

    await ctx.editMessageText(
      successText,
      htmlText(successText, orderControlKeyboard(orderControl))
    );
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {}

    console.error(
      "Provider confirm error:",
      error
    );

    await replyError(
      ctx,
      "ثبت سفارش در پنل انجام نشد. مبلغی از موجودی شما کم نشد.",
      mainMenu()
    );
  } finally {
    client.release();
  }
});

bot.action(/^order:refill:(\d+)$/, async (ctx) => {
  const orderId = Number(ctx.match[1]);
  const order = await loadUserOrder(ctx.from.id, orderId);
  if (!order) return answerCb(ctx, "سفارش پیدا نشد.");
  if (!order.refill_supported) return answerCb(ctx, "این سفارش جبران ریزش ندارد.");
  if (order.refill_id) return answerCb(ctx, "جبران ریزش این سفارش قبلاً ثبت شده است.");

  const elapsed = Date.now() - new Date(order.created_at).getTime();
  if (elapsed < REFILL_WAIT_MS) {
    const remainingHours = Math.ceil((REFILL_WAIT_MS - elapsed) / (60 * 60 * 1000));
    return answerCb(ctx, `برای ثبت جبران ریزش باید حداقل ۴۸ ساعت از ثبت سفارش گذشته باشد. حدود ${remainingHours} ساعت باقی مانده است.`);
  }

  await answerCb(ctx, "در حال ثبت جبران ریزش...");
  try {
    const providerCode = order.provider_name === "smmxserver" ? "smmx" : order.provider_name;
    const result = await requestProviderRefill(providerCode, order.provider_order_id);
    await query(
      `UPDATE orders SET refill_id = $1, refill_requested_at = NOW() WHERE id = $2 AND telegram_id = $3`,
      [String(result.refill), orderId, ctx.from.id]
    );
    await ctx.reply(`✅ درخواست جبران ریزش برای سفارش ${socialPublicOrderId(orderId)} ثبت شد.`);
    try {
      const fresh = await loadUserOrder(ctx.from.id, orderId);
      await ctx.editMessageReplyMarkup(orderControlKeyboard(fresh).reply_markup);
    } catch {}
  } catch (error) {
    console.error("Refill request error:", error);
    await replyError(
      ctx,
      `ثبت جبران ریزش انجام نشد.\n${String(error.message || "Provider rejected the request")}`
    );
  }
});

bot.action(/^order:cancel_api:(\d+)$/, async (ctx) => {
  const orderId = Number(ctx.match[1]);
  const order = await loadUserOrder(ctx.from.id, orderId);
  if (!order) return answerCb(ctx, "سفارش پیدا نشد.");
  if (!order.cancel_supported || order.cancel_closed) return answerCb(ctx, "امکان کنسل این سفارش دیگر فعال نیست.");
  if (order.cancel_requested_at) return answerCb(ctx, "درخواست کنسل قبلاً ثبت شده است.");

  await answerCb(ctx, "در حال ارسال درخواست کنسل...");
  try {
    const providerCode = order.provider_name === "smmxserver" ? "smmx" : order.provider_name;
    await requestProviderCancel(providerCode, order.provider_order_id);
    await query(
      `UPDATE orders SET cancel_requested_at = NOW(), status = 'cancel_requested' WHERE id = $1 AND telegram_id = $2`,
      [orderId, ctx.from.id]
    );
    await ctx.reply(`✅ درخواست کنسل سفارش ${socialPublicOrderId(orderId)} برای پنل ارسال شد.`);
    try {
      const fresh = await loadUserOrder(ctx.from.id, orderId);
      await ctx.editMessageReplyMarkup(orderControlKeyboard(fresh).reply_markup);
    } catch {}
  } catch (error) {
    console.error("Cancel request error:", error);
    await query(
      `UPDATE orders SET cancel_closed = TRUE WHERE id = $1 AND telegram_id = $2`,
      [orderId, ctx.from.id]
    );
    await ctx.reply("❌ پنل دیگر اجازه کنسل این سفارش را نمی‌دهد.");
    try {
      const fresh = await loadUserOrder(ctx.from.id, orderId);
      await ctx.editMessageReplyMarkup(orderControlKeyboard(fresh).reply_markup);
    } catch {}
  }
});

bot.action("menu:balance", async (ctx) => {
  await answerCb(ctx);
  await clearSession(ctx.from.id);

  const result = await query(
    `SELECT balance
     FROM users
     WHERE telegram_id = $1`,
    [ctx.from.id]
  );

  const balance = Number(
    result.rows[0]?.balance ?? 0
  );

  const text =
    `${htmlMenuTitle("balance", "کیف پول")}\n\n` +
    `موجودی شما: $${balance.toFixed(2)}\n\n` +
    `${htmlMenuTitle("deposit", "افزایش موجودی")}\n` +
    "از طریق دکمه زیر";

  await ctx.editMessageText(
    text,
    htmlText(
      text,
      Markup.inlineKeyboard([
        [
          customEmojiCallback(
            "Heleket [ارز دیجیتال]",
            "deposit:heleket",
            CUSTOM_EMOJI.menu.deposit
          )
        ],
        [
          customEmojiCallback(
            "برگشت",
            "menu:home",
            CUSTOM_EMOJI.back
          )
        ]
      ])
    )
  );
});

bot.action("menu:orders", async (ctx) => {
  await answerCb(ctx);
  await clearSession(ctx.from.id);
  return showUnifiedOrders(
    ctx,
    0,
    { edit: true }
  );
});

bot.action(/^orders:p:(\d+)$/, async (ctx) => {
  await answerCb(ctx);
  return showUnifiedOrders(
    ctx,
    Number(ctx.match[1]),
    { edit: true }
  );
});

bot.action("orders:noop", async (ctx) => {
  await answerCb(ctx);
});

bot.action("menu:deposit", async (ctx) => {
  await answerCb(ctx);

  const text =
    `${htmlMenuTitle("deposit", "افزایش موجودی")}\n\n` +
    "روش پرداخت را انتخاب کنید:";

  await ctx.editMessageText(
    text,
    htmlText(
      text,
      Markup.inlineKeyboard([
        [
          customEmojiCallback(
            "Heleket",
            "deposit:heleket",
            CUSTOM_EMOJI.menu.deposit
          )
        ],
        [
          customEmojiCallback(
            "برگشت",
            "menu:home",
            CUSTOM_EMOJI.back
          )
        ]
      ])
    )
  );
});

bot.action("provider:heleket_topup", async (ctx) => {
  await answerCb(ctx);

  if (!publicBaseUrl()) {
    return editError(
      ctx,
      "دامنه عمومی Railway هنوز ساخته نشده است.",
      mainMenu()
    );
  }

  const session = await getSession(ctx.from.id);
  const shortfall = Number(
    session.data?.pending_shortfall ?? 0
  );

  if (
    session.state !== "provider_quantity" ||
    !Number.isFinite(shortfall) ||
    shortfall <= 0
  ) {
    return editError(
      ctx,
      "اطلاعات شارژ این سفارش پیدا نشد. دوباره تعداد سفارش را وارد کنید.",
      mainMenu()
    );
  }

  // Heleket flow currently accepts deposits from $1.
  const amount = Math.max(
    1,
    Number(shortfall.toFixed(2))
  );

  const orderId =
    `dep_${ctx.from.id}_${Date.now()}`;

  try {
    await query(
      `INSERT INTO deposits (
         telegram_id,
         provider,
         external_order_id,
         amount_usd,
         status
       )
       VALUES ($1,'heleket',$2,$3,'creating')`,
      [
        ctx.from.id,
        orderId,
        amount
      ]
    );

    const invoice =
      await createHeleketInvoice({
        amount,
        orderId,
        telegramId: ctx.from.id
      });

    await query(
      `UPDATE deposits
       SET invoice_uuid = $1,
           status = $2,
           provider_payload = $3::jsonb,
           updated_at = NOW()
       WHERE external_order_id = $4`,
      [
        String(invoice.uuid ?? ""),
        String(
          invoice.status ??
          invoice.payment_status ??
          "check"
        ),
        JSON.stringify(invoice),
        orderId
      ]
    );

    const invoiceText =
      `${htmlMenuTitle("deposit", "شارژ حساب با Heleket")}\n\n` +
      `${tgEmoji(ORDER_RESULT_EMOJI.amount, "💵")} مبلغ شارژ: $${amount.toFixed(2)}\n` +
      `مبلغ کمبود سفارش: $${shortfall.toFixed(2)}\n\n` +
      "پس از تأیید پرداخت، موجودی شما خودکار افزایش می‌یابد. سپس همان تعداد سفارش را دوباره ارسال کنید.";

    return ctx.editMessageText(
      invoiceText,
      htmlText(
        invoiceText,
        Markup.inlineKeyboard([
          [
            Markup.button.url(
              "پرداخت با Heleket",
              invoice.url
            )
          ],
          [
            customEmojiCallback(
              "برگشت",
              "menu:home",
              CUSTOM_EMOJI.back
            )
          ]
        ])
      )
    );
  } catch (error) {
    console.error(
      "Provider Heleket topup error:",
      error
    );

    await query(
      `UPDATE deposits
       SET status = 'failed',
           provider_payload = $1::jsonb,
           updated_at = NOW()
       WHERE external_order_id = $2`,
      [
        JSON.stringify({
          error: String(
            error.message || error
          )
        }),
        orderId
      ]
    ).catch(() => {});

    return editError(
      ctx,
      "ساخت فاکتور Heleket ممکن نشد. کمی بعد دوباره امتحان کنید.",
      mainMenu()
    );
  }
});

bot.action("deposit:heleket", async (ctx) => {
  await answerCb(ctx);

  if (!publicBaseUrl()) {
    return ctx.editMessageText(
      "❌ دامنه عمومی Railway هنوز ساخته نشده است.\n\n" +
      "بعد از نصب این نسخه، در Railway برای پورت 8080 دامنه بسازید.",
      mainMenu()
    );
  }

  await setSession(
    ctx.from.id,
    "deposit_heleket_amount",
    {}
  );

  const text =
    `${htmlMenuTitle("deposit", "افزایش موجودی با Heleket")}\n\n` +
    "مبلغ را به دلار وارد کنید.\n" +
    "مثال: 10";

  await ctx.editMessageText(
    text,
    htmlText(
      text,
      Markup.inlineKeyboard([
        [
          customEmojiCallback(
            "برگشت",
            "menu:home",
            CUSTOM_EMOJI.back
          )
        ]
      ])
    )
  );
});

bot.action("menu:support", async (ctx) => {
  await answerCb(ctx);
  await clearSession(ctx.from.id);

  const support =
    process.env.SUPPORT_USERNAME ||
    "@World_panel";

  const text =
    `${htmlMenuTitle("support", "پشتیبانی")}\n\n` +
    `یوزرنیم پشتیبانی: ${escapeHtml(support)}`;

  await ctx.editMessageText(
    text,
    htmlText(
      text,
      Markup.inlineKeyboard([
        [
          Markup.button.url(
            "پیام به پشتیبانی",
            "https://t.me/World_panel"
          )
        ],
        ...mainMenu().reply_markup.inline_keyboard
      ])
    )
  );
});

bot.catch((error) => {
  console.error("BOT ERROR:", error);
});

await initDatabase();

console.log("Database initialized.");
console.log("Providers loaded.");
console.log("Starting Telegram bot...");

startHeleketServer(bot);

await bot.launch({
  dropPendingUpdates: false
});

startVirtualNumberWorker();

function stopApplication(signal) {
  if (virtualNumberWorkerTimer) {
    clearInterval(virtualNumberWorkerTimer);
    virtualNumberWorkerTimer = null;
  }

  bot.stop(signal);
}

process.once(
  "SIGINT",
  () => stopApplication("SIGINT")
);

process.once(
  "SIGTERM",
  () => stopApplication("SIGTERM")
);
