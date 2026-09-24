// 現場カレンダー サーバー(外部ライブラリなし / Node.js 18以上)
// 予定と写真を data/ フォルダに保存し、チーム全員で共有する。
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT) || 3000;
const PASSCODE = process.env.TEAM_PASSCODE || '1234';
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const PHOTO_DIR = path.join(DATA_DIR, 'photos');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const PUBLIC_DIR = path.join(__dirname, 'public');
const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
const MAX_JSON_BYTES = 256 * 1024;

const TOKEN = crypto.createHash('sha256').update('genba-v1:' + PASSCODE).digest('hex');

const MEMBER_COLORS = ['#e8590c', '#1c7ed6', '#2f9e44', '#ae3ec9', '#f08c00', '#0c8599', '#e03131', '#5f3dc4'];

fs.mkdirSync(PHOTO_DIR, { recursive: true });

let db = { version: 1, members: [], events: [] };
if (fs.existsSync(DB_FILE)) {
  db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
}

let saveTimer = null;
function save() {
  db.version++;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const tmp = DB_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(db));
    fs.renameSync(tmp, DB_FILE);
  }, 50);
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.json': 'application/json'
};

function send(res, status, body, headers) {
  const isJson = typeof body !== 'string' && !Buffer.isBuffer(body);
  res.writeHead(status, Object.assign({
    'Content-Type': isJson ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store'
  }, headers));
  res.end(isJson ? JSON.stringify(body) : body);
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(Object.assign(new Error('too large'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function readJson(req) {
  const buf = await readBody(req, MAX_JSON_BYTES);
  try {
    return buf.length ? JSON.parse(buf.toString('utf8')) : {};
  } catch (e) {
    throw Object.assign(new Error('bad json'), { status: 400 });
  }
}

function isAuthed(req) {
  const cookie = req.headers.cookie || '';
  return cookie.split(/;\s*/).some((c) => c === 'genba=' + TOKEN);
}

function str(v, max) {
  return typeof v === 'string' ? v.trim().slice(0, max || 500) : '';
}
function dateOrNull(v) {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
}
function timeOrNull(v) {
  return typeof v === 'string' && /^\d{2}:\d{2}$/.test(v) ? v : null;
}

const EDITABLE = {
  date: dateOrNull,
  time: timeOrNull,
  endTime: timeOrNull,
  timeNote: (v) => str(v, 20),
  title: (v) => str(v, 200),
  client: (v) => str(v, 100),
  place: (v) => str(v, 200),
  phone: (v) => str(v, 40),
  memo: (v) => str(v, 2000),
  raw: (v) => str(v, 1000),
  report: (v) => str(v, 2000),
  assignees: (v) => (Array.isArray(v) ? v.map((x) => str(x, 30)).filter(Boolean).slice(0, 20) : []),
  status: (v) => (v === 'done' ? 'done' : 'todo')
};

function applyFields(ev, body) {
  for (const key of Object.keys(EDITABLE)) {
    if (key in body) ev[key] = EDITABLE[key](body[key]);
  }
}

function findEvent(id) {
  return db.events.find((e) => e.id === id && !e.deleted);
}

async function handleApi(req, res, url) {
  const parts = url.pathname.split('/').filter(Boolean); // ['api', ...]
  const method = req.method;

  if (method === 'POST' && parts[1] === 'login') {
    const body = await readJson(req);
    if (str(body.passcode, 100) !== PASSCODE) return send(res, 401, { error: '合言葉がちがいます' });
    return send(res, 200, { ok: true }, {
      'Set-Cookie': 'genba=' + TOKEN + '; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000'
    });
  }

  if (!isAuthed(req)) return send(res, 401, { error: 'login required' });

  // GET /api/state?v=12  → 変わっていなければ中身を返さない
  if (method === 'GET' && parts[1] === 'state') {
    const v = Number(url.searchParams.get('v'));
    if (v === db.version) return send(res, 200, { version: db.version, unchanged: true });
    return send(res, 200, {
      version: db.version,
      members: db.members,
      events: db.events.filter((e) => !e.deleted)
    });
  }

  if (method === 'PUT' && parts[1] === 'members') {
    const body = await readJson(req);
    const list = Array.isArray(body.members) ? body.members : [];
    const seen = new Set();
    db.members = list
      .map((m, i) => ({ name: str(m && m.name, 30), color: /^#[0-9a-f]{6}$/i.test(m && m.color) ? m.color : MEMBER_COLORS[i % MEMBER_COLORS.length] }))
      .filter((m) => m.name && !seen.has(m.name) && seen.add(m.name));
    save();
    return send(res, 200, { members: db.members, version: db.version });
  }

  if (parts[1] !== 'events') return send(res, 404, { error: 'not found' });
  const id = parts[2];

  // POST /api/events  (id は端末側で作る → 電波が悪くて再送しても二重登録にならない)
  if (method === 'POST' && !id) {
    const body = await readJson(req);
    const newId = /^[a-z0-9-]{8,40}$/i.test(body.id || '') ? body.id : crypto.randomUUID();
    const existing = db.events.find((e) => e.id === newId);
    if (existing) return send(res, 200, { event: existing, version: db.version });
    const now = new Date().toISOString();
    const ev = {
      id: newId, date: null, time: null, endTime: null, timeNote: '', title: '', client: '', place: '', phone: '',
      memo: '', raw: '', report: '', assignees: [], status: 'todo', photos: [],
      createdBy: str(body.by, 30), createdAt: now, updatedAt: now, updatedBy: str(body.by, 30)
    };
    applyFields(ev, body);
    if (!ev.title) ev.title = ev.raw || '(内容なし)';
    db.events.push(ev);
    save();
    return send(res, 201, { event: ev, version: db.version });
  }

  const ev = id && findEvent(id);
  if (!ev) return send(res, 404, { error: 'not found' });

  if (method === 'PUT' && !parts[3]) {
    const body = await readJson(req);
    const wasDone = ev.status === 'done';
    applyFields(ev, body);
    ev.updatedAt = new Date().toISOString();
    ev.updatedBy = str(body.by, 30);
    if (ev.status === 'done' && !wasDone) {
      ev.doneAt = ev.updatedAt;
      ev.doneBy = ev.updatedBy;
    }
    save();
    return send(res, 200, { event: ev, version: db.version });
  }

  if (method === 'DELETE' && !parts[3]) {
    ev.deleted = true;
    ev.updatedAt = new Date().toISOString();
    save();
    return send(res, 200, { ok: true, version: db.version });
  }

  // POST /api/events/:id/photos  本体はJPEGそのもの
  if (method === 'POST' && parts[3] === 'photos') {
    const buf = await readBody(req, MAX_PHOTO_BYTES);
    if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return send(res, 400, { error: 'JPEGのみ対応' });
    const file = ev.id + '-' + crypto.randomBytes(6).toString('hex') + '.jpg';
    fs.writeFileSync(path.join(PHOTO_DIR, file), buf);
    ev.photos.push({ file, by: str(url.searchParams.get('by'), 30), at: new Date().toISOString() });
    ev.updatedAt = new Date().toISOString();
    save();
    return send(res, 201, { event: ev, version: db.version });
  }

  if (method === 'DELETE' && parts[3] === 'photos' && parts[4]) {
    const idx = ev.photos.findIndex((p) => p.file === parts[4]);
    if (idx === -1) return send(res, 404, { error: 'not found' });
    const [removed] = ev.photos.splice(idx, 1);
    fs.rm(path.join(PHOTO_DIR, path.basename(removed.file)), () => {});
    save();
    return send(res, 200, { event: ev, version: db.version });
  }

  return send(res, 404, { error: 'not found' });
}

function serveFile(res, file, cache) {
  fs.readFile(file, (err, data) => {
    if (err) return send(res, 404, 'not found');
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': cache || 'no-cache'
    });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);

    if (url.pathname.startsWith('/photos/')) {
      if (!isAuthed(req)) return send(res, 401, 'login required');
      const name = path.basename(decodeURIComponent(url.pathname));
      return serveFile(res, path.join(PHOTO_DIR, name), 'private, max-age=31536000, immutable');
    }

    let rel = decodeURIComponent(url.pathname);
    if (rel === '/') rel = '/index.html';
    const file = path.join(PUBLIC_DIR, path.normalize(rel));
    if (!file.startsWith(PUBLIC_DIR)) return send(res, 403, 'forbidden');
    return serveFile(res, file);
  } catch (e) {
    if (!res.headersSent) send(res, e.status || 500, { error: e.status ? e.message : 'server error' });
    if (!e.status) console.error(e);
  }
});

function flushAndExit() {
  clearTimeout(saveTimer);
  fs.writeFileSync(DB_FILE, JSON.stringify(db));
  process.exit(0);
}
process.on('SIGINT', flushAndExit);
process.on('SIGTERM', flushAndExit);

server.listen(PORT, () => {
  console.log('現場カレンダー起動: http://localhost:' + PORT);
  if (!process.env.TEAM_PASSCODE) console.log('※ 合言葉が初期値(1234)です。TEAM_PASSCODE を設定してください。');
});
