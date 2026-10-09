// Schedule Planner — keeps a personal timetable, detects clashes with
// classes, club meetings and events you RSVP'd to, and suggests free slots.
const crypto = require('crypto');

const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const DAY_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DAY_START = 7 * 60;   // 07:00 — earliest slot the bot suggests
const DAY_END = 23 * 60;    // 23:00 — latest

const pad = (n) => String(n).padStart(2, '0');
const fmt = (m) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
const overlaps = (a, b) => a.start < b.end && b.start < a.end;

// tz = browser's getTimezoneOffset() (IST = -330)
const localMs = (ts, tz) => new Date(ts).getTime() - tz * 60000;
const localDate = (ts, tz) => new Date(localMs(ts, tz)).toISOString().slice(0, 10);
const localMin = (ts, tz) => { const d = new Date(localMs(ts, tz)); return d.getUTCHours() * 60 + d.getUTCMinutes(); };
const todayStr = (tz) => localDate(Date.now(), tz);
const addDays = (date, n) => { const d = new Date(date + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const dow = (date) => new Date(date + 'T00:00:00Z').getUTCDay();
const prettyDate = (date) => `${DAY_FULL[dow(date)].slice(0, 3)} ${date.slice(8)}/${date.slice(5, 7)}`;

function parseTime(s) {
  const m = /^(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)?$/i.exec(s.trim());
  if (!m) return null;
  let h = +m[1]; const mi = +(m[2] || 0); const ap = (m[3] || '').toLowerCase();
  if (ap === 'pm' && h < 12) h += 12;
  if (ap === 'am' && h === 12) h = 0;
  if (h > 24 || mi > 59) return null;
  return h * 60 + mi;
}

function parseRange(s) {
  const parts = s.split(/\s*(?:-|–|to)\s*/i);
  if (parts.length !== 2) return null;
  let a = parseTime(parts[0]); const b = parseTime(parts[1]);
  if (a == null || b == null) return null;
  // "2-4pm" → assume both pm
  if (!/am|pm/i.test(parts[0]) && /pm/i.test(parts[1]) && a < 12 * 60 && a + 12 * 60 < b) a += 12 * 60;
  if (b <= a) return null;
  return { start: a, end: b };
}

// Returns { kind:'weekly', day } | { kind:'once', date } | null
function parseWhen(tok, tz) {
  const t = tok.toLowerCase();
  if (t === 'today') return { kind: 'once', date: todayStr(tz) };
  if (t === 'tomorrow' || t === 'tmrw') return { kind: 'once', date: addDays(todayStr(tz), 1) };
  const di = DAYS.findIndex((d, i) => t === d || t === DAY_FULL[i].toLowerCase() || (t.length >= 3 && DAY_FULL[i].toLowerCase().startsWith(t)));
  if (di >= 0) return { kind: 'weekly', day: di };
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
  if (m) return { kind: 'once', date: t };
  m = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/.exec(t);
  if (m) {
    let y = m[3] ? +m[3] : +todayStr(tz).slice(0, 4);
    if (y < 100) y += 2000;
    return { kind: 'once', date: `${y}-${pad(+m[2])}-${pad(+m[1])}` };
  }
  return null;
}

class ScheduleBot {
  constructor(db) { this.db = db; }

  items(userId) { return (this.db.data.schedules[userId] ||= []); }

  rsvpEvents(userId, tz) {
    return this.db.data.events
      .filter((e) => e.rsvps.includes(userId))
      .map((e) => {
        const date = localDate(e.start, tz);
        const start = localMin(e.start, tz);
        let end = localDate(e.end, tz) === date ? localMin(e.end, tz) : 24 * 60;
        if (end <= start) end = Math.min(start + 60, 24 * 60);
        return { id: 'ev:' + e.id, eventId: e.id, title: '📅 ' + e.title, kind: 'once', date, start, end, source: 'event' };
      });
  }

  // Everything happening on a specific date for this user
  agenda(userId, date, tz, { skipEventId } = {}) {
    const d = dow(date);
    const own = this.items(userId).filter((i) => (i.kind === 'weekly' && i.day === d) || (i.kind === 'once' && i.date === date));
    const evs = this.rsvpEvents(userId, tz).filter((e) => e.date === date && e.eventId !== skipEventId);
    return [...own, ...evs].sort((a, b) => a.start - b.start);
  }

  // Clashes for a candidate slot. Weekly items are checked against the same weekday for the next 4 weeks.
  clashes(userId, when, range, tz, opts = {}) {
    const dates = when.kind === 'once' ? [when.date] : this.nextDates(when.day, 4, tz);
    const out = [];
    for (const date of dates) {
      for (const it of this.agenda(userId, date, tz, opts)) {
        if (opts.skipItemId && it.id === opts.skipItemId) continue;
        if (when.kind === 'weekly' && it.kind === 'weekly' && out.some((o) => o.id === it.id)) continue;
        if (overlaps(range, it)) out.push({ ...it, onDate: date });
      }
    }
    return out;
  }

  nextDates(day, n, tz) {
    let date = todayStr(tz);
    while (dow(date) !== day) date = addDays(date, 1);
    return Array.from({ length: n }, (_, i) => addDays(date, i * 7));
  }

  freeSlots(userId, date, tz, minDur = 30) {
    const busy = this.agenda(userId, date, tz);
    let cursor = DAY_START;
    if (date === todayStr(tz)) {
      const now = localMin(Date.now(), tz);
      cursor = Math.max(cursor, Math.ceil(now / 15) * 15);
    }
    const free = [];
    for (const b of busy) {
      if (b.start - cursor >= minDur) free.push({ start: cursor, end: b.start });
      cursor = Math.max(cursor, b.end);
    }
    if (DAY_END - cursor >= minDur) free.push({ start: cursor, end: DAY_END });
    return free;
  }

  suggest(userId, when, dur, tz) {
    const base = when.kind === 'once' ? when.date : this.nextDates(when.day, 1, tz)[0];
    for (let i = 0; i < 7; i++) {
      const date = addDays(base, i);
      const slot = this.freeSlots(userId, date, tz, dur)[0];
      if (slot) return { date, start: slot.start, end: slot.start + dur };
    }
    return null;
  }

  add(userId, { title, when, range }, tz, force = false) {
    const clashes = this.clashes(userId, when, range, tz);
    if (clashes.length && !force) return { ok: false, clashes, suggestion: this.suggest(userId, when, range.end - range.start, tz) };
    const item = { id: crypto.randomBytes(6).toString('hex'), title: title.slice(0, 80), ...when, ...range };
    this.items(userId).push(item);
    this.db.save();
    return { ok: true, item, clashes };
  }

  describeWhen(it) { return it.kind === 'weekly' ? `every ${DAY_FULL[it.day]}` : prettyDate(it.date); }

  // ---- chat interface ----------------------------------------------------
  handle(userId, text, tz) {
    const raw = (text || '').trim();
    const [cmdRaw, ...rest] = raw.split(/\s+/);
    const cmd = (cmdRaw || '').toLowerCase();
    const arg = rest.join(' ');

    if (!cmd || cmd === 'help' || cmd === 'hi' || cmd === 'hello') return { reply: HELP };

    if (cmd === 'add' || cmd === 'add!') {
      // add <title...> <when> <HH:MM-HH:MM>
      const toks = rest;
      if (toks.length < 3) return { reply: 'Usage: `add <title> <day|date> <start-end>`\ne.g. `add DSA lecture mon 9-10am`' };
      const rangeTok = toks[toks.length - 1];
      const whenTok = toks[toks.length - 2];
      const title = toks.slice(0, -2).join(' ');
      const range = parseRange(rangeTok);
      const when = parseWhen(whenTok, tz);
      if (!range) return { reply: `I couldn't read the time "${rangeTok}". Try \`14:00-15:30\` or \`2-3:30pm\`.` };
      if (!when) return { reply: `I couldn't read the day "${whenTok}". Use mon…sun (weekly), today, tomorrow, 25/10 or 2026-10-25.` };
      const r = this.add(userId, { title, when, range }, tz, cmd === 'add!');
      if (!r.ok) {
        let msg = `⚠️ Clash! "${title}" (${this.describeWhen(when)} ${fmt(range.start)}–${fmt(range.end)}) overlaps with:\n`;
        msg += r.clashes.slice(0, 5).map((c) => `  • ${c.title} — ${prettyDate(c.onDate)} ${fmt(c.start)}–${fmt(c.end)}`).join('\n');
        if (r.suggestion) msg += `\n\n💡 Nearest free slot: ${prettyDate(r.suggestion.date)} ${fmt(r.suggestion.start)}–${fmt(r.suggestion.end)}`;
        msg += `\n\nType \`add! ${title} ${whenTok} ${rangeTok}\` to add it anyway.`;
        return { reply: msg };
      }
      return { reply: `✅ Added "${r.item.title}" — ${this.describeWhen(r.item)} ${fmt(r.item.start)}–${fmt(r.item.end)}.${r.clashes.length ? ' (forced despite clash)' : ' No clashes.'}`, changed: true };
    }

    if (cmd === 'list' || cmd === 'show') {
      const items = this.items(userId);
      if (!items.length) return { reply: 'Your schedule is empty. Try `add Maths tutorial tue 11-12`.' };
      const sorted = [...items].sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'weekly' ? -1 : 1) || (a.day ?? 0) - (b.day ?? 0) || (a.date || '').localeCompare(b.date || '') || a.start - b.start);
      return { reply: 'Your schedule:\n' + sorted.map((it, i) => `${i + 1}. ${it.title} — ${this.describeWhen(it)} ${fmt(it.start)}–${fmt(it.end)}`).join('\n') + '\n\nRemove with `remove <number>`.' };
    }

    if (cmd === 'remove' || cmd === 'delete' || cmd === 'rm') {
      const items = this.items(userId);
      const sorted = [...items].sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'weekly' ? -1 : 1) || (a.day ?? 0) - (b.day ?? 0) || (a.date || '').localeCompare(b.date || '') || a.start - b.start);
      const n = parseInt(arg, 10);
      if (!n || n < 1 || n > sorted.length) return { reply: 'Give me a number from `list`, e.g. `remove 2`.' };
      const it = sorted[n - 1];
      items.splice(items.indexOf(it), 1);
      this.db.save();
      return { reply: `🗑️ Removed "${it.title}".`, changed: true };
    }

    if (cmd === 'today' || cmd === 'tomorrow' || cmd === 'day' || cmd === 'agenda') {
      const when = parseWhen(cmd === 'day' || cmd === 'agenda' ? (arg || 'today') : cmd, tz);
      if (!when) return { reply: 'Try `agenda fri` or `agenda 25/10`.' };
      const date = when.kind === 'once' ? when.date : this.nextDates(when.day, 1, tz)[0];
      const ag = this.agenda(userId, date, tz);
      if (!ag.length) return { reply: `${prettyDate(date)}: nothing scheduled — totally free 🌄` };
      return { reply: `${prettyDate(date)}:\n` + ag.map((a) => `  ${fmt(a.start)}–${fmt(a.end)}  ${a.title}`).join('\n') };
    }

    if (cmd === 'week') {
      let date = todayStr(tz);
      const lines = [];
      for (let i = 0; i < 7; i++, date = addDays(date, 1)) {
        const ag = this.agenda(userId, date, tz);
        lines.push(`${prettyDate(date)}: ${ag.length ? ag.map((a) => `${fmt(a.start)} ${a.title}`).join(', ') : '—'}`);
      }
      return { reply: 'Next 7 days:\n' + lines.join('\n') };
    }

    if (cmd === 'free') {
      const [whenTok = 'today', durTok] = rest;
      const when = parseWhen(whenTok, tz);
      if (!when) return { reply: 'Try `free tomorrow` or `free fri 90` (minimum minutes).' };
      const date = when.kind === 'once' ? when.date : this.nextDates(when.day, 1, tz)[0];
      const dur = Math.max(15, parseInt(durTok, 10) || 30);
      const slots = this.freeSlots(userId, date, tz, dur);
      if (!slots.length) return { reply: `${prettyDate(date)} is fully booked for ${dur}+ min blocks 😅` };
      return { reply: `Free on ${prettyDate(date)} (≥${dur} min, 07:00–23:00):\n` + slots.map((s) => `  🟢 ${fmt(s.start)}–${fmt(s.end)}`).join('\n') };
    }

    if (cmd === 'check') {
      const [whenTok, rangeTok] = rest;
      const when = whenTok && parseWhen(whenTok, tz);
      const range = rangeTok && parseRange(rangeTok);
      if (!when || !range) return { reply: 'Usage: `check <day|date> <start-end>`, e.g. `check fri 17-19`' };
      const c = this.clashes(userId, when, range, tz);
      if (!c.length) return { reply: `✅ ${this.describeWhen(when)} ${fmt(range.start)}–${fmt(range.end)} is free.` };
      return { reply: `⚠️ That slot clashes with:\n` + c.map((x) => `  • ${x.title} — ${prettyDate(x.onDate)} ${fmt(x.start)}–${fmt(x.end)}`).join('\n') };
    }

    if (cmd === 'clear') {
      if (arg !== 'confirm') return { reply: 'This deletes your whole schedule. Type `clear confirm` to proceed.' };
      this.db.data.schedules[userId] = [];
      this.db.save();
      return { reply: '🧹 Schedule cleared.', changed: true };
    }

    return { reply: `I didn't get "${cmd}". ` + HELP };
  }
}

const HELP = `Hi! I'm the Schedule Planner 🗓️ — I help you avoid clashes.
Commands:
• add <title> <day|date> <start-end> — e.g. add DSA lecture mon 9-10am
   (mon…sun = repeats weekly; today / tomorrow / 25/10 = one-off)
• add! … — add even if it clashes
• list — see everything · remove <n> — delete one
• agenda <day> · today · tomorrow · week
• free <day> [minutes] — find free slots
• check <day> <start-end> — is this slot free?
Events you RSVP to in News are included automatically.`;

module.exports = { ScheduleBot, parseRange, parseWhen, fmt, localDate, localMin, overlaps, dow, addDays, todayStr };
