/* 뉴스 — 네이버 뉴스 검색 · 회사별 / 제도·정책 구분 · 기간 선택 · 관련도 필터 */
import { api, errorText } from '../api.js';
import { COMPANIES } from '../config.js';
import { settings } from '../store.js';
import { $, $$, esc, safeUrl, fmt, skeleton, errorBox, emptyBox, segmented, onSeg, placeSegInd, icon } from '../ui.js';
import { PERIODS, COMPANY_TOPICS, POLICY_TOPICS, companyQueries, policyQueries, relevance, dedupe, inPeriod, strip, pagesPerQuery } from '../newsconfig.js';

const PREF_KEY = 'idf_news_v2';
const PAGE = 100;
const SHOW_STEP = 60;
const KINDS = [['company', '회사별'], ...POLICY_TOPICS.map((t) => [t.id, t.label]), ['custom', '직접 검색']];

function loadPrefs() {
  const base = { kind: 'company', company: settings.get().company || 'gs', ctopic: 'all', group: 'all', period: '1w', sort: 'date', q: settings.get().newsQuery || '' };
  try {
    const p = { ...base, ...JSON.parse(localStorage.getItem(PREF_KEY) || '{}') };
    if (!KINDS.some(([k]) => k === p.kind)) p.kind = 'company';
    if (!COMPANIES.some((c) => c.id === p.company)) p.company = 'gs';
    if (!COMPANY_TOPICS.some((t) => t.id === p.ctopic)) p.ctopic = 'all';
    if (!PERIODS.some(([k]) => k === p.period)) p.period = '1w';
    if (!['date', 'score'].includes(p.sort)) p.sort = 'date';
    return p;
  } catch { return base; }
}
const savePrefs = (p) => { try { localStorage.setItem(PREF_KEY, JSON.stringify(p)); } catch { /* noop */ } };

