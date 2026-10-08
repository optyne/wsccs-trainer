// eInk API 模擬器 —— 與 WSC2026 Module C/D「eInk_API.pdf」相同端點，研討會 / 訓練時取代中央工廠的 192.168.10.2:3001
//
//   POST   /api/ws26/login                       { teamId, password } → { token }
//   PUT    /api/ws26/labels/:barcode             寫入標籤（title/subtitle/message/…/imageDataUrl）
//   POST   /api/ws26/labels/:barcode/overlay     設定遮罩圖（模擬顯示故障）
//   DELETE /api/ws26/labels/:barcode/overlay     移除遮罩圖
//
//   GET    /                                     虛擬標籤看板（所有標籤即時顯示）
//   GET    /label/:barcode                       單一標籤全螢幕（放在平板上給 ML 相機拍）
//   GET    /label/:barcode.svg                   標籤圖片
//   /sim/api/*                                   模擬器控制（建立標籤、故障注入、清除）
//
// 環境變數：
//   EINK_PORT=3001
//   EINK_TEAMS="team_25:pw1,team_26:pw2"   未設定 → 任何非空帳密都可登入
//   EINK_LABELS="8173E4476,8173E4477"      預先建立的標籤 ID；未設定 → 第一次寫入自動建立
//   EINK_STRICT=1                          只接受 EINK_LABELS 內的 ID（其他回 404）
//   EINK_REFRESH_MS=4000                   e-ink 刷新延遲（API 立即回應，畫面延遲後才變）
//   EINK_MERGE=1                           PUT 只覆蓋有傳的欄位（預設：整筆取代，未傳的欄位清空）
const express = require('express');
const crypto = require('crypto');
const QRCode = require('qrcode');
const { svgBars } = require('./code128');

const PORT = Number(process.env.EINK_PORT || 3001);
const REFRESH_MS = Number(process.env.EINK_REFRESH_MS ?? 4000);
const MERGE = process.env.EINK_MERGE === '1';
const STRICT = process.env.EINK_STRICT === '1';
const TEAMS = Object.fromEntries(
  String(process.env.EINK_TEAMS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const i = s.indexOf(':');
      return [s.slice(0, i), s.slice(i + 1)];
    })
);

const FIELDS = ['title', 'subtitle', 'message', 'messageTextColor', 'messageBackgroundColor', 'nfcUrl', 'qrCode', 'imageDataUrl'];
const COLORS = ['black', 'red', 'white'];
const HEX = { black: '#111', red: '#d1202f', white: '#fff' };

const tokens = new Map(); // token → { teamId, exp }
const labels = new Map(); // barcode → label
const log = []; // 最近 200 筆 API 呼叫
const faults = new Map(); // barcode → 'http500' | 'timeout' | 'norefresh'

function blankLabel(barcode) {
  return {
    barcode,
    data: Object.fromEntries(FIELDS.map((f) => [f, ''])),
    shown: Object.fromEntries(FIELDS.map((f) => [f, ''])),
    overlay: null,
    shownOverlay: null,
    refreshing: false,
    writes: 0,
    updatedAt: null,
    lastTeam: null,
  };
}

String(process.env.EINK_LABELS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)
  .forEach((b) => labels.set(b, blankLabel(b)));

function getLabel(barcode, create) {
  if (!labels.has(barcode)) {
    if (!create || STRICT) return null;
    labels.set(barcode, blankLabel(barcode));
  }
  return labels.get(barcode);
}

