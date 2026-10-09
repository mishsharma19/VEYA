// VEYA — real-time chat for IIT Mandi communities
const express = require('express');
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Server } = require('socket.io');

const db = require('./db');
const { COMMUNITIES, SEED_EVENTS } = require('./seed');
const { ScheduleBot, localDate, localMin, overlaps } = require('./scheduleBot');

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || db.data.secret;
// Set e.g. ALLOWED_EMAIL_DOMAIN=students.iitmandi.ac.in to restrict sign-ups to institute emails
const ALLOWED_EMAIL_DOMAIN = (process.env.ALLOWED_EMAIL_DOMAIN || '').toLowerCase();
const MAX_MSG_LEN = 2000;
const TENOR_API_KEY = process.env.TENOR_API_KEY || '';
// Comma-separated usernames that are always core-team admins (the first account ever created is an admin too)
const ADMIN_USERNAMES = (process.env.ADMIN_USERNAMES || '').toLowerCase().split(',').map((x) => x.trim()).filter(Boolean);
const UPLOAD_DIR = path.join(path.dirname(process.env.DB_FILE || path.join(__dirname, 'data', 'db.json')), 'uploads');
const fs = require('fs');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
const STICKER_IDS = new Set(['chai', 'maggi', 'mountain', 'deadline', 'mess', 'exam', 'gg', 'sleep', 'bus', 'rain', 'monkey', 'party', 'code', 'goal', 'lgtm', 'thanks']);
const STATUSES = ['online', 'away', 'dnd', 'invisible'];
const THEMES = ['veya', 'veyaday', 'morning', 'night', 'snow', 'buransh', 'deodar', 'sunset', 'apple', 'aurora'];
const HISTORY_PER_ROOM = 1000;

const D = db.data;
if (!D.events) { D.events = SEED_EVENTS(); db.save(); }
const bot = new ScheduleBot(db);

// ---------------------------------------------------------------------------
// Rooms
const ROOMS = new Map(); // "sntc/kamandprompt" -> { community, sub }
for (const c of COMMUNITIES) for (const s of c.subs) ROOMS.set(`${c.id}/${s.id}`, { community: c, sub: s });

const dmRoomId = (a, b) => 'dm:' + [a, b].sort().join(':');
const dmMembers = (room) => room.startsWith('dm:') ? room.slice(3).split(':') : null;

D.members ||= {}; // room -> [userId]  (club membership)
D.clubs ||= [];   // user-created clubs
D.stickers ||= []; // user-uploaded stickers
const CLUB_CATS = ['Tech', 'Cultural', 'Sports', 'Extra-curricular', 'Community'];
const customClub = (room) => room.startsWith('club/') && D.clubs.find((c) => 'club/' + c.id === room);
D.groups ||= []; // user-created groups (freshers, branch, batch, hostel, custom)
const groupOf = (room) => room.startsWith('group/') && D.groups.find((g) => 'group/' + g.id === room);
function roomMeta(room) {
  const r = ROOMS.get(room); if (r) return r;
  const g = groupOf(room);
  if (g) return { community: { id: 'group', name: g.type, short: g.type }, sub: { id: g.id, name: g.name, icon: g.icon, desc: g.desc } };
  const c = customClub(room);
  return c ? { community: { id: 'club', name: c.cat, short: c.cat }, sub: { id: c.id, name: c.name, icon: c.icon, desc: c.desc } } : null;
}
function canAccessRoom(user, room) {
  if (ROOMS.has(room) || customClub(room)) return true;
  if (room.startsWith('group/')) { const g = groupOf(room); return !!g && g.members.includes(user.id); }
  const m = dmMembers(room);
  return !!(m && m.length === 2 && m.includes(user.id) && D.users.some((u) => u.id === (m[0] === user.id ? m[1] : m[0])));
}

// ---------------------------------------------------------------------------
// Users & auth
const uid = () => crypto.randomBytes(8).toString('hex');
const findUser = (id) => D.users.find((u) => u.id === id);
const COLORS = ['#2f8f6b', '#3a86a8', '#c2603a', '#d19a2a', '#7a5bb5', '#b5486e', '#4f7a2a', '#2a6f9e'];

const publicUser = (u) => ({
  id: u.id, name: u.name, username: u.username, color: u.color, bio: u.bio || '', createdAt: u.createdAt,
  avatarVer: u.avatar ? u.avatarVer : null, statusText: u.statusText || '',
  lastSeen: u.status === 'invisible' ? null : (u.lastSeen || null),
  admin: isAdmin(u),
  branch: u.branch || '', batch: u.batch || '', from: u.from || '',
  interests: u.interests || [], passions: u.passions || [],
});
const isAdmin = (u) => !!u && (u.role === 'admin' || ADMIN_USERNAMES.includes(u.username));
const selfUser = (u) => ({ ...publicUser(u), email: u.email, blocked: u.blocked, mutedRooms: u.mutedRooms, mutedUsers: u.mutedUsers, status: u.status || 'online', theme: u.theme || null });

const PASSWORD_RULES = [
  { re: /^.{8,64}$/, msg: '8–64 characters' },
  { re: /[A-Z]/, msg: 'an uppercase letter' },
  { re: /[a-z]/, msg: 'a lowercase letter' },
  { re: /\d/, msg: 'a number' },
  { re: /[^A-Za-z0-9\s]/, msg: 'a special character (!@#$…)' },
  { re: /^\S*$/, msg: 'no spaces' },
];
const passwordProblems = (p) => PASSWORD_RULES.filter((r) => !r.re.test(p || '')).map((r) => r.msg);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const USERNAME_RE = /^[a-z0-9_.]{3,20}$/;

const sign = (u) => jwt.sign({ id: u.id }, JWT_SECRET, { expiresIn: '30d' });

// naive in-memory rate limit for auth endpoints
const attempts = new Map();
function rateLimited(key, limit = 10, windowMs = 15 * 60000) {
  const now = Date.now();
  const list = (attempts.get(key) || []).filter((t) => now - t < windowMs);
  list.push(now);
  attempts.set(key, list);
  return list.length > limit;
}

const app = express();
app.use(express.json({ limit: '3mb' }));
app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: '30d', immutable: true }));
app.use(express.static(path.join(__dirname, 'public')));

function auth(req, res, next) {
  const token = (req.headers.authorization || '').replace(/^Bearer /, '');
  try {
    const { id } = jwt.verify(token, JWT_SECRET);
    req.user = findUser(id);
    if (!req.user) throw new Error();
    next();
  } catch {
    res.status(401).json({ error: 'Please sign in again.' });
  }
}

app.get('/api/password-rules', (_req, res) => res.json({ rules: PASSWORD_RULES.map((r) => ({ pattern: r.re.source, msg: r.msg })), emailDomain: ALLOWED_EMAIL_DOMAIN }));

// health check for hosting platforms and the test suite
app.get('/api/health', (req, res) => res.json({ ok: true, users: D.users.length, uptime: Math.round(process.uptime()) }));

