/* 주가 — KRX 일별 종가 기반 가격·투자지표·상대수익률(KOSPI·KOSPI 건설) */
import { api, errorText } from '../api.js';
import { COMPANIES, companyById } from '../config.js';
import { settings } from '../store.js';
import { lineChart, PALETTE } from '../charts.js';
import { $, esc, fmt, dirClass, skeleton, errorBox, segmented, onSeg, placeSegInd } from '../ui.js';
import { collect, makeCalc, latestFiledQuarter } from '../peerdata.js';
import { rebase, relative, multiple } from '../stockcalc.js';

const LISTED = COMPANIES.filter((c) => c.ticker);
const RANGES = [['1m', '1개월'], ['3m', '3개월'], ['6m', '6개월'], ['1y', '1년']];
const xFmt = (d, long) => (long ? fmt.date(d) : `${d.slice(2, 4)}.${d.slice(4, 6)}.${d.slice(6)}`);
const CON_COLOR = '#F5A524';
const IND = [['mktcap', '시가총액'], ['foreign', '외국인 보유율'], ['per', 'PER'], ['pbr', 'PBR'], ['volume', '거래량'], ['value', '거래대금'], ['con', 'KOSPI 건설 대비']];

export async function render(root) {
  let sel = companyById(settings.get().company);
  if (!sel.ticker) sel = LISTED[0];
  let range = '3m';
  let series = null;
  let snap = null;

  root.innerHTML = `
  <section class="page-head">
    <div><p class="eyebrow">STOCK</p><h1>주가</h1></div>
    ${segmented('range', RANGES, range)}
  </section>
  <div class="chips" id="coChips">${LISTED.map((c) => `<button class="chip-btn${c.id === sel.id ? ' on' : ''}" data-id="${c.id}">${esc(c.name)}</button>`).join('')}</div>
  <section class="kpi-strip px-ind" id="pxInd">${IND.map(() => skeleton(104)).join('')}</section>
  <p class="help px-ind-note" id="pxIndNote"></p>
  <section class="card">
    <div class="card-hd"><h2 id="pxTitle">${esc(sel.name)} 종가</h2><span class="chip">KRX 일별 확정치 · 샘플링 최대 20점</span></div>
    <div class="stat-row" id="pxStats"></div>
    <div id="pxChart">${skeleton(280)}</div>
  </section>
  <section class="grid two-wide">
    <article class="card">
      <div class="card-hd"><h2>건설 상장사 상대수익률</h2><span class="chip">기간 시작 = 0%</span></div>
      <div id="relChart">${skeleton(280)}</div>
      <div class="legend" id="relLegend"></div>
    </article>
    <article class="card">
      <div class="card-hd"><h2>기간 수익률 순위</h2></div>
      <div id="rank">${skeleton(280)}</div>
    </article>
  </section>
  <section class="card">
    <div class="card-hd"><h2 id="conTitle">${esc(sel.name)} vs KOSPI 건설 지수</h2><span class="chip">기간 시작 = 100</span></div>
    <div class="stat-row" id="conStats"></div>
    <div id="conChart">${skeleton(280)}</div>
    <div class="legend" id="conLegend"></div>
  </section>`;
  placeSegInd(root);

  let seq = 0;
  const load = async () => {
    const my = ++seq;
    ['#pxChart', '#relChart', '#conChart'].forEach((s) => { $(s, root).innerHTML = skeleton(280); });
    try {
      const data = await api.series(LISTED.map((c) => c.ticker), range, true);
      if (my !== seq) return;
      series = data;
      draw(root, data, sel);
      drawCon(root, data, sel);
    } catch (err) {
      if (my !== seq) return;
      series = null;
      ['#pxChart', '#relChart', '#rank', '#conChart'].forEach((s) => { $(s, root).innerHTML = errorBox(errorText(err)); });
      $('#pxStats', root).innerHTML = ''; $('#conStats', root).innerHTML = '';
    }
    indicators(my);
  };

  /* 투자지표: KRX 최신 거래일(시총·거래량·거래대금) + 외국인·PER·PBR(네이버 증권, 실패 시 DART 로직) + 건설지수 대비 */
  async function indicators(my) {
    const tickers = [...LISTED.map((c) => c.ticker)].sort();
    const [sRes, iRes] = await Promise.allSettled([snap && snap.codes === tickers.join() ? Promise.resolve(snap.data) : api.snapshot(tickers), api.stockInfo(sel.ticker)]);
    if (my !== seq) return;
    if (sRes.status === 'fulfilled') snap = { codes: tickers.join(), data: sRes.value };
    const s = sRes.status === 'fulfilled' ? sRes.value.stocks.find((x) => x.code === sel.ticker) : null;
    const info = iRes.status === 'fulfilled' ? iRes.value : null;
    const con = sRes.status === 'fulfilled' ? sRes.value.index?.construction : null;
    const rel = series ? relative(series.points.map((p) => p.date), series.points.map((p) => p.stocks[sel.ticker]?.close ?? null), series.points.map((p) => p.con ?? null)) : null;
    const v = { per: info?.per ?? null, pbr: info?.pbr ?? null, perSrc: info ? '네이버 증권' : '', pbrSrc: info ? '네이버 증권' : '' };
    paintInd(s, info, con, rel, v, sRes, iRes);
    // PER·PBR 대체: 네이버 증권 응답이 없으면 DART 최근 사업보고서 EPS·BPS로 계산
    if ((v.per === null || v.pbr === null) && s?.close) {
      try {
        const lf = latestFiledQuarter();
        const y = lf.q === 4 ? lf.y : lf.y - 1;
        const data = await collect([sel], [y], [1, 2, 3, 4]);
        if (my !== seq) return;
        const calc = makeCalc(data);
        const eps = calc(sel, y, [1, 2, 3, 4], 'eps').value;
        const bps = calc(sel, y, [1, 2, 3, 4], 'bps').value;
        if (v.per === null) { v.per = multiple(s.close, eps); v.perSrc = eps !== null && eps <= 0 ? `적자(EPS ${fmt.int(eps)}원)` : `로직 · ${y} EPS ${fmt.int(eps)}원`; }
        if (v.pbr === null) { v.pbr = multiple(s.close, bps); v.pbrSrc = `로직 · ${y}말 BPS ${fmt.int(bps)}원`; }
        paintInd(s, info, con, rel, v, sRes, iRes);
      } catch { /* 대체 계산 실패 시 — 표시 유지 */ }
    }
  }

  function paintInd(s, info, con, rel, v, sRes, iRes) {
    const tile = (k, label, val, sub, subCls = '') => `<div class="kpi-tile" data-k="${k}"><div class="kpi-lbl">${label}</div><div class="kpi-val num">${val}</div><div class="kpi-sub"><span class="mut ${subCls}">${sub}</span></div></div>`;
    const day = s ? `${fmt.date(s.date)}` : '';
    const conDay = s && con && Number.isFinite(s.rate) && Number.isFinite(con.rate) ? s.rate - con.rate : null;
    $('#pxInd', root).innerHTML = [
      tile('mktcap', '시가총액', s ? fmt.won(s.mktcap) : '—', s ? `${day} · KRX` : 'KRX 시세 없음'),
      tile('foreign', '외국인 보유율', info?.foreignRate != null ? `${fmt.n(info.foreignRate, 2)}<small>%</small>` : '—', info?.foreignRate != null ? '외인소진율 · 네이버 증권' : '제공처 응답 없음'),
      tile('per', 'PER', v.per != null ? `${fmt.n(v.per, 2)}<small>배</small>` : '—', v.perSrc || '계산 중…'),
      tile('pbr', 'PBR', v.pbr != null ? `${fmt.n(v.pbr, 2)}<small>배</small>` : '—', v.pbrSrc || '계산 중…'),
      tile('volume', '거래량', s ? `${fmt.int(s.volume)}<small>주</small>` : '—', s ? `${day} · KRX` : ''),
      tile('value', '거래대금', s ? fmt.won(s.value) : '—', s ? `${day} · KRX` : ''),
      `<div class="kpi-tile" data-k="con"><div class="kpi-lbl">KOSPI 건설 대비 (${RANGES.find((r) => r[0] === range)[1]})</div>
        <div class="kpi-val num ${dirClass(rel?.excess)}">${rel?.excess != null ? `${rel.excess > 0 ? '+' : ''}${fmt.n(rel.excess, 2)}<small>%p</small>` : '—'}</div>
        <div class="kpi-sub"><span class="mut">${rel?.excess != null ? `종목 ${fmt.pct(rel.ret, 1)} · 건설 ${fmt.pct(rel.idxRet, 1)}` : '건설 지수 없음'}</span>${conDay != null ? `<span class="num ${dirClass(conDay)}">당일 ${conDay > 0 ? '+' : ''}${conDay.toFixed(2)}%p</span>` : ''}</div></div>`,
    ].join('');
    const notes = [];
    if (sRes.status === 'rejected') notes.push(`KRX: ${errorText(sRes.reason)}`);
    if (iRes.status === 'rejected') notes.push(iRes.reason?.code === 'NOT_FOUND' ? '외국인 보유율·PER·PBR: Worker를 v1.6으로 업데이트하면 표시됩니다' : `외국인 보유율: ${errorText(iRes.reason)}`);
    $('#pxIndNote', root).textContent = notes.join(' · ');
  }

  onSeg(root, 'range', (v) => { range = v; load(); });
  $('#coChips', root).addEventListener('click', (e) => {
    const b = e.target.closest('.chip-btn');
    if (!b) return;
    sel = companyById(b.dataset.id);
    root.querySelectorAll('#coChips .chip-btn').forEach((x) => x.classList.toggle('on', x === b));
    $('#pxTitle', root).textContent = `${sel.name} 종가`;
    $('#conTitle', root).textContent = `${sel.name} vs KOSPI 건설 지수`;
    load();
  });
  load();
}

