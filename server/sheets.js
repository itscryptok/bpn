// Google Sheets append hook, gated on GOOGLE_SERVICE_ACCOUNT_JSON.
// No key configured => no-op (the UI says so honestly instead of pretending).
// When configured, appends one member row to the church's sheet via the
// Sheets API using a service-account JWT. The sheet must be shared with the
// service-account email for writes to succeed.

function b64uJson(obj) {
  return Buffer.from(JSON.stringify(obj)).toString('base64url');
}

async function getAccessToken(sa) {
  const header = b64uJson({ alg: 'RS256', typ: 'JWT' });
  const now = Math.floor(Date.now() / 1000);
  const claim = b64uJson({
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now
  });
  const { createSign } = await import('node:crypto');
  const signer = createSign('RSA-SHA256');
  signer.update(`${header}.${claim}`);
  signer.end();
  const sig = signer.sign(sa.private_key, 'base64url');
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${header}.${claim}.${sig}`
    })
  });
  if (!res.ok) throw new Error(`token exchange failed: ${res.status}`);
  const data = await res.json();
  return data.access_token;
}

export function sheetIdFromUrl(url) {
  const m = String(url || '').match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  return m ? m[1] : null;
}

export async function appendMemberToSheet({ sheetUrl, member }) {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  const sheetId = sheetIdFromUrl(sheetUrl);
  if (!raw || !sheetId) return { skipped: true };
  try {
    const sa = JSON.parse(raw);
    const token = await getAccessToken(sa);
    const res = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/A1:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          values: [[member.name, member.profession, member.contact, member.best_time, member.interesting_facts, member.created_at]]
        })
      }
    );
    if (!res.ok) {
      console.error('Sheets append failed', res.status);
      return { skipped: false, ok: false };
    }
    return { skipped: false, ok: true };
  } catch (err) {
    console.error('Sheets append error', err.message);
    return { skipped: false, ok: false };
  }
}
