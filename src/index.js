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
    "👋 خوش آمدید\n\n" +
    "یکی از گزینه‌های زیر را انتخاب کنید:";

  if (ctx.callbackQuery) {
    await ctx.editMessageText(text, mainMenu());
  } else {
    await ctx.reply(text, mainMenu());
  }
}

async function platforms(ctx, mode) {
  const result = await query(
    `SELECT id, name, emoji
     FROM platforms
     WHERE status = TRUE
     ORDER BY sort_order, id`
  );

  const title =
    mode === "order"
      ? "📱 برای کدام برنامه می‌خواهید سفارش ثبت کنید؟"
      : "📱 قیمت خدمات کدام برنامه را می‌خواهید؟";

  await ctx.editMessageText(
    title,
    platformKeyboard(result.rows, mode)
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
    mode === "order"
      ? `${platform.emoji} ${platform.name}\n\nنوع خدمات را انتخاب کنید:`
      : `${platform.emoji} ${platform.name}\n\nقیمت کدام خدمات را می‌خواهید؟`;

  await ctx.editMessageText(
    title,
    categoryKeyboard(
      categoriesResult.rows,
      mode,
      platformId
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

  if (!panels.length) {
    return ctx.editMessageText(
      `${info.category_emoji} ${info.category_name}\n\n` +
      "هنوز سرویسی برای این بخش اضافه نشده است.",
      Markup.inlineKeyboard(rows)
    );
  }

  await ctx.editMessageText(
    `${info.category_emoji} ${info.category_name}\n\n` +
    "پنل موردنظر را انتخاب کنید:",
    Markup.inlineKeyboard(rows)
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

    await ctx.editMessageText(
      `🔹 ${panel.panelName}\n\n` +
      "یکی از سرویس‌ها را انتخاب کنید:",
      Markup.inlineKeyboard(rows)
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
    const panel = getPanel(
      providerCode,
      panelCode
    );

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

    let extra = "";

    if (service.customComments) {
      extra =
        "\n📝 نوع سفارش: کامنت دلخواه\n" +
        "هر کامنت را در یک خط جدا وارد می‌کنید.";
    }

    await ctx.editMessageText(
      `${panel.emoji} ${service.name}\n\n` +
      `💵 قیمت هر 1000: $${service.sellingRate.toFixed(2)}\n` +
      `⬇️ حداقل سفارش: ${service.min.toLocaleString("en-US")}\n` +
      `⬆️ حداکثر سفارش: ${service.max.toLocaleString("en-US")}` +
      extra,
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

      const panel = getPanel(
        providerCode,
        panelCode
      );

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

        return ctx.editMessageText(
          `${panel.emoji} ${service.name}\n\n` +
          `💵 قیمت هر 1000: $${service.sellingRate.toFixed(2)}\n` +
          `⬇️ حداقل: ${service.min.toLocaleString("en-US")}\n` +
          `⬆️ حداکثر: ${service.max.toLocaleString("en-US")}\n\n` +
          "ابتدا لینک موردنظر را ارسال کنید.\n\n" +
          "برای لغو: /cancel"
        );
      }

      await setSession(
        ctx.from.id,
        "provider_quantity",
        sessionData
      );

      await ctx.editMessageText(
        `${panel.emoji} ${service.name}\n\n` +
        `💵 قیمت هر 1000: $${service.sellingRate.toFixed(2)}\n` +
        `⬇️ حداقل: ${service.min.toLocaleString("en-US")}\n` +
        `⬆️ حداکثر: ${service.max.toLocaleString("en-US")}\n\n` +
        "تعداد موردنظر را به صورت عدد ارسال کنید.\n\n" +
        "برای لغو: /cancel"
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

    return ctx.reply(
      `📦 خلاصه سفارش\n\n` +
      `🔹 سرویس: ${data.service_name}\n` +
      `📊 تعداد: ${Number(data.quantity).toLocaleString("en-US")}\n` +
      `💵 قیمت نهایی: $${Number(data.charge).toFixed(2)}\n` +
      `🔗 لینک: ${data.link}\n\n` +
      "سفارش را تأیید می‌کنید؟",
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

    return ctx.reply(
      `📦 خلاصه سفارش\n\n` +
      `🔹 سرویس: ${data.service_name}\n` +
      `💬 تعداد کامنت: ${quantity.toLocaleString("en-US")}\n` +
      `💵 قیمت نهایی: $${charge.toFixed(2)}\n` +
      `🔗 لینک: ${data.link}\n\n` +
      "سفارش را تأیید می‌کنید؟",
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

      return ctx.editMessageText(
        `❌ موجودی کافی نیست.\n\n` +
        `💵 موجودی شما: $${balance.toFixed(2)}\n` +
        `💳 مبلغ سفارش: $${charge.toFixed(2)}`,
        mainMenu()
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

    await ctx.editMessageText(
      `✅ سفارش ثبت شد.\n\n` +
      `🆔 شماره سفارش: #${inserted.rows[0].id}\n` +
      `📊 تعداد: ${Number(data.quantity).toLocaleString("en-US")}\n` +
      `💵 مبلغ: $${charge.toFixed(2)}\n` +
      `⏳ وضعیت: Pending`,
      mainMenu()
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

  await ctx.editMessageText(
    `💵 موجودی شما: $${balance.toFixed(2)}`,
    mainMenu()
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
    return ctx.editMessageText(
      "📦 هنوز سفارشی ندارید.",
      mainMenu()
    );
  }

  const text = result.rows
    .map(
      (order) =>
        `#${order.id} | ${order.service_name ?? "Service"}\n` +
        `تعداد: ${Number(order.quantity).toLocaleString("en-US")} | ` +
        `$${Number(order.charge).toFixed(2)} | ${order.status}`
    )
    .join("\n\n");

  await ctx.editMessageText(
    `📦 سفارش‌های من\n\n${text}`,
    mainMenu()
  );
});

bot.action("menu:deposit", async (ctx) => {
  await answerCb(ctx);

  await ctx.editMessageText(
    "💳 افزایش موجودی\n\nروش پرداخت را در مرحله بعد اضافه می‌کنیم.",
    mainMenu()
  );
});

bot.action("menu:support", async (ctx) => {
  await answerCb(ctx);

  const support =
    process.env.SUPPORT_USERNAME ||
    "@YourSupportUsername";

  await ctx.editMessageText(
    `🎧 پشتیبانی\n\n${support}`,
    mainMenu()
  );
});

bot.catch((error) => {
  console.error("BOT ERROR:", error);
});

await initDatabase();

console.log("Database initialized.");
console.log("Providers loaded.");
console.log("Starting Telegram bot...");

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
