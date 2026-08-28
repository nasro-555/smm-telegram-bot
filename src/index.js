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
  categoryKeyboard
} from "./keyboards.js";
import {
  getFollowerServices,
  getFollowerService,
  calculateCustomerCharge,
  createOrder as createSmmxOrder
} from "./smmxserver.js";

if (!process.env.BOT_TOKEN) {
  throw new Error("BOT_TOKEN is missing");
}

const bot = new Telegraf(process.env.BOT_TOKEN);

async function answerCb(ctx, text) {
  try {
    if (ctx.callbackQuery) await ctx.answerCbQuery(text);
  } catch {}
}

async function home(ctx) {
  await clearSession(ctx.from.id);
  const text = "👋 خوش آمدید\n\nیکی از گزینه‌های زیر را انتخاب کنید:";

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

  await ctx.editMessageText(title, platformKeyboard(result.rows, mode));
}

async function categories(ctx, mode, platformId) {
  const p = await query(
    `SELECT id, name, emoji FROM platforms
     WHERE id = $1 AND status = TRUE`,
    [platformId]
  );

  if (!p.rowCount) {
    return ctx.editMessageText("❌ پلتفرم پیدا نشد.", mainMenu());
  }

  const cats = await query(
    `SELECT id, name, emoji
     FROM categories
     WHERE platform_id = $1 AND status = TRUE
     ORDER BY sort_order, id`,
    [platformId]
  );

  const platform = p.rows[0];
  const title =
    mode === "order"
      ? `${platform.emoji} ${platform.name}\n\nنوع خدمات را انتخاب کنید:`
      : `${platform.emoji} ${platform.name}\n\nقیمت کدام خدمات را می‌خواهید؟`;

  await ctx.editMessageText(
    title,
    categoryKeyboard(cats.rows, mode, platformId)
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

async function servicePanels(ctx, mode, platformId, categoryId) {
  const info = await categoryInfo(platformId, categoryId);

  if (!info) {
    return ctx.editMessageText("❌ دسته‌بندی پیدا نشد.", mainMenu());
  }

  const rows = [];

  if (
    info.platform_slug === "instagram" &&
    info.category_slug === "followers"
  ) {
    rows.push([
      Markup.button.callback(
        "🔹 پنل فالورای شماره یک",
        `smmx:panel:${mode}:${platformId}:${categoryId}`
      )
    ]);
  }

  rows.push([
    Markup.button.callback(
      "⬅️ برگشت",
      `${mode}:platform:${platformId}`
    )
  ]);

  if (rows.length === 1) {
    return ctx.editMessageText(
      `${info.category_emoji} ${info.category_name}\n\n` +
      `هنوز سرویسی برای این بخش اضافه نشده است.`,
      Markup.inlineKeyboard(rows)
    );
  }

  await ctx.editMessageText(
    `${info.category_emoji} ${info.category_name}\n\n` +
    `پنل موردنظر را انتخاب کنید:`,
    Markup.inlineKeyboard(rows)
  );
}

function shortName(name, max = 38) {
  const clean = String(name).replace(/\s+/g, " ").trim();
  return clean.length > max ? clean.slice(0, max - 1) + "…" : clean;
}

async function smmxPanel(ctx, mode, platformId, categoryId) {
  try {
    const services = await getFollowerServices();

    if (!services.length) {
      return ctx.editMessageText(
        "❌ فعلاً هیچ سرویسی از پنل شماره یک در دسترس نیست.",
        Markup.inlineKeyboard([
          [
            Markup.button.callback(
              "⬅️ برگشت",
              `${mode}:category:${platformId}:${categoryId}`
            )
          ]
        ])
      );
    }

    const rows = services.map((s) => [
      Markup.button.callback(
        `${shortName(s.name)} | $${s.sellingRate.toFixed(2)}/1K`,
        `smmx:service:${mode}:${platformId}:${categoryId}:${s.service}`
      )
    ]);

    rows.push([
      Markup.button.callback(
        "⬅️ برگشت",
        `${mode}:category:${platformId}:${categoryId}`
      )
    ]);

    await ctx.editMessageText(
      `🔹 پنل فالورای شماره یک\n\n` +
      `یکی از سرویس‌ها را انتخاب کنید:`,
      Markup.inlineKeyboard(rows)
    );
  } catch (error) {
    console.error("SMMX services error:", error);
    await ctx.editMessageText(
      "❌ فعلاً اتصال به پنل شماره یک ممکن نیست. کمی بعد دوباره امتحان کنید.",
      mainMenu()
    );
  }
}

async function smmxService(ctx, mode, platformId, categoryId, serviceId) {
  try {
    const s = await getFollowerService(serviceId);

    if (!s) {
      return ctx.editMessageText("❌ این سرویس در دسترس نیست.", mainMenu());
    }

    await ctx.editMessageText(
      `👥 ${s.name}\n\n` +
      `💵 قیمت هر 1000: $${s.sellingRate.toFixed(2)}\n` +
      `⬇️ حداقل سفارش: ${s.min.toLocaleString("en-US")}\n` +
      `⬆️ حداکثر سفارش: ${s.max.toLocaleString("en-US")}`,
      Markup.inlineKeyboard([
        [
          Markup.button.callback(
            "🛒 ایجاد سفارش",
            `smmx:start:${platformId}:${categoryId}:${s.service}`
          )
        ],
        [
          Markup.button.callback(
            "⬅️ برگشت",
            `smmx:panel:${mode}:${platformId}:${categoryId}`
          )
        ]
      ])
    );
  } catch (error) {
    console.error("SMMX service detail error:", error);
    await ctx.editMessageText(
      "❌ دریافت اطلاعات این سرویس ممکن نشد.",
      mainMenu()
    );
  }
}

bot.use(async (ctx, next) => {
  if (ctx.from) await ensureUser(ctx.from);
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
  await categories(ctx, "order", Number(ctx.match[1]));
});

bot.action(/^price:platform:(\d+)$/, async (ctx) => {
  await answerCb(ctx);
  await categories(ctx, "price", Number(ctx.match[1]));
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
  await categories(ctx, "order", Number(ctx.match[1]));
});

bot.action(/^price:back_categories:(\d+)$/, async (ctx) => {
  await answerCb(ctx);
  await categories(ctx, "price", Number(ctx.match[1]));
});

bot.action(/^smmx:panel:(order|price):(\d+):(\d+)$/, async (ctx) => {
  await answerCb(ctx, "در حال دریافت سرویس‌ها...");
  await smmxPanel(
    ctx,
    ctx.match[1],
    Number(ctx.match[2]),
    Number(ctx.match[3])
  );
});

bot.action(
  /^smmx:service:(order|price):(\d+):(\d+):(\d+)$/,
  async (ctx) => {
    await answerCb(ctx);
    await smmxService(
      ctx,
      ctx.match[1],
      Number(ctx.match[2]),
      Number(ctx.match[3]),
      Number(ctx.match[4])
    );
  }
);

bot.action(/^smmx:start:(\d+):(\d+):(\d+)$/, async (ctx) => {
  await answerCb(ctx);

  try {
    const platformId = Number(ctx.match[1]);
    const categoryId = Number(ctx.match[2]);
    const serviceId = Number(ctx.match[3]);
    const s = await getFollowerService(serviceId);

    if (!s) {
      return ctx.editMessageText("❌ سرویس در دسترس نیست.", mainMenu());
    }

    await setSession(ctx.from.id, "smmx_quantity", {
      platform_id: platformId,
      category_id: categoryId,
      provider_service_id: String(s.service),
      service_name: s.name,
      provider_rate: s.providerRate,
      selling_rate: s.sellingRate,
      min: s.min,
      max: s.max
    });

    await ctx.editMessageText(
      `👥 ${s.name}\n\n` +
      `💵 قیمت هر 1000: $${s.sellingRate.toFixed(2)}\n` +
      `⬇️ حداقل: ${s.min.toLocaleString("en-US")}\n` +
      `⬆️ حداکثر: ${s.max.toLocaleString("en-US")}\n\n` +
      `تعداد موردنظر را به صورت عدد ارسال کنید.\n\n` +
      `برای لغو: /cancel`
    );
  } catch (error) {
    console.error("Start SMMX order error:", error);
    await ctx.editMessageText("❌ شروع سفارش ممکن نشد.", mainMenu());
  }
});

bot.command("cancel", async (ctx) => {
  await clearSession(ctx.from.id);
  await ctx.reply("❌ سفارش لغو شد.", mainMenu());
});

bot.on("text", async (ctx) => {
  const session = await getSession(ctx.from.id);
  const text = ctx.message.text.trim();

  if (session.state === "smmx_quantity") {
    const quantity = Number(text);
    const min = Number(session.data.min);
    const max = Number(session.data.max);

    if (!Number.isInteger(quantity)) {
      return ctx.reply("❌ تعداد باید یک عدد صحیح باشد.");
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

    const charge = calculateCustomerCharge(
      quantity,
      Number(session.data.selling_rate)
    );

    await setSession(ctx.from.id, "smmx_link", {
      ...session.data,
      quantity,
      charge
    });

    return ctx.reply(
      `✅ تعداد: ${quantity.toLocaleString("en-US")}\n` +
      `💵 قیمت نهایی: $${charge.toFixed(2)}\n\n` +
      `حالا لینک پیج اینستاگرام را ارسال کنید.`
    );
  }

  if (session.state === "smmx_link") {
    if (text.length < 5) {
      return ctx.reply("❌ لینک معتبر نیست. دوباره ارسال کنید.");
    }

    const data = { ...session.data, link: text };
    await setSession(ctx.from.id, "smmx_confirm", data);

    return ctx.reply(
      `📦 خلاصه سفارش\n\n` +
      `🔹 سرویس: ${data.service_name}\n` +
      `📊 تعداد: ${Number(data.quantity).toLocaleString("en-US")}\n` +
      `💵 قیمت نهایی: $${Number(data.charge).toFixed(2)}\n` +
      `🔗 لینک: ${data.link}\n\n` +
      `سفارش را تأیید می‌کنید؟`,
      Markup.inlineKeyboard([
        [Markup.button.callback("✅ تأیید سفارش", "smmx:confirm")],
        [Markup.button.callback("❌ لغو", "order:cancel")]
      ])
    );
  }
});

bot.action("order:cancel", async (ctx) => {
  await answerCb(ctx);
  await clearSession(ctx.from.id);
  await ctx.editMessageText("❌ سفارش لغو شد.", mainMenu());
});

bot.action("smmx:confirm", async (ctx) => {
  await answerCb(ctx, "در حال ثبت سفارش...");

  const session = await getSession(ctx.from.id);

  if (session.state !== "smmx_confirm") {
    return ctx.editMessageText("❌ این سفارش منقضی شده است.", mainMenu());
  }

  const d = session.data;
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const user = await client.query(
      `SELECT balance FROM users
       WHERE telegram_id = $1
       FOR UPDATE`,
      [ctx.from.id]
    );

    const balance = Number(user.rows[0]?.balance ?? 0);
    const charge = Number(d.charge);

    if (balance < charge) {
      await client.query("ROLLBACK");
      return ctx.editMessageText(
        `❌ موجودی کافی نیست.\n\n` +
        `💵 موجودی شما: $${balance.toFixed(2)}\n` +
        `💳 مبلغ سفارش: $${charge.toFixed(2)}`,
        mainMenu()
      );
    }

    const providerResult = await createSmmxOrder({
      service: d.provider_service_id,
      link: d.link,
      quantity: d.quantity
    });

    await client.query(
      `UPDATE users
       SET balance = balance - $1
       WHERE telegram_id = $2`,
      [charge, ctx.from.id]
    );

    const inserted = await client.query(
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
         'smmxserver',$8,$9,$10,$11
       )
       RETURNING id`,
      [
        ctx.from.id,
        d.platform_id,
        d.category_id,
        d.link,
        d.quantity,
        charge,
        String(providerResult.order),
        d.provider_service_id,
        d.service_name,
        d.provider_rate,
        d.selling_rate
      ]
    );

    await client.query("COMMIT");
    await clearSession(ctx.from.id);

    await ctx.editMessageText(
      `✅ سفارش ثبت شد.\n\n` +
      `🆔 شماره سفارش: #${inserted.rows[0].id}\n` +
      `📊 تعداد: ${Number(d.quantity).toLocaleString("en-US")}\n` +
      `💵 مبلغ: $${charge.toFixed(2)}\n` +
      `⏳ وضعیت: Pending`,
      mainMenu()
    );
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {}

    console.error("SMMX confirm error:", error);

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
    `SELECT balance FROM users WHERE telegram_id = $1`,
    [ctx.from.id]
  );

  const balance = Number(result.rows[0]?.balance ?? 0);

  await ctx.editMessageText(
    `💵 موجودی شما: $${balance.toFixed(2)}`,
    mainMenu()
  );
});

bot.action("menu:orders", async (ctx) => {
  await answerCb(ctx);

  const result = await query(
    `SELECT id, quantity, charge, status, service_name
     FROM orders
     WHERE telegram_id = $1
     ORDER BY id DESC
     LIMIT 10`,
    [ctx.from.id]
  );

  if (!result.rowCount) {
    return ctx.editMessageText("📦 هنوز سفارشی ندارید.", mainMenu());
  }

  const text = result.rows
    .map(
      (o) =>
        `#${o.id} | ${o.service_name ?? "Service"}\n` +
        `تعداد: ${Number(o.quantity).toLocaleString("en-US")} | ` +
        `$${Number(o.charge).toFixed(2)} | ${o.status}`
    )
    .join("\n\n");

  await ctx.editMessageText(`📦 سفارش‌های من\n\n${text}`, mainMenu());
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

  const support = process.env.SUPPORT_USERNAME || "@YourSupportUsername";

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
console.log("Starting Telegram bot...");

await bot.launch({ dropPendingUpdates: false });

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));