// ---------------------------------------------------------------- SSE
const clients = new Set();
function push(type, payload) {
  const msg = `event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const res of clients) res.write(msg);
}

function addLog(req, status, body) {
  const e = {
    ts: Date.now(),
    method: req.method,
    path: req.originalUrl,
    team: req.team || null,
    ip: (req.ip || '').replace('::ffff:', ''),
    status,
    resp: body,
  };
  log.unshift(e);
  log.length = Math.min(log.length, 200);
  push('log', e);
}

function reply(req, res, status, body) {
  addLog(req, status, body);
  res.status(status).json(body);
}

// 模擬 e-ink 刷新：API 立即回應，畫面在 REFRESH_MS 後才更新
function scheduleRefresh(label) {
  label.refreshing = true;
  push('label', view(label));
  clearTimeout(label._t);
  label._t = setTimeout(() => {
    if (faults.get(label.barcode) === 'norefresh') {
      label.refreshing = false;
      push('label', view(label));
      return;
    }
    label.shown = { ...label.data };
    label.shownOverlay = label.overlay;
    label.refreshing = false;
    label.updatedAt = Date.now();
    push('label', view(label));
  }, REFRESH_MS);
}

function view(l) {
  return {
    barcode: l.barcode,
    shown: l.shown,
    pending: l.data,
    overlay: !!l.shownOverlay,
    refreshing: l.refreshing,
    writes: l.writes,
    updatedAt: l.updatedAt,
    lastTeam: l.lastTeam,
    fault: faults.get(l.barcode) || null,
  };
}

// ---------------------------------------------------------------- render
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function fitText(text, max) {
  const t = String(text || '');
  return t.length > max ? t.slice(0, max - 1) + '…' : t;
}

// 400×300 的 3 色 e-ink 版面（白 / 黑 / 紅）
async function renderSVG(l) {
  // 尚未完成過任何一次刷新 → 顯示初始 Welcome 畫面
  const d = l.updatedAt ? l.shown : { ...l.shown, title: 'Welcome', subtitle: 'WS26 E-Label' };
  const W = 400;
  const H = 300;
  const parts = [];
  parts.push(`<rect width="${W}" height="${H}" fill="#fff"/>`);
  // header：簡易文字 logo（非任何組織商標）
  parts.push(`<rect x="0" y="0" width="${W}" height="34" fill="#111"/>`);
  parts.push(`<text x="12" y="23" font-size="17" font-weight="700" fill="#fff" font-family="Arial, Helvetica, sans-serif">WS26</text>`);
  parts.push(`<rect x="60" y="9" width="16" height="16" fill="#d1202f"/>`);
  parts.push(`<text x="${W - 12}" y="22" font-size="12" text-anchor="end" fill="#fff" font-family="Arial, Helvetica, sans-serif">E-LABEL</text>`);

  const hasQR = !!d.qrCode;
  const textW = hasQR ? 26 : 34;
  if (d.title) parts.push(`<text x="14" y="72" font-size="28" font-weight="700" fill="#111" font-family="Arial, Helvetica, sans-serif">${esc(fitText(d.title, textW - 8))}</text>`);
  if (d.subtitle) parts.push(`<text x="14" y="100" font-size="18" fill="#111" font-family="Arial, Helvetica, sans-serif">${esc(fitText(d.subtitle, textW))}</text>`);
  if (d.message) {
    const bg = HEX[d.messageBackgroundColor] || '#fff';
    const fg = HEX[d.messageTextColor] || '#111';
    const mw = hasQR ? 262 : 372;
    parts.push(`<rect x="14" y="112" width="${mw}" height="36" fill="${bg}" stroke="#111" stroke-width="${bg === '#fff' ? 1 : 0}"/>`);
    parts.push(`<text x="${14 + mw / 2}" y="137" font-size="20" font-weight="700" text-anchor="middle" fill="${fg}" font-family="Arial, Helvetica, sans-serif">${esc(fitText(d.message, hasQR ? 22 : 32))}</text>`);
  }
  if (hasQR) {
    try {
      const qr = QRCode.create(String(d.qrCode), { errorCorrectionLevel: 'M' });
      const n = qr.modules.size;
      const size = 104;
      const m = size / (n + 2);
      const ox = W - size - 8;
      const oy = 42;
      let rects = '';
      for (let r = 0; r < n; r++)
        for (let c = 0; c < n; c++) if (qr.modules.get(r, c)) rects += `<rect x="${(ox + (c + 1) * m).toFixed(2)}" y="${(oy + (r + 1) * m).toFixed(2)}" width="${(m + 0.05).toFixed(2)}" height="${(m + 0.05).toFixed(2)}"/>`;
      parts.push(`<rect x="${ox}" y="${oy}" width="${size}" height="${size}" fill="#fff"/><g fill="#111">${rects}</g>`);
    } catch {
      parts.push(`<text x="${W - 60}" y="95" font-size="11" text-anchor="middle" fill="#d1202f">QR too long</text>`);
    }
  }
  if (d.imageDataUrl && /^data:image\//.test(d.imageDataUrl)) {
    parts.push(`<image x="20" y="156" width="360" height="64" preserveAspectRatio="xMidYMid meet" href="${esc(d.imageDataUrl)}"/>`);
  }
  if (d.nfcUrl) parts.push(`<text x="${W - 12}" y="232" font-size="10" text-anchor="end" fill="#111" font-family="Arial, Helvetica, sans-serif">NFC ◉</text>`);
  // footer：ID 條碼 + 文字
  parts.push(`<line x1="0" y1="238" x2="${W}" y2="238" stroke="#111" stroke-width="1"/>`);
  try {
    const bars = svgBars(l.barcode, { module: 1.6, height: 34, y: 244 });
    const x = (W - bars.width) / 2;
    parts.push(`<g transform="translate(${x.toFixed(1)},0)">${bars.svg}</g>`);
  } catch {}
  parts.push(`<text x="${W / 2}" y="293" font-size="12" text-anchor="middle" fill="#111" font-family="Menlo, Consolas, monospace">${esc(l.barcode)}</text>`);
  if (l.shownOverlay) parts.push(`<image x="0" y="0" width="${W}" height="${H}" preserveAspectRatio="none" href="${esc(l.shownOverlay)}"/>`);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">${parts.join('')}</svg>`;
}

