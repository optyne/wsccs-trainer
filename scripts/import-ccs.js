#!/usr/bin/env node
/*
 * 匯入「另存新檔」的 WS CCS 頁面（WS CCS1.html、WS CCS2.html…）
 *
 * 用法：
 *   node scripts/import-ccs.js <資料夾> [--date 2026-09-22] [--release] [--no-qa] [--dry-run]
 *
 * <資料夾> 例如從 Google Drive 下載的 worldskills/ 目錄，結構像：
 *   Day A/WS CCS2.html、Day A/wsc2026_tp48_ma_actual_en_xxxx.pdf、Day A/given_data/…
 *
 * 會做的事：
 *   1. 找出所有含 "Task Information" 的 .html，解析出模組名稱、標題、說明、
 *      Briefing / Task Files 檔名、Task Updates（英文 + 翻譯 + 附件）、Q&A（隊伍、問題、回答）。
 *   2. 依模組名稱（Familarization Day / Module A…）更新或建立模組。
 *   3. 在資料夾中尋找同名檔案（自動忽略 Drive 下載時加上的 _xxxxxxxxxx 亂碼尾碼），複製到 uploads/。
 *      同資料夾內 zh_hant_ / zh_ 開頭的翻譯版題本也會一併加入。
 *   4. 預設所有模組匯入後為「未開放」，由後台逐日開放；加 --release 則全部開放。
 * 伺服器執行中也可以匯入，但請匯入後重新啟動伺服器（資料在啟動時載入）。
 */
const fs = require('fs');
const path = require('path');
const { parse } = require('node-html-parser');
const store = require('../lib/store');

const args = process.argv.slice(2);
const root = args.find((a) => !a.startsWith('--'));
const opt = (name) => {
  const i = args.indexOf('--' + name);
  return i >= 0 ? args[i + 1] : null;
};
const flag = (name) => args.includes('--' + name);

if (!root || !fs.existsSync(root)) {
  console.error('用法：node scripts/import-ccs.js <資料夾> [--date YYYY-MM-DD] [--release] [--no-qa] [--dry-run]');
  process.exit(1);
}

const baseDate = opt('date') ? new Date(opt('date') + 'T00:00:00') : new Date(new Date().toDateString());
const DAY_ORDER = { 'Familarization Day': 0, 'Familiarization Day': 0, 'Module A': 1, 'Module B': 2, 'Module C': 3, 'Module D': 4 };
const DAY_LABEL = { 0: 'C-2', 1: 'C1', 2: 'C2', 3: 'C3', 4: 'C4' };

// ------------------------------------------------------------------ helpers
function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

// Drive 另存檔名常見的亂碼尾碼：name_ab12cd34ef.ext
const stripSuffix = (name) => name.replace(/_[a-z0-9]{10}(\.[^.]+)$/i, '$1');
const canon = (name) => stripSuffix(name).toLowerCase();

function langOf(name) {
  const n = name.toLowerCase();
  if (n.startsWith('zh_hant_')) return 'zh-hant';
  if (n.startsWith('zh_')) return 'zh';
  return 'en';
}

const clean = (s) =>
  String(s || '')
    .replace(/ /g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

// 把一段 HTML 轉成保留段落換行的純文字
function htmlToText(node) {
  if (!node) return '';
  const html = node.innerHTML
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h\d)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ');
  return clean(parse(html).textContent);
}

// 上午/下午 hh:mm:ss → timestamp（以 baseDate 當天）
function parseTime(t, dayOffset = 0) {
  const m = String(t || '').match(/(上午|下午|AM|PM)?\s*(\d{1,2}):(\d{2}):(\d{2})\s*(AM|PM)?/i);
  if (!m) return baseDate.getTime() + dayOffset * 86400000;
  let hh = Number(m[2]);
  const ap = (m[1] || m[5] || '').toUpperCase();
  if ((ap === '下午' || ap === 'PM') && hh < 12) hh += 12;
  if ((ap === '上午' || ap === 'AM') && hh === 12) hh = 0;
  const d = new Date(baseDate.getTime() + dayOffset * 86400000);
  d.setHours(hh, Number(m[3]), Number(m[4]), 0);
  return d.getTime();
}

function fieldsetByLegend(doc, title) {
  return doc.querySelectorAll('fieldset').find((f) => {
    const lg = f.querySelector('legend');
    return lg && lg.textContent.trim().replace(/\s+/g, ' ') === title;
  });
}

// 解析一格內的「語言 chip + 文字」組
function chipTexts(cell) {
  const out = [];
  if (!cell) return out;
  for (const row of cell.querySelectorAll('.flex.flex-row.mt-2')) {
    const chip = row.querySelector('.p-chip');
    const txt = row.querySelectorAll(':scope > div')[1];
    if (!chip || !txt) continue;
    out.push({ label: chip.textContent.trim().replace(/\s+/g, ' '), text: htmlToText(txt) });
  }
  return out;
}

