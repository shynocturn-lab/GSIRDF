/* 동종사 비교 — GS IR DataFactory v30 동종사 대시보드 구성(카드·비교표·상세)을 웹으로 이식
 * 데이터: OpenDART 전체 재무제표(연결 우선) + KRX 분기말 시세 / 색상: 앱 디자인 토큰 */
import { errorText } from '../api.js';
import { basisOf, quartersFor } from '../period.js';
import { COMPANIES, companyById } from '../config.js';
import { settings } from '../store.js';
import { groupedBars, lineChart, PALETTE } from '../charts.js';
import { $, $$, esc, fmt, skeleton, segmented, onSeg, placeSegInd, emptyBox } from '../ui.js';
import { DEFS, PNL_CARDS, PNL_EXTRA, FIN_CARDS, SOURCE_NOTES, collect, collectQuarters, enrichWithXbrl, makeCalc, kstToday, quarterRange, latestFiledQuarter } from '../peerdata.js';
import { canUnzip } from '../xbrl.js';

const PREF_KEY = 'idf_peer_v2';
const YEAR_COLORS = ['#1D4ED8', '#4F86F0', '#8DB4F7', '#BFD5FB', '#22D3EE', '#8B8CF8', '#F5A524']; // 최신(진함) → 과거(옅음)
const SHORT = { IPARK현대산업개발: 'IPARK현산', SK에코플랜트: 'SK에코', 포스코이앤씨: '포스코E&C' };

function thisYear() { return +kstToday().slice(0, 4); }
function loadPrefs() {
  const y = thisYear();
  const base = { companies: ['gs', 'hyundai', 'daewoo', 'dl', 'hdc'], years: [y - 3, y - 2, y - 1], quarters: [1, 2, 3, 4], tab: 'profit', ratioChart: 'bar', expanded: false, annualize: false, autoXbrl: true, tableYear: y - 1, trendMetric: 'revenue', trendBasis: 'single' };
  try {
    const p = { ...base, ...JSON.parse(localStorage.getItem(PREF_KEY) || '{}') };
    p.companies = p.companies.filter((id) => COMPANIES.some((c) => c.id === id));
    p.quarters = [...new Set((Array.isArray(p.quarters) ? p.quarters : []).map(Number).filter((q) => q >= 1 && q <= 4))].sort();
    if (!['revenue', 'op', 'net', 'margin', 'netMargin'].includes(p.trendMetric)) p.trendMetric = 'revenue';
    if (!['single', 'ytd'].includes(p.trendBasis)) p.trendBasis = 'single';
    return p;
  } catch { return base; }
}
const savePrefs = (p) => { try { localStorage.setItem(PREF_KEY, JSON.stringify(p)); } catch { /* noop */ } };

const unit = (k) => ({ money: '억원', percent: '%', multiple: '배', won: '원' }[DEFS[k].type]);
const scaled = (k, v) => (v === null || v === undefined ? null : DEFS[k].type === 'money' ? v / 1e8 : v);
function show(k, v) {
  if (v === null || v === undefined || !Number.isFinite(v)) return 'N/A';
  const t = DEFS[k].type;
  if (t === 'money') return fmt.n(v / 1e8);
  if (t === 'won') return fmt.n(v);
  return `${fmt.n(v, t === 'percent' ? 1 : 2)}${t === 'percent' ? '%' : '배'}`;
}
const TREND_METRICS = [['revenue', '매출액'], ['op', '영업이익'], ['net', '당기순이익'], ['margin', '영업이익률'], ['netMargin', '순이익률']];
function periodLabel(y, qs) {
  if (!qs.length) return `${y}년 · 분기 미선택`;
  if (qs.length === 4) return `${y}년 연간`;
  if (qs.length === 1) return `${y}년 ${qs[0]}분기 단독`;
  if (qs.every((q, i) => q === i + 1)) return `${y}년 1~${qs.at(-1)}분기 누적`;
  return `${y}년 ${qs.join('+')}분기 합계`;
}

