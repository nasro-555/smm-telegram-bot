import { Markup } from "telegraf";

export const mainMenu = () =>
  Markup.inlineKeyboard([
    [Markup.button.callback("🛒 ایجاد سفارش جدید", "menu:new_order")],
    [Markup.button.callback("💰 قیمت بسته‌ها", "menu:prices")],
    [
      Markup.button.callback("📦 سفارش‌های من", "menu:orders"),
      Markup.button.callback("💵 موجودی من", "menu:balance")
    ],
    [
      Markup.button.callback("💳 افزایش موجودی", "menu:deposit"),
      Markup.button.callback("🎧 پشتیبانی", "menu:support")
    ]
  ]);

export function platformKeyboard(platforms, mode) {
  const buttons = platforms.map((p) =>
    Markup.button.callback(`${p.emoji} ${p.name}`, `${mode}:platform:${p.id}`)
  );

  const rows = [];
  for (let i = 0; i < buttons.length; i += 2) {
    rows.push(buttons.slice(i, i + 2));
  }
  rows.push([Markup.button.callback("⬅️ برگشت", "menu:home")]);

  return Markup.inlineKeyboard(rows);
}

export function categoryKeyboard(categories, mode, platformId) {
  const rows = categories.map((c) => [
    Markup.button.callback(
      `${c.emoji} ${c.name}`,
      `${mode}:category:${platformId}:${c.id}`
    )
  ]);
  rows.push([Markup.button.callback("⬅️ برگشت", `${mode}:platforms`)]);
  return Markup.inlineKeyboard(rows);
}

export function serviceKeyboard(services, mode, platformId, categoryId) {
  const rows = services.map((s) => [
    Markup.button.callback(
      s.button_name,
      `${mode}:service:${platformId}:${categoryId}:${s.id}`
    )
  ]);
  rows.push([
    Markup.button.callback(
      "⬅️ برگشت",
      `${mode}:back_categories:${platformId}`
    )
  ]);
  return Markup.inlineKeyboard(rows);
}

export function packageKeyboard(packages, mode, serviceId) {
  const rows = packages.map((p) => [
    Markup.button.callback(
      `${Number(p.quantity).toLocaleString("en-US")} — $${Number(p.price).toFixed(2)}`,
      `${mode}:package:${serviceId}:${p.id}`
    )
  ]);
  rows.push([Markup.button.callback("⬅️ برگشت", "menu:home")]);
  return Markup.inlineKeyboard(rows);
}
