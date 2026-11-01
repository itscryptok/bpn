import express from 'express';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';
import { pool, initDb, getSetting, pickDistinctBackground } from './db.js';
import { signToken, verifyToken, signAdminToken, verifyAdminToken } from './auth.js';
import { appendMemberToSheet } from './sheets.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
// 8MB (not 200KB): registrar banner uploads arrive as base64 data URLs, and
// a 5MB image inflates to ~6.7MB of base64. The 5MB cap itself is enforced
// per-upload in parseBannerDataUrl below.
app.use(express.json({ limit: '8mb' }));

const PIN_RE = /^[A-Za-z0-9]{4}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const FALLBACK_GROUPS = [
  'Healthcare', 'Engineering', 'Business', 'IT & Technology', 'Education',
  'Finance', 'Construction', 'Legal', 'Creative Arts', 'Manufacturing',
  'Hospitality', 'Environment & Sustainability', 'Government & Public Service',
  'Nonprofit & Social Impact'
];

async function groupsList() {
  const g = await getSetting('professional_groups');
  if (Array.isArray(g) && g.length) return g;
  return FALLBACK_GROUPS.map((name) => ({ name, emoji: '✦', color: '#1f3a93' }));
}

function publicChurch(row) {
  return {
    id: row.id, name: row.name, city: row.city,
    has_pin: !!row.pin, background_image: row.background_image || null,
    has_banner: !!row.banner_data,
    created_at: row.created_at
  };
}

// Full registrar-facing church object (the /api/me shape). Registration and
// login must return this too: publicChurch() alone omits the registrar's
// own name/email, which rendered "Signed in as ()" until a reload refetched
// /api/me.
function fullChurch(c) {
  return { ...publicChurch(c), registrar_name: c.registrar_name, registrar_email: c.registrar_email, sheet_url: c.sheet_url || null, google_account_ref: c.google_account_ref || null };
}

// Registrar banner uploads: data URLs only (jpg/png/webp), 5MB cap on the
// decoded bytes. Returns normalized { mime, base64 } or throws a 400-ready
// error. Banner bytes live in Postgres (banner_data), never on disk.
const BANNER_MAX_BYTES = 5 * 1024 * 1024;
const BANNER_MIMES = ['image/jpeg', 'image/png', 'image/webp'];
function parseBannerDataUrl(value) {
  if (typeof value !== 'string') throw new Error('Banner must be an image upload.');
  const m = value.match(/^data:(image\/[a-z]+);base64,([A-Za-z0-9+/=\r\n]+)$/);
  if (!m || !BANNER_MIMES.includes(m[1])) throw new Error('Banner must be a JPG, PNG or WebP image.');
  const buf = Buffer.from(m[2], 'base64');
  if (!buf.length || buf.length > BANNER_MAX_BYTES) throw new Error('Banner must be 5MB or smaller.');
  return { mime: m[1], base64: buf.toString('base64') };
}

async function authRegistrar(req, res, next) {
  const id = verifyToken((req.headers.authorization || '').replace(/^Bearer\s+/i, ''));
  if (!id) return res.status(401).json({ error: 'Please log in as church admin.' });
  const { rows } = await pool.query('SELECT * FROM churches WHERE id = $1', [id]);
  if (!rows.length) return res.status(401).json({ error: 'Please log in as church admin.' });
  req.registrar = rows[0];
  next();
}

function requireOwnChurch(req, res, next) {
  if (Number(req.params.id) !== req.registrar.id) {
    return res.status(403).json({ error: 'That church belongs to another church admin.' });
  }
  next();
}

app.get('/api/health', (req, res) => res.json({ ok: true }));

// Public config: groups + copy + toggles come from the DB settings table,
// so a future admin board can edit them without code changes.
app.get('/api/config', async (req, res) => {
  try {
    const groups = await groupsList();
    const copy = (await getSetting('site_copy')) || {};
    const toggles = (await getSetting('feature_toggles')) || {};
    res.json({ groups, copy, toggles });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not load configuration.' });
  }
});

app.get('/api/churches', async (req, res) => {
  try {
    const q = `%${(req.query.q || '').trim()}%`;
    const { rows } = await pool.query(
      `SELECT c.*, (SELECT COUNT(*)::int FROM members m WHERE m.church_id = c.id) AS member_count
       FROM churches c WHERE $1 = '%%' OR c.name ILIKE $1 OR c.city ILIKE $1
       ORDER BY c.created_at DESC`,
      [q]
    );
    res.json(rows.map((r) => ({ ...publicChurch(r), member_count: r.member_count })));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not load churches.' });
  }
});