function draw(root, data, sel) {
  const pts = data.points;
  const labels = pts.map((p) => p.date);
  const px = pts.map((p) => p.stocks[sel.ticker]?.close ?? null);
  const valid = px.filter(Number.isFinite);
  const base = valid[0];
  const kBase = pts.find((p) => Number.isFinite(p.kospi))?.kospi;
  const kRe = pts.map((p) => (Number.isFinite(p.kospi) && kBase ? (p.kospi / kBase) * base : null));
  const ret = valid.length > 1 ? (valid.at(-1) / valid[0] - 1) * 100 : null;
  const kRet = kBase ? (pts.at(-1).kospi / kBase - 1) * 100 : null;

  $('#pxStats', root).innerHTML = [
    ['최근 종가', `${fmt.int(valid.at(-1))}원`],
    ['기간 수익률', `<span class="${dirClass(ret)}">${fmt.pct(ret)}</span>`],
    ['KOSPI 대비', `<span class="${dirClass(ret - kRet)}">${fmt.pct(ret !== null && kRet !== null ? ret - kRet : null)}p</span>`],
    ['기간 최고', `${fmt.int(Math.max(...valid))}`],
    ['기간 최저', `${fmt.int(Math.min(...valid))}`],
  ].map(([k, v]) => `<div class="stat"><span>${k}</span><b class="num">${v}</b></div>`).join('');

  lineChart($('#pxChart', root), {
    labels, height: 290, padLeft: 60,
    series: [{ name: sel.name, values: px }, { name: 'KOSPI(환산)', values: kRe, color: 'var(--c-us)', dash: true }],
    yFmt: (v) => fmt.int(v), xFmt,
  });

  const rel = LISTED.map((c, i) => {
    const s = pts.map((p) => p.stocks[c.ticker]?.close ?? null);
    const b = s.find(Number.isFinite);
    return { c, color: c.id === sel.id ? 'var(--brand)' : PALETTE[(i + 1) % PALETTE.length], values: s.map((v) => (Number.isFinite(v) && b ? (v / b - 1) * 100 : null)) };
  });
  const kospiRel = pts.map((p) => (Number.isFinite(p.kospi) && kBase ? (p.kospi / kBase - 1) * 100 : null));
  lineChart($('#relChart', root), {
    labels, height: 290, area: false, padLeft: 48,
    series: [...rel.map((r) => ({ name: r.c.name, values: r.values, color: r.color })), { name: 'KOSPI', values: kospiRel, color: 'var(--mut)', dash: true }],
    yFmt: (v) => `${v.toFixed(0)}%`, xFmt,
  });
  $('#relLegend', root).innerHTML = rel.map((r) => `<span><i style="background:${r.color}"></i>${esc(r.c.name)}</span>`).join('') + '<span><i style="background:var(--mut)"></i>KOSPI</span>';

  const ranking = rel.map((r) => ({ name: r.c.name, me: r.c.id === sel.id, v: r.values.filter(Number.isFinite).at(-1) ?? null }))
    .concat([{ name: 'KOSPI', v: kospiRel.filter(Number.isFinite).at(-1) ?? null, idx: true }])
    .filter((r) => r.v !== null).sort((a, b) => b.v - a.v);
  const max = Math.max(1, ...ranking.map((r) => Math.abs(r.v)));
  $('#rank', root).innerHTML = `<div class="rank-list">${ranking.map((r, i) => `
    <div class="rank-row${r.me ? ' me' : ''}${r.idx ? ' idx' : ''}">
      <span class="rank-no num">${i + 1}</span><span class="rank-name">${esc(r.name)}</span>
      <span class="rank-bar"><i class="${dirClass(r.v)}" style="--w:${(Math.abs(r.v) / max) * 100}%"></i></span>
      <b class="num ${dirClass(r.v)}">${fmt.pct(r.v, 1)}</b>
    </div>`).join('')}</div>`;
}