app.post('/api/signup', async (req, res) => {
  if (rateLimited('signup:' + req.ip, 20)) return res.status(429).json({ error: 'Too many attempts. Try again in a few minutes.' });
  let { name, username, email, password } = req.body || {};
  name = String(name || '').trim();
  username = String(username || '').trim().toLowerCase();
  email = String(email || '').trim().toLowerCase();
  const errors = {};
  if (name.length < 2 || name.length > 40) errors.name = 'Name should be 2–40 characters.';
  if (!USERNAME_RE.test(username)) errors.username = 'Username: 3–20 chars, letters, numbers, _ or . only.';
  else if (D.users.some((u) => u.username === username)) errors.username = 'That username is taken.';
  if (!EMAIL_RE.test(email)) errors.email = 'Enter a valid email.';
  else if (ALLOWED_EMAIL_DOMAIN && !email.endsWith('@' + ALLOWED_EMAIL_DOMAIN)) errors.email = `Use your @${ALLOWED_EMAIL_DOMAIN} email.`;
  else if (D.users.some((u) => u.email === email)) errors.email = 'An account with this email already exists.';
  const pp = passwordProblems(password);
  if (pp.length) errors.password = 'Password needs ' + pp.join(', ') + '.';
  if (Object.keys(errors).length) return res.status(400).json({ error: Object.values(errors)[0], errors });

  const user = {
    id: uid(), name, username, email,
    passHash: await bcrypt.hash(password, 10),
    color: COLORS[D.users.length % COLORS.length],
    createdAt: new Date().toISOString(),
    blocked: [], mutedRooms: [], mutedUsers: [],
    status: 'online', statusText: '', theme: null,
    role: D.users.length === 0 ? 'admin' : 'member', // first account = core team admin
  };
  D.users.push(user);
  db.save();
  io.emit('user:new', publicUser(user));
  res.json({ token: sign(user), me: selfUser(user) });
});

app.post('/api/signin', async (req, res) => {
  const login = String(req.body?.login || '').trim().toLowerCase();
  if (rateLimited('signin:' + req.ip + ':' + login)) return res.status(429).json({ error: 'Too many attempts. Try again in 15 minutes.' });
  const user = D.users.find((u) => u.username === login || u.email === login);
  const ok = user && (await bcrypt.compare(String(req.body?.password || ''), user.passHash));
  if (!ok) return res.status(401).json({ error: 'Wrong username/email or password.' });
  res.json({ token: sign(user), me: selfUser(user) });
});

app.get('/api/bootstrap', auth, (req, res) => {
  res.json({
    me: selfUser(req.user),
    communities: COMMUNITIES,
    users: D.users.map(publicUser),
    presence: Object.fromEntries(D.users.map((u) => [u.id, presenceOf(u)]).filter(([, st]) => st !== 'offline')),
    tenor: !!tenorKey(),
    clubs: clubList(req.user),
    groups: D.groups.map((g) => groupView(g, req.user)),
    stickers: D.stickers.map(stickerView),
    dms: dmListFor(req.user),
  });
});

app.patch('/api/me', auth, (req, res) => {
  const { name, bio, avatar, status, statusText, theme, branch, batch, from, interests, passions } = req.body || {};
  if (name !== undefined) {
    const n = String(name).trim();
    if (n.length < 2 || n.length > 40) return res.status(400).json({ error: 'Name should be 2–40 characters.' });
    req.user.name = n;
  }
  if (bio !== undefined) req.user.bio = String(bio).slice(0, 160);
  // profile details
  const clean = (v, n) => String(v || '').replace(/\s+/g, ' ').trim().slice(0, n);
  if (branch !== undefined) req.user.branch = clean(branch, 60);
  if (batch !== undefined) req.user.batch = clean(batch, 20);
  if (from !== undefined) req.user.from = clean(from, 60);
  if (interests !== undefined) {
    const valid = new Set(clubList(req.user).map((c) => c.room));
    req.user.interests = [...new Set((Array.isArray(interests) ? interests : []).map(String))].filter((r) => valid.has(r)).slice(0, 15);
  }
  if (passions !== undefined) {
    req.user.passions = [...new Set((Array.isArray(passions) ? passions : []).map((x) => clean(x, 30)).filter(Boolean))].slice(0, 12);
  }
  if (avatar !== undefined) {
    if (avatar === null) { delete req.user.avatar; }
    else {
      const m = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(avatar));
      if (!m || m[2].length > 300000) return res.status(400).json({ error: 'Profile photo must be a PNG/JPEG/WebP under ~200 KB.' });
      req.user.avatar = avatar;
    }
    req.user.avatarVer = Date.now();
  }
  if (statusText !== undefined) req.user.statusText = String(statusText).slice(0, 60);
  if (theme !== undefined && (theme === null || THEMES.includes(theme))) req.user.theme = theme;
  if (status !== undefined) {
    if (!STATUSES.includes(status)) return res.status(400).json({ error: 'Unknown status.' });
    req.user.status = status;
  }
  db.save();
  io.emit('user:update', publicUser(req.user));
  broadcastPresence(req.user);
  res.json({ me: selfUser(req.user) });
});

app.post('/api/change-password', auth, async (req, res) => {
  const { current, next } = req.body || {};
  if (!(await bcrypt.compare(String(current || ''), req.user.passHash))) return res.status(400).json({ error: 'Current password is wrong.' });
  const pp = passwordProblems(next);
  if (pp.length) return res.status(400).json({ error: 'New password needs ' + pp.join(', ') + '.' });
  req.user.passHash = await bcrypt.hash(next, 10);
  db.save();
  res.json({ ok: true });
});

function dmListFor(user) {
  const out = [];
  for (const [room, msgs] of Object.entries(D.messages)) {
    const m = dmMembers(room);
    if (!m || !m.includes(user.id) || !msgs.length) continue;
    const other = m[0] === user.id ? m[1] : m[0];
    out.push({ room, userId: other, lastTs: msgs[msgs.length - 1].ts });
  }
  return out.sort((a, b) => b.lastTs.localeCompare(a.lastTs));
}

// profile photos are served as images (keeps bootstrap payload small)
app.get('/api/avatar/:id', (req, res) => {
  const u = findUser(req.params.id);
  const m = u?.avatar && /^data:(image\/[a-z]+);base64,(.+)$/.exec(u.avatar);
  if (!m) return res.status(404).end();
  res.set('Content-Type', m[1]).set('Cache-Control', 'public, max-age=31536000, immutable').send(Buffer.from(m[2], 'base64'));
});

// image / GIF upload for chat (base64 JSON body, max ~2 MB)
const MAGIC = { gif: [0x47, 0x49, 0x46], png: [0x89, 0x50, 0x4e, 0x47], jpg: [0xff, 0xd8, 0xff], webp: [0x52, 0x49, 0x46, 0x46] };
app.post('/api/upload', auth, (req, res) => {
  if (rateLimited('upload:' + req.user.id, 30, 10 * 60000)) return res.status(429).json({ error: 'Too many uploads, try again in a bit.' });
  const m = /^data:image\/(gif|png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(req.body?.data || ''));
  if (!m) return res.status(400).json({ error: 'Only GIF, PNG, JPEG or WebP images.' });
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > 2 * 1024 * 1024) return res.status(400).json({ error: 'Images must be under 2 MB.' });
  const ext = m[1] === 'jpeg' ? 'jpg' : m[1];
  if (!MAGIC[ext].every((b, i) => buf[i] === b)) return res.status(400).json({ error: 'That file doesn’t look like a real image.' });
  const name = uid() + '.' + ext;
  fs.writeFileSync(path.join(UPLOAD_DIR, name), buf);
  res.json({ url: '/uploads/' + name });
});