// ---------------------------------------------------------------- app
const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '10mb' }));
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});
app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') return reply(req, res, 400, { success: false, message: 'Invalid JSON body' });
  next(err);
});

function auth(req, res, next) {
  const m = String(req.headers.authorization || '').match(/^Bearer\s+(.+)$/i);
  const t = m && tokens.get(m[1].trim());
  if (!t || t.exp < Date.now()) return reply(req, res, 401, { success: false, message: 'Unauthorized' });
  req.team = t.teamId;
  next();
}

async function applyFault(req, res, barcode) {
  const f = faults.get(barcode);
  if (f === 'http500') {
    reply(req, res, 500, { success: false, message: 'Internal Server Error (simulated)' });
    return true;
  }
  if (f === 'timeout') {
    addLog(req, 0, { note: 'no response (simulated timeout)' });
    return true; // 永不回應
  }
  return false;
}

app.post('/api/ws26/login', (req, res) => {
  const { teamId, password } = req.body || {};
  if (!teamId || !password) return reply(req, res, 400, { success: false, message: 'teamId and password are required' });
  const known = Object.keys(TEAMS).length > 0;
  if (known && TEAMS[teamId] !== password) return reply(req, res, 401, { success: false, message: 'Invalid credentials' });
  const token = crypto.randomBytes(24).toString('hex');
  tokens.set(token, { teamId, exp: Date.now() + 24 * 3600 * 1000 });
  req.team = teamId;
  reply(req, res, 200, { token });
});

app.put('/api/ws26/labels/:barcode', auth, async (req, res) => {
  const l = getLabel(req.params.barcode, true);
  if (!l) return reply(req, res, 404, { success: false, message: 'Label not found' });
  if (await applyFault(req, res, l.barcode)) return;
  const b = req.body || {};
  for (const k of ['messageTextColor', 'messageBackgroundColor'])
    if (b[k] && !COLORS.includes(b[k])) return reply(req, res, 400, { success: false, message: `${k} must be one of black/red/white` });
  if (b.imageDataUrl && !/^data:image\/(png|jpeg|jpg|bmp|gif);base64,/.test(b.imageDataUrl))
    return reply(req, res, 400, { success: false, message: 'imageDataUrl must be a base64 data URL' });
  const next = MERGE ? { ...l.data } : Object.fromEntries(FIELDS.map((f) => [f, '']));
  for (const f of FIELDS) if (typeof b[f] === 'string') next[f] = b[f];
  l.data = next;
  l.writes++;
  l.lastTeam = req.team;
  scheduleRefresh(l);
  reply(req, res, 200, { success: true, message: 'Data successfully sent to the API' });
});