function splitLang(pairs) {
  const en = pairs.filter((p) => /^english$/i.test(p.label)).map((p) => p.text);
  const tr = pairs.filter((p) => !/^english$/i.test(p.label)).map((p) => p.text);
  return { en: en.join('\n'), tr: tr.join('\n') };
}

function parsePage(file) {
  const raw = fs.readFileSync(file, 'utf8');
  if (!raw.includes('Task Information')) return null;
  const doc = parse(raw);

  // 目前選中的模組按鈕 = p-button-primary（其他是 p-button-link）
  const tabBtn = doc
    .querySelectorAll('button')
    .find((b) => /p-button-primary/.test(b.getAttribute('class') || '') && /mr-2/.test(b.getAttribute('class') || '') && DAY_ORDER[b.textContent.trim()] !== undefined);
  const info = fieldsetByLegend(doc, 'Task Information');
  const h2 = info && info.querySelector('h2');
  const heading = h2 ? h2.textContent.trim() : '';
  const [namePart, ...titleParts] = heading.split(' : ');
  const name = (tabBtn && tabBtn.textContent.trim()) || namePart.trim();
  const title = titleParts.join(' : ').trim() || name;
  const descNode = h2 && h2.parentNode.querySelector('div');
  const description = htmlToText(descNode);

  const fileNames = (fsNode) =>
    fsNode ? fsNode.querySelectorAll('button[aria-label]').map((b) => b.getAttribute('aria-label')).filter((n) => /\.[a-z0-9]{1,6}$/i.test(n)) : [];
  const briefing = fileNames(fieldsetByLegend(doc, 'Briefing Files'));
  const task = fileNames(fieldsetByLegend(doc, 'Task Files'));

  // 自己隊伍：右上角 avatar
  const avatar = doc.querySelector('.p-avatar img');
  const myFlag = avatar ? path.basename(avatar.getAttribute('src') || '') : '';
  const myCode = (doc.querySelector('.p-menubar-end .font-bold') || { textContent: '' }).textContent.trim();

  const updFs = fieldsetByLegend(doc, 'Task Updates');
  const updates = [];
  if (updFs) {
    for (const row of updFs.querySelectorAll('.ws_ccs_row')) {
      if ((row.getAttribute('class') || '').includes('ws_ccs_top_row')) continue;
      const cells = row.querySelectorAll(':scope > div');
      if (cells.length < 3) continue;
      const { en, tr } = splitLang(chipTexts(cells[0]));
      if (!en && !tr) continue;
      const files = cells[1].querySelectorAll('button[aria-label]').map((b) => b.getAttribute('aria-label'));
      const time = cells.find((c) => /\d{1,2}:\d{2}:\d{2}/.test(c.textContent) && c.querySelectorAll('div').length === 0);
      updates.push({ textEn: en, textZh: tr, files, time: time ? time.textContent.trim() : '' });
    }
  }

  const qaFs = fieldsetByLegend(doc, 'Questions & Answers');
  const questions = [];
  if (qaFs) {
    for (const row of qaFs.querySelectorAll('.ws_ccs_row')) {
      if ((row.getAttribute('class') || '').includes('ws_ccs_top_row')) continue;
      const cells = row.querySelectorAll(':scope > div');
      if (cells.length < 4) continue;
      const img = cells[0].querySelector('img');
      const teamFlag = img ? path.basename(img.getAttribute('src') || '') : '';
      const q = splitLang(chipTexts(cells[1]));
      const a = splitLang(chipTexts(cells[2]));
      const time = cells.find((c) => /\d{1,2}:\d{2}:\d{2}/.test(c.textContent) && c.querySelectorAll('div').length === 0);
      if (!q.en && !q.tr) continue;
      questions.push({
        teamFlag,
        mine: !!myFlag && teamFlag === myFlag,
        text: q.en || q.tr,
        textZh: q.en ? q.tr : '',
        answerEn: a.en,
        answerZh: a.tr,
        time: time ? time.textContent.trim() : '',
      });
    }
  }
  return { file, name, title, description, briefing, task, updates, questions, myCode };
}

// ------------------------------------------------------------------ main
const all = walk(path.resolve(root));
const htmlFiles = all.filter((f) => /\.html?$/i.test(f));
const byCanon = new Map();
for (const f of all) {
  const k = canon(path.basename(f));
  if (!byCanon.has(k)) byCanon.set(k, []);
  byCanon.get(k).push(f);
}

const pages = htmlFiles.map(parsePage).filter(Boolean);
if (!pages.length) {
  console.error('找不到含 "Task Information" 的 WS CCS 頁面。');
  process.exit(1);
}

store.load();
const db = store.get();
const report = [];
let copied = 0;
const missing = new Set();

function findFile(name, nearDir) {
  const list = byCanon.get(canon(name)) || [];
  if (!list.length) return null;
  // 優先同一個 Day 資料夾
  return list.find((p) => p.startsWith(nearDir)) || list[0];
}

