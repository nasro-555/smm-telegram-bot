import { Markup } from "telegraf";

export const CUSTOM_EMOJI = {
  platforms: {
    instagram: "5319160079465857105",
    facebook: "5323261730283863478",
    tiktok: "5327982530702359565",
    youtube: "5334681713316479679",
    telegram: "5330237710655306682",
    twitter: "5330337435500951363",
    whatsapp: "5334998226636390258",
    kik: "5289683581474464897",
    threads: "5334592721594105691",
    linkedin: "5346024520081751155",
    googleMaps: "5370988368949690738",
    likee: "5321403907820240828",
    snapchat: "5330248916224983855"
  },
  menu: {
    newOrder: "5269749315403802774",
    balance: "5814447916969890525",
    orders: "6269366244462301331",
    prices: "5388590673937053524",
    deposit: "5814556334829343625",
    support: "5431376038628171216"
  },
  categories: {
    followers: "5165730662103122933",
    likes: "5269254968963001187",
    comments: "5389035628253950810",
    views: "5386638267703635704",
    live: "6280793816702126346",
    shares: "5264759912025564026",
    rocket: "6228656087709520666",
    other: "5447410659077661506"
  },
  info: {
    platformTitle: "5398012024003246287",
    welcome: "5420105073780862539",
    price: "5226670260848962179",
    min: "5224268021215804264",
    max: "5224491114702060799",
    orderType: "5350427505805238170"
  },
  back: "5983279327574233274"
};

export function customEmojiCallback(text, callbackData, customEmojiId = null) {
  const button = Markup.button.callback(text, callbackData);
  if (customEmojiId) {
    button.icon_custom_emoji_id = String(customEmojiId);
  }
  return button;
}

function normalizeName(value) {
  return String(value ?? "").toLowerCase().replace(/\s+/g, " ").trim();
}

export function platformEmojiId(platform) {
  const name = normalizeName(platform?.name ?? platform);

  if (name === "instagram") return CUSTOM_EMOJI.platforms.instagram;
  if (name === "facebook") return CUSTOM_EMOJI.platforms.facebook;
  if (name === "tiktok") return CUSTOM_EMOJI.platforms.tiktok;
  if (name === "youtube") return CUSTOM_EMOJI.platforms.youtube;
  if (name === "telegram") return CUSTOM_EMOJI.platforms.telegram;
  if (["twitter / x", "twitter", "x"].includes(name)) return CUSTOM_EMOJI.platforms.twitter;
  if (name === "whatsapp") return CUSTOM_EMOJI.platforms.whatsapp;
  if (["kik", "kick", "kiki"].includes(name)) return CUSTOM_EMOJI.platforms.kik;
  if (name === "threads") return CUSTOM_EMOJI.platforms.threads;
  if (["linkedin", "linkdin"].includes(name)) return CUSTOM_EMOJI.platforms.linkedin;
  if (["google maps", "google map"].includes(name)) return CUSTOM_EMOJI.platforms.googleMaps;
  if (name === "likee") return CUSTOM_EMOJI.platforms.likee;
  if (name === "snapchat") return CUSTOM_EMOJI.platforms.snapchat;

  return null;
}

