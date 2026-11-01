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

// First letter of the church name, for the monogram tile. Test churches
// are prefixed "Sample" (e.g. "Sample Grace Fellowship"), so a leading
// "Sample" word is skipped — the monogram is the first letter of the next
// word (G for Grace Fellowship, B for Believers Love World, R for Rock
// City). Every other church is unaffected (its first word is used).
function firstLetter(name) {
  const words = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return 'B';
  const first = words[0].toLowerCase() === 'sample' && words.length > 1 ? words[1] : words[0];
  return first[0].toUpperCase();
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

function Field({ label, info, ...props }) {
  return (
    <label className="field">
      <span>{label} {info && <Info text={info} />}</span>
      <input {...props} />
    </label>
  );
}

export default function App() {
  const [view, setView] = useState(window.location.pathname.startsWith('/addy') ? 'admin' : window.location.pathname === '/register-church' ? 'register' : window.location.pathname === '/terms-of-use' ? 'terms' : window.location.pathname === '/privacy-policy' ? 'privacy' : window.location.pathname === '/how-it-works' ? 'how' : 'home');
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
  const [confirmDeleteChurch, setConfirmDeleteChurch] = useState(null);
  const [showBenefits, setShowBenefits] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [bannerFile, setBannerFile] = useState(null);
  const [bannerPreview, setBannerPreview] = useState('');
  const [bannerError, setBannerError] = useState('');
  const [dashBannerFile, setDashBannerFile] = useState(null);
  const [dashBannerPreview, setDashBannerPreview] = useState('');
  const [dashBannerMsg, setDashBannerMsg] = useState('');
  const [announcements, setAnnouncements] = useState([]);
  const [showAnnouncements, setShowAnnouncements] = useState(false);
  const [annFile, setAnnFile] = useState(null);
  const [annPreview, setAnnPreview] = useState('');
  const [annError, setAnnError] = useState('');
  const commentBox = useRef(null);

  const go = (v) => {
    setView(v); setError(''); setNotice('');
    window.scrollTo(0, 0);
    if (v === 'admin') window.history.pushState({}, '', '/addy');
    else if (v === 'register') window.history.pushState({}, '', '/register-church');
    else if (v === 'terms') window.history.pushState({}, '', '/terms-of-use');
    else if (v === 'privacy') window.history.pushState({}, '', '/privacy-policy');
    else if (v === 'how') window.history.pushState({}, '', '/how-it-works');
    else if (window.location.pathname.startsWith('/addy') || window.location.pathname === '/register-church' || window.location.pathname === '/terms-of-use' || window.location.pathname === '/privacy-policy' || window.location.pathname === '/how-it-works') window.history.pushState({}, '', '/');
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

  // Dashboard announcement list: refresh the admin's own church's
  // announcements whenever the dashboard is shown, so the remove controls
  // always reflect the current list (not a previously viewed church's).
  useEffect(() => {
    if (view === 'dashboard' && registrar) loadAnnouncements(registrar.id);
  }, [view, registrar]);

  const authHeaders = () => ({ Authorization: `Bearer ${localStorage.getItem('bpn_token') || ''}` });

  async function submit(e, fn) {
    e.preventDefault(); setError(''); setNotice('');
    try { await fn(new FormData(e.target)); } catch (err) { setError(err.message); }
  }

  const openChurch = (c) => { setChurch(c); setUnlocked(false); setGroup(null); go('pin'); };

  // Announcements are per-church: fetched for the church being viewed, so
  // they can only ever render on that church's own groups/chats pages.
  const loadAnnouncements = async (churchId) => {
    try { setAnnouncements(await api(`/api/churches/${churchId}/announcements`)); } catch { setAnnouncements([]); }
  };

  const loadChats = async (g) => {
    const list = await api(`/api/churches/${church.id}/chats?group=${encodeURIComponent(g.name)}`);
    setChats(list); setGroup(g);
    await loadAnnouncements(church.id);
    go('chats');
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
            <button onClick={() => go('dashboard')}>My church</button>
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
            <button type="button" onClick={() => { setShowMenu(false); go('how'); }}>How it works</button>
            <a href="https://cryptok.online" target="_blank" rel="noreferrer" onClick={() => setShowMenu(false)}>Build your pro website ↗</a>
            <button type="button" onClick={() => { setShowMenu(false); go('login'); }}>Church admin login</button>
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
          <p className="find-tagline">Connect. Collaborate. Make an impact.</p>
          <p className="find-subline">no sign-up needed</p>

          <section className="search-zone">
            <label>Find your church</label>
            <input
              value={query} onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by church name or city…" aria-label="Search churches"
            />
            <Info text="Type your church name. Tap its card, then enter the connect code from the church admin." />
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
                  <span className="church-cta">Enter with connect code →</span>
                </button>
              ))}
            </section>
          )}
        </main>
      )}

      {view === 'register' && (
        <main className="narrow">
          <h1>Register your church</h1>
          <p className="muted">You become the church admin for this church. <Info text="The church admin is the person who manages the church on BPN: they set the connect code and see the member list." /></p>
          <form onSubmit={(e) => submit(e, async (f) => {
            const payload = Object.fromEntries(f);
            if (bannerFile) payload.banner_data_url = await fileToDataUrl(bannerFile);
            const d = await api('/api/churches', { method: 'POST', body: JSON.stringify(payload) });
            localStorage.setItem('bpn_token', d.token); setRegistrar(d.church); loadChurches();
            setNotice('Church registered — share your connect code with your members.'); go('dashboard');
          })}>
            <Field label="Church name" name="name" required />
            <Field label="City" name="city" />
            <Field label="Your name (church admin)" name="registrar_name" required />
            <p className="muted">Church admin login details:</p>
            <Field label="Your email" name="registrar_email" type="email" required />
            <Field label="Password (6+ characters)" name="password" type="password" required minLength={6} />
            <p className="muted">You'll use this email and password to log in as church admin next time.</p>
            <Field label="Connect code (4 letters or numbers)" name="pin" required maxLength={4} placeholder="e.g. A3K9"
              info="Give this code to your members — they will enter it as their connect code when they get on this platform to unlock your church's groups." />
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
          <h1>Church admin login</h1>
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
          <p className="muted">{church.city} <Info text="Members need the connect code from the church admin to enter this church's area." /></p>
          {!church.has_pin ? (
            <p className="alert">This church has no connect code yet — ask its church admin for the connect code.</p>
          ) : (
            <form onSubmit={(e) => submit(e, async (f) => {
              await api(`/api/churches/${church.id}/unlock`, { method: 'POST', body: JSON.stringify({ pin: f.get('pin') }) });
              setUnlocked(true); await loadAnnouncements(church.id); go('groups');
            })}>
              <Field label="Connect code (4 letters or numbers)" name="pin" required maxLength={4} autoFocus placeholder="e.g. A3K9" />
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
            <button className="gold-btn" onClick={() => go('join')}>Join a group <Info text="Joining needs no login — just your name, profession and the connect code." /></button>
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
          <p className="muted">No login needed. <Info text="Your details go to your church's member list, which the church admin can view (and link to a Google Sheet). Comments you post later show only as 'member'." /></p>
          <form onSubmit={(e) => submit(e, async (f) => {
            await api(`/api/churches/${church.id}/members`, { method: 'POST', body: JSON.stringify(Object.fromEntries(f)) });
            setNotice('Welcome! You are now a member.'); go('groups');
          })}>
            <Field label="Your name" name="name" required />
            <Field label="Profession" name="profession" />
            <Field label="Contact (phone or email)" name="contact" />
            <Field label="Connect code" name="pin" required maxLength={4} />
            <button className="gold-btn big">Join a group</button>
          </form>
        </main>
      )}

      {view === 'chats' && group && (
        <main>
          <button className="back" onClick={() => go('groups')}>← Groups</button>
          <h1>{group.name}</h1>
          <div className="join-row">
            <button className="gold-btn" onClick={() => go('newchat')}>Create a chat <Info text="Anyone can start a chat — no sign-in needed." /></button>
            <button className="gold-btn outline" onClick={() => setShowAnnouncements(true)}>Announcements</button>
          </div>
          {showAnnouncements && (
            <div className="modal-backdrop" onClick={() => setShowAnnouncements(false)}>
              <div className="modal-card ann-modal" role="dialog" aria-modal="true" aria-label="Announcements" onClick={(e) => e.stopPropagation()}>
                <button type="button" className="modal-close" aria-label="Close" onClick={() => setShowAnnouncements(false)}>✕</button>
                <h2>Announcements</h2>
                {announcements.length === 0 ? (
                  <p className="muted">No announcements yet.</p>
                ) : (
                  <section className="ann-modal-list">
                    {announcements.map((a) => (
                      <article key={a.id} className="announcement-card">
                        <h3>{a.title}</h3>
                        <p>{a.details}</p>
                        {a.has_image && <img src={`/api/announcements/${a.id}/image`} alt="" loading="lazy" />}
                      </article>
                    ))}
                  </section>
                )}
              </div>
            </div>
          )}
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
          <h1>Church admin dashboard</h1>
          <p className="muted">Signed in as {registrar.registrar_name} ({registrar.registrar_email})</p>
          <section className="overlap-stack" aria-label="Your churches">
            <article className="overlap-card">
              <ChurchVisual church={registrar} />
              <h2>{registrar.name}</h2>
              <p className="muted">{registrar.city}</p>
              {!registrar.has_pin && (
                <p className="alert">Your church has no connect code yet — set your connect code below so members can enter your church's area.</p>
              )}
              <form onSubmit={(e) => submit(e, async (f) => {
                await api(`/api/churches/${registrar.id}/pin`, { method: 'POST', headers: authHeaders(), body: JSON.stringify({ pin: f.get('pin') }) });
                setNotice('Connect code saved. Share it with your members.'); setRegistrar({ ...registrar, has_pin: true });
              })}>
                <Field label="Connect code (4 letters or numbers)" name="pin" required maxLength={4} placeholder={registrar.has_pin ? 'Change the code…' : 'Create the code…'} />
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
          <section className="banner-box">
            <h2>Announcements</h2>
            <p className="muted">Post an announcement for your church — members open it from the Announcements button on your church's chat page, newest first.</p>
            <form onSubmit={async (e) => {
              e.preventDefault(); setError(''); setNotice('');
              try {
                const f = new FormData(e.target);
                let image_data_url = null;
                if (annFile) image_data_url = await fileToDataUrl(annFile);
                await api(`/api/churches/${registrar.id}/announcements`, { method: 'POST', headers: authHeaders(), body: JSON.stringify({ title: f.get('title'), details: f.get('details'), image_data_url }) });
                e.target.reset(); setAnnFile(null); setAnnPreview(''); setAnnError('');
                await loadAnnouncements(registrar.id);
                setNotice('Announcement posted — members can open it from the Announcements button on your church\'s chat page.');
              } catch (err) { setError(err.message); }
            }}>
              <Field label="Title of the announcement" name="title" required />
              <label className="field"><span>Details of the announcement</span><textarea name="details" required rows={4} /></label>
              <label className="field">
                <span>Image (optional)</span>
                <input type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => {
                  const file = e.target.files[0] || null;
                  const err = bannerFileError(file);
                  setAnnError(err);
                  if (err || !file) { setAnnFile(null); setAnnPreview(''); return; }
                  setAnnFile(file);
                  setAnnPreview(URL.createObjectURL(file));
                }} />
              </label>
              {annError && <p className="alert err">{annError}</p>}
              {annPreview && (
                <div className="banner-preview">
                  <img src={annPreview} alt="Announcement image preview" />
                  <p>Image ready: {annFile.name} ({Math.round(annFile.size / 1024)} KB).</p>
                </div>
              )}
              <button className="gold-btn big">Post announcement</button>
            </form>
            <h3>Your announcements</h3>
            {announcements.length === 0 ? (
              <p className="muted">No announcements yet.</p>
            ) : (
              <section className="announcements">
                {announcements.map((a) => (
                  <article key={a.id} className="announcement-card">
                    <h3>{a.title}</h3>
                    <p>{a.details}</p>
                    {a.has_image && <img src={`/api/announcements/${a.id}/image`} alt="" loading="lazy" />}
                    <button className="gold-btn outline" onClick={async () => {
                      try {
                        await api(`/api/churches/${registrar.id}/announcements/${a.id}`, { method: 'DELETE', headers: authHeaders() });
                        await loadAnnouncements(registrar.id);
                        setNotice('Announcement removed.');
                      } catch (err) { setError(err.message); }
                    }}>Remove</button>
                  </article>
                ))}
              </section>
            )}
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
            {members.length === 0 && <p className="empty">No members yet. Share your connect code so people can join.</p>}
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
                    {confirmDeleteChurch === c.id ? (
                      <span>
                        <span>Delete this church and all its members, chats, and announcements? This cannot be undone.</span>
                        <button type="button" onClick={async () => {
                          try {
                            const tok = localStorage.getItem('bpn_admin_token');
                            await api(`/api/admin/churches/${c.id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${tok}` } });
                            setConfirmDeleteChurch(null);
                            setAdmin(await api('/api/admin/overview', { headers: { Authorization: `Bearer ${tok}` } }));
                          } catch (e) { setError(e?.message || 'Could not delete the church.'); }
                        }}>Yes, delete</button>
                        <button type="button" className="muted-btn" onClick={() => setConfirmDeleteChurch(null)}>Cancel</button>
                      </span>
                    ) : (
                      <button type="button" className="muted-btn" onClick={() => setConfirmDeleteChurch(c.id)}>Delete church</button>
                    )}
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

      {view === 'terms' && (
        <main className="narrow">
          <button className="back" onClick={() => go('home')}>← Home</button>
          <h1>Terms of Use</h1>
          <p className="muted">Plain-language terms for Believers Professional Network (BPN). By using this site, you agree to these terms.</p>
          <h2>What BPN is for</h2>
          <p>BPN connects believers through their church's professional groups — a place to engage with other professionals, share opportunities and information, encourage one another, and discuss workplace life built on godly principles.</p>
          <h2>No sign-up needed to take part</h2>
          <p>You do not need an account to browse churches and professional groups, create a chat, or comment. Creating a chat or commenting needs no sign-in at all.</p>
          <h2>Comments are anonymous</h2>
          <p>Comments show only the word “member” with a colorful person icon. No real names appear on comments, and a comment is never tied to a named account.</p>
          <h2>Connect codes</h2>
          <p>Each church has a 4-character connect code, set by its church admin when the church is registered (and changeable later from the church admin dashboard). You need that code — given to you by your church admin — to enter a church's area and to join its member list. Keep your church's code for its members.</p>
          <h2>Joining a member list</h2>
          <p>Joining asks for your name, profession, and contact. Those details go to your church's member list, which your church admin can view. A church admin may link the list to a Google Sheet, and can export it as a CSV file.</p>
          <h2>Church banners</h2>
          <p>A church admin may upload a banner image for their church. It is shown on the church's card and on the church's professional groups page. A church admin can replace or remove it at any time.</p>
          <h2>Church admin responsibilities</h2>
          <p>The church admin manages their church on BPN: they set and change the connect code, view the member list, and manage the church banner. The site administrator manages the app itself.</p>
          <h2>Use the network respectfully</h2>
          <p>Use BPN in a way that fits a professional network built on godly principles: be encouraging, share genuine opportunities and information, and respect other members.</p>
          <h2>Availability</h2>
          <p>BPN runs on free-tier hosting, so after a quiet spell the first page load can take a little while as the service wakes up.</p>
          <h2>Changes to these terms</h2>
          <p>These terms may be updated from time to time. Continued use of the site after an update means you accept the updated terms.</p>
        </main>
      )}

      {view === 'privacy' && (
        <main className="narrow">
          <button className="back" onClick={() => go('home')}>← Home</button>
          <h1>Privacy Policy</h1>
          <p className="muted">Plain-language privacy notes for Believers Professional Network (BPN). This page describes what the app actually collects and how it is used — nothing more.</p>
          <h2>What is collected</h2>
          <p><b>Churches:</b> church name and city. <b>Church admins:</b> name and email, plus a password that is stored hashed, never in plain text. <b>Members:</b> the name, profession, and contact details given when joining a church's member list. <b>Chats and comments:</b> chat titles, opening messages, and comment text.</p>
          <h2>What is not collected</h2>
          <p>No account is needed to browse churches and groups, create a chat, or comment — so no identity is collected for those actions. Comments carry no name at all: they show only the word “member” with a colorful person icon.</p>
          <h2>Sign-in tokens</h2>
          <p>Church admin and admin sign-in tokens are stored in your browser's local storage so you stay signed in. Logging out removes them.</p>
          <h2>Member lists and Google Sheets</h2>
          <p>Member details are visible to your church admin through the member list. If the church admin links a Google Sheet, the list can be viewed there, and the church admin can also export it as a CSV file. Automatic syncing to a Sheet only runs when a service account is connected; otherwise the church admin imports the CSV manually.</p>
          <h2>Connect codes</h2>
          <p>Each church's 4-character connect code is set by its church admin when the church is registered (and can be changed later) and is not public. It is needed to enter a church's area and to join its member list.</p>
          <h2>Church banners</h2>
          <p>A banner image uploaded by a church admin is stored in the app's database and shown on that church's card and professional groups page. Removing it returns the card to its default letter tile.</p>
          <h2>Questions about your data</h2>
          <p>Your member details are held in your church's member list, so questions about them are best raised with your church admin.</p>
          <h2>Changes to this policy</h2>
          <p>This policy may be updated from time to time. Continued use of the site after an update means you accept the updated policy.</p>
        </main>
      )}

      {view === 'how' && (
        <main className="narrow">
          <button className="back" onClick={() => go('home')}>← Home</button>
          <h1>How it works</h1>
          <p className="muted">Six short steps — no sign-up needed to take part.</p>
          <section className="how-steps">
            <article className="how-step">
              <span className="how-num">1</span>
              <div><h2>Find your church</h2><p>Browse or search the church cards on the homepage.</p></div>
            </article>
            <article className="how-step how-key">
              <span className="how-num">2</span>
              <div><h2>Get your unique connect code from your church admin</h2><p>Each church has its own 4-character connect code — and only the church admin can give it to you. This code is the key to your church's area on BPN.</p></div>
            </article>
            <article className="how-step">
              <span className="how-num">3</span>
              <div><h2>Enter the code to unlock your church</h2><p>Tap your church's card, then enter the code to unlock that church's professional groups.</p></div>
            </article>
            <article className="how-step">
              <span className="how-num">4</span>
              <div><h2>Pick a group, join the conversation</h2><p>Pick a professional group, then browse chats, create a chat, and comment — no sign-up needed, and comments show only as “member”, never your real name.</p></div>
            </article>
            <article className="how-step">
              <span className="how-num">5</span>
              <div><h2>Join as a member</h2><p>After entering the code, tap “Join a group” and add your name, profession, and contact to join your church's member list.</p></div>
            </article>
            <article className="how-step">
              <span className="how-num">6</span>
              <div><h2>For church admins</h2><p>Register your church, log in as church admin, create or change the connect code, view your members, and post announcements that members open from the Announcements button on your church's chat page.</p></div>
            </article>
          </section>
        </main>
      )}

      <footer className="site-footer">
        <span>Believers Professional Network · Stronger Together</span>
        <nav aria-label="Footer">
          <button type="button" onClick={() => go('register')}>Register your church</button>
          <button type="button" onClick={() => setShowBenefits(true)}>The Benefits</button>
          <button type="button" onClick={() => go('how')}>How it works</button>
          <a href="https://cryptok.online" target="_blank" rel="noreferrer">Build your pro website ↗</a>
          <button type="button" onClick={() => go('login')}>Church admin login</button>
          <button type="button" onClick={() => go('terms')}>Terms of Use</button>
          <button type="button" onClick={() => go('privacy')}>Privacy</button>
        </nav>
        <p className="footer-copy">© 2026 Believers Professional Network. A product of <a href="https://cryptok.online" target="_blank" rel="noreferrer">Cryptok Solutions</a>.</p>
      </footer>
    </div>
  );
}