function addFile(src, { moduleId, kind, updateId = null, name, lang }) {
  const existing = db.files.find((f) => f.moduleId === moduleId && f.kind === kind && f.name === name && f.updateId === updateId);
  if (existing) return existing;
  const stored = store.id('f_') + path.extname(name).slice(0, 12);
  if (!flag('dry-run')) fs.copyFileSync(src, path.join(store.UPLOAD_DIR, stored));
  const rec = { id: store.id('f_'), moduleId, kind, updateId, lang: lang || langOf(name), name, stored, size: fs.statSync(src).size, uploadedAt: Date.now() };
  db.files.push(rec);
  copied++;
  return rec;
}

for (const p of pages.sort((x, y) => (DAY_ORDER[x.name] ?? 9) - (DAY_ORDER[y.name] ?? 9))) {
  const order = DAY_ORDER[p.name] ?? db.modules.length;
  let m = db.modules.find((x) => x.name === p.name || (p.name.startsWith('Famil') && x.name.startsWith('Famil')));
  if (!m) {
    m = { id: store.id('m_'), key: '', name: p.name, day: DAY_LABEL[order] || '', order, released: false, questionsOpen: true, description: '', descriptionZh: '' };
    db.modules.push(m);
  }
  m.title = p.title;
  if (p.description) m.description = p.description;
  m.released = flag('release');
  const dir = path.dirname(p.file);
  const dayOffset = order - 1; // C-2 → -1 …（只影響顯示日期）

  // Briefing / Task files（含翻譯版）
  for (const [kind, names] of [
    ['briefing', p.briefing],
    ['task', p.task],
  ]) {
    for (const n of names) {
      const src = findFile(n, dir);
      if (src) addFile(src, { moduleId: m.id, kind, name: n, lang: 'en' });
      else missing.add(`${p.name} / ${kind}: ${n}`);
      if (kind === 'briefing') {
        for (const pre of ['zh_hant_', 'zh_']) {
          const tn = pre + n;
          const tsrc = findFile(tn, dir);
          if (tsrc) addFile(tsrc, { moduleId: m.id, kind, name: tn, lang: langOf(tn) });
        }
      }
    }
  }

  // Task updates（避免重複匯入：同模組同英文內容視為同一則）
  let nu = 0;
  for (const u of p.updates) {
    if (db.updates.find((x) => x.moduleId === m.id && x.textEn === u.textEn && x.textZh === u.textZh)) continue;
    const rec = { id: store.id('u_'), moduleId: m.id, textEn: u.textEn, textZh: u.textZh, published: true, createdAt: parseTime(u.time, dayOffset) };
    db.updates.push(rec);
    nu++;
    for (const n of u.files) {
      const src = findFile(n, dir);
      if (src) addFile(src, { moduleId: m.id, kind: 'update', updateId: rec.id, name: n });
      else missing.add(`${p.name} / update: ${n}`);
    }
  }

  // Q&A
  let nq = 0;
  if (!flag('no-qa')) {
    for (const q of p.questions) {
      if (db.questions.find((x) => x.moduleId === m.id && x.text === q.text && x.answerEn === q.answerEn)) continue;
      const myTeam = q.mine ? db.teams.find((t) => t.code.toLowerCase() === (p.myCode || '').toLowerCase()) : null;
      const ts = parseTime(q.time, dayOffset);
      db.questions.push({
        id: store.id('q_'),
        moduleId: m.id,
        teamId: myTeam ? myTeam.id : null,
        teamCode: q.mine ? p.myCode || 'ME' : '—',
        teamFlag: q.mine ? '' : '🏳️',
        text: q.text,
        textZh: q.textZh,
        answerEn: q.answerEn,
        answerZh: q.answerZh,
        status: q.answerEn || q.answerZh ? 'answered' : 'open',
        public: true,
        createdAt: ts,
        updatedAt: ts,
      });
      nq++;
    }
  }
  report.push(`${p.name.padEnd(20)} 標題「${p.title}」 briefing ${p.briefing.length}、task ${p.task.length}、updates +${nu}、Q&A +${nq}   ← ${path.relative(root, p.file)}`);
}

db.modules.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
if (!flag('dry-run')) store.saveNow();

console.log(report.join('\n'));
console.log(`\n複製檔案：${copied} 個${flag('dry-run') ? '（dry-run，未寫入）' : ''}`);
if (missing.size) {
  console.log(`\n⚠ 找不到下列檔案（頁面有列出，但資料夾裡沒有；可在後台手動上傳）：`);
  for (const m of missing) console.log('  - ' + m);
}
console.log(`\n資料已寫入 ${store.DB_FILE}。若伺服器正在執行，請重新啟動。模組預設為${flag('release') ? '全部開放' : '未開放，請到後台「控制台」逐日開放'}。`);
