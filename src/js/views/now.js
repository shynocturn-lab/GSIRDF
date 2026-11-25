/* IR NOW — 오늘의 종합 대시보드 */
import { api, errorText, kst, ymd } from '../api.js';
import { COMPANIES, ECOS, companyById } from '../config.js';
import { settings } from '../store.js';
import { lineChart } from '../charts.js';
import { $, esc, safeUrl, fmt, dirClass, arrow, skeleton, errorBox, emptyBox, countUp, icon, plain } from '../ui.js';
import { appendRealtimePoint } from '../realtime.js';

const LISTED = COMPANIES.filter((c) => c.ticker);

export async function render(root) {
  const me = companyById(settings.get().company);
  root.innerHTML = `
  <section class="page-head">
    <div><p class="eyebrow">IR NOW</p><h1>${esc(me.name)} 오늘의 브리핑</h1></div>
    <p class="page-meta" id="nowMeta">${fmt.date(ymd(kst()))} 기준</p>
  </section>
  <section class="grid hero-grid">
    <article class="card hero-card" id="heroCard">${skeleton(250)}</article>
    <article class="card" id="mktCard">
      <div class="card-hd"><h2>시장 · 금리 · 환율</h2><span class="chip">한국은행 ECOS · KRX</span></div>
      <div class="kpi-grid" id="mktGrid">${Array.from({ length: 6 }, () => skeleton(74)).join('')}</div>
    </article>
  </section>
  <section class="card" id="peerCard">
    <div class="card-hd"><h2>건설 상장사 시세</h2><span class="chip" id="peerDate">KRX 일별 확정치</span></div>
    <div id="peerBody">${skeleton(220)}</div>
  </section>
  <section class="grid two">
    <article class="card"><div class="card-hd"><h2>최근 공시</h2><a class="link" href="#/disclosure">전체 보기 →</a></div><div id="discBody">${skeleton(260)}</div></article>
    <article class="card"><div class="card-hd"><h2>뉴스</h2><a class="link" href="#/news">전체 보기 →</a></div><div id="newsBody">${skeleton(260)}</div></article>
  </section>`;

  heroAndPeers(root, me);
  markets(root);
  disclosures(root, me);
  news(root, me);
}

async function heroAndPeers(root, me) {
  const codes = [...new Set([me.ticker, ...LISTED.map((c) => c.ticker)].filter(Boolean))];
  const hero = $('#heroCard', root);
  const peerBody = $('#peerBody', root);
  if (!me.ticker) hero.innerHTML = emptyBox(`${me.name}은(는) 비상장사로 시세가 없습니다.`);
  try {
    const snap = await api.liveSnapshot(codes);
    document.dispatchEvent(new CustomEvent('idf:tape', { detail: snap }));
    const peerChip = snap.live
      ? `실시간 ${snap.tradedAt || ''} · 네이버`
      : snap.source === 'naver'
        ? `${fmt.date(snap.basDd)} 정규장 종가(잠정) · 네이버`
        : `${fmt.date(snap.basDd)} 종가 · KRX`;
    $('#peerDate', root).textContent = peerChip.replace(/\s+/g, ' ').trim();
    $('#peerDate', root).classList.toggle('live-chip', !!snap.live);
    const byCode = Object.fromEntries(snap.stocks.map((s) => [s.code, s]));
    if (me.ticker) renderHero(hero, me, byCode[me.ticker], snap);
    renderPeers(peerBody, byCode, me);
  } catch (err) {
    if (me.ticker) hero.innerHTML = errorBox(errorText(err));
    peerBody.innerHTML = errorBox(errorText(err));
  }
}

