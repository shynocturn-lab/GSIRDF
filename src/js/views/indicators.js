/* 금융지표 — 한국은행 ECOS (구간 저장 + 3시간마다 최근 10일 증분 갱신) */
import { api, errorText, kst, ymd } from '../api.js';
import { ECOS } from '../config.js';
import { lineChart, PALETTE } from '../charts.js';
import { $, esc, fmt, dirClass, skeleton, errorBox, segmented, onSeg, placeSegInd } from '../ui.js';

const GROUPS = {
  rates: { label: '금리', keys: ['base', 'call', 'cd91', 'ktb3', 'ktb10'], unit: '%' },
  credit: { label: '회사채', keys: ['ktb3', 'aa3', 'bbb3'], unit: '%', spread: true },
  fx: { label: '환율', keys: ['usd', 'jpy', 'cny'], unit: '원', rebase: true },
  index: { label: '주가지수', keys: ['kospi', 'kosdaq'], unit: 'pt', rebase: true },
};
const RANGES = [['90', '3개월'], ['365', '1년'], ['1095', '3년']];

export async function render(root) {
  let group = 'rates';
  let days = '365';
  root.innerHTML = `
  <section class="page-head">
    <div><p class="eyebrow">MACRO · 한국은행 ECOS</p><h1>금융지표</h1></div>
    ${segmented('days', RANGES, days)}
  </section>
  ${segmented('group', Object.entries(GROUPS).map(([k, g]) => [k, g.label]), group)}
  <section class="kpi-strip" id="indKpi"></section>
  <section class="card">
    <div class="card-hd"><h2 id="indTitle"></h2><span class="chip" id="indNote"></span></div>
    <div id="indChart">${skeleton(320)}</div>
    <div class="legend" id="indLegend"></div>
  </section>
  <section class="card" id="spreadCard" hidden>
    <div class="card-hd"><h2>신용 스프레드</h2><span class="chip">회사채 3년 − 국고채 3년 · bp</span></div>
    <div id="spreadChart"></div>
  </section>
  <p class="foot-note">ECOS 일별 통계는 영업일 기준이며 공표 시점에 따라 최근 1~2영업일이 비어 있을 수 있습니다. 기기에 구간 저장되며, 3시간마다 최근 10일 수정치와 부족 구간만 추가로 받아옵니다.</p>`;
  placeSegInd(root);

  let seq = 0;
  const load = async () => {
    const my = ++seq;
    const g = GROUPS[group];
    $('#indTitle', root).textContent = g.label + (g.rebase ? ' (기간 시작 = 100)' : '');
    $('#indNote', root).textContent = g.rebase ? '지수화 비교' : `단위 ${g.unit}`;
    $('#indChart', root).innerHTML = skeleton(320);
    $('#indKpi', root).innerHTML = g.keys.map(() => skeleton(96)).join('');
    $('#spreadCard', root).hidden = !g.spread;
    const end = ymd(kst());
    const start = ymd(new Date(kst().getTime() - Number(days) * 86400e3));
    const res = await Promise.allSettled(g.keys.map((k) => api.ecos(ECOS[k], 'D', start, end)));
    if (my !== seq) return;
    const ok = res.every((r) => r.status === 'fulfilled');
    if (!res.some((r) => r.status === 'fulfilled')) {
      const msg = errorText(res[0].reason);
      $('#indChart', root).innerHTML = errorBox(msg);
      $('#indKpi', root).innerHTML = '';
      return;
    }
    const maps = res.map((r) => new Map((r.status === 'fulfilled' ? r.value.rows : []).filter((x) => Number.isFinite(x.value)).map((x) => [x.time, x.value])));
    const labels = [...new Set(maps.flatMap((m) => [...m.keys()]))].sort();
    // 결측일은 직전값으로 이어 그리지 않고 비워 둔다(사실 그대로 표시)
    const series = g.keys.map((k, i) => {
      const vals = labels.map((t) => maps[i].get(t) ?? null);
      if (!g.rebase) return { name: ECOS[k].name, values: vals, color: PALETTE[i] };
      const b = vals.find(Number.isFinite);
      return { name: ECOS[k].name, values: vals.map((v) => (Number.isFinite(v) ? (v / b) * 100 : null)), color: PALETTE[i], raw: vals };
    });

    $('#indKpi', root).innerHTML = g.keys.map((k, i) => {
      const vals = [...maps[i].values()];
      if (!vals.length) return `<div class="kpi-tile"><div class="kpi-lbl">${esc(ECOS[k].name)}</div><div class="kpi-val mut">—</div><div class="kpi-sub mut">${res[i].status === 'rejected' ? esc(errorText(res[i].reason)) : '자료 없음'}</div></div>`;
      const last = vals.at(-1), first = vals[0], prev = vals.at(-2);
      const isRate = ECOS[k].unit === '%';
      const chg = (a, b) => { if (!isRate) return fmt.pct(((a - b) / b) * 100, 2); const bp = Math.round((a - b) * 100); return `${bp > 0 ? '+' : ''}${bp}bp`; };
      return `<div class="kpi-tile" style="--accent:${PALETTE[i]}">
        <div class="kpi-lbl"><i class="dot" style="background:${PALETTE[i]}"></i>${esc(ECOS[k].name)}</div>
        <div class="kpi-val num">${fmt.n(last, 2)}<small>${isRate ? '%' : ''}</small></div>
        <div class="kpi-sub"><span class="num ${dirClass(last - (prev ?? last))}">전일 ${prev === undefined ? '—' : chg(last, prev)}</span><span class="num mut">기간 ${chg(last, first)}</span></div>
      </div>`;
    }).join('');

    lineChart($('#indChart', root), {
      labels, height: 320, area: false, padLeft: 54,
      series: series.map((s) => (s.raw ? { ...s, fmt: undefined } : s)),
      yFmt: (v) => (g.rebase ? v.toFixed(0) : v.toFixed(2)),
      xFmt: (d, long) => (long ? fmt.date(d) : `${d.slice(2, 4)}.${d.slice(4, 6)}`),
    });
    $('#indLegend', root).innerHTML = series.map((s) => `<span><i style="background:${s.color}"></i>${esc(s.name)}</span>`).join('')
      + (ok ? '' : '<span class="amber-text">일부 지표 조회 실패</span>');

    if (g.spread) {
      const [ktb, aa, bbb] = maps;
      const sp = (m) => labels.map((t) => (m.has(t) && ktb.has(t) ? (m.get(t) - ktb.get(t)) * 100 : null));
      lineChart($('#spreadChart', root), {
        labels, height: 220, padLeft: 48,
        series: [{ name: 'AA- 스프레드', values: sp(aa), color: 'var(--brand)', fmt: (v) => `${v.toFixed(0)}bp` },
          { name: 'BBB- 스프레드', values: sp(bbb), color: 'var(--amber)', fmt: (v) => `${v.toFixed(0)}bp` }],
        yFmt: (v) => v.toFixed(0), xFmt: (d, long) => (long ? fmt.date(d) : `${d.slice(2, 4)}.${d.slice(4, 6)}`),
      });
    }
  };
  onSeg(root, 'days', (v) => { days = v; load(); });
  onSeg(root, 'group', (v) => { group = v; load(); });
  load();
}