// GIF + sticker search via Tenor. The key comes from the TENOR_API_KEY setting, or is saved by an admin in Settings.
D.settings ||= {};
const tenorKey = () => TENOR_API_KEY || D.settings.tenorKey || '';
async function tenorFetch(path, params) {
  const r = await fetch(`https://tenor.googleapis.com/v2/${path}?${params}`);
  const j = await r.json().catch(() => ({}));
  return { r, j };
}
app.get('/api/admin/tenor', auth, (req, res) => {
  if (!isAdmin(req.user)) return res.status(403).json({ error: 'Only core team members can do this.' });
  const k = tenorKey();
  res.json({ connected: !!k, fromEnv: !!TENOR_API_KEY, hint: k ? k.slice(0, 4) + '…' + k.slice(-4) : null });
});
app.post('/api/admin/tenor', auth, async (req, res) => {
  if (!isAdmin(req.user)) return res.status(403).json({ error: 'Only core team members can do this.' });
  if (TENOR_API_KEY) return res.status(400).json({ error: 'The key is set with TENOR_API_KEY when the server starts. Change it there.' });
  const key = String(req.body?.key || '').trim();
  if (!key) { delete D.settings.tenorKey; db.save(); io.emit('settings:changed', { tenor: false }); return res.json({ connected: false }); }
  if (!/^[\w-]{20,60}$/.test(key)) return res.status(400).json({ error: 'That doesn’t look like a Google API key. It usually starts with “AIza”.' });
  try {
    const { r, j } = await tenorFetch('featured', new URLSearchParams({ key, client_key: 'veya', limit: '1' }));
    if (!r.ok) return res.status(400).json({ error: 'Tenor rejected this key: ' + (j?.error?.message || r.status) + '. Make sure the Tenor API is enabled for it in Google Cloud.' });
  } catch {
    return res.status(502).json({ error: 'Couldn’t reach Tenor to check the key. Check your internet connection.' });
  }
  D.settings.tenorKey = key; db.save();
  io.emit('settings:changed', { tenor: true });
  res.json({ connected: true });
});

app.get('/api/tenor', auth, async (req, res) => {
  const TENOR = tenorKey();
  if (!TENOR) return res.status(501).json({ error: 'GIF search isn’t connected yet. A core team admin can connect Tenor in Settings.' });
  const q = String(req.query.q || '').slice(0, 50).trim();
  const stickers = req.query.type === 'stickers';
  const params = new URLSearchParams({ key: TENOR, client_key: 'veya', limit: '24', contentfilter: 'medium', locale: 'en_IN',
    media_filter: stickers ? 'gif_transparent,tinygif_transparent,gif,tinygif' : 'gif,tinygif' });
  if (q) params.set('q', q);
  if (stickers) params.set('searchfilter', 'sticker');
  try {
    const { r, j } = await tenorFetch(q ? 'search' : 'featured', params);
    if (!r.ok) return res.status(502).json({ error: j?.error?.message || 'Tenor refused the request. Check the Tenor key in Settings.' });
    res.json({ items: (j.results || []).map((it) => {
      const f = it.media_formats || {};
      const full = stickers ? (f.gif_transparent || f.gif) : f.gif;
      const prev = stickers ? (f.tinygif_transparent || f.tinygif || full) : (f.tinygif || full);
      return full && { id: it.id, title: it.content_description || '', url: full.url, preview: prev.url, w: full.dims?.[0], h: full.dims?.[1] };
    }).filter(Boolean) });
  } catch {
    res.status(502).json({ error: 'Couldn’t reach Tenor.' });
  }
});

// ---- Clubs: list, join/leave, create ------------------------------------------
function clubList(user) {
  const out = [];
  for (const c of COMMUNITIES) for (const s of c.subs) {
    if (s.id === 'general' || s.adminOnly) continue;
    const room = `${c.id}/${s.id}`;
    out.push({ room, name: s.name, icon: s.icon, desc: s.desc, cat: c.cat, community: c.short, group: s.group || null, members: (D.members[room] || []).length, joined: (D.members[room] || []).includes(user.id) });
  }
  for (const c of D.clubs) {
    const room = 'club/' + c.id;
    out.push({ room, name: c.name, icon: c.icon, desc: c.desc, cat: c.cat, community: c.cat, custom: true, by: c.by, members: (D.members[room] || []).length, joined: (D.members[room] || []).includes(user.id) });
  }
  return out;
}
const isClubRoom = (room) => !!customClub(room) || (ROOMS.has(room) && !room.endsWith('/general') && !ROOMS.get(room).sub.adminOnly);
app.post('/api/clubs/join', auth, (req, res) => {
  const room = String(req.body?.room || '');
  if (!isClubRoom(room)) return res.status(400).json({ error: 'Unknown club.' });
  const list = (D.members[room] ||= []);
  const join = req.body?.join !== false;
  if (join && !list.includes(req.user.id)) list.push(req.user.id);
  if (!join) D.members[room] = list.filter((x) => x !== req.user.id);
  db.save();
  io.emit('club:members', { room, members: D.members[room].length });
  res.json({ joined: join, members: D.members[room].length });
});
app.get('/api/clubs/members', auth, (req, res) => {
  const room = String(req.query.room || '');
  if (!isClubRoom(room)) return res.status(400).json({ error: 'Unknown club.' });
  res.json({ members: (D.members[room] || []).filter((id) => findUser(id)) });
});
app.post('/api/clubs', auth, (req, res) => {
  const { name, cat, icon, desc } = req.body || {};
  const n = String(name || '').trim();
  if (n.length < 3 || n.length > 50) return res.status(400).json({ error: 'Club name should be 3–50 characters.' });
  if (!CLUB_CATS.includes(cat)) return res.status(400).json({ error: 'Pick a category.' });
  if (clubList(req.user).some((c) => c.name.toLowerCase() === n.toLowerCase())) return res.status(400).json({ error: 'A club with that name already exists.' });
  if (D.clubs.filter((c) => c.by === req.user.id).length >= 5) return res.status(400).json({ error: 'You can create up to 5 clubs.' });
  const club = { id: uid(), name: n, cat, icon: [...String(icon || '✨')].slice(0, 2).join('') || '✨', desc: String(desc || '').trim().slice(0, 200) || 'A new club on campus', by: req.user.id, at: new Date().toISOString() };
  D.clubs.push(club);
  D.members['club/' + club.id] = [req.user.id];
  db.save();
  io.socketsJoin('club/' + club.id);
  io.emit('clubs:changed', { name: club.name, by: req.user.id });
  res.json({ room: 'club/' + club.id });
});
app.delete('/api/clubs/:id', auth, (req, res) => {
  const i = D.clubs.findIndex((c) => c.id === req.params.id);
  if (i < 0) return res.status(404).json({ error: 'Club not found.' });
  if (D.clubs[i].by !== req.user.id && !isAdmin(req.user)) return res.status(403).json({ error: 'Only the club’s creator or an admin can delete it.' });
  D.clubs.splice(i, 1);
  db.save();
  io.emit('clubs:changed', {});
  res.json({ ok: true });
});