export async function render(root) {
  const P = loadPrefs();
  const me = companyById(settings.get().company);
  const years = Array.from({ length: thisYear() - 2015 + 1 }, (_, i) => 2015 + i);
  let data = null;
  let calc = null;
  let seq = 0;
  let ac = null;

  root.innerHTML = `
  <section class="page-head">
    <div><p class="eyebrow">PEER FINANCIAL DASHBOARD · OpenDART · KRX</p><h1>동종사 실적 및 재무현황</h1></div>
    ${segmented('tab', [['profit', '손익지표'], ['finance', '재무지표']], P.tab)}
  </section>
  <section class="card pc-filter">
    <div class="pc-dds">
      ${dropdown('company', '회사', COMPANIES.map((c) => [c.id, c.name]), P.companies, [['all', '전체 선택'], ['none', '해제']])}
      ${dropdown('year', '손익년도', years.slice().reverse().map((y) => [String(y), `${y}년`]), P.years.map(String), [['recent', '최근 5개년'], ['none', '해제']])}
      ${dropdown('quarter', '분기', [['1', '1분기'], ['2', '2분기'], ['3', '3분기'], ['4', '4분기']], P.quarters.map(String), [['all', '연간 · 1~4분기'], ['none', '해제']])}
      <div class="pc-opt"><span>비율 차트</span>${segmented('ratio', [['bar', '회사별 막대'], ['line', '연도별 꺾은선']], P.ratioChart)}</div>
    </div>
    <div class="pc-basis">
      <div class="pc-opt"><span>조회 기준</span>${segmented('pbasis', [['annual', '연간'], ['ytd', '누적'], ['single', '분기 단독']], basisOf(P.quarters).b)}</div>
      <label class="fin-sel">기준 분기 <select id="pcBaseQ" class="select">${[1, 2, 3, 4].map((q) => `<option value="${q}"${q === basisOf(P.quarters).q ? ' selected' : ''}>${q}분기</option>`).join('')}</select></label>
      <span class="help" id="pcBasisNote"></span>
    </div>
    <div class="pc-toggles">
      <label class="pc-tog"><input type="checkbox" id="pcExpanded" ${P.expanded ? 'checked' : ''}><span>추가 손익·CF 카드</span></label>
      <label class="pc-tog"><input type="checkbox" id="pcAnnual" ${P.annualize ? 'checked' : ''}><span>EBITDA 연환산</span></label>
      <label class="pc-tog"><input type="checkbox" id="pcAutoXbrl" ${P.autoXbrl !== false ? 'checked' : ''}${canUnzip() ? '' : ' disabled'}><span>XBRL 주석 자동 보완</span></label>
      <div class="pc-xbrl-bar">
        <button type="button" class="btn sm primary" id="pcXbrlBtn"${canUnzip() ? '' : ' disabled'}>XBRL 주석 보완</button>
        <span class="pc-xbrl-meta" id="pcXbrlMeta"></span>
      </div>
    </div>
    <p class="pc-caption" id="pcCaption"></p>
    <p class="help" style="margin:6px 0 0">1+2분기 = 상반기 누적 · 1~3분기 = 9개월 누적 · 3분기만 = 단독 3분기. 손익은 선택기간 합계, 재무상태·주가는 마지막 선택 분기말 잔액, 비율은 같은 출처 금액으로 재계산합니다.</p>
  </section>
  <div id="pcStatus"></div>
  <section id="pcFocus" class="card" hidden></section>
  <section class="pc-cards" id="pcCards"></section>
  <section class="card">
    <div class="card-hd wrap"><h2>주요 재무정보 · 동종사 비교표</h2>
      <label class="pc-year-sel">표 기준년도 <select id="pcTableYear" class="select"></select></label></div>
    <p class="help" id="pcTableCaption"></p>
    <div id="pcTable">${skeleton(300)}</div>
  </section>
  <details class="card adv" id="pcTrend"><summary><h2>분기 추이 · 회사별 (최근 8개 분기)</h2></summary>
    <div class="pc-trend-tools">
      <label class="fin-sel">지표 <select id="pcTrendMetric" class="select">${TREND_METRICS.map(([k, l]) => `<option value="${k}"${k === P.trendMetric ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
      ${segmented('trbasis', [['single', '분기 단독'], ['ytd', '누적']], P.trendBasis)}
    </div>
    <div class="legend pc-legend" id="pcTrendLegend"></div>
    <div id="pcTrendChart" class="pc-chart"></div>
    <p class="pc-note" id="pcTrendNote">펼치면 선택한 회사들의 최근 8개 분기 공시를 불러옵니다(저장된 데이터는 재사용).</p>
  </details>
  <details class="card adv" id="pcCoverage"><summary><h2>데이터 출처 · API 미제공 항목 분석</h2></summary><div id="pcCoverageBody"></div></details>
  <dialog class="pc-dialog" id="pcDialog"><div id="pcDialogBody"></div><div class="pc-dialog-ft"><button class="btn primary" id="pcDialogClose" type="button">닫기</button></div></dialog>`;
  placeSegInd(root);

  /* --------------------------- 필터 */
  function dropdown(name, label, options, selected, presets) {
    return `<details class="pc-dd" data-dd="${name}"><summary><span class="pc-dd-lbl">${label}</span><b class="pc-dd-val" id="dd-${name}"></b></summary>
      <div class="pc-dd-pop">
        <div class="pc-dd-pre">${presets.map(([v, l]) => `<button type="button" class="btn sm ghost" data-pre="${v}">${l}</button>`).join('')}</div>
        <div class="pc-dd-list">${options.map(([v, l]) => `<label class="pc-check"><input type="checkbox" value="${esc(v)}"${selected.includes(v) ? ' checked' : ''}><span>${esc(l)}</span></label>`).join('')}</div>
        <button type="button" class="btn sm primary pc-dd-done">완료</button>
      </div></details>`;
  }
  const ddRead = (name) => $$(`.pc-dd[data-dd="${name}"] input:checked`, root).map((i) => i.value);
  const ddSet = (name, vals) => $$(`.pc-dd[data-dd="${name}"] input`, root).forEach((i) => { i.checked = vals.includes(i.value); });
  function ddLabels() {
    const cs = P.companies.map((id) => companyById(id).name);
    $('#dd-company', root).textContent = !cs.length ? '선택하세요' : cs.length === COMPANIES.length ? '전체 10개사' : cs.length === 1 ? cs[0] : `${cs[0]} 외 ${cs.length - 1}개`;
    $('#dd-year', root).textContent = !P.years.length ? '선택하세요' : P.years.length <= 4 ? P.years.map((y) => `${String(y).slice(2)}년`).join('·') : `${P.years[0]}~${P.years.at(-1)} (${P.years.length})`;
    $('#dd-quarter', root).textContent = !P.quarters.length ? '선택하세요' : periodLabel('', P.quarters).replace(/^년 /, '');
  }
  function syncBasis() {
    const { b, q } = basisOf(P.quarters);
    const seg = $('.seg[data-seg="pbasis"]', root);
    $$('.seg-btn', seg).forEach((x) => { x.classList.toggle('on', x.dataset.v === b); x.setAttribute('aria-selected', String(x.dataset.v === b)); });
    seg.classList.toggle('none', b === 'custom');
    placeSegInd(seg.parentElement);
    $('#pcBaseQ', root).value = String(q);
    $('#pcBasisNote', root).textContent = b === 'custom' ? `사용자 조합(${P.quarters.join('+')}분기 합계) — 분기 드롭다운에서 선택됨` : b === 'annual' ? '1~4분기 = 사업보고서 연간' : b === 'ytd' ? `1~${q}분기 누적` : `${q}분기 3개월 단독${q === 4 ? ' (연간 − 3분기 누적)' : ''}`;
  }
  function applyBasis(b, q) {
    P.quarters = quartersFor(b, q);
    ddSet('quarter', P.quarters.map(String));
    syncBasis(); ddLabels(); schedule();
  }
  onSeg(root, 'pbasis', (b) => applyBasis(b, b === 'annual' ? 4 : +$('#pcBaseQ', root).value));
  $('#pcBaseQ', root).addEventListener('change', (e) => {
    const q = +e.target.value; let { b } = basisOf(P.quarters);
    if (b === 'custom') b = 'ytd';
    if (b === 'annual' && q < 4) b = 'ytd';
    applyBasis(b, q);
  });
  root.addEventListener('change', (e) => {
    const dd = e.target.closest('.pc-dd');
    if (!dd) return;
    const n = dd.dataset.dd;
    if (n === 'company') P.companies = ddRead('company');
    if (n === 'year') P.years = ddRead('year').map(Number).sort((a, b) => a - b);
    if (n === 'quarter') { P.quarters = ddRead('quarter').map(Number).sort(); syncBasis(); }
    ddLabels(); schedule();
  });
  root.addEventListener('click', (e) => {
    const pre = e.target.closest('[data-pre]');
    if (pre) {
      const n = pre.closest('.pc-dd').dataset.dd; const v = pre.dataset.pre;
      if (n === 'company') P.companies = v === 'all' ? COMPANIES.map((c) => c.id) : [];
      if (n === 'year') P.years = v === 'recent' ? [thisYear() - 5, thisYear() - 4, thisYear() - 3, thisYear() - 2, thisYear() - 1] : [];
      if (n === 'quarter') P.quarters = v === 'all' ? [1, 2, 3, 4] : [];
      ddSet('company', P.companies); ddSet('year', P.years.map(String)); ddSet('quarter', P.quarters.map(String));
      syncBasis(); ddLabels(); schedule();
    }
    if (e.target.closest('.pc-dd-done')) e.target.closest('details').open = false;
  });
  root.addEventListener('pointerdown', (e) => { $$('.pc-dd[open]', root).forEach((d) => { if (!d.contains(e.target)) d.open = false; }); });
  root.addEventListener('click', (e) => {
    const f = e.target.closest('[data-focus]');
    if (!f) return;
    P.focus = f.dataset.focus; paintFocus();
    $('#pcFocus', root).scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  });
  onSeg(root, 'tab', (v) => { P.tab = v; paintCards(); });
  onSeg(root, 'ratio', (v) => { P.ratioChart = v; paintCards(); });
  /* --------------------------- 분기 추이 */
  let trend = null; let trendKey = ''; let tseq = 0;
  const trendQuarters = () => { const e = latestFiledQuarter(); const s = e.y * 4 + e.q - 1 - 7; return quarterRange(Math.floor(s / 4), (s % 4) + 1, e.y, e.q); };
  async function loadTrend() {
    if (!$('#pcTrend', root).open) return;
    const companies = P.companies.map(companyById);
    if (!companies.length) { $('#pcTrendChart', root).innerHTML = emptyBox('회사를 하나 이상 선택하세요.'); return; }
    const qs = trendQuarters();
    const key = companies.map((c) => c.id).join(',') + '|' + qs.map((x) => x.y + '.' + x.q).join(',');
    if (key !== trendKey) {
      const my = ++tseq;
      $('#pcTrendChart', root).innerHTML = skeleton(260);
      // 1분기 단독/누적 계산에 직전 분기가 필요할 수 있어 시작 분기 이전 해의 1~3분기까지 함께 수집
      const first = qs[0];
      const extra = first.q > 1 ? quarterRange(first.y, 1, first.y, first.q - 1) : [];
      const res = await collectQuarters(companies, [...extra, ...qs], 'CFS', (d, t) => { if (my === tseq) $('#pcTrendNote', root).textContent = `분기 공시 수집 중 ${d}/${t}`; });
      if (my !== tseq) return;
      trend = { res, calc: makeCalc(res, {}), companies, qs }; trendKey = key;
    }
    paintTrend();
  }
  function paintTrend() {
    if (!trend) return;
    const { calc: tc, companies, qs, res } = trend;
    const k = P.trendMetric;
    const pct = DEFS[k].type === 'percent';
    const color = (c, ci) => (c.id === me.id ? 'var(--brand)' : PALETTE[(ci + 1) % PALETTE.length]);
    const series = companies.map((c, ci) => ({
      name: c.name, color: color(c, ci),
      values: qs.map(({ y, q }) => { const v = tc(c, y, P.trendBasis === 'single' ? [q] : quartersFor('ytd', q), k).value; return v === null ? null : pct ? v : v / 1e8; }),
      fmt: (v) => (pct ? `${v.toFixed(1)}%` : `${fmt.n(v)}억`),
    }));
    lineChart($('#pcTrendChart', root), { labels: qs.map(({ y, q }) => `${String(y).slice(2)}.${q}Q`), height: 260, area: false, gaps: true, padLeft: 54, series, yFmt: (v) => (pct ? v.toFixed(1) : fmt.n(v)) });
    $('#pcTrendLegend', root).innerHTML = companies.map((c, ci) => `<span><i style="background:${color(c, ci)}"></i>${esc(c.name)}</span>`).join('');
    const miss = series.reduce((n, s) => n + s.values.filter((v) => v === null).length, 0);
    $('#pcTrendNote', root).textContent = `${P.trendBasis === 'single' ? '분기 단독(3개월, 4분기 = 연간 − 3분기 누적)' : '누적(1분기~해당 분기, 4분기 = 연간)'} · ${pct ? '%' : '억원'} · OpenDART 연결(미공시 시 별도)${miss ? ` · 공시 없음/미수집 ${miss}칸` : ''}${res.errors.length ? ` · 오류 ${res.errors.length}건` : ''}`;
  }
  $('#pcTrend', root).addEventListener('toggle', loadTrend);
  $('#pcTrendMetric', root).addEventListener('change', (e) => { P.trendMetric = e.target.value; savePrefs(P); paintTrend(); });
  onSeg(root, 'trbasis', (v) => { P.trendBasis = v; savePrefs(P); paintTrend(); });
  $('#pcExpanded', root).addEventListener('change', (e) => { P.expanded = e.target.checked; paintCards(); });
  $('#pcAnnual', root).addEventListener('change', (e) => { P.annualize = e.target.checked; calc = data && makeCalc(data, { annualize: P.annualize }); paintAll(true); });
  $('#pcTableYear', root).addEventListener('change', (e) => { P.tableYear = +e.target.value; paintTable(); });
  const dlgEl = $('#pcDialog', root);
  $('#pcDialogClose', root).addEventListener('click', () => dlgEl.close());
  dlgEl.addEventListener('click', (e) => { if (e.target === dlgEl) dlgEl.close(); });
  function updateXbrlMeta() {
    const el = $('#pcXbrlMeta', root);
    if (!el) return;
    const n = data?.xbrl?.size || 0;
    el.textContent = n ? `XBRL 주석 ${n}건 적용됨` : '차입금·EBITDA 주석 누락 시 클릭(기기 영구 저장)';
  }
  async function runXbrlEnrich(mySeq, silentEmpty = false, signal) {
    if (!data || !canUnzip()) return;
    const btn = $('#pcXbrlBtn', root);
    const companies = P.companies.map(companyById);
    if (!companies.length || !P.years.length || !P.quarters.length) return;
    btn.disabled = true;
    $('#pcStatus', root).innerHTML = '<div class="pc-progress"><span>XBRL 주석 보완 중 <b id="pcProg">0</b></span><i><em id="pcBar"></em></i></div>';
    try {
      const r = await enrichWithXbrl(data, companies, P.years, P.quarters, (d, t) => {
        if (mySeq !== seq) return;
        const pg = $('#pcProg', root); const bar = $('#pcBar', root);
        if (pg) pg.textContent = `${d}/${t}`;
        if (bar) bar.style.width = `${(d / Math.max(1, t)) * 100}%`;
      }, signal);
      if (mySeq !== seq) return;
      calc = makeCalc(data, { annualize: P.annualize });
      paintAll(true);
      if (!r.total && silentEmpty) { $('#pcStatus', root).innerHTML = ''; return; }
      const cls = r.failed ? 'banner' : 'sec-sum pass';
      $('#pcStatus', root).innerHTML = `<div class="${cls}">✓ XBRL 주석 보완 완료 — 대상 ${r.total}건 (신규 ${r.loaded}건 · 저장본 ${r.cached}건${r.unavailable ? ` · 미제공 ${r.unavailable}건` : ''}${r.failed ? ` · 실패 ${r.failed}건 — Worker v1.8 확인` : ''})</div>`;
    } catch (err) {
      if (mySeq !== seq) return;
      $('#pcStatus', root).innerHTML = `<div class="banner"><b>XBRL 보완 오류:</b> ${esc(errorText(err))}</div>`;
    } finally {
      btn.disabled = !canUnzip();
      updateXbrlMeta();
    }
  }
  $('#pcAutoXbrl', root).addEventListener('change', (e) => { P.autoXbrl = e.target.checked; savePrefs(P); if (P.autoXbrl && data) runXbrlEnrich(seq, true, ac?.signal); });
  $('#pcXbrlBtn', root).addEventListener('click', () => runXbrlEnrich(seq, false, ac?.signal));

  let timer = 0;
  function schedule() { clearTimeout(timer); timer = setTimeout(load, 450); }

  /* --------------------------- 수집 */
  async function load() {
    savePrefs(P);
    ddLabels();
    loadTrend();
    const companies = P.companies.map(companyById);
    ac?.abort();
    ac = new AbortController();
    const sig = ac.signal;
    const my = ++seq;
    $('#pcCaption', root).textContent = `${P.years.length ? P.years.join(' · ') + '년' : '연도 미선택'} / ${P.quarters.length ? periodLabel('', P.quarters).replace(/^년 /, '') : '분기 미선택'} / ${companies.length}개 회사 · OpenDART 연결재무제표(없으면 별도) · KRX`;
    if (!companies.length || !P.years.length || !P.quarters.length) {
      $('#pcCards', root).innerHTML = emptyBox('회사·연도·분기를 각각 하나 이상 선택하세요.');
      $('#pcTable', root).innerHTML = ''; $('#pcStatus', root).innerHTML = '';
      return;
    }
    $('#pcStatus', root).innerHTML = `<div class="pc-progress"><span>공시 수집 중 <b id="pcProg">0</b></span><i><em id="pcBar"></em></i></div>`;
    if (!data) $('#pcCards', root).innerHTML = Array.from({ length: 6 }, () => `<div class="card">${skeleton(260)}</div>`).join('');
    const res = await collect(companies, P.years, P.quarters, (d, t) => {
      if (my !== seq) return;
      const pg = $('#pcProg', root); const bar = $('#pcBar', root);
      if (pg) pg.textContent = `${d}/${t}`;
      if (bar) bar.style.width = `${(d / Math.max(1, t)) * 100}%`;
    }, sig);
    if (my !== seq) return;
    data = res;
    calc = makeCalc(data, { annualize: P.annualize });
    // 오류 요약
    const errs = res.errors;
    if (errs.length) {
      const kinds = [...new Set(errs.map((e) => errorText(e.err)))];
      $('#pcStatus', root).innerHTML = `<div class="banner"><b>일부 자료를 가져오지 못했습니다 (${errs.length}건).</b> ${esc(kinds.slice(0, 2).join(' / '))}
        ${errs.some((e) => e.err?.code === 'UPSTREAM_BLOCKED') ? '<a class="btn sm primary" href="#/settings">외부 API 진단</a>' : ''}</div>`;
    } else $('#pcStatus', root).innerHTML = '';
    paintAll();
    if (P.autoXbrl !== false && canUnzip()) await runXbrlEnrich(my, true, sig);
  }

  /* --------------------------- 렌더 */
  const value = (c, y, k) => (calc ? calc(c, y, P.quarters, k) : { value: null, note: '수집 전', src: '' });
  function paintAll(keepScroll = false) {
    const sy = keepScroll ? window.scrollY : null;
    const cardsEl = $('#pcCards', root); const tblEl = $('#pcTable', root);
    if (keepScroll && cardsEl && cardsEl.offsetHeight) cardsEl.style.minHeight = cardsEl.offsetHeight + 'px';
    if (keepScroll && tblEl && tblEl.offsetHeight) tblEl.style.minHeight = tblEl.offsetHeight + 'px';
    updateXbrlMeta(); paintCards(); paintTable(); paintCoverage(); paintFocus();
    if (keepScroll) {
      if (cardsEl) cardsEl.style.minHeight = '';
      if (tblEl) tblEl.style.minHeight = '';
      if (sy !== null && Math.abs(window.scrollY - sy) > 2) window.scrollTo({ top: sy, behavior: 'instant' });
      requestAnimationFrame(() => { if (sy !== null && Math.abs(window.scrollY - sy) > 2) window.scrollTo({ top: sy, behavior: 'instant' }); });
    }
  }

  function card(k, prefix = '') {
    return `<article class="card pc-card" data-card="${k}">
      <div class="pc-card-hd"><h3><button class="pc-title" data-focus="${k}">${esc(DEFS[k].label)}</button></h3><span class="chip">${unit(k)}</span></div>
      <div class="legend pc-legend" id="lg-${prefix}${k}"></div>
      <div class="pc-chart" id="ch-${prefix}${k}"></div>
      <p class="pc-note" id="nt-${prefix}${k}"></p></article>`;
  }
  function paintCards() {
    if (!calc) return;
    savePrefs(P);
    const keys = P.tab === 'finance' ? FIN_CARDS : [...PNL_CARDS, ...(P.expanded ? PNL_EXTRA : [])];
    $('#pcCards', root).innerHTML = keys.map((k) => card(k)).join('');
    keys.forEach((k) => chart(k));
  }
  function chart(k, prefix = '') {
    const companies = P.companies.map(companyById);
    const ys = P.years;
    const box = $(`#ch-${prefix}${k}`, root);
    if (!box) return;
    const cells = ys.map((y) => companies.map((c) => value(c, y, k)));
    const line = P.ratioChart === 'line' && ['percent', 'multiple'].includes(DEFS[k].type);
    const counts = {};
    cells.flat().forEach((d) => { const s = d.value === null ? 'N/A' : d.src.split(' · ')[0]; counts[s] = (counts[s] || 0) + 1; });
    const yFmt = (v) => (DEFS[k].type === 'money' ? fmt.n(v) : fmt.n(v, Math.abs(v) < 10 ? 1 : 0));
    if (line) {
      lineChart(box, {
        labels: ys.map(String), height: 250, area: false, gaps: true, padLeft: 48,
        series: companies.map((c, ci) => ({ name: c.name, values: ys.map((_, yi) => scaled(k, cells[yi][ci].value)), color: c.id === me.id ? 'var(--brand)' : PALETTE[(ci + 1) % PALETTE.length], fmt: (v) => show(k, v) })),
        yFmt, xFmt: (y) => `${y}년`,
      });
      $(`#lg-${prefix}${k}`, root).innerHTML = companies.map((c, ci) => `<span><i style="background:${c.id === me.id ? 'var(--brand)' : PALETTE[(ci + 1) % PALETTE.length]}"></i>${esc(c.name)}</span>`).join('');
    } else {
      const colors = ys.map((_, i) => YEAR_COLORS[Math.min(ys.length - 1 - i, YEAR_COLORS.length - 1)]);
      groupedBars(box, {
        groups: companies.map((c) => SHORT[c.name] || c.name), height: 260,
        series: ys.map((y, yi) => ({ name: `${y}년`, color: colors[yi], values: companies.map((_, ci) => scaled(k, cells[yi][ci].value)) })),
        yFmt, valueFmt: (v) => (DEFS[k].type === 'money' ? fmt.n(v) : `${fmt.n(v, 1)}`), labelSeries: [ys.length - 1],
        label: DEFS[k].label, onPick: (gi, si) => proof(companies[gi], ys[si], k),
      });
      $(`#lg-${prefix}${k}`, root).innerHTML = ys.map((y, yi) => `<span><i style="background:${colors[yi]}"></i>${y}년</span>`).join('');
    }
    $(`#nt-${prefix}${k}`, root).textContent = `출처 ${Object.entries(counts).map(([s, n]) => `${s} ${n}`).join(' · ')}${ys.length > 1 && !line ? ' · 최근 연도만 수치 표기, 막대를 누르면 근거' : ''}${SOURCE_NOTES[k] && cells.flat().some((d) => d.value === null) ? ' · ⓘ 비교표 아래 분석 참고' : ''}`;
  }

  function paintTable() {
    if (!calc) return;
    const companies = P.companies.map(companyById);
    const y = P.years.includes(P.tableYear) ? P.tableYear : P.years.at(-1);
    P.tableYear = y;
    $('#pcTableYear', root).innerHTML = P.years.map((v) => `<option value="${v}"${v === y ? ' selected' : ''}>${v}년</option>`).join('');
    $('#pcTableCaption', root).textContent = `${periodLabel(y, P.quarters)} · IFRS 연결(미공시 시 별도) · 재무상태·주가는 선택 마지막 분기말 · 금액 억원 · 수치를 누르면 산식·출처·접수번호 · 표시: DART 공시값 / XBRL = 원본 주석 추출 / 로직 = 공시 계정 계산 / 대체 = 현금흐름표 대체 / 지표 = DART 주요재무지표 / 별도 = 연결 미공시`;
    let group = '';
    const rows = [];
    for (const [k, d] of Object.entries(DEFS)) {
      if (d.group !== group) { group = d.group; rows.push(`<tr class="pc-grp"><th colspan="${companies.length + 2}">${esc(group)}</th></tr>`); }
      rows.push(`<tr><th scope="row"><button class="pc-item" data-focus="${k}">${esc(d.label)}</button></th><td class="pc-unit">${unit(k)}</td>${companies.map((c) => {
        const v = value(c, y, k);
        const chip = v.value === null ? 'N/A' : v.xbrl ? 'XBRL' : v.alt ? '지표' : v.logic ? '로직' : v.note.includes('대체') ? '대체' : v.src.startsWith('OpenDART 별도') ? '별도' : v.src.startsWith('KRX') ? 'KRX' : 'DART';
        const cls = chip === 'N/A' ? 'na' : chip === 'XBRL' ? 'xbrl' : chip === '로직' ? 'logic' : ['대체', '별도', '지표'].includes(chip) ? 'alt' : '';
        return `<td class="${c.id === me.id ? 'me' : ''}"><button class="pc-cell num${v.value !== null && v.value < 0 ? ' dn' : ''}" data-c="${c.id}" data-y="${y}" data-k="${k}" title="${esc(v.note)}">${esc(show(k, v.value))}</button><small class="pc-chip ${cls}">${chip}</small></td>`;
      }).join('')}</tr>`);
    }
    $('#pcTable', root).innerHTML = `<div class="table-wrap pc-matrix-wrap"><table class="tbl pc-matrix sticky-first"><thead><tr><th>항목</th><th>단위</th>${companies.map((c) => `<th class="${c.id === me.id ? 'me' : ''}">${esc(c.name)}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
    $$('.pc-cell', root).forEach((b) => b.addEventListener('click', () => proof(companyById(b.dataset.c), +b.dataset.y, b.dataset.k)));
  }

  function paintFocus() {
    const box = $('#pcFocus', root);
    if (!P.focus || !calc) { box.hidden = true; return; }
    box.hidden = false;
    box.innerHTML = `<div class="card-hd"><h2>선택 항목 상세 비교</h2><button class="btn sm" id="pcFocusClose" type="button">닫기</button></div>${card(P.focus, 'f-').replace('class="card pc-card"', 'class="pc-card focus"')}`;
    chart(P.focus, 'f-');
    $('#pcFocusClose', root).addEventListener('click', () => { delete P.focus; paintFocus(); });
  }

  function paintCoverage() {
    if (!calc) return;
    const companies = P.companies.map(companyById);
    const rows = Object.keys(DEFS).map((k) => {
      let ok = 0; let na = 0; const reasons = {};
      for (const y of P.years) for (const c of companies) {
        const v = value(c, y, k);
        if (v.value === null) { na += 1; reasons[v.note] = (reasons[v.note] || 0) + 1; } else ok += 1;
      }
      const top = Object.entries(reasons).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([r, n]) => `${r} (${n})`).join(' / ');
      return { k, ok, na, top };
    }).filter((r) => r.na > 0);
    $('#pcCoverageBody', root).innerHTML = `<p class="help">선택한 ${companies.length}개사 × ${P.years.length}개년 기준. N/A가 있는 항목과 원인입니다. 결측은 0으로 바꾸거나 추정하지 않습니다.</p>
      ${rows.length ? `<div class="table-wrap"><table class="tbl"><thead><tr><th>항목</th><th>수집</th><th>N/A</th><th>주요 사유</th></tr></thead><tbody>${rows.map((r) => `<tr><th scope="row">${esc(DEFS[r.k].label)}</th><td class="num">${r.ok}</td><td class="num dn">${r.na}</td><td class="pc-reason">${esc(r.top)}${SOURCE_NOTES[r.k] ? `<br><span class="mut">${esc(SOURCE_NOTES[r.k])}</span>` : ''}</td></tr>`).join('')}</tbody></table></div>`
        : '<div class="sec-sum pass">✓ 선택 범위의 모든 항목을 수집했습니다.</div>'}
      <h3 class="pc-h3">다른 데이터 출처 검토</h3>
      <ul class="pc-src-list">
        <li><b>OpenDART 전체 재무제표(fnlttSinglAcntAll)</b> — 적용. 손익·재무상태·현금흐름 본문 계정 전체.</li>
        <li><b>현금흐름표 이자 지급·수취</b> — 적용(대체). 손익계산서에 이자비용이 없을 때 현금기준으로 표시.</li>
        <li><b>KRX 일별 시세(분기말 직전 거래일)</b> — 적용. 주가·시가총액.</li>
        <li><b>OpenDART 주식의 총수 현황(stockTotqySttus)</b> — 적용. 유통주식수(발행−자기주식)로 EPS·BPS 계산, 비상장사 포함.</li>
        <li><b>OpenDART 기본주당이익(손익계산서)</b> — 적용. EPS 공시값 우선 사용.</li>
        <li><b>OpenDART 단일회사 주요재무지표(fnlttSinglIndx, 2023년 3분기~)</b> — 적용(보조). 이자 계정을 못 찾은 회사의 이자보상배율.</li>
        <li><b>공시 계정 간 계산 로직</b> — 적용. 판관비 = 매출총이익 − 영업이익, 매출원가 = 매출 − 매출총이익, 세전이익 = 순이익 + 법인세, 지배순이익·지배자본 = 전체 − 비지배지분, 결합 차입금 계정, 감가상각 계정명 집계. 표에 "로직"으로 표시.</li>
        <li><b>OpenDART XBRL 원문(fnlttXbrl, 주석 포함)</b> — 적용(v2.3). 상단 [XBRL 주석 보완] 클릭 시 본문 누락 보고서만 브라우저에서 직접 ZIP 해제하여 장단기 차입금 7종(할인차금 차감 순액)·감가상각비 4종·이자비용을 추출하고 기기(IndexedDB)에 영구 저장. 비상장사·구보고서 미제공(013/014)은 자동 건너뜀.</li>
        <li><b>신용등급·회사채 금리</b> — 공식 무료 API 없음(신용평가사 유료). 수동 등록 방식 필요.</li>
      </ul>`;
  }

  function proof(c, y, k) {
    const v = value(c, y, k);
    const endQ = P.quarters.at(-1);
    const xb = ['borrow', 'netBorrow', 'shortRepayBurden'].includes(k) ? data?.xbrl?.get(`${c.id}|${y}|${endQ}`)?.borrow?.end : null;
    const diagHtml = xb ? `<details class="nf-kw" style="margin:10px 0"><summary>XBRL 차입금 추출 상세 · 후보 진단 보기</summary>
      <div class="table-wrap" style="margin-top:6px;max-height:240px"><table class="sec-table"><thead><tr><th>항목</th><th class="num">총액(백만)</th><th class="num">할인(백만)</th><th class="num">순액(백만)</th></tr></thead><tbody>
      ${Object.entries(xb.items || {}).map(([ik, it]) => `<tr><td>${esc(ik)}${it?.label ? ` <span class="mut">(${esc(it.label)})</span>` : ''}${it?.discLabel ? `<br><span class="mut">할인: ${esc(it.discLabel)}</span>` : ''}</td>
        <td class="num">${it ? fmt.int(it.gross / 1e6) : '—'}</td><td class="num">${it?.disc ? `-${fmt.int(it.disc / 1e6)}` : '0'}</td><td class="num"><b>${it ? fmt.int(it.net / 1e6) : '0'}</b></td></tr>`).join('')}
      </tbody></table></div>
      ${xb.meta ? `<p class="help" style="margin:8px 0 2px">파서 메타(${esc(xb.meta.engine || 'regex')}): 전체 팩트 ${fmt.int(xb.meta.totalFacts)}건 · 한글태그 ${fmt.int(xb.meta.unicodeFacts)}건 · TextBlock ${fmt.int(xb.meta.textBlocks)}건 · 라벨파일 ${fmt.int(xb.meta.labFiles)}개${xb.meta.zipFiles?.length ? `<br>ZIP 항목(${xb.meta.zipFiles.length}): ${esc(xb.meta.zipFiles.join(', '))}` : ''}</p>` : ''}
      ${xb.probe ? `<div class="help" style="margin:6px 0;padding:8px 10px;border-radius:10px;background:var(--glass-card-2);border:1px solid var(--line);font-size:11.5px">
        <b>할인차금 포렌식 프로브</b>
        ${xb.probe.discLabels?.length ? `<div style="margin-top:4px"><b>라벨 사전(할인):</b> ${esc(xb.probe.discLabels.join(' · '))}</div>` : '<div style="margin-top:4px"><b>라벨 사전(할인):</b> 없음</div>'}
        ${xb.probe.anyCtxHits?.length ? `<div style="margin-top:4px"><b>전체 컨텍스트 원금 일치(${xb.probe.anyCtxHits.length}):</b><br>${xb.probe.anyCtxHits.map((h) => `${esc(h.c)} = ${fmt.int(h.v / 1e6)}백만 [${esc(h.per)}, fs=${h.fsOk ? 'Y' : 'N'}] ${esc(h.dims)}`).join('<br>')}</div>` : ''}
        ${xb.probe.rawHits?.length ? `<div style="margin-top:4px;overflow-wrap:anywhere"><b>원문 XML 출현(${xb.probe.rawHits.length}):</b><br>${xb.probe.rawHits.map((s) => `<code>${esc(s)}</code>`).join('<br>')}</div>` : ''}
      </div>` : ''}
      ${xb.diag?.length ? `<p class="help" style="margin:6px 0 4px">동일 기준일(${esc(xb.date)}) XBRL 할인·앵커·요약 후보 (백만원 · 개별은행 제외):</p>
        <div class="table-wrap" style="max-height:200px"><table class="sec-table diag-tbl"><tbody>${xb.diag.map((d) => `<tr><td><b>${esc(d.lbl)}</b><br><span class="mut">${esc(d.c)}${d.dims?.length ? ` · ${esc(d.dims.join(', '))}` : ''}</span></td><td class="num">${fmt.int(d.v)}</td></tr>`).join('')}</tbody></table></div>` : ''}
    </details>` : '';
    const keepNums = (txt) => esc(txt || '—').replace(/(?:할인-)?[+-]?\d[\d,]*(?:\.\d+)?(?:억원|억|조|백만|원|배|%|%p)?(?:\(할인-[\d,]+억\))?/g, (m) => `<span class="num">${m}</span>`);
    $('#pcDialogBody', root).innerHTML = `<h3>${esc(c.name)} · ${esc(DEFS[k].label)}</h3>
      <table class="sec-table kv"><tbody>
        <tr><td>선택기간</td><td>${esc(periodLabel(y, P.quarters))}</td></tr>
        <tr><td>값</td><td class="num"><b>${esc(show(k, v.value))}</b> ${v.value === null ? '' : unit(k)}</td></tr>
        <tr><td>산식·기준</td><td>${keepNums(v.note)}</td></tr>
        <tr><td>출처</td><td>${esc(v.src || '—')}</td></tr>
      </tbody></table>
      ${diagHtml}
      ${SOURCE_NOTES[k] ? `<p class="help" style="margin-top:10px">${esc(SOURCE_NOTES[k])}</p>` : ''}
      ${/접수 (\d{14})/.test(v.src || '') ? `<a class="btn sm" target="_blank" rel="noopener" href="https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${v.src.match(/접수 (\d{14})/)[1]}">DART 원문 보기</a>` : ''}`;
    const dlg = $('#pcDialog', root);
    if (dlg.showModal) dlg.showModal(); else dlg.setAttribute('open', '');
  }

  syncBasis();
  ddLabels();
  load();
}