function renderHero(el, me, s, snap) {
  if (!s) { el.innerHTML = emptyBox('시세가 없습니다.'); return; }
  const k = snap.index?.kospi;
  const statusBadge = snap.live
    ? `<span class="live-badge"><i class="sync-dot"></i>실시간 ${esc(snap.tradedAt || '')} · 네이버</span>`
    : snap.source === 'naver'
      ? `<span class="prov-badge">${fmt.date(snap.basDd)} 정규장 종가(잠정) · 네이버</span>`
      : `<span class="mut">${fmt.date(snap.basDd)} 종가 · KRX</span>`;
  el.innerHTML = `
    <div class="hero-top">
      <div>
        <div class="hero-name">${esc(me.name)} <span class="mut num">${esc(me.ticker)} · KOSPI</span></div>
        <div class="hero-price num"><span id="heroPx">${fmt.int(s.close)}</span><small>원</small></div>
        <div class="hero-chg ${dirClass(s.change)}"><span class="pill pill-${dirClass(s.change)} num">${arrow(s.change)} ${fmt.int(Math.abs(s.change))} (${fmt.pct(s.rate)})</span>
          ${statusBadge}</div>
      </div>
      <dl class="hero-stats">
        <div><dt>시가총액</dt><dd class="num">${fmt.won(s.mktcap)}</dd></div>
        <div><dt>거래량</dt><dd class="num">${fmt.int(s.volume)}</dd></div>
        <div><dt>거래대금</dt><dd class="num">${fmt.won(s.value)}</dd></div>
        <div><dt>고가 / 저가</dt><dd class="num">${fmt.int(s.high)} / ${fmt.int(s.low)}</dd></div>
        ${k ? `<div><dt>KOSPI${k.live ? ' · 실시간' : ''}</dt><dd class="num">${fmt.n(k.close, 2)} <span class="${dirClass(k.change)}">${fmt.pct(k.rate)}</span></dd></div>` : ''}
      </dl>
    </div>
    <div class="hero-chart" id="heroChart">${skeleton(150)}</div>
    <div class="legend"><span><i style="background:var(--brand)"></i>${esc(me.name)}</span><span><i style="background:var(--c-us)"></i>KOSPI (기준 환산)</span><span class="mut">최근 3개월${snap.source === 'naver' ? ' · 당일 정규장 반영' : ''}</span></div>`;
  countUp(el.querySelector('#heroPx'), s.close, (v) => fmt.int(v));
  api.series([me.ticker], '3m', true).then((ser) => {
    const pts = appendRealtimePoint(ser.points, me.ticker, snap);
    const px = pts.map((p) => p.stocks[me.ticker]?.close ?? null);
    const base = px.find(Number.isFinite);
    const kBase = pts.find((p) => Number.isFinite(p.kospi))?.kospi;
    const kRebased = pts.map((p) => (Number.isFinite(p.kospi) && kBase ? (p.kospi / kBase) * base : null));
    const box = el.querySelector('#heroChart');
    if (!box || !box.isConnected) return;
    lineChart(box, {
      labels: pts.map((p) => p.date), height: 170, padLeft: 56,
      series: [
        { name: me.name, values: px, fmt: (v) => `${fmt.int(v)}원` },
        {
          name: 'KOSPI (환산)',
          values: kRebased,
          color: 'var(--c-us)',
          dash: true,
          fmt: (v, i) => (Number.isFinite(pts[i]?.kospi) ? `${fmt.int(v)}원 (${fmt.n(pts[i].kospi, 2)}pt)` : `${fmt.int(v)}원`),
        },
      ],
      yFmt: (v) => fmt.int(v),
      xFmt: (d, long) => {
        if (!long) return `${+d.slice(4, 6)}/${+d.slice(6)}`;
        if (snap.source === 'naver' && d === snap.basDd) return `${fmt.date(d)} ${snap.live ? `(실시간${snap.tradedAt ? ' ' + snap.tradedAt : ''})` : '(정규장 종가·잠정)'}`;
        return fmt.date(d);
      },
    });
  }).catch((err) => { const box = el.querySelector('#heroChart'); if (box) box.innerHTML = errorBox(errorText(err)); });
}

function renderPeers(el, byCode, me) {
  const rows = LISTED.map((c) => ({ c, s: byCode[c.ticker] })).filter((r) => r.s);
  if (!rows.length) { el.innerHTML = emptyBox('시세가 없습니다.'); return; }
  const maxAbs = Math.max(1, ...rows.map((r) => Math.abs(r.s.rate || 0)));
  rows.sort((a, b) => (b.s.mktcap || 0) - (a.s.mktcap || 0));
  el.innerHTML = `<div class="peer-board">${rows.map(({ c, s }) => `
    <div class="peer-row${c.id === me.id ? ' me' : ''}">
      <div class="peer-name"><b>${esc(c.name)}</b><span class="mut num">${c.ticker}</span></div>
      <div class="num peer-px">${fmt.int(s.close)}</div>
      <div class="peer-bar"><span class="axis0"></span><i class="${dirClass(s.rate)}" style="--w:${(Math.abs(s.rate || 0) / maxAbs) * 50}%"></i></div>
      <div class="num ${dirClass(s.rate)} peer-rt">${fmt.pct(s.rate)}</div>
      <div class="num mut peer-cap">${fmt.won(s.mktcap)}</div>
    </div>`).join('')}</div>`;
}

