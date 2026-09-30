// WSCCS Trainer — 選手端 + 裁判後台
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const store = require('./lib/store');

const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || '0.0.0.0';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin';

store.load();
const db = () => store.get();

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '20mb' }));

// ---------------------------------------------------------------- sessions
function ensureSessions() {
  if (!db().sessions) db().sessions = {};
  return db().sessions;
}

function parseCookies(req) {
  const out = {};
  (req.headers.cookie || '').split(';').forEach((c) => {
    const i = c.indexOf('=');
    if (i > 0) out[c.slice(0, i).trim()] = decodeURIComponent(c.slice(i + 1).trim());
  });
  return out;
}

function createSession(res, data, cookieName) {
  const sid = crypto.randomBytes(24).toString('hex');
  ensureSessions()[sid] = { ...data, createdAt: Date.now() };
  store.save();
  res.setHeader('Set-Cookie', `${cookieName}=${sid}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60 * 60 * 24 * 14}`);
}

function readSession(req, cookieName) {
  const sid = parseCookies(req)[cookieName];
  if (!sid) return null;
  const s = ensureSessions()[sid];
  return s ? { sid, ...s } : null;
}

function destroySession(req, res, cookieName) {
  const sid = parseCookies(req)[cookieName];
  if (sid) delete ensureSessions()[sid];
  store.save();
  res.setHeader('Set-Cookie', `${cookieName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

function teamAuth(req, res, next) {
  const s = readSession(req, 'wsccs_team');
  const team = s && db().teams.find((t) => t.id === s.teamId);
  if (!team) return res.status(401).json({ error: '請先登入' });
  req.team = team;
  next();
}

function adminAuth(req, res, next) {
  const s = readSession(req, 'wsccs_admin');
  if (!s || s.role !== 'admin') return res.status(401).json({ error: '需要管理員登入' });
  next();
}

function optionalAdmin(req) {
  const s = readSession(req, 'wsccs_admin');
  return !!(s && s.role === 'admin');
}

// ---------------------------------------------------------------- realtime (SSE)
const clients = new Set();

app.get('/api/events', (req, res) => {
  const teamS = readSession(req, 'wsccs_team');
  const isAdmin = optionalAdmin(req);
  if (!teamS && !isAdmin) return res.status(401).end();
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write('retry: 3000\n\n');
  const client = { res, teamId: teamS ? teamS.teamId : null, isAdmin };
  clients.add(client);
  const ping = setInterval(() => res.write(': ping\n\n'), 25000);
  req.on('close', () => {
    clearInterval(ping);
    clients.delete(client);
  });
});

// opts.teamId: 只推給該隊（與管理員）；opts.adminOnly
function broadcast(type, payload = {}, opts = {}) {
  const msg = `event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const c of clients) {
    if (opts.adminOnly && !c.isAdmin) continue;
    if (opts.teamId && !c.isAdmin && c.teamId !== opts.teamId) continue;
    c.res.write(msg);
  }
}

function notify(type, text, extra = {}, opts = {}) {
  const n = { id: store.id('n_'), ts: Date.now(), type, text, teamId: opts.teamId || null, ...extra };
  db().notifications.unshift(n);
  db().notifications = db().notifications.slice(0, 300);
  store.save();
  broadcast('notify', n, opts);
  return n;
}

// ---------------------------------------------------------------- helpers
const langLabel = (lang) =>
  ({ en: 'ENGLISH', 'zh-hant': 'TW:ZHO', zh: 'ZHO' }[lang] || String(lang || 'OTHER').toUpperCase());

function publicFile(f) {
  return { id: f.id, name: f.name, lang: f.lang, langLabel: langLabel(f.lang), size: f.size, uploadedAt: f.uploadedAt };
}

