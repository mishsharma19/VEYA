/* VEYA — client */
(() => {
  'use strict';
  const _rc = Element.prototype.replaceChildren;
  Element.prototype.replaceChildren = function (...k) { return _rc.apply(this, k.flat(Infinity).filter((x) => x != null && x !== false)); };

  // ---------------------------------------------------------------- helpers
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const TZ = new Date().getTimezoneOffset();
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} },
  };

  // h('div', {class:'x', onclick}, child, 'text') — always uses textContent for strings (XSS-safe)
  function h(tag, attrs, ...children) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style') el.style.cssText = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (k in el && typeof v !== 'string') el[k] = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const c of children.flat(Infinity)) if (c != null && c !== false) el.append(c.nodeType ? c : document.createTextNode(String(c)));
    return el;
  }

  const S = {
    token: store.get('kc-token'),
    me: null, communities: [], users: new Map(), presence: new Map(), giphy: false, idle: false,
    socket: null,
    view: 'clubs',           // chat | clubs | news | schedule | map
    side: 'chat',
    chatTab: 'channels',     // channels | dms
    clubs: [], clubFilter: 'All', clubQuery: '', groups: [],
    customStickers: [], tenor: false,
    room: 'campus/general',
    cache: new Map(),        // room -> { messages, pinned, loaded, hasMore }
    unread: new Map(),       // room -> count
    mentions: new Map(),     // room -> count
    dms: new Map(),          // room -> lastTs
    typing: new Map(),       // room -> Map(userId -> timeout)
    events: [], newsFilter: 'all', newsDot: false,
    schedule: { items: [], events: [] },
    botLog: [],
    dmSearch: '',
    mapQuery: '', mapCat: 'all', mapSel: null, mapView: null,
  };

  async function api(method, url, body) {
    const isGet = method === 'GET';
    const full = isGet ? url + (url.includes('?') ? '&' : '?') + 'tz=' + TZ : url;
    const res = await fetch(full, {
      method,
      headers: { 'Content-Type': 'application/json', ...(S.token ? { Authorization: 'Bearer ' + S.token } : {}) },
      body: isGet ? undefined : JSON.stringify({ ...(body || {}), tz: TZ }),
    });
    let data = {};
    try { data = await res.json(); } catch {}
    if (res.status === 401 && S.token && !url.includes('/signin')) { signOut(); }
    if (!res.ok) { const e = new Error(data.error || 'Something went wrong'); e.data = data; e.status = res.status; throw e; }
    return data;
  }

  function toast(text, kind = '') {
    const t = h('div', { class: 'toast ' + kind }, text);
    $('#toasts').append(t);
    setTimeout(() => t.remove(), kind === 'warn' ? 7000 : 4000);
  }

  const initials = (name) => (name || '?').split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase();
  const pad = (n) => String(n).padStart(2, '0');
  const fmtMin = (m) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
  const timeStr = (iso) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const dateKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const todayKey = () => dateKey(new Date());
  function dayLabel(d) {
    const k = dateKey(d), t = new Date(); const y = new Date(); y.setDate(t.getDate() - 1); const tm = new Date(); tm.setDate(t.getDate() + 1);
    if (k === dateKey(t)) return 'Today';
    if (k === dateKey(y)) return 'Yesterday';
    if (k === dateKey(tm)) return 'Tomorrow';
    return d.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'short' });
  }
  function relTime(iso) {
    const diff = new Date(iso).getTime() - Date.now();
    const rtf = new Intl.RelativeTimeFormat([], { numeric: 'auto' });
    const abs = Math.abs(diff);
    if (abs < 3600e3) return rtf.format(Math.round(diff / 60e3), 'minute');
    if (abs < 86400e3) return rtf.format(Math.round(diff / 3600e3), 'hour');
    return rtf.format(Math.round(diff / 86400e3), 'day');
  }

  function stateOf(id) {
    if (S.me && id === S.me.id) {
      const st = S.me.status || 'online';
      return st === 'online' && S.idle ? 'away' : st;
    }
    return S.presence.get(id) || 'offline';
  }
  const isOn = (id) => !['offline', 'invisible'].includes(stateOf(id));
  const STATUS_LABEL = { online: 'Online', away: 'Away', dnd: 'Do not disturb', offline: 'Offline', invisible: 'Invisible' };
  function lastSeenText(u) {
    if (!u?.lastSeen) return '';
    const mins = Math.round((Date.now() - new Date(u.lastSeen)) / 60e3);
    if (mins < 1) return 'last seen just now';
    if (mins < 60) return `last seen ${mins} min ago`;
    if (mins < 1440) return `last seen ${Math.round(mins / 60)} h ago`;
    return 'last seen ' + new Date(u.lastSeen).toLocaleDateString([], { day: 'numeric', month: 'short' });
  }
  function statusLabel(u) {
    const st = stateOf(u.id);
    let t = STATUS_LABEL[st];
    if (st === 'offline' && lastSeenText(u)) t += ' · ' + lastSeenText(u);
    return t;
  }
  function avatar(user, size = '', withPresence = false) {
    const u = user || { name: '?', color: '#888' };
    const el = h('div', { class: 'avatar ' + size, style: `background:${u.color}` });
    if (u.avatarVer) {
      const img = h('img', { src: `/api/avatar/${u.id}?v=${u.avatarVer}`, alt: '', loading: 'lazy' });
      img.onerror = () => { img.remove(); el.prepend(initials(u.name)); };
      el.append(img);
    } else el.append(initials(u.name));
    if (withPresence) el.append(h('span', { class: 'presence ' + stateOf(u.id), title: STATUS_LABEL[stateOf(u.id)] }));
    return el;
  }

  // linkify + highlight @mentions, without innerHTML
  function richText(text) {
    const frag = document.createDocumentFragment();
    const re = /(https?:\/\/[^\s<]+[^\s<.,;:!?)\]'"])|(@[a-z0-9_.]{3,20})/gi;
    let last = 0, m;
    while ((m = re.exec(text))) {
      if (m.index > last) frag.append(text.slice(last, m.index));
      if (m[1]) frag.append(h('a', { href: m[1], target: '_blank', rel: 'noopener noreferrer' }, m[1]));
      else frag.append(h('span', { class: 'mention-tag' }, m[2]));
      last = m.index + m[0].length;
    }
    frag.append(text.slice(last));
    return frag;
  }

  // ---------------------------------------------------------------- theme
  const THEMES = [
    { id: 'veya', name: 'VEYA Night', desc: 'Signature purple dusk' },
    { id: 'veyaday', name: 'VEYA Day', desc: 'Soft lavender daylight' },
    { id: 'morning', name: 'Kamand Morning', desc: 'Fresh valley daylight' },
    { id: 'night', name: 'Shivalik Night', desc: 'Stars over the ridges' },
    { id: 'snow', name: 'Himalayan Snow', desc: 'Crisp, icy and bright' },
    { id: 'buransh', name: 'Buransh Bloom', desc: 'Rhododendron reds & pinks' },
    { id: 'apple', name: 'Kinnaur Apple', desc: 'Orchard reds, leafy greens' },
    { id: 'deodar', name: 'Deodar Forest', desc: 'Deep pine greens, lamplight' },
    { id: 'sunset', name: 'Sunset over Uhl', desc: 'Purple dusk, warm orange' },
    { id: 'aurora', name: 'Spiti Starlight', desc: 'Cold-desert night sky' },
  ];
  function applyTheme(id, sync = true) {
    if (!THEMES.some((t) => t.id === id)) return;
    document.documentElement.dataset.theme = id;
    store.set('kc-theme', id);
    if (sync && S.token && S.me) api('PATCH', '/api/me', { theme: id }).then((r) => (S.me = r.me)).catch(() => {});
    else if (sync) store.set('kc-theme-pending', id);
  }
  function valleySvg() {
    const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const u = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    u.setAttribute('href', '#valley'); s.append(u); return s;
  }
  function openThemePicker() {
    const cur = document.documentElement.dataset.theme;
    const close = modal('🎨 Choose a theme', [
      h('p', { class: 'hint', style: 'margin:0' }, 'Every theme is a different mood of the Kamand valley. Your choice syncs to your account.'),
      h('div', { class: 'theme-grid' }, THEMES.map((t) => h('button', {
        class: 'theme-card' + (t.id === cur ? ' active' : ''), 'data-theme': t.id, type: 'button',
        onclick: () => { applyTheme(t.id); close(); toast(`Theme: ${t.name}`); },
      },
      h('div', { class: 'scene' }, valleySvg()),
      h('div', { class: 'info' }, h('b', {}, t.name), h('small', {}, t.desc),
        h('div', { class: 'sw' }, ['--accent', '--marigold', '--river', '--rail', '--panel'].map((v) => h('i', { style: `background:var(${v})` }))))))),
    ], { wide: true });
  }
  document.addEventListener('click', (e) => { if (e.target.closest('[data-theme-picker]')) openThemePicker(); });

  // ---------------------------------------------------------------- auth
  let RULES = [];
  async function showAuth() {
    $('#app').hidden = true;
    $('#auth').hidden = false;
    if (pendingCheckin && !$('.auth-card .checkin-note')) $('.auth-card .brand').after(h('div', { class: 'checkin-note clash-box', style: 'margin-bottom:12px' }, '📷 Sign in to mark your attendance. It’s recorded automatically right after you sign in.'));
    try {
      const r = await api('GET', '/api/password-rules');
      RULES = r.rules.map((x) => ({ re: new RegExp(x.pattern), msg: x.msg }));
      $('#email-hint').textContent = r.emailDomain ? `Use your @${r.emailDomain} address.` : 'Your institute email is recommended.';
      renderRules('');
    } catch {}
  }

  function setTab(name) {
    $$('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
    $('#signin-form').hidden = name !== 'signin';
    $('#signup-form').hidden = name !== 'signup';
    $$('.form-error').forEach((e) => (e.textContent = ''));
  }
  $$('.tab').forEach((t) => t.addEventListener('click', () => setTab(t.dataset.tab)));
  $$('[data-goto]').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); setTab(a.dataset.goto); }));
  $$('.pw-eye').forEach((b) => b.addEventListener('click', () => {
    const inp = b.previousElementSibling; const show = inp.type === 'password';
    inp.type = show ? 'text' : 'password'; b.textContent = show ? 'Hide' : 'Show';
  }));

  function renderRules(pw) {
    const ul = $('#pw-rules'); ul.replaceChildren();
    let ok = 0;
    for (const r of RULES) { const pass = r.re.test(pw); ok += pass; ul.append(h('li', { class: pass ? 'ok' : '' }, r.msg)); }
    const pct = RULES.length ? Math.round((ok / RULES.length) * 100) : 0;
    const bar = $('.strength span');
    bar.style.width = pw ? pct + '%' : '0';
    bar.style.background = pct < 50 ? 'var(--danger)' : pct < 100 ? 'var(--marigold)' : 'var(--accent)';
  }
  $('#signup-form [name=password]').addEventListener('input', (e) => renderRules(e.target.value));

  $('#signin-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target, err = $('.form-error', f), btn = $('button[type=submit]', f);
    err.textContent = ''; btn.disabled = true;
    try {
      const r = await api('POST', '/api/signin', { login: f.login.value, password: f.password.value });
      onAuthed(r.token);
    } catch (ex) { err.textContent = ex.message; } finally { btn.disabled = false; }
  });

  $('#signup-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target, err = $('.form-error', f), btn = $('button[type=submit]', f);
    err.textContent = '';
    const failing = RULES.filter((r) => !r.re.test(f.password.value));
    if (failing.length) return (err.textContent = 'Password needs ' + failing.map((r) => r.msg).join(', ') + '.');
    if (f.password.value !== f.confirm.value) return (err.textContent = 'Passwords don’t match.');
    btn.disabled = true;
    try {
      const r = await api('POST', '/api/signup', { name: f.name.value, username: f.username.value, email: f.email.value, password: f.password.value });
      onAuthed(r.token, true);
    } catch (ex) { err.textContent = ex.message; } finally { btn.disabled = false; }
  });

  function onAuthed(token, isNew) {
    S.token = token; store.set('kc-token', token);
    S.view = 'clubs'; S.fresh = true;
    start().then(() => showWelcome(isNew));
  }

  // full-screen greeting shown right after sign in / sign up
  function showWelcome(isNew) {
    if (!S.me) return;
    const w = $('#welcome');
    const first = S.me.name.split(' ')[0];
    const go = () => { w.classList.add('out'); setTimeout(() => { w.hidden = true; w.classList.remove('out'); }, 450); };
    w.replaceChildren(h('div', {},
      h('img', { class: 'w-logo', src: 'img/logo.png', alt: 'VEYA' }),
      h('h1', {}, `Welcome${isNew ? '' : ' back'}, ${first} 👋`),
      h('h2', {}, 'Welcome to VEYA'),
      h('p', {}, isNew ? 'Join a few clubs to fill your chats and updates.' : 'Here’s what’s happening across campus.'),
      h('div', { style: 'display:flex;gap:10px;justify-content:center;flex-wrap:wrap' },
        h('button', { class: 'btn primary', type: 'button', onclick: go }, 'Explore clubs →'),
        isNew ? h('button', { class: 'btn', type: 'button', style: 'background:transparent;color:#fff;border-color:rgba(255,255,255,.4)', onclick: () => { go(); setTimeout(openSettings, 300); } }, '🎓 Set up my profile') : null)));
    w.hidden = false;
    clearTimeout(S.welcomeTimer);
    S.welcomeTimer = setTimeout(go, isNew ? 7000 : 4200);
  }

  function signOut() {
    S.socket?.disconnect();
    S.token = null; store.set('kc-token', null);
    S.cache.clear(); S.unread.clear(); S.mentions.clear(); S.dms.clear();
    $('#modal-root').replaceChildren();
    $$('form', $('#auth')).forEach((f) => f.reset());
    setTab('signin');
    showAuth();
  }

  // ---------------------------------------------------------------- boot
  async function start() {
    let b;
    try { b = await api('GET', '/api/bootstrap'); } catch { return signOut(); }
    S.me = b.me; S.communities = b.communities;
    S.users = new Map(b.users.map((u) => [u.id, u]));
    S.presence = new Map(Object.entries(b.presence || {}));
    S.tenor = !!b.tenor;
    S.clubs = b.clubs || [];
    S.groups = b.groups || [];
    S.customStickers = b.stickers || [];
    const localPick = store.get('kc-theme-pending');
    if (localPick) { store.set('kc-theme-pending', null); applyTheme(localPick, true); }
    else if (S.me.theme) applyTheme(S.me.theme, false);
    S.dms = new Map(b.dms.map((d) => [d.room, d.lastTs]));
    const last = store.get('kc-last');
    if (last && !S.fresh) { try { const l = JSON.parse(last); S.view = l.view || 'clubs'; S.room = l.room || S.room; } catch {} }
    S.fresh = false;
    if (!['chat', 'clubs', 'groups', 'news', 'schedule', 'map', 'care'].includes(S.view)) S.view = 'clubs';
    if (!roomInfo(S.room)) S.room = 'campus/general';
    $('#auth').hidden = true; $('#app').hidden = false;
    connect();
    render();
    loadEvents();
    if (pendingCheckin) { try { sessionStorage.removeItem('veya-checkin'); } catch {} doCheckin(pendingCheckin.id, pendingCheckin.code); }
  }

  function remember() { store.set('kc-last', JSON.stringify({ view: S.view, room: S.room })); }

  // ---------------------------------------------------------------- socket
  function connect() {
    S.socket?.disconnect();
    const sock = io({ auth: { token: S.token } });
    S.socket = sock;
    sock.on('connect_error', (e) => { if (e.message === 'unauthorized') signOut(); });
    sock.on('connect', () => { // refresh the open room after reconnects
      if (S.view === 'chat') { S.cache.delete(S.room); openRoom(S.room, true); }
    });
    sock.on('message:new', onMessage);
    sock.on('message:update', onMessageUpdate);
    sock.on('typing', onTyping);
    sock.on('presence', ({ userId, state, lastSeen }) => {
      if (state === 'offline') S.presence.delete(userId); else S.presence.set(userId, state);
      const u = S.users.get(userId); if (u && lastSeen !== undefined) u.lastSeen = lastSeen;
      if (userId === S.me.id) renderRail();
      if (S.view === 'chat') { renderSidebar(); renderChatHeader(); }
    });
    sock.on('user:new', (u) => { S.users.set(u.id, u); if (S.view === 'chat') renderSidebar(); });
    sock.on('user:update', (u) => { S.users.set(u.id, u); if (u.id === S.me.id) Object.assign(S.me, u); if (S.view === 'chat') { renderMessages(); renderChatHeader(); } if (S.view === 'chat') renderSidebar(); renderRail(); });
    sock.on('events:changed', (p) => {
      if (p.reason === 'new' && p.by !== S.me.id) {
        const c = S.communities.find((x) => x.id === p.communityId);
        toast(`📰 New event: ${p.title}${c ? ' · ' + c.short : ''}`, 'info');
        if (S.view !== 'news') { S.newsDot = true; renderRail(); }
      }
      loadEvents();
    });
    sock.on('places:changed', (p) => {
      if (p.added && p.by !== S.me.username) toast(`📍 @${p.by} added “${p.added}” to the campus map`, 'info');
      if (S.placesLoaded) loadPlaces();
    });
    sock.on('groups:changed', () => reloadGroups());
    sock.on('groups:request', (p) => toast(`⏳ ${p.name} asked to join ${p.group}. Open Groups → Details to approve.`, 'info'));
    sock.on('groups:approved', (p) => toast(`✅ You were added to ${p.group}`));
    sock.on('settings:changed', (p) => {
      if (typeof p.tenor === 'boolean') { S.tenor = p.tenor; if (pickerState) renderPicker(); }
    });
    sock.on('events:attendance', ({ id, count }) => {
      const ev = S.events.find((x) => x.id === id);
      if (ev) { ev.attendanceCount = count; if (S.view === 'news') renderNews(); }
    });
    sock.on('club:members', ({ room, members }) => {
      const c = S.clubs.find((x) => x.room === room); if (c) c.members = members;
      if (S.view === 'clubs') renderClubs();
    });
    sock.on('clubs:changed', async (p) => {
      if (p.name && p.by !== S.me.id) toast(`🧩 New club: ${p.name}`, 'info');
      await reloadClubs();
    });
    sock.on('stickers:changed', async () => { try { S.customStickers = (await api('GET', '/api/stickers')).stickers; } catch {} if (pickerState?.tab === 'stickers') renderPicker(); });
    sock.on('events:rsvp', ({ id, rsvpCount }) => {
      const ev = S.events.find((e) => e.id === id);
      if (ev) { ev.rsvpCount = rsvpCount; if (S.view === 'news') renderNews(); }
    });
  }

  const isDm = (room) => room.startsWith('dm:');
  const dmOther = (room) => room.slice(3).split(':').find((x) => x !== S.me.id);
  const dmRoom = (userId) => 'dm:' + [S.me.id, userId].sort().join(':');

  function roomInfo(room) {
    if (isDm(room)) {
      const u = S.users.get(dmOther(room));
      return u ? { dm: true, user: u, title: u.name, desc: '@' + u.username } : null;
    }
    if (room.startsWith('group/')) {
      const g = S.groups.find((x) => x.room === room);
      return g && ['admin', 'member'].includes(g.role) ? { group: g, community: { id: 'group', short: g.type }, sub: { id: g.id, name: g.name }, title: g.name, icon: g.icon, desc: g.desc || `${g.type} group · ${g.members} members` } : null;
    }
    if (room.startsWith('club/')) {
      const c = S.clubs.find((x) => x.room === room);
      return c ? { club: c, community: { id: 'club', short: c.cat }, sub: { id: room.slice(5), name: c.name }, title: c.name, icon: c.icon, desc: c.desc } : null;
    }
    const [cid, sid] = room.split('/');
    const c = S.communities.find((x) => x.id === cid);
    const s = c?.subs.find((x) => x.id === sid);
    return s ? { community: c, sub: s, title: s.id === 'general' ? `${c.short} Lounge` : s.name, icon: s.icon, desc: s.desc, adminOnly: !!s.adminOnly, club: S.clubs.find((x) => x.room === room) } : null;
  }

  // a club you haven't joined behaves like a muted room (no badges)
  const notJoined = (room) => { if (room.startsWith('campus/')) return false; const c = S.clubs.find((x) => x.room === room); return !!c && !c.joined; };
  const isRoomMuted = (room) => S.me.mutedRooms.includes(room) || notJoined(room) || (isDm(room) && S.me.mutedUsers.includes(dmOther(room)));
  async function reloadClubs() {
    try { S.clubs = (await api('GET', '/api/bootstrap')).clubs; } catch { return; }
    if (S.view === 'clubs') renderClubs();
    if (S.view === 'chat') renderSidebar();
  }

  function onMessage(msg) {
    if (S.me.blocked.includes(msg.from)) return;
    const c = S.cache.get(msg.room);
    if (c?.loaded) c.messages.push(msg);
    if (isDm(msg.room)) { S.dms.set(msg.room, msg.ts); }
    const viewing = S.view === 'chat' && S.room === msg.room && document.visibilityState === 'visible';
    if (msg.from !== S.me.id && !viewing) {
      const muted = isRoomMuted(msg.room) || S.me.mutedUsers.includes(msg.from);
      const mention = new RegExp('@' + S.me.username + '\\b', 'i').test(msg.text);
      if (!muted || mention) {
        S.unread.set(msg.room, (S.unread.get(msg.room) || 0) + 1);
        if (mention || isDm(msg.room)) S.mentions.set(msg.room, (S.mentions.get(msg.room) || 0) + 1);
      }
      maybeNotify(msg, mention, muted);
    }
    // clear typing for sender
    S.typing.get(msg.room)?.delete(msg.from);
    if (S.view === 'chat' && S.room === msg.room) { renderMessages(); renderTyping(); }
    renderRail(); renderSidebar(); updateTitle();
  }

  function onMessageUpdate(msg) {
    const c = S.cache.get(msg.room);
    if (c?.loaded) {
      const i = c.messages.findIndex((m) => m.id === msg.id);
      if (i >= 0) c.messages[i] = msg;
      c.pinned = c.pinned.filter((m) => m.id !== msg.id);
      if (msg.pinned) c.pinned.push(msg);
    }
    if (S.view === 'chat' && S.room === msg.room) { renderPinbar(); renderMessages(); }
  }

  function onTyping({ room, userId }) {
    if (S.me.blocked.includes(userId)) return;
    if (!S.typing.has(room)) S.typing.set(room, new Map());
    const m = S.typing.get(room);
    clearTimeout(m.get(userId));
    m.set(userId, setTimeout(() => { m.delete(userId); renderTyping(); }, 3500));
    renderTyping();
  }

  function maybeNotify(msg, mention, muted) {
    if (muted && !mention) return;
    if (S.me.status === 'dnd') return;
    if (!(isDm(msg.room) || mention)) return;
    if (document.visibilityState === 'visible' || !('Notification' in window) || Notification.permission !== 'granted') return;
    const u = S.users.get(msg.from);
    const n = new Notification(isDm(msg.room) ? u?.name || 'New message' : `${u?.name} mentioned you`, { body: msgPreview(msg).slice(0, 120), tag: msg.room });
    n.onclick = () => { window.focus(); openRoom(msg.room); n.close(); };
  }

  function updateTitle() {
    let n = 0; for (const [r, c] of S.unread) if (!isRoomMuted(r)) n += c;
    document.title = (n ? `(${n}) ` : '') + 'VEYA';
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && S.view === 'chat' && S.me) { clearUnread(S.room); renderRail(); renderSidebar(); }
  });

  function clearUnread(room) { S.unread.delete(room); S.mentions.delete(room); updateTitle(); }

  // ---------------------------------------------------------------- render: rail
  function render() { renderRail(); renderSidebar(); renderMain(); }

  function navItem({ icon, label, active, onclick, badge, dot }) {
    return h('button', { class: 'nav-item' + (active ? ' active' : ''), onclick, type: 'button', 'aria-label': label },
      h('span', { class: 'ni' }, icon), label,
      badge ? h('span', { class: 'badge' }, badge > 99 ? '99+' : badge) : null,
      dot ? h('span', { class: 'dot-new' }) : null);
  }

  function totalChatUnread() {
    let n = 0; for (const [r, c] of S.unread) if (!isRoomMuted(r)) n += c;
    let m = 0; for (const [, c] of S.mentions) m += c;
    return { n, m };
  }

  function renderRail() {
    const rail = $('#rail');
    const u = totalChatUnread();
    rail.replaceChildren(
      h('button', { class: 'logo-btn', type: 'button', title: 'VEYA', onclick: () => setView('clubs') }, h('img', { src: 'img/logo-192.png', alt: 'VEYA' })),
      navItem({ icon: '💬', label: 'Chats', active: S.view === 'chat', badge: u.m || u.n, onclick: () => setView('chat') }),
      navItem({ icon: '🧩', label: 'Clubs', active: S.view === 'clubs', onclick: () => setView('clubs') }),
      navItem({ icon: '👥', label: 'Groups', active: S.view === 'groups', badge: S.groups.reduce((n, g) => n + (g.requests || 0), 0), onclick: () => setView('groups') }),
      navItem({ icon: '📰', label: 'Updates', active: S.view === 'news', dot: S.newsDot, onclick: () => setView('news') }),
      navItem({ icon: '🗓️', label: 'Planner', active: S.view === 'schedule', onclick: () => setView('schedule') }),
      navItem({ icon: '🗺️', label: 'Map', active: S.view === 'map', onclick: () => setView('map') }),
      navItem({ icon: '💚', label: 'Care', active: S.view === 'care', onclick: () => setView('care') }),
      h('div', { class: 'spacer' }),
      navItem({ icon: '🎨', label: 'Theme', onclick: openThemePicker }),
      h('button', { class: 'me-btn', onclick: (e) => openStatusMenu(e.currentTarget), 'aria-label': 'Status, profile & settings', title: 'Status & profile', type: 'button' }, avatar(S.me, '', true)),
      navItem({ icon: '🚪', label: 'Log out', onclick: () => confirmBox('Log out?', 'You can sign back in any time.', 'Log out', signOut) }),
    );
  }

  function setView(v) {
    S.view = v;
    if (v === 'news') { S.newsDot = false; loadEvents(); }
    if (v === 'schedule') loadSchedule();
    if (v === 'chat' && !roomInfo(S.room)) S.room = 'campus/general';
    remember(); render(); closeSide();
    if (v === 'chat') openRoom(S.room, true);
  }

  const openSide = () => $('#app').classList.add('side-open');
  const closeSide = () => $('#app').classList.remove('side-open');
  $('#scrim').addEventListener('click', closeSide);

  // ---------------------------------------------------------------- render: sidebar
  function banner(title, sub) {
    return h('div', { class: 'side-banner' },
      (() => { const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); const u = document.createElementNS('http://www.w3.org/2000/svg', 'use'); u.setAttribute('href', '#valley'); s.append(u); return s; })(),
      h('div', { class: 'title' }, h('h2', {}, title), sub ? h('p', {}, sub) : null));
  }

  function roomButton(room, icon, name) {
    const unread = S.unread.get(room) || 0, ment = S.mentions.get(room) || 0, muted = isRoomMuted(room);
    return h('button', {
      class: 'room' + (S.view === 'chat' && S.room === room ? ' active' : '') + (unread && !muted ? ' unread' : '') + (muted ? ' muted' : ''),
      type: 'button', onclick: () => openRoom(room),
    },
    h('span', { class: 'ico' }, icon), h('span', { class: 'nm' }, name),
    muted ? h('span', { class: 'muted-ico', title: 'Muted' }, '🔕') : null,
    ment ? h('span', { class: 'badge' }, ment) : (unread && !muted ? h('span', { class: 'badge soft' }, unread) : null));
  }

  function renderSidebar() {
    const sb = $('#sidebar');
    $('#app').classList.toggle('no-side', S.view !== 'chat');
    if (S.view !== 'chat') return sb.replaceChildren();
    const seg = h('div', { class: 'seg full' },
      h('button', { type: 'button', class: S.chatTab === 'channels' ? 'active' : '', onclick: () => { S.chatTab = 'channels'; renderSidebar(); } }, '# Channels'),
      h('button', { type: 'button', class: S.chatTab === 'dms' ? 'active' : '', onclick: () => { S.chatTab = 'dms'; renderSidebar(); } }, '@ Direct'));
    if (S.chatTab === 'dms') return renderDmSidebar(sb, seg);
    const campus = S.communities.find((c) => c.id === 'campus');
    const lounges = S.communities.filter((c) => c.id !== 'campus').map((c) => ({ room: `${c.id}/general`, icon: c.icon, name: `${c.short} Lounge` }));
    const mine = S.clubs.filter((c) => c.joined);
    const byCat = {};
    for (const c of mine) (byCat[c.cat] ||= []).push(c);
    sb.replaceChildren(
      h('div', { class: 'side-title' }, 'Chats'),
      seg,
      h('div', { class: 'side-body' },
        h('div', { class: 'side-section' }, 'Campus'),
        campus.subs.map((s) => { const b = roomButton(`campus/${s.id}`, s.icon, s.id === 'general' ? 'Campus Lounge' : s.name); if (s.adminOnly) b.append(h('span', { class: 'lock', title: 'Only the core team can post' }, '🔒')); return b; }),
        h('div', { class: 'side-section' }, 'Society lounges'),
        lounges.map((l) => roomButton(l.room, l.icon, l.name)),
        h('div', { class: 'side-section' }, `My groups · ${S.groups.filter((g) => ['admin', 'member'].includes(g.role)).length}`),
        S.groups.filter((g) => ['admin', 'member'].includes(g.role)).length
          ? S.groups.filter((g) => ['admin', 'member'].includes(g.role)).map((g) => roomButton(g.room, g.icon, g.name))
          : h('p', { class: 'hint', style: 'padding:0 10px' }, 'No groups yet. Make one for your batch or branch in 👥 Groups.'),
        h('div', { class: 'side-section' }, `My clubs · ${mine.length}`),
        mine.length ? Object.entries(byCat).map(([cat, list]) => [h('div', { class: 'side-group' }, cat), list.map((c) => roomButton(c.room, c.icon, c.name))])
          : h('p', { class: 'hint', style: 'padding:0 10px' }, 'You haven’t joined any clubs yet.'),
        h('div', { style: 'padding:10px 4px' }, h('button', { class: 'btn small block', type: 'button', onclick: () => setView('clubs') }, '🧩 Browse clubs'))));
  }

  function renderDmSidebar(sb, seg) {
    const q = S.dmSearch.toLowerCase();
    const others = [...S.users.values()].filter((u) => u.id !== S.me.id && (!q || [u.name, u.username, u.branch, branchAbbr(u.branch), u.batch, u.from, ...(u.passions || [])].join(' ').toLowerCase().includes(q)));
    others.sort((a, b) => {
      const ta = S.dms.get(dmRoom(a.id)) || '', tb = S.dms.get(dmRoom(b.id)) || '';
      if (ta !== tb) return tb.localeCompare(ta);
      if (isOn(a.id) !== isOn(b.id)) return isOn(a.id) ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    const recent = others.filter((u) => S.dms.has(dmRoom(u.id)));
    const rest = others.filter((u) => !S.dms.has(dmRoom(u.id)));
    const row = (u) => {
      const room = dmRoom(u.id);
      const unread = S.unread.get(room) || 0, muted = isRoomMuted(room), blocked = S.me.blocked.includes(u.id);
      return h('button', { class: 'room' + (S.view === 'chat' && S.room === room ? ' active' : '') + (unread && !muted ? ' unread' : '') + (muted || blocked ? ' muted' : ''), type: 'button', onclick: () => openRoom(room) },
        avatar(u, 'sm', true), h('span', { class: 'nm' }, u.name),
        blocked ? h('span', { class: 'muted-ico', title: 'Blocked' }, '⛔') : muted ? h('span', { class: 'muted-ico' }, '🔕') : null,
        unread && !muted ? h('span', { class: 'badge' }, unread) : null);
    };
    const input = h('input', { placeholder: 'Search people, branch, batch…', value: S.dmSearch, oninput: (e) => { S.dmSearch = e.target.value; renderSidebar(); const i = $('.side-search input'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); } });
    sb.replaceChildren(
      h('div', { class: 'side-title' }, 'Chats', h('small', { class: 'hint' }, `${[...S.presence.values()].length} online`)),
      seg,
      h('div', { class: 'side-body' },
        h('div', { class: 'side-search' }, input),
        recent.length ? [h('div', { class: 'side-section' }, 'Recent'), recent.map(row)] : null,
        h('div', { class: 'side-section' }, `People · ${rest.length}`),
        rest.length ? rest.map(row) : h('p', { class: 'hint', style: 'padding:0 10px' }, q ? 'No one matches that.' : 'Invite your batchmates to sign up!')),
    );
  }

  function renderNewsSidebar(sb) {
    const counts = {};
    for (const e of S.events) counts[e.communityId] = (counts[e.communityId] || 0) + 1;
    const going = S.events.filter((e) => e.going).length;
    const clashing = S.events.filter((e) => e.going && e.clashes.length).length;
    const item = (id, icon, name, n) => h('button', { class: 'room' + (S.newsFilter === id ? ' active' : ''), type: 'button', onclick: () => { S.newsFilter = id; renderSidebar(); renderNews(); closeSide(); } },
      h('span', { class: 'ico' }, icon), h('span', { class: 'nm' }, name), n ? h('span', { class: 'badge soft' }, n) : null);
    sb.replaceChildren(
      banner('News & Events', 'Never miss what’s happening on campus'),
      h('div', { class: 'side-body' },
        h('div', { style: 'padding:6px 4px' }, h('button', { class: 'btn primary block', type: 'button', onclick: openEventForm }, '＋ Post an event')),
        h('div', { class: 'side-section' }, 'Show'),
        item('all', '🗞️', 'All upcoming', S.events.length),
        item('going', '✅', 'I’m going', going),
        item('clash', '⚠️', 'Clashes with my schedule', clashing),
        h('div', { class: 'side-section' }, 'By community'),
        S.communities.map((c) => item(c.id, c.icon, c.short, counts[c.id]))),
    );
  }

  function renderScheduleSidebar(sb) {
    const tips = [
      ['add DSA lecture mon 9-10am', 'weekly class'],
      ['add Robotronics meet fri 18:00-19:30', 'club meeting'],
      ['free tomorrow 60', 'find a free hour'],
      ['check sat 16-18', 'is this slot free?'],
      ['week', 'next 7 days'],
    ];
    sb.replaceChildren(
      banner('Schedule Planner', 'Plan your week, dodge the clashes'),
      h('div', { class: 'side-body' },
        h('div', { class: 'side-section' }, 'Try saying'),
        tips.map(([cmd, what]) => h('button', { class: 'room', type: 'button', onclick: () => { sendBot(cmd); closeSide(); } }, h('span', { class: 'ico' }, '›'), h('span', { class: 'nm' }, h('b', {}, cmd), h('br'), h('small', { class: 'hint' }, what)))),
        h('div', { class: 'side-section' }, 'How clashes work'),
        h('p', { class: 'hint', style: 'padding:0 10px' }, 'The bot checks your classes, club meetings and every event you RSVP to in News. Clashing blocks turn red in the week view, and the bot suggests the nearest free slot.')),
    );
  }

  // ---------------------------------------------------------------- render: main
  function renderMain() {
    $('#app').classList.toggle('no-side', S.view !== 'chat');
    if (S.view !== 'care') stopBreathing();
    if (S.view === 'clubs') return renderClubs();
    if (S.view === 'care') return renderCare();
    if (S.view === 'groups') return renderGroups();
    if (S.view !== 'map' && S.leaflet) { S.leaflet.remove(); S.leaflet = null; S.markerLayer = null; }
    if (S.view === 'map') return renderMap();
    if (S.view === 'news') return renderNews();
    if (S.view === 'schedule') return renderSchedule();
    renderChat();
  }

  const menuBtn = () => h('button', { class: 'icon-btn menu-btn', type: 'button', onclick: openSide, 'aria-label': 'Open sidebar' }, '☰');

  async function openRoom(room, silent) {
    if (!roomInfo(room)) return;
    S.room = room; S.view = 'chat';
    if (isDm(room)) S.chatTab = 'dms';
    clearUnread(room);
    remember();
    if (!silent) closeSide();
    render();
    if (!S.cache.get(room)?.loaded) {
      try {
        const r = await api('GET', '/api/messages?room=' + encodeURIComponent(room));
        S.cache.set(room, { messages: r.messages, pinned: r.pinned, loaded: true, hasMore: r.messages.length >= 100 });
      } catch (e) { toast(e.message, 'warn'); return; }
      if (S.room === room && S.view === 'chat') { renderPinbar(); renderMessages(true); }
    }
  }

  function renderChat() {
    const main = $('#main');
    const info = roomInfo(S.room);
    main.replaceChildren(
      h('div', { class: 'topbar', id: 'chat-top' }),
      h('div', { id: 'pinbar' }),
      h('div', { class: 'messages', id: 'messages' }),
      h('div', { class: 'typing', id: 'typing' }),
      h('div', { id: 'composer' }),
    );
    renderChatHeader(); renderPinbar(); renderMessages(true); renderTyping(); renderComposer();
    if (info) setTimeout(() => $('#composer textarea')?.focus(), 0);
  }

  function renderChatHeader() {
    const top = $('#chat-top'); if (!top) return;
    const info = roomInfo(S.room);
    const muted = isRoomMuted(S.room);
    const pinCount = S.cache.get(S.room)?.pinned.length || 0;
    const left = info.dm
      ? [avatar(info.user, '', true), h('div', { class: 't' }, h('h3', {}, info.title, S.me.blocked.includes(info.user.id) ? h('span', { class: 'pill warn' }, 'Blocked') : null), h('p', {}, h('span', { class: 'status-dot ' + stateOf(info.user.id) }), statusLabel(info.user) + ' · ' + info.desc + (info.user.statusText ? ' · “' + info.user.statusText + '”' : '')))]
      : [h('div', { class: 't' }, h('h3', {}, h('span', {}, info.icon), info.title, h('span', { class: 'pill' }, info.community.short), info.adminOnly ? h('span', { class: 'pill gold' }, '🔒 Core team posts') : null), h('p', {}, info.desc)),
        info.group ? h('button', { class: 'btn small', type: 'button', onclick: () => openGroupDetails(info.group) }, '👥 Members') : null,
        info.club && !info.club.joined ? h('button', { class: 'btn small primary', type: 'button', onclick: async () => { await joinClub(info.club, true); renderChatHeader(); renderSidebar(); } }, 'Join club') : null];
    top.replaceChildren(
      menuBtn(), ...left,
      h('button', { class: 'icon-btn' + (pinCount ? ' on' : ''), title: `Pinned messages (${pinCount})`, type: 'button', onclick: openPins }, '📌'),
      h('button', { class: 'icon-btn' + (muted ? ' on' : ''), title: muted ? 'Unmute' : 'Mute notifications', type: 'button', onclick: toggleMuteRoom }, muted ? '🔕' : '🔔'),
      ...(info.dm ? [h('button', { class: 'icon-btn', title: 'Profile, block, mute', type: 'button', onclick: () => openProfile(info.user.id) }, '⋯')] : []),
    );
  }

  function renderPinbar() {
    const bar = $('#pinbar'); if (!bar) return;
    const pins = S.cache.get(S.room)?.pinned || [];
    renderChatHeader();
    if (!pins.length) return bar.replaceChildren();
    const latest = pins[pins.length - 1];
    const u = S.users.get(latest.from);
    bar.replaceChildren(h('div', { class: 'pinbar', onclick: openPins, title: 'See all pinned messages' },
      '📌', h('span', { class: 'txt' }, h('b', {}, (u?.name || 'Someone') + ': '), msgPreview(latest)),
      pins.length > 1 ? h('span', { class: 'pill gold' }, `+${pins.length - 1} more`) : null));
  }

  function renderMessages(forceBottom) {
    const box = $('#messages'); if (!box) return;
    const c = S.cache.get(S.room);
    const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 120;
    const prevHeight = box.scrollHeight, prevTop = box.scrollTop;
    if (!c?.loaded) return box.replaceChildren(h('div', { class: 'empty' }, 'Loading…'));
    const list = c.messages.filter((m) => !S.me.blocked.includes(m.from));
    const info = roomInfo(S.room);
    if (!list.length) {
      return box.replaceChildren(h('div', { class: 'empty' },
        h('div', { class: 'big' }, info.dm ? '👋' : info.icon),
        h('h3', {}, info.dm ? `Say hi to ${info.user.name}` : `Welcome to ${info.title}`),
        h('p', {}, info.dm ? 'This is the beginning of your conversation.' : info.desc + ' — be the first to post!')));
    }
    const frag = document.createDocumentFragment();
    if (c.hasMore) frag.append(h('button', { class: 'btn small load-more', type: 'button', onclick: loadOlder }, 'Load earlier messages'));
    let prev = null, prevDay = null;
    const mentionRe = new RegExp('@' + S.me.username + '\\b', 'i');
    for (const m of list) {
      const d = new Date(m.ts);
      const dk = dateKey(d);
      if (dk !== prevDay) { frag.append(h('div', { class: 'day-sep' }, dayLabel(d))); prev = null; prevDay = dk; }
      const first = !prev || prev.from !== m.from || d - new Date(prev.ts) > 5 * 60e3;
      const u = S.users.get(m.from) || { name: 'Unknown', color: '#888' };
      const mine = m.from === S.me.id;
      const actions = m.deleted ? null : h('div', { class: 'actions' },
        h('button', { class: 'icon-btn', title: 'React', type: 'button', onclick: (e) => openQuickReact(m, e.currentTarget.closest('.msg')) }, '😊'),
        h('button', { class: 'icon-btn', title: m.pinned ? 'Unpin' : 'Pin', type: 'button', onclick: () => pinMessage(m) }, m.pinned ? '📍' : '📌'),
        !mine ? h('button', { class: 'icon-btn', title: 'Reply with mention', type: 'button', onclick: () => insertMention(u) }, '↩️') : null,
        mine ? h('button', { class: 'icon-btn', title: 'Delete', type: 'button', onclick: () => deleteMessage(m) }, '🗑️') : null);
      const body = messageContent(m);
      frag.append(h('div', { class: 'msg' + (first ? ' first' : '') + (m.pinned ? ' pinned' : '') + (!mine && mentionRe.test(m.text || '') ? ' mention' : ''), 'data-id': m.id },
        first ? h('div', { style: 'cursor:pointer', onclick: () => openProfile(m.from) }, avatar(u, '', true)) : h('div', { class: 'gutter' }, timeStr(m.ts)),
        h('div', {},
          first ? h('div', { class: 'head' }, h('button', { class: 'who', style: `color:${u.color}`, type: 'button', onclick: () => openProfile(m.from) }, u.name), u.admin ? h('span', { class: 'core-pill', title: 'Core team' }, 'CORE') : null, h('span', { class: 'time' }, timeStr(m.ts))) : null,
          body, m.deleted ? null : reactionsRow(m)),
        actions));
      prev = m;
    }
    box.replaceChildren(frag);
    if (forceBottom || nearBottom) box.scrollTop = box.scrollHeight;
    else box.scrollTop = prevTop + (box.scrollHeight - prevHeight) * 0; // keep position
  }

  async function loadOlder() {
    const c = S.cache.get(S.room); if (!c?.messages.length) return;
    const box = $('#messages'); const before = box.scrollHeight;
    const r = await api('GET', `/api/messages?room=${encodeURIComponent(S.room)}&before=${encodeURIComponent(c.messages[0].ts)}`);
    c.messages = [...r.messages, ...c.messages];
    c.hasMore = r.messages.length >= 100;
    renderMessages();
    box.scrollTop = box.scrollHeight - before;
  }

  function renderTyping() {
    const el = $('#typing'); if (!el) return;
    const ids = [...(S.typing.get(S.room)?.keys() || [])].filter((id) => id !== S.me.id);
    const names = ids.map((id) => S.users.get(id)?.name.split(' ')[0]).filter(Boolean);
    el.textContent = !names.length ? '' : names.length === 1 ? `${names[0]} is typing…` : names.length < 4 ? `${names.join(', ')} are typing…` : 'Several people are typing…';
  }

  function renderComposer() {
    const box = $('#composer');
    const info = roomInfo(S.room);
    if (info.dm && S.me.blocked.includes(info.user.id)) {
      return box.replaceChildren(h('div', { class: 'notice' }, `You blocked ${info.user.name}. You won’t see their messages and they can’t DM you.`,
        h('button', { class: 'btn small', type: 'button', onclick: () => toggleBlock(info.user.id) }, 'Unblock')));
    }
    if (info.adminOnly && !S.me.admin) {
      return box.replaceChildren(h('div', { class: 'notice' }, '📢 Only the core team can post announcements here. You’ll get every update in this channel.'));
    }
    let lastTyping = 0;
    const ta = h('textarea', {
      rows: 1, maxlength: 2000,
      placeholder: info.dm ? `Message ${info.user.name}` : `Message #${info.title}  ·  @username to mention`,
      oninput: (e) => {
        e.target.style.height = 'auto'; e.target.style.height = Math.min(e.target.scrollHeight, 160) + 'px';
        if (Date.now() - lastTyping > 2000) { lastTyping = Date.now(); S.socket.emit('typing', { room: S.room }); }
      },
      onkeydown: (e) => {
        if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); form.requestSubmit(); }
        if (e.key === 'Escape') closePicker();
      },
      onpaste: (e) => {
        const file = [...(e.clipboardData?.files || [])].find((f) => f.type.startsWith('image/'));
        if (file) { e.preventDefault(); uploadAndSend(file); }
      },
    });
    const fileIn = h('input', { type: 'file', accept: 'image/gif,image/png,image/jpeg,image/webp', hidden: true, onchange: () => { if (fileIn.files[0]) uploadAndSend(fileIn.files[0]); fileIn.value = ''; } });
    const tool = (label, title, tab, cls = '') => h('button', { class: 'tool-btn ' + cls, type: 'button', title, onclick: () => togglePicker(tab) }, label);
    const form = h('form', { onsubmit: (e) => {
      e.preventDefault();
      const text = ta.value.trim(); if (!text) return;
      sendMessage({ text }, () => { ta.value = text; });
      ta.value = ''; ta.style.height = 'auto'; closePicker();
    } },
    tool('😊', 'Emoji', 'emoji'), tool('🏷️', 'Stickers', 'stickers'), tool('GIF', 'GIFs', 'gifs', 'gif'),
    h('button', { class: 'tool-btn', type: 'button', title: 'Upload image or GIF', onclick: () => fileIn.click() }, '📎'),
    fileIn, ta, h('button', { class: 'btn primary', type: 'submit' }, 'Send'));
    const wrap = h('div', { class: 'composer' }, form);
    wrap.addEventListener('dragover', (e) => e.preventDefault());
    wrap.addEventListener('drop', (e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f?.type.startsWith('image/')) uploadAndSend(f); });
    box.replaceChildren(wrap);
  }

  // ---------------------------------------------------------------- media, emoji, stickers, gifs, reactions
  function msgPreview(m) {
    if (m.deleted) return 'Message deleted';
    if (m.kind === 'sticker') return '🏷️ Sticker';
    if (m.kind === 'gif') return '🎞️ GIF';
    if (m.kind === 'image') return '📷 Photo';
    return m.text || '';
  }

  const EMOJI_ONLY = /^(?:\p{Extended_Pictographic}|\p{Emoji_Component}|‍|️|\s){1,24}$/u;
  function messageContent(m) {
    if (m.deleted) return h('div', { class: 'body deleted' }, 'Message deleted');
    if (m.kind === 'sticker') {
      const st = STICKERS.byId[m.media?.id];
      const url = st?.url || m.media?.url || S.customStickers.find((x) => x.id === m.media?.id)?.url;
      return url ? h('img', { class: 'sticker', src: url, alt: st?.name || 'Sticker', title: st?.name || 'Sticker', loading: 'lazy' }) : h('div', { class: 'body deleted' }, 'Sticker');
    }
    if (m.kind === 'gif' || m.kind === 'image') {
      return h('img', { class: 'media', src: m.media.url, alt: m.kind === 'gif' ? 'GIF' : 'Photo', loading: 'lazy',
        width: m.media.w || null, height: m.media.h || null,
        onclick: () => modal(m.kind === 'gif' ? 'GIF' : 'Photo', h('img', { class: 'lightbox', src: m.media.url, alt: '' }), { wide: true }),
        onload: () => { const b = $('#messages'); if (b && b.scrollHeight - b.scrollTop - b.clientHeight < 400) b.scrollTop = b.scrollHeight; } });
    }
    const t = m.text || '';
    const jumbo = EMOJI_ONLY.test(t) && /\p{Extended_Pictographic}/u.test(t) && [...t.replace(/\s/g, '')].length <= 8;
    return h('div', { class: 'body' + (jumbo ? ' jumbo' : '') }, richText(t));
  }

  function reactionsRow(m) {
    const entries = Object.entries(m.reactions || {}).filter(([, ids]) => ids.length);
    if (!entries.length) return null;
    return h('div', { class: 'reactions' },
      entries.map(([emo, ids]) => {
        const names = ids.map((id) => (id === S.me.id ? 'You' : S.users.get(id)?.name || 'Someone')).join(', ');
        return h('button', { class: 'reaction' + (ids.includes(S.me.id) ? ' mine' : ''), type: 'button', title: `${names} reacted ${emo}`, onclick: () => react(m, emo) }, emo, h('b', {}, ids.length));
      }),
      h('button', { class: 'reaction add', type: 'button', title: 'Add reaction', onclick: (e) => openQuickReact(m, e.currentTarget.closest('.msg')) }, '＋😊'));
  }

  function react(m, emoji) {
    S.socket.emit('message:react', { room: m.room, id: m.id, emoji }, (r) => r?.error && toast(r.error, 'warn'));
  }

  function openQuickReact(m, msgEl) {
    $$('.quick-react').forEach((x) => x.remove());
    if (!msgEl) return;
    const bar = h('div', { class: 'quick-react' },
      EMOJI.quick.map((e) => h('button', { type: 'button', onclick: () => { react(m, e); bar.remove(); } }, e)),
      h('button', { type: 'button', title: 'More emoji', onclick: () => { bar.remove(); togglePicker('emoji', (e) => react(m, e)); } }, '➕'));
    msgEl.append(bar);
    const off = (e) => { if (!bar.contains(e.target)) { bar.remove(); document.removeEventListener('mousedown', off, true); } };
    setTimeout(() => document.addEventListener('mousedown', off, true), 0);
  }

  function sendMessage(payload, onFail) {
    S.socket.timeout(8000).emit('message:send', { room: S.room, ...payload }, (err, res) => {
      if (err) { onFail?.(); return toast('Couldn’t send — check your connection.', 'warn'); }
      if (res?.error) { onFail?.(); toast(res.error, 'warn'); }
    });
  }

  async function uploadAndSend(file) {
    if (file.size > 2 * 1024 * 1024) return toast('Images and GIFs must be under 2 MB.', 'warn');
    const data = await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsDataURL(file); });
    const dims = await new Promise((res) => { const i = new Image(); i.onload = () => res({ w: i.naturalWidth, h: i.naturalHeight }); i.onerror = () => res({}); i.src = data; });
    toast('Uploading…', 'info');
    try {
      const r = await api('POST', '/api/upload', { data });
      sendMessage({ kind: file.type === 'image/gif' ? 'gif' : 'image', media: { url: r.url, ...dims } });
      closePicker();
    } catch (e) { toast(e.message, 'warn'); }
  }

  let pickerState = null; // { tab, onEmoji }
  function closePicker() { $('.picker')?.remove(); pickerState = null; $$('.tool-btn').forEach((b) => b.classList.remove('on')); }
  function togglePicker(tab, onEmoji) {
    if (pickerState && pickerState.tab === tab && !onEmoji) return closePicker();
    closePicker();
    const host = $('#composer .composer'); if (!host) return;
    pickerState = { tab, onEmoji };
    const panel = h('div', { class: 'picker' });
    host.append(panel);
    renderPicker();
    const off = (e) => { if (!e.target.closest('.picker') && !e.target.closest('.tool-btn')) { closePicker(); document.removeEventListener('mousedown', off, true); } };
    setTimeout(() => document.addEventListener('mousedown', off, true), 0);
  }

  function insertAtCursor(text) {
    const ta = $('#composer textarea'); if (!ta) return;
    const a = ta.selectionStart ?? ta.value.length, b = ta.selectionEnd ?? ta.value.length;
    ta.value = ta.value.slice(0, a) + text + ta.value.slice(b);
    ta.selectionStart = ta.selectionEnd = a + text.length;
    ta.focus();
  }

  let gifTimer = null;
  // upload your own sticker: PNG/WebP are resized to max 320px (keeps transparency); GIFs are sent as-is (≤1 MB)
  function uploadSticker() {
    const input = h('input', { type: 'file', accept: 'image/png,image/webp,image/gif,image/jpeg' });
    input.onchange = async () => {
      const f = input.files[0]; if (!f) return;
      let data;
      if (f.type === 'image/gif') {
        if (f.size > 1024 * 1024) return toast('GIF stickers must be under 1 MB.', 'warn');
        data = await new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(f); });
      } else {
        const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = URL.createObjectURL(f); }).catch(() => null);
        if (!img) return toast('Couldn’t read that image.', 'warn');
        const k = Math.min(1, 320 / Math.max(img.width, img.height));
        const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        data = c.toDataURL('image/png');
      }
      const name = (f.name.replace(/\.[^.]+$/, '') || 'Sticker').slice(0, 30);
      try {
        const r = await api('POST', '/api/stickers', { data, name });
        S.customStickers = [...S.customStickers.filter((x) => x.id !== r.sticker.id), r.sticker];
        toast('🏷️ Sticker added for everyone'); if (pickerState) renderPicker();
      } catch (e) { toast(e.message, 'warn'); }
    };
    input.click();
  }
  function renderPicker(query = '') {
    const panel = $('.picker'); if (!panel || !pickerState) return;
    const { tab, onEmoji } = pickerState;
    const tabs = h('div', { class: 'tabs-row' }, [['emoji', '😊 Emoji'], ['stickers', '🏷️ Stickers'], ['gifs', '🎞️ GIFs']].map(([id, label]) =>
      h('button', { type: 'button', class: tab === id ? 'active' : '', onclick: () => { pickerState = { tab: id }; renderPicker(); } }, label)));
    $$('.tool-btn').forEach((b) => b.classList.toggle('on', b.title.toLowerCase().startsWith(tab.slice(0, 3))));
    let search = null, body = h('div', { class: 'body' }), foot = null;

    if (tab === 'emoji') {
      search = h('input', { placeholder: 'Search emoji… (chai, mountain, lol)', value: query, oninput: (e) => renderPicker(e.target.value) });
      const q = query.trim().toLowerCase();
      for (const c of EMOJI.cats) {
        const items = q ? c.items.filter((i) => i.k.includes(q)) : c.items;
        if (!items.length) continue;
        body.append(h('div', { class: 'cat-title' }, c.name), h('div', { class: 'emoji-grid' }, items.map((i) => h('button', { type: 'button', title: i.k, onclick: () => {
          if (onEmoji) { onEmoji(i.ch); closePicker(); } else insertAtCursor(i.ch);
        } }, i.ch))));
      }
      if (!body.childNodes.length) body.append(h('p', { class: 'hint' }, 'No emoji found.'));
    } else if (tab === 'stickers') {
      search = h('input', { placeholder: S.tenor ? 'Search stickers on Tenor…' : 'Search stickers…', value: query, oninput: (e) => { clearTimeout(gifTimer); const v = e.target.value; gifTimer = setTimeout(() => renderPicker(v), 350); } });
      const q = query.trim().toLowerCase();
      const send = (media) => { sendMessage({ kind: 'sticker', media }); closePicker(); };
      // community (uploaded) stickers + upload tile
      const mine = S.customStickers.filter((st) => !q || st.name.toLowerCase().includes(q));
      body.append(h('div', { class: 'cat-title' }, 'Community stickers'), h('div', { class: 'sticker-grid' },
        h('button', { type: 'button', class: 'upload-tile', title: 'Upload your own sticker', onclick: uploadSticker }, h('span', {}, '＋'), h('small', {}, 'Upload')),
        mine.map((st) => h('div', { class: 'st-wrap' },
          h('button', { type: 'button', title: `${st.name}${st.byName ? ' · by @' + st.byName : ''}`, onclick: () => send({ id: st.id }) }, h('img', { src: st.url, alt: st.name, loading: 'lazy' })),
          st.by === S.me.id || S.me.admin ? h('button', { class: 'st-del', type: 'button', title: 'Delete sticker', onclick: () => confirmBox('Delete sticker?', `“${st.name}” will be removed for everyone.`, 'Delete', async () => { try { await api('DELETE', '/api/stickers/' + st.id); } catch (e) { toast(e.message, 'warn'); } }) }, '✕') : null))));
      const pack = STICKERS.list.filter((st) => !q || st.name.toLowerCase().includes(q));
      if (pack.length) body.append(h('div', { class: 'cat-title' }, 'VEYA pack'), h('div', { class: 'sticker-grid' }, pack.map((st) =>
        h('button', { type: 'button', title: st.name, onclick: () => send({ id: st.id }) }, h('img', { src: st.url, alt: st.name })))));
      if (!S.tenor) body.append(h('p', { class: 'hint', style: 'margin-top:12px' }, S.me.admin ? 'Connect Tenor in Settings to search millions of stickers.' : 'More stickers appear here once an admin connects Tenor.'));
      if (S.tenor) {
        const grid = h('div', { class: 'sticker-grid' }, h('p', { class: 'hint' }, 'Loading…'));
        body.append(h('div', { class: 'cat-title' }, q ? `Tenor: “${query}”` : 'Trending on Tenor'), grid);
        api('GET', '/api/tenor?type=stickers&q=' + encodeURIComponent(query)).then((r) => {
          grid.replaceChildren(...(r.items.length ? r.items.map((g) => h('button', { type: 'button', title: g.title, onclick: () => send({ url: g.url }) }, h('img', { src: g.preview, alt: g.title, loading: 'lazy' }))) : [h('p', { class: 'hint' }, 'No stickers found.')]));
        }).catch((e) => grid.replaceChildren(h('p', { class: 'hint' }, e.message)));
        foot = h('div', { class: 'foot' }, 'Stickers via Tenor');
      }
    } else {
      const upload = h('button', { class: 'btn small', type: 'button', onclick: () => $('#composer input[type=file]')?.click() }, '📎 Upload a GIF');
      if (!S.tenor) {
        body.append(h('div', { class: 'empty', style: 'padding:24px 10px' }, h('div', { class: 'big' }, '🎞️'),
          h('p', {}, 'Upload a GIF or image from your device, or paste one straight into the message box.'), upload,
          h('p', { class: 'hint', style: 'margin-top:14px' }, 'GIF search isn’t connected yet.'),
          S.me.admin ? h('button', { class: 'btn small primary', type: 'button', onclick: () => { closePicker(); openSettings(); } }, '🎞️ Connect Tenor in Settings') : h('p', { class: 'hint' }, 'Ask a core team admin to connect Tenor in Settings.')));
      } else {
        search = h('input', { placeholder: 'Search Tenor GIFs…', value: query, oninput: (e) => { clearTimeout(gifTimer); const v = e.target.value; gifTimer = setTimeout(() => renderPicker(v), 350); } });
        const grid = h('div', { class: 'gif-grid' }, h('p', { class: 'hint' }, 'Loading…'));
        body.append(grid);
        api('GET', '/api/tenor?type=gifs&q=' + encodeURIComponent(query)).then((r) => {
          grid.replaceChildren(...(r.items.length ? r.items.map((g) => h('button', { type: 'button', title: g.title, onclick: () => { sendMessage({ kind: 'gif', media: { url: g.url, w: g.w, h: g.h } }); closePicker(); } }, h('img', { src: g.preview, alt: g.title, loading: 'lazy' }))) : [h('p', { class: 'hint' }, 'No GIFs found.')]));
        }).catch((e) => grid.replaceChildren(h('p', { class: 'hint' }, e.message)));
        foot = h('div', { class: 'foot' }, 'Powered by Tenor', upload);
      }
    }
    panel.replaceChildren(tabs, search ? h('div', { class: 'search' }, search) : null, body, foot);
    if (search && query !== undefined) { search.focus(); search.setSelectionRange(search.value.length, search.value.length); }
  }

  function insertMention(u) {
    const ta = $('#composer textarea'); if (!ta) return;
    ta.value = `@${u.username} ` + ta.value; ta.focus();
  }

  function pinMessage(m) {
    S.socket.emit('message:pin', { room: m.room, id: m.id }, (r) => {
      if (r?.error) toast(r.error, 'warn'); else toast(r.pinned ? '📌 Pinned for everyone in this chat' : 'Unpinned');
    });
  }

  function deleteMessage(m) {
    confirmBox('Delete message?', 'This removes it for everyone.', 'Delete', () => {
      S.socket.emit('message:delete', { room: m.room, id: m.id }, (r) => r?.error && toast(r.error, 'warn'));
    });
  }

  async function toggleMuteRoom() {
    const info = roomInfo(S.room);
    try {
      const r = info.dm && S.me.mutedUsers.includes(info.user.id) && !S.me.mutedRooms.includes(S.room)
        ? await api('POST', '/api/mute/user/' + info.user.id)
        : await api('POST', '/api/mute/room', { room: S.room });
      S.me = r.me;
      toast(r.muted ? '🔕 Muted — no badges or notifications (except @mentions)' : '🔔 Unmuted');
      renderChatHeader(); renderSidebar(); renderRail(); updateTitle();
    } catch (e) { toast(e.message, 'warn'); }
  }

  // ---------------------------------------------------------------- status menu
  function closePopover() { $('.popover')?.remove(); document.removeEventListener('mousedown', popoverOutside, true); }
  function popoverOutside(e) { if (!e.target.closest('.popover')) closePopover(); }
  async function setStatus(patch) {
    try { const r = await api('PATCH', '/api/me', patch); S.me = r.me; renderRail(); if (S.view === 'chat') renderChatHeader(); }
    catch (e) { toast(e.message, 'warn'); }
  }
  function openStatusMenu(anchor) {
    closePopover();
    const opts = [
      ['online', 'Online', 'Show everyone you’re around'],
      ['away', 'Away', 'Set automatically after 5 min idle'],
      ['dnd', 'Do not disturb', 'Mute desktop notifications'],
      ['invisible', 'Invisible', 'Appear offline, still chat'],
    ];
    const txt = h('input', { value: S.me.statusText || '', maxlength: 60, placeholder: '💬 Custom status, e.g. “in the library till 6”' });
    txt.addEventListener('keydown', (e) => { if (e.key === 'Enter') { setStatus({ statusText: txt.value }); closePopover(); toast('Status updated'); } });
    const pop = h('div', { class: 'popover' },
      h('div', { class: 'me-card' }, avatar(S.me, 'lg', true), h('div', {}, h('b', {}, S.me.name), h('span', { class: 'status-line' }, '@' + S.me.username))),
      opts.map(([id, label, sub]) => h('button', { class: 'menu-item' + ((S.me.status || 'online') === id ? ' active' : ''), type: 'button', onclick: () => { setStatus({ status: id }); closePopover(); } },
        h('span', { class: 'status-dot ' + id }), h('span', {}, label, h('small', {}, sub)))),
      h('div', { style: 'padding:6px 4px 2px' }, txt),
      h('div', { class: 'sep' }),
      h('button', { class: 'menu-item', type: 'button', onclick: () => { closePopover(); openSettings(); } }, '👤', h('span', {}, 'Profile photo & settings')),
      h('button', { class: 'menu-item', type: 'button', onclick: () => { closePopover(); openThemePicker(); } }, '🎨', h('span', {}, 'Themes')),
      h('button', { class: 'menu-item', type: 'button', onclick: () => { closePopover(); signOut(); } }, '🚪', h('span', {}, 'Sign out')));
    document.body.append(pop);
    const r = anchor.getBoundingClientRect();
    pop.style.left = Math.min(r.right + 10, innerWidth - pop.offsetWidth - 8) + 'px';
    pop.style.top = Math.max(8, Math.min(r.bottom - pop.offsetHeight, innerHeight - pop.offsetHeight - 8)) + 'px';
    setTimeout(() => document.addEventListener('mousedown', popoverOutside, true), 0);
  }

  // auto-away after 5 minutes without activity
  let lastActive = Date.now();
  const markActive = () => {
    lastActive = Date.now();
    if (S.idle) { S.idle = false; S.socket?.emit('idle', false); if (S.me) renderRail(); }
  };
  ['mousemove', 'keydown', 'mousedown', 'touchstart', 'focus'].forEach((ev) => window.addEventListener(ev, markActive, { passive: true }));
  setInterval(() => {
    if (!S.me || S.idle) return;
    if (Date.now() - lastActive > 5 * 60e3) { S.idle = true; S.socket?.emit('idle', true); renderRail(); }
  }, 30e3);

  // ---------------------------------------------------------------- modals
  function modal(title, content, { wide } = {}) {
    const close = () => bg.remove();
    const bg = h('div', { class: 'modal-bg', onclick: (e) => { if (e.target === bg) close(); } },
      h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', style: wide ? 'width:min(640px,100%)' : '' },
        h('header', {}, h('h3', {}, title), h('button', { class: 'icon-btn', type: 'button', onclick: () => close(), 'aria-label': 'Close' }, '✕')),
        h('div', { class: 'content' }, content)));
    const onKey = (e) => { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', onKey); } };
    document.addEventListener('keydown', onKey);
    $('#modal-root').append(bg);
    return close;
  }

  function confirmBox(title, text, okLabel, onOk) {
    const close = modal(title, [h('p', { style: 'margin:0' }, text),
      h('div', { class: 'actions-row' }, h('button', { class: 'btn', type: 'button', onclick: () => close() }, 'Cancel'),
        h('button', { class: 'btn danger solid', type: 'button', onclick: () => { close(); onOk(); } }, okLabel))]);
  }

  function openPins() {
    const pins = [...(S.cache.get(S.room)?.pinned || [])].reverse();
    const content = pins.length ? pins.map((m) => {
      const u = S.users.get(m.from);
      return h('div', { class: 'pin-item' },
        h('div', { class: 'm' }, h('b', {}, u?.name || 'Unknown'), h('span', {}, new Date(m.ts).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }))),
        messageContent(m),
        h('div', { class: 'actions-row' },
          h('button', { class: 'btn small', type: 'button', onclick: () => { close(); const el = $(`.msg[data-id="${m.id}"]`); el?.scrollIntoView({ block: 'center', behavior: 'smooth' }); } }, 'Jump'),
          h('button', { class: 'btn small', type: 'button', onclick: () => { close(); pinMessage(m); } }, 'Unpin')));
    }) : h('p', { class: 'hint' }, 'No pinned messages yet. Hover a message and press 📌 to pin it for everyone.');
    const close = modal('📌 Pinned messages', content);
  }

  function openProfile(userId) {
    if (userId === S.me.id) return openSettings();
    const u = S.users.get(userId); if (!u) return;
    const blocked = S.me.blocked.includes(u.id), muted = S.me.mutedUsers.includes(u.id);
    const close = modal('Profile', [
      h('div', { class: 'profile-head' }, avatar(u, 'lg', true),
        h('div', {}, h('h4', {}, u.name), h('p', {}, '@' + u.username), h('p', {}, h('span', { class: 'status-dot ' + stateOf(u.id) }), statusLabel(u)), u.statusText ? h('p', {}, '💬 ' + u.statusText) : null,
          u.bio ? h('p', {}, u.bio) : null, h('p', {}, 'Joined ' + new Date(u.createdAt).toLocaleDateString([], { month: 'short', year: 'numeric' })))),
      profileDetails(u),
      h('div', { class: 'actions-row', style: 'justify-content:flex-start' },
        h('button', { class: 'btn primary', type: 'button', onclick: () => { close(); openRoom(dmRoom(u.id)); } }, '💬 Message'),
        h('button', { class: 'btn', type: 'button', onclick: async () => { close(); await toggleMuteUser(u.id); } }, muted ? '🔔 Unmute' : '🔕 Mute'),
        h('button', { class: 'btn danger', type: 'button', onclick: () => { close(); blocked ? toggleBlock(u.id) : confirmBox(`Block ${u.name}?`, 'You won’t see their messages anywhere, and neither of you can DM the other. They aren’t notified.', 'Block', () => toggleBlock(u.id)); } }, blocked ? 'Unblock' : '⛔ Block')),
      h('p', { class: 'hint', style: 'margin:0' }, 'Mute hides badges and notifications from this person. Block hides their messages everywhere and stops DMs both ways.'),
    ]);
  }

  async function toggleMuteUser(id) {
    try {
      const r = await api('POST', '/api/mute/user/' + id); S.me = r.me;
      toast(r.muted ? '🔕 User muted' : '🔔 User unmuted');
      render();
    } catch (e) { toast(e.message, 'warn'); }
  }

  async function toggleBlock(id) {
    try {
      const r = await api('POST', '/api/block/' + id); S.me = r.me;
      toast(r.blocked ? '⛔ Blocked. Their messages are hidden.' : 'Unblocked');
      if (!r.blocked) { for (const [room, c] of S.cache) if (c.loaded) S.cache.delete(room); } // re-fetch to show their messages again
      render();
      if (S.view === 'chat') openRoom(S.room, true);
    } catch (e) { toast(e.message, 'warn'); }
  }

  // pick an image, centre-crop to a square, resize to 256px, upload as JPEG
  function pickPhoto(closeSettings) {
    const input = h('input', { type: 'file', accept: 'image/*' });
    input.onchange = () => {
      const f = input.files[0]; if (!f) return;
      if (!f.type.startsWith('image/')) return toast('Pick an image file', 'warn');
      const img = new Image();
      img.onload = async () => {
        const side = Math.min(img.width, img.height), N = 256;
        const c = document.createElement('canvas'); c.width = c.height = N;
        c.getContext('2d').drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, N, N);
        const data = c.toDataURL('image/jpeg', 0.85);
        URL.revokeObjectURL(img.src);
        try {
          const r = await api('PATCH', '/api/me', { avatar: data });
          S.me = r.me; S.users.set(S.me.id, { ...S.users.get(S.me.id), avatarVer: S.me.avatarVer });
          closeSettings?.(); render(); toast('📷 Profile photo updated');
        } catch (e) { toast(e.message, 'warn'); }
      };
      img.onerror = () => toast('Couldn’t read that image', 'warn');
      img.src = URL.createObjectURL(f);
    };
    input.click();
  }


  // ---- profile details (branch, batch, hometown, club interests, passions)
  const BRANCHES = ['Computer Science & Engineering', 'Data Science & Engineering', 'Electrical Engineering', 'Mechanical Engineering', 'Civil Engineering',
    'Engineering Physics', 'Bioengineering', 'Mathematics & Computing', 'Materials Science & Engineering', 'Microelectronics & VLSI', 'General Engineering',
    'M.Tech', 'M.Sc', 'MA', 'MBA', 'PhD'];
  const STATES = ['Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh', 'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jharkhand', 'Karnataka',
    'Kerala', 'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana',
    'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal', 'Andaman & Nicobar Islands', 'Chandigarh', 'Dadra & Nagar Haveli and Daman & Diu', 'Delhi',
    'Jammu & Kashmir', 'Ladakh', 'Lakshadweep', 'Puducherry'];
  // "Computer Science & Engineering" -> "cse", "Mathematics & Computing" -> "mc mnc"
  const branchAbbr = (b) => { if (!b) return ''; const w = b.split(/\s+/).filter((x) => /^[A-Za-z]/.test(x)); const i = w.map((x) => x[0]).join('').toLowerCase(); return b.includes('&') && w.length === 2 ? i + ' ' + w[0][0].toLowerCase() + 'n' + w[1][0].toLowerCase() : i; };
  const PASSION_IDEAS = ['Coding', 'Music', 'Trekking', 'Photography', 'Football', 'Cricket', 'Startups', 'Reading', 'Gaming', 'Art', 'Dance', 'Debating', 'Research', 'Fitness', 'Robotics', 'Writing', 'Films', 'Astronomy'];
  function profileDetails(u) {
    const clubName = (room) => S.clubs.find((c) => c.room === room);
    const facts = [
      u.branch ? h('span', { class: 'fact' }, '🎓 ', u.branch) : null,
      u.batch ? h('span', { class: 'fact' }, '🗓️ ', u.batch) : null,
      u.from ? h('span', { class: 'fact' }, '🏡 ', u.from) : null,
    ].filter(Boolean);
    const interests = (u.interests || []).map(clubName).filter(Boolean);
    if (!facts.length && !interests.length && !(u.passions || []).length) {
      return u.id === S.me?.id ? h('p', { class: 'hint', style: 'margin:0' }, 'Add your branch, batch and interests in Profile & settings.') : null;
    }
    return h('div', { class: 'pdetails' },
      facts.length ? h('div', { class: 'facts' }, facts) : null,
      interests.length ? [h('div', { class: 'section-title' }, 'Club interests'), h('div', { class: 'tagrow' }, interests.map((c) =>
        h('button', { class: 'tag club', type: 'button', title: 'Open club', onclick: () => { $$('.modal-bg').forEach((m) => m.remove()); openClubDetails(c); } }, c.icon + ' ' + c.name.split(' — ')[0])))] : null,
      (u.passions || []).length ? [h('div', { class: 'section-title' }, 'Passionate about'), h('div', { class: 'tagrow' }, u.passions.map((x) => h('span', { class: 'tag' }, '✨ ' + x)))] : null);
  }
  function aboutYouEditor() {
    const st = { interests: new Set(S.me.interests || []), passions: [...(S.me.passions || [])] };
    const branch = h('input', { list: 'dl-branches', maxlength: 60, value: S.me.branch || '', placeholder: 'e.g. Computer Science & Engineering' });
    const yNow = new Date().getFullYear();
    const batch = h('select', {}, h('option', { value: '' }, 'Select your batch'),
      Array.from({ length: 14 }, (_, i) => yNow + 1 - i).map((y) => { const v = 'B' + String(y).slice(2); return h('option', { value: v, selected: S.me.batch === v }, `${v} (joined ${y})`); }),
      h('option', { value: 'Alumni', selected: S.me.batch === 'Alumni' }, 'Alumni'), h('option', { value: 'Faculty / Staff', selected: S.me.batch === 'Faculty / Staff' }, 'Faculty / Staff'));
    const from = h('input', { list: 'dl-states', maxlength: 60, value: S.me.from || '', placeholder: 'e.g. Jaipur, Rajasthan' });
    // club interests: pick from all clubs
    const clubBox = h('div', { class: 'tagrow pick' });
    const drawClubs = () => clubBox.replaceChildren(...[...S.clubs].sort((a, b) => a.cat.localeCompare(b.cat) || a.name.localeCompare(b.name)).map((c) =>
      h('button', { type: 'button', class: 'tag club' + (st.interests.has(c.room) ? ' on' : ''), onclick: () => { st.interests.has(c.room) ? st.interests.delete(c.room) : st.interests.size < 15 && st.interests.add(c.room); drawClubs(); } },
        c.icon + ' ' + c.name.split(' — ')[0])));
    drawClubs();
    // passions: tag input + suggestions
    const pRow = h('div', { class: 'tagrow' });
    const pIn = h('input', { maxlength: 30, placeholder: 'Type and press Enter, e.g. Trekking' });
    const addP = (v) => { v = v.trim(); if (v && !st.passions.some((x) => x.toLowerCase() === v.toLowerCase()) && st.passions.length < 12) st.passions.push(v); drawP(); };
    const drawP = () => pRow.replaceChildren(...st.passions.map((x, i) => h('span', { class: 'tag on' }, '✨ ' + x, h('button', { type: 'button', class: 'x', title: 'Remove', onclick: () => { st.passions.splice(i, 1); drawP(); } }, '✕'))),
      ...PASSION_IDEAS.filter((x) => !st.passions.includes(x)).slice(0, 8).map((x) => h('button', { type: 'button', class: 'tag ghost', onclick: () => addP(x) }, '+ ' + x)));
    pIn.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addP(pIn.value); pIn.value = ''; } });
    drawP();
    const save = async () => {
      if (pIn.value.trim()) { addP(pIn.value); pIn.value = ''; }
      try {
        const r = await api('PATCH', '/api/me', { branch: branch.value, batch: batch.value, from: from.value, interests: [...st.interests], passions: st.passions });
        S.me = r.me; S.users.set(S.me.id, { ...S.users.get(S.me.id), ...r.me });
        toast('✅ Profile details saved');
      } catch (e) { toast(e.message, 'warn'); }
    };
    return h('div', { class: 'about-you' },
      h('div', { class: 'section-title' }, '🎓 About you'),
      h('datalist', { id: 'dl-branches' }, BRANCHES.map((b) => h('option', { value: b }))),
      h('datalist', { id: 'dl-states' }, STATES.map((b) => h('option', { value: b }))),
      h('div', { class: 'row2' }, h('label', {}, 'Branch / programme', branch), h('label', {}, 'Batch', batch)),
      h('label', {}, 'Belonging to (hometown / state)', from),
      h('label', {}, 'Club interests ', h('small', { class: 'hint' }, '(tap to select)')), clubBox,
      h('label', {}, 'Passionate about', pIn), pRow,
      h('div', { class: 'actions-row' }, h('button', { class: 'btn primary', type: 'button', onclick: save }, 'Save details')));
  }

  // admin: connect the Tenor GIF & sticker library once (key is stored on the server)
  function tenorSettingsBox() {
    const box = h('div', { class: 'tenor-box' }, h('p', { class: 'hint', style: 'margin:0' }, 'Checking Tenor…'));
    api('GET', '/api/admin/tenor').then((st) => {
      const input = h('input', { placeholder: 'Paste your Tenor API key (starts with AIza…)', autocomplete: 'off', spellcheck: 'false' });
      const err = h('p', { class: 'form-error' });
      const save = async (key) => {
        err.textContent = '';
        try { const r = await api('POST', '/api/admin/tenor', { key }); S.tenor = r.connected; toast(r.connected ? '🎞️ Tenor connected. GIF & sticker search is on for everyone.' : 'Tenor disconnected'); box.replaceWith(tenorSettingsBox()); }
        catch (x) { err.textContent = x.message; }
      };
      box.replaceChildren(
        h('div', { class: 'section-title' }, '🎞️ GIF & sticker library (Tenor)'),
        st.connected
          ? h('p', { style: 'margin:0' }, '✅ Connected', st.hint ? h('small', { class: 'hint' }, `  (key ${st.hint})`) : null, st.fromEnv ? h('small', { class: 'hint' }, ' · set by the server') : null)
          : h('p', { class: 'hint', style: 'margin:0' }, 'Not connected. Paste a free Tenor API key to turn on GIF and sticker search for everyone.'),
        st.fromEnv ? null : h('div', { style: 'display:flex;gap:8px' }, input,
          h('button', { class: 'btn primary', type: 'button', onclick: () => save(input.value) }, st.connected ? 'Replace' : 'Connect'),
          st.connected ? h('button', { class: 'btn danger', type: 'button', onclick: () => save('') }, 'Disconnect') : null),
        err,
        h('details', { class: 'hint' }, h('summary', {}, 'How do I get a free key? (2 minutes)'),
          h('ol', { style: 'margin:6px 0 0;padding-left:18px;display:grid;gap:3px' },
            h('li', {}, 'Open ', h('a', { href: 'https://console.cloud.google.com/', target: '_blank', rel: 'noopener' }, 'console.cloud.google.com'), ' and sign in with a Google account.'),
            h('li', {}, 'Create a project (any name, e.g. “VEYA”).'),
            h('li', {}, 'Search for “Tenor API”, open it and click Enable.'),
            h('li', {}, 'Go to APIs & Services → Credentials → Create credentials → API key.'),
            h('li', {}, 'Copy the key, paste it above and click Connect.'))));
    }).catch(() => box.replaceChildren());
    return box;
  }

  function openSettings() {
    const name = h('input', { value: S.me.name, maxlength: 40 });
    const bio = h('input', { value: S.me.bio || '', maxlength: 160, placeholder: 'e.g. B.Tech CSE ’27 · KamandPrompt · football' });
    const cur = h('input', { type: 'password', placeholder: 'Current password', autocomplete: 'current-password' });
    const nxt = h('input', { type: 'password', placeholder: 'New password', autocomplete: 'new-password' });
    const listOf = (ids, label, onUndo) => ids.length ? ids.map((id) => { const u = S.users.get(id); return u ? h('div', { class: 'list-row' }, avatar(u, 'sm'), h('span', { class: 'grow' }, u.name), h('button', { class: 'btn small', type: 'button', onclick: () => { close(); onUndo(id); } }, label)) : null; }) : h('p', { class: 'hint', style: 'margin:0' }, 'None');
    const mutedRooms = S.me.mutedRooms.map((r) => { const i = roomInfo(r); return i ? h('div', { class: 'list-row' }, h('span', { class: 'grow' }, (i.icon || '💬') + ' ' + i.title), h('button', { class: 'btn small', type: 'button', onclick: async () => { const x = await api('POST', '/api/mute/room', { room: r }); S.me = x.me; close(); render(); toast('Unmuted ' + i.title); } }, 'Unmute')) : null; });
    const notifBtn = ('Notification' in window && Notification.permission === 'default') ? h('button', { class: 'btn small', type: 'button', onclick: () => Notification.requestPermission().then(() => { close(); toast('Notification setting saved'); }) }, '🔔 Enable desktop notifications for DMs & mentions') : null;
    const close = modal('Profile & settings', [
      h('div', { class: 'profile-head' }, h('div', { class: 'photo-row' }, avatar(S.me, 'xl'),
        h('div', {}, h('h4', {}, S.me.name), h('p', {}, '@' + S.me.username + ' · ' + S.me.email),
          h('div', { class: 'btns', style: 'margin-top:8px;display:flex;gap:8px;flex-wrap:wrap' },
            h('button', { class: 'btn small primary', type: 'button', onclick: () => pickPhoto(close) }, S.me.avatarVer ? '📷 Change photo' : '📷 Upload photo'),
            S.me.avatarVer ? h('button', { class: 'btn small', type: 'button', onclick: async () => { await setStatus({ avatar: null }); close(); toast('Photo removed'); render(); } }, 'Remove') : null)))),
      h('label', {}, 'Display name', name), h('label', {}, 'Bio', bio),
      h('div', { class: 'actions-row' }, h('button', { class: 'btn primary', type: 'button', onclick: async () => {
        try { const r = await api('PATCH', '/api/me', { name: name.value, bio: bio.value }); S.me = r.me; S.users.set(S.me.id, { ...S.users.get(S.me.id), name: S.me.name, bio: S.me.bio }); close(); render(); toast('Profile saved'); } catch (e) { toast(e.message, 'warn'); }
      } }, 'Save profile')),
      aboutYouEditor(),
      notifBtn,
      h('div', { class: 'section-title' }, 'Change password'),
      h('div', { class: 'row2' }, cur, nxt),
      h('div', { class: 'actions-row' }, h('button', { class: 'btn', type: 'button', onclick: async () => {
        try { await api('POST', '/api/change-password', { current: cur.value, next: nxt.value }); cur.value = nxt.value = ''; toast('Password updated 🔒'); } catch (e) { toast(e.message, 'warn'); }
      } }, 'Update password')),
      S.me.admin ? tenorSettingsBox() : null,
      S.me.admin ? [h('div', { class: 'section-title' }, '⭐ Core team (admins)'),
        h('p', { class: 'hint', style: 'margin:0' }, 'Core team members can post in #announcements and delete any club. Add or remove them here.'),
        [...S.users.values()].sort((x, y) => (y.admin - x.admin) || x.name.localeCompare(y.name)).map((u) => h('div', { class: 'list-row' }, avatar(u, 'sm'),
          h('span', { class: 'grow' }, u.name, ' ', h('small', { class: 'hint' }, '@' + u.username), u.admin ? h('span', { class: 'core-pill' }, 'CORE') : null),
          h('button', { class: 'btn small' + (u.admin ? '' : ' primary'), type: 'button', onclick: async () => {
            try { await api('POST', '/api/admin/role', { userId: u.id, admin: !u.admin }); u.admin = !u.admin; if (u.id === S.me.id) S.me.admin = u.admin; close(); openSettings(); toast(u.admin ? `⭐ ${u.name} is now core team` : `${u.name} removed from core team`); }
            catch (e) { toast(e.message, 'warn'); }
          } }, u.admin ? 'Remove' : 'Make core')))] : null,
      h('div', { class: 'section-title' }, 'Blocked people'), listOf(S.me.blocked, 'Unblock', toggleBlock),
      h('div', { class: 'section-title' }, 'Muted people'), listOf(S.me.mutedUsers, 'Unmute', toggleMuteUser),
      h('div', { class: 'section-title' }, 'Muted chats'), mutedRooms.length ? mutedRooms : h('p', { class: 'hint', style: 'margin:0' }, 'None'),
      h('div', { class: 'actions-row', style: 'justify-content:space-between;margin-top:6px' },
        h('button', { class: 'btn', type: 'button', 'data-theme-picker': '' }, '🎨 Change theme'),
        h('button', { class: 'btn danger', type: 'button', onclick: () => { close(); signOut(); } }, 'Sign out')),
    ], { wide: true });
  }

  // ---------------------------------------------------------------- groups
  const GROUP_TYPES = ['Freshers', 'Branch', 'Batch', 'Hostel', 'Course', 'Project', 'Other'];
  const GROUP_ICONS = { Freshers: '🌱', Branch: '🎓', Batch: '🗓️', Hostel: '🏠', Course: '📘', Project: '🛠️', Other: '👥' };
  async function reloadGroups() {
    try { S.groups = (await api('GET', '/api/groups')).groups; } catch { return; }
    if (S.view === 'groups') renderGroups();
    if (S.view === 'chat') { renderSidebar(); if (S.room.startsWith('group/') && !roomInfo(S.room)?.group?.role?.match(/admin|member/)) { S.room = 'campus/general'; renderMain(); } }
  }
  // groups suggested from your profile, e.g. "Freshers B26", "CSE B23"
  function suggestedGroups() {
    const out = [];
    const b = S.me.batch, br = S.me.branch;
    const abbr = br ? (branchAbbr(br).split(' ')[0] || '').toUpperCase() : '';
    const newest = 'B' + String(new Date().getFullYear()).slice(2);
    if (b && /^B\d\d$/.test(b)) {
      if (b === newest || b === 'B' + String(new Date().getFullYear() - 1).slice(2)) out.push({ name: `Freshers ${b}`, type: 'Freshers', desc: `Everyone who joined IIT Mandi in 20${b.slice(1)}: questions, plans and meetups` });
      out.push({ name: `${b} Batch`, type: 'Batch', desc: `The whole ${b} batch` });
      if (abbr) out.push({ name: `${abbr} ${b}`, type: 'Branch', desc: `${br}, ${b} batch: classes, assignments and notes` });
    }
    if (abbr) out.push({ name: `${abbr} (all batches)`, type: 'Branch', desc: `${br} students across all batches: seniors, juniors and alumni` });
    return out.map((sg) => ({ ...sg, existing: S.groups.find((g) => g.name.toLowerCase() === sg.name.toLowerCase()) })).filter((sg) => !(sg.existing && ['member', 'admin'].includes(sg.existing.role)));
  }
  function renderGroups() {
    const main = $('#main');
    S.groupFilter ||= 'All'; S.groupQuery ||= '';
    const q = S.groupQuery.trim().toLowerCase();
    let list = [...S.groups].sort((a, b) => (['admin', 'member'].includes(b.role) - ['admin', 'member'].includes(a.role)) || b.members - a.members);
    if (S.groupFilter === 'My groups') list = list.filter((g) => ['admin', 'member'].includes(g.role));
    else if (S.groupFilter !== 'All') list = list.filter((g) => g.type === S.groupFilter);
    if (q) list = list.filter((g) => [g.name, g.desc, g.type].join(' ').toLowerCase().includes(q));
    const sugg = suggestedGroups();
    const search = h('input', { type: 'search', placeholder: '🔎 Search groups…', value: S.groupQuery, oninput: (e) => {
      S.groupQuery = e.target.value; renderGroups(); const i = $('.club-search input'); i.focus(); i.setSelectionRange(i.value.length, i.value.length);
    } });
    main.replaceChildren(
      h('div', { class: 'page-head' }, h('h2', {}, 'Groups'), h('button', { class: 'btn primary', type: 'button', onclick: () => openNewGroup() }, 'New group')),
      h('div', { class: 'page-body' },
        h('p', { class: 'hint', style: 'margin:0 0 6px' }, 'Make groups for your freshers batch, branch, hostel wing, course or project. Public groups are open to all; private groups need an admin’s approval.'),
        sugg.length ? h('div', { class: 'sugg' }, h('div', { class: 'section-title' }, '✨ Suggested for you'),
          h('div', { class: 'sugg-row' }, sugg.map((sg) => h('div', { class: 'sugg-card' },
            h('b', {}, GROUP_ICONS[sg.type] + ' ' + sg.name), h('small', { class: 'hint' }, sg.existing ? `${sg.existing.members} members` : 'Not created yet'),
            sg.existing ? groupJoinButton(sg.existing)
              : h('button', { class: 'btn small primary', type: 'button', onclick: () => openNewGroup({ name: sg.name, type: sg.type, desc: sg.desc, privacy: 'public' }) }, 'Create it'))))) :
          (!S.me.batch || !S.me.branch ? h('p', { class: 'hint' }, '💡 Add your branch and batch in Profile & settings to get group suggestions like “Freshers B26” or “CSE B24”.') : null),
        h('div', { class: 'filter-row' },
          ['All', 'My groups', ...GROUP_TYPES].map((f) => h('button', { class: 'chip' + (S.groupFilter === f ? ' active' : ''), type: 'button', onclick: () => { S.groupFilter = f; renderGroups(); } }, f)),
          h('div', { class: 'club-search' }, search)),
        list.length ? h('div', { class: 'club-grid' }, list.map(groupCard))
          : h('div', { class: 'empty-state' }, h('div', { style: 'font-size:40px' }, '👥'), h('p', {}, S.groups.length ? 'No groups match.' : 'No groups yet. Create the first one!'))));
  }
  function groupJoinButton(g) {
    if (['admin', 'member'].includes(g.role)) return h('button', { class: 'btn joined', type: 'button', onclick: () => openRoom(g.room) }, '💬 Open');
    if (g.role === 'requested') return h('button', { class: 'btn', type: 'button', disabled: true }, '⏳ Requested');
    return h('button', { class: 'btn primary', type: 'button', onclick: () => joinGroup(g) }, g.privacy === 'public' ? 'Join' : 'Request to join');
  }
  function groupCard(g) {
    return h('article', { class: 'club-card' },
      h('span', { class: 'cat-pill cat-group' }, `${g.type} · ${g.privacy === 'public' ? '🌐 Public' : '🔒 Private'}`),
      h('h3', {}, h('span', {}, g.icon), h('span', {}, g.name)),
      h('p', { class: 'desc' }, g.desc || 'No description yet.'),
      h('div', { class: 'members' }, `${g.members} member${g.members === 1 ? '' : 's'}`, g.role === 'admin' ? ' · you’re an admin' : '', g.requests ? ` · ${g.requests} request${g.requests > 1 ? 's' : ''}` : ''),
      h('div', { class: 'acts' }, groupJoinButton(g), h('button', { class: 'btn', type: 'button', onclick: () => openGroupDetails(g) }, 'Details')));
  }
  async function joinGroup(g) {
    try {
      const r = await api('POST', `/api/groups/${g.id}/join`);
      toast(r.group.role === 'requested' ? `⏳ Request sent to the admins of ${g.name}` : `✅ Joined ${g.name}`);
      await reloadGroups();
      if (r.group.role === 'member') openRoom(r.group.room);
    } catch (e) { toast(e.message, 'warn'); }
  }
  // people picker used for inviting / adding members
  function peoplePicker(excludeIds = []) {
    const chosen = new Set();
    const input = h('input', { placeholder: 'Search people by name, branch or batch…' });
    const list = h('div', { class: 'people-pick' });
    const draw = () => {
      const q = input.value.trim().toLowerCase();
      const people = [...S.users.values()].filter((u) => u.id !== S.me.id && !excludeIds.includes(u.id) &&
        (!q || [u.name, u.username, u.branch, branchAbbr(u.branch), u.batch].join(' ').toLowerCase().includes(q))).slice(0, 60);
      list.replaceChildren(...(people.length ? people.map((u) => h('label', { class: 'pp-row' },
        h('input', { type: 'checkbox', checked: chosen.has(u.id), onchange: (e) => { e.target.checked ? chosen.add(u.id) : chosen.delete(u.id); count.textContent = chosen.size ? `${chosen.size} selected` : ''; } }),
        avatar(u, 'sm'), h('span', { class: 'grow' }, u.name, ' ', h('small', { class: 'hint' }, [u.branch ? branchAbbr(u.branch).split(' ')[0].toUpperCase() : '', u.batch].filter(Boolean).join(' · ')))))
        : [h('p', { class: 'hint', style: 'margin:6px' }, 'No one found.')]));
    };
    const count = h('small', { class: 'hint' });
    input.addEventListener('input', draw); draw();
    return { el: h('div', { class: 'pp' }, input, list, count), get: () => [...chosen] };
  }
  function openNewGroup(pre = {}) {
    const name = h('input', { maxlength: 50, value: pre.name || '', placeholder: 'e.g. Freshers B26, CSE B24, Nako Wing 2' });
    const type = h('select', {}, GROUP_TYPES.map((t) => h('option', { value: t, selected: t === (pre.type || 'Other') }, `${GROUP_ICONS[t]} ${t}`)));
    const icon = h('input', { maxlength: 4, value: GROUP_ICONS[pre.type || 'Other'], style: 'text-align:center;font-size:20px' });
    type.addEventListener('change', () => { icon.value = GROUP_ICONS[type.value]; });
    const desc = h('textarea', { rows: 2, maxlength: 200, placeholder: 'What is this group for?' }); desc.value = pre.desc || '';
    let privacy = pre.privacy || 'public';
    const privRow = h('div', { class: 'seg full', style: 'margin:0' });
    const drawPriv = () => privRow.replaceChildren(
      h('button', { type: 'button', class: privacy === 'public' ? 'active' : '', onclick: () => { privacy = 'public'; drawPriv(); } }, '🌐 Public: anyone can join'),
      h('button', { type: 'button', class: privacy === 'private' ? 'active' : '', onclick: () => { privacy = 'private'; drawPriv(); } }, '🔒 Private: admins approve'));
    drawPriv();
    const picker = peoplePicker();
    const err = h('p', { class: 'form-error' });
    const close = modal('👥 New group', [
      h('label', {}, 'Group name', name),
      h('div', { class: 'row2' }, h('label', {}, 'Type', type), h('label', {}, 'Icon', icon)),
      h('label', {}, 'Description', desc),
      h('label', {}, 'Who can join'), privRow,
      h('label', {}, 'Add people now (optional)'), picker.el, err,
      h('div', { class: 'actions-row' }, h('button', { class: 'btn', type: 'button', onclick: () => close() }, 'Cancel'),
        h('button', { class: 'btn primary', type: 'button', onclick: async () => {
          try {
            const r = await api('POST', '/api/groups', { name: name.value, type: type.value, icon: icon.value, desc: desc.value, privacy, invite: picker.get() });
            close(); toast(`🎉 Group “${r.group.name}” created`); await reloadGroups(); openRoom(r.group.room);
          } catch (x) { err.textContent = x.message; }
        } }, 'Create group')),
    ], { wide: true });
    setTimeout(() => name.focus(), 0);
  }
  async function openGroupDetails(g) {
    const isMember = ['admin', 'member'].includes(g.role), isAdm = g.role === 'admin' || S.me.admin;
    const membersBox = h('div', {}, h('p', { class: 'hint', style: 'margin:0' }, 'Loading…'));
    const reqBox = h('div');
    const close = modal(`${g.icon} ${g.name}`, [
      h('div', { style: 'display:flex;gap:8px;flex-wrap:wrap' }, h('span', { class: 'cat-pill cat-group', style: 'display:inline-block' }, g.type), h('span', { class: 'pill' }, g.privacy === 'public' ? '🌐 Public' : '🔒 Private'), h('span', { class: 'pill' }, `${g.members} members`)),
      g.desc ? h('p', { style: 'margin:0' }, g.desc) : null,
      reqBox,
      h('div', { class: 'section-title' }, 'Members'), membersBox,
      h('div', { class: 'actions-row', style: 'justify-content:flex-start' },
        isMember ? h('button', { class: 'btn primary', type: 'button', onclick: () => { close(); openRoom(g.room); } }, '💬 Open chat') : groupJoinButton(g),
        isAdm ? h('button', { class: 'btn', type: 'button', onclick: () => { close(); openAddMembers(g); } }, '➕ Add people') : null,
        isAdm ? h('button', { class: 'btn', type: 'button', onclick: () => { close(); openEditGroup(g); } }, '✏️ Edit') : null,
        isMember ? h('button', { class: 'btn', type: 'button', onclick: () => confirmBox('Leave group?', `You’ll stop getting messages from ${g.name}.`, 'Leave', async () => { close(); await api('POST', `/api/groups/${g.id}/leave`); toast('Left ' + g.name); reloadGroups(); }) }, 'Leave') : null,
        g.role === 'requested' ? h('button', { class: 'btn', type: 'button', onclick: async () => { close(); await api('POST', `/api/groups/${g.id}/leave`); toast('Request cancelled'); reloadGroups(); } }, 'Cancel request') : null,
        isAdm ? h('button', { class: 'btn danger', type: 'button', onclick: () => confirmBox('Delete group?', `“${g.name}” and its chat will be deleted for everyone.`, 'Delete', async () => { close(); try { await api('DELETE', '/api/groups/' + g.id); toast('Group deleted'); } catch (e) { toast(e.message, 'warn'); } reloadGroups(); }) }, 'Delete') : null),
    ]);
    try {
      const r = await api('GET', `/api/groups/${g.id}/members`);
      const people = r.members.map((m) => ({ ...m, u: S.users.get(m.id) })).filter((m) => m.u).sort((a, b) => b.admin - a.admin || a.u.name.localeCompare(b.u.name));
      membersBox.replaceChildren(...people.slice(0, 100).map(({ u, admin }) => h('div', { class: 'list-row' }, avatar(u, 'sm', true),
        h('span', { class: 'grow', style: 'cursor:pointer', onclick: () => { close(); openProfile(u.id); } }, u.name, admin ? h('span', { class: 'core-pill' }, 'ADMIN') : null, ' ', h('small', { class: 'hint' }, [u.batch, u.branch ? branchAbbr(u.branch).split(' ')[0].toUpperCase() : ''].filter(Boolean).join(' · '))),
        isAdm && u.id !== S.me.id ? [
          h('button', { class: 'btn small', type: 'button', onclick: async () => { try { await api('POST', `/api/groups/${g.id}/admins/${u.id}`); close(); await reloadGroups(); openGroupDetails(S.groups.find((x) => x.id === g.id)); } catch (e) { toast(e.message, 'warn'); } } }, admin ? 'Remove admin' : 'Make admin'),
          h('button', { class: 'btn small danger', type: 'button', onclick: async () => { try { await api('DELETE', `/api/groups/${g.id}/members/${u.id}`); close(); await reloadGroups(); openGroupDetails(S.groups.find((x) => x.id === g.id)); } catch (e) { toast(e.message, 'warn'); } } }, 'Remove')] : null)));
      if (r.requests.length) reqBox.replaceChildren(h('div', { class: 'section-title' }, `⏳ Join requests · ${r.requests.length}`),
        ...r.requests.map((id) => S.users.get(id)).filter(Boolean).map((u) => h('div', { class: 'list-row' }, avatar(u, 'sm'), h('span', { class: 'grow' }, u.name, ' ', h('small', { class: 'hint' }, [u.batch, u.branch].filter(Boolean).join(' · '))),
          h('button', { class: 'btn small primary', type: 'button', onclick: async () => { await api('POST', `/api/groups/${g.id}/requests/${u.id}`, { approve: true }); toast(`✅ ${u.name} added`); close(); await reloadGroups(); openGroupDetails(S.groups.find((x) => x.id === g.id)); } }, 'Approve'),
          h('button', { class: 'btn small', type: 'button', onclick: async () => { await api('POST', `/api/groups/${g.id}/requests/${u.id}`, { approve: false }); close(); await reloadGroups(); openGroupDetails(S.groups.find((x) => x.id === g.id)); } }, 'Decline'))));
    } catch (e) { membersBox.replaceChildren(h('p', { class: 'hint' }, e.message)); }
  }
  async function openAddMembers(g) {
    let existing = [];
    try { existing = (await api('GET', `/api/groups/${g.id}/members`)).members.map((m) => m.id); } catch {}
    const picker = peoplePicker(existing);
    const close = modal(`➕ Add people to ${g.name}`, [picker.el,
      h('div', { class: 'actions-row' }, h('button', { class: 'btn', type: 'button', onclick: () => close() }, 'Cancel'),
        h('button', { class: 'btn primary', type: 'button', onclick: async () => {
          const ids = picker.get(); if (!ids.length) return toast('Pick at least one person', 'warn');
          try { const r = await api('POST', `/api/groups/${g.id}/members`, { userIds: ids }); close(); toast(`✅ Added ${r.added} ${r.added === 1 ? 'person' : 'people'}`); reloadGroups(); } catch (e) { toast(e.message, 'warn'); }
        } }, 'Add'))], { wide: true });
  }
  function openEditGroup(g) {
    const name = h('input', { maxlength: 50, value: g.name });
    const icon = h('input', { maxlength: 4, value: g.icon, style: 'text-align:center;font-size:20px' });
    const desc = h('textarea', { rows: 2, maxlength: 200 }); desc.value = g.desc || '';
    const priv = h('select', {}, h('option', { value: 'public', selected: g.privacy === 'public' }, '🌐 Public: anyone can join'), h('option', { value: 'private', selected: g.privacy === 'private' }, '🔒 Private: admins approve'));
    const err = h('p', { class: 'form-error' });
    const close = modal('✏️ Edit group', [h('div', { class: 'row2' }, h('label', {}, 'Name', name), h('label', {}, 'Icon', icon)), h('label', {}, 'Description', desc), h('label', {}, 'Who can join', priv), err,
      h('div', { class: 'actions-row' }, h('button', { class: 'btn', type: 'button', onclick: () => close() }, 'Cancel'),
        h('button', { class: 'btn primary', type: 'button', onclick: async () => {
          try { await api('PATCH', '/api/groups/' + g.id, { name: name.value, icon: icon.value, desc: desc.value, privacy: priv.value }); close(); toast('Group updated'); reloadGroups(); } catch (x) { err.textContent = x.message; }
        } }, 'Save'))]);
  }

  // ---------------------------------------------------------------- clubs
  const CLUB_CATS = ['Tech', 'Cultural', 'Sports', 'Extra-curricular', 'Community'];
  function renderClubs() {
    const main = $('#main');
    const q = S.clubQuery.trim().toLowerCase();
    const order = { Tech: 0, Cultural: 1, Sports: 2, 'Extra-curricular': 3, Community: 4 };
    let list = [...S.clubs].sort((a, b) => order[a.cat] - order[b.cat]);
    if (S.clubFilter === 'My clubs') list = list.filter((c) => c.joined);
    else if (S.clubFilter !== 'All') list = list.filter((c) => c.cat === S.clubFilter);
    if (q) list = list.filter((c) => [c.name, c.desc, c.cat, c.group || ''].join(' ').toLowerCase().includes(q));
    const search = h('input', { type: 'search', placeholder: '🔎 Search clubs…', value: S.clubQuery, oninput: (e) => {
      S.clubQuery = e.target.value; renderClubs(); const i = $('.club-search input'); i.focus(); i.setSelectionRange(i.value.length, i.value.length);
    } });
    main.replaceChildren(
      h('div', { class: 'page-head' }, h('h2', {}, 'Clubs and communities'), h('button', { class: 'btn primary', type: 'button', onclick: openNewClub }, 'New club')),
      h('div', { class: 'page-body' },
        h('div', { class: 'filter-row' },
          ['All', 'My clubs', ...CLUB_CATS].map((f) => h('button', { class: 'chip' + (S.clubFilter === f ? ' active' : ''), type: 'button', onclick: () => { S.clubFilter = f; renderClubs(); } }, f)),
          h('div', { class: 'club-search' }, search)),
        list.length ? h('div', { class: 'club-grid' }, list.map(clubCard))
          : h('div', { class: 'empty-state' }, h('div', { class: 'big', style: 'font-size:40px' }, '🧩'),
            h('p', {}, S.clubFilter === 'My clubs' ? 'You haven’t joined any clubs yet. Tap “Join” on a club to add it to your chats.' : 'No clubs match that.'))));
  }

  function clubCard(c) {
    return h('article', { class: 'club-card' },
      h('span', { class: 'cat-pill cat-' + c.cat }, c.cat + (c.group ? ' · ' + c.group : '')),
      h('h3', {}, h('span', {}, c.icon), h('span', {}, c.name)),
      h('p', { class: 'desc' }, c.desc),
      h('div', { class: 'members' }, `${c.members} member${c.members === 1 ? '' : 's'}`),
      h('div', { class: 'acts' },
        c.joined
          ? h('button', { class: 'btn joined', type: 'button', onclick: () => openRoom(c.room) }, '💬 Open')
          : h('button', { class: 'btn primary', type: 'button', onclick: () => joinClub(c, true) }, 'Join'),
        h('button', { class: 'btn', type: 'button', onclick: () => openClubDetails(c) }, 'Details')));
  }

  async function joinClub(c, join) {
    try {
      const r = await api('POST', '/api/clubs/join', { room: c.room, join });
      c.joined = r.joined; c.members = r.members;
      toast(join ? `✅ Joined ${c.name}. It’s now in your chats.` : `Left ${c.name}`);
      if (S.view === 'clubs') renderClubs();
      renderRail();
    } catch (e) { toast(e.message, 'warn'); }
  }

  async function openClubDetails(c) {
    const membersBox = h('div', {}, h('p', { class: 'hint', style: 'margin:0' }, 'Loading members…'));
    const canDelete = c.custom && (c.by === S.me.id || S.me.admin);
    const close = modal(`${c.icon} ${c.name}`, [
      h('div', { style: 'display:flex;gap:8px;flex-wrap:wrap' }, h('span', { class: 'cat-pill cat-' + c.cat, style: 'display:inline-block' }, c.cat), h('span', { class: 'pill' }, `${c.members} members`)),
      h('p', { style: 'margin:0' }, c.desc),
      h('div', { class: 'section-title' }, 'Members'), membersBox,
      h('div', { class: 'actions-row', style: 'justify-content:flex-start' },
        h('button', { class: 'btn primary', type: 'button', onclick: () => { close(); openRoom(c.room); } }, '💬 Open chat'),
        c.joined ? h('button', { class: 'btn', type: 'button', onclick: () => { close(); joinClub(c, false); } }, 'Leave club')
          : h('button', { class: 'btn', type: 'button', onclick: () => { close(); joinClub(c, true); } }, 'Join club'),
        h('button', { class: 'btn', type: 'button', onclick: () => { close(); S.newsFilter = 'all'; setView('news'); } }, '📰 Events'),
        canDelete ? h('button', { class: 'btn danger', type: 'button', onclick: () => { close(); confirmBox('Delete club?', `“${c.name}” and its chat will be removed for everyone.`, 'Delete', async () => { try { await api('DELETE', '/api/clubs/' + c.room.slice(5)); toast('Club deleted'); reloadClubs(); } catch (e) { toast(e.message, 'warn'); } }); } }, 'Delete club') : null),
    ]);
    try {
      const r = await api('GET', '/api/clubs/members?room=' + encodeURIComponent(c.room));
      const users = r.members.map((id) => S.users.get(id)).filter(Boolean);
      membersBox.replaceChildren(...(users.length ? users.slice(0, 40).map((u) => h('div', { class: 'list-row', style: 'cursor:pointer', onclick: () => { close(); openProfile(u.id); } },
        avatar(u, 'sm', true), h('span', { class: 'grow' }, u.name, u.admin ? h('span', { class: 'core-pill' }, 'CORE') : null), h('small', { class: 'hint' }, '@' + u.username))) : [h('p', { class: 'hint', style: 'margin:0' }, 'No members yet. Be the first to join!')]));
    } catch { membersBox.replaceChildren(h('p', { class: 'hint' }, 'Couldn’t load members.')); }
  }

  function openNewClub() {
    const name = h('input', { maxlength: 50, placeholder: 'e.g. Perception: Fashion Society' });
    const cat = h('select', {}, CLUB_CATS.map((c) => h('option', { value: c, selected: c === (CLUB_CATS.includes(S.clubFilter) ? S.clubFilter : 'Cultural') }, c)));
    const icon = h('input', { maxlength: 4, value: '✨', style: 'text-align:center;font-size:20px' });
    const picks = h('div', { style: 'display:flex;gap:4px;flex-wrap:wrap' }, ['✨', '🎨', '🎸', '💃', '🎭', '📷', '🤖', '💻', '🚀', '🔭', '⚽', '🏏', '♟️', '📚', '🌱', '👗', '🎮', '🧠'].map((e) =>
      h('button', { class: 'btn small ghost', type: 'button', style: 'font-size:18px;padding:2px 6px', onclick: () => { icon.value = e; } }, e)));
    const desc = h('textarea', { rows: 3, maxlength: 200, placeholder: 'What does the club do? Who should join?' });
    const err = h('p', { class: 'form-error' });
    const close = modal('🧩 New club', [
      h('label', {}, 'Club name', name),
      h('div', { class: 'row2' }, h('label', {}, 'Category', cat), h('label', {}, 'Icon', icon)), picks,
      h('label', {}, 'Description', desc), err,
      h('div', { class: 'actions-row' }, h('button', { class: 'btn', type: 'button', onclick: () => close() }, 'Cancel'),
        h('button', { class: 'btn primary', type: 'button', onclick: async () => {
          try {
            const r = await api('POST', '/api/clubs', { name: name.value, cat: cat.value, icon: icon.value, desc: desc.value });
            close(); toast('🎉 Club created. You’re its first member!'); await reloadClubs(); openRoom(r.room);
          } catch (x) { err.textContent = x.message; }
        } }, 'Create club')),
    ]);
    setTimeout(() => name.focus(), 0);
  }

  // ---------------------------------------------------------------- news
  async function loadEvents() {
    try { const r = await api('GET', '/api/events'); S.events = r.events; } catch { return; }
    if (S.view === 'news') { renderNews(); renderSidebar(); }
  }

  function renderNews() {
    const main = $('#main');
    if (S.view !== 'news') return;
    let list = S.events;
    if (S.newsFilter === 'going') list = list.filter((e) => e.going);
    else if (S.newsFilter === 'clash') list = list.filter((e) => e.going && e.clashes.length);
    else if (S.newsFilter !== 'all') list = list.filter((e) => e.communityId === S.newsFilter);
    const groups = new Map();
    for (const e of list) { const k = dateKey(new Date(e.start)); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(e); }
    const filterName = { all: 'All upcoming', going: 'I’m going', clash: 'Clashing with my schedule' }[S.newsFilter] || S.communities.find((c) => c.id === S.newsFilter)?.short;
    main.replaceChildren(
      h('div', { class: 'topbar' }, menuBtn(), h('div', { class: 't' }, h('h3', {}, '📰 News & upcoming events'), h('p', {}, `${filterName} · RSVP to add events to your Schedule Planner`)),
        h('button', { class: 'btn primary', type: 'button', onclick: openEventForm }, '＋ Post event')),
      h('div', { class: 'scroll' },
        h('div', { class: 'news-filters' },
          [['all', 'All'], ['going', 'Going'], ...S.communities.map((c) => [c.id, c.icon + ' ' + c.short])].map(([id, label]) =>
            h('button', { class: 'chip' + (S.newsFilter === id ? ' active' : ''), type: 'button', onclick: () => { S.newsFilter = id; renderNews(); renderSidebar(); } }, label))),
        !list.length ? h('div', { class: 'empty' }, h('div', { class: 'big' }, '🌄'), h('h3', {}, 'Nothing here yet'), h('p', {}, 'Post an event so nobody misses out.')) : null,
        [...groups].map(([k, evs]) => h('div', { class: 'date-group' }, h('h4', {}, dayLabel(new Date(k + 'T00:00'))), h('div', { class: 'cards' }, evs.map(eventCard))))),
    );
  }

  function eventCard(e) {
    const c = S.communities.find((x) => x.id === e.communityId);
    const s = new Date(e.start), en = new Date(e.end);
    const live = s <= new Date() && en > new Date();
    const sameDay = dateKey(s) === dateKey(en);
    return h('article', { class: 'card', style: `--c:${c?.color || 'var(--accent)'}` },
      h('div', { class: 'tags' },
        h('span', { class: 'pill', style: `background:color-mix(in srgb, ${c?.color} 18%, transparent);color:${c?.color}` }, (c?.icon || '') + ' ' + (c?.short || '')),
        live ? h('span', { class: 'pill warn' }, '● Happening now') : h('span', { class: 'pill gold' }, relTime(e.start)),
        e.sample ? h('span', { class: 'pill', title: 'Seeded example — replace with real events' }, 'Sample') : null),
      h('h5', {}, e.title),
      h('div', { class: 'meta' },
        h('span', {}, '🕒 ' + s.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' }) + ', ' + timeStr(e.start) + ' – ' + (sameDay ? '' : en.toLocaleDateString([], { day: 'numeric', month: 'short' }) + ', ') + timeStr(e.end)),
        e.venue ? h('span', {}, '📍 ' + e.venue) : null,
        h('span', {}, '👤 ' + e.creatorName)),
      e.desc ? h('p', { class: 'desc' }, e.desc) : null,
      e.clashes.length ? h('div', { class: 'clash-box' }, '⚠️ Clashes with: ' + e.clashes.map((x) => `${x.title} (${fmtMin(x.start)}–${fmtMin(x.end)})`).join(', ')) : null,
      e.attended ? h('div', { class: 'att-ok' }, '✅ Your attendance is marked') : null,
      e.canManage || (e.checkinOpen && !e.attended) ? h('div', { class: 'att-row' },
        e.canManage ? h('button', { class: 'btn small', type: 'button', onclick: () => openAttendance(e) }, `📷 Attendance QR · ${e.attendanceCount}`) : null,
        e.checkinOpen && !e.attended ? h('button', { class: 'btn small primary', type: 'button', onclick: () => openCheckin(e) }, '✅ Check in') : null) : null,
      h('div', { class: 'foot' },
        h('span', { class: 'grow' }, `${e.rsvpCount} going`),
        e.createdBy === S.me.id || e.sample || S.me.admin ? h('button', { class: 'btn small ghost', type: 'button', title: 'Delete event', onclick: () => confirmBox('Delete event?', `“${e.title}” will be removed for everyone.`, 'Delete', async () => { try { await api('DELETE', '/api/events/' + e.id); toast('Event deleted'); } catch (x) { toast(x.message, 'warn'); } }) }, '🗑️') : null,
        h('button', { class: 'btn small ' + (e.going ? 'going' : 'primary'), type: 'button', onclick: () => rsvp(e) }, e.going ? '✓ Going' : 'RSVP')));
  }

  async function rsvp(e) {
    try {
      const r = await api('POST', `/api/events/${e.id}/rsvp`);
      Object.assign(e, r.event);
      if (r.going && r.clashes.length) toast(`⚠️ Heads up — “${e.title}” clashes with:\n` + r.clashes.map((x) => `• ${x.title} ${fmtMin(x.start)}–${fmtMin(x.end)}`).join('\n'), 'warn');
      else if (r.going) toast('✅ You’re going! Added to your Schedule Planner — no clashes.');
      loadEvents();
    } catch (x) { toast(x.message, 'warn'); }
  }

  function openEventForm(arg) {
    const preVenue = typeof arg?.venue === 'string' ? arg.venue : '';
    const toLocalInput = (d) => `${dateKey(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    const s0 = new Date(); s0.setMinutes(0, 0, 0); s0.setHours(s0.getHours() + 1);
    const e0 = new Date(s0.getTime() + 2 * 3600e3);
    const f = {
      title: h('input', { maxlength: 100, placeholder: 'e.g. Robotronics Line-Follower Workshop', required: true }),
      community: h('select', {}, S.communities.map((c) => h('option', { value: c.id, selected: c.id === (S.communities.some((x) => x.id === S.newsFilter) ? S.newsFilter : 'campus') }, c.icon + ' ' + c.short))),
      start: h('input', { type: 'datetime-local', value: toLocalInput(s0) }),
      end: h('input', { type: 'datetime-local', value: toLocalInput(e0) }),
      venue: h('input', { maxlength: 100, placeholder: 'e.g. Auditorium, North Campus', list: 'venues', value: preVenue }),
      desc: h('textarea', { rows: 3, maxlength: 1000, placeholder: 'What, who it’s for, what to bring…' }),
    };
    const venues = h('datalist', { id: 'venues' }, ['Online', ...CAMPUS.places.filter((p) => p.campus !== 'Around').map((p) => `${p.name}, ${p.campus} Campus`)].map((v) => h('option', { value: v })));
    f.start.addEventListener('change', () => { const s = new Date(f.start.value); if (new Date(f.end.value) <= s) f.end.value = toLocalInput(new Date(s.getTime() + 2 * 3600e3)); });
    const err = h('p', { class: 'form-error' });
    const close = modal('Post an upcoming event', [
      h('label', {}, 'Title', f.title),
      h('div', { class: 'row2' }, h('label', {}, 'Community', f.community), h('label', {}, 'Venue', f.venue, venues)),
      h('div', { class: 'row2' }, h('label', {}, 'Starts', f.start), h('label', {}, 'Ends', f.end)),
      h('label', {}, 'Description', f.desc), err,
      h('div', { class: 'actions-row' }, h('button', { class: 'btn', type: 'button', onclick: () => close() }, 'Cancel'),
        h('button', { class: 'btn primary', type: 'button', onclick: async (ev) => {
          ev.target.disabled = true; err.textContent = '';
          try {
            const r = await api('POST', '/api/events', { title: f.title.value, communityId: f.community.value, start: new Date(f.start.value).toISOString(), end: new Date(f.end.value).toISOString(), venue: f.venue.value, desc: f.desc.value });
            close(); toast('📰 Event posted — everyone on campus has been notified.');
            if (r.venueClashes.length) toast(`⚠️ Venue clash: ${r.venueClashes.join(', ')} is booked at ${f.venue.value} at the same time.`, 'warn');
            if (r.event.clashes.length) toast('⚠️ This clashes with your own schedule: ' + r.event.clashes.map((x) => x.title).join(', '), 'warn');
            loadEvents();
          } catch (x) { err.textContent = x.message; ev.target.disabled = false; }
        } }, 'Post event')),
    ]);
    setTimeout(() => f.title.focus(), 0);
  }


  // ---------------------------------------------------------------- guidance & counselling (GCS)
  let breatheTimer = null;
  function stopBreathing() { clearInterval(breatheTimer); breatheTimer = null; }
  function renderCare() {
    stopBreathing();
    const main = $('#main');
    const tel = (n) => 'tel:' + n.replace(/[^\d+]/g, '');
    const first = S.me.name.split(' ')[0];
    const mail = `mailto:${GCS.email}?subject=${encodeURIComponent('Session request')}&body=${encodeURIComponent(`Hello GCS team,\n\nI'd like to request a counselling session.\n\nName: ${S.me.name}\nRoll number: \nCampus (North/South): \nPreferred days and times: \nIn person or online: \n\nThank you,\n${first}`)}`;

    // box breathing: 4s in, 4s hold, 4s out, 4s hold
    const phaseEl = h('div', { class: 'breath-text' }, 'Tap start');
    const circle = h('div', { class: 'breath-circle' }, phaseEl);
    const startBtn = h('button', { class: 'btn primary', type: 'button', onclick: () => {
      if (breatheTimer) { stopBreathing(); circle.className = 'breath-circle'; phaseEl.textContent = 'Tap start'; startBtn.textContent = 'Start'; return; }
      const phases = [['Breathe in', 'in'], ['Hold', 'hold-in'], ['Breathe out', 'out'], ['Hold', 'hold-out']];
      let i = 0, sec = 4;
      const tick = () => {
        if (!document.body.contains(circle)) return stopBreathing();
        if (sec === 4) { circle.className = 'breath-circle ' + phases[i][1]; }
        phaseEl.textContent = `${phases[i][0]} · ${sec}`;
        if (--sec === 0) { sec = 4; i = (i + 1) % 4; }
      };
      tick(); breatheTimer = setInterval(tick, 1000); startBtn.textContent = 'Stop';
    } }, 'Start');

    main.replaceChildren(
      h('div', { class: 'page-head' }, h('h2', {}, '💚 Guidance & Counselling'),
        h('a', { class: 'btn', href: GCS.officialUrl, target: '_blank', rel: 'noopener' }, 'Official GCS page ↗')),
      h('div', { class: 'page-body care' },
        h('section', { class: 'care-hero' },
          h('div', {},
            h('h3', {}, `You don’t have to figure it out alone, ${first}.`),
            h('p', {}, 'IIT Mandi’s Guidance and Counselling Service (GCS) offers confidential counselling and support for anything on your mind: stress, exams, homesickness, relationships, low mood, or just needing someone to talk to.'),
            h('div', { class: 'care-tags' }, h('span', {}, '🔒 Confidential'), h('span', {}, '🆓 Free for IIT Mandi students'), h('span', {}, '🤝 Stigma-free'))),
          h('div', { class: 'care-cta' },
            h('a', { class: 'btn primary', href: mail }, '✉️ Request a session'),
            h('a', { class: 'btn', href: GCS.officialUrl, target: '_blank', rel: 'noopener' }, '📝 Session request form'),
            h('small', { class: 'hint' }, '“Request a session” opens an email to GCS with a short template you can fill in.'))),

        h('section', { class: 'care-urgent' },
          h('h4', {}, '🚨 Need help right now?'),
          h('p', {}, 'If you or someone else is in immediate danger, call emergency services. You can also talk to a trained counsellor any time, day or night:'),
          h('div', { class: 'care-grid' }, GCS.helplines.map((x) => h('a', { class: 'care-call', href: tel(x.number) },
            h('b', {}, x.number), h('span', {}, x.name), h('small', {}, x.note)))),
          h('p', { class: 'hint', style: 'margin:8px 0 0' }, 'On campus you can also go to the ', h('button', { class: 'linkish', type: 'button', onclick: () => selectPlace('north-health-centre', true) }, 'Health Centre'), ', or tell a friend, your warden or the GCS team.')),

        h('div', { class: 'care-cols' },
          h('section', { class: 'care-card' },
            h('h4', {}, '📞 Contact GCS'),
            h('a', { class: 'care-line', href: 'mailto:' + GCS.email }, '✉️ ', GCS.email),
            GCS.phones.map((p) => h('a', { class: 'care-line', href: tel(p.number) }, '☎️ ', h('span', {}, p.number), h('small', { class: 'hint' }, ' · ' + p.label))),
            h('div', { class: 'section-title', style: 'margin-top:10px' }, 'Offices'),
            GCS.offices.map((o) => h('div', { class: 'care-line' }, '📍 ', h('b', {}, o.campus + ': '), o.where))),
          h('section', { class: 'care-card' },
            h('h4', {}, '👥 The GCS team'),
            GCS.team.map(([n, r]) => h('div', { class: 'list-row' }, h('div', { class: 'avatar sm', style: 'background:#7c5cf0' }, initials(n.replace(/^(Dr|Mr|Ms)\.?\s*/, ''))), h('span', { class: 'grow' }, n), h('small', { class: 'hint' }, r))))),

        h('div', { class: 'care-cols' },
          h('section', { class: 'care-card' },
            h('h4', {}, '🫁 Box breathing (1 minute)'),
            h('p', { class: 'hint', style: 'margin:0 0 6px' }, 'A simple way to slow down when you feel tense: breathe in for 4, hold for 4, out for 4, hold for 4.'),
            h('div', { class: 'breath-wrap' }, circle), h('div', { style: 'text-align:center' }, startBtn)),
          h('section', { class: 'care-card' },
            h('h4', {}, '🌿 5-4-3-2-1 grounding'),
            h('p', { class: 'hint', style: 'margin:0 0 6px' }, 'When thoughts are racing, gently notice:'),
            h('ol', { class: 'ground' },
              h('li', {}, h('b', {}, '5'), ' things you can see'), h('li', {}, h('b', {}, '4'), ' things you can touch'),
              h('li', {}, h('b', {}, '3'), ' things you can hear'), h('li', {}, h('b', {}, '2'), ' things you can smell'),
              h('li', {}, h('b', {}, '1'), ' thing you can taste')),
            h('p', { class: 'hint', style: 'margin:8px 0 0' }, 'These are self-help exercises, not a replacement for talking to a counsellor.'))),

        h('section', { class: 'care-card' },
          h('h4', {}, 'ℹ️ Good to know'),
          h('ul', { class: 'care-list' },
            h('li', {}, h('b', {}, 'Confidential: '), 'what you share stays between you and the counsellor. The only exceptions are a risk of harm to yourself or others, or legal requirements.'),
            h('li', {}, h('b', {}, 'Free: '), 'counselling is free for all IIT Mandi registered students.'),
            h('li', {}, h('b', {}, 'For everyone: '), 'GCS follows an anti-discrimination policy and aims to be a stigma-free space.'),
            h('li', {}, h('b', {}, 'Feedback: '), 'give it in writing, in person to the counsellor, or anonymously through the feedback box outside the GCS office.'),
            h('li', {}, h('b', {}, 'Privacy in VEYA: '), 'nothing you do on this page is saved or shared. Session requests go straight from your email to GCS.'))),
        h('p', { class: 'hint', style: 'text-align:center;margin-top:14px' }, 'Details from the official GCS page. If something has changed, check ', h('a', { href: GCS.officialUrl, target: '_blank', rel: 'noopener' }, 'students.iitmandi.ac.in/main/gcs'), '.')));
  }

  // ---------------------------------------------------------------- QR attendance
  const checkinLink = (eventId, code) => `${location.origin}/?checkin=${encodeURIComponent(eventId)}&code=${encodeURIComponent(code)}`;
  async function openAttendance(e) {
    let data;
    try { data = await api('GET', `/api/events/${e.id}/attendance`); } catch (x) { return toast(x.message, 'warn'); }
    const qrImg = h('img', { class: 'qr-img', alt: 'Attendance QR code' });
    const codeEl = h('div', { class: 'att-code' });
    const countEl = h('div', { class: 'att-count' });
    const listEl = h('div', { class: 'att-list' });
    const statusEl = h('p', { class: 'hint', style: 'margin:0;text-align:center' });
    const draw = () => {
      const q = qrcode(0, 'M'); q.addData(checkinLink(e.id, data.code)); q.make();
      qrImg.src = q.createDataURL(8, 3);
      codeEl.textContent = data.code;
      countEl.textContent = `${data.attendees.length} checked in`;
      statusEl.textContent = data.open ? 'Check-in is open now.' : `Check-in opens ${new Date(data.opensAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })} and closes ${new Date(data.closesAt).toLocaleTimeString([], { timeStyle: 'short' })}.`;
      listEl.replaceChildren(...(data.attendees.length ? [...data.attendees].reverse().map((a) => h('div', { class: 'list-row' },
        avatar(S.users.get(a.id) || { name: a.name, color: '#888' }, 'sm'), h('span', { class: 'grow' }, a.name, ' ', h('small', { class: 'hint' }, '@' + a.username)), h('small', { class: 'hint' }, timeStr(a.at))))
        : [h('p', { class: 'hint', style: 'margin:0' }, 'No one has checked in yet.')]));
    };
    const local = /^(localhost|127\.|\[::1\])/.test(location.hostname);
    const close = modal(`📷 Attendance · ${e.title}`, [
      local ? h('div', { class: 'clash-box' }, '⚠️ You opened VEYA on “localhost”, which phones can’t reach. To let students scan, open VEYA with your Wi-Fi IP address or tunnel link and show the QR from there.') : null,
      h('div', { class: 'att-grid' },
        h('div', { class: 'qr-box' }, qrImg, h('small', { class: 'hint' }, 'Scan with your phone camera'), h('div', { class: 'hint' }, 'or enter code'), codeEl),
        h('div', { class: 'att-side' }, countEl, statusEl, h('div', { class: 'section-title' }, 'Attendees'), listEl)),
      h('div', { class: 'actions-row' },
        h('button', { class: 'btn', type: 'button', onclick: async () => { try { data = await api('POST', `/api/events/${e.id}/attendance/rotate`); draw(); toast('New code. The old QR no longer works.'); } catch (x) { toast(x.message, 'warn'); } } }, '🔄 New code'),
        h('button', { class: 'btn', type: 'button', onclick: () => downloadAttendance(e, data) }, '⬇️ Download CSV'),
        h('button', { class: 'btn primary', type: 'button', onclick: () => qrImg.requestFullscreen?.() }, '⛶ Fullscreen QR')),
    ], { wide: true });
    draw();
    // live refresh while the modal is open
    const t = setInterval(async () => {
      if (!document.body.contains(qrImg)) return clearInterval(t);
      try { data = await api('GET', `/api/events/${e.id}/attendance`); draw(); } catch {}
    }, 5000);
  }
  function downloadAttendance(e, data) {
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const rows = [['Name', 'Username', 'Email', 'Checked in at'], ...data.attendees.map((a) => [a.name, a.username, a.email, new Date(a.at).toLocaleString()])];
    const blob = new Blob([rows.map((r) => r.map(esc).join(',')).join('\n')], { type: 'text/csv' });
    const a = h('a', { href: URL.createObjectURL(blob), download: `attendance-${e.title.replace(/[^\w]+/g, '-').toLowerCase()}.csv` });
    document.body.append(a); a.click(); a.remove();
  }

  async function doCheckin(eventId, code) {
    try {
      const r = await api('POST', `/api/events/${eventId}/checkin`, { code });
      toast(r.already ? `You’re already checked in to “${r.title}” 👍` : `✅ Attendance marked for “${r.title}”!`);
      loadEvents();
      return true;
    } catch (x) { toast(x.message, 'warn'); return false; }
  }
  function openCheckin(e) {
    const code = h('input', { maxlength: 6, placeholder: 'ABC123', style: 'text-transform:uppercase;letter-spacing:.3em;font-size:22px;text-align:center;font-weight:800' });
    const video = h('video', { class: 'scan-video', playsinline: true, muted: true, hidden: true });
    let stream = null, timer = null;
    const stop = () => { clearInterval(timer); stream?.getTracks().forEach((t) => t.stop()); };
    const close = modal(`✅ Check in · ${e.title}`, [
      h('p', { style: 'margin:0' }, 'Scan the QR the organiser is showing with your phone’s camera app, or type the 6-letter code below.'),
      'BarcodeDetector' in window ? h('button', { class: 'btn', type: 'button', onclick: async () => {
        try {
          stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
          video.srcObject = stream; video.hidden = false; await video.play();
          const det = new BarcodeDetector({ formats: ['qr_code'] });
          timer = setInterval(async () => {
            const codes = await det.detect(video).catch(() => []);
            const raw = codes[0]?.rawValue; if (!raw) return;
            try { const u = new URL(raw); const id = u.searchParams.get('checkin'), c = u.searchParams.get('code'); if (id && c) { stop(); close(); doCheckin(id, c); } } catch {}
          }, 400);
        } catch { toast('Couldn’t open the camera. Use your phone’s camera app or type the code.', 'warn'); }
      } }, '📷 Scan with this device') : null,
      video, code,
      h('div', { class: 'actions-row' }, h('button', { class: 'btn', type: 'button', onclick: () => { stop(); close(); } }, 'Cancel'),
        h('button', { class: 'btn primary', type: 'button', onclick: async () => { if (await doCheckin(e.id, code.value)) { stop(); close(); } } }, 'Check in')),
    ]);
    setTimeout(() => code.focus(), 0);
  }
  // opened from a scanned QR: /?checkin=<event>&code=<code>
  function takePendingCheckin() {
    const q = new URLSearchParams(location.search);
    if (q.get('checkin') && q.get('code')) {
      try { sessionStorage.setItem('veya-checkin', JSON.stringify({ id: q.get('checkin'), code: q.get('code') })); } catch {}
      history.replaceState(null, '', location.pathname);
    }
    let p = null; try { p = JSON.parse(sessionStorage.getItem('veya-checkin') || 'null'); } catch {}
    return p;
  }
  const pendingCheckin = takePendingCheckin();

  // ---------------------------------------------------------------- schedule
  async function loadSchedule() {
    try { S.schedule = await api('GET', '/api/schedule'); } catch { return; }
    if (S.view === 'schedule') renderWeek();
  }

  function renderSchedule() {
    const main = $('#main');
    if (!S.botLog.length) S.botLog.push({ who: 'bot', text: 'Hi! I’m the Schedule Planner 🗓️ Tell me your classes and club meetings and I’ll warn you about clashes.\nType `help` to see everything I can do.' });
    const input = h('input', { placeholder: 'e.g. add Physics lab wed 14-17', autocomplete: 'off' });
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const qa = {
      title: h('input', { placeholder: 'Title (e.g. MA-101 lecture)' }),
      kind: h('select', {}, h('option', { value: 'weekly' }, 'Weekly'), h('option', { value: 'once' }, 'One-off')),
      day: h('select', {}, days.map((d, i) => h('option', { value: i, selected: i === new Date().getDay() }, d))),
      date: h('input', { type: 'date', value: todayKey(), hidden: true }),
      start: h('input', { type: 'time', value: '09:00' }),
      end: h('input', { type: 'time', value: '10:00' }),
    };
    qa.kind.addEventListener('change', () => { qa.day.hidden = qa.kind.value !== 'weekly'; qa.date.hidden = qa.kind.value === 'weekly'; });
    const addItem = async (force) => {
      const body = { title: qa.title.value.trim(), kind: qa.kind.value, day: +qa.day.value, date: qa.date.value, start: qa.start.value, end: qa.end.value, force };
      try {
        await api('POST', '/api/schedule', body);
        toast('✅ Added “' + body.title + '”'); qa.title.value = ''; loadSchedule();
      } catch (e) {
        if (e.status === 409) {
          const d = e.data; const sug = d.suggestion;
          const close = modal('⚠️ Schedule clash', [
            h('p', { style: 'margin:0' }, `“${body.title}” overlaps with:`),
            h('ul', {}, d.clashes.slice(0, 6).map((c) => h('li', {}, `${c.title} — ${c.onDate} ${fmtMin(c.start)}–${fmtMin(c.end)}`))),
            sug ? h('p', { style: 'margin:0' }, `💡 Nearest free slot: ${sug.date} ${fmtMin(sug.start)}–${fmtMin(sug.end)}`) : null,
            h('div', { class: 'actions-row' },
              sug ? h('button', { class: 'btn primary', type: 'button', onclick: () => { close(); qa.kind.value = 'once'; qa.kind.dispatchEvent(new Event('change')); qa.date.value = sug.date; qa.start.value = fmtMin(sug.start); qa.end.value = fmtMin(sug.end); addItem(false); } }, 'Use free slot') : null,
              h('button', { class: 'btn danger', type: 'button', onclick: () => { close(); addItem(true); } }, 'Add anyway'),
              h('button', { class: 'btn', type: 'button', onclick: () => close() }, 'Cancel')),
          ]);
        } else toast(e.message, 'warn');
      }
    };
    main.replaceChildren(
      h('div', { class: 'topbar' }, menuBtn(), h('div', { class: 't' }, h('h3', {}, '🗓️ Schedule Planner'), h('p', {}, 'Your next 7 days — classes, club meets and RSVP’d events, with clashes in red'))),
      h('div', { class: 'sched' },
        h('div', { class: 'left' },
          h('div', { id: 'week' }),
          h('div', { class: 'legend' }, h('span', {}, 'Your schedule'), h('span', { class: 'ev' }, 'RSVP’d event'), h('span', { class: 'cl' }, 'Clash')),
          h('div', { class: 'quick-add' }, h('h4', {}, 'Quick add'),
            h('div', { class: 'qa-grid' }, qa.title, qa.kind, h('div', {}, qa.day, qa.date), qa.start, qa.end,
              h('button', { class: 'btn primary', type: 'button', onclick: () => qa.title.value.trim() ? addItem(false) : toast('Give it a title first', 'warn') }, 'Add')))),
        h('div', { class: 'botchat' },
          h('div', { class: 'log', id: 'botlog' }),
          h('div', { class: 'bot-chips' }, ['help', 'today', 'week', 'free tomorrow', 'list'].map((c) => h('button', { class: 'chip', type: 'button', onclick: () => sendBot(c) }, c))),
          h('form', { onsubmit: (e) => { e.preventDefault(); const t = input.value.trim(); if (t) { sendBot(t); input.value = ''; } } }, input, h('button', { class: 'btn primary', type: 'submit' }, 'Send')))),
    );
    renderBotLog(); renderWeek();
  }

  function botText(text) { // render `code` spans safely
    const frag = document.createDocumentFragment();
    text.split(/(`[^`]+`)/).forEach((p) => frag.append(p.startsWith('`') && p.endsWith('`') ? h('code', {}, p.slice(1, -1)) : p));
    return frag;
  }

  function renderBotLog() {
    const log = $('#botlog'); if (!log) return;
    log.replaceChildren(...S.botLog.map((m) => m.who === 'bot'
      ? h('div', { style: 'display:flex;gap:8px;align-items:flex-end' }, h('div', { class: 'avatar sm bot' }, '🤖'), h('div', { class: 'bubble bot' }, botText(m.text)))
      : h('div', { class: 'bubble me' }, m.text)));
    log.scrollTop = log.scrollHeight;
  }

  async function sendBot(text) {
    if (S.view !== 'schedule') setView('schedule');
    S.botLog.push({ who: 'me', text }); renderBotLog();
    try {
      const r = await api('POST', '/api/bot', { text });
      S.botLog.push({ who: 'bot', text: r.reply });
      if (r.changed) loadSchedule();
    } catch (e) { S.botLog.push({ who: 'bot', text: '😵 ' + e.message }); }
    renderBotLog();
  }

  function renderWeek() {
    const box = $('#week'); if (!box) return;
    const H0 = 7, H1 = 23, PX = 36;
    const days = [];
    for (let i = 0; i < 7; i++) { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + i); days.push(d); }
    const grid = h('div', { class: 'week' }, h('div', { class: 'hdr' }),
      days.map((d, i) => h('div', { class: 'hdr' + (i === 0 ? ' today' : '') }, d.toLocaleDateString([], { weekday: 'short' }), h('small', {}, d.getDate() + ' ' + d.toLocaleDateString([], { month: 'short' })))));
    grid.append(h('div', { class: 'hours', style: `height:${(H1 - H0) * PX}px` }, Array.from({ length: H1 - H0 }, (_, i) => h('div', {}, i === 0 ? '' : `${H0 + i}:00`))));
    for (const d of days) {
      const k = dateKey(d), dw = d.getDay();
      const items = [
        ...S.schedule.items.filter((it) => (it.kind === 'weekly' && it.day === dw) || (it.kind === 'once' && it.date === k)).map((it) => ({ ...it, type: 'own' })),
        ...S.schedule.events.filter((e) => e.date === k).map((e) => ({ ...e, type: 'event' })),
      ].sort((a, b) => a.start - b.start);
      for (const a of items) a.clash = items.some((b) => b !== a && a.start < b.end && b.start < a.end);
      const col = h('div', { class: 'col', style: `height:${(H1 - H0) * PX}px` });
      // stagger overlapping blocks side by side
      const lanes = [];
      for (const it of items) {
        let lane = lanes.findIndex((end) => end <= it.start);
        if (lane < 0) { lane = lanes.length; lanes.push(0); }
        lanes[lane] = it.end; it.lane = lane;
      }
      const nLanes = Math.max(1, lanes.length);
      for (const it of items) {
        const top = Math.max(0, (it.start - H0 * 60) / 60 * PX);
        const height = Math.max(18, (Math.min(it.end, H1 * 60) - Math.max(it.start, H0 * 60)) / 60 * PX - 2);
        const w = 100 / nLanes;
        col.append(h('div', { class: 'blk' + (it.type === 'event' ? ' event' : '') + (it.clash ? ' clash' : ''), style: `top:${top}px;height:${height}px;left:calc(${it.lane * w}% + 2px);right:auto;width:calc(${w}% - 4px)`, title: `${it.title}\n${fmtMin(it.start)}–${fmtMin(it.end)}${it.clash ? '\n⚠️ Clash!' : ''}` },
          h('b', {}, it.title), `${fmtMin(it.start)}–${fmtMin(it.end)}`,
          it.type === 'own' ? h('button', { class: 'x', type: 'button', title: 'Remove', onclick: async () => { await api('DELETE', '/api/schedule/' + it.id); loadSchedule(); } }, '✕') : null));
      }
      if (k === todayKey()) {
        const now = new Date(); const m = now.getHours() * 60 + now.getMinutes();
        if (m >= H0 * 60 && m <= H1 * 60) col.append(h('div', { class: 'now-line', style: `top:${(m - H0 * 60) / 60 * PX}px` }));
      }
      grid.append(col);
    }
    box.replaceChildren(grid);
  }


  // ---------------------------------------------------------------- campus map
  // Two modes: 'campus' — VEYA's own drawing of North Campus (from the labelled campus image),
  //            'real'   — OpenStreetMap / satellite with true coordinates (both campuses).
  const SVGNS = 'http://www.w3.org/2000/svg';
  function sv(tag, attrs = {}, ...kids) {
    const el = document.createElementNS(SVGNS, tag);
    for (const [k, v] of Object.entries(attrs)) if (v != null) { if (k.startsWith('on')) el.addEventListener(k.slice(2), v); else el.setAttribute(k, v); }
    for (const c of kids.flat()) if (c != null) el.append(c.nodeType ? c : document.createTextNode(String(c)));
    return el;
  }
  const escHtml = (t) => String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  S.mapMode = store.get('kc-map-mode3') || 'photo';
  const isDraw = (m) => m === 'photo' || m === 'campus';
  S.places = { loc: {}, custom: [] };
  S.pinMode = null;
  S.myLoc = null;
  const CM_HOME = { x: -120, y: -40, w: 1420, h: 690 };

  async function loadPlaces() {
    try { S.places = await api('GET', '/api/places'); } catch { return; }
    if (S.view === 'map') { refreshMarkers(); renderPlaceCard(); }
  }
  function allPlaces() {
    const out = CAMPUS.places.map((p) => {
      const pin = S.places.loc[p.id];
      if (pin?.block) {
        const b = CAMPUS.places.find((q) => q.id === pin.block);
        if (b) return { ...p, lat: b.geo[0], lng: b.geo[1], acc: 'pinned', byName: pin.byName, block: b.id, blockLabel: b.label };
      }
      if (pin && Number.isFinite(pin.lat)) return { ...p, lat: pin.lat, lng: pin.lng, acc: 'pinned', byName: pin.byName };
      if (p.geo) return { ...p, lat: p.geo[0], lng: p.geo[1], acc: p.geo[2] };
      return { ...p, acc: 'none' };
    });
    for (const c of S.places.custom) out.push({ ...c, acc: 'added', tags: '', custom: true, x: null });
    return out;
  }
  const placeById = (id) => allPlaces().find((p) => p.id === id);
  const located = (p) => p && Number.isFinite(p.lat) && Number.isFinite(p.lng);
  const onDrawing = (p) => p && p.x != null;
  function placeMatches(p) {
    if (S.mapCat !== 'all' && p.cat !== S.mapCat) return false;
    const q = S.mapQuery.trim().toLowerCase();
    if (!q) return true;
    const hay = [p.name, p.label || '', p.desc, p.tags, CAMPUS.cats[p.cat]?.label, p.campus + ' campus'].join(' ').toLowerCase();
    return q.split(/\s+/).every((w) => hay.includes(w) || hay.includes(w.replace(/^b(\d)/, 'b-$1').replace(/^a(\d)/, 'a-$1')));
  }
  function searchPlaces(q) {
    const all = allPlaces().filter(placeMatches);
    const ql = q.trim().toLowerCase();
    const score = (p) => { const n = p.name.toLowerCase(); return (n === ql ? 0 : n.startsWith(ql) ? 1 : n.includes(ql) ? 2 : 3) + (onDrawing(p) || located(p) ? 0 : 0.5); };
    return all.sort((a, b) => score(a) - score(b));
  }
  function distM(a, b) {
    const R = 6371000, toR = (d) => d * Math.PI / 180;
    const dLat = toR(b.lat - a.lat), dLng = toR(b.lng - a.lng);
    const x = Math.sin(dLat / 2) ** 2 + Math.cos(toR(a.lat)) * Math.cos(toR(b.lat)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(x));
  }
  const walkText = (m) => `${m < 1000 ? Math.round(m / 10) * 10 + ' m' : (m / 1000).toFixed(1) + ' km'} · ~${Math.max(1, Math.round(m / 65))} min walk`;
  const accBadge = (p) => ({
    osm: ['📍 Mapped on OpenStreetMap', ''],
    img: ['📍 On the campus map', ''],
    approx: ['≈ Approximate spot', 'gold'],
    pinned: [`📌 Pinned by @${p.byName || 'a student'}`, ''],
    added: [`➕ Added by @${p.byName || 'a student'}`, ''],
    none: ['Not on the map yet', 'warn'],
  }[p.acc]);

  // ---- page
  function renderMap() {
    const main = $('#main');
    S.leaflet?.remove(); S.leaflet = null; S.markerLayer = null;
    const results = h('div', { class: 'search-results', hidden: true });
    const search = h('input', { class: 'map-search', type: 'search', placeholder: '🔎 Find a place: “B-19”, “Pine Mess”, “library”, “doctor”…', value: S.mapQuery, autocomplete: 'off',
      oninput: (e) => { S.mapQuery = e.target.value; showResults(); updateHighlights(); },
      onfocus: () => showResults(),
      onkeydown: (e) => {
        if (e.key === 'Enter') { e.preventDefault(); const first = results.querySelector('button'); if (first) first.click(); else showResults(); }
        if (e.key === 'Escape') { results.hidden = true; e.target.blur(); }
      } });
    function showResults() {
      const q = S.mapQuery.trim();
      if (!q) { results.hidden = true; return; }
      const list = searchPlaces(q).slice(0, 8);
      results.replaceChildren(...(list.length ? list.map((p) => h('button', { type: 'button', onclick: () => { results.hidden = true; search.blur(); selectPlace(p.id, true); } },
        h('span', { class: 'ico' }, CAMPUS.cats[p.cat].icon),
        h('span', { class: 'nm' }, h('b', {}, p.name), h('small', {}, (p.campus === 'Around' ? 'Around campus' : p.campus + ' Campus') +
          (located(p) && S.myLoc ? ' · ' + walkText(distM(S.myLoc, p)) : '') + (onDrawing(p) || located(p) ? '' : ' · not pinned yet'))))) :
        [h('p', { class: 'hint', style: 'padding:10px' }, 'No place matches. Try a block number like “B-8”, or add it from 🛰️ Satellite → ➕.')]));
      results.hidden = false;
    }
    document.addEventListener('mousedown', function off(e) { if (!e.target.closest('.map-search-wrap')) results.hidden = true; if (!document.body.contains(search)) document.removeEventListener('mousedown', off); });

    const modeBtn = (id, label) => h('button', { type: 'button', class: S.mapMode === id ? 'active' : '', onclick: () => setMapMode(id) }, label);
    const chips = h('div', { class: 'filter-row map-chips', style: 'margin:0;padding:8px 16px 10px' },
      [['all', '✨ All'], ...Object.entries(CAMPUS.cats).map(([id, c]) => [id, c.icon + ' ' + c.label])].map(([id, label]) =>
        h('button', { class: 'chip' + (S.mapCat === id ? ' active' : ''), type: 'button', onclick: () => { S.mapCat = id; renderMap(); } }, label)));
    const body = h('div', { class: 'map-wrap' });
    main.replaceChildren(
      h('div', { class: 'topbar map-top' },
        h('div', { class: 'map-search-wrap' }, search, results),
        h('div', { class: 'seg' }, modeBtn('photo', '📷 Campus photo'), modeBtn('campus', '🏫 Drawn'), modeBtn('real', '🛰️ Satellite'))),
      chips, body);
    if (S.mapMode === 'real' && typeof L !== 'undefined') renderRealMap(body);
    else { if (S.mapMode === 'real') toast('The satellite view needs the map library; showing the campus photo.', 'warn'); renderCampusMap(body, S.mapMode !== 'campus'); }
    renderPlaceCard(); renderPinBanner();
    if (!S.placesLoaded) { S.placesLoaded = true; loadPlaces(); }
  }
  function setMapMode(id) {
    S.mapMode = id; store.set('kc-map-mode3', id); S.pinMode = null; renderMap();
  }

  // ---- drawn North Campus map
  function inPoly(x, y, pts) {
    let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const [xi, yi] = pts[i], [xj, yj] = pts[j];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }
  const CLS = { academic: 'b-acad', hostel: 'b-host', mess: 'b-mess', canteen: 'b-can', facility: 'b-fac', sports: 'b-sport', landmark: 'b-land' };
  function renderCampusMap(body, photo = false) {
    const D = CAMPUS.decor;
    S.cmView ||= { ...CM_HOME };
    const svg = sv('svg', { class: 'cmap' + (photo ? ' photo' : ''), viewBox: '', preserveAspectRatio: 'xMidYMid meet', role: 'img', 'aria-label': 'Map of IIT Mandi North Campus' });
    if (photo) {
      // the labelled campus photo itself is the map; buildings become tappable areas on top of it
      svg.append(sv('rect', { class: 'photo-bg', x: -3000, y: -3000, width: 8000, height: 8000 }),
        sv('image', { href: 'img/north-campus-labelled.jpg', x: 0, y: 0, width: D.size[0], height: D.size[1], preserveAspectRatio: 'none' }));
    } else {
    svg.append(sv('rect', { class: 'forest', x: -3000, y: -3000, width: 8000, height: 8000 }), sv('path', { class: 'river', d: D.river }));
    for (const z of D.zones) svg.append(sv('polygon', { class: 'zone-shape ' + z.cls, points: z.pts }));
    for (const r of D.roads) svg.append(sv('path', { class: 'road', d: r }));
    // faculty houses: small blocks filling the faculty zone
    const fac = D.zones.find((z) => z.cls === 'z-fac').pts.split(' ').map((p) => p.split(',').map(Number));
    for (let y = 420, row = 0; y < 575; y += 30, row++) for (let x = 160 + (row % 2) * 24; x < 1040; x += 48) {
      if (inPoly(x, y, fac) && inPoly(x + 20, y + 12, fac) && Math.hypot(x - 630, y - 500) > 70) svg.append(sv('rect', { class: 'b-house', x, y, width: 24, height: 14, rx: 3, transform: `rotate(-6 ${x + 12} ${y + 7})`, opacity: .8 }));
    }
    for (const z of D.zoneNames) svg.append(sv('text', { class: 'zone-name', x: z.x, y: z.y }, z.t));
    }
    // buildings / pins
    const g = sv('g', { id: 'cm-places' });
    for (const p of CAMPUS.places.filter(onDrawing)) {
      const c = CAMPUS.cats[p.cat];
      const node = sv('g', { class: 'bld', 'data-id': p.id, onclick: (e) => { e.stopPropagation(); selectPlace(p.id); } }, sv('title', {}, p.name));
      const sh = p.shape;
      if (sh && sh[0] === 'r') node.append(sv('rect', { class: CLS[p.cat], x: p.x - sh[1] / 2, y: p.y - sh[2] / 2, width: sh[1], height: sh[2], rx: 5, transform: sh[3] ? `rotate(${sh[3]} ${p.x} ${p.y})` : null }));
      else if (sh && sh[0] === 'c') node.append(sv('circle', { class: CLS[p.cat], cx: p.x, cy: p.y, r: sh[1] }));
      else if (sh && sh[0] === 'e') node.append(sv('ellipse', { class: p.name === 'Village Square' ? 'b-lawn' : CLS[p.cat], cx: p.x, cy: p.y, rx: sh[1], ry: sh[2] }));
      else node.append(sv('circle', { class: CLS[p.cat], cx: p.x, cy: p.y, r: photo ? 18 : 13 }), photo ? null : sv('text', { class: 'ico', x: p.x, y: p.y }, c.icon));
      if (photo && !p.offImage) { g.append(node); continue; } // the photo already has its own labels
      if (photo) node.classList.add('off-img');
      const short = p.label || p.name;
      const inside = sh && (sh[0] === 'r' ? sh[1] >= 70 : sh[0] === 'c' ? sh[1] >= 30 : false) && short.length <= 8;
      if (inside) node.append(sv('text', { class: 'bl', x: p.x, y: p.y, transform: sh[0] === 'r' && sh[3] ? `rotate(${sh[3]} ${p.x} ${p.y})` : null }, short));
      else {
        const off = sh ? (sh[0] === 'r' ? sh[2] / 2 : sh[0] === 'c' ? sh[1] : sh[2]) + 13 : 26;
        if (sh && sh[0] === 'r' && sh[1] < 70 && short.length <= 7) node.append(sv('text', { class: 'bl', x: p.x, y: p.y, style: 'font-size:10.5px' }, sh[2] > 60 ? '' : short));
        else node.append(sv('text', { class: 'tag', x: p.x, y: p.y + off }, short));
      }
      g.append(node);
    }
    svg.append(g, sv('g', { id: 'cm-pulse' }));
    // compass (true north) + sign to South Campus
    const [nx, ny] = D.north, cx = 1222, cy = 560;
    svg.append(sv('g', { class: 'compass' }, sv('circle', { cx, cy, r: 26 }),
      sv('path', { d: `M${cx + nx * 20} ${cy + ny * 20} L${cx - ny * 6} ${cy + nx * 6} L${cx + ny * 6} ${cy - nx * 6} Z` }),
      sv('text', { x: cx + nx * 36, y: cy + ny * 36 }, 'N')));
    const ss = D.southSign;
    svg.append(sv('g', { class: 'sign', onclick: (e) => { e.stopPropagation(); setMapMode('real'); setTimeout(() => S.leaflet?.flyTo([CAMPUS.areas[1].lat, CAMPUS.areas[1].lng], 17), 80); } },
      sv('rect', { x: ss.x - 10, y: ss.y - 16, width: 190, height: 32, rx: 16 }), sv('text', { x: ss.x + 4, y: ss.y }, ss.label)));

    // pan + zoom
    const applyView = () => { const v = S.cmView; svg.setAttribute('viewBox', `${v.x} ${v.y} ${v.w} ${v.h}`); };
    const toSvg = (cx2, cy2) => { const r = svg.getBoundingClientRect(); const v = S.cmView; const sc = Math.max(v.w / r.width, v.h / r.height); const ox = (r.width * sc - v.w) / 2, oy = (r.height * sc - v.h) / 2; return { x: v.x - ox + (cx2 - r.left) * sc, y: v.y - oy + (cy2 - r.top) * sc, sc }; };
    const zoom = (f, cx2, cy2) => {
      const v = S.cmView; const nw = Math.min(2000, Math.max(240, v.w * f)); const k = nw / v.w;
      const pt = cx2 != null ? toSvg(cx2, cy2) : { x: v.x + v.w / 2, y: v.y + v.h / 2 };
      S.cmView = { x: pt.x - (pt.x - v.x) * k, y: pt.y - (pt.y - v.y) * k, w: nw, h: v.h * k }; applyView();
    };
    S.cmAnimateTo = (target) => {
      const from = { ...S.cmView }, t0 = performance.now(), dur = 450;
      const step = (t) => { const k = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - k, 3);
        S.cmView = { x: from.x + (target.x - from.x) * e, y: from.y + (target.y - from.y) * e, w: from.w + (target.w - from.w) * e, h: from.h + (target.h - from.h) * e };
        applyView(); if (k < 1) requestAnimationFrame(step); };
      requestAnimationFrame(step);
    };
    svg.addEventListener('wheel', (e) => { e.preventDefault(); zoom(e.deltaY > 0 ? 1.15 : 1 / 1.15, e.clientX, e.clientY); }, { passive: false });
    let drag = null;
    svg.addEventListener('pointerdown', (e) => { if (e.target.closest('.bld, .sign')) return; drag = { x: e.clientX, y: e.clientY, v: { ...S.cmView }, moved: false }; svg.setPointerCapture(e.pointerId); });
    svg.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const sc = toSvg(0, 0).sc; const dx = (e.clientX - drag.x) * sc, dy = (e.clientY - drag.y) * sc;
      if (Math.abs(dx) + Math.abs(dy) > 3) { drag.moved = true; svg.classList.add('dragging'); }
      S.cmView = { ...drag.v, x: drag.v.x - dx, y: drag.v.y - dy }; applyView();
    });
    const end = () => { if (drag && !drag.moved) selectPlace(null); drag = null; svg.classList.remove('dragging'); };
    svg.addEventListener('pointerup', end); svg.addEventListener('pointercancel', end);

    body.append(svg,
      h('div', { class: 'map-ctrl' },
        h('button', { type: 'button', title: 'Zoom in', onclick: () => zoom(1 / 1.3) }, '+'),
        h('button', { type: 'button', title: 'Zoom out', onclick: () => zoom(1.3) }, '−'),
        h('button', { type: 'button', title: 'Show whole campus', onclick: () => S.cmAnimateTo({ ...CM_HOME }) }, '⟲')),
      h('div', { id: 'place-card' }), h('div', { id: 'pin-banner' }),
      h('div', { class: 'map-legend' }, photo ? null : Object.entries(CAMPUS.cats).filter(([k]) => k !== 'landmark').map(([, c]) => h('span', {}, h('i', { style: `background:${c.color}` }), c.label)),
        h('span', {}, '🧭 North Campus · tap any building · South Campus is on 🛰️ Satellite')));
    applyView(); updateHighlights();
    const sel = placeById(S.mapSel); if (onDrawing(sel)) focusDrawing(sel, false);
  }
  function focusDrawing(p, animate = true) {
    const r = $('svg.cmap')?.getBoundingClientRect();
    const aspect = r && r.height ? r.width / r.height : 2;
    const hh = aspect < 1 ? 420 : 360, w = Math.max(300, hh * aspect);
    // on phones the info card covers the bottom half, so keep the place in the upper part of the view
    const narrow = window.innerWidth < 820;
    const target = { x: p.x - w / 2, y: p.y - hh * (narrow ? 0.28 : 0.5), w, h: hh };
    if (animate && S.cmAnimateTo) S.cmAnimateTo(target); else { S.cmView = target; $('svg.cmap')?.setAttribute('viewBox', `${target.x} ${target.y} ${target.w} ${target.h}`); }
  }
  function updateHighlights() {
    refreshMarkers();
    const all = new Map(allPlaces().map((p) => [p.id, p]));
    $$('#cm-places .bld').forEach((g) => {
      const p = all.get(g.dataset.id); if (!p) return;
      g.classList.toggle('dim', !placeMatches(p));
      g.classList.toggle('sel', S.mapSel === p.id);
    });
    const filtering = !!S.mapQuery.trim() || S.mapCat !== 'all';
    $$('#cm-places .bld').forEach((g) => { const p = all.get(g.dataset.id); g.classList.toggle('match', filtering && !!p && placeMatches(p)); });
    const pulse = $('#cm-pulse');
    if (pulse) {
      pulse.replaceChildren();
      const p = all.get(S.mapSel);
      if (onDrawing(p)) pulse.append(sv('circle', { class: 'pulse', cx: p.x, cy: p.y, r: 34 }), sv('circle', { class: 'pulse', cx: p.x, cy: p.y, r: 34, style: 'animation-delay:.7s' }));
    }
  }

  // ---- real map (Leaflet)
  function renderRealMap(body) {
    const host = h('div', { class: 'leaflet-host' });
    body.append(host,
      h('div', { class: 'map-ctrl' },
        h('button', { type: 'button', title: 'Show my location', onclick: locateMe }, '📍'),
        h('button', { type: 'button', title: 'North Campus', onclick: () => S.leaflet?.flyTo([31.7813, 76.9968], 18) }, 'N'),
        h('button', { type: 'button', title: 'South Campus', onclick: () => S.leaflet?.flyTo([CAMPUS.areas[1].lat, CAMPUS.areas[1].lng], 18) }, 'S'),
        h('button', { type: 'button', title: 'Both campuses', onclick: () => S.leaflet?.flyTo(CAMPUS.center, 16) }, '⟲'),
        h('button', { type: 'button', title: 'Add a missing place', onclick: () => startPinMode({ add: true }) }, '➕')),
      h('div', { id: 'place-card' }), h('div', { id: 'pin-banner' }));
    const map = L.map(host, { zoomControl: true }).setView([31.7813, 76.9968], 18);
    S.leaflet = map;
    const streets = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap contributors' });
    const sat = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, attribution: 'Imagery © Esri' });
    (store.get('kc-map-layer') === 'streets' ? streets : sat).addTo(map);
    L.control.layers({ '🛰️ Satellite': sat, '🗺️ Streets': streets }, null, { position: 'bottomright' }).addTo(map);
    map.on('baselayerchange', (e) => store.set('kc-map-layer', e.layer === sat ? 'sat' : 'streets'));
    L.control.scale({ imperial: false, position: 'bottomleft' }).addTo(map);
    for (const a of CAMPUS.areas) L.marker([a.lat, a.lng], { icon: L.divIcon({ className: 'area-label', html: escHtml(a.name), iconSize: [140, 24], iconAnchor: [70, 40] }), interactive: false, keyboard: false }).addTo(map);
    S.markerLayer = L.layerGroup().addTo(map);
    const setZoomClass = () => host.classList.toggle('show-labels', map.getZoom() >= 18);
    map.on('zoomend', setZoomClass); setZoomClass();
    map.on('click', (e) => onMapClick(e.latlng));
    if (S.myLoc) drawMyLoc();
    refreshMarkers();
    setTimeout(() => map.invalidateSize(), 50);
    const sel = placeById(S.mapSel);
    if (located(sel)) map.setView([sel.lat, sel.lng], 18);
  }
  function refreshMarkers() {
    if (!S.leaflet || !S.markerLayer) return;
    S.markerLayer.clearLayers();
    for (const p of allPlaces()) {
      if (!located(p)) continue;
      const c = CAMPUS.cats[p.cat];
      const dim = !placeMatches(p), sel = S.mapSel === p.id;
      const html = `<div class="mk${sel ? ' sel' : ''}${dim ? ' dim' : ''}" style="--c:${c.color}"><span>${c.icon}</span><b>${escHtml(p.label || p.name)}</b></div>`;
      L.marker([p.lat, p.lng], { icon: L.divIcon({ className: 'mk-wrap', html, iconSize: [30, 30], iconAnchor: [15, 15] }), title: p.name, zIndexOffset: sel ? 1000 : dim ? -500 : 0, riseOnHover: true })
        .on('click', (e) => { L.DomEvent.stopPropagation(e); selectPlace(p.id); })
        .addTo(S.markerLayer);
    }
  }
  function locateMe() {
    if (!navigator.geolocation) return toast('Your browser can’t share location.', 'warn');
    if (!window.isSecureContext) return toast('Location only works over https:// or on localhost.', 'warn');
    toast('Finding you…', 'info');
    navigator.geolocation.getCurrentPosition((pos) => {
      S.myLoc = { lat: pos.coords.latitude, lng: pos.coords.longitude, acc: pos.coords.accuracy };
      drawMyLoc();
      if (distM(S.myLoc, { lat: CAMPUS.center[0], lng: CAMPUS.center[1] }) > 5000) toast('You seem to be away from campus. Distances are measured from where you are now.', 'info');
      else S.leaflet?.flyTo([S.myLoc.lat, S.myLoc.lng], 18);
      renderPlaceCard();
    }, (err) => toast(err.code === 1 ? 'Location permission was denied. Allow it in your browser’s site settings.' : 'Couldn’t get your location. Try again outdoors.', 'warn'),
    { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 });
  }
  function drawMyLoc() {
    if (!S.leaflet || !S.myLoc) return;
    S.myLocLayer?.remove();
    S.myLocLayer = L.layerGroup([
      L.circle([S.myLoc.lat, S.myLoc.lng], { radius: Math.min(S.myLoc.acc, 300), color: '#2b7de9', weight: 1, fillOpacity: 0.12 }),
      L.circleMarker([S.myLoc.lat, S.myLoc.lng], { radius: 8, color: '#fff', weight: 3, fillColor: '#2b7de9', fillOpacity: 1 }).bindTooltip('You are here'),
    ]).addTo(S.leaflet);
  }

  // ---- pinning & adding places (real map)
  function startPinMode(mode) {
    if (typeof L === 'undefined') return toast('Pinning needs the real map.', 'warn');
    S.pinMode = mode;
    if (S.view !== 'map' || S.mapMode !== 'real') { S.mapMode = 'real'; store.set('kc-map-mode3', 'real'); if (S.view !== 'map') setView('map'); else renderMap(); }
    renderPinBanner();
    const p = mode.id && placeById(mode.id);
    if (located(p)) S.leaflet?.flyTo([p.lat, p.lng], 18);
  }
  function renderPinBanner() {
    const box = $('#pin-banner'); if (!box) return;
    $('.leaflet-host')?.classList.toggle('pinning', !!S.pinMode);
    if (!S.pinMode || S.mapMode !== 'real') return box.replaceChildren();
    const p = S.pinMode.id && placeById(S.pinMode.id);
    box.replaceChildren(h('div', { class: 'map-banner' },
      h('span', {}, S.pinMode.add ? '➕ Tap the spot on the map where the new place is' : ['📌 Tap the exact spot of ', h('b', {}, p?.name || 'this place'), ' on the map']),
      h('span', { class: 'hint' }, ' Tip: switch to 🛰️ Satellite and zoom in.'),
      h('button', { class: 'btn small', type: 'button', onclick: () => { S.pinMode = null; renderPinBanner(); } }, 'Cancel')));
  }
  async function onMapClick(latlng) {
    if (!S.pinMode) { if (S.mapSel) selectPlace(null); return; }
    const mode = S.pinMode; S.pinMode = null; renderPinBanner();
    if (mode.add) return openAddPlace(latlng);
    try {
      await api('PUT', `/api/places/${mode.id}/location`, { lat: latlng.lat, lng: latlng.lng });
      toast(`🙌 Thanks! ${placeById(mode.id)?.name} is now on the map for everyone.`);
      await loadPlaces(); selectPlace(mode.id);
    } catch (e) { toast(e.message, 'warn'); }
  }
  function openAddPlace(latlng) {
    const name = h('input', { maxlength: 60, placeholder: 'e.g. Photocopy shop, ATM, Bus stop' });
    const cat = h('select', {}, Object.entries(CAMPUS.cats).map(([id, c]) => h('option', { value: id }, c.icon + ' ' + c.label)));
    const near = CAMPUS.areas.map((a) => ({ a, d: distM(a, { lat: latlng.lat, lng: latlng.lng }) })).sort((x, y) => x.d - y.d)[0];
    const campus = h('select', {}, ['North', 'South', 'Around'].map((c) => h('option', { value: c, selected: near.d < 700 ? near.a.name.startsWith(c) : c === 'Around' }, c === 'Around' ? 'Around campus' : c + ' Campus')));
    const desc = h('input', { maxlength: 200, placeholder: 'What’s there? Timings, tips…' });
    const err = h('p', { class: 'form-error' });
    const close = modal('➕ Add a place', [
      h('p', { class: 'hint', style: 'margin:0' }, 'It appears on everyone’s map straight away.'),
      h('label', {}, 'Name', name), h('div', { class: 'row2' }, h('label', {}, 'Category', cat), h('label', {}, 'Where', campus)),
      h('label', {}, 'Description (optional)', desc), err,
      h('div', { class: 'actions-row' }, h('button', { class: 'btn', type: 'button', onclick: () => close() }, 'Cancel'),
        h('button', { class: 'btn primary', type: 'button', onclick: async () => {
          try {
            const r = await api('POST', '/api/places', { name: name.value, cat: cat.value, campus: campus.value, desc: desc.value, lat: latlng.lat, lng: latlng.lng });
            close(); toast(`📍 ${r.place.name} added to the map`); await loadPlaces(); selectPlace(r.place.id);
          } catch (x) { err.textContent = x.message; }
        } }, 'Add place')),
    ]);
    setTimeout(() => name.focus(), 0);
  }

  // ---- selection & place card
  function selectPlace(id, center) {
    S.mapSel = id;
    const p = placeById(id);
    if (S.view !== 'map') { if (p && onDrawing(p)) S.mapMode = isDraw(S.mapMode) ? S.mapMode : 'photo'; else if (p && located(p)) S.mapMode = 'real'; setView('map'); }
    else if (p && center) {
      if (onDrawing(p) && !isDraw(S.mapMode)) { S.mapMode = 'photo'; store.set('kc-map-mode3', 'photo'); renderMap(); }
      else if (!onDrawing(p) && located(p) && S.mapMode !== 'real') { S.mapMode = 'real'; store.set('kc-map-mode3', 'real'); renderMap(); }
    }
    if (p && center) {
      if (isDraw(S.mapMode) && onDrawing(p)) focusDrawing(p);
      if (S.mapMode === 'real' && S.leaflet && located(p)) S.leaflet.flyTo([p.lat, p.lng], 18, { duration: 0.6 });
    }
    updateHighlights(); renderPlaceCard();
  }
  // named North hostels without a drawn building can be linked to the B-block they're in
  function hostelBlockPicker(p) {
    if (p.cat !== 'hostel' || p.campus !== 'North' || onDrawing(p) || p.id === 'north-surajtaal-hostel') return null;
    const blocks = CAMPUS.places.filter((q) => /^north-b-\d+-hostel-block$/.test(q.id)).sort((a, b) => parseInt(a.label.slice(2)) - parseInt(b.label.slice(2)));
    const sel = h('select', { 'aria-label': 'Which block is this hostel in?', onchange: async () => {
      try { await api('PUT', `/api/places/${p.id}/block`, { block: sel.value }); toast(sel.value ? 'Linked, thanks!' : 'Block removed'); loadPlaces(); } catch (e) { toast(e.message); }
    } }, h('option', { value: '' }, p.block ? '— not in a block —' : 'Choose a block…'), blocks.map((b) => h('option', { value: b.id, selected: b.id === p.block }, b.label)));
    return h('label', { class: 'block-pick' }, h('small', {}, 'Which block is this hostel in?'), sel);
  }
  function renderPlaceCard() {
    const box = $('#place-card'); if (!box) return;
    const p = placeById(S.mapSel);
    if (!p) return box.replaceChildren();
    const c = CAMPUS.cats[p.cat];
    const venue = p.campus === 'Around' ? p.name : `${p.name}, ${p.campus} Campus`;
    const [badge, tone] = accBadge(p);
    const nearby = located(p) ? allPlaces().filter((q) => q.id !== p.id && located(q)).map((q) => ({ q, d: distM(p, q) })).filter((x) => x.d < 400).sort((a, b) => a.d - b.d).slice(0, 4) : [];
    const directions = located(p)
      ? `https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lng}&travelmode=walking`
      : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(p.name + ' IIT Mandi Kamand')}`;
    const mine = p.custom && S.places.custom.find((x) => x.id === p.id)?.by === S.me.id;
    box.replaceChildren(h('div', { class: 'place-card' },
      h('div', { style: 'display:flex;justify-content:space-between;gap:8px;align-items:flex-start' },
        h('h4', {}, c.icon, ' ', p.name), h('button', { class: 'icon-btn', type: 'button', onclick: () => selectPlace(null), 'aria-label': 'Close' }, '✕')),
      h('div', { class: 'tags', style: 'display:flex;gap:6px;flex-wrap:wrap' },
        h('span', { class: 'pill', style: `background:color-mix(in srgb, ${c.color} 22%, transparent);color:${c.color}` }, c.label),
        h('span', { class: 'pill' }, p.campus === 'Around' ? 'Around campus' : p.campus + ' Campus'),
        h('span', { class: 'pill ' + tone }, badge)),
      p.desc ? h('p', {}, p.desc) : null,
      p.block ? h('p', { class: 'dist' }, `🏠 In ${p.blockLabel}`, p.byName ? ` (set by @${p.byName})` : '', ' · ',
        h('button', { class: 'linkish', type: 'button', onclick: () => selectPlace(p.block, true) }, 'Show ' + p.blockLabel)) : null,
      hostelBlockPicker(p),
      located(p) && S.myLoc ? h('p', { class: 'dist' }, '🚶 ' + walkText(distM(S.myLoc, p)) + ' from you') : null,
      !located(p) && !onDrawing(p) ? h('p', { class: 'dist' }, 'Not pinned yet. If you know where it is, tap “📌 Pin on map”.') : null,
      nearby.length ? h('div', { class: 'nearby' }, h('small', {}, 'Nearby'), nearby.map(({ q, d }) =>
        h('button', { type: 'button', onclick: () => selectPlace(q.id, true) }, CAMPUS.cats[q.cat].icon + ' ' + q.name, h('span', {}, walkText(d))))) : null,
      h('div', { class: 'actions-row', style: 'justify-content:flex-start' },
        h('a', { class: 'btn small primary', href: directions, target: '_blank', rel: 'noopener' }, located(p) ? '🧭 Directions' : '🔎 Google Maps'),
        isDraw(S.mapMode) && located(p) ? h('button', { class: 'btn small', type: 'button', onclick: () => { setMapMode('real'); } }, '🛰️ Satellite') : null,
        S.mapMode === 'real' && onDrawing(p) ? h('button', { class: 'btn small', type: 'button', onclick: () => { setMapMode('photo'); } }, '📷 Campus photo') : null,
        h('button', { class: 'btn small', type: 'button', onclick: () => startPinMode({ id: p.id }) }, located(p) ? '📌 Fix location' : '📌 Pin on map'),
        h('button', { class: 'btn small', type: 'button', onclick: () => openEventForm({ venue }) }, '📅 Event here'),
        h('button', { class: 'btn small', type: 'button', onclick: async () => { await openRoom('campus/general'); setTimeout(() => insertAtCursor('📍 ' + venue + ' '), 50); } }, '💬 Share')),
      p.acc === 'pinned' && !p.block ? h('button', { class: 'linkish', type: 'button', onclick: async () => { await api('DELETE', `/api/places/${p.id}/location`); toast('Pin removed'); loadPlaces(); } }, 'Wrong pin? Remove it') : null,
      mine ? h('button', { class: 'linkish', type: 'button', onclick: () => confirmBox('Delete place?', `“${p.name}” will be removed from everyone’s map.`, 'Delete', async () => { await api('DELETE', '/api/places/' + p.id); S.mapSel = null; loadPlaces(); }) }, 'Delete this place') : null));
  }


  // ---------------------------------------------------------------- go
  if (S.token) start(); else showAuth();
})();