// ---- Groups: freshers, branch, batch, hostel or any custom group ------------------
const GROUP_TYPES = ['Freshers', 'Branch', 'Batch', 'Hostel', 'Course', 'Project', 'Other'];
function groupView(g, user) {
  const role = g.admins.includes(user.id) ? 'admin' : g.members.includes(user.id) ? 'member' : g.requests.includes(user.id) ? 'requested' : 'none';
  return { id: g.id, room: 'group/' + g.id, name: g.name, icon: g.icon, desc: g.desc, type: g.type, privacy: g.privacy, members: g.members.length,
    role, byName: findUser(g.by)?.name || '', requests: role === 'admin' ? g.requests.length : undefined };
}
const findGroup = (id) => D.groups.find((g) => g.id === id);
const isGroupAdmin = (g, u) => g.admins.includes(u.id) || isAdmin(u);
function syncGroupSockets(g, userId, join) {
  const room = 'group/' + g.id;
  if (join) io.in('user:' + userId).socketsJoin(room); else io.in('user:' + userId).socketsLeave(room);
}
const groupsChanged = (ids) => { if (ids) ids.forEach((id) => io.to('user:' + id).emit('groups:changed', {})); else io.emit('groups:changed', {}); };

app.get('/api/groups', auth, (req, res) => {
  res.json({ groups: D.groups.filter((g) => g.privacy === 'public' || g.privacy === 'private' || g.members.includes(req.user.id)).map((g) => groupView(g, req.user)) });
});
app.post('/api/groups', auth, (req, res) => {
  const { name, icon, desc, type, privacy, invite } = req.body || {};
  const n = String(name || '').replace(/\s+/g, ' ').trim();
  if (n.length < 3 || n.length > 50) return res.status(400).json({ error: 'Group name should be 3–50 characters.' });
  if (!GROUP_TYPES.includes(type)) return res.status(400).json({ error: 'Pick a group type.' });
  if (!['public', 'private'].includes(privacy)) return res.status(400).json({ error: 'Pick public or private.' });
  if (D.groups.some((g) => g.name.toLowerCase() === n.toLowerCase())) return res.status(400).json({ error: 'A group with that name already exists. Join it instead!' });
  if (D.groups.filter((g) => g.by === req.user.id).length >= 10) return res.status(400).json({ error: 'You can create up to 10 groups.' });
  const invited = [...new Set((Array.isArray(invite) ? invite : []).map(String))].filter((id) => id !== req.user.id && findUser(id)).slice(0, 200);
  const g = { id: uid(), name: n, icon: [...String(icon || '👥')].slice(0, 2).join('') || '👥', desc: String(desc || '').trim().slice(0, 200), type, privacy,
    by: req.user.id, admins: [req.user.id], members: [req.user.id, ...invited], requests: [], at: new Date().toISOString() };
  D.groups.push(g); db.save();
  for (const id of g.members) syncGroupSockets(g, id, true);
  groupsChanged();
  res.json({ group: groupView(g, req.user) });
});
app.patch('/api/groups/:id', auth, (req, res) => {
  const g = findGroup(req.params.id); if (!g) return res.status(404).json({ error: 'Group not found.' });
  if (!isGroupAdmin(g, req.user)) return res.status(403).json({ error: 'Only group admins can edit the group.' });
  const { name, desc, icon, privacy } = req.body || {};
  if (name !== undefined) { const n = String(name).trim(); if (n.length < 3 || n.length > 50) return res.status(400).json({ error: 'Group name should be 3–50 characters.' }); g.name = n; }
  if (desc !== undefined) g.desc = String(desc).slice(0, 200);
  if (icon !== undefined) g.icon = [...String(icon)].slice(0, 2).join('') || g.icon;
  if (privacy !== undefined && ['public', 'private'].includes(privacy)) g.privacy = privacy;
  db.save(); groupsChanged();
  res.json({ group: groupView(g, req.user) });
});
app.delete('/api/groups/:id', auth, (req, res) => {
  const i = D.groups.findIndex((g) => g.id === req.params.id); if (i < 0) return res.status(404).json({ error: 'Group not found.' });
  const g = D.groups[i];
  if (g.by !== req.user.id && !isAdmin(req.user)) return res.status(403).json({ error: 'Only the group’s creator or the core team can delete it.' });
  D.groups.splice(i, 1); delete D.messages['group/' + g.id]; db.save();
  for (const id of g.members) syncGroupSockets(g, id, false);
  groupsChanged();
  res.json({ ok: true });
});
app.post('/api/groups/:id/join', auth, (req, res) => {
  const g = findGroup(req.params.id); if (!g) return res.status(404).json({ error: 'Group not found.' });
  if (g.members.includes(req.user.id)) return res.json({ group: groupView(g, req.user) });
  if (g.privacy === 'public') { g.members.push(req.user.id); syncGroupSockets(g, req.user.id, true); }
  else if (!g.requests.includes(req.user.id)) {
    g.requests.push(req.user.id);
    g.admins.forEach((id) => io.to('user:' + id).emit('groups:request', { group: g.name, name: req.user.name }));
  }
  db.save(); groupsChanged();
  res.json({ group: groupView(g, req.user) });
});
app.post('/api/groups/:id/leave', auth, (req, res) => {
  const g = findGroup(req.params.id); if (!g) return res.status(404).json({ error: 'Group not found.' });
  g.requests = g.requests.filter((x) => x !== req.user.id);
  if (g.members.includes(req.user.id)) {
    if (g.admins.length === 1 && g.admins[0] === req.user.id && g.members.length > 1) {
      const next = g.members.find((x) => x !== req.user.id); g.admins.push(next); // hand over admin before leaving
    }
    g.members = g.members.filter((x) => x !== req.user.id);
    g.admins = g.admins.filter((x) => x !== req.user.id);
    syncGroupSockets(g, req.user.id, false);
    if (!g.members.length) { D.groups.splice(D.groups.indexOf(g), 1); delete D.messages['group/' + g.id]; } // last one out removes the group
  }
  db.save(); groupsChanged();
  res.json({ ok: true });
});
app.get('/api/groups/:id/members', auth, (req, res) => {
  const g = findGroup(req.params.id); if (!g) return res.status(404).json({ error: 'Group not found.' });
  if (!g.members.includes(req.user.id) && g.privacy === 'private' && !isAdmin(req.user)) return res.status(403).json({ error: 'Only members can see who’s in a private group.' });
  res.json({ members: g.members.map((id) => ({ id, admin: g.admins.includes(id) })), requests: isGroupAdmin(g, req.user) ? g.requests : [] });
});
app.post('/api/groups/:id/members', auth, (req, res) => {
  const g = findGroup(req.params.id); if (!g) return res.status(404).json({ error: 'Group not found.' });
  if (!isGroupAdmin(g, req.user)) return res.status(403).json({ error: 'Only group admins can add people.' });
  const ids = [...new Set((req.body?.userIds || []).map(String))].filter((id) => findUser(id) && !g.members.includes(id)).slice(0, 200);
  for (const id of ids) { g.members.push(id); g.requests = g.requests.filter((x) => x !== id); syncGroupSockets(g, id, true); }
  db.save(); groupsChanged();
  res.json({ added: ids.length });
});
app.post('/api/groups/:id/requests/:uid', auth, (req, res) => {
  const g = findGroup(req.params.id); if (!g) return res.status(404).json({ error: 'Group not found.' });
  if (!isGroupAdmin(g, req.user)) return res.status(403).json({ error: 'Only group admins can do this.' });
  const uidd = req.params.uid;
  g.requests = g.requests.filter((x) => x !== uidd);
  if (req.body?.approve && findUser(uidd) && !g.members.includes(uidd)) { g.members.push(uidd); syncGroupSockets(g, uidd, true); io.to('user:' + uidd).emit('groups:approved', { group: g.name }); }
  db.save(); groupsChanged();
  res.json({ ok: true });
});
app.delete('/api/groups/:id/members/:uid', auth, (req, res) => {
  const g = findGroup(req.params.id); if (!g) return res.status(404).json({ error: 'Group not found.' });
  if (!isGroupAdmin(g, req.user)) return res.status(403).json({ error: 'Only group admins can remove people.' });
  const uidd = req.params.uid;
  if (uidd === g.by && !isAdmin(req.user)) return res.status(400).json({ error: 'The group’s creator can’t be removed.' });
  g.members = g.members.filter((x) => x !== uidd); g.admins = g.admins.filter((x) => x !== uidd);
  syncGroupSockets(g, uidd, false);
  db.save(); groupsChanged();
  res.json({ ok: true });
});
app.post('/api/groups/:id/admins/:uid', auth, (req, res) => {
  const g = findGroup(req.params.id); if (!g) return res.status(404).json({ error: 'Group not found.' });
  if (!isGroupAdmin(g, req.user)) return res.status(403).json({ error: 'Only group admins can do this.' });
  const uidd = req.params.uid;
  if (!g.members.includes(uidd)) return res.status(400).json({ error: 'They need to be a member first.' });
  if (g.admins.includes(uidd)) { if (g.admins.length === 1) return res.status(400).json({ error: 'A group needs at least one admin.' }); g.admins = g.admins.filter((x) => x !== uidd); }
  else g.admins.push(uidd);
  db.save(); groupsChanged();
  res.json({ ok: true });
});

