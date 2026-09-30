// 基本 API 流程測試：node --test tests/
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wsccs-'));
process.env.DATA_DIR = path.join(tmp, 'data');
process.env.UPLOAD_DIR = path.join(tmp, 'uploads');
process.env.ADMIN_PASSWORD = 'pw-admin';

const app = require('../server');
let server;
let base;

function client() {
  let cookie = '';
  return async (url, { method = 'GET', body } = {}) => {
    const res = await fetch(base + url, {
      method,
      headers: { 'Content-Type': 'application/json', cookie },
      body: body ? JSON.stringify(body) : undefined,
    });
    const sc = res.headers.get('set-cookie');
    if (sc) cookie = sc.split(';')[0];
    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
    return { status: res.status, data };
  };
}

before(async () => {
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = 'http://127.0.0.1:' + server.address().port;
});
after(async () => {
  server.close();
  await new Promise((r) => setTimeout(r, 300)); // 等 debounce 寫檔完成
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('完整流程：開放模組 → 提問 → 回覆 → 已讀', async () => {
  const admin = client();
  const team = client();
  const other = client();

  assert.equal((await admin('/api/admin/login', { method: 'POST', body: { password: 'wrong' } })).status, 401);
  assert.equal((await admin('/api/admin/login', { method: 'POST', body: { password: 'pw-admin' } })).status, 200);

  await admin('/api/admin/teams', { method: 'POST', body: { code: 'TW', name: 'Chinese Taipei', password: 'a' } });
  await admin('/api/admin/teams', { method: 'POST', body: { code: 'DE', name: 'Germany', password: 'b' } });
  assert.equal((await team('/api/login', { method: 'POST', body: { code: 'tw', password: 'a' } })).status, 200);
  assert.equal((await other('/api/login', { method: 'POST', body: { code: 'DE', password: 'b' } })).status, 200);

  const st0 = (await team('/api/state')).data;
  assert.equal(st0.modules.length, 0, '預設沒有開放的模組');
  assert.equal(st0.allModules.length, 5, 'C-2 + C1–C4');
  const modA = st0.allModules.find((m) => m.name === 'Module A');
  assert.equal((await team('/api/modules/' + modA.id)).status, 404, '未開放不可讀');

  await admin('/api/admin/modules/' + modA.id, { method: 'PUT', body: { released: true } });
  const st1 = (await team('/api/state')).data;
  assert.equal(st1.modules.length, 1);

  const q = await team(`/api/modules/${modA.id}/questions`, { method: 'POST', body: { text: '3.14 decimals?' } });
  assert.equal(q.status, 200);
  // 他隊在回答前看不到
  assert.equal((await other('/api/modules/' + modA.id)).data.questions.length, 0);

  await admin('/api/admin/questions/' + q.data.question.id, { method: 'PUT', body: { answerEn: 'It is not specified in the task.', answerZh: '題目未指定' } });
  const seenByOther = (await other('/api/modules/' + modA.id)).data.questions;
  assert.equal(seenByOther.length, 1, '公開回答後他隊可見');
  assert.equal(seenByOther[0].answerZh, '題目未指定');

  assert.equal((await team('/api/state')).data.modules[0].unread, 1);
  await team('/api/read', { method: 'POST', body: { key: 'q:' + q.data.question.id, read: true } });
  assert.equal((await team('/api/state')).data.modules[0].unread, 0);

  // 關閉提問
  await admin('/api/admin/features', { method: 'PUT', body: { questions: false } });
  assert.equal((await team(`/api/modules/${modA.id}/questions`, { method: 'POST', body: { text: 'x' } })).status, 403);

  // 選手不能呼叫後台 API
  assert.equal((await team('/api/admin/state')).status, 401);
});
