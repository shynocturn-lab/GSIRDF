/* 재무현황 — OpenDART 전체 재무제표 · 분기(단독) / 누적 기준 전환 · 12분기 추이 · 전년 동기 비교 */
import { errorText } from '../api.js';
import { COMPANIES, companyById } from '../config.js';
import { settings } from '../store.js';
import { groupedBars, lineChart } from '../charts.js';
import { $, $$, esc, fmt, dirClass, skeleton, errorBox, emptyBox, segmented, onSeg, placeSegInd } from '../ui.js';
import { periodText, qsFor } from '../period.js';
import { fetchCorpInfo, fetchFunding } from '../corpinfo.js';
import { savedXbrl, loadXbrl, depTotal, basisValue, canUnzip } from '../xbrl.js';
import { collectQuarters, makeCalc, quarterRange, latestFiledQuarter, statementRows, comparative } from '../peerdata.js';

const PREF = 'idf_fin_v2';
const SJ_LABEL = { BS: '재무상태표', IS: '손익계산서', CF: '현금흐름표' };
const loadPrefs = () => { try { return JSON.parse(localStorage.getItem(PREF) || '{}'); } catch { return {}; } };
const savePrefs = (p) => { try { localStorage.setItem(PREF, JSON.stringify(p)); } catch { /* noop */ } };

/** 기간 표기: 단독 "2026 2Q" / 누적 "2026 1~2Q 누적"(4Q 누적 = 연간) */
const shortQ = (y, q) => `${String(y).slice(2)}.${q}Q`;