export async function render(root) {
  const P = loadPrefs();
  let shown = SHOW_STEP;
  let result = null;
  let seq = 0;

  root.innerHTML = `
  <section class="page-head">
    <div><p class="eyebrow">NEWS · Naver</p><h1>뉴스</h1></div>
    ${segmented('sort', [['date', '최신순'], ['score', '관련도순']], P.sort)}
  </section>
  <section class="card news-filter">
    <div class="nf-row"><span class="nf-lbl">구분</span><div class="chips nf-wrap" id="nfKind">${KINDS.map(([k, l]) => `<button class="chip-btn${k === P.kind ? ' on' : ''}" data-kind="${k}">${esc(l)}</button>`).join('')}</div></div>
    <div id="nfSub"></div>
    <div class="nf-row"><span class="nf-lbl">기간</span>${segmented('period', PERIODS.map(([k, l]) => [k, l]), P.period)}</div>
    <p class="nf-caption" id="nfCaption"></p>
    <details class="nf-kw"><summary>사용 중인 검색어 보기</summary><div id="nfKw"></div></details>
  </section>
  <div id="newsStatus"></div>
  <section id="newsList" class="news-grid">${skeleton(400)}</section>
  <div class="news-more" id="newsMore"></div>`;
  placeSegInd(root);

  /* --------------------------- 세부 선택 */
  function paintSub() {
    const box = $('#nfSub', root);
    if (P.kind === 'company') {
      box.innerHTML = `
        <div class="nf-row"><span class="nf-lbl">회사</span><div class="chips nf-wrap" id="nfCo">${COMPANIES.map((c) => `<button class="chip-btn${c.id === P.company ? ' on' : ''}" data-co="${c.id}">${esc(c.name)}</button>`).join('')}</div></div>
        <div class="nf-row"><span class="nf-lbl">주제</span><div class="chips nf-wrap" id="nfTopic">${COMPANY_TOPICS.map((t) => `<button class="chip-btn${t.id === P.ctopic ? ' on' : ''}" data-topic="${t.id}">${esc(t.label)}</button>`).join('')}</div></div>`;
    } else if (P.kind === 'custom') {
      box.innerHTML = `<form class="news-search nf-row" id="newsForm"><span class="nf-lbl">검색어</span>
        <label class="search-box lg">${icon('search')}<input id="newsQ" type="search" value="${esc(P.q)}" placeholder="검색어 입력 (예: 건설 수주)" autocomplete="off" maxlength="100"></label>
        <button class="btn primary" type="submit">검색</button></form>`;
    } else {
      const t = POLICY_TOPICS.find((x) => x.id === P.kind);
      if (!t.groups.some((g) => g.id === P.group)) P.group = 'all';
      box.innerHTML = `
        <div class="nf-row"><span class="nf-lbl">세부</span><div class="chips nf-wrap" id="nfGroup">${[{ id: 'all', label: '전체' }, ...t.groups].map((g) => `<button class="chip-btn${g.id === P.group ? ' on' : ''}" data-group="${g.id}">${esc(g.label)}</button>`).join('')}</div></div>
        <p class="help nf-desc">${esc(t.desc)}</p>`;
    }
  }

  function queries() {
    if (P.kind === 'company') return companyQueries(P.company, P.ctopic);
    if (P.kind === 'custom') return P.q ? [P.q] : [];
    return policyQueries(P.kind, P.group);
  }
  const ctx = () => (P.kind === 'company' ? { kind: 'company', company: P.company, topic: P.ctopic } : P.kind === 'custom' ? { kind: 'custom' } : { kind: 'policy', topic: P.kind });

  /* --------------------------- 수집: 검색어별 최신순 페이지를 기간 끝까지(상한 내) */
  async function fetchQuery(q, days, maxPages, onPage) {
    const cutoff = Date.now() - days * 86400e3;
    const items = []; let truncated = false; let firstLink = null;
    for (let page = 0; page < maxPages; page += 1) {
      const body = await api.news(q, PAGE, 'date', page * PAGE + 1);
      onPage();
      const got = (body && body.items) || [];
      if (!got.length) break;
      // 이전 Worker(start 미지원)는 같은 1페이지를 돌려준다 → 중복이면 중단
      if (page > 0 && got[0].link === firstLink) break;
      if (page === 0) firstLink = got[0].link;
      items.push(...got.map((x) => ({ ...x, query: q })));
      const oldest = Date.parse(got[got.length - 1].pubDate);
      if (got.length < PAGE || (Number.isFinite(oldest) && oldest < cutoff)) break;
      if (page === maxPages - 1) truncated = true;
    }
    return { items, truncated };
  }

  async function load() {
    savePrefs(P);
    const my = ++seq;
    shown = SHOW_STEP;
    const qs = queries();
    const days = PERIODS.find(([k]) => k === P.period)[2];
    $('#nfKw', root).innerHTML = qs.length ? `<div class="nf-kw-list">${qs.map((q) => `<span class="chip">${esc(q)}</span>`).join('')}</div>` : '';
    if (!qs.length) { $('#newsList', root).innerHTML = emptyBox('검색어를 입력하세요.'); $('#nfCaption', root).textContent = ''; $('#newsStatus', root).innerHTML = ''; $('#newsMore', root).innerHTML = ''; return; }
    const maxPages = pagesPerQuery(P.period, qs.length);
    let done = 0; const total = qs.length * maxPages;
    $('#newsList', root).innerHTML = skeleton(400);
    $('#newsMore', root).innerHTML = '';
    $('#newsStatus', root).innerHTML = `<div class="pc-progress"><span>뉴스 수집 중 <b id="nwProg">0</b></span><i><em id="nwBar"></em></i></div>`;
    const onPage = () => { done += 1; if (my !== seq) return; const pg = $('#nwProg', root); const bar = $('#nwBar', root); if (pg) pg.textContent = `${done}`; if (bar) bar.style.width = `${Math.min(100, (done / total) * 100)}%`; };

    const results = []; const errors = [];
    let i = 0;
    const worker = async () => { while (i < qs.length) { const q = qs[i++]; try { results.push(await fetchQuery(q, days, maxPages, onPage)); } catch (err) { errors.push({ q, err }); } } };
    await Promise.all(Array.from({ length: Math.min(4, qs.length) }, worker));
    if (my !== seq) return;
    if (!results.length && errors.length) {
      $('#newsStatus', root).innerHTML = '';
      $('#newsList', root).innerHTML = errorBox(errorText(errors[0].err));
      $('#nfCaption', root).textContent = '';
      return;
    }
    const raw = results.flatMap((r) => r.items);
    const c = ctx();
    const periodItems = raw.filter((x) => inPeriod(x, days));
    let dropped = 0;
    const relevant = [];
    for (const x of periodItems) {
      const r = relevance({ title: strip(x.title), description: strip(x.description) }, c);
      if (r.ok) relevant.push({ ...x, score: r.score, tags: r.tags }); else dropped += 1;
    }
    // 같은 기사가 여러 검색어로 잡히면 태그·점수를 합친다
    const byLink = new Map();
    relevant.forEach((x) => { const p = byLink.get(x.link); if (!p) byLink.set(x.link, { ...x, queries: [x.query] }); else { p.queries.push(x.query); p.score = Math.max(p.score, x.score) + 0.5; } });
    const items = dedupe([...byLink.values()]);
    result = { items, raw: raw.length, inPeriod: periodItems.length, dropped, grouped: byLink.size - items.length, truncated: results.some((r) => r.truncated), errors, qs };
    $('#newsStatus', root).innerHTML = errors.length ? `<div class="banner"><b>일부 검색어를 가져오지 못했습니다 (${errors.length}/${qs.length}).</b> ${esc(errorText(errors[0].err))}</div>` : '';
    paint();
  }

  function paint() {
    if (!result) return;
    const list = [...result.items].sort(P.sort === 'score'
      ? (a, b) => b.score - a.score || Date.parse(b.pubDate) - Date.parse(a.pubDate)
      : (a, b) => Date.parse(b.pubDate) - Date.parse(a.pubDate));
    const period = PERIODS.find(([k]) => k === P.period)[1];
    $('#nfCaption', root).textContent = `최근 ${period} · 검색어 ${result.qs.length}개 · 관련 기사 ${fmt.int(list.length)}건`
      + `${result.grouped > 0 ? ` (같은 기사 ${result.grouped}건 묶음)` : ''}`
      + `${result.dropped ? ` · 관련 없는 기사 ${fmt.int(result.dropped)}건 제외` : ''}`
      + `${result.truncated ? ' · 기사가 많아 일부 검색어는 최근 기사 위주로 수집' : ''}`;
    $('#newsList', root).innerHTML = list.length ? list.slice(0, shown).map((n, i) => {
      let host = '';
      try { host = new URL(n.link).hostname.replace(/^www\./, ''); } catch { /* noop */ }
      const tags = [...new Set(n.tags || [])].slice(0, 3);
      const t = Date.parse(n.pubDate);
      const d = Number.isFinite(t) ? new Date(t + 9 * 3600e3).toISOString() : '';
      return `<a class="news-card" style="--i:${Math.min(i, 12)}" href="${esc(safeUrl(n.link))}" target="_blank" rel="noopener noreferrer">
        <div class="news-meta"><span>${esc(host)}</span><span title="${esc(d.slice(0, 16).replace('T', ' '))}">${esc(fmt.ago(n.pubDate))} · ${esc(d.slice(5, 10).replace('-', '.'))}</span></div>
        <h3>${esc(strip(n.title))}</h3>
        <p>${esc(strip(n.description))}</p>
        ${tags.length || n.dup ? `<div class="news-tags">${tags.map((t) => `<span class="chip">${esc(t)}</span>`).join('')}${n.dup ? `<span class="chip mut">같은 기사 ${n.dup + 1}건</span>` : ''}</div>` : ''}
      </a>`;
    }).join('') : emptyBox(`최근 ${period} 동안 관련 기사가 없습니다. 기간을 늘려 보세요.`);
    $('#newsMore', root).innerHTML = list.length > shown ? `<button class="btn" id="btnMore" type="button">더 보기 (${fmt.int(list.length - shown)}건 남음)</button>` : '';
  }

  /* --------------------------- 이벤트 */
  root.addEventListener('click', (e) => {
    const k = e.target.closest('[data-kind]');
    if (k) { P.kind = k.dataset.kind; P.group = 'all'; $$('#nfKind .chip-btn', root).forEach((x) => x.classList.toggle('on', x === k)); paintSub(); load(); return; }
    const co = e.target.closest('[data-co]');
    if (co) { P.company = co.dataset.co; $$('#nfCo .chip-btn', root).forEach((x) => x.classList.toggle('on', x === co)); load(); return; }
    const tp = e.target.closest('[data-topic]');
    if (tp) { P.ctopic = tp.dataset.topic; $$('#nfTopic .chip-btn', root).forEach((x) => x.classList.toggle('on', x === tp)); load(); return; }
    const g = e.target.closest('[data-group]');
    if (g) { P.group = g.dataset.group; $$('#nfGroup .chip-btn', root).forEach((x) => x.classList.toggle('on', x === g)); load(); return; }
    if (e.target.closest('#btnMore')) { shown += SHOW_STEP; paint(); }
  });
  root.addEventListener('submit', (e) => {
    if (e.target.id !== 'newsForm') return;
    e.preventDefault();
    const v = $('#newsQ', root).value.trim();
    if (!v) return;
    P.q = v.slice(0, 100);
    settings.set({ newsQuery: P.q });
    load();
  });
  onSeg(root, 'period', (v) => { P.period = v; load(); });
  onSeg(root, 'sort', (v) => { P.sort = v; savePrefs(P); shown = SHOW_STEP; paint(); });

  paintSub();
  load();
}