export function categoryEmojiId(categoryOrLabel) {
  const name = normalizeName(
    typeof categoryOrLabel === "string" ? categoryOrLabel : categoryOrLabel?.name
  );

  if (name.includes("rocket speed")) {
    return CUSTOM_EMOJI.categories.rocket;
  }

  if (
    name.includes("اشتراک گذاری") ||
    name.includes("اشتراک‌گذاری") ||
    name.includes("share") ||
    name.includes("repost") ||
    name.includes("send")
  ) {
    return CUSTOM_EMOJI.categories.shares;
  }

  if (
    name.includes("فالوور") ||
    name.includes("ممبر") ||
    name.includes("subscriber") ||
    name.includes("سابسکرایبر") ||
    name.includes("follower") ||
    name.includes("member") ||
    name.includes("connection")
  ) {
    return CUSTOM_EMOJI.categories.followers;
  }

  if (
    name.includes("لایک") ||
    name.includes("like") ||
    name.includes("ری‌اکشن") ||
    name.includes("reaction")
  ) {
    return CUSTOM_EMOJI.categories.likes;
  }

  if (
    name.includes("کامنت") ||
    name.includes("comment") ||
    name.includes("نظرسنجی") ||
    name.includes("poll") ||
    name.includes("review")
  ) {
    return CUSTOM_EMOJI.categories.comments;
  }

  if (name.includes("ویو") || name.includes("view")) {
    return CUSTOM_EMOJI.categories.views;
  }

  if (name.includes("live stream") || name.includes("لایو") || name.includes("live")) {
    return CUSTOM_EMOJI.categories.live;
  }

  if (
    name.includes("بغیه خدمات") ||
    name.includes("بقیه خدمات") ||
    name.includes("other services") ||
    name.includes("other-services")
  ) {
    return CUSTOM_EMOJI.categories.other;
  }

  return null;
}

export const mainMenu = () =>
  Markup.inlineKeyboard([
    [
      customEmojiCallback(
        "لیست محصولات",
        "menu:new_order",
        CUSTOM_EMOJI.menu.newOrder
      )
    ],
    [
      customEmojiCallback(
        "قیمت بسته‌ها",
        "menu:prices",
        CUSTOM_EMOJI.menu.prices
      )
    ],
    [
      customEmojiCallback(
        "سفارش‌های من",
        "menu:orders",
        CUSTOM_EMOJI.menu.orders
      ),
      customEmojiCallback(
        "کیف پول",
        "menu:balance",
        CUSTOM_EMOJI.menu.balance
      )
    ],
    [
      customEmojiCallback(
        "پشتیبانی",
        "menu:support",
        CUSTOM_EMOJI.menu.support
      )
    ]
  ]);

export function platformKeyboard(platforms, mode) {
  const buttons = platforms.map((platform) =>
    customEmojiCallback(
      platform.name,
      `${mode}:platform:${platform.id}`,
      platformEmojiId(platform)
    )
  );

  const rows = [];
  for (let i = 0; i < buttons.length; i += 2) {
    rows.push(buttons.slice(i, i + 2));
  }

  rows.push([
    customEmojiCallback("برگشت", "menu:home", CUSTOM_EMOJI.back)
  ]);

  return Markup.inlineKeyboard(rows);
}

export function categoryKeyboard(categories, mode, platformId) {
  const rows = categories.map((category) => {
    const iconId = categoryEmojiId(category);
    const text = iconId ? category.name : `${category.emoji} ${category.name}`;

    return [
      customEmojiCallback(
        text,
        `${mode}:category:${platformId}:${category.id}`,
        iconId
      )
    ];
  });

  rows.push([
    customEmojiCallback("برگشت", `${mode}:platforms`, CUSTOM_EMOJI.back)
  ]);

  return Markup.inlineKeyboard(rows);
}

export const persistentMenu = () => ({
  reply_markup: {
    keyboard: [
      [
        {
          text: "لیست محصولات",
          icon_custom_emoji_id: CUSTOM_EMOJI.menu.newOrder,
          style: "success"
        }
      ],
      [
        {
          text: "قیمت بسته‌ها",
          icon_custom_emoji_id: CUSTOM_EMOJI.menu.prices,
          style: "primary"
        }
      ],
      [
        {
          text: "سفارش‌های من",
          icon_custom_emoji_id: CUSTOM_EMOJI.menu.orders,
          style: "primary"
        },
        {
          text: "کیف پول",
          icon_custom_emoji_id: CUSTOM_EMOJI.menu.balance,
          style: "primary"
        }
      ],
      [
        {
          text: "پشتیبانی",
          icon_custom_emoji_id: CUSTOM_EMOJI.menu.support,
          style: "danger"
        }
      ]
    ],
    is_persistent: true,
    resize_keyboard: true,
    one_time_keyboard: false,
    input_field_placeholder: "یکی از گزینه‌ها را انتخاب کنید"
  }
});
