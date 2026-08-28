import "dotenv/config";
import { Telegraf, Markup } from "telegraf";
import {
  initDatabase,
  ensureUser,
  query,
  getSession,
  setSession,
  clearSession
} from "./db.js";
import {
  mainMenu,
  platformKeyboard,
  categoryKeyboard,
  serviceKeyboard,
  packageKeyboard
} from "./keyboards.js";

if (!process.env.BOT_TOKEN) {
  throw new Error("BOT_TOKEN is missing");
}

const bot = new Telegraf(process.env.BOT_TOKEN);

async function safeAnswerCb(ctx) {
  try {
    if (ctx.callbackQuery) await ctx.answerCbQuery();
  } catch {}
}

async function showHome(ctx) {
  await clearSession(ctx.from.id);
  const text =
    `👋 خوش آمدید\n\n` +
    `یکی از گزینه‌های زیر را انتخاب کنید:`;
  if (ctx.callbackQuery) {
    await ctx.editMessageText(text, mainMenu());
  } else {
    await ctx.reply(text, mainMenu());
  }
}

async function showPlatforms(ctx, mode) {
  const result = await query(
    `SELECT id, name, emoji FROM platforms
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

async function showCategories(ctx, mode, platformId) {
  const platformResult = await query(
    `SELECT name, emoji FROM platforms WHERE id = $1 AND status = TRUE`,
    [platformId]
  );

  if (!platformResult.rowCount) {
    return ctx.editMessageText("❌ این پلتفرم پیدا نشد.", mainMenu());
  }

  const categories = await query(
    `SELECT id, name, emoji FROM categories
     WHERE platform_id = $1 AND status = TRUE
     ORDER BY sort_order, id`,
    [platformId]
  );

  const p = platformResult.rows[0];
  const title =
    mode === "order"
      ? `${p.emoji} ${p.name}\n\nنوع خدمات را انتخاب کنید:`
      : `${p.emoji} ${p.name}\n\nقیمت کدام خدمات را می‌خواهید؟`;

  await ctx.editMessageText(
    title,
    categoryKeyboard(categories.rows, mode, platformId)
  );
}

async function showServices(ctx, mode, platformId, categoryId) {
  const categoryResult = await query(
    `SELECT name, emoji FROM categories
     WHERE id = $1 AND platform_id = $2 AND status = TRUE`,
    [categoryId, platformId]
  );

  if (!categoryResult.rowCount) {
    return ctx.editMessageText("❌ دسته‌بندی پیدا نشد.", mainMenu());
  }

  const services = await query(
    `SELECT id, button_name
     FROM service_options
     WHERE platform_id = $1
       AND category_id = $2
       AND status = TRUE
     ORDER BY sort_order, id`,
    [platformId, categoryId]
  );

  const c = categoryResult.rows[0];

  if (!services.rowCount) {
    return ctx.editMessageText(
      `${c.emoji} ${c.name}\n\n` +
      `هنوز سرویسی برای این بخش اضافه نشده است.\n` +
      `بعداً هر API که تعریف شود، دکمه مخصوص خودش دقیقاً همین‌جا نمایش داده می‌شود.`,
      Markup.inlineKeyboard([
        [Markup.button.callback("⬅️ برگشت", `${mode}:back_categories:${platformId}`)],
        [Markup.button.callback("🏠 منوی اصلی", "menu:home")]
      ])
    );
  }

  await ctx.editMessageText(
    `${c.emoji} ${c.name}\n\nنوع سرویس را انتخاب کنید:`,
    serviceKeyboard(services.rows, mode, platformId, categoryId)
  );
}

async function showPackages(ctx, mode, serviceId) {
  const serviceResult = await query(
    `SELECT so.id, so.button_name, so.description,
            p.name AS platform_name, c.name AS category_name
     FROM service_options so
     JOIN platforms p ON p.id = so.platform_id
     JOIN categories c ON c.id = so.category_id
     WHERE so.id = $1 AND so.status = TRUE`,
    [serviceId]
  );

  if (!serviceResult.rowCount) {
    return ctx.editMessageText("❌ سرویس پیدا نشد.", mainMenu());
  }

  const packages = await query(
    `SELECT id, quantity, price
     FROM packages
     WHERE service_option_id = $1 AND status = TRUE
     ORDER BY sort_order, quantity`,
    [serviceId]
  );

  const s = serviceResult.rows[0];

  if (!packages.rowCount) {
    return ctx.editMessageText(
      `🔹 ${s.button_name}\n\nهنوز بسته‌ای برای این سرویس ثبت نشده است.`,
      mainMenu()
    );
  }

  const text =
    `🔹 ${s.button_name}\n` +
    `📱 ${s.platform_name}\n` +
    `📂 ${s.category_name}\n\n` +
    `${mode === "order" ? "بسته موردنظر را انتخاب کنید:" : "قیمت بسته‌ها:"}`;

  await ctx.editMessageText(
    text,
    packageKeyboard(packages.rows, mode, serviceId)
  );
}

bot.use(async (ctx, next) => {
  if (ctx.from) {
    await ensureUser(ctx.from);
  }
  return next();
});

bot.start(showHome);

bot.action("menu:home", async (ctx) => {
  await safeAnswerCb(ctx);
  await showHome(ctx);
});

bot.action("menu:new_order", async (ctx) => {
  await safeAnswerCb(ctx);
  await showPlatforms(ctx, "order");
});

bot.action("menu:prices", async (ctx) => {
  await safeAnswerCb(ctx);
  await showPlatforms(ctx, "price");
});

bot.action("order:platforms", async (ctx) => {
  await safeAnswerCb(ctx);
  await showPlatforms(ctx, "order");
});

bot.action("price:platforms", async (ctx) => {
  await safeAnswerCb(ctx);
  await showPlatforms(ctx, "price");
});

bot.action(/^order:platform:(\d+)$/, async (ctx) => {
  await safeAnswerCb(ctx);
  await showCategories(ctx, "order", Number(ctx.match[1]));
});

bot.action(/^price:platform:(\d+)$/, async (ctx) => {
  await safeAnswerCb(ctx);
  await showCategories(ctx, "price", Number(ctx.match[1]));
});

bot.action(/^order:back_categories:(\d+)$/, async (ctx) => {
  await safeAnswerCb(ctx);
  await showCategories(ctx, "order", Number(ctx.match[1]));
});

bot.action(/^price:back_categories:(\d+)$/, async (ctx) => {
  await safeAnswerCb(ctx);
  await showCategories(ctx, "price", Number(ctx.match[1]));
});

bot.action(/^order:category:(\d+):(\d+)$/, async (ctx) => {
  await safeAnswerCb(ctx);
  await showServices(
    ctx,
    "order",
    Number(ctx.match[1]),
    Number(ctx.match[2])
  );
});

bot.action(/^price:category:(\d+):(\d+)$/, async (ctx) => {
  await safeAnswerCb(ctx);
  await showServices(
    ctx,
    "price",
    Number(ctx.match[1]),
    Number(ctx.match[2])
  );
});

bot.action(/^order:service:(\d+):(\d+):(\d+)$/, async (ctx) => {
  await safeAnswerCb(ctx);
  await showPackages(ctx, "order", Number(ctx.match[3]));
});

bot.action(/^price:service:(\d+):(\d+):(\d+)$/, async (ctx) => {
  await safeAnswerCb(ctx);
  await showPackages(ctx, "price", Number(ctx.match[3]));
});

bot.action(/^price:package:(\d+):(\d+)$/, async (ctx) => {
  await safeAnswerCb(ctx);
  const result = await query(
    `SELECT p.quantity, p.price, so.button_name
     FROM packages p
     JOIN service_options so ON so.id = p.service_option_id
     WHERE p.id = $1 AND p.service_option_id = $2`,
    [Number(ctx.match[2]), Number(ctx.match[1])]
  );

  if (!result.rowCount) return;

  const p = result.rows[0];
  await ctx.editMessageText(
    `💰 قیمت بسته\n\n` +
    `🔹 ${p.button_name}\n` +
    `📦 تعداد: ${Number(p.quantity).toLocaleString("en-US")}\n` +
    `💵 قیمت: $${Number(p.price).toFixed(2)}`,
    Markup.inlineKeyboard([
      [Markup.button.callback("🛒 ایجاد سفارش", `order:package:${ctx.match[1]}:${ctx.match[2]}`)],
      [Markup.button.callback("🏠 منوی اصلی", "menu:home")]
    ])
  );
});

bot.action(/^order:package:(\d+):(\d+)$/, async (ctx) => {
  await safeAnswerCb(ctx);

  const serviceId = Number(ctx.match[1]);
  const packageId = Number(ctx.match[2]);

  const result = await query(
    `SELECT p.id AS package_id, p.quantity, p.price,
            so.id AS service_id, so.button_name,
            so.platform_id, so.category_id
     FROM packages p
     JOIN service_options so ON so.id = p.service_option_id
     WHERE p.id = $1 AND so.id = $2
       AND p.status = TRUE AND so.status = TRUE`,
    [packageId, serviceId]
  );

  if (!result.rowCount) {
    return ctx.editMessageText("❌ این بسته در دسترس نیست.", mainMenu());
  }

  const row = result.rows[0];

  await setSession(ctx.from.id, "waiting_link", {
    package_id: row.package_id,
    service_id: row.service_id,
    platform_id: row.platform_id,
    category_id: row.category_id,
    quantity: Number(row.quantity),
    price: Number(row.price),
    button_name: row.button_name
  });

  await ctx.editMessageText(
    `🔗 لینک پیج / پست / کانال موردنظر را ارسال کنید.\n\n` +
    `سرویس: ${row.button_name}\n` +
    `تعداد: ${Number(row.quantity).toLocaleString("en-US")}\n` +
    `قیمت: $${Number(row.price).toFixed(2)}\n\n` +
    `برای لغو، /cancel را ارسال کنید.`
  );
});

bot.command("cancel", async (ctx) => {
  await clearSession(ctx.from.id);
  await ctx.reply("❌ سفارش لغو شد.", mainMenu());
});

bot.on("text", async (ctx) => {
  const session = await getSession(ctx.from.id);

  if (session.state !== "waiting_link") return;

  const link = ctx.message.text.trim();
  if (link.length < 5) {
    return ctx.reply("❌ لینک معتبر به نظر نمی‌رسد. دوباره ارسال کنید.");
  }

  const data = { ...session.data, link };
  await setSession(ctx.from.id, "confirm_order", data);

  await ctx.reply(
    `📦 خلاصه سفارش\n\n` +
    `🔹 سرویس: ${data.button_name}\n` +
    `📊 تعداد: ${Number(data.quantity).toLocaleString("en-US")}\n` +
    `💵 قیمت: $${Number(data.price).toFixed(2)}\n` +
    `🔗 لینک: ${link}\n\n` +
    `سفارش را تأیید می‌کنید؟`,
    Markup.inlineKeyboard([
      [Markup.button.callback("✅ تأیید سفارش", "order:confirm")],
      [Markup.button.callback("❌ لغو", "order:cancel")]
    ])
  );
});

bot.action("order:cancel", async (ctx) => {
  await safeAnswerCb(ctx);
  await clearSession(ctx.from.id);
  await ctx.editMessageText("❌ سفارش لغو شد.", mainMenu());
});

bot.action("order:confirm", async (ctx) => {
  await safeAnswerCb(ctx);

  const session = await getSession(ctx.from.id);
  if (session.state !== "confirm_order") {
    return ctx.editMessageText("❌ سفارش منقضی شده است.", mainMenu());
  }

  const d = session.data;

  const client = await (await import("./db.js")).pool.connect();

  try {
    await client.query("BEGIN");

    const userResult = await client.query(
      `SELECT balance FROM users WHERE telegram_id = $1 FOR UPDATE`,
      [ctx.from.id]
    );

    const balance = Number(userResult.rows[0]?.balance ?? 0);
    const charge = Number(d.price);

    if (balance < charge) {
      await client.query("ROLLBACK");
      return ctx.editMessageText(
        `❌ موجودی کافی نیست.\n\n` +
        `💵 موجودی شما: $${balance.toFixed(2)}\n` +
        `💳 مبلغ سفارش: $${charge.toFixed(2)}`,
        mainMenu()
      );
    }

    await client.query(
      `UPDATE users
       SET balance = balance - $1
       WHERE telegram_id = $2`,
      [charge, ctx.from.id]
    );

    const orderResult = await client.query(
      `INSERT INTO orders
        (telegram_id, platform_id, category_id, service_option_id,
         package_id, link, quantity, charge, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'pending')
       RETURNING id`,
      [
        ctx.from.id,
        d.platform_id,
        d.category_id,
        d.service_id,
        d.package_id,
        d.link,
        d.quantity,
        charge
      ]
    );

    await client.query("COMMIT");
    await clearSession(ctx.from.id);

    await ctx.editMessageText(
      `✅ سفارش ثبت شد.\n\n` +
      `🆔 شماره سفارش: #${orderResult.rows[0].id}\n` +
      `💵 مبلغ: $${charge.toFixed(2)}\n` +
      `⏳ وضعیت: Pending\n\n` +
      `اتصال سفارش به API Provider در مرحله بعد اضافه می‌شود.`,
      mainMenu()
    );
  } catch (error) {
    await client.query("ROLLBACK");
    console.error(error);
    await ctx.reply("❌ خطایی هنگام ثبت سفارش رخ داد.");
  } finally {
    client.release();
  }
});

