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
  getProviderName
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
  return "🔹";
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

  const [id, fallback] = map[key] ?? [null, "🔹"];
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

async function home(ctx) {
  await clearSession(ctx.from.id);

  const text =
    `${tgEmoji(CUSTOM_EMOJI.info.welcome, "👋")} خوش آمدید به AFPLAY\n\n` +
    "یکی از گزینه‌های زیر را انتخاب کنید:";

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
  const clean = String(name)
    .replace(/\s+/g, " ")
    .trim();

  return clean.length > max
    ? clean.slice(0, max - 1) + "…"
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
        `❌ فعلاً هیچ سرویس ${panel.label} از این پنل در دسترس نیست.`,
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

    const rows = services.map((service) => [
      Markup.button.callback(
        `${shortName(service.name)} | $${service.sellingRate.toFixed(2)}/1K`,
        `ps:${providerCode}:${panelCode}:${modeCode(mode)}:${platformId}:${categoryId}:${service.service}`
      )
    ]);

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
      "یکی از سرویس‌ها را انتخاب کنید:";

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
        custom_comments: service.customComments
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

      await ctx.editMessageText(
        "❌ شروع سفارش ممکن نشد.",
        mainMenu()
      );
    }
  }
);

bot.command("cancel", async (ctx) => {
  await clearSession(ctx.from.id);

  await ctx.reply(
    "❌ سفارش لغو شد.",
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

      return ctx.reply(
        `✅ فاکتور Heleket ساخته شد.\n\n` +
        `💵 مبلغ: $${amount.toFixed(2)}\n` +
        "پس از تأیید پرداخت، موجودی شما خودکار افزایش می‌یابد.",
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
      return ctx.reply(
        "❌ تعداد باید یک عدد صحیح باشد."
      );
    }

    if (quantity < min) {
      return ctx.reply(
        `❌ حداقل سفارش این سرویس ${min.toLocaleString("en-US")} عدد است.`
      );
    }

    if (quantity > max) {
      return ctx.reply(
        `❌ حداکثر سفارش این سرویس ${max.toLocaleString("en-US")} عدد است.`
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
      `✅ تعداد: ${quantity.toLocaleString("en-US")}\n` +
      `💵 قیمت نهایی: $${charge.toFixed(2)}\n\n` +
      "حالا لینک موردنظر را ارسال کنید."
    );
  }

  if (session.state === "provider_link") {
    if (text.length < 5) {
      return ctx.reply(
        "❌ لینک معتبر نیست. دوباره ارسال کنید."
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
      `📦 خلاصه سفارش\n\n` +
      `🔹 سرویس: ${htmlServiceName(data.service_name)}\n` +
      `📊 تعداد: ${Number(data.quantity).toLocaleString("en-US")}\n` +
      `💵 قیمت نهایی: $${Number(data.charge).toFixed(2)}\n` +
      `🔗 لینک: ${escapeHtml(data.link)}\n\n` +
      "سفارش را تأیید می‌کنید؟";

    return ctx.reply(
      confirmText,
      htmlText(
        confirmText,
        Markup.inlineKeyboard([
          [
            Markup.button.callback(
              "✅ تأیید سفارش",
              "provider:confirm"
            )
          ],
          [
            Markup.button.callback(
              "❌ لغو",
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
        "❌ لینک معتبر نیست. دوباره ارسال کنید."
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
      `📦 خلاصه سفارش\n\n` +
      `🔹 سرویس: ${htmlServiceName(data.service_name)}\n` +
      `💬 تعداد کامنت: ${quantity.toLocaleString("en-US")}\n` +
      `💵 قیمت نهایی: $${charge.toFixed(2)}\n` +
      `🔗 لینک: ${escapeHtml(data.link)}\n\n` +
      "سفارش را تأیید می‌کنید؟";

    return ctx.reply(
      confirmText,
      htmlText(
        confirmText,
        Markup.inlineKeyboard([
          [
            Markup.button.callback(
              "✅ تأیید سفارش",
              "provider:confirm"
            )
          ],
          [
            Markup.button.callback(
              "❌ لغو",
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
    "❌ سفارش لغو شد.",
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
        `❌ موجودی کافی نیست.\n\n` +
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
           selling_rate
         )
         VALUES (
           $1,$2,$3,$4,$5,$6,'pending',$7,
           $8,$9,$10,$11,$12
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
          data.selling_rate
        ]
      );

    await client.query("COMMIT");
    await clearSession(ctx.from.id);

    const successText =
      `${tgEmoji(ORDER_RESULT_EMOJI.success, "✅")} سفارش ثبت شد.\n\n` +
      `${tgEmoji(ORDER_RESULT_EMOJI.orderId, "🆔")} شماره سفارش: #${inserted.rows[0].id}\n` +
      `${tgEmoji(ORDER_RESULT_EMOJI.quantity, "📊")} تعداد: ${Number(data.quantity).toLocaleString("en-US")}\n` +
      `${tgEmoji(ORDER_RESULT_EMOJI.amount, "💵")} مبلغ: $${charge.toFixed(2)}\n` +
      `${tgEmoji(ORDER_RESULT_EMOJI.status, "⏳")} وضعیت: Pending`;

    await ctx.editMessageText(
      successText,
      htmlText(successText, mainMenu())
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
      "❌ ثبت سفارش در پنل انجام نشد. مبلغی از موجودی شما کم نشد.",
      mainMenu()
    );
  } finally {
    client.release();
  }
});

bot.action("menu:balance", async (ctx) => {
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
    `${htmlMenuTitle("balance", "موجودی من")}\n\n` +
    `موجودی شما: $${balance.toFixed(2)}`;

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
       service_name
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
        `تعداد: ${Number(order.quantity).toLocaleString("en-US")} | ` +
        `$${Number(order.charge).toFixed(2)} | ${order.status}`
    )
    .join("\n\n");

  const text =
    `${htmlMenuTitle("orders", "سفارش‌های من")}\n\n${listText}`;

  await ctx.editMessageText(
    text,
    htmlText(text, mainMenu())
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

  const support =
    process.env.SUPPORT_USERNAME ||
    "@YourSupportUsername";

  const text =
    `${htmlMenuTitle("support", "پشتیبانی")}\n\n${escapeHtml(support)}`;

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
