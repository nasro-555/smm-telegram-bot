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
  CUSTOM_EMOJI
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
        button.text.includes("â")
      ) {
        button.text = button.text
          .replace(/â/g, "")
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
    nextPayload.text.includes("â")
  ) {
    if (nextPayload.parse_mode === "HTML") {
      nextPayload.text =
        nextPayload.text.replace(
          /â/g,
          tgEmoji(
            ERROR_CUSTOM_EMOJI_ID,
            "â"
          )
        );
    } else if (!nextPayload.parse_mode) {
      nextPayload.text =
        escapeHtml(nextPayload.text)
          .replace(
            /â/g,
            tgEmoji(
              ERROR_CUSTOM_EMOJI_ID,
              "â"
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
  status: "5927294695158847101"
};

const SERVICE_TEXT_EMOJI = {
  rocket: "6228656087709520666",
  danger: "5210854838350403906"
};

function htmlServiceName(value) {
  const safe = escapeHtml(value);

  return safe
    .replace(
      /ð/g,
      tgEmoji(SERVICE_TEXT_EMOJI.rocket, "ð")
    )
    .replace(
      /â ï¸/g,
      tgEmoji(SERVICE_TEXT_EMOJI.danger, "â ï¸")
    )
    .replace(
      /â /g,
      tgEmoji(SERVICE_TEXT_EMOJI.danger, "â ï¸")
    );
}

function normalizeName(value) {
  return String(value ?? "").toLowerCase().replace(/\s+/g, " ").trim();
}

function platformFallback(name) {
  const value = normalizeName(name);
  if (value === "instagram") return "ð¸";
  if (value === "facebook") return "ð";
  if (value === "tiktok") return "ðµ";
  if (value === "youtube") return "â¶ï¸";
  if (value === "telegram") return "âï¸";
  if (["twitter / x", "twitter", "x"].includes(value)) return "âï¸";
  if (value === "whatsapp") return "ð¬";
  if (["kick", "kik"].includes(value)) return "ð";
  if (value === "threads") return "ð§µ";
  if (["linkedin", "linkdin"].includes(value)) return "ð¼";
  if (["google maps", "google map"].includes(value)) return "ð";
  if (value === "likee") return "â¤ï¸";
  if (value === "snapchat") return "ð»";
  return "ð±";
}

function categoryFallback(name) {
  const value = normalizeName(name);
  if (
    value.includes("ÙØ§ÙÙÙØ±") ||
    value.includes("ÙÙØ¨Ø±") ||
    value.includes("subscriber") ||
    value.includes("member") ||
    value.includes("Ø³Ø§Ø¨Ø³Ú©Ø±Ø§ÛØ¨Ø±")
  ) return "ð¥";
  if (
    value.includes("ÙØ§ÛÚ©") ||
    value.includes("like") ||
    value.includes("Ø±ÛâØ§Ú©Ø´Ù") ||
    value.includes("reaction")
  ) return "â¤ï¸";
  if (value.includes("Ú©Ø§ÙÙØª") || value.includes("comment")) return "ð¬";
  if (value.includes("ÙÛÙ") || value.includes("view")) return "ð";
  if (value.includes("live")) return "ð´";
  return "ð¹";
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
    newOrder: [CUSTOM_EMOJI.menu.newOrder, "ð"],
    prices: [CUSTOM_EMOJI.menu.prices, "ð·ï¸"],
    orders: [CUSTOM_EMOJI.menu.orders, "ð¦"],
    balance: [CUSTOM_EMOJI.menu.balance, "ð°"],
    deposit: [CUSTOM_EMOJI.menu.deposit, "ð³"],
    support: [CUSTOM_EMOJI.menu.support, "ð§"]
  };

  const [id, fallback] = map[key] ?? [null, "â¨"];
  const icon = id ? tgEmoji(id, fallback) : fallback;
  return `${icon} ${escapeHtml(text)}`;
}

function htmlInfoLine(key, label, value) {
  const map = {
    price: [CUSTOM_EMOJI.info.price, "ðµ"],
    min: [CUSTOM_EMOJI.info.min, "â¬ï¸"],
    max: [CUSTOM_EMOJI.info.max, "â¬ï¸"],
    orderType: [CUSTOM_EMOJI.info.orderType, "ð"]
  };

  const [id, fallback] = map[key] ?? [null, "ð¹"];
  const icon = id ? tgEmoji(id, fallback) : fallback;
  return `${icon} ${escapeHtml(label)}: ${escapeHtml(value)}`;
}

function htmlText(text, keyboard) {
  return {
    parse_mode: "HTML",
    ...(keyboard ?? {})
  };
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
    rows.push([Markup.button.callback("â»ï¸ Ø¬Ø¨Ø±Ø§Ù Ø±ÛØ²Ø´", `order:refill:${order.id}`)]);
  }
  if (order.cancel_supported && !order.cancel_closed && !order.cancel_requested_at) {
    rows.push([Markup.button.callback("â Ø«Ø¨Øª Ú©ÙØ³Ù", `order:cancel_api:${order.id}`)]);
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
    `${tgEmoji(CUSTOM_EMOJI.info.welcome, "ð")} Ø®ÙØ´ Ø¢ÙØ¯ÛØ¯ Ø¨Ù AFPLAY\n\n` +
    "ÛÚ©Û Ø§Ø² Ú¯Ø²ÛÙÙâÙØ§Û Ø²ÛØ± Ø±Ø§ Ø§ÙØªØ®Ø§Ø¨ Ú©ÙÛØ¯:";

  const options = htmlText(text, mainMenu());

  if (ctx.callbackQuery) {
    await ctx.editMessageText(text, options);
  } else {
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
    "ð±"
  );

  const title =
    mode === "order"
      ? `${platformTitleEmoji} Ø¨Ø±Ø§Û Ú©Ø¯Ø§Ù Ø¨Ø±ÙØ§ÙÙ ÙÛâØ®ÙØ§ÙÛØ¯ Ø³ÙØ§Ø±Ø´ Ø«Ø¨Øª Ú©ÙÛØ¯Ø`
      : `${platformTitleEmoji} ÙÛÙØª Ø®Ø¯ÙØ§Øª Ú©Ø¯Ø§Ù Ø¨Ø±ÙØ§ÙÙ Ø±Ø§ ÙÛâØ®ÙØ§ÙÛØ¯Ø`;

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
      "â Ù¾ÙØªÙØ±Ù Ù¾ÛØ¯Ø§ ÙØ´Ø¯.",
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
      ? "ÙÙØ¹ Ø®Ø¯ÙØ§Øª Ø±Ø§ Ø§ÙØªØ®Ø§Ø¨ Ú©ÙÛØ¯:"
      : "ÙÛÙØª Ú©Ø¯Ø§Ù Ø®Ø¯ÙØ§Øª Ø±Ø§ ÙÛâØ®ÙØ§ÙÛØ¯Ø");

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
      "â Ø¯Ø³ØªÙâØ¨ÙØ¯Û Ù¾ÛØ¯Ø§ ÙØ´Ø¯.",
      mainMenu()
    );
  }

  const panels = listPanels(
    info.platform_slug,
    info.category_slug
  );

  const rows = panels.map((panel) => {
    const iconId = categoryEmojiId(panel.label);

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
      "Ø¨Ø±Ú¯Ø´Øª",
      `${mode}:platform:${platformId}`,
      CUSTOM_EMOJI.back
    )
  ]);

  const title =
    `${htmlPlatform(info.platform_name)}\n` +
    `${htmlCategory(info.category_name)}\n\n`;

  if (!panels.length) {
    const text = title + "ÙÙÙØ² Ø³Ø±ÙÛØ³Û Ø¨Ø±Ø§Û Ø§ÛÙ Ø¨Ø®Ø´ Ø§Ø¶Ø§ÙÙ ÙØ´Ø¯Ù Ø§Ø³Øª.";
    return ctx.editMessageText(
      text,
      htmlText(text, Markup.inlineKeyboard(rows))
    );
  }

  const text = title + "Ù¾ÙÙ ÙÙØ±Ø¯ÙØ¸Ø± Ø±Ø§ Ø§ÙØªØ®Ø§Ø¨ Ú©ÙÛØ¯:";

  await ctx.editMessageText(
    text,
    htmlText(text, Markup.inlineKeyboard(rows))
  );
}

