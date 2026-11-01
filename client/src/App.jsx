import React, { useEffect, useRef, useState } from 'react';
import { PersonIcon } from './avatars.jsx';

const api = async (path, opts = {}) => {
  // NOTE: opts must NOT be spread after `headers` — spreading it last used
  // to overwrite the merged headers with opts.headers alone, silently
  // dropping Content-Type on every authenticated call. Express's json()
  // then ignored the body, so authenticated POSTs (PIN, banner, sheet)
  // arrived with an empty body and failed validation for every input.
  const { headers, ...rest } = opts;
  const res = await fetch(path, { headers: { 'Content-Type': 'application/json', ...(headers || {}) }, ...rest });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Something went wrong.');
  return data;
};

// Theme-matched graphic for each professional group, reused by the group
// cards and by the chat cards of that group. (Member icons stay comment-only.)
const GROUP_IMAGES = {
  'Healthcare': '/img/group-healthcare.webp',
  'Engineering': '/img/group-engineering.webp',
  'Business': '/img/group-business.webp',
  'IT & Technology': '/img/group-it-technology.webp',
  'Education': '/img/group-education.webp',
  'Finance': '/img/group-finance.webp',
  'Construction': '/img/group-construction.webp',
  'Legal': '/img/group-legal.webp',
  'Creative Arts': '/img/group-creative-arts.webp',
  'Manufacturing': '/img/group-manufacturing.webp',
  'Hospitality': '/img/group-hospitality.webp',
  'Environment & Sustainability': '/img/group-environment.webp',
  'Government & Public Service': '/img/group-government.webp',
  'Nonprofit & Social Impact': '/img/group-nonprofit.webp'
};

// Safety net for churches that predate stored backgrounds; the server
// backfills real values, so this should rarely be seen.
const FALLBACK_CHURCH_BG = '/img/church2-01.webp';

// First letter of the first word of a church name, for the monogram tile.
function firstLetter(name) {
  const first = String(name || '').trim().split(/\s+/)[0] || '';
  return first ? first[0].toUpperCase() : 'B';
}

// Church card visual: the registrar's uploaded banner wins; otherwise a
// monogram tile — the church's first letter over its distinct stored
// backdrop image. (Member icons stay comment-only and are never used here.)
function ChurchVisual({ church }) {
  if (church.has_banner) {
    return (<span className="church-banner"><img src={`/api/churches/${church.id}/banner`} alt="" loading="lazy" /></span>);
  }
  return (
    <span className="church-banner monogram">
      <img src={church.background_image || FALLBACK_CHURCH_BG} alt="" loading="lazy" />
      <span className="monogram-letter" aria-hidden="true">{firstLetter(church.name)}</span>
    </span>
  );
}

// Registrar banner uploads: JPG/PNG/WebP only, 5MB cap, checked in the
// browser before anything is sent (the server re-checks both).
const BANNER_MAX_BYTES = 5 * 1024 * 1024;
const BANNER_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
function bannerFileError(file) {
  if (!file) return '';
  if (!BANNER_TYPES.includes(file.type)) return 'Please choose a JPG, PNG or WebP image.';
  if (file.size > BANNER_MAX_BYTES) return 'That image is over 5MB — please choose a smaller one.';
  return '';
}
function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(new Error('Could not read that image.'));
    r.readAsDataURL(file);
  });
}

function relTime(iso) {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'now';
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

function Info({ text }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="info-wrap">
      <button type="button" className="info-btn" aria-label="What does this mean?" onClick={() => setOpen(!open)}>ⓘ</button>
      {open && <span className="info-tip">{text}</span>}
    </span>
  );
}

function Field({ label, ...props }) {
  return (
    <label className="field">
      <span>{label}</span>
      <input {...props} />
    </label>
  );
}