// ---- Hostel ↔ block links (e.g. "Ganga Hostel is in B-20"), shared by everyone ------
app.put('/api/places/:id/block', auth, (req, res) => {
  const id = String(req.params.id), block = String(req.body?.block || '');
  if (!/^[a-z0-9-]{2,80}$/.test(id)) return res.status(400).json({ error: 'Bad place id.' });
  if (block && !/^north-b-\d{1,2}-hostel-block$/.test(block)) return res.status(400).json({ error: 'Pick a B-block.' });
  if (!block) delete D.places.loc[id];
  else D.places.loc[id] = { block, by: req.user.id, at: new Date().toISOString() };
  db.save();
  io.emit('places:changed', { id, by: req.user.username });
  res.json({ ok: true });
});

// ---- Core team (admins) ---------------------------------------------------------
app.post('/api/admin/role', auth, (req, res) => {
  if (!isAdmin(req.user)) return res.status(403).json({ error: 'Only core team members can do this.' });
  const u = findUser(String(req.body?.userId || ''));
  if (!u) return res.status(404).json({ error: 'User not found.' });
  const make = !!req.body?.admin;
  if (!make && D.users.filter(isAdmin).length <= 1 && isAdmin(u)) return res.status(400).json({ error: 'There must be at least one admin.' });
  if (!make && ADMIN_USERNAMES.includes(u.username)) return res.status(400).json({ error: 'This admin is set in ADMIN_USERNAMES on the server.' });
  u.role = make ? 'admin' : 'member';
  db.save();
  io.emit('user:update', publicUser(u));
  res.json({ ok: true });
});

// ---- User stickers ----------------------------------------------------------------
const stickerView = (s) => ({ id: s.id, name: s.name, url: s.url, by: s.by, byName: findUser(s.by)?.username || null });
app.post('/api/stickers', auth, (req, res) => {
  if (rateLimited('sticker:' + req.user.id, 20, 10 * 60000)) return res.status(429).json({ error: 'Too many uploads, try again in a bit.' });
  const m = /^data:image\/(gif|png|webp|jpeg);base64,([A-Za-z0-9+/=]+)$/.exec(String(req.body?.data || ''));
  if (!m) return res.status(400).json({ error: 'Stickers must be PNG, WebP, GIF or JPEG.' });
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > 1024 * 1024) return res.status(400).json({ error: 'Stickers must be under 1 MB.' });
  const ext = m[1] === 'jpeg' ? 'jpg' : m[1];
  if (!MAGIC[ext].every((x, i) => buf[i] === x)) return res.status(400).json({ error: 'That file doesn’t look like a real image.' });
  if (D.stickers.filter((x) => x.by === req.user.id).length >= 50) return res.status(400).json({ error: 'You’ve uploaded the maximum of 50 stickers.' });
  const name = uid() + '.' + ext;
  fs.writeFileSync(path.join(UPLOAD_DIR, name), buf);
  const st = { id: 'c-' + uid(), name: String(req.body?.name || 'Sticker').trim().slice(0, 30) || 'Sticker', url: '/uploads/' + name, by: req.user.id, at: new Date().toISOString() };
  D.stickers.push(st);
  db.save();
  io.emit('stickers:changed', {});
  res.json({ sticker: stickerView(st) });
});
app.get('/api/stickers', auth, (req, res) => res.json({ stickers: D.stickers.map(stickerView) }));
app.delete('/api/stickers/:id', auth, (req, res) => {
  const i = D.stickers.findIndex((x) => x.id === req.params.id);
  if (i < 0) return res.status(404).json({ error: 'Sticker not found.' });
  if (D.stickers[i].by !== req.user.id && !isAdmin(req.user)) return res.status(403).json({ error: 'Only the uploader or an admin can delete it.' });
  D.stickers.splice(i, 1);
  db.save();
  io.emit('stickers:changed', {});
  res.json({ ok: true });
});

// ---- Campus map: shared pins + community-added places ------------------------
D.places ||= { loc: {}, custom: [] };
const PLACE_CATS = ['hostel', 'mess', 'canteen', 'academic', 'facility', 'sports', 'landmark'];
const PLACE_CAMPUS = ['North', 'South', 'Around'];
// generous box around the Kamand valley so pins can't be dropped on the other side of the world
const inKamand = (lat, lng) => Number.isFinite(lat) && Number.isFinite(lng) && lat > 31.70 && lat < 31.86 && lng > 76.90 && lng < 77.10;

app.get('/api/places', auth, (req, res) => {
  const named = (id) => findUser(id)?.username || null;
  const loc = Object.fromEntries(Object.entries(D.places.loc).map(([k, v]) => [k, { ...v, byName: named(v.by) }]));
  res.json({ loc, custom: D.places.custom.map((c) => ({ ...c, byName: named(c.by) })) });
});