app.post('/api/churches', async (req, res) => {
  try {
    const { name, city, registrar_name, registrar_email, password, pin, banner_data_url } = req.body || {};
    if (!name?.trim() || !registrar_name?.trim() || !EMAIL_RE.test(registrar_email || '') || !password || password.length < 6) {
      return res.status(400).json({ error: 'Church name, church admin name, a valid email and a password of 6+ characters are required.' });
    }
    const connectCode = String(pin || '').trim().toUpperCase();
    if (!PIN_RE.test(connectCode)) {
      return res.status(400).json({ error: 'A connect code of exactly 4 letters or numbers is required.' });
    }
    let banner = null;
    if (banner_data_url) {
      try { banner = parseBannerDataUrl(banner_data_url); }
      catch (err) { return res.status(400).json({ error: err.message }); }
    }
    const hash = await bcrypt.hash(password, 10);
    const { rows: existing } = await pool.query('SELECT background_image FROM churches');
    const { rows } = await pool.query(
      `INSERT INTO churches (name, city, registrar_name, registrar_email, password_hash, pin, background_image, banner_data, banner_mime)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [name.trim(), (city || '').trim(), registrar_name.trim(), registrar_email.trim().toLowerCase(), hash, connectCode,
       pickDistinctBackground(existing.map((r) => r.background_image)), banner?.base64 || null, banner?.mime || null]
    );
    const church = rows[0];
    // Test-church auto-cleanup (ARMED, conditional): once FOUR churches
    // OTHER than the three test churches exist, delete the test churches
    // and their dependent data. Test churches never count toward the four,
    // and nothing is deleted before that threshold — right now all churches
    // are test ones, so this must not fire yet. Runs after every successful
    // registration, so cleanup happens the moment the fourth non-test
    // church registers. A cleanup failure must never fail the registration.
    try {
      const TEST_CHURCH_NAMES = ['Sample Grace Fellowship', 'Sample Believers Love World', 'Sample Rock City Church'];
      const { rows: cnt } = await pool.query(
        `SELECT COUNT(*)::int AS n FROM churches WHERE NOT (name = ANY($1))`, [TEST_CHURCH_NAMES]
      );
      if (cnt[0].n >= 4) {
        const { rows: doomed } = await pool.query(`SELECT id FROM churches WHERE name = ANY($1)`, [TEST_CHURCH_NAMES]);
        const ids = doomed.map((r) => r.id);
        if (ids.length) {
          // Explicit deletes in dependency order (works whether or not the
          // live tables' ON DELETE CASCADE clauses predate them).
          await pool.query(`DELETE FROM comments WHERE chat_id IN (SELECT id FROM chats WHERE church_id = ANY($1))`, [ids]);
          await pool.query(`DELETE FROM chats WHERE church_id = ANY($1)`, [ids]);
          await pool.query(`DELETE FROM announcements WHERE church_id = ANY($1)`, [ids]);
          await pool.query(`DELETE FROM members WHERE church_id = ANY($1)`, [ids]);
          await pool.query(`DELETE FROM churches WHERE id = ANY($1)`, [ids]);
          console.log(`Test-church auto-cleanup ran: removed ${ids.length} test church(es) now that ${cnt[0].n} non-test churches exist.`);
        }
      }
    } catch (cleanupErr) {
      console.error('Test-church auto-cleanup failed (registration itself succeeded):', cleanupErr);
    }
    res.status(201).json({ church: fullChurch(church), token: signToken(church.id) });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'That church admin email is already registered.' });
    console.error(err);
    res.status(500).json({ error: 'Registration failed. Please try again.' });
  }
});

// Public: serve a church's uploaded banner (stored in Postgres). Churches
// without one get 404 — the UI then shows the default letter tile.
app.get('/api/churches/:id/banner', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT banner_data, banner_mime FROM churches WHERE id = $1', [req.params.id]);
    if (!rows.length || !rows[0].banner_data) return res.status(404).json({ error: 'This church has no banner image.' });
    res.setHeader('Content-Type', rows[0].banner_mime || 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.send(Buffer.from(rows[0].banner_data, 'base64'));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not load banner.' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body || {};
    const { rows } = await pool.query('SELECT * FROM churches WHERE registrar_email = $1', [(email || '').trim().toLowerCase()]);
    if (!rows.length || !(await bcrypt.compare(password || '', rows[0].password_hash))) {
      return res.status(401).json({ error: 'Email or password is incorrect.' });
    }
    res.json({ church: fullChurch(rows[0]), token: signToken(rows[0].id) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Login failed. Please try again.' });
  }
});

app.get('/api/me', authRegistrar, (req, res) => {
  const c = req.registrar;
  res.json({ church: fullChurch(c) });
});

// Registrar: create / change the 4-character connect code. The code is
// normalized (trimmed, uppercased) before the spec check, so a code typed
// with surrounding whitespace or in lowercase is still accepted; unlock and
// join already compare case-insensitively, so stored case is consistent.
app.post('/api/churches/:id/pin', authRegistrar, requireOwnChurch, async (req, res) => {
  const pin = String(req.body?.pin || '').trim().toUpperCase();
  if (!PIN_RE.test(pin)) return res.status(400).json({ error: 'Connect code must be exactly 4 letters or numbers.' });
  await pool.query('UPDATE churches SET pin = $1 WHERE id = $2', [pin, req.registrar.id]);
  res.json({ ok: true });
});

// Registrar: replace the church banner (upload) or remove it (falls back
// to the default letter tile). Own church only.
app.post('/api/churches/:id/banner', authRegistrar, requireOwnChurch, async (req, res) => {
  try {
    let banner;
    try { banner = parseBannerDataUrl(req.body?.banner_data_url); }
    catch (err) { return res.status(400).json({ error: err.message }); }
    await pool.query('UPDATE churches SET banner_data = $1, banner_mime = $2 WHERE id = $3',
      [banner.base64, banner.mime, req.registrar.id]);
    res.json({ ok: true, has_banner: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not save banner.' });
  }
});

app.delete('/api/churches/:id/banner', authRegistrar, requireOwnChurch, async (req, res) => {
  try {
    await pool.query('UPDATE churches SET banner_data = NULL, banner_mime = NULL WHERE id = $1', [req.registrar.id]);
    res.json({ ok: true, has_banner: false });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not remove banner.' });
  }
});

// Church announcements: posted by the owning church's admin only (auth +
// own-church guard, same as connect code/banner), displayed publicly per church,
// newest first. Image (optional) uses the same validation as banners:
// JPG/PNG/WebP, 5MB cap, stored in Postgres, never on disk.
app.get('/api/churches/:id/announcements', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, church_id, title, details, (image_data IS NOT NULL) AS has_image, created_at
       FROM announcements WHERE church_id = $1 ORDER BY created_at DESC`,
      [req.params.id]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not load announcements.' });
  }
});

app.get('/api/announcements/:id/image', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT image_data, image_mime FROM announcements WHERE id = $1', [req.params.id]);
    if (!rows.length || !rows[0].image_data) return res.status(404).json({ error: 'This announcement has no image.' });
    res.setHeader('Content-Type', rows[0].image_mime || 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.send(Buffer.from(rows[0].image_data, 'base64'));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not load announcement image.' });
  }
});

