'use strict';
/* =====================================================================
   BIOLINK SERVER — tanpa dependency (hanya modul bawaan Node.js >= 18)

   Fungsi:
   - Menyajikan halaman publik (folder /public)
   - GET  /api/config  -> data profil, link, musik, tema (publik)
   - POST /api/login   -> cek password admin, kembalikan token (12 jam)
   - PUT  /api/config  -> simpan perubahan (butuh token admin)
   Data disimpan di DATA_DIR/db.json, jadi perubahan langsung tampil
   untuk semua pengunjung tanpa perlu restart server.

   KONFIGURASI (environment variable):
   - ADMIN_PASSWORD  : password admin  <<< UBAH DI SINI / DI DASHBOARD HOSTING >>>
   - SESSION_SECRET  : string acak panjang untuk menandatangani token
   - DATA_DIR        : folder penyimpanan data (arahkan ke disk/volume permanen)
   - PORT            : port server (otomatis diisi oleh hosting)
   ===================================================================== */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT) || 3000;
const DEFAULT_PASSWORD = 'G4lih#99Xz';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || DEFAULT_PASSWORD;
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.createHash('sha256').update('biolink:' + ADMIN_PASSWORD).digest('hex');
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const PUBLIC_DIR = path.join(__dirname, 'public');
const TOKEN_TTL_MS = 12 * 60 * 60 * 1000;
const MAX_BODY = 1.5 * 1024 * 1024;

const THEME_IDS = ['obsidian-gold', 'purple-velvet', 'midnight-neon'];

const DEFAULTS = {
  profile: {
    name: 'Nama Kamu',
    handle: '@username',
    bio: 'Creator • Developer • Dreamer. Temukan semua tautan pentingku di sini ✨',
    photo: ''
  },
  links: [
    { id: 'l1', title: 'Instagram', url: 'https://instagram.com/', icon: 'fa-brands fa-instagram' },
    { id: 'l2', title: 'WhatsApp', url: 'https://wa.me/6281234567890', icon: 'fa-brands fa-whatsapp' },
    { id: 'l3', title: 'YouTube Channel', url: 'https://youtube.com/', icon: 'fa-brands fa-youtube' },
    { id: 'l4', title: 'TikTok', url: 'https://tiktok.com/', icon: 'fa-brands fa-tiktok' },
    { id: 'l5', title: 'Website / Portfolio', url: 'https://example.com/', icon: '🌐' }
  ],
  music: { url: 'https://www.youtube.com/watch?v=jfKfPfyJRdk', videoId: 'jfKfPfyJRdk', title: '', autoplay: true },
  theme: 'obsidian-gold'
};

/* ---------------------- Validasi & sanitasi ---------------------- */
function normalizeUrl(raw) {
  let u = String(raw || '').trim();
  if (!u) return null;
  if (/^(mailto:|tel:)/i.test(u)) return u.slice(0, 500);
  if (/^[a-z][a-z0-9+.-]*:/i.test(u) && !/^https?:/i.test(u)) return null;
  if (!/^https?:\/\//i.test(u)) u = 'https://' + u.replace(/^\/+/, '');
  try { const x = new URL(u); return /^https?:$/.test(x.protocol) ? x.href.slice(0, 500) : null; } catch { return null; }
}

function sanitize(d) {
  d = d && typeof d === 'object' ? d : {};
  const str = (v, max) => String(v ?? '').trim().slice(0, max);
  const p = d.profile && typeof d.profile === 'object' ? d.profile : {};

  let photo = String(p.photo || '').trim();
  const okPhoto = /^https?:\/\/\S+$/i.test(photo) || /^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(photo);
  if (!okPhoto || photo.length > 600000) photo = '';

  const links = (Array.isArray(d.links) ? d.links : []).slice(0, 60).map(l => ({
    id: str(l && l.id, 64) || crypto.randomUUID(),
    title: str(l && l.title, 60),
    url: normalizeUrl(l && l.url),
    icon: str(l && l.icon, 60) || '🔗'
  })).filter(l => l.title && l.url);

  const m = d.music && typeof d.music === 'object' ? d.music : {};
  const videoId = /^[\w-]{11}$/.test(String(m.videoId || '')) ? String(m.videoId) : '';

  return {
    profile: {
      name: str(p.name, 50) || DEFAULTS.profile.name,
      handle: str(p.handle, 50),
      bio: str(p.bio, 200),
      photo
    },
    links,
    music: { url: videoId ? str(m.url, 300) : '', videoId, title: str(m.title, 80), autoplay: !!m.autoplay && !!videoId },
    theme: THEME_IDS.includes(d.theme) ? d.theme : DEFAULTS.theme
  };
}

/* ---------------------- Penyimpanan (file JSON) ---------------------- */
let db;
function saveDb() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DB_FILE); // atomic: file tidak rusak kalau server mati saat menulis
}
function loadDb() {
  // 1) Data utama di DATA_DIR/db.json
  try { db = sanitize(JSON.parse(fs.readFileSync(DB_FILE, 'utf8'))); return; } catch {}
  // 2) Jika belum ada (mis. hosting gratis yang menghapus disk saat restart), pakai seed.json
  //    di folder proyek. Cara membuatnya: Dashboard Admin > Data > Export JSON, ganti namanya
  //    menjadi seed.json, lalu commit/deploy bersama kode.
  let seed = DEFAULTS;
  try { seed = JSON.parse(fs.readFileSync(path.join(__dirname, 'seed.json'), 'utf8')); console.log('Data awal diambil dari seed.json'); } catch {}
  db = sanitize(seed);
  try { saveDb(); } catch (e) { console.error('Gagal menulis db awal:', e.message); }
}

