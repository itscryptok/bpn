import React, { useEffect, useRef, useState } from 'react';
import { PersonIcon } from './avatars.jsx';

const api = async (path, opts = {}) => {
  const res = await fetch(path, { headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) }, ...opts });
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
const FALLBACK_CHURCH_BG = '/img/church-01.webp';

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
  const [view, setView] = useState(window.location.pathname.startsWith('/addy') ? 'admin' : 'home');
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
  const commentBox = useRef(null);

  const go = (v) => {
    setView(v); setError(''); setNotice('');
    window.scrollTo(0, 0);
    if (v === 'admin') window.history.pushState({}, '', '/addy');
    else if (window.location.pathname.startsWith('/addy')) window.history.pushState({}, '', '/');
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

  const copy = config.copy || {};
  const groups = config.groups || [];

  return (
    <div className="app">
      <header className="topbar">
        <button className="logo" onClick={() => go('home')}>
          <span className="logo-mark">✦</span>
          <span><b>BPN</b> Believers Professional Network</span>
        </button>
        <nav>
          {registrar ? (
            <button onClick={() => go('dashboard')}>My churches</button>
          ) : (
            <>
              <button onClick={() => go('login')}>Registrar login</button>
              <button className="gold-btn" onClick={() => go('register')}>Register your church</button>
            </>
          )}
        </nav>
      </header>

      {error && <div className="alert err">{error}</div>}
      {notice && <div className="alert ok">{notice}</div>}

      {view === 'home' && (
        <main>
          <section className="hero">
            <img src="/hero.svg" alt="" />
            <div className="hero-text">
              <h1>{copy.hero_title || 'Believers Professional Network'}</h1>
              <p>{copy.tagline || 'Stronger Together'} <Info text="BPN connects members of a church across professions, so skills, opportunities and encouragement are shared inside the community." /></p>
              <p className="sub">{copy.hero_sub || 'Connect. Collaborate. Grow. Make an impact.'}</p>
              <button className="gold-btn big" onClick={() => go('register')}>Register your church</button>
            </div>
          </section>

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
                  <span className="church-banner"><img src={c.background_image || FALLBACK_CHURCH_BG} alt="" loading="lazy" /></span>
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
            const d = await api('/api/churches', { method: 'POST', body: JSON.stringify(Object.fromEntries(f)) });
            localStorage.setItem('bpn_token', d.token); setRegistrar(d.church);
            setNotice('Church registered. Now set your 4-character member code.'); go('dashboard');
          })}>
            <Field label="Church name" name="name" required />
            <Field label="City" name="city" />
            <Field label="Your name (registrar)" name="registrar_name" required />
            <Field label="Your email" name="registrar_email" type="email" required />
            <Field label="Password (6+ characters)" name="password" type="password" required minLength={6} />
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
          <h1>{church.name} <span className="muted">· Professional groups</span></h1>
          <div className="join-row">
            <button className="gold-btn" onClick={() => go('join')}>Join a group <Info text="Joining needs no login — just your name, profession and the member code." /></button>
            <button className="gold-btn outline" onClick={() => setShowBenefits(true)}>The Benefits</button>
          </div>
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
              <span className="church-banner"><img src={registrar.background_image || FALLBACK_CHURCH_BG} alt="" /></span>
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