function shortName(name, max = 38) {
  const clean = String(name)
    .replace(/\s+/g, " ")
    .trim();

  return clean.length > max
    ? clean.slice(0, max - 1) + "â¦"
    : clean;
}

async function providerPanel(
  ctx,
  providerCode,
  panelCode,
  mode,
  platformId,
  categoryId
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
        `â ÙØ¹ÙØ§Ù ÙÛÚ Ø³Ø±ÙÛØ³ ${panel.label} Ø§Ø² Ø§ÛÙ Ù¾ÙÙ Ø¯Ø± Ø¯Ø³ØªØ±Ø³ ÙÛØ³Øª.`,
        Markup.inlineKeyboard([
          [
            customEmojiCallback(
              "Ø¨Ø±Ú¯Ø´Øª",
              `${mode}:category:${platformId}:${categoryId}`,
              CUSTOM_EMOJI.back
            )
          ]
        ])
      );
    }

    const rows = services.map((service) => [
      Markup.button.callback(
        `${shortName(service.name)} | $${service.sellingRate.toFixed(2)}/1K`,
        `ps:${providerCode}:${panelCode}:${modeCode(mode)}:${platformId}:${categoryId}:${service.service}`
      )
    ]);

    rows.push([
      customEmojiCallback(
        "Ø¨Ø±Ú¯Ø´Øª",
        `${mode}:category:${platformId}:${categoryId}`,
        CUSTOM_EMOJI.back
      )
    ]);

    const text =
      `${htmlPlatform(info?.platform_name ?? panel.platformSlug)}\n` +
      `${htmlCategory(panel.panelName)}\n\n` +
      "ÛÚ©Û Ø§Ø² Ø³Ø±ÙÛØ³âÙØ§ Ø±Ø§ Ø§ÙØªØ®Ø§Ø¨ Ú©ÙÛØ¯:";

    await ctx.editMessageText(
      text,
      htmlText(text, Markup.inlineKeyboard(rows))
    );
  } catch (error) {
    console.error(
      `${providerCode}/${panelCode} services error:`,
      error
    );

    await ctx.editMessageText(
      "â ÙØ¹ÙØ§Ù Ø§ØªØµØ§Ù Ø¨Ù Ø§ÛÙ Ù¾ÙÙ ÙÙÚ©Ù ÙÛØ³Øª. Ú©ÙÛ Ø¨Ø¹Ø¯ Ø¯ÙØ¨Ø§Ø±Ù Ø§ÙØªØ­Ø§Ù Ú©ÙÛØ¯.",
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
  serviceId
) {
  try {
    const service = await getService(
      providerCode,
      panelCode,
      serviceId
    );

    if (!service) {
      return ctx.editMessageText(
        "â Ø§ÛÙ Ø³Ø±ÙÛØ³ Ø¯Ø± Ø¯Ø³ØªØ±Ø³ ÙÛØ³Øª.",
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
        `\n${htmlInfoLine("orderType", "ÙÙØ¹ Ø³ÙØ§Ø±Ø´", "Ú©Ø§ÙÙØª Ø¯ÙØ®ÙØ§Ù")}` +
        "\nÙØ± Ú©Ø§ÙÙØª Ø±Ø§ Ø¯Ø± ÛÚ© Ø®Ø· Ø¬Ø¯Ø§ ÙØ§Ø±Ø¯ ÙÛâÚ©ÙÛØ¯.";
    }

    const text =
      `${serviceTitle(info, service.name)}\n\n` +
      `${htmlInfoLine("price", "ÙÛÙØª ÙØ± 1000", `$${service.sellingRate.toFixed(2)}`)}\n` +
      `${htmlInfoLine("min", "Ø­Ø¯Ø§ÙÙ Ø³ÙØ§Ø±Ø´", service.min.toLocaleString("en-US"))}\n` +
      `${htmlInfoLine("max", "Ø­Ø¯Ø§Ú©Ø«Ø± Ø³ÙØ§Ø±Ø´", service.max.toLocaleString("en-US"))}` +
      extra;

    await ctx.editMessageText(
      text,
      htmlText(
        text,
        Markup.inlineKeyboard([
          [
            customEmojiCallback(
              "Ø§ÛØ¬Ø§Ø¯ Ø³ÙØ§Ø±Ø´",
              `po:${providerCode}:${panelCode}:${platformId}:${categoryId}:${service.service}`,
              CUSTOM_EMOJI.menu.newOrder
            )
          ],
          [
            customEmojiCallback(
              "Ø¨Ø±Ú¯Ø´Øª",
              `pv:${providerCode}:${panelCode}:${modeCode(mode)}:${platformId}:${categoryId}`,
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
      "â Ø¯Ø±ÛØ§ÙØª Ø§Ø·ÙØ§Ø¹Ø§Øª Ø§ÛÙ Ø³Ø±ÙÛØ³ ÙÙÚ©Ù ÙØ´Ø¯.",
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
      "Ø¯Ø± Ø­Ø§Ù Ø¯Ø±ÛØ§ÙØª Ø³Ø±ÙÛØ³âÙØ§..."
    );

    await providerPanel(
      ctx,
      ctx.match[1],
      ctx.match[2],
      modeName(ctx.match[3]),
      Number(ctx.match[4]),
      Number(ctx.match[5])
    );
  }
);

bot.action(
  /^ps:([a-z0-9]+):([a-z0-9]+):([op]):(\d+):(\d+):(\d+)$/,
  async (ctx) => {
    await answerCb(ctx);

    await providerService(
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
          "â Ø³Ø±ÙÛØ³ Ø¯Ø± Ø¯Ø³ØªØ±Ø³ ÙÛØ³Øª.",
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
          `${htmlInfoLine("price", "ÙÛÙØª ÙØ± 1000", `$${service.sellingRate.toFixed(2)}`)}\n` +
          `${htmlInfoLine("min", "Ø­Ø¯Ø§ÙÙ Ø³ÙØ§Ø±Ø´", service.min.toLocaleString("en-US"))}\n` +
          `${htmlInfoLine("max", "Ø­Ø¯Ø§Ú©Ø«Ø± Ø³ÙØ§Ø±Ø´", service.max.toLocaleString("en-US"))}\n` +
          `${htmlInfoLine("orderType", "ÙÙØ¹ Ø³ÙØ§Ø±Ø´", "Ú©Ø§ÙÙØª Ø¯ÙØ®ÙØ§Ù")}\n\n` +
          "Ø§Ø¨ØªØ¯Ø§ ÙÛÙÚ© ÙÙØ±Ø¯ÙØ¸Ø± Ø±Ø§ Ø§Ø±Ø³Ø§Ù Ú©ÙÛØ¯.\n\n" +
          "Ø¨Ø±Ø§Û ÙØºÙ: /cancel";

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
        `${htmlInfoLine("price", "ÙÛÙØª ÙØ± 1000", `$${service.sellingRate.toFixed(2)}`)}\n` +
        `${htmlInfoLine("min", "Ø­Ø¯Ø§ÙÙ Ø³ÙØ§Ø±Ø´", service.min.toLocaleString("en-US"))}\n` +
        `${htmlInfoLine("max", "Ø­Ø¯Ø§Ú©Ø«Ø± Ø³ÙØ§Ø±Ø´", service.max.toLocaleString("en-US"))}\n\n` +
        "ØªØ¹Ø¯Ø§Ø¯ ÙÙØ±Ø¯ÙØ¸Ø± Ø±Ø§ Ø¨Ù ØµÙØ±Øª Ø¹Ø¯Ø¯ Ø§Ø±Ø³Ø§Ù Ú©ÙÛØ¯.\n\n" +
        "Ø¨Ø±Ø§Û ÙØºÙ: /cancel";

      await ctx.editMessageText(
        text,
        htmlText(text)
      );
    } catch (error) {
      console.error(
        "Start provider order error:",
        error
      );

      await ctx.editMessageText(
        "â Ø´Ø±ÙØ¹ Ø³ÙØ§Ø±Ø´ ÙÙÚ©Ù ÙØ´Ø¯.",
        mainMenu()
      );
    }
  }
);

bot.command("cancel", async (ctx) => {
  await clearSession(ctx.from.id);

  await ctx.reply(
    "â Ø³ÙØ§Ø±Ø´ ÙØºÙ Ø´Ø¯.",
    mainMenu()
  );
});

bot.on("text", async (ctx) => {
  const session = await getSession(
    ctx.from.id
  );

  const text = ctx.message.text.trim();

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
        "â ÙØ¨ÙØº Ø¨Ø§ÛØ¯ ÛÚ© Ø¹Ø¯Ø¯ Ø¨ÛÙ 1 ØªØ§ 10,000 Ø¯ÙØ§Ø± Ø¨Ø§Ø´Ø¯."
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

      return ctx.reply(
        `â ÙØ§Ú©ØªÙØ± Heleket Ø³Ø§Ø®ØªÙ Ø´Ø¯.\n\n` +
        `ðµ ÙØ¨ÙØº: $${amount.toFixed(2)}\n` +
        "Ù¾Ø³ Ø§Ø² ØªØ£ÛÛØ¯ Ù¾Ø±Ø¯Ø§Ø®ØªØ ÙÙØ¬ÙØ¯Û Ø´ÙØ§ Ø®ÙØ¯Ú©Ø§Ø± Ø§ÙØ²Ø§ÛØ´ ÙÛâÛØ§Ø¨Ø¯.",
        Markup.inlineKeyboard([
          [
            Markup.button.url(
              "ð³ Ù¾Ø±Ø¯Ø§Ø®Øª Ø¨Ø§ Heleket",
              invoice.url
            )
          ],
          [
            customEmojiCallback(
              "Ø¨Ø±Ú¯Ø´Øª",
              "menu:home",
              CUSTOM_EMOJI.back
            )
          ]
        ])
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
        "â Ø³Ø§Ø®Øª ÙØ§Ú©ØªÙØ± Heleket ÙÙÚ©Ù ÙØ´Ø¯. Ú©ÙÛ Ø¨Ø¹Ø¯ Ø¯ÙØ¨Ø§Ø±Ù Ø§ÙØªØ­Ø§Ù Ú©ÙÛØ¯.",
        mainMenu()
      );
    }
  }

  if (session.state === "provider_quantity") {
    const quantity = Number(text);
    const min = Number(session.data.min);
    const max = Number(session.data.max);

    if (!Number.isInteger(quantity)) {
      return ctx.reply(
        "â ØªØ¹Ø¯Ø§Ø¯ Ø¨Ø§ÛØ¯ ÛÚ© Ø¹Ø¯Ø¯ ØµØ­ÛØ­ Ø¨Ø§Ø´Ø¯."
      );
    }

    if (quantity < min) {
      return ctx.reply(
        `â Ø­Ø¯Ø§ÙÙ Ø³ÙØ§Ø±Ø´ Ø§ÛÙ Ø³Ø±ÙÛØ³ ${min.toLocaleString("en-US")} Ø¹Ø¯Ø¯ Ø§Ø³Øª.`
      );
    }

    if (quantity > max) {
      return ctx.reply(
        `â Ø­Ø¯Ø§Ú©Ø«Ø± Ø³ÙØ§Ø±Ø´ Ø§ÛÙ Ø³Ø±ÙÛØ³ ${max.toLocaleString("en-US")} Ø¹Ø¯Ø¯ Ø§Ø³Øª.`
      );
    }

    const charge = calculateCharge(
      session.data.provider_code,
      quantity,
      Number(session.data.selling_rate)
    );

    await setSession(
      ctx.from.id,
      "provider_link",
      {
        ...session.data,
        quantity,
        charge
      }
    );

    return ctx.reply(
      `â ØªØ¹Ø¯Ø§Ø¯: ${quantity.toLocaleString("en-US")}\n` +
      `ðµ ÙÛÙØª ÙÙØ§ÛÛ: $${charge.toFixed(2)}\n\n` +
      "Ø­Ø§ÙØ§ ÙÛÙÚ© ÙÙØ±Ø¯ÙØ¸Ø± Ø±Ø§ Ø§Ø±Ø³Ø§Ù Ú©ÙÛØ¯."
    );
  }

  if (session.state === "provider_link") {
    if (text.length < 5) {
      return ctx.reply(
        "â ÙÛÙÚ© ÙØ¹ØªØ¨Ø± ÙÛØ³Øª. Ø¯ÙØ¨Ø§Ø±Ù Ø§Ø±Ø³Ø§Ù Ú©ÙÛØ¯."
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
      `ð¦ Ø®ÙØ§ØµÙ Ø³ÙØ§Ø±Ø´\n\n` +
      `ð¹ Ø³Ø±ÙÛØ³: ${htmlServiceName(data.service_name)}\n` +
      `ð ØªØ¹Ø¯Ø§Ø¯: ${Number(data.quantity).toLocaleString("en-US")}\n` +
      `ðµ ÙÛÙØª ÙÙØ§ÛÛ: $${Number(data.charge).toFixed(2)}\n` +
      `ð ÙÛÙÚ©: ${escapeHtml(data.link)}\n\n` +
      "Ø³ÙØ§Ø±Ø´ Ø±Ø§ ØªØ£ÛÛØ¯ ÙÛâÚ©ÙÛØ¯Ø";

    return ctx.reply(
      confirmText,
      htmlText(
        confirmText,
        Markup.inlineKeyboard([
          [
            Markup.button.callback(
              "â ØªØ£ÛÛØ¯ Ø³ÙØ§Ø±Ø´",
              "provider:confirm"
            )
          ],
          [
            Markup.button.callback(
              "â ÙØºÙ",
              "order:cancel"
            )
          ]
        ])
      )
    );
  }

  if (session.state === "provider_custom_link") {
    if (text.length < 5) {
      return ctx.reply(
        "â ÙÛÙÚ© ÙØ¹ØªØ¨Ø± ÙÛØ³Øª. Ø¯ÙØ¨Ø§Ø±Ù Ø§Ø±Ø³Ø§Ù Ú©ÙÛØ¯."
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
      "ð¬ Ø­Ø§ÙØ§ ÙØªÙ Ú©Ø§ÙÙØªâÙØ§ Ø±Ø§ Ø§Ø±Ø³Ø§Ù Ú©ÙÛØ¯.\n\n" +
      "ÙØ± Ú©Ø§ÙÙØª Ø¨Ø§ÛØ¯ Ø¯Ø± ÛÚ© Ø®Ø· Ø¬Ø¯Ø§ Ø¨Ø§Ø´Ø¯."
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
        `â Ø­Ø¯Ø§ÙÙ Ø§ÛÙ Ø³Ø±ÙÛØ³ ${min.toLocaleString("en-US")} Ú©Ø§ÙÙØª Ø§Ø³Øª.\n` +
        `Ø´ÙØ§ ${quantity.toLocaleString("en-US")} Ú©Ø§ÙÙØª ÙØ±Ø³ØªØ§Ø¯ÛØ¯.`
      );
    }

    if (quantity > max) {
      return ctx.reply(
        `â Ø­Ø¯Ø§Ú©Ø«Ø± Ø§ÛÙ Ø³Ø±ÙÛØ³ ${max.toLocaleString("en-US")} Ú©Ø§ÙÙØª Ø§Ø³Øª.`
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
      `ð¦ Ø®ÙØ§ØµÙ Ø³ÙØ§Ø±Ø´\n\n` +
      `ð¹ Ø³Ø±ÙÛØ³: ${htmlServiceName(data.service_name)}\n` +
      `ð¬ ØªØ¹Ø¯Ø§Ø¯ Ú©Ø§ÙÙØª: ${quantity.toLocaleString("en-US")}\n` +
      `ðµ ÙÛÙØª ÙÙØ§ÛÛ: $${charge.toFixed(2)}\n` +
      `ð ÙÛÙÚ©: ${escapeHtml(data.link)}\n\n` +
      "Ø³ÙØ§Ø±Ø´ Ø±Ø§ ØªØ£ÛÛØ¯ ÙÛâÚ©ÙÛØ¯Ø";

    return ctx.reply(
      confirmText,
      htmlText(
        confirmText,
        Markup.inlineKeyboard([
          [
            Markup.button.callback(
              "â ØªØ£ÛÛØ¯ Ø³ÙØ§Ø±Ø´",
              "provider:confirm"
            )
          ],
          [
            Markup.button.callback(
              "â ÙØºÙ",
              "order:cancel"
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

  await ctx.editMessageText(
    "â Ø³ÙØ§Ø±Ø´ ÙØºÙ Ø´Ø¯.",
    mainMenu()
  );
});

bot.action("provider:confirm", async (ctx) => {
  await answerCb(
    ctx,
    "Ø¯Ø± Ø­Ø§Ù Ø«Ø¨Øª Ø³ÙØ§Ø±Ø´..."
  );

  const session = await getSession(
    ctx.from.id
  );

  if (session.state !== "provider_confirm") {
    return ctx.editMessageText(
      "â Ø§ÛÙ Ø³ÙØ§Ø±Ø´ ÙÙÙØ¶Û Ø´Ø¯Ù Ø§Ø³Øª.",
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
        `â ÙÙØ¬ÙØ¯Û Ú©Ø§ÙÛ ÙÛØ³Øª.\n\n` +
        `ðµ ÙÙØ¬ÙØ¯Û Ø´ÙØ§: $${balance.toFixed(2)}\n` +
        `${tgEmoji(ORDER_RESULT_EMOJI.amount, "ðµ")} ÙØ¨ÙØº Ø³ÙØ§Ø±Ø´: $${charge.toFixed(2)}`;

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
      `${tgEmoji(ORDER_RESULT_EMOJI.success, "â")} Ø³ÙØ§Ø±Ø´ Ø«Ø¨Øª Ø´Ø¯.\n\n` +
      `${tgEmoji(ORDER_RESULT_EMOJI.orderId, "ð")} Ø´ÙØ§Ø±Ù Ø³ÙØ§Ø±Ø´: #${inserted.rows[0].id}\n` +
      `${tgEmoji(ORDER_RESULT_EMOJI.quantity, "ð")} ØªØ¹Ø¯Ø§Ø¯: ${Number(data.quantity).toLocaleString("en-US")}\n` +
      `${tgEmoji(ORDER_RESULT_EMOJI.amount, "ðµ")} ÙØ¨ÙØº: $${charge.toFixed(2)}\n` +
      `${tgEmoji(ORDER_RESULT_EMOJI.status, "â³")} ÙØ¶Ø¹ÛØª: Pending`;

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

    await ctx.reply(
      "â Ø«Ø¨Øª Ø³ÙØ§Ø±Ø´ Ø¯Ø± Ù¾ÙÙ Ø§ÙØ¬Ø§Ù ÙØ´Ø¯. ÙØ¨ÙØºÛ Ø§Ø² ÙÙØ¬ÙØ¯Û Ø´ÙØ§ Ú©Ù ÙØ´Ø¯.",
      mainMenu()
    );
  } finally {
    client.release();
  }
});

bot.action(/^order:refill:(\d+)$/, async (ctx) => {\n  const orderId = Number(ctx.match[1]);\n  const order = await loadUserOrder(ctx.from.id, orderId);\n  if (!order) return answerCb(ctx, "Ø³ÙØ§Ø±Ø´ Ù¾ÛØ¯Ø§ ÙØ´Ø¯.");\n  if (!order.refill_supported) return answerCb(ctx, "Ø§ÛÙ Ø³ÙØ§Ø±Ø´ Ø¬Ø¨Ø±Ø§Ù Ø±ÛØ²Ø´ ÙØ¯Ø§Ø±Ø¯.");\n  if (order.refill_id) return answerCb(ctx, "Ø¬Ø¨Ø±Ø§Ù Ø±ÛØ²Ø´ Ø§ÛÙ Ø³ÙØ§Ø±Ø´ ÙØ¨ÙØ§Ù Ø«Ø¨Øª Ø´Ø¯Ù Ø§Ø³Øª.");\n\n  const elapsed = Date.now() - new Date(order.created_at).getTime();\n  if (elapsed < REFILL_WAIT_MS) {\n    const remainingHours = Math.ceil((REFILL_WAIT_MS - elapsed) / (60 * 60 * 1000));\n    return answerCb(ctx, `Ø¨Ø±Ø§Û Ø«Ø¨Øª Ø¬Ø¨Ø±Ø§Ù Ø±ÛØ²Ø´ Ø¨Ø§ÛØ¯ Ø­Ø¯Ø§ÙÙ Û´Û¸ Ø³Ø§Ø¹Øª Ø§Ø² Ø«Ø¨Øª Ø³ÙØ§Ø±Ø´ Ú¯Ø°Ø´ØªÙ Ø¨Ø§Ø´Ø¯. Ø­Ø¯ÙØ¯ ${remainingHours} Ø³Ø§Ø¹Øª Ø¨Ø§ÙÛ ÙØ§ÙØ¯Ù Ø§Ø³Øª.`);\n  }\n\n  await answerCb(ctx, "Ø¯Ø± Ø­Ø§Ù Ø«Ø¨Øª Ø¬Ø¨Ø±Ø§Ù Ø±ÛØ²Ø´...");\n  try {\n    const providerCode = order.provider_name === "smmxserver" ? "smmx" : order.provider_name;\n    const result = await requestProviderRefill(providerCode, order.provider_order_id);\n    await query(\n      `UPDATE orders SET refill_id = $1, refill_requested_at = NOW() WHERE id = $2 AND telegram_id = $3`,\n      [String(result.refill), orderId, ctx.from.id]\n    );\n    await ctx.reply(`â Ø¯Ø±Ø®ÙØ§Ø³Øª Ø¬Ø¨Ø±Ø§Ù Ø±ÛØ²Ø´ Ø¨Ø±Ø§Û Ø³ÙØ§Ø±Ø´ #${orderId} Ø«Ø¨Øª Ø´Ø¯.`);\n    try {\n      const fresh = await loadUserOrder(ctx.from.id, orderId);\n      await ctx.editMessageReplyMarkup(orderControlKeyboard(fresh).reply_markup);\n    } catch {}\n  } catch (error) {\n    console.error("Refill request error:", error);\n    await ctx.reply(`â Ø«Ø¨Øª Ø¬Ø¨Ø±Ø§Ù Ø±ÛØ²Ø´ Ø§ÙØ¬Ø§Ù ÙØ´Ø¯.\n${String(error.message || "Provider rejected the request")}`);\n  }\n});\n\nbot.action(/^order:cancel_api:(\d+)$/, async (ctx) => {\n  const orderId = Number(ctx.match[1]);\n  const order = await loadUserOrder(ctx.from.id, orderId);\n  if (!order) return answerCb(ctx, "Ø³ÙØ§Ø±Ø´ Ù¾ÛØ¯Ø§ ÙØ´Ø¯.");\n  if (!order.cancel_supported || order.cancel_closed) return answerCb(ctx, "Ø§ÙÚ©Ø§Ù Ú©ÙØ³Ù Ø§ÛÙ Ø³ÙØ§Ø±Ø´ Ø¯ÛÚ¯Ø± ÙØ¹Ø§Ù ÙÛØ³Øª.");\n  if (order.cancel_requested_at) return answerCb(ctx, "Ø¯Ø±Ø®ÙØ§Ø³Øª Ú©ÙØ³Ù ÙØ¨ÙØ§Ù Ø«Ø¨Øª Ø´Ø¯Ù Ø§Ø³Øª.");\n\n  await answerCb(ctx, "Ø¯Ø± Ø­Ø§Ù Ø§Ø±Ø³Ø§Ù Ø¯Ø±Ø®ÙØ§Ø³Øª Ú©ÙØ³Ù...");\n  try {\n    const providerCode = order.provider_name === "smmxserver" ? "smmx" : order.provider_name;\n    await requestProviderCancel(providerCode, order.provider_order_id);\n    await query(\n      `UPDATE orders SET cancel_requested_at = NOW(), status = 'cancel_requested' WHERE id = $1 AND telegram_id = $2`,\n      [orderId, ctx.from.id]\n    );\n    await ctx.reply(`â Ø¯Ø±Ø®ÙØ§Ø³Øª Ú©ÙØ³Ù Ø³ÙØ§Ø±Ø´ #${orderId} Ø¨Ø±Ø§Û Ù¾ÙÙ Ø§Ø±Ø³Ø§Ù Ø´Ø¯.`);\n    try {\n      const fresh = await loadUserOrder(ctx.from.id, orderId);\n      await ctx.editMessageReplyMarkup(orderControlKeyboard(fresh).reply_markup);\n    } catch {}\n  } catch (error) {\n    console.error("Cancel request error:", error);\n    await query(\n      `UPDATE orders SET cancel_closed = TRUE WHERE id = $1 AND telegram_id = $2`,\n      [orderId, ctx.from.id]\n    );\n    await ctx.reply("â Ù¾ÙÙ Ø¯ÛÚ¯Ø± Ø§Ø¬Ø§Ø²Ù Ú©ÙØ³Ù Ø§ÛÙ Ø³ÙØ§Ø±Ø´ Ø±Ø§ ÙÙÛâØ¯ÙØ¯.");\n    try {\n      const fresh = await loadUserOrder(ctx.from.id, orderId);\n      await ctx.editMessageReplyMarkup(orderControlKeyboard(fresh).reply_markup);\n    } catch {}\n  }\n});\n\nbot.action("menu:balance", async (ctx) => {
  await answerCb(ctx);

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
    `${htmlMenuTitle("balance", "ÙÙØ¬ÙØ¯Û ÙÙ")}\n\n` +
    `ÙÙØ¬ÙØ¯Û Ø´ÙØ§: $${balance.toFixed(2)}`;

  await ctx.editMessageText(
    text,
    htmlText(text, mainMenu())
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
      `${htmlMenuTitle("orders", "Ø³ÙØ§Ø±Ø´âÙØ§Û ÙÙ")}\n\n` +
      "ÙÙÙØ² Ø³ÙØ§Ø±Ø´Û ÙØ¯Ø§Ø±ÛØ¯.";

    return ctx.editMessageText(
      emptyText,
      htmlText(emptyText, mainMenu())
    );
  }

  const listText = result.rows
    .map(
      (order) =>
        `#${order.id} | ${htmlServiceName(order.service_name ?? "Service")}\n` +
        `ØªØ¹Ø¯Ø§Ø¯: ${Number(order.quantity).toLocaleString("en-US")} | ` +
        `$${Number(order.charge).toFixed(2)} | ${order.status}`
    )
    .join("\n\n");

  const text =
    `${htmlMenuTitle("orders", "Ø³ÙØ§Ø±Ø´âÙØ§Û ÙÙ")}\n\n${listText}`;

  const controlRows = [];
  for (const order of result.rows) {
    const buttons = [];
    if (order.refill_supported && !order.refill_id) {
      buttons.push(Markup.button.callback(`â»ï¸ Ø¬Ø¨Ø±Ø§Ù #${order.id}`, `order:refill:${order.id}`));
    }
    if (order.cancel_supported && !order.cancel_closed && !order.cancel_requested_at) {
      buttons.push(Markup.button.callback(`â Ú©ÙØ³Ù #${order.id}`, `order:cancel_api:${order.id}`));
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
    `${htmlMenuTitle("deposit", "Ø§ÙØ²Ø§ÛØ´ ÙÙØ¬ÙØ¯Û")}\n\n` +
    "Ø±ÙØ´ Ù¾Ø±Ø¯Ø§Ø®Øª Ø±Ø§ Ø§ÙØªØ®Ø§Ø¨ Ú©ÙÛØ¯:";

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
            "Ø¨Ø±Ú¯Ø´Øª",
            "menu:home",
            CUSTOM_EMOJI.back
          )
        ]
      ])
    )
  );
});

bot.action("deposit:heleket", async (ctx) => {
  await answerCb(ctx);

  if (!publicBaseUrl()) {
    return ctx.editMessageText(
      "â Ø¯Ø§ÙÙÙ Ø¹ÙÙÙÛ Railway ÙÙÙØ² Ø³Ø§Ø®ØªÙ ÙØ´Ø¯Ù Ø§Ø³Øª.\n\n" +
      "Ø¨Ø¹Ø¯ Ø§Ø² ÙØµØ¨ Ø§ÛÙ ÙØ³Ø®ÙØ Ø¯Ø± Railway Ø¨Ø±Ø§Û Ù¾ÙØ±Øª 8080 Ø¯Ø§ÙÙÙ Ø¨Ø³Ø§Ø²ÛØ¯.",
      mainMenu()
    );
  }

  await setSession(
    ctx.from.id,
    "deposit_heleket_amount",
    {}
  );

  const text =
    `${htmlMenuTitle("deposit", "Ø§ÙØ²Ø§ÛØ´ ÙÙØ¬ÙØ¯Û Ø¨Ø§ Heleket")}\n\n` +
    "ÙØ¨ÙØº Ø±Ø§ Ø¨Ù Ø¯ÙØ§Ø± ÙØ§Ø±Ø¯ Ú©ÙÛØ¯.\n" +
    "ÙØ«Ø§Ù: 10";

  await ctx.editMessageText(
    text,
    htmlText(
      text,
      Markup.inlineKeyboard([
        [
          customEmojiCallback(
            "Ø¨Ø±Ú¯Ø´Øª",
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

  const support =
    process.env.SUPPORT_USERNAME ||
    "@YourSupportUsername";

  const text =
    `${htmlMenuTitle("support", "Ù¾Ø´ØªÛØ¨Ø§ÙÛ")}\n\n${escapeHtml(support)}`;

  await ctx.editMessageText(
    text,
    htmlText(text, mainMenu())
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
