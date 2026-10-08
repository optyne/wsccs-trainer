// eInk API 模擬器測試：端點與大會 eInk_API.pdf 一致
const { test, before, after } = require('node:test');
const assert = require('node:assert');

process.env.EINK_REFRESH_MS = '50';
process.env.EINK_TEAMS = 'team_25:secret';
const { app, labels } = require('../eink-sim/server');
const { encodeB } = require('../eink-sim/code128');

let server;
let base;
const call = async (method, path, body, token) => {
  const res = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json().catch(() => null) };
};

before(async () => {
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = 'http://127.0.0.1:' + server.address().port;
});
after(() => server.close());

test('Code128B 編碼：起始 B、檢查碼、停止碼', () => {
  const w = encodeB('8173E4476');
  assert.ok(w.startsWith('211214'), 'Start B');
  assert.ok(w.endsWith('2331112'), 'Stop');
  // 每個符號 6 模組寬加總 11，停止碼 13
  const sum = [...w].reduce((a, c) => a + Number(c), 0);
  assert.equal(sum, (1 + 9 + 1) * 11 + 13);
});

test('login → PUT → 延遲刷新 → overlay', async () => {
  assert.equal((await call('POST', '/api/ws26/login', { teamId: 'team_25', password: 'bad' })).status, 401);
  const login = await call('POST', '/api/ws26/login', { teamId: 'team_25', password: 'secret' });
  assert.equal(login.status, 200);
  const tk = login.data.token;

  assert.equal((await call('PUT', '/api/ws26/labels/ABC123', { title: 'x' })).status, 401, '沒帶 token');
  assert.equal((await call('POST', '/api/ws26/labels/ABC123/overlay', { imageDataUrl: 'data:image/png;base64,AA' }, tk)).status, 409, '未寫入前不可 overlay');

  const put = await call('PUT', '/api/ws26/labels/ABC123', { title: 'Order 1-1', subtitle: 'Part 4503', message: 'Error', messageTextColor: 'white', messageBackgroundColor: 'red' }, tk);
  assert.deepEqual(put.data, { success: true, message: 'Data successfully sent to the API' });
  assert.equal(labels.get('ABC123').shown.title, '', '刷新前畫面還沒變');
  await new Promise((r) => setTimeout(r, 120));
  assert.equal(labels.get('ABC123').shown.title, 'Order 1-1');

  // 預設整筆取代：只送 message 時其他欄位被清空
  await call('PUT', '/api/ws26/labels/ABC123', { message: 'Successful' }, tk);
  await new Promise((r) => setTimeout(r, 120));
  assert.equal(labels.get('ABC123').shown.title, '');

  assert.equal((await call('PUT', '/api/ws26/labels/ABC123', { messageTextColor: 'blue' }, tk)).status, 400);
  assert.deepEqual((await call('POST', '/api/ws26/labels/ABC123/overlay', { imageDataUrl: 'data:image/png;base64,AA' }, tk)).data, { success: true });
  assert.deepEqual((await call('DELETE', '/api/ws26/labels/ABC123/overlay', null, tk)).data, { success: true });

  const svg = await fetch(base + '/label/ABC123.svg').then((r) => r.text());
  assert.ok(svg.startsWith('<svg'));
});