export async function render(root) {
  const saved = loadPrefs();
  const latest = latestFiledQuarter();
  const P = {
    company: COMPANIES.some((c) => c.id === saved.company) ? saved.company : settings.get().company,
    basis: saved.basis === 'ytd' ? 'ytd' : 'single',
    fs: saved.fs === 'OFS' ? 'OFS' : 'CFS',
    y: saved.y || latest.y,
    q: saved.q || latest.q,
  };
  const thisYear = +new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 4);
  let seq = 0;

  root.innerHTML = `
  <section class="page-head">
    <div><p class="eyebrow">FINANCIALS · OpenDART</p><h1>재무현황</h1></div>
    <div class="fin-segs">${segmented('basis', [['single', '분기(단독)'], ['ytd', '누적']], P.basis)}${segmented('fs', [['CFS', '연결'], ['OFS', '별도']], P.fs)}</div>
  </section>
  <div class="chips" id="coChips">${COMPANIES.map((c) => `<button class="chip-btn${c.id === P.company ? ' on' : ''}" data-id="${c.id}">${esc(c.name)}</button>`).join('')}</div>
  <section class="card fin-period">
    <label class="fin-sel">연도 <select id="finY" class="select">${Array.from({ length: thisYear - 2015 + 1 }, (_, i) => thisYear - i).map((y) => `<option value="${y}"${y === P.y ? ' selected' : ''}>${y}년</option>`).join('')}</select></label>
    <label class="fin-sel">분기 <select id="finQ" class="select">${[1, 2, 3, 4].map((q) => `<option value="${q}"${q === P.q ? ' selected' : ''}>${q}분기</option>`).join('')}</select></label>
    <p class="fin-caption" id="finCaption"></p>
    <p class="help fin-basis-help" id="finBasisHelp"></p>
  </section>
  <section class="kpi-strip" id="finKpi">${Array.from({ length: 6 }, () => skeleton(104)).join('')}</section>
  <section class="grid two">
    <article class="card"><div class="card-hd"><h2>매출액 추이</h2><span class="chip" id="chRevChip">억원</span></div><div id="chRev">${skeleton(240)}</div></article>
    <article class="card"><div class="card-hd"><h2>영업이익 · 당기순이익</h2><span class="chip" id="chProfitChip">억원</span></div><div id="chProfit">${skeleton(240)}</div>
      <div class="legend"><span><i style="background:var(--brand)"></i>영업이익</span><span><i style="background:#22D3EE"></i>당기순이익</span></div></article>
  </section>
  <section class="card"><div class="card-hd"><h2>영업이익률 · 순이익률 추이</h2><span class="chip">%</span></div><div id="chMargin">${skeleton(220)}</div>
    <div class="legend"><span><i style="background:var(--brand)"></i>영업이익률</span><span><i style="background:var(--c-us)"></i>순이익률</span></div></section>
  <section class="card">
    <div class="card-hd wrap"><h2>재무제표 계정</h2>
      <div class="fin-tbl-tools">${segmented('sj', [['ALL', '전체'], ['IS', '손익'], ['BS', '재무상태'], ['CF', '현금흐름']], 'ALL')}
      <label class="search-box">🔍<input id="finSearch" type="search" placeholder="계정 검색" autocomplete="off"></label></div></div>
    <p class="help" id="finTableCaption"></p>
    <div id="finTable">${skeleton(300)}</div>
  </section>
  <section class="card xbrl-card" id="xbrlCard">
    <div class="card-hd wrap"><h2>주석 (XBRL) · 차입금 · 감가상각비 · 이자 · 영업부문</h2><span class="chip">OpenDART 재무제표 원본</span></div>
    <div id="xbrlBody">${skeleton(140)}</div>
  </section>
  <section class="card corp-card">
    <div class="card-hd wrap"><h2>회사 정보</h2><span class="chip" id="corpChip">OpenDART 기업개황 · 정기보고서</span></div>
    <div id="corpInfo">${skeleton(260)}</div>
  </section>
  <section class="card fund-card">
    <div class="card-hd wrap"><h2>자금조달 · 주주환원 · 감사</h2><span class="chip">OpenDART 정기보고서 주요정보</span></div>
    <div id="fundInfo">${skeleton(220)}</div>
  </section>`;
  placeSegInd(root);

  let data = null; let calc = null; let rows = []; let sjFilter = 'ALL'; let q = '';
  const company = () => companyById(P.company);

  async function load() {
    savePrefs(P);
    const my = ++seq;
    const c = company();
    // 선택 분기 포함 최근 12분기 + 전년 동기(범위 내 포함)
    const end = { y: P.y, q: P.q };
    const startIdx = (end.y * 4 + end.q - 1) - 11;
    const quarters = quarterRange(Math.floor(startIdx / 4), (startIdx % 4) + 1, end.y, end.q);
    $('#finCaption', root).textContent = `${c.name} · ${P.fs === 'CFS' ? '연결(없으면 별도)' : '별도(없으면 연결)'} · ${periodText(P.y, P.q, P.basis)} · 불러오는 중…`;
    try {
      const res = await collectQuarters([c], quarters, P.fs);
      if (my !== seq) return;
      data = res; calc = makeCalc(data);
      // 선택 분기가 미공시면 가장 최근 공시 분기로 자동 이동 — 단, '불러오기 실패'(장애)일 때는 이동하지 않고 오류를 보여준다
      const rep = data.store.get(`${c.id}|${P.y}|${P.q}`);
      const selErr = res.errors.find((e) => e.y === P.y && e.q === P.q);
      if (!rep && selErr) {
        $('#finCaption', root).innerHTML = `${esc(c.name)} · ${esc(periodText(P.y, P.q, P.basis))} · <span class="amber-text">불러오지 못했습니다: ${esc(errorText(selErr.err))}</span>`;
        $('#finKpi', root).innerHTML = errorBox(errorText(selErr.err));
        return;
      }
      if (!rep) {
        const avail = quarters.filter(({ y, q: qq }) => data.store.get(`${c.id}|${y}|${qq}`)).at(-1);
        if (avail && (avail.y !== P.y || avail.q !== P.q)) {
          const was = periodText(P.y, P.q, P.basis);
          P.y = avail.y; P.q = avail.q; $('#finY', root).value = String(P.y); $('#finQ', root).value = String(P.q);
          $('#finBasisHelp', root).dataset.moved = `${was} 보고서가 아직 공시되지 않아 최근 공시 분기(${periodText(P.y, P.q, P.basis)})를 표시합니다.`;
          return load();
        }
      }
      paint(quarters);
      loadCorp();
      xbrlRender();
      if (res.errors.length) $('#finCaption', root).insertAdjacentHTML('beforeend', ` · <span class="amber-text">${esc(errorText(res.errors[0].err))}</span>`);
    } catch (err) {
      if (my !== seq) return;
      ['#chRev', '#chProfit', '#chMargin', '#finTable'].forEach((s) => { $(s, root).innerHTML = errorBox(errorText(err)); });
      $('#finKpi', root).innerHTML = '';
    }
  }

  function paint(quarters) {
    const c = company();
    const rep = data.store.get(`${c.id}|${P.y}|${P.q}`);
    const moved = $('#finBasisHelp', root).dataset.moved;
    $('#finBasisHelp', root).dataset.moved = '';
    $('#finCaption', root).textContent = `${c.name} · ${rep ? (rep.fs === 'CFS' ? '연결' : '별도') : '—'} · ${periodText(P.y, P.q, P.basis)}${rep ? ` · 접수 ${rep.rcept}` : ''}`;
    $('#finBasisHelp', root).innerHTML = `${P.basis === 'single'
      ? '<b>분기(단독)</b>: 해당 분기 3개월 실적입니다. 4분기는 사업보고서 연간 − 3분기 누적, 현금흐름은 당 분기 누적 − 직전 분기 누적으로 계산합니다.'
      : '<b>누적</b>: 1분기부터 해당 분기까지 누적 실적(4분기 = 연간)입니다.'} 비교는 전년 동기 같은 기준입니다. 재무상태 항목은 분기말 잔액입니다.${moved ? `<br><span class="amber-text">${esc(moved)}</span>` : ''}`;
    if (!rep) {
      $('#finKpi', root).innerHTML = '';
      ['#chRev', '#chProfit', '#chMargin'].forEach((s) => { $(s, root).innerHTML = emptyBox('최근 12분기 공시 자료가 없습니다.'); });
      $('#finTable', root).innerHTML = emptyBox(`${periodText(P.y, P.q, P.basis)} 보고서가 없습니다.`);
      return;
    }
    const qs = qsFor(P.q, P.basis);
    const v = (y, k) => calc(c, y, qs, k);
    const prevRep = P.q > 1 ? data.store.get(`${c.id}|${P.y}|${P.q - 1}`) : null;
    rows = statementRows(rep, prevRep, P.basis);

    /* KPI — 비교값은 표와 같은 '당기 보고서의 비교 열'(재작성 반영) 사용, 없으면 전년 보고서로 계산 */
    const pair = (k) => {
      const r = comparative(rows, k);
      if (r && r.cur !== null) return { cur: r.cur, prior: r.prior };
      return { cur: v(P.y, k).value, prior: v(P.y - 1, k).value };
    };
    const ratio = (a, b) => (a !== null && b !== null && b !== 0 ? (a / b) * 100 : null);
    const rev = pair('revenue'); const op = pair('op'); const net = pair('net'); const liab = pair('liabilities'); const eq = pair('equity');
    const kpis = [
      ['revenue', '매출액', 'money', rev, '전년 동기'], ['op', '영업이익', 'money', op, '전년 동기'], ['net', '당기순이익', 'money', net, '전년 동기'],
      ['margin', '영업이익률', 'pct', { cur: ratio(op.cur, rev.cur), prior: ratio(op.prior, rev.prior) }, '전년 동기'],
      ['debtRatio', '부채비율', 'pct', { cur: ratio(liab.cur, eq.cur), prior: ratio(liab.prior, eq.prior) }, '전기말'],
      ['equity', '자본총계', 'money', eq, '전기말'],
    ];
    $('#finKpi', root).innerHTML = kpis.map(([k, label, t, x, cmp]) => {
      let delta = '';
      if (x.cur !== null && x.prior !== null) {
        if (t === 'pct') { const d = x.cur - x.prior; delta = `<span class="num ${dirClass(d)}">${d > 0 ? '+' : ''}${d.toFixed(1)}%p</span>`; }
        else if (x.prior !== 0) { const d = ((x.cur - x.prior) / Math.abs(x.prior)) * 100; delta = `<span class="num ${dirClass(d)}">${fmt.pct(d, 1)}</span>`; }
      }
      const val = x.cur === null ? '—' : t === 'pct' ? `${fmt.n(x.cur, 1)}<small>%</small>` : fmt.won(x.cur);
      return `<div class="kpi-tile" data-k="${k}"><div class="kpi-lbl">${label}</div><div class="kpi-val num">${val}</div>
        <div class="kpi-sub"><span class="mut">${cmp} 대비</span>${delta || '<span class="mut">—</span>'}</div></div>`;
    }).join('');

    /* 12분기 추이 */
    const labels = quarters.map(({ y, q }) => shortQ(y, q));
    const series = (k) => quarters.map(({ y, q }) => { const r = calc(c, y, qsFor(q, P.basis), k); return r.value === null ? null : r.value; });
    const eok = (arr) => arr.map((x) => (x === null ? null : x / 1e8));
    const basisLbl = P.basis === 'single' ? '분기 단독 · 억원' : '누적 · 억원';
    $('#chRevChip', root).textContent = basisLbl; $('#chProfitChip', root).textContent = basisLbl;
    const sel = labels.length - 1;
    groupedBars($('#chRev', root), { groups: labels, height: 240, series: [{ name: '매출액', color: 'var(--brand)', values: eok(series('revenue')) }], yFmt: (x) => fmt.n(x), labelSeries: [], label: '매출액 추이', highlight: sel, minGroupW: 30 });
    groupedBars($('#chProfit', root), { groups: labels, height: 240, series: [{ name: '영업이익', color: 'var(--brand)', values: eok(series('op')) }, { name: '당기순이익', color: '#22D3EE', values: eok(series('net')) }], yFmt: (x) => fmt.n(x), labelSeries: [], label: '영업이익·순이익 추이', highlight: sel, minGroupW: 34 });
    lineChart($('#chMargin', root), { labels, height: 220, area: false, gaps: true, padLeft: 44, series: [{ name: '영업이익률', values: series('margin'), color: 'var(--brand)', fmt: (x) => `${x.toFixed(1)}%` }, { name: '순이익률', values: series('netMargin'), color: 'var(--c-us)', fmt: (x) => `${x.toFixed(1)}%` }], yFmt: (x) => x.toFixed(1) });

    /* 계정표 */
    $('#finTableCaption', root).textContent = `${periodText(P.y, P.q, P.basis)} vs 전년 동기 ${periodText(P.y - 1, P.q, P.basis)} · 재무상태는 ${P.q}분기말 vs 전기말 · 억원`;
    paintTable();
  }

  function paintTable() {
    const shown = rows.filter((r) => (sjFilter === 'ALL' || r.sj === sjFilter) && (!q || r.name.includes(q)));
    if (!shown.length) { $('#finTable', root).innerHTML = emptyBox('표시할 계정이 없습니다.'); return; }
    let last = '';
    const body = shown.map((r) => {
      const head = r.sj !== last ? `<tr class="pc-grp"><th colspan="4">${SJ_LABEL[r.sj]}</th></tr>` : '';
      last = r.sj;
      return `${head}<tr><th scope="row" title="${esc(r.note)}">${esc(r.name)}</th><td class="num">${fmt.eok(r.cur)}</td><td class="num">${fmt.eok(r.prior)}</td><td class="num ${dirClass(r.chg)}">${fmt.pct(r.chg, 1)}</td></tr>`;
    }).join('');
    const curH = periodText(P.y, P.q, P.basis); const prH = periodText(P.y - 1, P.q, P.basis);
    $('#finTable', root).innerHTML = `<div class="table-wrap"><table class="tbl"><thead><tr><th>계정</th><th>${esc(curH)}<small class="th-sub">BS: ${P.q}분기말</small></th><th>${esc(prH)}<small class="th-sub">BS: 전기말</small></th><th>증감률</th></tr></thead><tbody>${body}</tbody></table></div>`;
  }

  onSeg(root, 'basis', (b) => { P.basis = b; savePrefs(P); if (data) { paint(quarterRangeFor()); xbrlRender(); } });
  onSeg(root, 'fs', (f) => { P.fs = f; load(); });
  onSeg(root, 'sj', (s) => { sjFilter = s; paintTable(); });
  $('#finSearch', root).addEventListener('input', (e) => { q = e.target.value.trim(); paintTable(); });
  $('#finY', root).addEventListener('change', (e) => { P.y = +e.target.value; load(); });
  $('#finQ', root).addEventListener('change', (e) => { P.q = +e.target.value; load(); });
  $('#coChips', root).addEventListener('click', (e) => {
    const b = e.target.closest('.chip-btn');
    if (!b) return;
    P.company = b.dataset.id;
    $$('#coChips .chip-btn', root).forEach((x) => x.classList.toggle('on', x === b));
    load();
  });
  /* 회사 정보: 기업개황 + 선택 분기(없으면 직전 공시) 정기보고서의 주식·주주·직원·임원 */
  let corpKey = ''; let cseq = 0;
  async function loadCorp() {
    const c = company();
    const key = `${c.id}|${P.y}|${P.q}`;
    if (key === corpKey) return;
    corpKey = key;
    const my = ++cseq;
    const box = $('#corpInfo', root);
    box.innerHTML = skeleton(260);
    const fbox = $('#fundInfo', root);
    fbox.innerHTML = skeleton(220);
    fetchFunding(c.corp, P.y, P.q).then((f) => { if (my === cseq) fbox.innerHTML = fundingHtml(f); })
      .catch((err) => { if (my === cseq) fbox.innerHTML = errorBox(errorText(err)); });
    try {
      const info = await fetchCorpInfo(c.corp, P.y, P.q);
      if (my !== cseq) return;
      box.innerHTML = corpHtml(info);
    } catch (err) {
      if (my !== cseq) return;
      corpKey = '';
      box.innerHTML = errorBox(errorText(err));
    }
  }

  /* XBRL 주석: 저장본이 있으면 즉시 표시(네트워크 없음), 없으면 버튼으로 받기, 정정공시(접수번호 변경)면 변경분만 다시 받기 */
  let xseq = 0;
  async function xbrlRender(statusMsg = '') {
    const my = ++xseq;
    const box = $('#xbrlBody', root);
    const c = company();
    const rep = data?.store.get(`${c.id}|${P.y}|${P.q}`);
    if (!rep) { box.innerHTML = emptyBox('선택 분기의 보고서가 없습니다.'); return; }
    const fs = rep.fs || 'CFS';
    const prevRep = P.q > 1 ? data.store.get(`${c.id}|${P.y}|${P.q - 1}`) : null;
    const [cur, prev] = await Promise.all([
      savedXbrl(c.corp, P.y, P.q, fs, rep.rcept),
      prevRep ? savedXbrl(c.corp, P.y, P.q - 1, prevRep.fs || 'CFS', prevRep.rcept) : Promise.resolve({ status: 'none' }),
    ]);
    if (my !== xseq) return;
    const qs = qsFor(P.q, P.basis);
    const op = calc ? calc(c, P.y, qs, 'op') : { value: null };
    const cashV = calc ? calc(c, P.y, qs, 'cash') : { value: null };
    const sfV = calc ? calc(c, P.y, qs, 'shortFinancial') : { value: null };
    const needPrev = P.basis === 'single' && P.q > 1 && cur.data && !hasSingle(cur.data) && prev.status !== 'fresh' && prevRep;
    const btn = (id, label, cls = 'primary') => `<button class="btn sm ${cls}" type="button" id="${id}">${label}</button>`;
    let head = '';
    if (cur.status === 'none') {
      head = `<div class="xbrl-cta"><p>장단기 차입금·사채·리스부채 7종(할인차금 차감 순액), 감가상각비 4종(유형·무형·투자부동산·사용권자산), 이자수익·이자비용, 영업부문별 매출·영업이익을 <b>XBRL 원본</b>에서 추출합니다.
        파일은 보고서당 수 MB이며, <b>한 번 받으면 이 기기에 저장</b>되어 동종사 대시보드에서도 자동으로 재사용됩니다(정정공시 시 변경분만 갱신).</p>
        ${canUnzip() ? btn('xbrlLoad', `XBRL 주석 불러오기 (${P.y}년 ${P.q}분기)`) : '<p class="amber-text">이 브라우저는 XBRL 압축 해제를 지원하지 않습니다(iOS 16.4 이상 필요).</p>'}</div>`;
    } else if (cur.status === 'outdated') {
      head = `<div class="banner xbrl-upd"><b>정정공시로 보고서가 바뀌었습니다</b> (접수 ${esc(cur.oldRcept)} → ${esc(rep.rcept)}). 아래는 정정 전 저장본입니다. ${btn('xbrlLoad', '변경분 업데이트')}</div>`;
    }
    if (needPrev) head += `<div class="banner">이 보고서에는 분기(단독) 값이 따로 없어 <b>당 분기 누적 − 직전 분기 누적</b>으로 계산합니다. ${btn('xbrlPrev', `${P.q - 1}분기 XBRL도 받기`, '')}</div>`;
    if (statusMsg) head = `<p class="xbrl-status">${statusMsg}</p>` + head;
    box.innerHTML = head + (cur.data ? xbrlHtml(cur.data, prev.data, P.basis, op.value, cur.status === 'fresh', cashV.value, sfV.value) : '');
    const go = async (withPrev) => {
      $$('#xbrlBody button', root).forEach((b) => { b.disabled = true; });
      const st = $('#xbrlBody', root);
      st.insertAdjacentHTML('afterbegin', '<p class="xbrl-status">XBRL 원본 받는 중… (압축 해제·분석 후 기기에 저장)</p>');
      try {
        const r = [];
        // 현재 보고서 먼저 → 분기(단독) 값이 보고서에 없을 때만 직전 분기도(불필요한 다운로드 방지)
        const main = withPrev && cur.status === 'fresh' ? { data: cur.data, fromStore: true } : await loadXbrl({ corp: c.corp, y: P.y, q: P.q, fs, rcept: rep.rcept });
        if (data && main?.data) { if (!data.xbrl) data.xbrl = new Map(); data.xbrl.set(`${c.id}|${P.y}|${P.q}`, main.data); }
        r.push(main);
        if (P.basis === 'single' && P.q > 1 && prevRep && prev.status !== 'fresh' && (withPrev || !hasSingle(main.data))) {
          r.push(await loadXbrl({ corp: c.corp, y: P.y, q: P.q - 1, fs: prevRep.fs || 'CFS', rcept: prevRep.rcept }).catch(() => null));
        }
        const mb = r.filter(Boolean).filter((x) => !x.fromStore).reduce((a, x) => a + (x.data.bytes || 0), 0) / 1048576;
        xbrlRender(mb > 0 ? `✓ ${mb.toFixed(1)}MB 받아 저장했습니다 — 다음부터는 바로 표시됩니다.` : '✓ 저장본을 사용했습니다(다운로드 없음).');
      } catch (err) {
        xbrlRender(`<span class="amber-text">${esc(errorText(err))}</span>`);
      }
    };
    $('#xbrlLoad', root)?.addEventListener('click', () => go(false));
    $('#xbrlPrev', root)?.addEventListener('click', () => go(true));
  }
  function quarterRangeFor() {
    const s = (P.y * 4 + P.q - 1) - 11;
    return quarterRange(Math.floor(s / 4), (s % 4) + 1, P.y, P.q);
  }
  load();
}

