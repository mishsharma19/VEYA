// Tiny JSON-file database. Good for a campus-scale app / demo.
// Swap for MongoDB/Postgres later by replacing this module.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const FILE = process.env.DB_FILE || path.join(__dirname, 'data', 'db.json');
let data;

function load() {
  try {
    data = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch {
    data = {};
  }
  data.users ||= [];
  data.messages ||= {};   // roomId -> [message]
  data.events ||= null;   // null => seed on first boot
  data.schedules ||= {};  // userId -> [item]
  data.secret ||= crypto.randomBytes(32).toString('hex');
}

let timer = null;
function save() {
  clearTimeout(timer);
  timer = setTimeout(flush, 250);
}

function flush() {
  clearTimeout(timer);
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data));
  fs.renameSync(tmp, FILE);
}

load();
process.on('SIGINT', () => { flush(); process.exit(0); });
process.on('SIGTERM', () => { flush(); process.exit(0); });

module.exports = { get data() { return data; }, save, flush };