app.put('/api/places/:id/location', auth, (req, res) => {
  const id = String(req.params.id);
  if (!/^[a-z0-9-]{2,80}$/.test(id)) return res.status(400).json({ error: 'Bad place id.' });
  if (rateLimited('pin:' + req.user.id, 40, 10 * 60000)) return res.status(429).json({ error: 'Too many pins, try again in a bit.' });
  const lat = +req.body?.lat, lng = +req.body?.lng;
  if (!inKamand(lat, lng)) return res.status(400).json({ error: 'That spot is outside the Kamand valley.' });
  const custom = D.places.custom.find((c) => c.id === id);
  if (custom) { custom.lat = lat; custom.lng = lng; }
  else D.places.loc[id] = { lat: +lat.toFixed(6), lng: +lng.toFixed(6), by: req.user.id, at: new Date().toISOString() };
  db.save();
  io.emit('places:changed', { id, by: req.user.username });
  res.json({ ok: true });
});

app.delete('/api/places/:id/location', auth, (req, res) => {
  delete D.places.loc[String(req.params.id)];
  db.save();
  io.emit('places:changed', { id: req.params.id });
  res.json({ ok: true });
});

app.post('/api/places', auth, (req, res) => {
  const { name, cat, campus, desc } = req.body || {};
  const lat = +req.body?.lat, lng = +req.body?.lng;
  const n = String(name || '').trim();
  if (n.length < 2 || n.length > 60) return res.status(400).json({ error: 'Give the place a name (2–60 characters).' });
  if (!PLACE_CATS.includes(cat)) return res.status(400).json({ error: 'Pick a category.' });
  if (!PLACE_CAMPUS.includes(campus)) return res.status(400).json({ error: 'Pick North, South or Around campus.' });
  if (!inKamand(lat, lng)) return res.status(400).json({ error: 'That spot is outside the Kamand valley.' });
  if (D.places.custom.filter((c) => c.by === req.user.id).length >= 30) return res.status(400).json({ error: 'You’ve added the maximum of 30 places.' });
  const place = { id: 'u-' + uid(), name: n, cat, campus, desc: String(desc || '').slice(0, 200), lat: +lat.toFixed(6), lng: +lng.toFixed(6), by: req.user.id, at: new Date().toISOString() };
  D.places.custom.push(place);
  db.save();
  io.emit('places:changed', { id: place.id, by: req.user.username, added: place.name });
  res.json({ place });
});

app.delete('/api/places/:id', auth, (req, res) => {
  const i = D.places.custom.findIndex((c) => c.id === req.params.id);
  if (i < 0) return res.status(404).json({ error: 'Place not found.' });
  if (D.places.custom[i].by !== req.user.id) return res.status(403).json({ error: 'Only the person who added it can delete it.' });
  D.places.custom.splice(i, 1);
  db.save();
  io.emit('places:changed', { id: req.params.id });
  res.json({ ok: true });
});

// message history (blocked users filtered server-side)
app.get('/api/messages', auth, (req, res) => {
  const room = String(req.query.room || '');
  if (!canAccessRoom(req.user, room)) return res.status(403).json({ error: 'No access to this room.' });
  const before = req.query.before ? String(req.query.before) : null;
  let list = (D.messages[room] || []).filter((m) => !req.user.blocked.includes(m.from));
  if (before) list = list.filter((m) => m.ts < before);
  res.json({ messages: list.slice(-100), pinned: (D.messages[room] || []).filter((m) => m.pinned && !m.deleted) });
});

// ---- block / mute -----------------------------------------------------------
const toggle = (arr, v) => { const i = arr.indexOf(v); if (i >= 0) arr.splice(i, 1); else arr.push(v); return i < 0; };

app.post('/api/block/:id', auth, (req, res) => {
  const target = findUser(req.params.id);
  if (!target || target.id === req.user.id) return res.status(400).json({ error: 'Invalid user.' });
  const blocked = toggle(req.user.blocked, target.id);
  db.save();
  res.json({ blocked, me: selfUser(req.user) });
});

app.post('/api/mute/user/:id', auth, (req, res) => {
  const target = findUser(req.params.id);
  if (!target || target.id === req.user.id) return res.status(400).json({ error: 'Invalid user.' });
  const muted = toggle(req.user.mutedUsers, target.id);
  db.save();
  res.json({ muted, me: selfUser(req.user) });
});

app.post('/api/mute/room', auth, (req, res) => {
  const room = String(req.body?.room || '');
  if (!canAccessRoom(req.user, room)) return res.status(400).json({ error: 'Invalid room.' });
  const muted = toggle(req.user.mutedRooms, room);
  db.save();
  res.json({ muted, me: selfUser(req.user) });
});

// ---- News / events ------------------------------------------------------------
function eventClashes(user, ev, tz) {
  const date = localDate(ev.start, tz);
  const range = { start: localMin(ev.start, tz), end: localDate(ev.end, tz) === date ? localMin(ev.end, tz) : 1440 };
  return bot.agenda(user.id, date, tz, { skipEventId: ev.id }).filter((a) => overlaps(range, a)).map((a) => ({ title: a.title, start: a.start, end: a.end }));
}

const eventView = (ev, user, tz) => ({
  ...ev,
  rsvpCount: ev.rsvps.length,
  going: ev.rsvps.includes(user.id),
  rsvps: undefined,
  creatorName: ev.createdBy === 'system' ? 'VEYA' : (findUser(ev.createdBy)?.name || 'Unknown'),
  clashes: eventClashes(user, ev, tz),
  attCode: undefined, attendees: undefined,
  attendanceCount: (ev.attendees || []).length,
  attended: (ev.attendees || []).some((a) => a.id === user.id),
  canManage: ev.createdBy === user.id || isAdmin(user),
  checkinOpen: checkinOpen(ev),
});

