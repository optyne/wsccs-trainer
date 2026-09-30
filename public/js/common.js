// 共用工具：DOM 建構、API、圖示、計時器、提示音、SSE
(function () {
  const W = (window.WS = {});

  W.h = function h(tag, attrs, ...children) {
    const el = document.createElement(tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (v === undefined || v === null || v === false) continue;
        if (k === 'class') el.className = v;
        else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
        else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
        else if (k === 'html') el.innerHTML = v;
        else if (v === true) el.setAttribute(k, '');
        else el.setAttribute(k, v);
      }
    }
    for (const c of children.flat(Infinity)) {
      if (c === null || c === undefined || c === false) continue;
      el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
    }
    return el;
  };

  const svg = (d, extra = '') =>
    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ${extra}>${d}</svg>`;
  W.icons = {
    file: svg('<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/>'),
    list: svg('<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>'),
    download: svg('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/>'),
    clock: svg('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/>'),
    user: svg('<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>'),
    lock: svg('<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>'),
    logout: svg('<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/>'),
    bell: svg('<path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/>'),
    plus: svg('<path d="M12 5v14M5 12h14"/>'),
    trash: svg('<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/>'),
    edit: svg('<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>'),
    check: svg('<path d="M20 6L9 17l-5-5"/>'),
    // 通用品牌記號（非任何組織商標）
    mark: `<svg viewBox="0 0 32 32" fill="currentColor"><path d="M16 2l3.6 7.4 8.1 1.2-5.9 5.7 1.4 8.1L16 20.6l-7.2 3.8 1.4-8.1-5.9-5.7 8.1-1.2z" opacity=".95"/></svg>`,
  };
  W.icon = (name, cls) => {
    const s = document.createElement('span');
    s.className = 'ico ' + (cls || '');
    s.style.display = 'inline-flex';
    s.innerHTML = W.icons[name] || '';
    return s;
  };

  W.api = async function api(url, opts = {}) {
    const o = { credentials: 'same-origin', ...opts, headers: { ...(opts.headers || {}) } };
    if (o.body && !(o.body instanceof FormData) && typeof o.body !== 'string') {
      o.body = JSON.stringify(o.body);
      o.headers['Content-Type'] = 'application/json';
    }
    const res = await fetch(url, o);
    let data = null;
    try {
      data = await res.json();
    } catch {
      data = null;
    }
    if (!res.ok) {
      const err = new Error((data && data.error) || res.statusText || 'Error');
      err.status = res.status;
      throw err;
    }
    return data;
  };

  const pad = (n) => String(Math.floor(n)).padStart(2, '0');
  W.fmtDuration = (ms) => {
    const s = Math.max(0, Math.floor(ms / 1000));
    return `${pad(s / 3600)}:${pad((s % 3600) / 60)}:${pad(s % 60)}`;
  };
  // 回傳 {text, cls}
  W.timerDisplay = (timer, offsetMs) => {
    const now = Date.now() + (offsetMs || 0);
    const elapsed = (timer.accumulatedMs || 0) + (timer.state === 'running' && timer.startedAt ? now - timer.startedAt : 0);
    let text;
    let cls = timer.state;
    if (timer.durationMs > 0) {
      const remain = timer.durationMs - elapsed;
      if (remain >= 0) text = '-' + W.fmtDuration(remain);
      else {
        text = '+' + W.fmtDuration(-remain);
        if (timer.state !== 'stopped') cls += ' overtime';
      }
    } else text = '+' + W.fmtDuration(elapsed);
    return { text, cls, elapsed };
  };

  W.fmtTime = (ts) => {
    if (!ts) return '';
    return new Date(ts).toLocaleTimeString('zh-TW', { hour12: true, hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };
  W.fmtDateTime = (ts) => (ts ? new Date(ts).toLocaleString('zh-TW', { hour12: false }) : '');
  W.fmtSize = (n) => {
    if (!n && n !== 0) return '';
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    return (n / 1024 / 1024).toFixed(1) + ' MB';
  };

  // 文字 → 安全的節點（保留換行、自動連結 URL）
  W.richText = (text) => {
    const frag = document.createDocumentFragment();
    const parts = String(text || '').split(/(https?:\/\/[^\s<>"')]+)/g);
    parts.forEach((p, i) => {
      if (i % 2 === 1) frag.appendChild(W.h('a', { href: p, target: '_blank', rel: 'noopener' }, p));
      else frag.appendChild(document.createTextNode(p));
    });
    return frag;
  };

  // 提示音（WebAudio 合成，不需音檔）
  let actx = null;
  W.beep = (kind = 'answer') => {
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      const notes = kind === 'answer' ? [880, 1175, 1568] : kind === 'update' ? [660, 880] : [740];
      notes.forEach((f, i) => {
        const o = actx.createOscillator();
        const g = actx.createGain();
        o.type = 'sine';
        o.frequency.value = f;
        const t0 = actx.currentTime + i * 0.16;
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.exponentialRampToValueAtTime(0.25, t0 + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.28);
        o.connect(g).connect(actx.destination);
        o.start(t0);
        o.stop(t0 + 0.3);
      });
    } catch {
      /* 瀏覽器未允許音效 */
    }
  };
  // 使用者第一次互動後解鎖音效
  document.addEventListener(
    'pointerdown',
    () => {
      try {
        actx = actx || new (window.AudioContext || window.webkitAudioContext)();
        actx.resume();
      } catch {}
    },
    { once: true }
  );

  W.toast = (title, sub, kind = '', onClick) => {
    let box = document.querySelector('.toasts');
    if (!box) {
      box = W.h('div', { class: 'toasts' });
      document.body.appendChild(box);
    }
    const t = W.h('div', { class: 'toast ' + kind, role: 'status' }, W.h('b', null, title), sub ? W.h('small', null, sub) : null);
    t.addEventListener('click', () => {
      t.remove();
      onClick && onClick();
    });
    box.prepend(t);
    setTimeout(() => t.remove(), 9000);
  };

  W.dialog = ({ title, body, foot, wide }) => {
    const close = () => ov.remove();
    const ov = W.h(
      'div',
      { class: 'overlay', onclick: (e) => e.target === ov && close() },
      W.h(
        'div',
        { class: 'dialog', role: 'dialog', 'aria-modal': 'true', style: wide ? { maxWidth: '900px' } : null },
        W.h('div', { class: 'dialog-head' }, title, W.h('button', { class: 'x-btn', 'aria-label': 'Close', onclick: close }, '×')),
        W.h('div', { class: 'dialog-body' }, body),
        foot ? W.h('div', { class: 'dialog-foot' }, foot) : null
      )
    );
    document.addEventListener('keydown', function esc(e) {
      if (e.key === 'Escape') {
        close();
        document.removeEventListener('keydown', esc);
      }
    });
    document.body.appendChild(ov);
    return { close, el: ov };
  };

  W.connectEvents = (handlers, onStatus) => {
    let es;
    const open = () => {
      es = new EventSource('/api/events');
      es.onopen = () => onStatus && onStatus(true);
      es.onerror = () => onStatus && onStatus(false);
      for (const [type, fn] of Object.entries(handlers)) {
        es.addEventListener(type, (e) => {
          let data = {};
          try {
            data = JSON.parse(e.data || '{}');
          } catch {}
          fn(data);
        });
      }
    };
    open();
    return () => es && es.close();
  };

  W.ls = {
    get(k, d) {
      try {
        const v = localStorage.getItem(k);
        return v === null ? d : JSON.parse(v);
      } catch {
        return d;
      }
    },
    set(k, v) {
      try {
        localStorage.setItem(k, JSON.stringify(v));
      } catch {}
    },
  };
})();