async function markets(root) {
  const grid = $('#mktGrid', root);
  const end = ymd(kst());
  const start = ymd(new Date(kst().getTime() - 40 * 86400e3));
  const defs = [ECOS.kospi, ECOS.kosdaq, ECOS.usd, ECOS.ktb3, ECOS.aa3, ECOS.base];
  const results = await Promise.allSettled(defs.map((d) => api.ecos(d, 'D', start, end)));
  grid.innerHTML = defs.map((d, i) => {
    const r = results[i];
    if (r.status !== 'fulfilled' || !r.value.rows.length) {
      return `<div class="kpi-tile"><div class="kpi-lbl">${esc(d.name)}</div><div class="kpi-val mut">—</div><div class="kpi-sub mut">${r.status === 'rejected' ? esc(errorText(r.reason)) : '자료 없음'}</div></div>`;
    }
    const rows = r.value.rows.filter((x) => Number.isFinite(x.value));
    const last = rows.at(-1);
    const prev = rows.at(-2);
    const diff = prev ? last.value - prev.value : null;
    const isRate = d.unit === '%';
    const bp = diff === null ? null : Math.round(diff * 100);
    const dTxt = diff === null ? '' : isRate ? `${bp > 0 ? '+' : ''}${bp}bp` : `${fmt.signed(diff, 2)}`;
    const series = rows.map((x) => x.value);
    return `<div class="kpi-tile">
      <div class="kpi-lbl">${esc(d.name)}</div>
      <div class="kpi-val num">${isRate ? fmt.n(last.value, 2) + '<small>%</small>' : fmt.n(last.value, 2)}</div>
      <div class="kpi-sub"><span class="num ${dirClass(diff)}">${dTxt}</span><span class="mut num">${fmt.date(last.time).slice(5)}</span></div>
      <div class="kpi-spark">${sparkInline(series, diff)}</div>
    </div>`;
  }).join('');
}

function sparkInline(values, diff) {
  const v = values.slice(-25);
  if (v.length < 2) return '';
  const min = Math.min(...v), max = Math.max(...v);
  const pts = v.map((x, i) => `${(i / (v.length - 1)) * 100},${28 - ((x - min) / (max - min || 1)) * 24}`).join(' ');
  const c = diff > 0 ? 'var(--up)' : diff < 0 ? 'var(--dn)' : 'var(--mut)';
  return `<svg viewBox="0 0 100 30" preserveAspectRatio="none"><polyline points="${pts}" fill="none" stroke="${c}" stroke-width="1.6" vector-effect="non-scaling-stroke"/></svg>`;
}

async function disclosures(root, me) {
  const el = $('#discBody', root);
  try {
    const body = await api.disclosures(me.corp, 60, 1, 8);
    const list = body.list || [];
    if (!list.length) { el.innerHTML = emptyBox('최근 60일 공시가 없습니다.'); return; }
    el.innerHTML = `<ul class="feed">${list.slice(0, 7).map((d) => `
      <li><a href="https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${esc(d.rcept_no)}" target="_blank" rel="noopener">
        <span class="feed-date num">${fmt.date(d.rcept_dt).slice(5)}</span>
        <span class="feed-title">${esc(d.report_nm.trim())}</span>
        ${/정정/.test(d.report_nm) ? '<span class="tag amber">정정</span>' : ''}
      </a></li>`).join('')}</ul>`;
  } catch (err) { el.innerHTML = errorBox(errorText(err)); }
}

async function news(root, me) {
  const el = $('#newsBody', root);
  try {
    const body = await api.news(me.name, 12);
    const items = body.items || [];
    if (!items.length) { el.innerHTML = emptyBox('뉴스가 없습니다.'); return; }
    el.innerHTML = `<ul class="feed">${items.slice(0, 7).map((n) => `
      <li><a href="${esc(safeUrl(n.link))}" target="_blank" rel="noopener">
        <span class="feed-date">${esc(fmt.ago(n.pubDate))}</span>
        <span class="feed-title">${esc(plain(n.title))}</span>
      </a></li>`).join('')}</ul>`;
  } catch (err) { el.innerHTML = errorBox(errorText(err)); }
}