app.delete('/api/churches/:id/announcements/:annId', authRegistrar, requireOwnChurch, async (req, res) => {
  try {
    // Own-church guard (requireOwnChurch) plus a church_id filter, so an
    // admin can only ever delete their own church's announcements.
    const { rows } = await pool.query(
      'DELETE FROM announcements WHERE id = $1 AND church_id = $2 RETURNING id',
      [req.params.annId, req.registrar.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Announcement not found.' });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not remove the announcement.' });
  }
});

app.post('/api/churches/:id/announcements', authRegistrar, requireOwnChurch, async (req, res) => {
  try {
    const { title, details, image_data_url } = req.body || {};
    if (!title?.trim() || !details?.trim()) {
      return res.status(400).json({ error: 'An announcement title and details are required.' });
    }
    let image = null;
    if (image_data_url) {
      try { image = parseBannerDataUrl(image_data_url); }
      catch (err) { return res.status(400).json({ error: err.message.replace(/^Banner/, 'Announcement image') }); }
    }
    const { rows } = await pool.query(
      `INSERT INTO announcements (church_id, title, details, image_data, image_mime)
       VALUES ($1, $2, $3, $4, $5) RETURNING id, church_id, title, details, (image_data IS NOT NULL) AS has_image, created_at`,
      [req.registrar.id, title.trim(), details.trim(), image?.base64 || null, image?.mime || null]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not post the announcement.' });
  }
});

// Public: check a connect code to unlock a church area (never reveals the code).
app.post('/api/churches/:id/unlock', async (req, res) => {
  const { rows } = await pool.query('SELECT pin FROM churches WHERE id = $1', [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'Church not found.' });
  if (!rows[0].pin) return res.status(400).json({ error: 'This church has no connect code yet — ask its church admin for the connect code.' });
  if (String(req.body?.pin || '').toUpperCase() !== rows[0].pin.toUpperCase()) {
    return res.status(403).json({ error: 'That code is incorrect. Please check with your church admin.' });
  }
  res.json({ ok: true });
});

// Member join: NO login, but the connect code is verified server-side. Never trust the client unlock alone.
app.post('/api/churches/:id/members', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM churches WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Church not found.' });
    const church = rows[0];
    if (!church.pin || String(req.body?.pin || '').toUpperCase() !== church.pin.toUpperCase()) {
      return res.status(403).json({ error: 'A correct connect code is required to join.' });
    }
    const { name, profession, contact } = req.body || {};
    if (!name?.trim()) return res.status(400).json({ error: 'Please add your name.' });
    const m = await pool.query(
      `INSERT INTO members (church_id, name, profession, contact) VALUES ($1, $2, $3, $4) RETURNING *`,
      [church.id, name.trim(), (profession || '').trim(), (contact || '').trim()]
    );
    const member = m.rows[0];
    // Fire-and-forget Sheets append (gated on service-account key + sheet link).
    appendMemberToSheet({ sheetUrl: church.sheet_url, member }).catch(() => {});
    res.status(201).json({ ok: true, member: { id: member.id, name: member.name } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not complete registration. Please try again.' });
  }
});

app.get('/api/churches/:id/chats', async (req, res) => {
  try {
    const group = req.query.group || '';
    const groups = await groupsList();
    if (group && !groups.some((g) => g.name === group)) return res.status(400).json({ error: 'Unknown professional group.' });
    const { rows } = await pool.query(
      `SELECT ch.*, (SELECT COUNT(*)::int FROM comments cm WHERE cm.chat_id = ch.id) AS comment_count
       FROM chats ch WHERE ch.church_id = $1 AND ($2 = '' OR ch.group_name = $2) ORDER BY ch.created_at DESC`,
      [req.params.id, group]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not load chats.' });
  }
});

app.post('/api/churches/:id/chats', async (req, res) => {
  try {
    const groups = await groupsList();
    const { group, title, opening_message } = req.body || {};
    if (!groups.some((g) => g.name === group)) return res.status(400).json({ error: 'Please pick a professional group.' });
    if (!title?.trim() || !opening_message?.trim()) return res.status(400).json({ error: 'A chat title and an opening message are required.' });
    const { rows } = await pool.query(
      'INSERT INTO chats (church_id, group_name, title) VALUES ($1, $2, $3) RETURNING *',
      [req.params.id, group, title.trim()]
    );
    const chat = rows[0];
    await pool.query('INSERT INTO comments (chat_id, text, icon_variant) VALUES ($1, $2, $3)',
      [chat.id, opening_message.trim(), 1 + Math.floor(Math.random() * 7)]);
    res.status(201).json(chat);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not create the chat.' });
  }
});

app.get('/api/chats/:id', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM chats WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Chat not found.' });
    const comments = await pool.query('SELECT * FROM comments WHERE chat_id = $1 ORDER BY created_at ASC', [req.params.id]);
    res.json({ chat: rows[0], comments: comments.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not load the chat.' });
  }
});

// Comments: no sign-in, no real names. Server assigns a random icon variant 1-7;
// the UI always shows the word "member" in the name spot.
app.post('/api/chats/:id/comments', async (req, res) => {
  try {
    const { text } = req.body || {};
    if (!text?.trim()) return res.status(400).json({ error: 'Please write a comment first.' });
    const { rows } = await pool.query(
      'INSERT INTO comments (chat_id, text, icon_variant) VALUES ($1, $2, $3) RETURNING *',
      [req.params.id, text.trim(), 1 + Math.floor(Math.random() * 7)]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not post the comment.' });
  }
});

// Registrar: member list (own church only).
app.get('/api/churches/:id/members', authRegistrar, requireOwnChurch, async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM members WHERE church_id = $1 ORDER BY created_at DESC', [req.registrar.id]);
  res.json(rows);
});

// Registrar: link / change the church's Google Sheet (stored in DB, never in code).
// google_account_ref records WHICH Google account the sheet belongs to, so a
// future account change is a data edit, not a code change.
app.post('/api/churches/:id/sheet', authRegistrar, requireOwnChurch, async (req, res) => {
  const { sheet_url, google_account_ref } = req.body || {};
  await pool.query('UPDATE churches SET sheet_url = $1, google_account_ref = $2 WHERE id = $3',
    [(sheet_url || '').trim() || null, (google_account_ref || '').trim() || null, req.registrar.id]);
  res.json({ ok: true });
});

app.get('/api/churches/:id/members.csv', authRegistrar, requireOwnChurch, async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM members WHERE church_id = $1 ORDER BY created_at ASC', [req.registrar.id]);
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = ['Name,Profession,Contact,Joined', ...rows.map((m) => [m.name, m.profession, m.contact, m.created_at].map(esc).join(','))].join('\n');
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="bpn-members.csv"');
  res.send(csv);
});

// ---------- /addy admin area (foundation only — no CMS editing in this round) ----------
// Admin auth never hardcodes a password. Precedence:
//  1. ADMIN_PASSWORD env var, when set (compared in constant time).
//  2. Otherwise a single admin password hash stored in app_settings, created
//     through the one-time setup form on first visit to /addy.
// The password is never logged, never returned by any endpoint, never in code.
async function adminConfigured() {
  if (process.env.ADMIN_PASSWORD) return true;
  const hash = await getSetting('admin_password_hash');
  return !!hash;
}

function adminAuthed(req) {
  return verifyAdminToken((req.headers.authorization || '').replace(/^Bearer\s+/i, ''));
}

app.get('/api/admin/status', async (req, res) => {
  res.json({ configured: await adminConfigured() });
});

app.post('/api/admin/setup', async (req, res) => {
  try {
    if (await adminConfigured()) return res.status(409).json({ error: 'An admin password is already set.' });
    const { password } = req.body || {};
    if (!password || password.length < 8) return res.status(400).json({ error: 'Please choose a password of 8+ characters.' });
    const hash = await bcrypt.hash(password, 10);
    await pool.query(
      `INSERT INTO app_settings (key, value) VALUES ('admin_password_hash', $1::jsonb)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
      [JSON.stringify(hash)]
    );
    res.json({ ok: true, token: signAdminToken() });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Setup failed. Please try again.' });
  }
});

app.post('/api/admin/login', async (req, res) => {
  try {
    const { password } = req.body || {};
    const envPw = process.env.ADMIN_PASSWORD;
    let ok = false;
    if (envPw) {
      const a = Buffer.from(password || '');
      const b = Buffer.from(envPw);
      ok = a.length === b.length && crypto.timingSafeEqual(a, b);
    } else {
      const hash = await getSetting('admin_password_hash');
      if (hash) ok = await bcrypt.compare(password || '', hash);
    }
    if (!ok) return res.status(401).json({ error: 'Admin password is incorrect.' });
    res.json({ ok: true, token: signAdminToken() });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Login failed. Please try again.' });
  }
});

// Read-only overview for the future CMS board: counts + per-church Sheet
// connection status (sheet_url / google_account_ref live in the DB).
app.get('/api/admin/overview', async (req, res) => {
  if (!adminAuthed(req)) return res.status(401).json({ error: 'Admin login required.' });
  const churches = await pool.query(
    `SELECT c.id, c.name, c.city, c.sheet_url, c.google_account_ref,
       (SELECT COUNT(*)::int FROM members m WHERE m.church_id = c.id) AS member_count,
       (SELECT COUNT(*)::int FROM chats ch WHERE ch.church_id = c.id) AS chat_count
     FROM churches c ORDER BY c.created_at DESC`
  );
  const totals = await pool.query(
    'SELECT (SELECT COUNT(*)::int FROM churches) AS churches, (SELECT COUNT(*)::int FROM members) AS members, (SELECT COUNT(*)::int FROM chats) AS chats, (SELECT COUNT(*)::int FROM comments) AS comments'
  );
  const groups = await groupsList();
  res.json({ totals: totals.rows[0], churches: churches.rows, group_count: groups.length });
});

// /addy admin only: delete a church. Members, chats, comments, and
// announcements go with it via the ON DELETE CASCADE foreign keys.
// Confirmation happens in the /addy UI; the endpoint itself requires a
// valid admin token, so a church-admin token (or no token) can never
// delete a church.
app.delete('/api/admin/churches/:id', async (req, res) => {
  if (!adminAuthed(req)) return res.status(401).json({ error: 'Admin login required.' });
  try {
    const { rows } = await pool.query('DELETE FROM churches WHERE id = $1 RETURNING id, name', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Church not found.' });
    res.json({ ok: true, deleted: rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not delete the church.' });
  }
});

// Static frontend + SPA fallback.
const dist = path.join(__dirname, '..', 'dist');
app.use(express.static(dist));
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found.' });
  res.sendFile(path.join(dist, 'index.html'));
});

const PORT = process.env.PORT || 3000;
initDb().then(() => {
  app.listen(PORT, '0.0.0.0', () => console.log(`BPN listening on ${PORT}`));
}).catch((err) => {
  console.error('Database init failed', err);
  process.exit(1);
});
