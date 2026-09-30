// 裁判後台（Admin）
(function () {
  const { h, icons, api } = WS;
  const app = document.getElementById('app');

  const S = {
    d: null, // /api/admin/state
    offset: 0,
    drafts: WS.ls.get('wsccs_admin_drafts', {}), // 正在打的回覆，避免被即時刷新洗掉
    qFilter: { module: 'all', status: 'open' },
    modSel: null,
    updMod: null,
  };

  const SECTIONS = [
    ['dash', '控制台'],
    ['qa', '問答回覆'],
    ['modules', '每日題目'],
    ['updates', '任務更新'],
    ['docs', '共用文件'],
    ['teams', '隊伍帳號'],
    ['settings', '系統設定'],
  ];

  const LANGS = [
    ['en', 'English'],
    ['zh-hant', '繁中 TW:ZHO'],
    ['zh', '簡中 ZHO'],
    ['other', '其他'],
  ];

  // 大會常見標準回覆（取自實際 CCS 問答用語）
  const QUICK = [
    ['It is not specified in the task.', '題目未指定'],
    ['Please refer to a specification number.', '請標明題號'],
    ['Please specify.', '請說明清楚'],
    ['If it is not specified, it is up to you.', '如果題目沒提到，請自行決定'],
    ['Please call the Technical Support if you expect technical issues.', '如果預期技術問題，請尋求技術支援'],
    ['The assessment procedure is not specified.', '未明確指出評分流程'],
    ['Yes.', '是'],
    ['No.', '否'],
  ];

  const sec = () => (location.hash.replace(/^#\/?/, '') || 'dash').split('/')[0];
  const saveDrafts = () => WS.ls.set('wsccs_admin_drafts', S.drafts);
  const modName = (id) => (S.d.modules.find((m) => m.id === id) || {}).name || '—';

  async function refresh() {
    S.d = await api('/api/admin/state');
    S.offset = S.d.serverNow - Date.now();
  }

  async function act(fn, okMsg) {
    try {
      await fn();
      await refresh();
      render();
      if (okMsg) WS.toast(okMsg, '', 'answer');
    } catch (e) {
      WS.toast('操作失敗', e.message, 'message');
    }
  }

  function sw(checked, onchange, label) {
    return h(
      'label',
      { class: 'sw' },
      h('input', { type: 'checkbox', checked: checked ? true : null, onchange: (e) => onchange(e.target.checked) }),
      h('span', { class: 'track' }),
      label ? h('span', null, label) : null
    );
  }

  function btn(label, onclick, cls = '', attrs = {}) {
    return h('button', { class: 'btn ' + cls, type: 'button', onclick, ...attrs }, label);
  }

  function field(label, input, hint) {
    return h('div', { class: 'field' }, h('label', null, label), input, hint ? h('div', { class: 'hint' }, hint) : null);
  }

  function input(value, attrs = {}) {
    return h('input', { class: 'input', value: value ?? '', ...attrs });
  }

  function textarea(value, attrs = {}) {
    const t = h('textarea', { class: 'input', ...attrs });
    t.value = value ?? '';
    return t;
  }

  function langSelect(value, onchange) {
    const s = h(
      'select',
      { class: 'input', style: { width: 'auto', padding: '5px 8px' }, onchange: (e) => onchange(e.target.value) },
      LANGS.map(([v, l]) => h('option', { value: v, selected: v === value ? true : null }, l))
    );
    return s;
  }

  // ------------------------------------------------------------ uploader
  function uploader({ moduleId = '', kind, updateId = '', label = '拖曳檔案到這裡，或點選上傳', onDone }) {
    let lang = 'auto';
    const fileInput = h('input', { type: 'file', multiple: true, style: { display: 'none' } });
    const box = h(
      'div',
      { class: 'drop' },
      h('div', null, label),
      h(
        'div',
        { class: 'row', style: { justifyContent: 'center', marginTop: '8px' } },
        h(
          'select',
          { class: 'input', style: { width: 'auto', padding: '5px 8px' }, onchange: (e) => (lang = e.target.value) },
          h('option', { value: 'auto' }, '語言：依檔名自動判斷'),
          LANGS.map(([v, l]) => h('option', { value: v }, '語言：' + l))
        ),
        btn('選擇檔案', () => fileInput.click(), 'btn-sm btn-outlined')
      ),
      fileInput
    );
    const send = async (files) => {
      if (!files.length) return;
      const fd = new FormData();
      [...files].forEach((f) => fd.append('files', f, f.name));
      fd.append('kind', kind);
      fd.append('lang', lang);
      if (moduleId) fd.append('moduleId', moduleId);
      if (updateId) fd.append('updateId', updateId);
      box.firstChild.textContent = `上傳中…（${files.length} 個檔案）`;
      try {
        const r = await api('/api/admin/files', { method: 'POST', body: fd });
        if (onDone) await onDone(r.files);
        else await act(async () => {}, `已上傳 ${r.files.length} 個檔案`);
      } catch (e) {
        WS.toast('上傳失敗', e.message, 'message');
        box.firstChild.textContent = label;
      }
    };
    fileInput.addEventListener('change', () => send(fileInput.files));
    box.addEventListener('dragover', (e) => {
      e.preventDefault();
      box.classList.add('over');
    });
    box.addEventListener('dragleave', () => box.classList.remove('over'));
    box.addEventListener('drop', (e) => {
      e.preventDefault();
      box.classList.remove('over');
      send(e.dataTransfer.files);
    });
    return box;
  }

  function filesTable(files, { allowKind } = {}) {
    if (!files.length) return h('div', { class: 'hint', style: { padding: '8px 0' } }, '尚無檔案');
    return h(
      'table',
      { class: 't' },
      h('tr', null, h('th', null, '檔名'), h('th', null, '語言'), allowKind ? h('th', null, '類別') : null, h('th', null, '大小'), h('th', null, '')),
      files.map((f) =>
        h(
          'tr',
          null,
          h('td', null, h('a', { href: '/api/files/' + f.id }, f.name)),
          h('td', null, langSelect(f.lang, (v) => act(() => api('/api/admin/files/' + f.id, { method: 'PUT', body: { lang: v } }), '已更新語言'))),
          allowKind
            ? h(
                'td',
                null,
                h(
                  'select',
                  {
                    class: 'input',
                    style: { width: 'auto', padding: '5px 8px' },
                    onchange: (e) => act(() => api('/api/admin/files/' + f.id, { method: 'PUT', body: { kind: e.target.value } }), '已移動'),
                  },
                  h('option', { value: 'briefing', selected: f.kind === 'briefing' ? true : null }, 'Briefing'),
                  h('option', { value: 'task', selected: f.kind === 'task' ? true : null }, 'Task')
                )
              )
            : null,
          h('td', { class: 'hint' }, WS.fmtSize(f.size)),
          h(
            'td',
            { style: { textAlign: 'right' } },
            btn('刪除', () => confirm(`刪除「${f.name}」？`) && act(() => api('/api/admin/files/' + f.id, { method: 'DELETE' }), '已刪除'), 'btn-sm btn-text')
          )
        )
      )
    );
  }

  // ------------------------------------------------------------ sections
  function secDash() {
    const d = S.d;
    const t = d.timer;
    const td = WS.timerDisplay(t, S.offset);
    const openQ = d.questions.filter((q) => q.status === 'open').length;
    const durH = input(Math.floor(t.durationMs / 3600000), { type: 'number', min: 0, max: 23, style: { width: '70px' }, 'aria-label': '時' });
    const durM = input(Math.floor((t.durationMs % 3600000) / 60000), { type: 'number', min: 0, max: 59, style: { width: '70px' }, 'aria-label': '分' });
    const label = input(t.label, { placeholder: '例如 C1 Module A', style: { width: '200px' } });
    const bmsg = textarea('', { placeholder: '例如：午餐時間 12:00–12:30，計時暫停。', style: { minHeight: '60px' } });

    const timerCard = h(
      'div',
      { class: 'card' },
      h('h2', null, '競賽計時器', h('span', { class: 'pill ' + (t.state === 'running' ? 'on' : t.state === 'paused' ? 'open' : '') }, { running: '計時中', paused: '暫停', stopped: '停止' }[t.state])),
      h('div', { class: 'row', style: { marginBottom: '12px' } }, h('div', { class: 'big-clock ' + td.cls, id: 'adm-clock' }, td.text)),
      h(
        'div',
        { class: 'row', style: { marginBottom: '12px' } },
        btn('開始', () => act(() => api('/api/admin/timer', { method: 'POST', body: { action: 'start' } })), '', { disabled: t.state === 'running' ? true : null }),
        btn('暫停', () => act(() => api('/api/admin/timer', { method: 'POST', body: { action: 'pause' } })), 'btn-warning', { disabled: t.state !== 'running' ? true : null }),
        btn('歸零', () => confirm('計時器歸零？') && act(() => api('/api/admin/timer', { method: 'POST', body: { action: 'reset' } })), 'btn-secondary'),
        btn('−5 分', () => act(() => api('/api/admin/timer', { method: 'POST', body: { action: 'adjust', deltaMs: -300000 } })), 'btn-text btn-sm'),
        btn('+5 分', () => act(() => api('/api/admin/timer', { method: 'POST', body: { action: 'adjust', deltaMs: 300000 } })), 'btn-text btn-sm')
      ),
      h(
        'div',
        { class: 'row' },
        h('span', null, '時長'),
        durH,
        h('span', null, '時'),
        durM,
        h('span', null, '分'),
        label,
        btn(
          '套用',
          () =>
            act(
              () =>
                api('/api/admin/timer', {
                  method: 'POST',
                  body: { durationMs: (Number(durH.value) * 60 + Number(durM.value)) * 60000, label: label.value },
                }),
              '已套用'
            ),
          'btn-sm btn-outlined'
        )
      ),
      h('div', { class: 'hint', style: { marginTop: '8px' } }, '時長設為 0 → 顯示「+經過時間」（同原系統）；設定時長 → 顯示「-剩餘時間」，超時轉紅色「+」。')
    );

    const modCard = h(
      'div',
      { class: 'card' },
      h('h2', null, '每日題目開放', h('a', { href: '#/modules', class: 'hint' }, '編輯內容 →')),
      h(
        'table',
        { class: 't' },
        h('tr', null, h('th', null, '日'), h('th', null, '模組'), h('th', null, '開放題目'), h('th', null, '開放提問'), h('th', null, '未答')),
        d.modules.map((m) =>
          h(
            'tr',
            null,
            h('td', null, h('span', { class: 'pill blue' }, m.day || '—')),
            h('td', null, m.name),
            h('td', null, sw(m.released, (v) => act(() => api('/api/admin/modules/' + m.id, { method: 'PUT', body: { released: v } }), v ? `${m.name} 已開放` : `${m.name} 已關閉`))),
            h('td', null, sw(m.questionsOpen, (v) => act(() => api('/api/admin/modules/' + m.id, { method: 'PUT', body: { questionsOpen: v } })))),
            h('td', null, (() => {
              const n = d.questions.filter((q) => q.moduleId === m.id && q.status === 'open').length;
              return n ? h('a', { href: '#/qa', class: 'pill open' }, n) : h('span', { class: 'hint' }, '0');
            })())
          )
        )
      )
    );

    const F = [
      ['tasksPage', 'Tasks 頁面', '關閉後選手看不到任何題目'],
      ['docsPage', 'Documentation 頁面', '共用文件頁'],
      ['questions', '允許提問（全域）', '關閉後所有模組的 New Question 按鈕停用'],
      ['questionsOnlyWhenRunning', '僅計時中可提問', '計時器暫停 / 停止時不能提問'],
      ['showOtherTeamsQA', '公開他隊問答', '已回答且標為公開的問題，所有隊伍都看得到'],
      ['translations', 'All Translations 切換', '顯示中英對照切換鈕'],
      ['downloads', '允許下載檔案', '關閉後檔案按鈕停用'],
      ['readMarks', 'Read 勾選欄', '選手可標記已讀，未讀以橘色標示'],
      ['notifySound', '提示音', '新回覆 / 新公告時在選手端響鈴'],
    ];
    const featCard = h(
      'div',
      { class: 'card' },
      h('h2', null, '功能開關'),
      F.map(([k, name, desc]) =>
        h(
          'div',
          { class: 'feat' },
          h('div', null, h('b', null, name), h('span', { class: 'hint' }, desc)),
          sw(d.features[k], (v) => act(() => api('/api/admin/features', { method: 'PUT', body: { [k]: v } })))
        )
      )
    );

    const teamSel = h('select', { class: 'input', style: { width: 'auto' } }, h('option', { value: '' }, '所有隊伍'), d.teams.map((t) => h('option', { value: t.id }, `${t.code} ${t.name}`)));
    const bcCard = h(
      'div',
      { class: 'card' },
      h('h2', null, '廣播訊息'),
      bmsg,
      h('div', { class: 'row end', style: { marginTop: '10px' } }, teamSel, btn('送出', () => bmsg.value.trim() && act(() => api('/api/admin/broadcast', { method: 'POST', body: { text: bmsg.value, teamId: teamSel.value || undefined } }), '已廣播'))),
      h('div', { class: 'hint', style: { marginTop: '6px' } }, '選手端會跳出提示並響鈴，並記錄在右下角通知紀錄。')
    );

    const online = new Set(d.online);
    const statCard = h(
      'div',
      { class: 'card' },
      h('h2', null, '即時狀況'),
      h(
        'div',
        { class: 'row', style: { gap: '28px', marginBottom: '12px' } },
        h('div', { class: 'stat' }, h('b', null, openQ), h('span', null, '待回答問題')),
        h('div', { class: 'stat' }, h('b', null, d.questions.length), h('span', null, '問題總數')),
        h('div', { class: 'stat' }, h('b', null, online.size + ' / ' + d.teams.length), h('span', null, '在線隊伍'))
      ),
      h(
        'div',
        { class: 'row' },
        d.teams.map((t) => h('span', { class: 'pill', title: t.name }, h('span', { class: online.has(t.id) ? 'dot-online' : 'dot-offline' }), ' ', t.flag || '', ' ', t.code))
      )
    );

    return [h('h1', null, '控制台'), h('div', { class: 'cards' }, timerCard, statCard), h('div', { class: 'cards' }, modCard, featCard), bcCard];
  }

  function draftFor(q) {
    const cur = S.drafts[q.id];
    if (!cur || !cur.dirty) S.drafts[q.id] = { answerEn: q.answerEn, answerZh: q.answerZh, textZh: q.textZh, public: q.public, dirty: false };
    return S.drafts[q.id];
  }

  function qCard(q) {
    const dr = draftFor(q);
    const bind = (el, key) => {
      el.value = dr[key] || '';
      el.addEventListener('input', () => {
        dr[key] = el.value;
        dr.dirty = true;
        saveDrafts();
      });
      return el;
    };
    const aEn = bind(textarea('', { placeholder: 'Answer (English)' }), 'answerEn');
    const aZh = bind(textarea('', { placeholder: '回答（中文翻譯）' }), 'answerZh');
    const qZh = bind(textarea('', { placeholder: '問題翻譯（選填；All Translations 時顯示）', style: { minHeight: '50px' } }), 'textZh');
    const pub = h('input', { type: 'checkbox', checked: dr.public !== false ? true : null, onchange: (e) => { dr.public = e.target.checked; dr.dirty = true; saveDrafts(); } });
    const save = () =>
      act(async () => {
        await api('/api/admin/questions/' + q.id, {
          method: 'PUT',
          body: { answerEn: aEn.value, answerZh: aZh.value, textZh: qZh.value, public: pub.checked },
        });
        delete S.drafts[q.id];
        saveDrafts();
      }, aEn.value.trim() || aZh.value.trim() ? '已回覆，選手端已通知' : '已儲存');
    const quick = h(
      'div',
      { class: 'quick' },
      QUICK.map(([en, zh]) =>
        h(
          'button',
          {
            type: 'button',
            onclick: () => {
              aEn.value = en;
              aZh.value = zh;
              dr.answerEn = en;
              dr.answerZh = zh;
              dr.dirty = true;
              saveDrafts();
            },
          },
          en
        )
      )
    );
    const modSel = h(
      'select',
      {
        class: 'input',
        style: { width: 'auto', padding: '4px 8px' },
        title: '移到其他模組',
        onchange: (e) => act(() => api('/api/admin/questions/' + q.id, { method: 'PUT', body: { moduleId: e.target.value } }), '已移動'),
      },
      S.d.modules.map((m) => h('option', { value: m.id, selected: m.id === q.moduleId ? true : null }, m.name))
    );
    return h(
      'div',
      { class: 'qcard ' + q.status },
      h(
        'div',
        { class: 'qh' },
        h(
          'div',
          { class: 'row' },
          h('span', { class: 'pill ' + (q.status === 'open' ? 'open' : 'on') }, q.status === 'open' ? '待回答' : '已回答'),
          h('b', null, (q.team.flag || '') + ' ' + q.team.code),
          h('span', { class: 'hint' }, q.team.name || ''),
          modSel,
          h('span', { class: 'hint' }, WS.fmtDateTime(q.createdAt)),
          dr.dirty ? h('span', { class: 'pill open' }, '草稿未送出') : null
        ),
        h(
          'div',
          { class: 'row' },
          h('label', { class: 'row', style: { gap: '6px' } }, pub, h('span', { class: 'hint' }, '公開給所有隊伍')),
          btn('刪除', () => confirm('刪除此問題？') && act(() => api('/api/admin/questions/' + q.id, { method: 'DELETE' }), '已刪除'), 'btn-sm btn-text')
        )
      ),
      h(
        'div',
        { class: 'qb' },
        h('div', null, h('div', { class: 'qtext' }, q.text || '（無內容）'), qZh),
        h('div', null, quick, aEn, h('div', { style: { height: '8px' } }), aZh, h('div', { class: 'row end', style: { marginTop: '10px' } }, btn(q.status === 'open' ? '送出回覆' : '更新回覆', save)))
      )
    );
  }

  function secQA() {
    const d = S.d;
    const f = S.qFilter;
    const list = d.questions.filter((q) => (f.module === 'all' || q.moduleId === f.module) && (f.status === 'all' || q.status === f.status));
    const modTabs = h(
      'div',
      { class: 'tabs' },
      [['all', '全部模組'], ...d.modules.map((m) => [m.id, m.name])].map(([v, l]) => {
        const n = d.questions.filter((q) => q.status === 'open' && (v === 'all' || q.moduleId === v)).length;
        return btn([l, n ? ` (${n})` : ''], () => { f.module = v; render(); }, f.module === v ? 'btn-sm' : 'btn-sm btn-secondary');
      })
    );
    const statusTabs = h(
      'div',
      { class: 'tabs' },
      [['open', '待回答'], ['answered', '已回答'], ['all', '全部']].map(([v, l]) => btn(l, () => { f.status = v; render(); }, f.status === v ? 'btn-sm' : 'btn-sm btn-secondary'))
    );
    return [
      h('h1', null, '問答回覆', btn([h('span', { html: icons.plus, style: { display: 'inline-flex' } }), '新增問答'], newQADialog, 'btn-sm btn-outlined')),
      modTabs,
      statusTabs,
      list.length ? list.map(qCard) : h('div', { class: 'card hint' }, f.status === 'open' ? '目前沒有待回答的問題 🎉' : '沒有符合的問題'),
    ];
  }

  function newQADialog() {
    const d = S.d;
    const mod = h('select', { class: 'input' }, d.modules.map((m) => h('option', { value: m.id }, m.name)));
    const team = h('select', { class: 'input' }, h('option', { value: '' }, '（大會 / 其他隊伍）'), d.teams.map((t) => h('option', { value: t.id }, `${t.code} ${t.name}`)));
    const teamCode = input('', { placeholder: '顯示代碼，例如 DE' });
    const q = textarea('', { placeholder: 'Question' });
    const qz = textarea('', { placeholder: '問題中文（選填）', style: { minHeight: '60px' } });
    const ae = textarea('', { placeholder: 'Answer (English)' });
    const az = textarea('', { placeholder: '回答中文' });
    const dlg = WS.dialog({
      title: '新增問答',
      wide: true,
      body: h(
        'div',
        null,
        h('div', { class: 'two' }, field('模組', mod), field('提問隊伍', team, '選「大會 / 其他隊伍」時可自訂顯示代碼')),
        field('顯示代碼', teamCode),
        h('div', { class: 'two' }, field('問題', q), field('回答', ae)),
        h('div', { class: 'two' }, field('問題翻譯', qz), field('回答翻譯', az))
      ),
      foot: [
        btn('取消', () => dlg.close(), 'btn-secondary'),
        btn('新增', () =>
          act(async () => {
            await api('/api/admin/questions', {
              method: 'POST',
              body: { moduleId: mod.value, teamId: team.value || undefined, teamCode: teamCode.value || '—', text: q.value, textZh: qz.value, answerEn: ae.value, answerZh: az.value },
            });
            dlg.close();
          }, '已新增')
        ),
      ],
    });
  }

  function secModules() {
    const d = S.d;
    if (!S.modSel || !d.modules.find((m) => m.id === S.modSel)) S.modSel = d.modules[0] && d.modules[0].id;
    const m = d.modules.find((x) => x.id === S.modSel);
    const tabs = h(
      'div',
      { class: 'tabs' },
      d.modules.map((x) => btn([x.day ? x.day + ' · ' : '', x.name, x.released ? ' ✓' : ''], () => { S.modSel = x.id; render(); }, x.id === S.modSel ? 'btn-sm' : 'btn-sm btn-secondary')),
      btn('+ 新增模組', () => act(() => api('/api/admin/modules', { method: 'POST', body: { name: 'New Module' } }), '已新增'), 'btn-sm btn-outlined')
    );
    if (!m) return [h('h1', null, '每日題目'), tabs];

    const key = 'mod:' + m.id;
    if (!S.drafts[key] || !S.drafts[key].dirty)
      S.drafts[key] = { name: m.name, day: m.day, title: m.title, description: m.description, descriptionZh: m.descriptionZh, dirty: false };
    const dr = S.drafts[key];
    const bind = (el, k) => {
      el.value = dr[k] || '';
      el.addEventListener('input', () => {
        dr[k] = el.value;
        dr.dirty = true;
        saveDrafts();
      });
      return el;
    };
    const name = bind(input(''), 'name');
    const day = bind(input('', { placeholder: 'C1' }), 'day');
    const title = bind(input(''), 'title');
    const desc = bind(textarea('', { style: { minHeight: '180px' } }), 'description');
    const descZh = bind(textarea('', { style: { minHeight: '180px' } }), 'descriptionZh');

    const files = d.files.filter((f) => f.moduleId === m.id && (f.kind === 'briefing' || f.kind === 'task'));
    return [
      h('h1', null, '每日題目'),
      tabs,
      h(
        'div',
        { class: 'card' },
        h(
          'h2',
          null,
          h('span', null, `${m.name} 基本資料`),
          h(
            'span',
            { class: 'row' },
            sw(m.released, (v) => act(() => api('/api/admin/modules/' + m.id, { method: 'PUT', body: { released: v } }), v ? '已開放給選手' : '已關閉'), m.released ? '已開放給選手' : '未開放'),
            sw(m.questionsOpen, (v) => act(() => api('/api/admin/modules/' + m.id, { method: 'PUT', body: { questionsOpen: v } })), '開放提問')
          )
        ),
        h('div', { class: 'two' }, field('按鈕名稱', name, '例如 Module A / Familarization Day'), field('競賽日', day, '例如 C-2、C1、C2…')),
        field('標題（Task Information）', title, '選手端顯示為「按鈕名稱 : 標題」'),
        h('div', { class: 'two' }, field('說明（English）', desc, '支援換行，網址會自動變成連結'), field('說明（中文翻譯）', descZh, 'All Translations 時顯示')),
        h(
          'div',
          { class: 'row end' },
          btn('刪除模組', () => confirm(`刪除 ${m.name}（含檔案、更新、問答）？`) && act(() => api('/api/admin/modules/' + m.id, { method: 'DELETE' }), '已刪除'), 'btn-text'),
          btn('儲存', () =>
            act(async () => {
              await api('/api/admin/modules/' + m.id, { method: 'PUT', body: { name: name.value, day: day.value, title: title.value, description: desc.value, descriptionZh: descZh.value } });
              delete S.drafts[key];
              saveDrafts();
            }, '已儲存')
          )
        )
      ),
      h(
        'div',
        { class: 'two' },
        h('div', { class: 'card' }, h('h2', null, 'Briefing Files（題本）'), uploader({ moduleId: m.id, kind: 'briefing' }), h('div', { style: { height: '10px' } }), filesTable(files.filter((f) => f.kind === 'briefing'), { allowKind: true })),
        h('div', { class: 'card' }, h('h2', null, 'Task Files（提供檔案 / given data）'), uploader({ moduleId: m.id, kind: 'task' }), h('div', { style: { height: '10px' } }), filesTable(files.filter((f) => f.kind === 'task'), { allowKind: true }))
      ),
      h('div', { class: 'hint' }, '檔名以 zh_hant_ 開頭會自動標為繁中、zh_ 開頭標為簡中；選手端 English 模式只顯示英文檔，All Translations 顯示全部。'),
    ];
  }

  function secUpdates() {
    const d = S.d;
    if (!S.updMod || !d.modules.find((m) => m.id === S.updMod)) S.updMod = (d.modules.find((m) => m.released) || d.modules[0] || {}).id;
    const dr = (S.drafts['upd:new'] = S.drafts['upd:new'] || { textEn: '', textZh: '' });
    const mod = h(
      'select',
      { class: 'input', onchange: (e) => { S.updMod = e.target.value; render(); } },
      d.modules.map((m) => h('option', { value: m.id, selected: m.id === S.updMod ? true : null }, `${m.name}${m.released ? '' : '（未開放）'}`))
    );
    const en = textarea(dr.textEn, { placeholder: 'Update text (English)' });
    const zh = textarea(dr.textZh, { placeholder: '更新內容（中文翻譯）' });
    en.addEventListener('input', () => { dr.textEn = en.value; saveDrafts(); });
    zh.addEventListener('input', () => { dr.textZh = zh.value; saveDrafts(); });
    const fileInput = h('input', { type: 'file', multiple: true });
    const publish = h('input', { type: 'checkbox', checked: true });

    const create = () =>
      act(async () => {
        const r = await api('/api/admin/updates', { method: 'POST', body: { moduleId: mod.value, textEn: en.value, textZh: zh.value, published: false } });
        if (fileInput.files.length) {
          const fd = new FormData();
          [...fileInput.files].forEach((f) => fd.append('files', f, f.name));
          fd.append('kind', 'update');
          fd.append('moduleId', mod.value);
          fd.append('updateId', r.update.id);
          await api('/api/admin/files', { method: 'POST', body: fd });
        }
        // 檔案上傳完才發佈，選手收到通知時檔案已就緒
        if (publish.checked) await api('/api/admin/updates/' + r.update.id, { method: 'PUT', body: { published: true, bumpTime: true } });
        delete S.drafts['upd:new'];
        saveDrafts();
      }, publish.checked ? '已發佈任務更新' : '已存為草稿');

    const list = d.updates.filter((u) => u.moduleId === S.updMod);
    return [
      h('h1', null, '任務更新（Task Updates）'),
      h(
        'div',
        { class: 'card' },
        h('h2', null, '發佈新的更新'),
        field('模組', mod),
        h('div', { class: 'two' }, field('English', en), field('中文翻譯', zh)),
        field('附件', fileInput, '例如 arp_table.txt、pcapng、補充圖片'),
        h('div', { class: 'row end' }, h('label', { class: 'row', style: { gap: '6px' } }, publish, '立即發佈並通知選手'), btn('送出', create))
      ),
      h(
        'div',
        { class: 'card' },
        h('h2', null, `${modName(S.updMod)} 的更新（${list.length}）`),
        list.length
          ? list.map((u) => {
              const ue = textarea(u.textEn, { style: { minHeight: '60px' } });
              const uz = textarea(u.textZh, { style: { minHeight: '60px' } });
              const files = d.files.filter((f) => f.updateId === u.id);
              return h(
                'div',
                { class: 'qcard' + (u.published === false ? ' open' : '') },
                h(
                  'div',
                  { class: 'qh' },
                  h('div', { class: 'row' }, h('span', { class: 'pill ' + (u.published === false ? 'open' : 'on') }, u.published === false ? '草稿' : '已發佈'), h('span', { class: 'hint' }, WS.fmtDateTime(u.createdAt))),
                  h(
                    'div',
                    { class: 'row' },
                    btn(u.published === false ? '發佈' : '撤回', () => act(() => api('/api/admin/updates/' + u.id, { method: 'PUT', body: { published: u.published === false } })), 'btn-sm btn-outlined'),
                    btn('儲存修改', () => act(() => api('/api/admin/updates/' + u.id, { method: 'PUT', body: { textEn: ue.value, textZh: uz.value } }), '已儲存'), 'btn-sm'),
                    btn('刪除', () => confirm('刪除此更新？') && act(() => api('/api/admin/updates/' + u.id, { method: 'DELETE' }), '已刪除'), 'btn-sm btn-text')
                  )
                ),
                h('div', { class: 'qb' }, ue, uz),
                h('div', { style: { padding: '0 14px 12px' } }, filesTable(files), uploader({ moduleId: u.moduleId, kind: 'update', updateId: u.id, label: '追加附件' }))
              );
            })
          : h('div', { class: 'hint' }, '尚無更新')
      ),
    ];
  }

  function secDocs() {
    const files = S.d.files.filter((f) => f.kind === 'doc');
    return [
      h('h1', null, '共用文件（Documentation）'),
      h('div', { class: 'card' }, h('h2', null, '上傳文件'), uploader({ kind: 'doc' }), h('div', { style: { height: '10px' } }), filesTable(files)),
      h('div', { class: 'hint' }, '例如 MES PC 說明、設備手冊、Marking Scheme 公開版。選手端上方「Documentation」可下載。'),
    ];
  }

  function secTeams() {
    const d = S.d;
    const online = new Set(d.online);
    const code = input('', { placeholder: 'TW', style: { width: '90px' } });
    const name = input('', { placeholder: 'Chinese Taipei' });
    const flag = input('', { placeholder: '🇹🇼', style: { width: '80px' } });
    const pw = input('', { placeholder: '密碼', type: 'text' });
    const reads = (tid) => Object.keys(d.reads[tid] || {}).length;
    return [
      h('h1', null, '隊伍帳號'),
      h(
        'div',
        { class: 'card' },
        h('h2', null, '新增隊伍'),
        h('div', { class: 'row' }, code, name, flag, pw, btn('新增', () => act(() => api('/api/admin/teams', { method: 'POST', body: { code: code.value, name: name.value, flag: flag.value, password: pw.value } }), '已新增'))),
        h('div', { class: 'hint', style: { marginTop: '6px' } }, '旗幟欄可貼 emoji 國旗（🇹🇼 🇩🇪 🇨🇳 🇯🇵…），選手端 Q&A 的 Team 欄會顯示。')
      ),
      h(
        'div',
        { class: 'card' },
        h(
          'table',
          { class: 't' },
          h('tr', null, h('th', null, ''), h('th', null, '代碼'), h('th', null, '名稱'), h('th', null, '旗幟'), h('th', null, '已讀數'), h('th', null, '')),
          d.teams.map((t) => {
            const n = input(t.name);
            const f = input(t.flag, { style: { width: '70px' } });
            return h(
              'tr',
              null,
              h('td', null, h('span', { class: online.has(t.id) ? 'dot-online' : 'dot-offline', title: online.has(t.id) ? '在線' : '離線' })),
              h('td', null, h('b', null, t.code)),
              h('td', null, n),
              h('td', null, f),
              h('td', null, reads(t.id)),
              h(
                'td',
                { style: { textAlign: 'right', whiteSpace: 'nowrap' } },
                btn('儲存', () => act(() => api('/api/admin/teams/' + t.id, { method: 'PUT', body: { name: n.value, flag: f.value } }), '已儲存'), 'btn-sm btn-outlined'),
                ' ',
                btn('改密碼', () => {
                  const p = prompt(`${t.code} 的新密碼`);
                  if (p) act(() => api('/api/admin/teams/' + t.id, { method: 'PUT', body: { password: p } }), '已更新密碼');
                }, 'btn-sm btn-text'),
                btn('清除已讀', () => act(() => api(`/api/admin/teams/${t.id}/reset-reads`, { method: 'POST' }), '已清除'), 'btn-sm btn-text'),
                btn('刪除', () => confirm(`刪除隊伍 ${t.code}？`) && act(() => api('/api/admin/teams/' + t.id, { method: 'DELETE' }), '已刪除'), 'btn-sm btn-text')
              )
            );
          })
        ),
        d.teams.length ? null : h('div', { class: 'hint' }, '尚無隊伍')
      ),
    ];
  }

  function secSettings() {
    const s = S.d.settings;
    const f = {};
    const fields = [
      ['eventName', '賽事名稱（左上）'],
      ['eventPlace', '地點（左上小字）'],
      ['systemName', '系統名稱'],
      ['welcomeText', '首頁歡迎文字'],
      ['version', '版本字串'],
      ['translationLabel', '翻譯語言標籤'],
    ];
    const pw1 = input('', { type: 'password', autocomplete: 'new-password' });
    const importInput = h('input', { type: 'file', accept: 'application/json' });
    return [
      h('h1', null, '系統設定'),
      h(
        'div',
        { class: 'card' },
        h('h2', null, '顯示文字'),
        h('div', { class: 'two' }, fields.map(([k, l]) => field(l, (f[k] = input(s[k]))))),
        h('div', { class: 'row end' }, btn('儲存', () => act(() => api('/api/admin/settings', { method: 'PUT', body: Object.fromEntries(Object.entries(f).map(([k, el]) => [k, el.value])) }), '已儲存')))
      ),
      h(
        'div',
        { class: 'cards' },
        h(
          'div',
          { class: 'card' },
          h('h2', null, '後台密碼'),
          field('新密碼', pw1, s.adminPasswordSet ? '已設定自訂密碼' : '目前使用 ADMIN_PASSWORD 環境變數（預設 admin）'),
          h('div', { class: 'row end' }, btn('更新密碼', () => pw1.value && act(() => api('/api/admin/settings', { method: 'PUT', body: { newAdminPassword: pw1.value } }), '已更新')))
        ),
        h(
          'div',
          { class: 'card' },
          h('h2', null, '備份 / 還原'),
          h('p', { class: 'hint' }, '備份檔包含模組、問答、更新、隊伍與檔案索引（檔案本體在 uploads/ 資料夾）。'),
          h('div', { class: 'row' }, h('a', { class: 'btn btn-outlined', href: '/api/admin/export' }, '下載備份 JSON')),
          h('div', { class: 'row', style: { marginTop: '10px' } }, importInput, btn('還原', async () => {
            if (!importInput.files[0] || !confirm('用備份檔覆蓋目前資料？')) return;
            const json = JSON.parse(await importInput.files[0].text());
            act(() => api('/api/admin/import', { method: 'POST', body: json }), '已還原');
          }, 'btn-warning'))
        ),
        h(
          'div',
          { class: 'card' },
          h('h2', null, '重新開始一輪模擬'),
          h('p', { class: 'hint' }, '清空所有問答、已讀、通知，所有模組回到「未開放」，計時器歸零。題目檔案、任務更新、隊伍保留。'),
          btn('重設競賽', () => confirm('確定清空問答並關閉所有模組？') && act(() => api('/api/admin/reset-competition', { method: 'POST' }), '已重設'), 'btn-danger')
        )
      ),
    ];
  }

  // ------------------------------------------------------------ shell
  function pageLogin() {
    const pw = h('input', { class: 'input', type: 'password', id: 'apw', autocomplete: 'current-password' });
    const err = h('div', { class: 'err' });
    const form = h(
      'form',
      {
        class: 'login-card',
        onsubmit: async (e) => {
          e.preventDefault();
          try {
            await api('/api/admin/login', { method: 'POST', body: { password: pw.value } });
            boot();
          } catch (ex) {
            err.textContent = ex.message;
          }
        },
      },
      h('h1', null, 'WSCCS 裁判後台'),
      h('p', { class: 'muted', style: { marginTop: 0 } }, 'Expert / Admin'),
      field('管理員密碼', pw),
      err,
      h('button', { class: 'btn', type: 'submit', style: { width: '100%' } }, '登入')
    );
    setTimeout(() => pw.focus(), 0);
    app.replaceChildren(h('div', { class: 'page' }, form));
  }

  function render() {
    if (!S.d) return;
    const cur = sec();
    const openQ = S.d.questions.filter((q) => q.status === 'open').length;
    const side = h(
      'nav',
      { class: 'side' },
      h('div', { class: 'logo' }, h('span', { class: 'mk', html: icons.mark }), h('div', null, 'WSCCS 後台', h('small', null, S.d.settings.eventName))),
      SECTIONS.map(([k, l]) => h('a', { href: '#/' + k, class: cur === k ? 'on' : '' }, h('span', null, l), k === 'qa' && openQ ? h('span', { class: 'cnt' }, openQ) : null)),
      h('div', { class: 'grow' }),
      h(
        'div',
        { class: 'foot' },
        h('a', { href: '/', target: '_blank' }, '開啟選手端 ↗'),
        h('a', {
          href: '#',
          onclick: async (e) => {
            e.preventDefault();
            await api('/api/admin/logout', { method: 'POST' });
            location.reload();
          },
        }, '登出')
      )
    );
    const fn = { dash: secDash, qa: secQA, modules: secModules, updates: secUpdates, docs: secDocs, teams: secTeams, settings: secSettings }[cur] || secDash;
    const y = window.scrollY;
    const active = document.activeElement;
    const activeKey = active && active.dataset && active.dataset.k;
    app.replaceChildren(h('div', { class: 'adm' }, side, h('main', { class: 'main' }, fn())));
    window.scrollTo(0, y);
    if (activeKey) {
      const el = document.querySelector(`[data-k="${activeKey}"]`);
      if (el) el.focus();
    }
    document.title = (openQ ? `(${openQ}) ` : '') + 'WSCCS 裁判後台';
  }

  // 使用者正在輸入時延後刷新，避免游標跳走
  let pending = false;
  function softRefresh() {
    const a = document.activeElement;
    const typing = a && (a.tagName === 'TEXTAREA' || (a.tagName === 'INPUT' && a.type !== 'checkbox' && a.type !== 'file'));
    if (typing) {
      if (!pending) {
        pending = true;
        a.addEventListener(
          'blur',
          () => {
            pending = false;
            softRefresh();
          },
          { once: true }
        );
      }
      return;
    }
    refresh().then(render).catch(() => {});
  }

  function tick() {
    const el = document.getElementById('adm-clock');
    if (!el || !S.d) return;
    const td = WS.timerDisplay(S.d.timer, S.offset);
    el.textContent = td.text;
    el.className = 'big-clock ' + td.cls;
  }
  setInterval(tick, 250);

  async function boot() {
    try {
      await refresh();
    } catch (e) {
      if (e.status === 401) return pageLogin();
      throw e;
    }
    render();
    WS.connectEvents({
      question: (q) => {
        WS.beep('answer');
        WS.toast(`新問題 · ${q.teamCode}`, q.text, 'update', () => (location.hash = '#/qa'));
        softRefresh();
      },
      timer: (d) => {
        S.d.timer = d.timer;
        S.offset = d.serverNow - Date.now();
        if (sec() === 'dash') softRefresh();
      },
      'state-changed': softRefresh,
      'module-changed': softRefresh,
      notify: softRefresh,
    });
    // 在線狀態每 20 秒更新一次
    setInterval(() => sec() === 'dash' && softRefresh(), 20000);
  }

  window.addEventListener('hashchange', render);
  boot();
})();
