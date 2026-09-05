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

async function replyMenuOrders(ctx) {
  await clearSession(ctx.from.id);

  const result = await query(
    `SELECT
       id,
       quantity,
       charge,
       status,
       service_name,
       refill_supported,
       cancel_supported,
       cancel_closed,
       cancel_requested_at,
       refill_id,
       refill_requested_at
     FROM orders
     WHERE telegram_id = $1
     ORDER BY id DESC
     LIMIT 10`,
    [ctx.from.id]
  );

  if (!result.rowCount) {
    const text =
      `${htmlMenuTitle("orders", "سفارش‌های من")}\\n\\n` +
      "هنوز سفارشی ندارید.";

    return ctx.reply(
      text,
      htmlText(text, mainMenu())
    );
  }

  const listText = result.rows
    .map(
      (order) =>
        `#${order.id} | ${htmlServiceName(order.service_name ?? "Service")}\\n` +
        `${tgEmoji(ORDER_RESULT_EMOJI.quantity, "📊")} تعداد: ${Number(order.quantity).toLocaleString("en-US")} | ` +
        `${tgEmoji(ORDER_RESULT_EMOJI.amount, "💵")} $${Number(order.charge).toFixed(2)} | ${order.status}`
    )
    .join("\\n\\n");

  const text =
    `${htmlMenuTitle("orders", "سفارش‌های من")}\\n\\n${listText}`;

  const controlRows = [];

  for (const order of result.rows) {
    const buttons = [];

    if (
      order.refill_supported &&
      !order.refill_id
    ) {
      buttons.push(
        Markup.button.callback(
          `♻️ جبران #${order.id}`,
          `order:refill:${order.id}`
        )
      );
    }

    if (
      order.cancel_supported &&
      !order.cancel_closed &&
      !order.cancel_requested_at
    ) {
      buttons.push(
        customEmojiCallback(
          `کنسل #${order.id}`,
          `order:cancel_api:${order.id}`,
          "5348027250446967673"
        )
      );
    }

    if (buttons.length) {
      controlRows.push(buttons);
    }
  }

  controlRows.push(
    ...mainMenu().reply_markup.inline_keyboard
  );

  return ctx.reply(
    text,
    htmlText(
      text,
      Markup.inlineKeyboard(controlRows)
    )
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
      "Certificate ثبت شده است، اما API در این پاسخ فایل قابل دانلود برنگرداند. از بخش Certificateهای من دوباره دریافت کنید."
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

async function showCertificateDevices(ctx, { edit = true } = {}) {
  const balance = await getUserBalance(ctx.from.id);

  const text =
    `📜 Certificate آیفون / آیپد\n\n` +
    `موجودی کیف پول شما: $${balance.toFixed(2)}\n` +
    "نوع دستگاه را انتخاب کنید:";

  const options = Markup.inlineKeyboard([
    [
      Markup.button.callback(
        "📱 iPhone",
        "cert:device:iphone"
      ),
      Markup.button.callback(
        "📱 iPad",
        "cert:device:ipad"
      )
    ],
    [
      Markup.button.callback(
        "Certificateهای من",
        "cert:my"
      )
    ],
    [
      customEmojiCallback(
        "برگشت",
        "menu:home",
        CUSTOM_EMOJI.back
      )
    ]
  ]);

  return edit && ctx.callbackQuery
    ? ctx.editMessageText(text, options)
    : ctx.reply(text, options);
}

async function showCertificatePlans(ctx, device = "iphone", page = 0, { edit = true } = {}) {
  try {
    const safeDevice = String(device).toLowerCase() === "ipad" ? "ipad" : "iphone";
    const deviceLabel = safeDevice === "ipad" ? "iPad" : "iPhone";
    const plans = await getCertificatePlans(safeDevice);

    if (!plans.length) {
      const text =
        `📜 Certificate ${deviceLabel}\n\nفعلاً هیچ پلن فعالی از API دریافت نشد.`;

      const options = Markup.inlineKeyboard([
        [Markup.button.callback("Certificateهای من", "cert:my")],
        [customEmojiCallback("برگشت", "menu:home", CUSTOM_EMOJI.back)]
      ]);

      return edit && ctx.callbackQuery
        ? ctx.editMessageText(text, options)
        : ctx.reply(text, options);
    }

    const normalizedPlans = plans.map((plan) => ({
      id: plan.id,
      plan_name: plan.plan_name,
      cost: Number(plan.cost),
      selling_price: certificateSellingPrice(plan.cost, plan.plan_name, safeDevice)
    }));

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
        `${shortName(plan.plan_name, 30)} | $${Number(plan.selling_price).toFixed(2)}`,
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
      Markup.button.callback(
        "Certificateهای من",
        "cert:my"
      )
    ]);
    rows.push([
      customEmojiCallback(
        "برگشت",
        "menu:home",
        CUSTOM_EMOJI.back
      )
    ]);

    const balance = await getUserBalance(ctx.from.id);
    const text =
      `📜 Certificate ${deviceLabel}\n\n` +
      `موجودی کیف پول شما: $${balance.toFixed(2)}\n` +
      "یکی از پلن‌های زیر را انتخاب کنید:" +
      (totalPages > 1
        ? `\nصفحه ${safePage + 1} از ${totalPages}`
        : "");

    const options = Markup.inlineKeyboard(rows);

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
    `پلن: ${escapeHtml(data.plan_name)}\n` +
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
        "شارژ با Heleket",
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

  await setSession(
    ctx.from.id,
    "certificate_udid",
    {
      device: session.data?.device === "ipad" ? "ipad" : "iphone",
      selected_plan: plan
    }
  );

  const selectedDevice =
    session.data?.device === "ipad" ? "ipad" : "iphone";
  const selectedDeviceLabel =
    selectedDevice === "ipad" ? "iPad" : "iPhone";

  const text =
    `📜 ${escapeHtml(plan.plan_name)}\n\n` +
    `قیمت نهایی: $${Number(plan.selling_price).toFixed(2)}\n\n` +
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
          [Markup.button.callback("Certificateهای من", "cert:my")],
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
  if (session.state !== "certificate_confirm") {
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

    const sellingPrice = certificateSellingPrice(
      currentPlan.cost,
      currentPlan.plan_name,
      device
    );
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
        planName: currentPlan.plan_name,
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
      `${tgEmoji(ORDER_RESULT_EMOJI.orderId, "🆔")} Order ID: ${escapeHtml(String(providerResult.order))}\n` +
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
    await ctx.reply(`✅ درخواست جبران ریزش برای سفارش #${orderId} ثبت شد.`);
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
    await ctx.reply(`✅ درخواست کنسل سفارش #${orderId} برای پنل ارسال شد.`);
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

  const result = await query(
    `SELECT
       id,
       quantity,
       charge,
       status,
       service_name,
       refill_supported,
       cancel_supported,
       cancel_closed,
       cancel_requested_at,
       refill_id,
       refill_requested_at
     FROM orders
     WHERE telegram_id = $1
     ORDER BY id DESC
     LIMIT 10`,
    [ctx.from.id]
  );

  if (!result.rowCount) {
    const emptyText =
      `${htmlMenuTitle("orders", "سفارش‌های من")}\n\n` +
      "هنوز سفارشی ندارید.";

    return ctx.editMessageText(
      emptyText,
      htmlText(emptyText, mainMenu())
    );
  }

  const listText = result.rows
    .map(
      (order) =>
        `#${order.id} | ${htmlServiceName(order.service_name ?? "Service")}\n` +
        `${tgEmoji(ORDER_RESULT_EMOJI.quantity, "📊")} تعداد: ${Number(order.quantity).toLocaleString("en-US")} | ` +
        `${tgEmoji(ORDER_RESULT_EMOJI.amount, "💵")} $${Number(order.charge).toFixed(2)} | ${order.status}`
    )
    .join("\n\n");

  const text =
    `${htmlMenuTitle("orders", "سفارش‌های من")}\n\n${listText}`;

  const controlRows = [];
  for (const order of result.rows) {
    const buttons = [];
    if (order.refill_supported && !order.refill_id) {
      buttons.push(Markup.button.callback(`♻️ جبران #${order.id}`, `order:refill:${order.id}`));
    }
    if (order.cancel_supported && !order.cancel_closed && !order.cancel_requested_at) {
      buttons.push(
        customEmojiCallback(
          `کنسل #${order.id}`,
          `order:cancel_api:${order.id}`,
          ERROR_CUSTOM_EMOJI_ID
        )
      );
    }
    if (buttons.length) controlRows.push(buttons);
  }
  controlRows.push(...mainMenu().reply_markup.inline_keyboard);

  await ctx.editMessageText(
    text,
    htmlText(text, Markup.inlineKeyboard(controlRows))
  );
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

process.once(
  "SIGINT",
  () => bot.stop("SIGINT")
);

process.once(
  "SIGTERM",
  () => bot.stop("SIGTERM")
);