// ---- QR attendance -----------------------------------------------------------------
// Check-in is open from 1 hour before the start until 1 hour after the end.
const CHECKIN_EARLY = 60 * 60000, CHECKIN_LATE = 60 * 60000;
function checkinOpen(ev) {
  const now = Date.now();
  return now >= new Date(ev.start).getTime() - CHECKIN_EARLY && now <= new Date(ev.end).getTime() + CHECKIN_LATE;
}
const newAttCode = () => Array.from(crypto.randomBytes(6), (b) => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[b % 32]).join('');
const canManageEvent = (ev, u) => ev.createdBy === u.id || isAdmin(u);
function attendanceView(ev) {
  ev.attCode ||= newAttCode();
  ev.attendees ||= [];
  return {
    code: ev.attCode, open: checkinOpen(ev), opensAt: new Date(new Date(ev.start).getTime() - CHECKIN_EARLY).toISOString(), closesAt: new Date(new Date(ev.end).getTime() + CHECKIN_LATE).toISOString(),
    attendees: ev.attendees.map((a) => { const u = findUser(a.id); return { id: a.id, name: u?.name || 'Unknown', username: u?.username || '', email: u?.email || '', at: a.at }; }),
  };
}
app.get('/api/events/:id/attendance', auth, (req, res) => {
  const ev = D.events.find((e) => e.id === req.params.id);
  if (!ev) return res.status(404).json({ error: 'Event not found.' });
  if (!canManageEvent(ev, req.user)) return res.status(403).json({ error: 'Only the organiser or the core team can see attendance.' });
  const view = attendanceView(ev); db.save();
  res.json(view);
});
app.post('/api/events/:id/attendance/rotate', auth, (req, res) => {
  const ev = D.events.find((e) => e.id === req.params.id);
  if (!ev) return res.status(404).json({ error: 'Event not found.' });
  if (!canManageEvent(ev, req.user)) return res.status(403).json({ error: 'Only the organiser or the core team can do this.' });
  ev.attCode = newAttCode(); db.save();
  res.json(attendanceView(ev));
});
app.post('/api/events/:id/checkin', auth, (req, res) => {
  if (rateLimited('checkin:' + req.user.id, 20, 10 * 60000)) return res.status(429).json({ error: 'Too many tries. Wait a few minutes.' });
  const ev = D.events.find((e) => e.id === req.params.id);
  if (!ev) return res.status(404).json({ error: 'That event no longer exists.' });
  const code = String(req.body?.code || '').trim().toUpperCase();
  if (!ev.attCode || code !== ev.attCode) return res.status(400).json({ error: 'That attendance code isn’t right. Scan the QR again or ask the organiser.' });
  if (!checkinOpen(ev)) return res.status(400).json({ error: 'Check-in for this event isn’t open right now (it opens 1 hour before and closes 1 hour after).' });
  ev.attendees ||= [];
  const already = ev.attendees.some((a) => a.id === req.user.id);
  if (!already) {
    ev.attendees.push({ id: req.user.id, at: new Date().toISOString() });
    if (!ev.rsvps.includes(req.user.id)) ev.rsvps.push(req.user.id);
    db.save();
    io.emit('events:attendance', { id: ev.id, count: ev.attendees.length, name: req.user.name });
  }
  res.json({ ok: true, already, title: ev.title });
});

const tzOf = (req) => { const t = parseInt(req.query.tz ?? req.body?.tz, 10); return Number.isFinite(t) && Math.abs(t) < 900 ? t : -330; };

app.get('/api/events', auth, (req, res) => {
  const tz = tzOf(req);
  const cutoff = Date.now() - 6 * 3600 * 1000; // keep events that ended < 6h ago
  const list = D.events.filter((e) => new Date(e.end).getTime() > cutoff).sort((a, b) => a.start.localeCompare(b.start));
  res.json({ events: list.map((e) => eventView(e, req.user, tz)) });
});

app.post('/api/events', auth, (req, res) => {
  const { title, desc, start, end, venue, communityId } = req.body || {};
  const s = new Date(start), e = new Date(end);
  if (!title || String(title).trim().length < 3) return res.status(400).json({ error: 'Give the event a title (3+ characters).' });
  if (isNaN(s) || isNaN(e) || e <= s) return res.status(400).json({ error: 'End time must be after the start time.' });
  if (e.getTime() < Date.now()) return res.status(400).json({ error: 'That event is already over.' });
  if (!COMMUNITIES.some((c) => c.id === communityId)) return res.status(400).json({ error: 'Pick a community.' });
  const ev = {
    id: uid(), title: String(title).trim().slice(0, 100), desc: String(desc || '').slice(0, 1000),
    start: s.toISOString(), end: e.toISOString(), venue: String(venue || '').slice(0, 100),
    communityId, createdBy: req.user.id, createdAt: new Date().toISOString(), rsvps: [req.user.id],
  };
  // venue clash: another event in the same venue at the same time
  const v = ev.venue.trim().toLowerCase();
  const venueClashes = v && v !== 'online'
    ? D.events.filter((o) => o.venue.trim().toLowerCase() === v && new Date(o.start) < e && s < new Date(o.end)).map((o) => o.title)
    : [];
  D.events.push(ev);
  db.save();
  io.emit('events:changed', { reason: 'new', title: ev.title, communityId, by: req.user.id });
  res.json({ event: eventView(ev, req.user, tzOf(req)), venueClashes });
});

app.delete('/api/events/:id', auth, (req, res) => {
  const i = D.events.findIndex((e) => e.id === req.params.id);
  if (i < 0) return res.status(404).json({ error: 'Event not found.' });
  const ev = D.events[i];
  if (ev.createdBy !== req.user.id && !(ev.sample)) return res.status(403).json({ error: 'Only the organiser can delete this event.' });
  D.events.splice(i, 1);
  db.save();
  io.emit('events:changed', { reason: 'deleted' });
  res.json({ ok: true });
});

app.post('/api/events/:id/rsvp', auth, (req, res) => {
  const ev = D.events.find((e) => e.id === req.params.id);
  if (!ev) return res.status(404).json({ error: 'Event not found.' });
  const going = toggle(ev.rsvps, req.user.id);
  db.save();
  const tz = tzOf(req);
  io.emit('events:rsvp', { id: ev.id, rsvpCount: ev.rsvps.length });
  res.json({ going, clashes: going ? eventClashes(req.user, ev, tz) : [], event: eventView(ev, req.user, tz) });
});

// ---- Schedule bot ---------------------------------------------------------------
app.get('/api/schedule', auth, (req, res) => {
  const tz = tzOf(req);
  res.json({ items: bot.items(req.user.id), events: bot.rsvpEvents(req.user.id, tz) });
});

app.post('/api/schedule', auth, (req, res) => {
  const { title, kind, day, date, start, end, force } = req.body || {};
  const toMin = (t) => { const m = /^(\d{2}):(\d{2})$/.exec(t || ''); return m ? +m[1] * 60 + +m[2] : null; };
  const range = { start: toMin(start), end: toMin(end) };
  if (!title || range.start == null || range.end == null || range.end <= range.start) return res.status(400).json({ error: 'Need a title and a valid start/end time.' });
  const when = kind === 'weekly' ? { kind, day: Math.max(0, Math.min(6, +day)) } : { kind: 'once', date: String(date || '') };
  if (when.kind === 'once' && !/^\d{4}-\d{2}-\d{2}$/.test(when.date)) return res.status(400).json({ error: 'Pick a date.' });
  const r = bot.add(req.user.id, { title: String(title).trim(), when, range }, tzOf(req), !!force);
  res.status(r.ok ? 200 : 409).json(r);
});

app.delete('/api/schedule/:id', auth, (req, res) => {
  const items = bot.items(req.user.id);
  const i = items.findIndex((x) => x.id === req.params.id);
  if (i >= 0) { items.splice(i, 1); db.save(); }
  res.json({ ok: true });
});

app.post('/api/bot', auth, (req, res) => {
  res.json(bot.handle(req.user.id, String(req.body?.text || '').slice(0, 300), tzOf(req)));
});