/** 하단: 종목 vs KOSPI 건설 지수 (기간 시작 = 100) */
function drawCon(root, data, sel) {
  const pts = data.points;
  const labels = pts.map((p) => p.date);
  const stock = pts.map((p) => p.stocks[sel.ticker]?.close ?? null);
  const con = pts.map((p) => p.con ?? null);
  const kospi = pts.map((p) => p.kospi ?? null);
  if (!con.some(Number.isFinite)) {
    $('#conChart', root).innerHTML = `<div class="chart-empty">KOSPI 건설 지수 자료가 없습니다. Cloudflare Worker를 v1.6으로 업데이트하면 표시됩니다.</div>`;
    $('#conStats', root).innerHTML = ''; $('#conLegend', root).innerHTML = '';
    return;
  }
  const r = relative(labels, stock, con);
  const rk = relative(labels, stock, kospi);
  $('#conStats', root).innerHTML = [
    [`${sel.name} 수익률`, `<span class="${dirClass(r.ret)}">${fmt.pct(r.ret)}</span>`],
    ['KOSPI 건설 수익률', `<span class="${dirClass(r.idxRet)}">${fmt.pct(r.idxRet)}</span>`],
    ['건설 대비 초과수익', `<span class="${dirClass(r.excess)}">${fmt.pct(r.excess)}p</span>`],
    ['KOSPI 대비', `<span class="${dirClass(rk.excess)}">${fmt.pct(rk.excess)}p</span>`],
  ].map(([k, v]) => `<div class="stat"><span>${esc(k)}</span><b class="num">${v}</b></div>`).join('');
  const nf = (v) => v.toFixed(1);
  lineChart($('#conChart', root), {
    labels, height: 290, area: false, padLeft: 48,
    series: [
      { name: sel.name, values: rebase(stock), color: 'var(--brand)', fmt: nf },
      { name: 'KOSPI 건설', values: rebase(con), color: CON_COLOR, fmt: nf },
      { name: 'KOSPI', values: rebase(kospi), color: 'var(--mut)', dash: true, fmt: nf },
    ],
    yFmt: (v) => v.toFixed(0), xFmt,
  });
  $('#conLegend', root).innerHTML = `<span><i style="background:var(--brand)"></i>${esc(sel.name)}</span><span><i style="background:${CON_COLOR}"></i>KOSPI 건설</span><span><i style="background:var(--mut)"></i>KOSPI</span>`;
}
