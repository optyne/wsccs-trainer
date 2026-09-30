#!/usr/bin/env node
// 建立示範資料：3 支隊伍 + 5 個模組（C-2、C1–C4）+ 範例更新與問答。
// 用法：npm run seed          （會覆蓋 data/db.json，uploads/ 保留）
const store = require('../lib/store');

const db = store.defaults();
const T = (code, name, flag) => ({ id: store.id('t_'), code, name, flag, password: store.hashPassword('demo1234') });
db.teams = [T('TW', 'Chinese Taipei', '🇹🇼'), T('DE', 'Germany', '🇩🇪'), T('JP', 'Japan', '🇯🇵')];

const [fd, a, b, c, d] = db.modules;
fd.description =
  'Familiarize yourself with your workplace and the MES PC.\n' +
  'Log in to the MES PC and verify that the required software starts automatically.\n' +
  'Confirm that you can access the welcome dashboard at: http://192.168.10.2:1880/ui\n' +
  'Verify that you receive the MQTT welcome message on topic team/<n>/welcome.';
fd.descriptionZh =
  '熟悉工作崗位與 MES PC。\n登入 MES PC，確認必要軟體會自動啟動。\n確認可以開啟歡迎看板 http://192.168.10.2:1880/ui\n確認有收到 MQTT 主題 team/<n>/welcome 的歡迎訊息。';
fd.released = true;
a.description = 'Central factory data, HMI and dashboard. See the briefing file.';
a.descriptionZh = '中央工廠資料、HMI 與看板。詳見題本。';
b.description = 'Webshop, ultrasonic sensor, CIROS and e-ink.';
c.description = 'Network and energy.';
d.description = 'Security, IoT, Grafana and documentation.';

const now = Date.now();
db.updates.push({
  id: store.id('u_'),
  moduleId: fd.id,
  textEn: 'Please make sure that the MES PC has the local date, time and time-zone.',
  textZh: '請確認 MES PC 有當地日期、時間以及時區。',
  published: true,
  createdAt: now - 60 * 60 * 1000,
});
db.questions.push({
  id: store.id('q_'),
  moduleId: fd.id,
  teamId: db.teams[1].id,
  teamCode: 'DE',
  text: 'Will the Cloud Welcome dashboard be available during C1-C4?',
  textZh: 'C1–C4 期間 Cloud Welcome 看板都能使用嗎？',
  answerEn: 'Yes.',
  answerZh: '是。',
  status: 'answered',
  public: true,
  createdAt: now - 30 * 60 * 1000,
  updatedAt: now - 25 * 60 * 1000,
});

store.load();
store.replace(db);
console.log('已寫入示範資料 →', store.DB_FILE);
console.log('隊伍帳號：TW / DE / JP，密碼皆為 demo1234；後台密碼預設 admin');