app.post('/api/ws26/labels/:barcode/overlay', auth, async (req, res) => {
  const l = getLabel(req.params.barcode, true);
  if (!l) return reply(req, res, 404, { success: false, message: 'Label not found' });
  if (await applyFault(req, res, l.barcode)) return;
  const img = (req.body || {}).imageDataUrl;
  if (!img || !/^data:image\//.test(img)) return reply(req, res, 400, { success: false, message: 'imageDataUrl is required' });
  // 與實機相同：必須先成功寫入過一次，overlay 才會生效（大會 Module D Task Update）
  if (!l.writes) return reply(req, res, 409, { success: false, message: 'Overlay requires a successful label write first' });
  l.overlay = img;
  l.lastTeam = req.team;
  scheduleRefresh(l);
  reply(req, res, 200, { success: true });
});

app.delete('/api/ws26/labels/:barcode/overlay', auth, async (req, res) => {
  const l = getLabel(req.params.barcode, false);
  if (!l) return reply(req, res, 404, { success: false, message: 'Label not found' });
  if (await applyFault(req, res, l.barcode)) return;
  l.overlay = null;
  scheduleRefresh(l);
  reply(req, res, 200, { success: true });
});

// ---------------------------------------------------------------- simulator UI / control
app.get('/sim/events', (req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  res.write('retry: 2000\n\n');
  clients.add(res);
  const ping = setInterval(() => res.write(': ping\n\n'), 25000);
  req.on('close', () => {
    clearInterval(ping);
    clients.delete(res);
  });
});

app.get('/sim/api/state', (req, res) => {
  res.json({ refreshMs: REFRESH_MS, merge: MERGE, strict: STRICT, teams: Object.keys(TEAMS), labels: [...labels.values()].map(view), log: log.slice(0, 50) });
});

app.post('/sim/api/labels', (req, res) => {
  const id = String((req.body || {}).barcode || '').trim();
  if (!/^[\x20-\x7e]{1,40}$/.test(id)) return res.status(400).json({ error: 'ID 只能是 ASCII 1–40 字元' });
  if (!labels.has(id)) labels.set(id, blankLabel(id));
  push('label', view(labels.get(id)));
  res.json({ ok: true });
});

app.delete('/sim/api/labels/:barcode', (req, res) => {
  labels.delete(req.params.barcode);
  faults.delete(req.params.barcode);
  push('reload', {});
  res.json({ ok: true });
});

// 回到「Welcome」初始畫面
app.post('/sim/api/labels/:barcode/reset', (req, res) => {
  const l = labels.get(req.params.barcode);
  if (!l) return res.status(404).json({ error: 'not found' });
  Object.assign(l, blankLabel(l.barcode));
  push('label', view(l));
  res.json({ ok: true });
});

// 故障注入：http500 / timeout / norefresh / none
app.post('/sim/api/labels/:barcode/fault', (req, res) => {
  const mode = (req.body || {}).mode;
  if (!mode || mode === 'none') faults.delete(req.params.barcode);
  else if (['http500', 'timeout', 'norefresh'].includes(mode)) faults.set(req.params.barcode, mode);
  else return res.status(400).json({ error: 'mode = none | http500 | timeout | norefresh' });
  const l = labels.get(req.params.barcode);
  if (l) push('label', view(l));
  res.json({ ok: true });
});

app.get('/label/:barcode.svg', async (req, res) => {
  const l = labels.get(req.params.barcode);
  if (!l) return res.status(404).send('not found');
  res.type('image/svg+xml').send(await renderSVG(l));
});

app.get('/label/:barcode', (req, res) => res.sendFile(require('path').join(__dirname, 'label.html')));
app.get('/', (req, res) => res.sendFile(require('path').join(__dirname, 'index.html')));

if (require.main === module) {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`eInk API 模擬器 → http://localhost:${PORT}/api/ws26/   虛擬標籤看板 → http://localhost:${PORT}/`);
    console.log(`  刷新延遲 ${REFRESH_MS} ms；PUT ${MERGE ? '只覆蓋有傳的欄位' : '整筆取代'}；帳號 ${Object.keys(TEAMS).length ? Object.keys(TEAMS).join(', ') : '任意（未設定 EINK_TEAMS）'}`);
  });
}

module.exports = { app, renderSVG, labels };
