// End-to-end smoke test for VEYA.
// Starts the real server on a free port with a throwaway database, then checks
// sign-up, sign-in, the REST API, real-time messaging over Socket.IO, groups and QR attendance.
// Run with:  npm test
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { io } = require('socket.io-client');

let server, base, tmpDir;
const PASS = 'Kamand@2026';

const freePort = () => new Promise((resolve) => {
  const s = net.createServer().listen(0, () => { const { port } = s.address(); s.close(() => resolve(port)); });
});
async function api(token, method, url, body) {
  const r = await fetch(base + url, {
    method, headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}
const signup = (u) => api(null, 'POST', '/api/signup', { name: u + ' Test', username: u, email: u + '@students.iitmandi.ac.in', password: PASS });
const connect = (token) => new Promise((resolve, reject) => {
  const s = io(base, { auth: { token }, transports: ['websocket'], reconnection: false });
  s.on('connect', () => resolve(s)); s.on('connect_error', reject);
});

before(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'veya-test-'));
  const port = await freePort();
  base = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: { ...process.env, PORT: String(port), DB_FILE: path.join(tmpDir, 'db.json'), TENOR_API_KEY: '', ADMIN_USERNAMES: '' },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  // wait until the server answers
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(base + '/api/health')).ok) return; } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('Server did not start');
});
after(async () => {
  // stop the test server and wait for it to exit before deleting its temp folder (Windows locks open files)
  if (server && server.exitCode === null) {
    const exited = new Promise((resolve) => server.once('exit', resolve));
    server.kill();
    await Promise.race([exited, new Promise((r) => setTimeout(r, 5000))]);
  }
  try { fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch {}
});

let A, B, aId, bId;

test('serves the web app and health check', async () => {
  const html = await (await fetch(base + '/')).text();
  assert.match(html, /VEYA/);
  assert.equal((await api(null, 'GET', '/api/health')).body.ok, true);
});

test('sign-up enforces the password format', async () => {
  const r = await api(null, 'POST', '/api/signup', { name: 'Weak', username: 'weakpw', email: 'w@x.in', password: 'abc' });
  assert.equal(r.status, 400);
});

test('sign-up and sign-in; first account becomes core-team admin', async () => {
  const a = await signup('alice'); assert.equal(a.status, 200); A = a.body.token; aId = a.body.me.id;
  assert.equal(a.body.me.admin, true);
  const b = await signup('bob'); assert.equal(b.status, 200); bId = b.body.me.id;
  assert.equal(b.body.me.admin, false);
  const s = await api(null, 'POST', '/api/signin', { login: 'bob', password: PASS });
  assert.equal(s.status, 200); B = s.body.token;
  assert.equal((await api(null, 'POST', '/api/signin', { login: 'bob', password: 'Wrong#123' })).status, 401);
});

test('API rejects requests without a valid token', async () => {
  assert.equal((await api(null, 'GET', '/api/bootstrap')).status, 401);
  assert.equal((await api('not-a-token', 'GET', '/api/bootstrap')).status, 401);
});

test('bootstrap returns communities and clubs', async () => {
  const r = await api(B, 'GET', '/api/bootstrap');
  assert.equal(r.status, 200);
  const ids = r.body.communities.map((c) => c.id);
  for (const c of ['campus', 'sntc', 'cultsoc', 'sports', 'extra']) assert.ok(ids.includes(c), c);
});

test('real-time: a message sent by one user reaches another instantly', async () => {
  const sa = await connect(A), sb = await connect(B);
  try {
    const got = new Promise((resolve) => sb.on('message:new', (m) => m.text === 'hello kamand' && resolve(m)));
    const ack = await new Promise((resolve) => sa.emit('message:send', { room: 'campus/general', text: 'hello kamand' }, resolve));
    assert.equal(ack.ok, true);
    const m = await Promise.race([got, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 3000))]);
    assert.equal(m.from, aId);
  } finally { sa.close(); sb.close(); }
});

test('only core team can post in #announcements', async () => {
  const sb = await connect(B);
  try {
    const ack = await new Promise((resolve) => sb.emit('message:send', { room: 'campus/announcements', text: 'hi' }, resolve));
    assert.ok(ack.error);
  } finally { sb.close(); }
});

test('groups: private group needs approval; messages are members-only', async () => {
  const g = (await api(A, 'POST', '/api/groups', { name: 'Freshers B26', type: 'Freshers', privacy: 'private' })).body.group;
  assert.ok(g?.id);
  assert.equal((await api(B, 'POST', `/api/groups/${g.id}/join`)).body.group.role, 'requested');
  const sb = await connect(B);
  const denied = await new Promise((resolve) => sb.emit('message:send', { room: 'group/' + g.id, text: 'let me in' }, resolve));
  sb.close();
  assert.ok(denied.error);
  assert.equal((await api(A, 'POST', `/api/groups/${g.id}/requests/${bId}`, { approve: true })).status, 200);
  const sb2 = await connect(B);
  const ok = await new Promise((resolve) => sb2.emit('message:send', { room: 'group/' + g.id, text: 'thanks!' }, resolve));
  sb2.close();
  assert.equal(ok.ok, true);
});

test('QR attendance: organiser gets a code and a student checks in', async () => {
  const start = new Date(Date.now() + 10 * 60000), end = new Date(Date.now() + 70 * 60000);
  const ev = await api(A, 'POST', '/api/events', {
    title: 'Test Talk', communityId: 'campus', venue: 'Auditorium Complex, North Campus', start: start.toISOString(), end: end.toISOString(), desc: 'test',
  });
  assert.equal(ev.status, 200, JSON.stringify(ev.body));
  const id = (ev.body.event || ev.body).id;
  const att = await api(A, 'GET', `/api/events/${id}/attendance`);
  assert.equal(att.status, 200, JSON.stringify(att.body));
  const code = att.body.code;
  assert.match(code, /^[A-Z0-9]{6}$/);
  assert.equal((await api(B, 'POST', `/api/events/${id}/checkin`, { code: 'WRONG1' })).status, 400);
  assert.equal((await api(B, 'POST', `/api/events/${id}/checkin`, { code })).status, 200);
  const after = await api(A, 'GET', `/api/events/${id}/attendance`);
  assert.ok(after.body.attendees.some((x) => (x.id || x.userId) === bId));
});

test('Schedule Planner detects a clash', async () => {
  const add = (title) => api(B, 'POST', '/api/schedule', { title, kind: 'weekly', day: 1, start: '10:00', end: '11:00' });
  assert.equal((await add('Maths')).status, 200);
  const r = await add('Physics');
  assert.equal(r.status, 409, JSON.stringify(r.body)); // 409 = clash found, not saved
});