export default function App() {
  const [view, setView] = useState(window.location.pathname.startsWith('/addy') ? 'admin' : window.location.pathname === '/register-church' ? 'register' : 'home');
  const [config, setConfig] = useState({ groups: [], copy: {}, toggles: {} });
  const [churches, setChurches] = useState([]);
  const [query, setQuery] = useState('');
  const [church, setChurch] = useState(null);
  const [unlocked, setUnlocked] = useState(false);
  const [group, setGroup] = useState(null);
  const [chats, setChats] = useState([]);
  const [chat, setChat] = useState(null);
  const [comments, setComments] = useState([]);
  const [registrar, setRegistrar] = useState(null);
  const [members, setMembers] = useState([]);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [admin, setAdmin] = useState(null);
  const [adminConfigured, setAdminConfigured] = useState(null);
  const [showBenefits, setShowBenefits] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [bannerFile, setBannerFile] = useState(null);
  const [bannerPreview, setBannerPreview] = useState('');
  const [bannerError, setBannerError] = useState('');
  const [dashBannerFile, setDashBannerFile] = useState(null);
  const [dashBannerPreview, setDashBannerPreview] = useState('');
  const [dashBannerMsg, setDashBannerMsg] = useState('');
  const commentBox = useRef(null);

  const go = (v) => {
    setView(v); setError(''); setNotice('');
    window.scrollTo(0, 0);
    if (v === 'admin') window.history.pushState({}, '', '/addy');
    else if (v === 'register') window.history.pushState({}, '', '/register-church');
    else if (window.location.pathname.startsWith('/addy') || window.location.pathname === '/register-church') window.history.pushState({}, '', '/');
  };

  const loadChurches = async (q = '') => {
    try { setChurches(await api(`/api/churches?q=${encodeURIComponent(q)}`)); } catch { /* show empty */ }
  };

  useEffect(() => { api('/api/config').then(setConfig).catch(() => {}); loadChurches(); }, []);
  useEffect(() => { loadChurches(query); }, [query]);

  useEffect(() => {
    const t = localStorage.getItem('bpn_token');
    if (t) api('/api/me', { headers: { Authorization: `Bearer ${t}` } }).then((d) => setRegistrar(d.church)).catch(() => localStorage.removeItem('bpn_token'));
    const a = localStorage.getItem('bpn_admin_token');
    if (a && view === 'admin') api('/api/admin/overview', { headers: { Authorization: `Bearer ${a}` } }).then(setAdmin).catch(() => localStorage.removeItem('bpn_admin_token'));
  }, []);

  useEffect(() => {
    if (view === 'admin' && adminConfigured === null) api('/api/admin/status').then((d) => setAdminConfigured(d.configured)).catch(() => {});
  }, [view]);

  const authHeaders = () => ({ Authorization: `Bearer ${localStorage.getItem('bpn_token') || ''}` });

  async function submit(e, fn) {
    e.preventDefault(); setError(''); setNotice('');
    try { await fn(new FormData(e.target)); } catch (err) { setError(err.message); }
  }

  const openChurch = (c) => { setChurch(c); setUnlocked(false); setGroup(null); go('pin'); };

  const loadChats = async (g) => {
    const list = await api(`/api/churches/${church.id}/chats?group=${encodeURIComponent(g.name)}`);
    setChats(list); setGroup(g); go('chats');
  };

  const loadChat = async (c) => {
    const d = await api(`/api/chats/${c.id}`);
    setChat(d.chat); setComments(d.comments); go('chat');
  };

  const loadMembers = async () => {
    const list = await api(`/api/churches/${registrar.id}/members`, { headers: authHeaders() });
    setMembers(list); go('members');
  };

  const groups = config.groups || [];

  return (
    <div className="app">
      <header className="topbar">
        <button className="logo" onClick={() => go('home')}>
          <span className="logo-mark">✦</span>
          <span><b>BPN</b> Believers Professional Network</span>
        </button>
        <nav>
          {registrar && (
            <button onClick={() => go('dashboard')}>My churches</button>
          )}
        </nav>
        <button type="button" className="burger-btn" aria-label="Open menu" aria-expanded={showMenu} onClick={() => setShowMenu(true)}>☰</button>
      </header>

      {showMenu && (
        <div className="menu-backdrop" onClick={() => setShowMenu(false)}>
          <div className="menu-panel" role="menu" aria-label="Site menu" onClick={(e) => e.stopPropagation()}>
            <button type="button" className="menu-close" aria-label="Close menu" onClick={() => setShowMenu(false)}>✕</button>
            <button type="button" onClick={() => { setShowMenu(false); go('register'); }}>Register your church</button>
            <button type="button" onClick={() => { setShowMenu(false); setShowBenefits(true); }}>The Benefits</button>
            <a href="https://cryptok.online" target="_blank" rel="noreferrer" onClick={() => setShowMenu(false)}>Build your pro website ↗</a>
            <button type="button" onClick={() => { setShowMenu(false); go('login'); }}>Registrar login</button>
          </div>
        </div>
      )}

      {showBenefits && (
        <div className="modal-backdrop" onClick={() => setShowBenefits(false)}>
          <div className="modal-card" role="dialog" aria-modal="true" aria-label="The Benefits" onClick={(e) => e.stopPropagation()}>
            <button type="button" className="modal-close" aria-label="Close" onClick={() => setShowBenefits(false)}>✕</button>
            <h2>The Benefits</h2>
            <ul>
              <li>Engage with other professionals, anonymously</li>
              <li>Post a link for others to join a group on WhatsApp</li>
              <li>Post a new opportunity you are aware of</li>
              <li>Discuss workplace lifestyle built on godly principles</li>
              <li>Encourage someone</li>
              <li>Share information</li>
            </ul>
          </div>
        </div>
      )}

      {error && <div className="alert err">{error}</div>}
      {notice && <div className="alert ok">{notice}</div>}

      {view === 'home' && (
        <main>
          <img className="home-banner" src="/img/banner.jpg" alt="Believers Professional Network — Stronger Together. Connect, Collaborate, Grow, Make an impact." />
          <p className="find-tagline">Connect. Collaborate. Make impact.</p>
          <p className="find-subline">no sign-up needed</p>

          <section className="search-zone">
            <label>Find your church</label>
            <input
              value={query} onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by church name or city…" aria-label="Search churches"
            />
            <Info text="Type your church name. Tap its card, then enter the 4-character code your church registrar gave you." />
          </section>

          {churches.length === 0 ? (
            <section className="empty">
              <div className="empty-art">⛪</div>
              <h2>No churches registered yet</h2>
              <p>Be the first — register your church and invite your members in.</p>
              <button className="gold-btn" onClick={() => go('register')}>Register your church</button>
            </section>
          ) : (
            <section className="church-grid">
              {churches.map((c) => (
                <button key={c.id} className="church-card" onClick={() => openChurch(c)}>
                  <ChurchVisual church={c} />
                  <span className="church-name">{c.name}</span>
                  <span className="church-meta">{c.city || '—'} · {c.member_count} member{c.member_count === 1 ? '' : 's'}</span>
                  <span className="church-cta">Enter with member code →</span>
                </button>
              ))}
            </section>
          )}
          <footer><a href="/addy">Admin</a> · Believers Professional Network · Stronger Together</footer>
        </main>
      )}

      {view === 'register' && (
        <main className="narrow">
          <h1>Register your church</h1>
          <p className="muted">You become this church's registrar. <Info text="The registrar is the person who manages the church on BPN: they set the member code and see the member list." /></p>
          <form onSubmit={(e) => submit(e, async (f) => {
            const payload = Object.fromEntries(f);
            if (bannerFile) payload.banner_data_url = await fileToDataUrl(bannerFile);
            const d = await api('/api/churches', { method: 'POST', body: JSON.stringify(payload) });
            localStorage.setItem('bpn_token', d.token); setRegistrar(d.church); loadChurches();
            setNotice('Church registered. Now set your 4-character member code.'); go('dashboard');
          })}>
            <Field label="Church name" name="name" required />
            <Field label="City" name="city" />
            <Field label="Your name (registrar)" name="registrar_name" required />
            <Field label="Your email" name="registrar_email" type="email" required />
            <Field label="Password (6+ characters)" name="password" type="password" required minLength={6} />
            <label className="field">
              <span>Upload an image banner for your church (optional)</span>
              <input type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => {
                const file = e.target.files[0] || null;
                const err = bannerFileError(file);
                setBannerError(err);
                if (err || !file) { setBannerFile(null); setBannerPreview(''); return; }
                setBannerFile(file);
                setBannerPreview(URL.createObjectURL(file));
              }} />
            </label>
            {bannerError && <p className="alert err">{bannerError}</p>}
            {bannerPreview && (
              <div className="banner-preview">
                <img src={bannerPreview} alt="Banner preview" />
                <p>Banner ready: {bannerFile.name} ({Math.round(bannerFile.size / 1024)} KB) — it will be shown on your church card and on your professional groups page.</p>
              </div>
            )}
            <button className="gold-btn big">Register church</button>
          </form>
        </main>
      )}

      {view === 'login' && (
        <main className="narrow">
          <h1>Registrar login</h1>
          <form onSubmit={(e) => submit(e, async (f) => {
            const d = await api('/api/auth/login', { method: 'POST', body: JSON.stringify(Object.fromEntries(f)) });
            localStorage.setItem('bpn_token', d.token); setRegistrar(d.church); go('dashboard');
          })}>
            <Field label="Email" name="email" type="email" required />
            <Field label="Password" name="password" type="password" required />
            <button className="gold-btn big">Log in</button>
          </form>
        </main>
      )}

      {view === 'pin' && church && (
        <main className="narrow">
          <button className="back" onClick={() => go('home')}>← All churches</button>
          <h1>{church.name}</h1>
          <p className="muted">{church.city} <Info text="Members need the code from their church registrar to enter this church's area." /></p>
          {!church.has_pin ? (
            <p className="alert err">This church has no member code yet — ask its registrar to set one.</p>
          ) : (
            <form onSubmit={(e) => submit(e, async (f) => {
              await api(`/api/churches/${church.id}/unlock`, { method: 'POST', body: JSON.stringify({ pin: f.get('pin') }) });
              setUnlocked(true); go('groups');
            })}>
              <Field label="Member code (4 letters or numbers)" name="pin" required maxLength={4} autoFocus placeholder="e.g. A3K9" />
              <button className="gold-btn big">Enter</button>
            </form>
          )}
        </main>
      )}

      {view === 'groups' && church && unlocked && (
        <main>
          <button className="back" onClick={() => go('home')}>← All churches</button>
          <span className="groups-header-banner">
            {church.has_banner
              ? <img src={`/api/churches/${church.id}/banner`} alt="" />
              : <img src={church.background_image || FALLBACK_CHURCH_BG} alt="" />}
          </span>
          <h1>{church.name} <span className="muted">· Professional groups</span></h1>
          <div className="join-row">
            <button className="gold-btn" onClick={() => go('join')}>Join a group <Info text="Joining needs no login — just your name, profession and the member code." /></button>
            <button className="gold-btn outline" onClick={() => setShowBenefits(true)}>The Benefits</button>
          </div>
          <div className="carousel" aria-label="Professional groups">
            {groups.map((g) => (
              <button key={g.name} className="group-card" onClick={() => loadChats(g)}>
                <span className="group-img"><img src={GROUP_IMAGES[g.name]} alt="" loading="lazy" /></span>
                <span className="group-name">{g.name}</span>
                <span className="group-cta">Open chats →</span>
              </button>
            ))}
          </div>
          <p className="muted swipe-hint">← Swipe to see all {groups.length} groups →</p>
        </main>
      )}

      {view === 'join' && church && (
        <main className="narrow">
          <button className="back" onClick={() => go('groups')}>← Groups</button>
          <h1>Join {church.name}</h1>
          <p className="muted">No login needed. <Info text="Your details go to your church's member list, which the registrar can view (and link to a Google Sheet). Comments you post later show only as 'member'." /></p>
          <form onSubmit={(e) => submit(e, async (f) => {
            await api(`/api/churches/${church.id}/members`, { method: 'POST', body: JSON.stringify(Object.fromEntries(f)) });
            setNotice('Welcome! You are now a member.'); go('groups');
          })}>
            <Field label="Your name" name="name" required />
            <Field label="Profession" name="profession" />
            <Field label="Contact (phone or email)" name="contact" />
            <Field label="Member code" name="pin" required maxLength={4} />
            <button className="gold-btn big">Join a group</button>
          </form>
        </main>
      )}

      {view === 'chats' && group && (
        <main>
          <button className="back" onClick={() => go('groups')}>← Groups</button>
          <h1>{group.name}</h1>
          <button className="gold-btn" onClick={() => go('newchat')}>Create a chat <Info text="Anyone can start a chat — no sign-in needed." /></button>
          <section className="stack">
            {chats.length === 0 && <p className="empty">No chats here yet. Start the first one.</p>}
            {chats.map((c) => (
              <button key={c.id} className="chat-card" onClick={() => loadChat(c)}>
                <span className="chat-card-img"><img src={GROUP_IMAGES[group.name]} alt="" loading="lazy" /></span>
                <span className="chat-title">{c.title}</span>
                <span className="chat-meta">{c.comment_count} comment{c.comment_count === 1 ? '' : 's'} · {relTime(c.created_at)} ago</span>
              </button>
            ))}
          </section>
        </main>
      )}

      {view === 'newchat' && group && (
        <main className="narrow">
          <button className="back" onClick={() => go('chats')}>← Chats</button>
          <h1>Start a chat in {group.name}</h1>
          <form onSubmit={(e) => submit(e, async (f) => {
            const d = await api(`/api/churches/${church.id}/chats`, { method: 'POST', body: JSON.stringify({ group: group.name, ...Object.fromEntries(f) }) });
            loadChat(d);
          })}>
            <Field label="Chat title" name="title" required />
            <label className="field"><span>Opening message</span><textarea name="opening_message" required rows={4} /></label>
            <button className="gold-btn big">Create chat</button>
          </form>
        </main>
      )}

      {view === 'chat' && chat && (
        <main className="narrow wide">
          <button className="back" onClick={() => go('chats')}>← Chats</button>
          <h1>{chat.title}</h1>
          <section className="stack comments">
            {comments.map((cm) => (
              <article key={cm.id} className="comment-card">
                <PersonIcon variant={cm.icon_variant} />
                <div className="comment-body">
                  <div className="comment-head"><b>member</b><span>{relTime(cm.created_at)} ago</span></div>
                  <p>{cm.text}</p>
                  <button className="reply" onClick={() => commentBox.current?.focus()}>Reply</button>
                </div>
              </article>
            ))}
          </section>
          <form className="comment-form" onSubmit={(e) => submit(e, async (f) => {
            const d = await api(`/api/chats/${chat.id}/comments`, { method: 'POST', body: JSON.stringify({ text: f.get('text') }) });
            setComments([...comments, d]); e.target.reset();
          })}>
            <p className="muted">Commenting needs no sign-in and shows no name — you appear simply as “member”. <Info text="Comments are anonymous on purpose: only the word 'member' and a colorful icon are shown." /></p>
            <textarea ref={commentBox} name="text" required rows={3} placeholder="Write a comment…" />
            <button className="gold-btn">Post comment</button>
          </form>
        </main>
      )}

      {view === 'dashboard' && registrar && (
        <main>
          <h1>Registrar dashboard</h1>
          <p className="muted">Signed in as {registrar.registrar_name} ({registrar.registrar_email})</p>
          <section className="overlap-stack" aria-label="Your churches">
            <article className="overlap-card">
              <ChurchVisual church={registrar} />
              <h2>{registrar.name}</h2>
              <p className="muted">{registrar.city}</p>
              <form onSubmit={(e) => submit(e, async (f) => {
                await api(`/api/churches/${registrar.id}/pin`, { method: 'POST', headers: authHeaders(), body: JSON.stringify({ pin: f.get('pin') }) });
                setNotice('Member code saved. Share it with your members.'); setRegistrar({ ...registrar, has_pin: true });
              })}>
                <Field label="Member code (4 letters or numbers)" name="pin" required maxLength={4} placeholder={registrar.has_pin ? 'Change the code…' : 'Create the code…'} />
                <button className="gold-btn">{registrar.has_pin ? 'Change code' : 'Create code'}</button>
              </form>
              <button className="gold-btn outline" onClick={loadMembers}>View your members</button>
            </article>
          </section>
          <section className="banner-box">
            <h2>Church banner</h2>
            {registrar.has_banner && !dashBannerPreview && (
              <div className="banner-preview">
                <img src={`/api/churches/${registrar.id}/banner`} alt="Current church banner" />
                <p>Current banner — shown on your church card and groups page.</p>
              </div>
            )}
            <label className="field">
              <span>{registrar.has_banner ? 'Replace the banner (optional)' : 'Upload an image banner for your church (optional)'}</span>
              <input type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => {
                const file = e.target.files[0] || null;
                const err = bannerFileError(file);
                setDashBannerMsg(err);
                if (err || !file) { setDashBannerFile(null); setDashBannerPreview(''); return; }
                setDashBannerFile(file);
                setDashBannerPreview(URL.createObjectURL(file));
              }} />
            </label>
            {dashBannerPreview && (
              <div className="banner-preview">
                <img src={dashBannerPreview} alt="New banner preview" />
                <p>New banner ready: {dashBannerFile.name} ({Math.round(dashBannerFile.size / 1024)} KB).</p>
              </div>
            )}
            <div className="join-row">
              <button className="gold-btn" disabled={!dashBannerFile} onClick={async () => {
                try {
                  const dataUrl = await fileToDataUrl(dashBannerFile);
                  await api(`/api/churches/${registrar.id}/banner`, { method: 'POST', headers: authHeaders(), body: JSON.stringify({ banner_data_url: dataUrl }) });
                  const me = await api('/api/me', { headers: authHeaders() }); setRegistrar(me.church); loadChurches();
                  setDashBannerFile(null); setDashBannerPreview(''); setDashBannerMsg('Banner saved.');
                } catch (err) { setDashBannerMsg(err.message); }
              }}>{registrar.has_banner ? 'Replace banner' : 'Upload banner'}</button>
              {registrar.has_banner && (
                <button className="gold-btn outline" onClick={async () => {
                  try {
                    await api(`/api/churches/${registrar.id}/banner`, { method: 'DELETE', headers: authHeaders() });
                    const me = await api('/api/me', { headers: authHeaders() }); setRegistrar(me.church); loadChurches();
                    setDashBannerMsg('Banner removed — your church card now shows its default letter tile.');
                  } catch (err) { setDashBannerMsg(err.message); }
                }}>Remove banner</button>
              )}
            </div>
            {dashBannerMsg && <p className="muted">{dashBannerMsg}</p>}
          </section>
          <button className="muted-btn" onClick={() => { localStorage.removeItem('bpn_token'); setRegistrar(null); go('home'); }}>Log out</button>
        </main>
      )}

      {view === 'members' && registrar && (
        <main>
          <button className="back" onClick={() => go('dashboard')}>← Dashboard</button>
          <h1>Members of {registrar.name}</h1>
          <section className="sheet-bar">
            {registrar.sheet_url ? (
              <>
                <a className="gold-btn" href={registrar.sheet_url} target="_blank" rel="noreferrer">View in Google Sheet ↗</a>
                <p className="muted">Auto-sync runs only when a service account is connected; otherwise use CSV export below and import it into the Sheet.</p>
              </>
            ) : (
              <p className="alert">Sheet not linked yet — paste your church's Google Sheet link below to enable the button.</p>
            )}
            <form className="sheet-form" onSubmit={(e) => submit(e, async (f) => {
              await api(`/api/churches/${registrar.id}/sheet`, { method: 'POST', headers: authHeaders(), body: JSON.stringify(Object.fromEntries(f)) });
              const me = await api('/api/me', { headers: authHeaders() }); setRegistrar(me.church); setNotice('Sheet link saved.');
            })}>
              <Field label="Google Sheet link" name="sheet_url" defaultValue={registrar.sheet_url || ''} placeholder="https://docs.google.com/spreadsheets/d/…" />
              <Field label="Google account it belongs to (optional)" name="google_account_ref" defaultValue={registrar.google_account_ref || ''} placeholder="e.g. church@gmail.com" />
              <button className="gold-btn">Save sheet link</button>
            </form>
            <button className="gold-btn outline" onClick={async () => {
              const res = await fetch(`/api/churches/${registrar.id}/members.csv`, { headers: authHeaders() });
              const blob = await res.blob();
              const a = document.createElement('a');
              a.href = URL.createObjectURL(blob); a.download = 'bpn-members.csv'; a.click();
            }}>Export members as CSV</button>
          </section>
          <section className="stack">
            {members.length === 0 && <p className="empty">No members yet. Share your member code so people can join.</p>}
            {members.map((m) => (
              <article key={m.id} className="member-card">
                <b>{m.name}</b><span>{m.profession}</span><span>{m.contact}</span><span className="muted">{new Date(m.created_at).toLocaleString()}</span>
              </article>
            ))}
          </section>
        </main>
      )}

      {view === 'admin' && (
        <main className="narrow">
          <h1>BPN Admin</h1>
          <p className="muted">Admin area. <Info text="The admin manages the app itself — including, in a later update, the Google Sheet connection and app content. This page never shows or stores a password in plain text." /></p>
          {admin ? (
            <section>
              <h2>Overview</h2>
              <div className="stats">
                <div><b>{admin.totals.churches}</b><span>churches</span></div>
                <div><b>{admin.totals.members}</b><span>members</span></div>
                <div><b>{admin.totals.chats}</b><span>chats</span></div>
                <div><b>{admin.totals.comments}</b><span>comments</span></div>
              </div>
              <h3>Churches &amp; Sheet connections</h3>
              <section className="stack">
                {admin.churches.map((c) => (
                  <article key={c.id} className="member-card">
                    <b>{c.name}</b><span>{c.city}</span>
                    <span>{c.member_count} members · {c.chat_count} chats</span>
                    <span className="muted">{c.sheet_url ? `Sheet linked${c.google_account_ref ? ` (${c.google_account_ref})` : ''}` : 'No Sheet linked'}</span>
                  </article>
                ))}
              </section>
              <p className="muted">Content editing (CMS) — including changing the Google account used for Sheets — arrives in a later update. Connections stay in the database, never in code.</p>
              <button className="muted-btn" onClick={() => { localStorage.removeItem('bpn_admin_token'); setAdmin(null); go('home'); }}>Log out</button>
            </section>
          ) : adminConfigured === false ? (
            <form onSubmit={(e) => submit(e, async (f) => {
              const pw = f.get('password'); if (pw !== f.get('confirm')) throw new Error('Passwords do not match.');
              const d = await api('/api/admin/setup', { method: 'POST', body: JSON.stringify({ password: pw }) });
              localStorage.setItem('bpn_admin_token', d.token);
              setAdmin(await api('/api/admin/overview', { headers: { Authorization: `Bearer ${d.token}` } }));
            })}>
              <p>First visit — set the admin password (8+ characters). It is stored hashed, never in plain text.</p>
              <Field label="Admin password" name="password" type="password" required minLength={8} />
              <Field label="Confirm password" name="confirm" type="password" required minLength={8} />
              <button className="gold-btn big">Set admin password</button>
            </form>
          ) : (
            <form onSubmit={(e) => submit(e, async (f) => {
              const d = await api('/api/admin/login', { method: 'POST', body: JSON.stringify({ password: f.get('password') }) });
              localStorage.setItem('bpn_admin_token', d.token);
              setAdmin(await api('/api/admin/overview', { headers: { Authorization: `Bearer ${d.token}` } }));
            })}>
              <Field label="Admin password" name="password" type="password" required autoFocus />
              <button className="gold-btn big">Log in as admin</button>
            </form>
          )}
        </main>
      )}
    </div>
  );
}
