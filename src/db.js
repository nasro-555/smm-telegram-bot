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
    CREATE TABLE IF NOT EXISTS providers (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      api_url TEXT,
      api_key TEXT,
      status BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS service_options (
      id SERIAL PRIMARY KEY,
      platform_id INT NOT NULL REFERENCES platforms(id) ON DELETE CASCADE,
      category_id INT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
      provider_id INT REFERENCES providers(id) ON DELETE SET NULL,
      provider_service_id TEXT,
      button_name TEXT NOT NULL,
      description TEXT,
      min_qty INT NOT NULL DEFAULT 1,
      max_qty INT NOT NULL DEFAULT 100000,
      status BOOLEAN NOT NULL DEFAULT TRUE,
      sort_order INT NOT NULL DEFAULT 0
    );
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS packages (
      id SERIAL PRIMARY KEY,
      service_option_id INT NOT NULL REFERENCES service_options(id) ON DELETE CASCADE,
      quantity INT NOT NULL,
      price NUMERIC(14,4) NOT NULL,
      status BOOLEAN NOT NULL DEFAULT TRUE,
      sort_order INT NOT NULL DEFAULT 0
    );
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS orders (
      id BIGSERIAL PRIMARY KEY,
      telegram_id BIGINT NOT NULL REFERENCES users(telegram_id),
      platform_id INT NOT NULL REFERENCES platforms(id),
      category_id INT NOT NULL REFERENCES categories(id),
      service_option_id INT NOT NULL REFERENCES service_options(id),
      package_id INT NOT NULL REFERENCES packages(id),
      link TEXT NOT NULL,
      quantity INT NOT NULL,
      charge NUMERIC(14,4) NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      provider_order_id TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
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

  await seedPlatforms();
}

async function seedPlatforms() {
  const platforms = [
    ["Instagram", "📸", "instagram", 1],
    ["Facebook", "📘", "facebook", 2],
    ["TikTok", "🎵", "tiktok", 3],
    ["YouTube", "▶️", "youtube", 4],
    ["Telegram", "✈️", "telegram", 5],
    ["Twitter / X", "𝕏", "twitter", 6],
    ["WhatsApp", "💬", "whatsapp", 7],
    ["Kik", "💚", "kik", 8],
    ["Threads", "🧵", "threads", 9],
    ["LinkedIn", "💼", "linkedin", 10],
    ["Google Maps", "📍", "google-maps", 11],
    ["Likee", "❤️", "likee", 12],
    ["Snapchat", "👻", "snapchat", 13]
  ];

  for (const [name, emoji, slug, sortOrder] of platforms) {
    await query(
      `INSERT INTO platforms (name, emoji, slug, sort_order)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (slug) DO UPDATE
       SET name = EXCLUDED.name,
           emoji = EXCLUDED.emoji,
           sort_order = EXCLUDED.sort_order`,
      [name, emoji, slug, sortOrder]
    );
  }

  const genericCats = [
    ["فالوور / عضو", "👥", "followers", 1],
    ["لایک", "❤️", "likes", 2],
    ["ویو", "👁", "views", 3],
    ["کامنت", "💬", "comments", 4]
  ];

  const platformRows = await query(`SELECT id, slug FROM platforms ORDER BY sort_order`);
  for (const p of platformRows.rows) {
    let cats = genericCats;

    if (p.slug === "youtube") {
      cats = [
        ["سابسکرایبر", "👥", "followers", 1],
        ["لایک", "❤️", "likes", 2],
        ["ویو", "👁", "views", 3],
        ["کامنت", "💬", "comments", 4]
      ];
    } else if (p.slug === "telegram") {
      cats = [
        ["ممبر", "👥", "followers", 1],
        ["ری‌اکشن", "❤️", "likes", 2],
        ["ویو", "👁", "views", 3],
        ["کامنت", "💬", "comments", 4]
      ];
    } else if (p.slug === "google-maps") {
      cats = [
        ["خدمات Google Maps", "📍", "maps-services", 1]
      ];
    }

    for (const [name, emoji, slug, sortOrder] of cats) {
      await query(
        `INSERT INTO categories (platform_id, name, emoji, slug, sort_order)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (platform_id, slug) DO UPDATE
         SET name = EXCLUDED.name,
             emoji = EXCLUDED.emoji,
             sort_order = EXCLUDED.sort_order`,
        [p.id, name, emoji, slug, sortOrder]
      );
    }
  }
}

export async function ensureUser(from) {
  await query(
    `INSERT INTO users (telegram_id, username, first_name, last_name)
     VALUES ($1, $2, $3, $4)
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
    `SELECT state, data FROM user_sessions WHERE telegram_id = $1`,
    [telegramId]
  );
  return result.rows[0] ?? { state: null, data: {} };
}

export async function setSession(telegramId, state, data = {}) {
  await query(
    `INSERT INTO user_sessions (telegram_id, state, data, updated_at)
     VALUES ($1, $2, $3::jsonb, NOW())
     ON CONFLICT (telegram_id) DO UPDATE
     SET state = EXCLUDED.state,
         data = EXCLUDED.data,
         updated_at = NOW()`,
    [telegramId, state, JSON.stringify(data)]
  );
}

export async function clearSession(telegramId) {
  await query(`DELETE FROM user_sessions WHERE telegram_id = $1`, [telegramId]);
}
