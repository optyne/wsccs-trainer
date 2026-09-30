// 選手端（Competitor）— Home / Documentation / Tasks
(function () {
  const { h, icon, icons, api } = WS;
  const app = document.getElementById('app');

  const S = {
    pub: null,
    st: null, // /api/state
    mod: null, // /api/modules/:id
    offset: 0,
    lang: WS.ls.get('wsccs_lang', 'en'), // 'en' | 'all'
    notifs: [],
    unseen: 0,
    connected: true,
    menuOpen: false,
    lastModuleId: WS.ls.get('wsccs_last_module', null),
  };

  // ------------------------------------------------------------ routing
  function route() {
    const hsh = location.hash.replace(/^#/, '') || '/';
    const parts = hsh.split('/').filter(Boolean);
    return { page: parts[0] || 'home', id: parts[1] || null };
  }
  const go = (path) => (location.hash = path);

  // ------------------------------------------------------------ data
  async function loadState() {
    S.st = await api('/api/state');
    S.offset = S.st.serverNow - Date.now();
  }

  async function loadModule(id) {
    try {
      S.mod = await api('/api/modules/' + id);
    } catch (e) {
      S.mod = { error: e.message };
    }
  }

  async function loadNotifs() {
    try {
      S.notifs = (await api('/api/notifications')).notifications;
    } catch {}
  }

  // ------------------------------------------------------------ header
  function header() {
    const st = S.st;
    const r = route();
    const set = st ? st.settings : S.pub.settings;
    const brand = h(
      'button',
      { class: 'btn brand-btn', type: 'button', onclick: () => go('/'), 'aria-label': 'Home' },
      h('span', { class: 'brand-mark', html: icons.mark }),
      h('span', { class: 'brand-text hide-lg-down' }, h('b', null, set.eventName), h('small', null, set.eventPlace))
    );
    const start = h('div', { class: 'header-start' }, brand);
    if (st) {
      if (st.features.docsPage)
        start.appendChild(
          h(
            'button',
            { class: 'btn btn-text' + (r.page === 'docs' ? ' active' : ''), type: 'button', onclick: () => go('/docs') },
            h('span', { class: 'hide-md-down', style: { display: 'inline-flex' }, html: icons.file }),
            'Documentation'
          )
        );
      if (st.features.tasksPage)
        start.appendChild(
          h(
            'button',
            { class: 'btn btn-text' + (r.page === 'tasks' ? ' active' : ''), type: 'button', onclick: () => go('/tasks') },
            h('span', { class: 'hide-md-down', style: { display: 'inline-flex' }, html: icons.list }),
            'Tasks'
          )
        );
    }
    const end = h('div', { class: 'header-end' });
    if (st) {
      const td = WS.timerDisplay(st.timer, S.offset);
      end.appendChild(
        h(
          'div',
          { class: 'clock ' + td.cls, id: 'clock', title: st.timer.label || 'Competition time' },
          st.timer.label ? h('span', { class: 'clock-label' }, st.timer.label) : null,
          h('span', { id: 'clock-text' }, td.text)
        )
      );
      const me = st.me;
      const menu = S.menuOpen
        ? h(
            'div',
            { class: 'menu', id: 'nav_user_menu', role: 'menu' },
            h('button', { type: 'button', role: 'menuitem', onclick: logout }, h('span', { html: icons.logout }), 'Logout')
          )
        : null;
      end.appendChild(
        h(
          'button',
          {
            class: 'team-btn',
            type: 'button',
            'aria-haspopup': 'true',
            'aria-expanded': S.menuOpen ? 'true' : 'false',
            onclick: (e) => {
              e.stopPropagation();
              S.menuOpen = !S.menuOpen;
              render();
            },
          },
          h('span', { class: 'team-meta hide-lg-down' }, h('b', null, me.code), h('small', null, me.name)),
          h('span', { class: 'flag' }, me.flag || me.code.slice(0, 2)),
          menu
        )
      );
    }
    return [h('div', { class: 'ws-navbar-stripe' }), h('div', { class: 'header' }, start, end)];
  }

  // ------------------------------------------------------------ pages
  function pageLogin() {
    const err = h('div', { class: 'err' });
    const code = h('input', { class: 'input', id: 'code', autocomplete: 'username', placeholder: 'e.g. TW', required: true });
    const pw = h('input', { class: 'input', id: 'pw', type: 'password', autocomplete: 'current-password', required: true });
    const btn = h('button', { class: 'btn', type: 'submit', style: { width: '100%' } }, 'Login');
    const form = h(
      'form',
      {
        class: 'login-card',
        onsubmit: async (e) => {
          e.preventDefault();
          btn.disabled = true;
          err.textContent = '';
          try {
            await api('/api/login', { method: 'POST', body: { code: code.value, password: pw.value } });
            await boot();
          } catch (ex) {
            err.textContent = ex.message;
            btn.disabled = false;
          }
        },
      },
      h('h1', null, S.pub.settings.systemName || 'WSCCS'),
      h('p', { class: 'muted', style: { marginTop: 0 } }, 'Sign in with the team credentials from your letter.'),
      h('div', { class: 'field' }, h('label', { for: 'code' }, 'Team code / 隊伍代碼'), code),
      h('div', { class: 'field' }, h('label', { for: 'pw' }, 'Password / 密碼'), pw),
      err,
      btn
    );
    setTimeout(() => code.focus(), 0);
    return h('div', { class: 'page' }, form);
  }

  function pageHome() {
    const set = S.st.settings;
    return h(
      'div',
      { class: 'page' },
      h(
        'div',
        { class: 'greeting' },
        h('div', { class: 'logo-big', style: { color: '#4a0d66' }, html: icons.mark }),
        h('p', { class: 'welcome' }, set.welcomeText || 'Welcome to ' + set.systemName)
      ),
      h('div', { class: 'spacer' }),
      h(
        'div',
        { class: 'greeting', style: { marginTop: 0 } },
        h('p', { class: 'version' }, 'Version : ' + set.version),
        h('p', { class: 'version' }, new Date(S.st.serverNow).toISOString())
      )
    );
  }

  function fs(title, body, cls) {
    return h(
      'fieldset',
      { class: 'fs ' + (cls || '') },
      h('legend', null, h('span', { class: 'legend-box' }, title)),
      body
    );
  }

  function langSwitch() {
    if (!S.st.features.translations) return null;
    const mk = (val, label) =>
      h(
        'button',
        {
          type: 'button',
          'aria-pressed': S.lang === val ? 'true' : 'false',
          onclick: () => {
            S.lang = val;
            WS.ls.set('wsccs_lang', val);
            render();
          },
        },
        label
      );
    return h('div', { class: 'selectbutton', role: 'group' }, mk('en', 'English'), mk('all', 'All Translations'));
  }

  function bar(start) {
    return h('div', { class: 'bar' }, h('div', null, start || null), langSwitch());
  }

  function fileButton(f) {
    const disabled = !S.st.features.downloads;
    return h(
      'p',
      null,
      h(
        'a',
        {
          class: 'btn btn-outlined btn-rounded',
          href: disabled ? null : '/api/files/' + f.id,
          'aria-disabled': disabled ? 'true' : null,
          style: disabled ? { opacity: 0.55, pointerEvents: 'none' } : null,
          title: WS.fmtSize(f.size),
        },
        h('span', { html: icons.download, style: { display: 'inline-flex' } }),
        f.name,
        f.lang !== 'en' ? h('span', { class: 'lang-tag' }, f.langLabel) : null
      )
    );
  }

  function fileList(files, emptyText) {
    const list = files.filter((f) => S.lang === 'all' || !S.st.features.translations || f.lang === 'en');
    return h(
      'div',
      { class: 'file-list' },
      bar(),
      list.length ? list.map(fileButton) : h('div', { class: 'info-msg' }, emptyText)
    );
  }

  function chip(label, kind) {
    return h(
      'div',
      { class: 'chipwrap' },
      h('span', { class: 'chip ' + kind }, h('span', { class: 'dot', html: icons.user }), label)
    );
  }

  // 雙語文字列：ENGLISH（主）+ 翻譯（All Translations 時）
  function bilingual(en, zh, trKind = 'tr') {
    const tr = S.st.settings.translationLabel || 'TW:ZHO';
    const out = [];
    if (en) out.push(h('div', { class: 'tline' }, chip('ENGLISH', 'en'), h('div', { class: 'ttext en' }, WS.richText(en))));
    if (zh && (S.lang === 'all' || !en))
      out.push(h('div', { class: 'tline' }, chip(tr, trKind), h('div', { class: 'ttext' }, WS.richText(zh))));
    return out;
  }

  function readBox(key, read) {
    if (!S.st.features.readMarks) return h('div', { class: 'col-read' });
    return h(
      'div',
      { class: 'col-read' },
      h('input', {
        type: 'checkbox',
        class: 'cb',
        'aria-label': 'Mark as read',
        checked: read ? true : null,
        onchange: async (e) => {
          try {
            await api('/api/read', { method: 'POST', body: { key, read: e.target.checked } });
            await Promise.all([loadState(), loadModule(S.mod.module.id)]);
            render();
          } catch (ex) {
            WS.toast('Error', ex.message);
          }
        },
      })
    );
  }

  function updatesTable(updates) {
    const head = h(
      'div',
      { class: 'tbl-head' },
      h('div', { class: 'col-half' }, 'Description'),
      h('div', { class: 'col-half' }, 'Files'),
      h('div', { class: 'col-time hide-lg-down', style: { paddingTop: '8px' } }, 'Updated'),
      S.st.features.readMarks ? h('div', { class: 'col-read hide-lg-down' }, 'Read') : null
    );
    if (!updates.length) return [head, h('div', { class: 'tbl-empty' }, h('div', { class: 'info-msg' }, 'No updates for this task yet.'))];
    return [
      head,
      updates.map((u) =>
        h(
          'div',
          { class: 'tbl-row' + (!u.read && S.st.features.readMarks ? ' unread' : '') },
          h('div', { class: 'col-half' }, bilingual(u.textEn, u.textZh)),
          h('div', { class: 'col-half file-list' }, u.files.map(fileButton)),
          h('div', { class: 'col-time', title: WS.fmtDateTime(u.createdAt) }, WS.fmtTime(u.createdAt)),
          readBox('u:' + u.id, u.read)
        )
      ),
    ];
  }

  function qaTable(qs) {
    const head = h(
      'div',
      { class: 'tbl-head' },
      h('div', { class: 'col-team', style: { paddingTop: '8px' } }, 'Team'),
      h('div', { class: 'col-half' }, 'Question'),
      h('div', { class: 'col-half' }, 'Answer'),
      h('div', { class: 'col-time hide-lg-down', style: { paddingTop: '8px' } }, 'Updated'),
      S.st.features.readMarks ? h('div', { class: 'col-read hide-lg-down' }, 'Read') : null
    );
    if (!qs.length) return [head, h('div', { class: 'tbl-empty' }, h('div', { class: 'info-msg' }, 'No questions for this task yet.'))];
    return [
      head,
      qs.map((q) => {
        const answered = q.status === 'answered';
        const cls = 'tbl-row' + (!answered ? ' pending' : !q.read && S.st.features.readMarks ? ' unread' : '');
        return h(
          'div',
          { class: cls },
          h(
            'div',
            { class: 'col-team' },
            h('span', { class: 'flag small', title: q.team.name }, q.team.flag || '🏳️'),
            h('span', null, q.team.code),
            q.mine ? h('span', { class: 'mine-tag' }, 'yours') : null
          ),
          h('div', { class: 'col-half' }, bilingual(q.text, q.textZh, 'qtr')),
          h(
            'div',
            { class: 'col-half' },
            answered ? bilingual(q.answerEn, q.answerZh) : h('span', { class: 'pending-tag' }, 'Waiting for answer…')
          ),
          h('div', { class: 'col-time', title: WS.fmtDateTime(q.updatedAt) }, WS.fmtTime(q.updatedAt)),
          answered ? readBox('q:' + q.id, q.read) : h('div', { class: 'col-read' })
        );
      }),
    ];
  }

  function newQuestionDialog() {
    const m = S.mod.module;
    const ta = h('textarea', {
      class: 'input',
      id: 'qtext',
      placeholder: 'Please refer to a specification number (e.g. "3.14 …").\n可用中文或英文提問。',
      maxlength: 4000,
    });
    const err = h('div', { class: 'err' });
    const send = h('button', { class: 'btn btn-warning', type: 'button' }, 'Submit');
    const d = WS.dialog({
      title: `New Question — ${m.name}`,
      body: [h('div', { class: 'field' }, h('label', { for: 'qtext' }, 'Question'), ta), err],
      foot: [h('button', { class: 'btn btn-secondary', type: 'button', onclick: () => d.close() }, 'Cancel'), send],
    });
    send.addEventListener('click', async () => {
      if (!ta.value.trim()) return (err.textContent = 'Please enter a question.');
      send.disabled = true;
      try {
        await api(`/api/modules/${m.id}/questions`, { method: 'POST', body: { text: ta.value } });
        d.close();
        WS.toast('Question submitted', 'The experts will answer it here.', 'update');
        await loadModule(m.id);
        render();
      } catch (ex) {
        err.textContent = ex.message;
        send.disabled = false;
      }
    });
    setTimeout(() => ta.focus(), 0);
  }

  function pageTasks() {
    const st = S.st;
    const r = route();
    const tabs = h(
      'div',
      { class: 'module-tabs' },
      st.allModules.map((m) => {
        const released = st.modules.find((x) => x.id === m.id);
        const active = r.id === m.id;
        return h(
          'button',
          {
            class: 'btn ' + (active ? '' : 'btn-link'),
            type: 'button',
            disabled: !released ? true : null,
            title: released ? m.day : 'Not released yet',
            onclick: () => go('/tasks/' + m.id),
          },
          !released ? h('span', { html: icons.lock, style: { display: 'inline-flex' } }) : null,
          m.name,
          released && released.unread ? h('span', { class: 'badge' }, released.unread) : null
        );
      })
    );
    const wrap = h('div', { class: 'page' }, h('div', { class: 'container' }, tabs));
    const c = wrap.firstChild;
    if (!r.id) {
      c.appendChild(
        h(
          'div',
          { class: 'info-msg center' },
          st.modules.length ? 'Please select a task above.' : 'No tasks have been released yet. Please wait for the experts.'
        )
      );
      return wrap;
    }
    if (!S.mod || S.mod.error) {
      c.appendChild(h('div', { class: 'warn-msg center' }, (S.mod && S.mod.error) || 'Loading…'));
      return wrap;
    }
    const { module: m, briefingFiles, taskFiles, updates, questions } = S.mod;
    const tr = st.settings.translationLabel || 'TW:ZHO';
    c.appendChild(
      fs(
        'Task Information',
        h(
          'div',
          { class: 'task-info' },
          h(
            'div',
            { class: 'main' },
            h('h2', null, `${m.name} : ${m.title}`),
            m.description ? h('div', { class: 'rich' }, WS.richText(m.description)) : null,
            m.descriptionZh && (S.lang === 'all' || !m.description)
              ? h('div', { style: { marginTop: '14px' } }, h('div', { class: 'tline' }, chip(tr, 'tr')), h('div', { class: 'rich', style: { marginTop: '6px' } }, WS.richText(m.descriptionZh)))
              : null
          )
        )
      )
    );
    c.appendChild(
      h(
        'div',
        { class: 'grid-2' },
        fs('Briefing Files', fileList(briefingFiles, 'There are no briefing files for this task')),
        fs('Task Files', fileList(taskFiles, 'There are no task files for this task'))
      )
    );
    c.appendChild(fs('Task Updates', [bar(), updatesTable(updates)]));
    const allowed = m.questionsAllowed;
    c.appendChild(
      fs(
        'Questions & Answers',
        [
          bar(
            h(
              'button',
              {
                class: 'btn btn-warning',
                type: 'button',
                disabled: allowed ? null : true,
                title: allowed ? '' : 'Questions are currently closed',
                onclick: newQuestionDialog,
              },
              'New Question'
            )
          ),
          qaTable(questions),
        ],
        'qa'
      )
    );
    return wrap;
  }

  async function pageDocs() {
    const wrap = h('div', { class: 'page' }, h('div', { class: 'container' }));
    let files = [];
    try {
      files = (await api('/api/docs')).files;
    } catch (e) {
      wrap.firstChild.appendChild(h('div', { class: 'warn-msg' }, e.message));
      return wrap;
    }
    wrap.firstChild.appendChild(fs('Documentation', fileList(files, 'No documentation has been published.')));
    return wrap;
  }

  // ------------------------------------------------------------ notifications
  function historyButton() {
    return h(
      'button',
      {
        class: 'history-btn',
        type: 'button',
        'aria-label': 'Notification history',
        onclick: async () => {
          await loadNotifs();
          S.unseen = 0;
          render();
          WS.dialog({
            title: 'Notification history',
            body: S.notifs.length
              ? h(
                  'ul',
                  { class: 'nlist' },
                  S.notifs.map((n) =>
                    h(
                      'li',
                      null,
                      h('time', null, WS.fmtDateTime(n.ts)),
                      h('div', null, h('b', null, n.text)),
                      n.preview ? h('div', { class: 'muted' }, n.preview) : null
                    )
                  )
                )
              : h('div', { class: 'info-msg' }, 'No notifications yet.'),
          });
        },
      },
      h('span', { html: icons.clock, style: { display: 'inline-flex' } }),
      S.unseen ? h('span', { class: 'badge' }, S.unseen) : null
    );
  }

  // ------------------------------------------------------------ render
  let renderSeq = 0;
  async function render() {
    const seq = ++renderSeq;
    const r = route();
    let page;
    if (!S.st) page = pageLogin();
    else if (r.page === 'docs' && S.st.features.docsPage) page = await pageDocs();
    else if (r.page === 'tasks' && S.st.features.tasksPage) page = pageTasks();
    else page = pageHome();
    if (seq !== renderSeq) return;
    const y = window.scrollY;
    app.replaceChildren(...header(), page, S.st ? historyButton() : '', !S.connected && S.st ? h('div', { class: 'conn' }, 'Reconnecting…') : '');
    window.scrollTo(0, y);
  }

  async function onRoute() {
    const r = route();
    S.menuOpen = false;
    if (S.st && r.page === 'tasks') {
      if (!r.id) {
        const pick = S.st.modules.find((m) => m.id === S.lastModuleId) || S.st.modules[S.st.modules.length - 1];
        if (pick) return go('/tasks/' + pick.id);
      } else {
        S.lastModuleId = r.id;
        WS.ls.set('wsccs_last_module', r.id);
        if (!S.mod || !S.mod.module || S.mod.module.id !== r.id) {
          S.mod = null;
          render();
        }
        await loadModule(r.id);
      }
    }
    render();
  }

  async function logout() {
    await api('/api/logout', { method: 'POST' }).catch(() => {});
    location.hash = '/';
    location.reload();
  }

  let stopEvents = null;
  function startEvents() {
    if (stopEvents) stopEvents();
    stopEvents = WS.connectEvents(
      {
        timer: (d) => {
          S.st.timer = d.timer;
          S.offset = d.serverNow - Date.now();
          tick();
        },
        'state-changed': async () => {
          await loadState();
          const r = route();
          if (r.page === 'tasks' && r.id) await loadModule(r.id);
          render();
        },
        'module-changed': async (d) => {
          await loadState();
          const r = route();
          if (r.page === 'tasks' && r.id && (!d.moduleId || d.moduleId === r.id)) await loadModule(r.id);
          render();
        },
        notify: async (n) => {
          S.unseen++;
          if (S.st.features.notifySound) WS.beep(n.type);
          const titles = { answer: 'New answer', update: 'New task update', release: 'Task released', message: 'Message from experts' };
          WS.toast(titles[n.type] || 'Notification', n.type === 'message' ? n.text : n.preview || n.text, n.type, () => {
            if (n.moduleId) go('/tasks/' + n.moduleId);
          });
          await loadState();
          const r = route();
          if (r.page === 'tasks' && r.id && n.moduleId === r.id) await loadModule(r.id);
          render();
        },
      },
      (ok) => {
        if (S.connected !== ok) {
          S.connected = ok;
          if (ok) loadState().then(render).catch(() => {});
          else render();
        }
      }
    );
  }

  function tick() {
    const el = document.getElementById('clock');
    if (!el || !S.st) return;
    const td = WS.timerDisplay(S.st.timer, S.offset);
    el.className = 'clock ' + td.cls;
    const t = document.getElementById('clock-text');
    if (t) t.textContent = td.text;
  }
  setInterval(tick, 250);

  document.addEventListener('click', () => {
    if (S.menuOpen) {
      S.menuOpen = false;
      render();
    }
  });
  window.addEventListener('hashchange', onRoute);

  async function boot() {
    S.pub = await api('/api/public');
    document.title = 'WS CCS';
    try {
      await loadState();
      await loadNotifs();
      startEvents();
    } catch (e) {
      if (e.status !== 401) console.error(e);
      S.st = null;
    }
    await onRoute();
  }

  boot();
})();
