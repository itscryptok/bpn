import pg from 'pg';

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set');
}

function dbNameOf(url) {
  try { return new URL(url).pathname.replace(/^\//, ''); } catch { return ''; }
}

function withDbName(url, name) {
  const u = new URL(url);
  u.pathname = `/${name}`;
  return u.toString();
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function createTables(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS churches (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      city TEXT NOT NULL DEFAULT '',
      registrar_name TEXT NOT NULL,
      registrar_email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      pin CHAR(4),
      sheet_url TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS members (
      id SERIAL PRIMARY KEY,
      church_id INTEGER NOT NULL REFERENCES churches(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      profession TEXT NOT NULL DEFAULT '',
      contact TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS chats (
      id SERIAL PRIMARY KEY,
      church_id INTEGER NOT NULL REFERENCES churches(id) ON DELETE CASCADE,
      group_name TEXT NOT NULL,
      title TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS comments (
      id SERIAL PRIMARY KEY,
      chat_id INTEGER NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
      text TEXT NOT NULL,
      icon_variant INTEGER NOT NULL DEFAULT 1,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_members_church ON members(church_id);
    CREATE INDEX IF NOT EXISTS idx_chats_church_group ON chats(church_id, group_name);
    CREATE INDEX IF NOT EXISTS idx_comments_chat ON comments(chat_id);
    -- Admin-level + per-church config, kept in the database (never hardcoded)
    -- so a future admin board / Google-account change needs no code edits.
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    ALTER TABLE churches ADD COLUMN IF NOT EXISTS google_account_ref TEXT;
    ALTER TABLE churches ADD COLUMN IF NOT EXISTS background_image TEXT;
  `);
}

// One stored background per church, picked at random from these faith-themed
// images when the church registers. The choice lives in the DB so a church's
// card image never reshuffles on reload.
export const CHURCH_BACKGROUNDS = [
  '/img/church-01.webp',
  '/img/church-02.webp',
  '/img/church-03.webp',
  '/img/church-04.webp',
  '/img/church-05.webp',
  '/img/church-06.webp',
  '/img/church-07.webp',
  '/img/church-08.webp',
  '/img/church-09.webp',
  '/img/church-10.webp'
];

export function randomChurchBackground() {
  return CHURCH_BACKGROUNDS[Math.floor(Math.random() * CHURCH_BACKGROUNDS.length)];
}

export async function initDb() {
  try {
    await createTables(pool);
  } catch (err) {
    // The target database may not exist yet (first boot on a shared server):
    // create it from the maintenance database, then retry. This runs inside
    // Render's network, where Postgres SSL works (direct VM connections to
    // Render Postgres are blocked by the egress middlebox).
    if (err.code !== '3D000') throw err;
    const target = dbNameOf(process.env.DATABASE_URL);
    const maintUrl = process.env.MAINTENANCE_DB_URL || withDbName(process.env.DATABASE_URL, 'postgres');
    const maint = new pg.Client({ connectionString: maintUrl, ssl: { rejectUnauthorized: false } });
    await maint.connect();
    await maint.query(`CREATE DATABASE "${target.replace(/"/g, '')}"`);
    await maint.end();
    await createTables(pool);
  }

  // Backfill: churches created before backgrounds existed get a stored random
  // background (idempotent — only touches rows with none assigned).
  const { rows: unassigned } = await pool.query(
    `SELECT id FROM churches WHERE background_image IS NULL OR background_image = ''`
  );
  for (const row of unassigned) {
    await pool.query('UPDATE churches SET background_image = $1 WHERE id = $2', [randomChurchBackground(), row.id]);
  }

  // Seed DB-backed config (only when empty). Groups, copy and toggles live
  // here so a future admin board can edit them without touching code.
  await pool.query(
    `INSERT INTO app_settings (key, value) VALUES ($1, $2::jsonb) ON CONFLICT (key) DO NOTHING`,
    ['professional_groups', JSON.stringify([
      { name: 'Healthcare', emoji: '🩺', color: '#0e7a6b' },
      { name: 'Engineering', emoji: '🏗️', color: '#b7791f' },
      { name: 'Business', emoji: '💼', color: '#1f3a93' },
      { name: 'IT & Technology', emoji: '💻', color: '#0b5fa5' },
      { name: 'Education', emoji: '📚', color: '#7a3fa0' },
      { name: 'Finance', emoji: '💰', color: '#0a6e32' },
      { name: 'Construction', emoji: '👷', color: '#c2570b' },
      { name: 'Legal', emoji: '⚖️', color: '#334155' },
      { name: 'Creative Arts', emoji: '🎨', color: '#c026d3' },
      { name: 'Manufacturing', emoji: '🏭', color: '#475569' },
      { name: 'Hospitality', emoji: '🏨', color: '#be185d' },
      { name: 'Environment & Sustainability', emoji: '🌱', color: '#15803d' },
      { name: 'Government & Public Service', emoji: '🏛️', color: '#1e3a5f' },
      { name: 'Nonprofit & Social Impact', emoji: '🤝', color: '#b45309' }
    ])]
  );
  await pool.query(
    `INSERT INTO app_settings (key, value) VALUES ($1, $2::jsonb) ON CONFLICT (key) DO NOTHING`,
    ['site_copy', JSON.stringify({
      tagline: 'Stronger Together',
      hero_title: 'Believers Professional Network',
      hero_sub: 'Connect. Collaborate. Grow. Make an impact.',
      google_sheet_account: null
    })]
  );
  await pool.query(
    `INSERT INTO app_settings (key, value) VALUES ($1, $2::jsonb) ON CONFLICT (key) DO NOTHING`,
    ['feature_toggles', JSON.stringify({ member_join: true, chat_create: true, comments: true })]
  );
}

export async function getSetting(key) {
  const { rows } = await pool.query('SELECT value FROM app_settings WHERE key = $1', [key]);
  return rows.length ? rows[0].value : null;
}
