// 以單一 JSON 檔保存全部資料；寫入採「先寫暫存檔再 rename」避免斷電毀檔。
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, '..', 'uploads');

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

function id(prefix = '') {
  return prefix + crypto.randomBytes(6).toString('hex');
}

function hashPassword(password, salt = crypto.randomBytes(8).toString('hex')) {
  const hash = crypto.scryptSync(String(password), salt, 32).toString('hex');
  return { salt, hash };
}

function checkPassword(password, rec) {
  if (!rec || !rec.salt || !rec.hash) return false;
  const { hash } = hashPassword(password, rec.salt);
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(rec.hash, 'hex'));
}

function defaultModules() {
  return [
    { key: 'FD', name: 'Familarization Day', day: 'C-2', title: 'Familarization Day' },
    { key: 'A', name: 'Module A', day: 'C1', title: 'Module A Test Project' },
    { key: 'B', name: 'Module B', day: 'C2', title: 'Module B Test Project' },
    { key: 'C', name: 'Module C', day: 'C3', title: 'Module C Test Project' },
    { key: 'D', name: 'Module D', day: 'C4', title: 'Module D Test Project' },
  ].map((m, i) => ({
    id: id('m_'),
    order: i,
    description: '',
    descriptionZh: '',
    released: false,
    questionsOpen: true,
    ...m,
  }));
}

function defaults() {
  return {
    settings: {
      eventName: 'WorldSkills 2026',
      eventPlace: 'Shanghai, China',
      systemName: 'WSCCS',
      version: '2.1.2-trainer',
      translationLabel: 'TW:ZHO',
      welcomeText: 'Welcome to WSCCS',
      admin: null, // { salt, hash }；null 代表使用環境變數 ADMIN_PASSWORD 或預設 admin
    },
    features: {
      tasksPage: true, // 選手可看 Tasks 頁
      docsPage: true, // 選手可看 Documentation 頁
      questions: true, // 全域：允許提問
      questionsOnlyWhenRunning: false, // 只有計時器運轉時才能提問
      showOtherTeamsQA: true, // 已回答且公開的他隊問答對所有隊伍可見
      translations: true, // 顯示 All Translations 切換
      notifySound: true, // 新回覆 / 新公告提示音
      readMarks: true, // Read 勾選欄
      downloads: true, // 允許下載檔案
    },
    timer: { state: 'stopped', startedAt: null, accumulatedMs: 0, durationMs: 0, label: '' },
    teams: [],
    modules: defaultModules(),
    files: [],
    updates: [],
    questions: [],
    reads: {},
    notifications: [],
  };
}

let db = null;
let saveTimer = null;

function load() {
  if (fs.existsSync(DB_FILE)) {
    const raw = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    const base = defaults();
    db = {
      ...base,
      ...raw,
      settings: { ...base.settings, ...(raw.settings || {}) },
      features: { ...base.features, ...(raw.features || {}) },
      timer: { ...base.timer, ...(raw.timer || {}) },
    };
  } else {
    db = defaults();
    saveNow();
  }
  return db;
}

function saveNow() {
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DB_FILE);
}

function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 150);
}

function replace(next) {
  db = next;
  saveNow();
  return db;
}

function get() {
  return db || load();
}

module.exports = {
  DATA_DIR,
  DB_FILE,
  UPLOAD_DIR,
  id,
  hashPassword,
  checkPassword,
  defaults,
  defaultModules,
  load,
  save,
  saveNow,
  replace,
  get,
};