/* ------------------------------------------------------------ 회사 정보 렌더 */
const SEX = (m, f) => (m !== null || f !== null ? `남 ${fmt.int(m)} · 여 ${fmt.int(f)}` : '');
function dl(rows) {
  const r = rows.filter(([, v]) => v !== '' && v !== null && v !== undefined && v !== '—');
  return r.length ? `<dl class="corp-dl">${r.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v}</dd>`).join('')}</dl>` : '<p class="mut">공시 자료 없음</p>';
}
function block(title, sub, inner) {
  return `<article class="corp-block"><h3>${esc(title)}${sub ? ` <small class="mut">${esc(sub)}</small>` : ''}</h3>${inner}</article>`;
}
function fail(x) { return x && x.error ? `<p class="amber-text">${esc(errorText(x.error))}</p>` : '<p class="mut">공시 자료 없음 (최근 4개 분기 미제출)</p>'; }
export function corpHtml(info) {
  const co = info.company && !info.company.error ? info.company : null;
  const sh = info.shares && !info.shares.error ? info.shares : null;
  const mj = info.major && !info.major.error ? info.major : null;
  const mn = info.minority && !info.minority.error ? info.minority : null;
  const em = info.employees && !info.employees.error ? info.employees : null;
  const ex = info.executives && !info.executives.error ? info.executives : null;
  const link = (u, t) => (u ? `<a class="link" href="${esc(u)}" target="_blank" rel="noopener noreferrer">${esc(t || u.replace(/^https?:\/\//, '').replace(/\/$/, ''))}</a>` : '');
  const won = (v) => (v === null || v === undefined ? '' : `${fmt.won(v)}원`);
  const kpis = [
    ['최대주주 등 지분율', mj?.totalRate != null ? `${fmt.n(mj.totalRate, 2)}%` : '—', mj?.largest ? `최대주주 ${mj.largest.name}` : ''],
    ['소액주주 지분율', mn?.shareRate != null ? `${fmt.n(mn.shareRate, 2)}%` : '—', mn?.holders != null ? `${fmt.int(mn.holders)}명` : ''],
    ['직원 수', em?.total != null ? `${fmt.int(em.total)}<small>명</small>` : '—', em ? `정규 ${fmt.int(em.regular)} · 계약 ${fmt.int(em.contract)}` : ''],
    ['1인 평균 급여', em?.avgSalary != null ? won(em.avgSalary) : '—', em?.tenure != null ? `평균 근속 ${fmt.n(em.tenure, 1)}년` : ''],
    ['임원 수', ex ? `${fmt.int(ex.total)}<small>명</small>` : '—', ex ? `등기 ${ex.registered} · 미등기 ${ex.unregistered}` : ''],
    ['발행주식 총수', sh?.issued != null ? `${fmt.int(sh.issued)}<small>주</small>` : '—', sh?.treasury != null ? `자기주식 ${fmt.int(sh.treasury)}주` : ''],
  ];
  const kpiHtml = `<div class="kpi-strip corp-kpi">${kpis.map(([k, v, sub]) => `<div class="kpi-tile"><div class="kpi-lbl">${esc(k)}</div><div class="kpi-val num">${v}</div><div class="kpi-sub"><span class="mut">${esc(sub)}</span></div></div>`).join('')}</div>`;

  const overview = co ? dl([
    ['회사명', esc(co.name) + (co.eng ? ` <span class="mut">${esc(co.eng)}</span>` : '')],
    ['대표이사', esc(co.ceo)], ['시장구분', esc(co.market) + (co.stockCode ? ` · ${esc(co.stockCode)}` : '')],
    ['설립일', esc(co.established)], ['결산월', esc(co.fiscalMonth)], ['업종코드', esc(co.induty)],
    ['법인등록번호', esc(co.jurir)], ['사업자등록번호', esc(co.bizr)], ['주소', esc(co.address)], ['전화', esc(co.phone)],
    ['홈페이지', link(co.homepage)], ['IR', link(co.ir)],
  ]) : fail(info.company);

  const holders = mj ? (mj.holders.length ? `<div class="table-wrap"><table class="tbl corp-tbl"><thead><tr><th>성명</th><th>관계</th><th>주식 종류</th><th>기말 주식수</th><th>지분율</th></tr></thead><tbody>
      ${mj.holders.slice(0, 10).map((h) => `<tr><th scope="row">${esc(h.name)}</th><td>${esc(h.relate)}</td><td>${esc(h.kind)}</td><td class="num">${fmt.int(h.shares)}</td><td class="num">${h.rate != null ? fmt.n(h.rate, 2) + '%' : '—'}</td></tr>`).join('')}
      ${mj.totalRate != null ? `<tr class="corp-sum"><th scope="row">합계</th><td></td><td></td><td></td><td class="num">${fmt.n(mj.totalRate, 2)}%</td></tr>` : ''}
    </tbody></table></div>${mj.holders.length > 10 ? `<p class="help">외 ${mj.holders.length - 10}명</p>` : ''}` : '<p class="mut">명단 없음</p>') : fail(info.major);

  const shares = dl([
    ['발행주식 총수', sh?.issued != null ? `${fmt.int(sh.issued)}주` : ''], ['보통주', sh?.common != null ? `${fmt.int(sh.common)}주` : ''],
    ['우선주', sh?.preferred ? `${fmt.int(sh.preferred)}주` : ''], ['자기주식', sh?.treasury != null ? `${fmt.int(sh.treasury)}주` : ''],
    ['유통주식수', sh?.floating != null ? `${fmt.int(sh.floating)}주` : ''],
    ['소액주주', mn ? `${fmt.int(mn.holders)}명 (${fmt.n(mn.holderRate, 2)}%) · ${fmt.int(mn.shares)}주 (${fmt.n(mn.shareRate, 2)}%)` : ''],
  ]);

  const emp = em ? dl([
    ['직원 수', `${fmt.int(em.total)}명`], ['정규직 · 계약직', `${fmt.int(em.regular)}명 · ${fmt.int(em.contract)}명`],
    ['성별', SEX(em.male, em.female)], ['평균 근속연수', em.tenure != null ? `${fmt.n(em.tenure, 1)}년` : ''],
    ['1인 평균 급여', won(em.avgSalary)], ['연간 급여 총액', won(em.salaryTotal)],
    ['사업부문', esc(em.segments.slice(0, 6).join(' · '))],
  ]) : fail(info.employees);

  const exe = ex ? (ex.board.length ? `<ul class="corp-board">${ex.board.slice(0, 12).map((x) => `<li><b>${esc(x.name)}</b> <span class="mut">${esc(x.position)}${x.job ? ' · ' + esc(x.job.slice(0, 30)) : ''}</span></li>`).join('')}</ul>` : '<p class="mut">등기임원 명단 없음</p>') : fail(info.executives);
  const per = (x) => (x && x.period ? x.period.name : '');

  return `${kpiHtml}
    <div class="corp-grid">
      ${block('기업 개요', '기업개황', overview)}
      ${block('주식 · 주주 현황', per(sh) || per(mn), shares)}
      ${block('최대주주 및 특수관계인', per(mj), holders)}
      ${block('직원 현황', per(em), emp)}
      ${block('등기임원', ex ? `${per(ex)} · 총 ${ex.total}명` : '', exe)}
    </div>
    <p class="help">출처: OpenDART 기업개황(company) · 주식총수(stockTotqySttus) · 최대주주(hyslrSttus) · 소액주주(mrhlSttus) · 직원(empSttus) · 임원(exctvSttus). 선택 분기 보고서가 없으면 직전 공시 보고서를 사용합니다.</p>`;
}

/* ------------------------------------------------------------ XBRL 주석 렌더 */
const hasSingle = (d) => ['ppe', 'intangible', 'invProp', 'rou'].some((k) => d?.dep?.single?.[k]) || d?.segments?.some((x) => Number.isFinite(x.rev?.single));
const eok = (v) => (Number.isFinite(v) ? fmt.n(v / 1e8, 0) : '—');
const yoy = (a, b) => (Number.isFinite(a) && Number.isFinite(b) && b !== 0 ? ((a - b) / Math.abs(b)) * 100 : null);
const pctCell = (v) => (v === null ? '<td class="mut">—</td>' : `<td class="num ${dirClass(v)}">${fmt.pct(v, 1)}</td>`);
export function xbrlHtml(cur, prev, basis, opValue, fresh, cashValue = null, sfValue = null) {
  const per = basis === 'ytd' ? (cur.q === 4 ? '연간' : `1~${cur.q}분기 누적`) : `${cur.q}분기 단독`;
  const dv = (k) => basisValue({ ...cur.dep, q: cur.q }, prev ? { ...prev.dep } : null, (x) => x?.[k]?.value, basis);
  const depItems = [['ppe', '유형자산 감가상각비'], ['intangible', '무형자산 상각비'], ['invProp', '투자부동산 감가상각비'], ['rou', '사용권자산 상각비']].map(([k, l]) => ({ k, l, ...dv(k) }));
  const sum = (key) => { const v = depItems.map((x) => x[key]).filter(Number.isFinite); return v.length ? v.reduce((a, b) => a + b, 0) : null; };
  const depSum = sum('value'); const depPrior = sum('prior');
  const iv = (k) => basisValue({ ...cur.interest, q: cur.q }, prev ? { ...prev.interest } : null, (x) => x?.[k]?.value, basis);
  const inc = iv('income'); const exp = iv('expense');
  const derived = depItems.some((x) => x.derived) || inc.derived || exp.derived;
  const ebitda = Number.isFinite(opValue) && Number.isFinite(depSum) ? opValue + depSum : null;
  const tile = (label, v, sub) => `<div class="kpi-tile"><div class="kpi-lbl">${esc(label)}</div><div class="kpi-val num">${v}</div><div class="kpi-sub"><span class="mut">${sub}</span></div></div>`;
  const yoyTxt = (a, b) => { const y = yoy(a, b); return y === null ? '전년 동기 —' : `전년 동기 대비 <b class="${dirClass(y)}">${fmt.pct(y, 1)}</b>`; };
  const xb = cur.borrow?.end || null;
  const xbPrev = cur.borrow?.prev || null;
  const netBorrow = xb && Number.isFinite(cashValue) ? xb.total - cashValue - (Number.isFinite(sfValue) ? sfValue : 0) : null;
  const kpis = `<div class="kpi-strip xbrl-kpi">
    ${xb ? tile('총차입금 (주석 순액·리스 포함)', fmt.won(xb.total), xbPrev ? `전기말 대비 <b class="${dirClass(yoy(xb.total, xbPrev.total))}">${fmt.pct(yoy(xb.total, xbPrev.total), 1)}</b>` : (Number.isFinite(xb.shortRepay) ? `단기상환부담 ${fmt.won(xb.shortRepay)}` : '')) : ''}
    ${xb ? tile('순차입금 (현금·단기금융 차감)', Number.isFinite(netBorrow) ? fmt.won(netBorrow) : '—', Number.isFinite(cashValue) ? `현금 ${fmt.won(cashValue)} · 단기금융 ${fmt.won(sfValue || 0)}` : '현금 정보 없음') : ''}
    ${tile('감가상각비 4종 합계', Number.isFinite(depSum) ? fmt.won(depSum) : '—', yoyTxt(depSum, depPrior))}
    ${tile('EBITDA (영업이익 + 감가상각 4종)', Number.isFinite(ebitda) ? fmt.won(ebitda) : '—', Number.isFinite(opValue) ? `영업이익 ${fmt.won(opValue)}` : '영업이익 없음')}
    ${tile('이자수익', Number.isFinite(inc.value) ? fmt.won(inc.value) : '—', yoyTxt(inc.value, inc.prior))}
    ${tile('이자비용', Number.isFinite(exp.value) ? fmt.won(exp.value) : '—', yoyTxt(exp.value, exp.prior))}
    ${tile('순이자비용', Number.isFinite(exp.value) && Number.isFinite(inc.value) ? fmt.won(exp.value - inc.value) : '—', '이자비용 − 이자수익')}
  </div>`;
  const bRows = [
    ['shortBorrow', '단기차입금'], ['currentLongBorrow', '유동성장기부채'], ['currentBonds', '유동성사채'], ['currentLease', '유동성리스부채'],
    ['longBorrow', '장기차입금'], ['bonds', '사채'], ['longLease', '비유동리스부채'],
  ];
  const borrowSection = xb ? `<div class="xbrl-borrow-wrap"><h3 class="xbrl-h">차입금·사채·리스부채 주석 내역 (억원 · ${esc(xb.date)} 기준)</h3>
    <div class="table-wrap"><table class="tbl xbrl-tbl"><thead><tr><th>구분</th><th>총액</th><th>할인차금</th><th>순장부금액</th><th>전기말 순액</th></tr></thead><tbody>
    ${bRows.map(([k, l]) => {
      const it = xb.items[k]; const pv = xbPrev?.items?.[k];
      return `<tr><th scope="row">${l}</th><td class="num">${it ? eok(it.gross) : '—'}</td><td class="num mut">${it && it.disc ? `(${eok(it.disc)})` : '—'}</td><td class="num"><b>${it ? eok(it.net) : '0'}</b></td><td class="num mut">${pv ? eok(pv.net) : '—'}</td></tr>`;
    }).join('')}
    <tr class="corp-sum"><th scope="row">총차입금 합계 (유동 ${eok(xb.currentTotal)} + 비유동 ${eok(xb.nonCurrentTotal)})</th><td class="num">${eok(xb.total + xb.totalDiscount)}</td><td class="num mut">${xb.totalDiscount ? `(${eok(xb.totalDiscount)})` : '—'}</td><td class="num">${eok(xb.total)}</td><td class="num">${xbPrev ? eok(xbPrev.total) : '—'}</td></tr>
    <tr><th scope="row" class="mut">단기상환부담액 (유동성장기부채 + 유동성사채)</th><td></td><td></td><td class="num">${Number.isFinite(xb.shortRepay) ? eok(xb.shortRepay) : '—'}</td><td class="num mut">${xbPrev && Number.isFinite(xbPrev.shortRepay) ? eok(xbPrev.shortRepay) : '—'}</td></tr>
    </tbody></table></div></div>` : '';
  const depTable = `<table class="tbl xbrl-tbl"><thead><tr><th>감가상각비 (억원)</th><th>${esc(per)}</th><th>전년 동기</th><th>증감률</th></tr></thead><tbody>
    ${depItems.map((x) => `<tr><th scope="row">${x.l}</th><td class="num">${eok(x.value)}</td><td class="num">${eok(x.prior)}</td>${pctCell(yoy(x.value, x.prior))}</tr>`).join('')}
    <tr class="corp-sum"><th scope="row">합계</th><td class="num">${eok(depSum)}</td><td class="num">${eok(depPrior)}</td>${pctCell(yoy(depSum, depPrior))}</tr></tbody></table>`;

  const kSeg = basis === 'ytd' || cur.q === 1 ? ['ytd', 'priorYtd'] : ['single', 'priorSingle'];
  const segVal = (x, m, k) => {
    if (basis === 'ytd' || cur.q === 1 || Number.isFinite(x[m]?.[k])) return x[m]?.[k] ?? null;
    const p = prev?.segments?.find((s2) => s2.id === x.id);   // 단독이 없으면 누적 차감
    const ytdK = k === 'single' ? 'ytd' : 'priorYtd';
    return Number.isFinite(x[m]?.[ytdK]) && Number.isFinite(p?.[m]?.[ytdK]) ? x[m][ytdK] - p[m][ytdK] : null;
  };
  const segs = (cur.segments || []).map((x) => ({ name: x.name, rev: segVal(x, 'rev', kSeg[0]), revP: segVal(x, 'rev', kSeg[1]), op: segVal(x, 'op', kSeg[0]), opP: segVal(x, 'op', kSeg[1]) }));
  const tot = (key) => { const v = segs.map((x) => x[key]).filter(Number.isFinite); return v.length ? v.reduce((a, b) => a + b, 0) : null; };
  const consRev = cur.total?.[kSeg[0]]?.rev ?? null; const consOp = cur.total?.[kSeg[0]]?.op ?? null;
  const segTable = segs.length ? `<div class="table-wrap"><table class="tbl xbrl-tbl seg-tbl"><thead><tr><th>영업부문 (억원)</th><th>매출액</th><th>전년 동기</th><th>증감률</th><th>영업이익</th><th>이익률</th><th>전년 동기</th></tr></thead><tbody>
    ${segs.map((x) => `<tr><th scope="row">${esc(x.name)}</th><td class="num">${eok(x.rev)}</td><td class="num">${eok(x.revP)}</td>${pctCell(yoy(x.rev, x.revP))}<td class="num ${x.op < 0 ? 'dn' : ''}">${eok(x.op)}</td><td class="num">${Number.isFinite(x.op) && x.rev ? fmt.n((x.op / x.rev) * 100, 1) + '%' : '—'}</td><td class="num">${eok(x.opP)}</td></tr>`).join('')}
    <tr class="corp-sum"><th scope="row">부문 합계</th><td class="num">${eok(tot('rev'))}</td><td class="num">${eok(tot('revP'))}</td>${pctCell(yoy(tot('rev'), tot('revP')))}<td class="num">${eok(tot('op'))}</td><td></td><td class="num">${eok(tot('opP'))}</td></tr>
    ${Number.isFinite(consRev) && Number.isFinite(tot('rev')) ? `<tr><th scope="row" class="mut">조정·제거 (연결 − 부문 합계)</th><td class="num mut">${eok(consRev - tot('rev'))}</td><td></td><td></td><td class="num mut">${Number.isFinite(consOp) && Number.isFinite(tot('op')) ? eok(consOp - tot('op')) : '—'}</td><td></td><td></td></tr>` : ''}
    </tbody></table></div><p class="help">매출 기준: ${esc(cur.concepts?.segRev || '—')} · 영업이익 기준: ${esc(cur.concepts?.segOp || '—')}</p>`
    : '<p class="mut">이 보고서 XBRL에는 영업부문 수치가 없습니다(반기·분기 보고서는 부문 주석을 생략하는 경우가 많음).</p>';
  return `${kpis}
    ${borrowSection}
    <div class="xbrl-grid"><div><h3 class="xbrl-h">감가상각비 4종 · ${esc(per)}</h3>${depTable}</div>
    <div><h3 class="xbrl-h">영업부문별 실적 · ${esc(per)}</h3>${segTable}</div></div>
    <p class="help">출처: OpenDART 재무제표 원본(XBRL) · 접수 ${esc(cur.rcept)} · ${cur.fs === 'OFS' ? '별도' : '연결'} · ${fresh ? '기기 저장본(다시 받지 않음)' : '정정 전 저장본'} · 저장 ${esc(new Date(cur.at).toLocaleDateString('ko-KR'))}${derived ? ' · 일부 단독 값은 누적 차감으로 계산' : ''} · 감가상각은 주석 변동표의 표준 개념만 사용(리스 이자 등 하위 항목 제외)</p>`;
}

/* ------------------------------------------------------------ 자금조달·주주환원·감사 렌더 */
export function fundingHtml(f) {
  const ok = (x) => x && !x.error;
  const bal = [['bonds', '회사채'], ['cp', '기업어음(CP)'], ['shortBonds', '단기사채'], ['hybrid', '신종자본증권'], ['contingent', '조건부자본증권']];
  const within1y = (x) => (ok(x) ? x.buckets.filter((b) => /^de\d|^yy1_below$|_yy1_below$/.test(b.key)).reduce((a, b) => a + (b.value || 0), 0) : 0);
  const near = ['bonds', 'cp', 'shortBonds'].reduce((a, k) => a + within1y(f[k]), 0);
  const per = (x) => (x?.period ? ` <small class="mut">${esc(x.period.name)}</small>` : '');
  const tiles = bal.map(([k, l]) => `<div class="kpi-tile"><div class="kpi-lbl">${l} 미상환 잔액</div><div class="kpi-val num">${ok(f[k]) && f[k].total !== null ? fmt.won(f[k].total) : '—'}</div><div class="kpi-sub"><span class="mut">${ok(f[k]) ? esc(f[k].period?.name || '') : f[k]?.error ? '조회 오류' : '미발행·미공시'}</span></div></div>`).join('')
    + `<div class="kpi-tile"><div class="kpi-lbl">1년 내 만기 시장성 차입</div><div class="kpi-val num">${near ? fmt.won(near) : '—'}</div><div class="kpi-sub"><span class="mut">회사채·CP·단기사채 만기 구간 합산</span></div></div>`;
  const bucketTable = (x, title) => (ok(x) && x.buckets.length ? `<div><h3 class="xbrl-h">${title} 만기 구조${per(x)}</h3><table class="tbl xbrl-tbl"><thead><tr><th>잔여 만기</th><th>잔액</th></tr></thead><tbody>${x.buckets.map((b) => `<tr><th scope="row">${esc(b.label || b.key)}</th><td class="num">${b.value !== null ? fmt.won(b.value) : '—'}</td></tr>`).join('')}<tr class="corp-sum"><th scope="row">합계</th><td class="num">${x.total !== null ? fmt.won(x.total) : '—'}</td></tr></tbody></table></div>` : '');
  const iss = ok(f.issuance) && f.issuance.list.length ? `<div class="table-wrap"><table class="tbl xbrl-tbl left"><thead><tr><th>발행일</th><th>증권 종류</th><th>방법</th><th>금액</th><th>금리</th><th>등급(기관)</th><th>만기</th><th>상환</th></tr></thead><tbody>${f.issuance.list.slice(0, 10).map((x) => `<tr><td>${esc(x.date)}</td><td class="txt">${esc(x.kind)}</td><td class="txt">${esc(x.method)}</td><td class="num">${x.amount !== null ? fmt.won(x.amount) : '—'}</td><td>${esc(x.rate)}</td><td class="txt">${esc(x.grade)}</td><td>${esc(x.maturity)}</td><td>${esc(x.repaid)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="mut">해당 기간 채무증권 발행 내역 없음</p>';
  const d = f.dividends;
  const div = ok(d) ? `${dl([['주당 현금배당금(보통)', esc(d.dps || '')], ['현금배당성향', d.payout ? esc(d.payout) + '%' : ''], ['현금배당수익률(보통)', d.yield ? esc(d.yield) + '%' : ''], ['현금배당금 총액', esc(d.total || '')]])}<p class="help">배당 단위는 공시 원문 기준(주당: 원, 총액: 백만원)${per(d)}</p>` : fail(d);
  const t = f.treasury;
  const tre = ok(t) ? dl([['기초', t.begin !== null ? `${fmt.int(t.begin)}주` : ''], ['취득', t.acquired !== null ? `${fmt.int(t.acquired)}주` : ''], ['처분', t.disposed !== null ? `${fmt.int(t.disposed)}주` : ''], ['소각', t.retired !== null ? `${fmt.int(t.retired)}주` : ''], ['기말 보유', t.end !== null ? `${fmt.int(t.end)}주` : '']]) : fail(t);
  const a = f.auditor;
  const aud = ok(a) ? `<table class="tbl xbrl-tbl left"><thead><tr><th>사업연도</th><th>감사인</th><th>감사의견</th><th>강조사항 등</th></tr></thead><tbody>${a.rows.slice(0, 3).map((r) => `<tr><td>${esc(r.year)}</td><td class="txt">${esc(r.auditor)}</td><td class="txt"><b>${esc(r.opinion)}</b></td><td class="txt">${esc((r.emphasis || '—').slice(0, 80))}</td></tr>`).join('')}</tbody></table>` : fail(a);
  return `<div class="kpi-strip fund-kpi">${tiles}</div>
    <div class="xbrl-grid">${bucketTable(f.bonds, '회사채')}${bucketTable(f.cp, '기업어음')}</div>
    <h3 class="xbrl-h">채무증권 발행 실적${per(f.issuance)}</h3>${iss}
    <div class="corp-grid">${block('배당', '', div)}${block('자기주식', per(t).replace(/<[^>]+>/g, '').trim(), tre)}${block('회계감사인 · 감사의견', per(a).replace(/<[^>]+>/g, '').trim(), aud)}</div>
    <p class="help">출처: OpenDART 정기보고서 주요정보 — 회사채(cprndNrdmpBlce)·단기사채(srtpdPsndbtNrdmpBlce)·기업어음(entrprsBilScritsNrdmpBlce)·신종자본(newCaplScritsNrdmpBlce)·조건부자본(cndlCaplScritsNrdmpBlce) 미상환 잔액, 채무증권 발행(detScritsIsuAcmslt), 배당(alotMatter), 자기주식(tesstkAcqsDspsSttus), 감사의견(accnutAdtorNmNdAdtOpinion). 선택 분기 보고서가 없으면 직전 공시를 사용합니다.</p>`;
}