bot.action("menu:balance", async (ctx) => {
  await safeAnswerCb(ctx);
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
  await safeAnswerCb(ctx);

  const result = await query(
    `SELECT o.id, o.quantity, o.charge, o.status, o.created_at,
            so.button_name
     FROM orders o
     JOIN service_options so ON so.id = o.service_option_id
     WHERE o.telegram_id = $1
     ORDER BY o.id DESC
     LIMIT 10`,
    [ctx.from.id]
  );

  if (!result.rowCount) {
    return ctx.editMessageText(
      "📦 هنوز سفارشی ثبت نکرده‌اید.",
      mainMenu()
    );
  }

  const text = result.rows.map((o) =>
    `#${o.id} | ${o.button_name}\n` +
    `تعداد: ${Number(o.quantity).toLocaleString("en-US")} | ` +
    `$${Number(o.charge).toFixed(2)} | ${o.status}`
  ).join("\n\n");

  await ctx.editMessageText(
    `📦 آخرین سفارش‌ها\n\n${text}`,
    mainMenu()
  );
});

bot.action("menu:deposit", async (ctx) => {
  await safeAnswerCb(ctx);
  await ctx.editMessageText(
    `💳 افزایش موجودی\n\n` +
    `روش‌های پرداخت در مرحله بعد اضافه می‌شوند.`,
    mainMenu()
  );
});

bot.action("menu:support", async (ctx) => {
  await safeAnswerCb(ctx);
  const support = process.env.SUPPORT_USERNAME || "@YourSupportUsername";
  await ctx.editMessageText(
    `🎧 پشتیبانی\n\nبرای ارتباط با پشتیبانی:\n${support}`,
    mainMenu()
  );
});

bot.catch((err) => {
  console.error("BOT ERROR:", err);
});

await initDatabase();

console.log("Database initialized.");
console.log("Starting Telegram bot...");

await bot.launch({
  dropPendingUpdates: false
});

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