/* ---------------------- Token admin (HMAC) ---------------------- */
const b64u = b => Buffer.from(b).toString('base64url');
const sign = payload => crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('base64url');
function makeToken() { const payload = b64u(JSON.stringify({ exp: Date.now() + TOKEN_TTL_MS })); return payload + '.' + sign(payload); }
function verifyToken(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return false;
  const [payload, sig] = token.split('.');
  const expected = sign(payload);
  const a = Buffer.from(sig || ''), b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
  try { return JSON.parse(Buffer.from(payload, 'base64url').toString()).exp > Date.now(); } catch { return false; }
}
function passwordOk(input) {
  const h = s => crypto.createHash('sha256').update(String(s)).digest();
  return crypto.timingSafeEqual(h(input), h(ADMIN_PASSWORD));
}
const isAuthed = req => verifyToken((req.headers.authorization || '').replace(/^Bearer\s+/i, ''));

/* ---------------------- Pembatasan percobaan login ---------------------- */
const attempts = new Map(); // ip -> { count, until }
const MAX_FAILS = 5, LOCK_MS = 10 * 60 * 1000;
const clientIp = req => (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || 'unknown';
setInterval(() => { const n = Date.now(); for (const [k, v] of attempts) if (v.until && v.until < n) attempts.delete(k); }, 5 * 60 * 1000).unref();

/* ---------------------- Helper HTTP ---------------------- */
const SEC_HEADERS = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin', 'X-Frame-Options': 'SAMEORIGIN' };
function json(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { ...SEC_HEADERS, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > MAX_BODY) { reject(Object.assign(new Error('Data terlalu besar'), { status: 413 })); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString() || '{}')); } catch { reject(Object.assign(new Error('JSON tidak valid'), { status: 400 })); } });
    req.on('error', reject);
  });
}

const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8' };
function serveStatic(pathname, req, res) {
  let rel;
  try { rel = decodeURIComponent(pathname); } catch { return json(res, 400, { error: 'Bad request' }); }
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) return json(res, 403, { error: 'Forbidden' });
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return json(res, 404, { error: 'Not found' });
    const ext = path.extname(file).toLowerCase();
    res.writeHead(200, { ...SEC_HEADERS, 'Content-Type': MIME[ext] || 'application/octet-stream', 'Content-Length': st.size, 'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=3600' });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  });
}

/* ---------------------- Server ---------------------- */
const server = http.createServer(async (req, res) => {
  try {
    const { pathname } = new URL(req.url, 'http://localhost');

    if (pathname === '/healthz') return json(res, 200, { ok: true });

    if (pathname === '/api/config' && req.method === 'GET') return json(res, 200, db);

    if (pathname === '/api/login' && req.method === 'POST') {
      const ip = clientIp(req); const rec = attempts.get(ip) || { count: 0, until: 0 };
      if (rec.until > Date.now()) return json(res, 429, { error: 'Terlalu banyak percobaan. Coba lagi beberapa menit lagi.' });
      const body = await readBody(req);
      if (passwordOk(body.password || '')) { attempts.delete(ip); return json(res, 200, { token: makeToken() }); }
      rec.count++;
      if (rec.count >= MAX_FAILS) { rec.until = Date.now() + LOCK_MS; rec.count = 0; }
      attempts.set(ip, rec);
      return json(res, 401, { error: 'Password salah' });
    }

    if (pathname === '/api/config' && req.method === 'PUT') {
      if (!isAuthed(req)) return json(res, 401, { error: 'Tidak diizinkan. Silakan login ulang.' });
      db = sanitize(await readBody(req));
      saveDb();
      return json(res, 200, db);
    }

    if (pathname.startsWith('/api/')) return json(res, 404, { error: 'Not found' });
    if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { error: 'Method not allowed' });
    return serveStatic(pathname, req, res);
  } catch (e) {
    if (!res.headersSent) json(res, e.status || 500, { error: e.status ? e.message : 'Kesalahan server' });
    if (!e.status) console.error(e);
  }
});

loadDb();
server.listen(PORT, () => {
  console.log(`Biolink berjalan di port ${PORT} • data: ${DB_FILE}`);
  if (ADMIN_PASSWORD === DEFAULT_PASSWORD) console.warn('⚠️  Anda masih memakai password default. Set environment variable ADMIN_PASSWORD sebelum go-live!');
});
