/* 공용 포맷·DOM·UI 헬퍼 */

export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];

export function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
/** 외부 링크는 http(s)만 허용 */
export function safeUrl(u) {
  try { const x = new URL(String(u)); return /^https?:$/.test(x.protocol) ? x.href : '#'; } catch { return '#'; }
}
/** 네이버 검색 결과의 <b> 태그·엔티티 제거 */
export function plain(v) {
  const t = document.createElement('textarea');
  t.innerHTML = String(v ?? '').replace(/<[^>]+>/g, '');
  return t.value;
}

const nf = new Intl.NumberFormat('ko-KR');
export const fmt = {
  n: (v, d = 0) => (v === null || v === undefined || !Number.isFinite(+v) ? '—'
    : (+v).toLocaleString('ko-KR', { minimumFractionDigits: d, maximumFractionDigits: d })),
  int: (v) => (v === null || v === undefined || !Number.isFinite(+v) ? '—' : nf.format(Math.round(+v))),
  pct: (v, d = 2, sign = true) => (v === null || v === undefined || !Number.isFinite(+v) ? '—'
    : `${sign && v > 0 ? '+' : ''}${(+v).toFixed(d)}%`),
  signed: (v, d = 0) => (v === null || v === undefined || !Number.isFinite(+v) ? '—'
    : `${v > 0 ? '+' : ''}${fmt.n(v, d)}`),
  /** 원 → 조/억 */
  won(v) {
    if (v === null || v === undefined || !Number.isFinite(+v)) return '—';
    const a = Math.abs(v);
    if (a >= 1e12) return `${(v / 1e12).toFixed(2)}조`;
    if (a >= 1e8) return `${fmt.n(v / 1e8, 0)}억`;
    if (a >= 1e4) return `${fmt.n(v / 1e4, 0)}만`;
    return fmt.n(v);
  },
  /** 원 → 억원 숫자 */
  eok: (v) => (v === null || v === undefined || !Number.isFinite(+v) ? '—' : fmt.n(v / 1e8, 0)),
  date(s) {
    const t = String(s || '');
    if (/^\d{8}$/.test(t)) return `${t.slice(0, 4)}.${t.slice(4, 6)}.${t.slice(6)}`;
    if (/^\d{6}$/.test(t)) return `${t.slice(0, 4)}.${t.slice(4)}`;
    return t;
  },
  ago(dateLike) {
    const d = new Date(dateLike);
    if (Number.isNaN(d.getTime())) return '';
    const m = Math.round((Date.now() - d.getTime()) / 60000);
    if (m < 1) return '방금';
    if (m < 60) return `${m}분 전`;
    if (m < 1440) return `${Math.round(m / 60)}시간 전`;
    if (m < 10080) return `${Math.round(m / 1440)}일 전`;
    return `${d.getMonth() + 1}.${d.getDate()}`;
  },
};

export const dirClass = (v) => (v > 0 ? 'up' : v < 0 ? 'dn' : 'flat');
export const arrow = (v) => (v > 0 ? '▲' : v < 0 ? '▼' : '—');

export function toast(msg, kind = '') {
  const wrap = $('#toastWrap');
  if (!wrap) return;
  const el = document.createElement('div');
  el.className = `toast-msg ${kind}`;
  el.innerHTML = `<span class="t-ico">${kind === 'warn' ? '!' : 'i'}</span><span>${esc(msg)}</span>`;
  wrap.appendChild(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 240); }, 2600);
}

export function skeleton(h = 120) {
  return `<div class="skel-box" style="height:${h}px"></div>`;
}

export function errorBox(err, retryId = '') {
  return `<div class="state-box err"><div class="state-ico">!</div><div><b>불러오지 못했습니다</b><p>${esc(err)}</p>
    ${retryId ? `<button class="btn sm" data-retry="${retryId}">다시 시도</button>` : ''}</div></div>`;
}
export function emptyBox(msg) {
  return `<div class="state-box"><div class="state-ico">·</div><div><p>${esc(msg)}</p></div></div>`;
}

/** 카운트업 애니메이션 (숫자 텍스트) */
export function countUp(el, to, formatter, ms = 700) {
  if (!el || !Number.isFinite(to)) return;
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) { el.textContent = formatter(to); return; }
  const from = 0;
  const t0 = performance.now();
  const ease = (t) => 1 - Math.pow(1 - t, 4);
  const step = (now) => {
    const p = Math.min(1, (now - t0) / ms);
    el.textContent = formatter(from + (to - from) * ease(p));
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

/** 세그먼트 컨트롤 (슬라이딩 인디케이터) */
export function segmented(name, options, value) {
  return `<div class="seg" role="tablist" data-seg="${name}">
    <span class="seg-ind" aria-hidden="true"></span>
    ${options.map(([v, label]) => `<button role="tab" class="seg-btn${v === value ? ' on' : ''}" data-v="${v}" aria-selected="${v === value}">${esc(label)}</button>`).join('')}
  </div>`;
}
export function placeSegInd(root = document) {
  $$('.seg', root).forEach((seg) => {
    const on = $('.seg-btn.on', seg);
    const ind = $('.seg-ind', seg);
    if (!on || !ind) return;
    ind.style.width = on.offsetWidth + 'px';
    ind.style.transform = `translateX(${on.offsetLeft - 3}px)`;
  });
}
export function onSeg(root, name, cb) {
  const seg = $(`.seg[data-seg="${name}"]`, root);
  if (!seg) return;
  seg.addEventListener('click', (e) => {
    const b = e.target.closest('.seg-btn');
    if (!b || b.classList.contains('on')) return;
    $$('.seg-btn', seg).forEach((x) => { x.classList.toggle('on', x === b); x.setAttribute('aria-selected', String(x === b)); });
    placeSegInd(seg.parentElement);
    cb(b.dataset.v);
  });
}

/** SVG 아이콘 (stroke) */
const ICONS = {
  home: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  chart: '<path d="M3 3v18h18"/><path d="m7 15 4-4 3 3 5-6"/>',
  bars: '<path d="M4 20V10M10 20V4M16 20v-8M22 20H2"/>',
  building: '<path d="M4 21V5l8-3v19M12 9h8v12M7 8h2M7 12h2M7 16h2M15 13h2M15 17h2M2 21h20"/>',
  doc: '<path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8z"/><path d="M14 3v5h5M8 13h8M8 17h5"/>',
  news: '<path d="M4 5h13v14a2 2 0 0 0 2 2H6a2 2 0 0 1-2-2z"/><path d="M17 9h3v10a2 2 0 0 1-4 0M8 9h5M8 13h5M8 17h3"/>',
  pulse: '<path d="M3 12h4l3-8 4 16 3-8h4"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-2.6-6.4L21 8"/><path d="M21 3v5h-5"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
  ext: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
};
export const icon = (name, cls = 'ico') => `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`;
