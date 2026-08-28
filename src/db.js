import pg from "pg";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is missing");
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL.includes("railway")
    ? { rejectUnauthorized: false }
    : undefined
});

export async function query(text, params = []) {
  return pool.query(text, params);
}

export async function initDatabase() {
  await query(`
    CREATE TABLE IF NOT EXISTS users (
      telegram_id BIGINT PRIMARY KEY,
      username TEXT,
      first_name TEXT,
      last_name TEXT,
      balance NUMERIC(14,4) NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS platforms (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      emoji TEXT NOT NULL DEFAULT '📱',
      slug TEXT NOT NULL UNIQUE,
      status BOOLEAN NOT NULL DEFAULT TRUE,
      sort_order INT NOT NULL DEFAULT 0
    );
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS categories (
      id SERIAL PRIMARY KEY,
      platform_id INT NOT NULL REFERENCES platforms(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      emoji TEXT NOT NULL DEFAULT '🔹',
      slug TEXT NOT NULL,
      status BOOLEAN NOT NULL DEFAULT TRUE,
      sort_order INT NOT NULL DEFAULT 0,
      UNIQUE(platform_id, slug)
    );
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS orders (
      id BIGSERIAL PRIMARY KEY,
      telegram_id BIGINT NOT NULL REFERENCES users(telegram_id),
      platform_id INT REFERENCES platforms(id),
      category_id INT REFERENCES categories(id),
      link TEXT NOT NULL,
      quantity INT NOT NULL,
      charge NUMERIC(14,4) NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      provider_order_id TEXT,
      provider_name TEXT,
      provider_service_id TEXT,
      service_name TEXT,
      provider_rate NUMERIC(14,4),
      selling_rate NUMERIC(14,4),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS provider_name TEXT;`);
  await query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS provider_service_id TEXT;`);
  await query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS service_name TEXT;`);
  await query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS provider_rate NUMERIC(14,4);`);
  await query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS selling_rate NUMERIC(14,4);`);

  await query(`
    CREATE TABLE IF NOT EXISTS deposits (
      id BIGSERIAL PRIMARY KEY,
      telegram_id BIGINT NOT NULL REFERENCES users(telegram_id),
      provider TEXT NOT NULL DEFAULT 'heleket',
      external_order_id TEXT NOT NULL UNIQUE,
      invoice_uuid TEXT,
      amount_usd NUMERIC(14,4) NOT NULL,
      status TEXT NOT NULL DEFAULT 'created',
      credited BOOLEAN NOT NULL DEFAULT FALSE,
      credited_at TIMESTAMPTZ,
      provider_payload JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS user_sessions (
      telegram_id BIGINT PRIMARY KEY REFERENCES users(telegram_id) ON DELETE CASCADE,
      state TEXT,
      data JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await seedPlatformsAndCategories();
}

async function seedPlatformsAndCategories() {
  const platforms = [
    ["Instagram", "📸", "instagram", 1],
    ["Facebook", "📘", "facebook", 2],
    ["TikTok", "🎵", "tiktok", 3],
    ["YouTube", "▶️", "youtube", 4],
    ["Telegram", "✈️", "telegram", 5],
    ["Twitter / X", "𝕏", "twitter", 6],
    ["WhatsApp", "💬", "whatsapp", 7],
    ["Kick", "💚", "kik", 8],
    ["Threads", "🧵", "threads", 9],
    ["LinkedIn", "💼", "linkedin", 10],
    ["Google Maps", "📍", "google-maps", 11],
    ["Likee", "❤️", "likee", 12],
    ["Snapchat", "👻", "snapchat", 13]
  ];

  for (const [name, emoji, slug, sortOrder] of platforms) {
    await query(
      `INSERT INTO platforms (name, emoji, slug, sort_order)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (slug) DO UPDATE
       SET name = EXCLUDED.name,
           emoji = EXCLUDED.emoji,
           sort_order = EXCLUDED.sort_order`,
      [name, emoji, slug, sortOrder]
    );
  }

  const platformRows = await query(
    `SELECT id, slug FROM platforms ORDER BY sort_order`
  );

  for (const platform of platformRows.rows) {
    let categories = [
      ["فالوور / عضو", "👥", "followers", 1],
      ["لایک", "❤️", "likes", 2],
      ["ویو", "👁", "views", 3],
      ["کامنت", "💬", "comments", 4]
    ];

    if (platform.slug === "tiktok") {
      categories = [
        ["فالوور", "👥", "followers", 1],
        ["لایک", "❤️", "likes", 2],
        ["ویو", "👁", "views", 3],
        ["کامنت", "💬", "comments", 4],
        ["Live Stream", "🔴", "live-stream", 5]
      ];
    } else if (platform.slug === "youtube") {
      categories = [
        ["Subscriber / ممبر", "👥", "followers", 1],
        ["Like", "❤️", "likes", 2],
        ["ویو", "👁", "views", 3],
        ["کامنت", "💬", "comments", 4]
      ];
    } else if (platform.slug === "telegram") {
      categories = [
        ["ممبر", "👥", "followers", 1],
        ["ممبر پرمیوم", "👑", "premium-members", 2],
        ["ری‌اکشن", "❤️", "likes", 3],
        ["ری‌اکشن خودکار", "❤️", "auto-reactions", 4],
        ["ری‌اکشن استوری", "❤️", "story-reactions", 5],
        ["ویو", "👁", "views", 6],
        ["ویو خودکار", "👁", "auto-views", 7]
      ];
    } else if (platform.slug === "google-maps") {
      categories = [
        ["خدمات Google Maps", "📍", "maps-services", 1]
      ];
    }

    for (const [name, emoji, slug, sortOrder] of categories) {
      await query(
        `INSERT INTO categories (
           platform_id, name, emoji, slug, sort_order
         )
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (platform_id, slug) DO UPDATE
         SET name = EXCLUDED.name,
             emoji = EXCLUDED.emoji,
             status = TRUE,
             sort_order = EXCLUDED.sort_order`,
        [
          platform.id,
          name,
          emoji,
          slug,
          sortOrder
        ]
      );
    }

    if (platform.slug === "telegram") {
      await query(
        `UPDATE categories
         SET status = FALSE
         WHERE platform_id = $1
           AND slug NOT IN (
             'followers',
             'premium-members',
             'likes',
             'auto-reactions',
             'story-reactions',
             'views',
             'auto-views'
           )`,
        [platform.id]
      );
    }
  }
}

export async function ensureUser(from) {
  await query(
    `INSERT INTO users (
       telegram_id, username, first_name, last_name
     )
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (telegram_id) DO UPDATE
     SET username = EXCLUDED.username,
         first_name = EXCLUDED.first_name,
         last_name = EXCLUDED.last_name`,
    [
      from.id,
      from.username ?? null,
      from.first_name ?? null,
      from.last_name ?? null
    ]
  );
}

export async function getSession(telegramId) {
  const result = await query(
    `SELECT state, data
     FROM user_sessions
     WHERE telegram_id = $1`,
    [telegramId]
  );

  return result.rows[0] ?? {
    state: null,
    data: {}
  };
}

export async function setSession(
  telegramId,
  state,
  data = {}
) {
  await query(
    `INSERT INTO user_sessions (
       telegram_id, state, data, updated_at
     )
     VALUES ($1,$2,$3::jsonb,NOW())
     ON CONFLICT (telegram_id) DO UPDATE
     SET state = EXCLUDED.state,
         data = EXCLUDED.data,
         updated_at = NOW()`,
    [
      telegramId,
      state,
      JSON.stringify(data)
    ]
  );
}

export async function clearSession(telegramId) {
  await query(
    `DELETE FROM user_sessions
     WHERE telegram_id = $1`,
    [telegramId]
  );
}