// ---------------------------------------------------------------------------
// Real-time (Socket.IO)
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 1e5 });
const online = new Map(); // userId -> Set(socket)
const lastPresence = new Map();
function presenceOf(u) {
  const socks = online.get(u.id);
  if (!socks || !socks.size || u.status === 'invisible') return 'offline';
  if (u.status === 'dnd') return 'dnd';
  if (u.status === 'away' || [...socks].every((s) => s.data.idle)) return 'away';
  return 'online';
}
function broadcastPresence(u) {
  const st = presenceOf(u);
  if (lastPresence.get(u.id) === st) return;
  lastPresence.set(u.id, st);
  io.emit('presence', { userId: u.id, state: st, lastSeen: publicUser(u).lastSeen });
}

io.use((socket, next) => {
  try {
    const { id } = jwt.verify(socket.handshake.auth?.token, JWT_SECRET);
    const u = findUser(id);
    if (!u) throw new Error();
    socket.user = u;
    next();
  } catch {
    next(new Error('unauthorized'));
  }
});

function emitToRoom(room, event, payload) {
  const m = dmMembers(room);
  if (m) io.to('user:' + m[0]).to('user:' + m[1]).emit(event, payload);
  else io.to(room).emit(event, payload);
}

io.on('connection', (socket) => {
  const me = socket.user;
  socket.join('user:' + me.id);
  for (const room of ROOMS.keys()) socket.join(room);
  for (const c of D.clubs) socket.join('club/' + c.id);
  for (const g of D.groups) if (g.members.includes(me.id)) socket.join('group/' + g.id);
  socket.data.idle = false;
  if (!online.has(me.id)) online.set(me.id, new Set());
  online.get(me.id).add(socket);
  broadcastPresence(me);
  socket.on('idle', (idle) => { socket.data.idle = !!idle; broadcastPresence(me); });

  // simple flood protection: max 8 messages / 5s per socket
  let sent = [];

  socket.on('message:send', ({ room, text, kind = 'text', media } = {}, ack = () => {}) => {
    room = String(room || ''); text = String(text || '').trim();
    if (!canAccessRoom(me, room)) return ack({ error: 'No access to this room.' });
    if (roomMeta(room)?.sub.adminOnly && !isAdmin(me)) return ack({ error: 'Only the core team can post announcements.' });
    let mediaOut;
    const okLocal = (url) => /^\/uploads\/[a-f0-9]{16}\.(gif|png|jpg|webp)$/.test(url);
    const okTenor = (url) => /^https:\/\/media\d*\.tenor\.com\/[\w\/.\-]+$/.test(url);
    if (kind === 'sticker') {
      const custom = D.stickers.find((x) => x.id === media?.id);
      if (STICKER_IDS.has(media?.id)) mediaOut = { id: media.id };
      else if (custom) mediaOut = { id: custom.id, url: custom.url };
      else if (okTenor(String(media?.url || ''))) mediaOut = { url: String(media.url) };
      else return ack({ error: 'Unknown sticker.' });
      text = '';
    } else if (kind === 'image' || kind === 'gif') {
      const url = String(media?.url || '');
      if (!okLocal(url) && !okTenor(url)) return ack({ error: 'Invalid image.' });
      mediaOut = { url, w: Math.min(+media.w || 0, 2000) || undefined, h: Math.min(+media.h || 0, 2000) || undefined };
    } else {
      kind = 'text';
      if (!text) return ack({ error: 'Empty message.' });
    }
    if (text.length > MAX_MSG_LEN) return ack({ error: `Messages are limited to ${MAX_MSG_LEN} characters.` });
    const now = Date.now();
    sent = sent.filter((t) => now - t < 5000);
    if (sent.length >= 8) return ack({ error: 'Slow down a little 🙂' });
    sent.push(now);

    const m = dmMembers(room);
    if (m) {
      const other = findUser(m[0] === me.id ? m[1] : m[0]);
      if (me.blocked.includes(other.id)) return ack({ error: `You blocked ${other.name}. Unblock to message them.` });
      if (other.blocked.includes(me.id)) return ack({ error: 'You can’t message this person.' });
    }
    const msg = { id: uid(), room, from: me.id, text, kind, ...(mediaOut ? { media: mediaOut } : {}), ts: new Date().toISOString(), pinned: false, reactions: {} };
    (D.messages[room] ||= []).push(msg);
    if (D.messages[room].length > HISTORY_PER_ROOM) D.messages[room].splice(0, D.messages[room].length - HISTORY_PER_ROOM);
    db.save();
    emitToRoom(room, 'message:new', msg);
    ack({ ok: true, message: msg });
  });

  socket.on('typing', ({ room } = {}) => {
    room = String(room || '');
    if (!canAccessRoom(me, room)) return;
    const payload = { room, userId: me.id };
    const m = dmMembers(room);
    if (m) socket.to('user:' + (m[0] === me.id ? m[1] : m[0])).emit('typing', payload);
    else socket.to(room).emit('typing', payload);
  });

  socket.on('message:pin', ({ room, id } = {}, ack = () => {}) => {
    if (!canAccessRoom(me, room)) return ack({ error: 'No access.' });
    const msg = (D.messages[room] || []).find((x) => x.id === id);
    if (!msg || msg.deleted) return ack({ error: 'Message not found.' });
    msg.pinned = !msg.pinned;
    msg.pinnedBy = msg.pinned ? me.id : undefined;
    db.save();
    emitToRoom(room, 'message:update', msg);
    ack({ ok: true, pinned: msg.pinned });
  });

  socket.on('message:react', ({ room, id, emoji } = {}, ack = () => {}) => {
    if (!canAccessRoom(me, room)) return ack({ error: 'No access.' });
    emoji = String(emoji || '');
    if (!emoji || emoji.length > 16 || /[\w\s<>]/.test(emoji)) return ack({ error: 'Invalid reaction.' });
    const msg = (D.messages[room] || []).find((x) => x.id === id);
    if (!msg || msg.deleted) return ack({ error: 'Message not found.' });
    msg.reactions ||= {};
    const list = (msg.reactions[emoji] ||= []);
    if (!list.includes(me.id) && Object.keys(msg.reactions).length >= 20) return ack({ error: 'Too many reactions.' });
    toggle(list, me.id);
    if (!list.length) delete msg.reactions[emoji];
    db.save();
    emitToRoom(room, 'message:update', msg);
    ack({ ok: true });
  });

  socket.on('message:delete', ({ room, id } = {}, ack = () => {}) => {
    if (!canAccessRoom(me, room)) return ack({ error: 'No access.' });
    const msg = (D.messages[room] || []).find((x) => x.id === id);
    if (!msg) return ack({ error: 'Message not found.' });
    if (msg.from !== me.id) return ack({ error: 'You can only delete your own messages.' });
    msg.deleted = true; msg.text = ''; msg.pinned = false; delete msg.media; msg.reactions = {};
    db.save();
    emitToRoom(room, 'message:update', msg);
    ack({ ok: true });
  });

  socket.on('disconnect', () => {
    const socks = online.get(me.id);
    socks?.delete(socket);
    if (!socks?.size) {
      online.delete(me.id);
      if (me.status !== 'invisible') { me.lastSeen = new Date().toISOString(); db.save(); }
    }
    broadcastPresence(me);
  });
});

server.listen(PORT, () => console.log(`💜 VEYA running on http://localhost:${PORT}`));
