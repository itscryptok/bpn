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
    -- Registrar-uploaded church banner, stored durably in Postgres (never on
    -- local disk — Render's free-tier filesystem is ephemeral). banner_data
    -- is base64 image bytes; banner_mime is its content type.
    ALTER TABLE churches ADD COLUMN IF NOT EXISTS banner_data TEXT;
    ALTER TABLE churches ADD COLUMN IF NOT EXISTS banner_mime TEXT;
  `);
}

// Fresh AI-designed church-card backdrops (second set — the first set's
// church-01..10 files are retired and no longer referenced). Each church
// keeps one stored backdrop so its card never reshuffles on reload.
export const CHURCH_BACKGROUNDS = [
  '/img/church2-01.webp',
  '/img/church2-02.webp',
  '/img/church2-03.webp',
  '/img/church2-04.webp',
  '/img/church2-05.webp',
  '/img/church2-06.webp',
  '/img/church2-07.webp',
  '/img/church2-08.webp',
  '/img/church2-09.webp',
  '/img/church2-10.webp',
  '/img/church2-11.webp',
  '/img/church2-12.webp'
];

// Distinct assignment (hard rule): prefer a backdrop no church uses yet;
// only when the whole pool is in use, reuse the least-used one. `used` is
// the list of background_image values currently stored on churches.
export function pickDistinctBackground(used = []) {
  const counts = new Map();
  for (const u of used) counts.set(u, (counts.get(u) || 0) + 1);
  const unused = CHURCH_BACKGROUNDS.filter((b) => !counts.has(b));
  if (unused.length) return unused[Math.floor(Math.random() * unused.length)];
  let min = Infinity;
  for (const b of CHURCH_BACKGROUNDS) min = Math.min(min, counts.get(b) || 0);
  const least = CHURCH_BACKGROUNDS.filter((b) => (counts.get(b) || 0) === min);
  return least[Math.floor(Math.random() * least.length)];
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

  // Backfill + distinctness enforcement (idempotent): every church ends up
  // with a distinct backdrop from the current pool. Churches with no
  // backdrop, a backdrop from the retired first set, or a backdrop another
  // church already uses are reassigned (oldest church first). Uploaded
  // banners are untouched — this only governs the default backdrop.
  const { rows: allChurches } = await pool.query(
    `SELECT id, background_image FROM churches ORDER BY created_at ASC, id ASC`
  );
  const usedBackdrops = [];
  for (const row of allChurches) {
    const bg = row.background_image || '';
    if (bg && CHURCH_BACKGROUNDS.includes(bg) && !usedBackdrops.includes(bg)) {
      usedBackdrops.push(bg);
      continue;
    }
    const next = pickDistinctBackground(usedBackdrops);
    usedBackdrops.push(next);
    await pool.query('UPDATE churches SET background_image = $1 WHERE id = $2', [next, row.id]);
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