function sortModules(list) {
  return [...list].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

function questionsAllowed(mod) {
  const { features, timer } = db();
  if (!features.questions || !mod.questionsOpen || !mod.released) return false;
  if (features.questionsOnlyWhenRunning && timer.state !== 'running') return false;
  return true;
}

function teamView(team) {
  return team && { id: team.id, code: team.code, name: team.name, flag: team.flag || '' };
}

function questionView(q, forTeam) {
  const team = db().teams.find((t) => t.id === q.teamId);
  return {
    id: q.id,
    moduleId: q.moduleId,
    team: team ? teamView(team) : { code: q.teamCode || '—', name: q.teamName || '', flag: q.teamFlag || '' },
    mine: !!forTeam && q.teamId === forTeam.id,
    text: q.text,
    textZh: q.textZh || '',
    answerEn: q.answerEn || '',
    answerZh: q.answerZh || '',
    status: q.status,
    public: q.public !== false,
    createdAt: q.createdAt,
    updatedAt: q.updatedAt || q.createdAt,
  };
}

function visibleQuestions(mod, team) {
  const { questions, features } = db();
  return questions.filter(
    (q) =>
      q.moduleId === mod.id &&
      (q.teamId === team.id || (features.showOtherTeamsQA && q.status === 'answered' && q.public !== false))
  );
}

function unreadCount(mod, team) {
  if (!db().features.readMarks) return 0;
  const reads = db().reads[team.id] || {};
  const u = db().updates.filter((x) => x.moduleId === mod.id && x.published !== false && !reads['u:' + x.id]).length;
  const q = visibleQuestions(mod, team).filter((x) => x.status === 'answered' && !reads['q:' + x.id]).length;
  return u + q;
}

function canTeamSeeModule(mod) {
  return mod && mod.released && db().features.tasksPage;
}

// ---------------------------------------------------------------- auth routes
app.post('/api/login', (req, res) => {
  const { code, password } = req.body || {};
  const team = db().teams.find((t) => t.code.toLowerCase() === String(code || '').trim().toLowerCase());
  if (!team || !store.checkPassword(password || '', team.password)) {
    return res.status(401).json({ error: '隊伍代碼或密碼錯誤 / Invalid team code or password' });
  }
  createSession(res, { role: 'team', teamId: team.id }, 'wsccs_team');
  res.json({ ok: true, team: teamView(team) });
});

app.post('/api/logout', (req, res) => {
  destroySession(req, res, 'wsccs_team');
  res.json({ ok: true });
});

app.post('/api/admin/login', (req, res) => {
  const { password } = req.body || {};
  const rec = db().settings.admin;
  const ok = rec ? store.checkPassword(password || '', rec) : String(password || '') === ADMIN_PASSWORD;
  if (!ok) return res.status(401).json({ error: '密碼錯誤' });
  createSession(res, { role: 'admin' }, 'wsccs_admin');
  res.json({ ok: true });
});

app.post('/api/admin/logout', (req, res) => {
  destroySession(req, res, 'wsccs_admin');
  res.json({ ok: true });
});

// ---------------------------------------------------------------- competitor API
app.get('/api/public', (req, res) => {
  // 登入前可見的最少資訊（首頁標題）
  const { settings } = db();
  res.json({
    settings: {
      eventName: settings.eventName,
      eventPlace: settings.eventPlace,
      systemName: settings.systemName,
      version: settings.version,
      welcomeText: settings.welcomeText,
    },
    serverNow: Date.now(),
  });
});

app.get('/api/state', teamAuth, (req, res) => {
  const { settings, features, timer, modules } = db();
  const visible = features.tasksPage ? sortModules(modules).filter((m) => m.released) : [];
  res.json({
    serverNow: Date.now(),
    me: teamView(req.team),
    settings: {
      eventName: settings.eventName,
      eventPlace: settings.eventPlace,
      systemName: settings.systemName,
      version: settings.version,
      translationLabel: settings.translationLabel,
      welcomeText: settings.welcomeText,
    },
    features,
    timer,
    modules: visible.map((m) => ({ id: m.id, key: m.key, name: m.name, day: m.day, unread: unreadCount(m, req.team) })),
    // 尚未開放的模組也列出名稱（灰色按鈕），比照原系統固定出現 5 顆按鈕
    allModules: sortModules(modules).map((m) => ({ id: m.id, name: m.name, day: m.day, released: !!m.released })),
  });
});

app.get('/api/modules/:id', teamAuth, (req, res) => {
  const mod = db().modules.find((m) => m.id === req.params.id);
  if (!canTeamSeeModule(mod)) return res.status(404).json({ error: '此模組尚未開放' });
  const { files, updates } = db();
  const reads = db().reads[req.team.id] || {};
  const upd = updates
    .filter((u) => u.moduleId === mod.id && u.published !== false)
    .sort((a, b) => b.createdAt - a.createdAt)
    .map((u) => ({
      id: u.id,
      textEn: u.textEn,
      textZh: u.textZh,
      createdAt: u.createdAt,
      files: files.filter((f) => f.kind === 'update' && f.updateId === u.id).map(publicFile),
      read: !!reads['u:' + u.id],
    }));
  const qs = visibleQuestions(mod, req.team)
    .sort((a, b) => (b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt))
    .map((q) => ({ ...questionView(q, req.team), read: !!reads['q:' + q.id] }));
  res.json({
    module: {
      id: mod.id,
      key: mod.key,
      name: mod.name,
      day: mod.day,
      title: mod.title,
      description: mod.description,
      descriptionZh: mod.descriptionZh,
      questionsAllowed: questionsAllowed(mod),
    },
    briefingFiles: files.filter((f) => f.moduleId === mod.id && f.kind === 'briefing').map(publicFile),
    taskFiles: files.filter((f) => f.moduleId === mod.id && f.kind === 'task').map(publicFile),
    updates: upd,
    questions: qs,
  });
});

app.post('/api/modules/:id/questions', teamAuth, (req, res) => {
  const mod = db().modules.find((m) => m.id === req.params.id);
  if (!canTeamSeeModule(mod)) return res.status(404).json({ error: '此模組尚未開放' });
  if (!questionsAllowed(mod)) return res.status(403).json({ error: '目前不開放提問 / Questions are closed' });
  const text = String((req.body || {}).text || '').trim();
  if (!text) return res.status(400).json({ error: '問題不可空白' });
  if (text.length > 4000) return res.status(400).json({ error: '問題太長' });
  const now = Date.now();
  const q = {
    id: store.id('q_'),
    moduleId: mod.id,
    teamId: req.team.id,
    teamCode: req.team.code,
    text,
    textZh: '',
    answerEn: '',
    answerZh: '',
    status: 'open',
    public: true,
    createdAt: now,
    updatedAt: now,
  };
  db().questions.push(q);
  store.save();
  broadcast('question', { id: q.id, moduleId: mod.id, teamCode: req.team.code, text }, { adminOnly: true });
  broadcast('module-changed', { moduleId: mod.id }, { teamId: req.team.id });
  res.json({ ok: true, question: questionView(q, req.team) });
});

app.post('/api/read', teamAuth, (req, res) => {
  if (!db().features.readMarks) return res.status(403).json({ error: 'Read 功能已關閉' });
  const { key, read } = req.body || {};
  if (!/^[uq]:[a-z0-9_]+$/i.test(String(key || ''))) return res.status(400).json({ error: 'bad key' });
  const r = (db().reads[req.team.id] = db().reads[req.team.id] || {});
  if (read) r[key] = Date.now();
  else delete r[key];
  store.save();
  res.json({ ok: true });
});

app.get('/api/docs', teamAuth, (req, res) => {
  if (!db().features.docsPage) return res.status(403).json({ error: 'Documentation 已關閉' });
  res.json({ files: db().files.filter((f) => f.kind === 'doc').map(publicFile) });
});

app.get('/api/notifications', teamAuth, (req, res) => {
  res.json({
    notifications: db()
      .notifications.filter((n) => !n.teamId || n.teamId === req.team.id)
      .slice(0, 100),
  });
});

app.get('/api/files/:id', (req, res) => {
  const f = db().files.find((x) => x.id === req.params.id);
  if (!f) return res.status(404).end();
  const isAdmin = optionalAdmin(req);
  if (!isAdmin) {
    const s = readSession(req, 'wsccs_team');
    if (!s || !db().teams.find((t) => t.id === s.teamId)) return res.status(401).end();
    if (!db().features.downloads) return res.status(403).send('Downloads are disabled');
    if (f.kind === 'doc') {
      if (!db().features.docsPage) return res.status(403).end();
    } else {
      const mod = db().modules.find((m) => m.id === f.moduleId);
      if (!canTeamSeeModule(mod)) return res.status(403).end();
      if (f.kind === 'update') {
        const u = db().updates.find((x) => x.id === f.updateId);
        if (!u || u.published === false) return res.status(403).end();
      }
    }
  }
  const p = path.join(store.UPLOAD_DIR, f.stored);
  if (!fs.existsSync(p)) return res.status(410).send('File missing on server');
  res.download(p, f.name);
});

// ---------------------------------------------------------------- admin API
const upload = multer({
  storage: multer.diskStorage({
    destination: store.UPLOAD_DIR,
    filename: (req, file, cb) => cb(null, store.id('f_') + path.extname(file.originalname).slice(0, 12)),
  }),
  limits: { fileSize: 1024 * 1024 * 1024 },
});

// multer 以 latin1 解析檔名，轉回 UTF-8 以支援中文檔名
const fixName = (n) => {
  try {
    return Buffer.from(n, 'latin1').toString('utf8');
  } catch {
    return n;
  }
};

function guessLang(name) {
  const n = name.toLowerCase();
  if (n.startsWith('zh_hant_') || /[_-]zh[-_]?(tw|hant)\b/.test(n)) return 'zh-hant';
  if (n.startsWith('zh_') || /[_-]zh[-_]?(cn|hans)\b/.test(n)) return 'zh';
  return 'en';
}

app.get('/api/admin/state', adminAuth, (req, res) => {
  const d = db();
  const { admin, ...settings } = d.settings;
  res.json({
    serverNow: Date.now(),
    settings: { ...settings, adminPasswordSet: !!admin },
    features: d.features,
    timer: d.timer,
    teams: d.teams.map((t) => ({ ...teamView(t), hasPassword: !!t.password })),
    modules: sortModules(d.modules),
    files: d.files,
    updates: [...d.updates].sort((a, b) => b.createdAt - a.createdAt),
    questions: [...d.questions]
      .sort((a, b) => (a.status === b.status ? b.createdAt - a.createdAt : a.status === 'open' ? -1 : 1))
      .map((q) => ({ ...questionView(q), teamId: q.teamId })),
    notifications: d.notifications.slice(0, 50),
    online: [...clients].filter((c) => !c.isAdmin).map((c) => c.teamId),
    reads: d.reads,
  });
});

app.put('/api/admin/settings', adminAuth, (req, res) => {
  const allowed = ['eventName', 'eventPlace', 'systemName', 'version', 'translationLabel', 'welcomeText'];
  for (const k of allowed) if (typeof req.body[k] === 'string') db().settings[k] = req.body[k];
  if (req.body.newAdminPassword) db().settings.admin = store.hashPassword(req.body.newAdminPassword);
  store.save();
  broadcast('state-changed');
  res.json({ ok: true });
});

app.put('/api/admin/features', adminAuth, (req, res) => {
  for (const k of Object.keys(db().features)) if (typeof req.body[k] === 'boolean') db().features[k] = req.body[k];
  store.save();
  broadcast('state-changed');
  res.json({ ok: true, features: db().features });
});

app.post('/api/admin/timer', adminAuth, (req, res) => {
  const t = db().timer;
  const now = Date.now();
  const { action, durationMs, label } = req.body || {};
  if (typeof durationMs === 'number' && durationMs >= 0) t.durationMs = durationMs;
  if (typeof label === 'string') t.label = label;
  if (action === 'start' && t.state !== 'running') {
    t.state = 'running';
    t.startedAt = now;
  } else if (action === 'pause' && t.state === 'running') {
    t.accumulatedMs += now - t.startedAt;
    t.startedAt = null;
    t.state = 'paused';
  } else if (action === 'reset') {
    t.state = 'stopped';
    t.startedAt = null;
    t.accumulatedMs = 0;
  } else if (action === 'adjust' && typeof req.body.deltaMs === 'number') {
    t.accumulatedMs = Math.max(0, t.accumulatedMs + req.body.deltaMs);
  }
  store.save();
  broadcast('timer', { timer: t, serverNow: now });
  res.json({ ok: true, timer: t });
});

// modules
app.post('/api/admin/modules', adminAuth, (req, res) => {
  const b = req.body || {};
  const m = {
    id: store.id('m_'),
    key: b.key || '',
    name: b.name || 'New Module',
    day: b.day || '',
    title: b.title || b.name || '',
    description: b.description || '',
    descriptionZh: b.descriptionZh || '',
    released: false,
    questionsOpen: true,
    order: db().modules.length,
  };
  db().modules.push(m);
  store.save();
  res.json({ ok: true, module: m });
});

app.put('/api/admin/modules/:id', adminAuth, (req, res) => {
  const m = db().modules.find((x) => x.id === req.params.id);
  if (!m) return res.status(404).json({ error: 'not found' });
  const wasReleased = m.released;
  for (const k of ['key', 'name', 'day', 'title', 'description', 'descriptionZh'])
    if (typeof req.body[k] === 'string') m[k] = req.body[k];
  for (const k of ['released', 'questionsOpen']) if (typeof req.body[k] === 'boolean') m[k] = req.body[k];
  if (typeof req.body.order === 'number') m.order = req.body.order;
  store.save();
  if (!wasReleased && m.released) notify('release', `${m.name} is now available.`, { moduleId: m.id });
  broadcast('state-changed');
  broadcast('module-changed', { moduleId: m.id });
  res.json({ ok: true, module: m });
});

app.delete('/api/admin/modules/:id', adminAuth, (req, res) => {
  const d = db();
  const mid = req.params.id;
  d.files
    .filter((f) => f.moduleId === mid)
    .forEach((f) => fs.rmSync(path.join(store.UPLOAD_DIR, f.stored), { force: true }));
  d.files = d.files.filter((f) => f.moduleId !== mid);
  d.updates = d.updates.filter((u) => u.moduleId !== mid);
  d.questions = d.questions.filter((q) => q.moduleId !== mid);
  d.modules = d.modules.filter((m) => m.id !== mid);
  store.save();
  broadcast('state-changed');
  res.json({ ok: true });
});

// files: kind = briefing | task | update | doc
app.post('/api/admin/files', adminAuth, upload.array('files', 50), (req, res) => {
  const { moduleId = null, kind = 'task', lang, updateId = null } = req.body || {};
  if (!['briefing', 'task', 'update', 'doc'].includes(kind)) return res.status(400).json({ error: 'bad kind' });
  const added = (req.files || []).map((file) => {
    const name = fixName(file.originalname);
    const f = {
      id: store.id('f_'),
      moduleId: kind === 'doc' ? null : moduleId,
      kind,
      updateId: kind === 'update' ? updateId : null,
      lang: lang && lang !== 'auto' ? lang : guessLang(name),
      name,
      stored: file.filename,
      size: file.size,
      uploadedAt: Date.now(),
    };
    db().files.push(f);
    return f;
  });
  store.save();
  broadcast('module-changed', { moduleId });
  res.json({ ok: true, files: added });
});

app.put('/api/admin/files/:id', adminAuth, (req, res) => {
  const f = db().files.find((x) => x.id === req.params.id);
  if (!f) return res.status(404).json({ error: 'not found' });
  if (typeof req.body.name === 'string' && req.body.name.trim()) f.name = req.body.name.trim();
  if (typeof req.body.lang === 'string') f.lang = req.body.lang;
  if (typeof req.body.kind === 'string' && ['briefing', 'task', 'doc'].includes(req.body.kind)) f.kind = req.body.kind;
  store.save();
  broadcast('module-changed', { moduleId: f.moduleId });
  res.json({ ok: true, file: f });
});

app.delete('/api/admin/files/:id', adminAuth, (req, res) => {
  const f = db().files.find((x) => x.id === req.params.id);
  if (!f) return res.status(404).json({ error: 'not found' });
  fs.rmSync(path.join(store.UPLOAD_DIR, f.stored), { force: true });
  db().files = db().files.filter((x) => x.id !== f.id);
  store.save();
  broadcast('module-changed', { moduleId: f.moduleId });
  res.json({ ok: true });
});

// task updates
app.post('/api/admin/updates', adminAuth, (req, res) => {
  const { moduleId, textEn = '', textZh = '', published = true } = req.body || {};
  const mod = db().modules.find((m) => m.id === moduleId);
  if (!mod) return res.status(400).json({ error: '請選擇模組' });
  if (!textEn.trim() && !textZh.trim()) return res.status(400).json({ error: '內容不可空白' });
  const u = { id: store.id('u_'), moduleId, textEn, textZh, published: !!published, createdAt: Date.now() };
  db().updates.push(u);
  store.save();
  if (u.published && mod.released) notify('update', `New task update in ${mod.name}`, { moduleId, preview: textEn || textZh });
  broadcast('module-changed', { moduleId });
  res.json({ ok: true, update: u });
});

app.put('/api/admin/updates/:id', adminAuth, (req, res) => {
  const u = db().updates.find((x) => x.id === req.params.id);
  if (!u) return res.status(404).json({ error: 'not found' });
  const wasPublished = u.published !== false;
  for (const k of ['textEn', 'textZh']) if (typeof req.body[k] === 'string') u[k] = req.body[k];
  if (typeof req.body.published === 'boolean') u.published = req.body.published;
  if (req.body.bumpTime) u.createdAt = Date.now();
  store.save();
  const mod = db().modules.find((m) => m.id === u.moduleId);
  if (!wasPublished && u.published && mod && mod.released)
    notify('update', `New task update in ${mod.name}`, { moduleId: mod.id, preview: u.textEn || u.textZh });
  broadcast('module-changed', { moduleId: u.moduleId });
  res.json({ ok: true, update: u });
});

app.delete('/api/admin/updates/:id', adminAuth, (req, res) => {
  const u = db().updates.find((x) => x.id === req.params.id);
  if (!u) return res.status(404).json({ error: 'not found' });
  db()
    .files.filter((f) => f.updateId === u.id)
    .forEach((f) => fs.rmSync(path.join(store.UPLOAD_DIR, f.stored), { force: true }));
  db().files = db().files.filter((f) => f.updateId !== u.id);
  db().updates = db().updates.filter((x) => x.id !== u.id);
  store.save();
  broadcast('module-changed', { moduleId: u.moduleId });
  res.json({ ok: true });
});

// questions
app.put('/api/admin/questions/:id', adminAuth, (req, res) => {
  const q = db().questions.find((x) => x.id === req.params.id);
  if (!q) return res.status(404).json({ error: 'not found' });
  const hadAnswer = q.status === 'answered';
  for (const k of ['text', 'textZh', 'answerEn', 'answerZh']) if (typeof req.body[k] === 'string') q[k] = req.body[k];
  if (typeof req.body.public === 'boolean') q.public = req.body.public;
  if (typeof req.body.moduleId === 'string' && db().modules.find((m) => m.id === req.body.moduleId))
    q.moduleId = req.body.moduleId;
  const answered = !!(q.answerEn.trim() || q.answerZh.trim());
  q.status = answered ? 'answered' : 'open';
  q.updatedAt = Date.now();
  if (answered) q.answeredAt = q.answeredAt || Date.now();
  store.save();
  const mod = db().modules.find((m) => m.id === q.moduleId);
  if (answered && !hadAnswer) {
    // 提問隊伍一定收到；公開時所有隊伍收到
    notify(
      'answer',
      `New answer in ${mod ? mod.name : ''}`,
      { moduleId: q.moduleId, preview: q.answerEn || q.answerZh, questionId: q.id },
      q.public !== false && db().features.showOtherTeamsQA ? {} : { teamId: q.teamId }
    );
  }
  broadcast('module-changed', { moduleId: q.moduleId });
  res.json({ ok: true, question: questionView(q) });
});

// 管理員自行新增一則問答（例如口頭提問轉登錄、或匯入）
app.post('/api/admin/questions', adminAuth, (req, res) => {
  const b = req.body || {};
  const mod = db().modules.find((m) => m.id === b.moduleId);
  if (!mod) return res.status(400).json({ error: '請選擇模組' });
  const team = db().teams.find((t) => t.id === b.teamId);
  const now = Date.now();
  const q = {
    id: store.id('q_'),
    moduleId: mod.id,
    teamId: team ? team.id : null,
    teamCode: team ? team.code : b.teamCode || '—',
    text: b.text || '',
    textZh: b.textZh || '',
    answerEn: b.answerEn || '',
    answerZh: b.answerZh || '',
    public: b.public !== false,
    createdAt: now,
    updatedAt: now,
  };
  q.status = q.answerEn || q.answerZh ? 'answered' : 'open';
  db().questions.push(q);
  store.save();
  if (q.status === 'answered' && mod.released)
    notify('answer', `New answer in ${mod.name}`, { moduleId: mod.id, preview: q.answerEn || q.answerZh, questionId: q.id });
  broadcast('module-changed', { moduleId: mod.id });
  res.json({ ok: true, question: questionView(q) });
});

app.delete('/api/admin/questions/:id', adminAuth, (req, res) => {
  const q = db().questions.find((x) => x.id === req.params.id);
  db().questions = db().questions.filter((x) => x.id !== req.params.id);
  store.save();
  if (q) broadcast('module-changed', { moduleId: q.moduleId });
  res.json({ ok: true });
});

// teams
app.post('/api/admin/teams', adminAuth, (req, res) => {
  const { code, name = '', flag = '', password } = req.body || {};
  if (!code || !password) return res.status(400).json({ error: '代碼與密碼必填' });
  if (db().teams.find((t) => t.code.toLowerCase() === code.toLowerCase()))
    return res.status(400).json({ error: '代碼已存在' });
  const t = { id: store.id('t_'), code: code.trim(), name, flag, password: store.hashPassword(password) };
  db().teams.push(t);
  store.save();
  res.json({ ok: true, team: teamView(t) });
});

app.put('/api/admin/teams/:id', adminAuth, (req, res) => {
  const t = db().teams.find((x) => x.id === req.params.id);
  if (!t) return res.status(404).json({ error: 'not found' });
  for (const k of ['code', 'name', 'flag']) if (typeof req.body[k] === 'string') t[k] = req.body[k];
  if (req.body.password) t.password = store.hashPassword(req.body.password);
  store.save();
  res.json({ ok: true, team: teamView(t) });
});

app.delete('/api/admin/teams/:id', adminAuth, (req, res) => {
  db().teams = db().teams.filter((x) => x.id !== req.params.id);
  delete db().reads[req.params.id];
  for (const [sid, s] of Object.entries(ensureSessions())) if (s.teamId === req.params.id) delete ensureSessions()[sid];
  store.save();
  res.json({ ok: true });
});

app.post('/api/admin/teams/:id/reset-reads', adminAuth, (req, res) => {
  delete db().reads[req.params.id];
  store.save();
  res.json({ ok: true });
});

// broadcast message → toast for everyone
app.post('/api/admin/broadcast', adminAuth, (req, res) => {
  const text = String((req.body || {}).text || '').trim();
  if (!text) return res.status(400).json({ error: '訊息不可空白' });
  const team = req.body.teamId ? db().teams.find((t) => t.id === req.body.teamId) : null;
  notify('message', text, {}, team ? { teamId: team.id } : {});
  res.json({ ok: true });
});

app.delete('/api/admin/notifications', adminAuth, (req, res) => {
  db().notifications = [];
  store.save();
  res.json({ ok: true });
});

// backup
app.get('/api/admin/export', adminAuth, (req, res) => {
  const { sessions, ...rest } = db();
  res.setHeader('Content-Disposition', `attachment; filename="wsccs-backup-${Date.now()}.json"`);
  res.json(rest);
});

app.post('/api/admin/import', adminAuth, (req, res) => {
  const incoming = req.body;
  if (!incoming || !Array.isArray(incoming.modules)) return res.status(400).json({ error: '格式錯誤' });
  const base = store.defaults();
  store.replace({
    ...base,
    ...incoming,
    settings: { ...base.settings, ...(incoming.settings || {}), admin: db().settings.admin },
    features: { ...base.features, ...(incoming.features || {}) },
    sessions: db().sessions,
  });
  broadcast('state-changed');
  res.json({ ok: true });
});

app.post('/api/admin/reset-competition', adminAuth, (req, res) => {
  // 清空問答 / Read / 通知，模組回到未開放；保留檔案、隊伍、設定
  const d = db();
  d.questions = [];
  d.reads = {};
  d.notifications = [];
  d.modules.forEach((m) => (m.released = false));
  d.timer = { state: 'stopped', startedAt: null, accumulatedMs: 0, durationMs: d.timer.durationMs, label: '' };
  store.save();
  broadcast('state-changed');
  res.json({ ok: true });
});

// ---------------------------------------------------------------- static
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.use('/api', (req, res) => res.status(404).json({ error: 'not found' }));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: err.message || 'server error' });
});

if (require.main === module) {
  app.listen(PORT, HOST, () => {
    console.log(`WSCCS Trainer 已啟動  選手端 http://localhost:${PORT}/   後台 http://localhost:${PORT}/admin`);
    if (!db().settings.admin && !process.env.ADMIN_PASSWORD)
      console.log('⚠ 後台目前使用預設密碼 admin，請登入後到「設定」修改，或以 ADMIN_PASSWORD 環境變數指定。');
  });
}

module.exports = app;
