/* 경량 SVG 차트 — 의존성 없음. 라인/영역, 그룹 막대, 스파크라인. 호버 크로스헤어·툴팁. */
import { esc } from './ui.js';

const NS = 'http://www.w3.org/2000/svg';
export const PALETTE = ['var(--brand)', 'var(--c-us)', '#22D3EE', 'var(--amber)', '#F472B6', '#34D399', '#A3A3A3', '#FB923C', '#60A5FA', '#C084FC'];

function niceTicks(min, max, count = 4) {
  if (min === max) { min -= 1; max += 1; }
  const span = max - min;
  const step0 = span / count;
  const mag = 10 ** Math.floor(Math.log10(step0));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= step0) || step0;
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = lo; v <= hi + step * 1e-9; v += step) ticks.push(+v.toFixed(10));
  return { lo, hi, ticks };
}

function size(el, height) {
  const w = Math.max(240, el.clientWidth || el.parentElement?.clientWidth || 600);
  return { w, h: height };
}

/**
 * lineChart(el, { labels:[...], series:[{name, values:[...], color}], height, yFmt, xFmt, area, zero })
 */
export function lineChart(el, opt) {
  if (!el) return;
  const { labels, series } = opt;
  const height = opt.height || 260;
  const yFmt = opt.yFmt || ((v) => v.toLocaleString('ko-KR'));
  const xFmt = opt.xFmt || ((v) => v);
  const draw = () => {
    const { w, h } = size(el, height);
    const pad = { l: opt.padLeft || 52, r: 14, t: 14, b: 26 };
    const iw = w - pad.l - pad.r;
    const ih = h - pad.t - pad.b;
    const all = series.flatMap((s) => s.values).filter((v) => Number.isFinite(v));
    if (!all.length) { el.innerHTML = '<div class="chart-empty">표시할 데이터가 없습니다</div>'; return; }
    const { lo, hi, ticks } = niceTicks(Math.min(...all, ...(opt.zero ? [0] : [])), Math.max(...all));
    const x = (i) => pad.l + (labels.length <= 1 ? iw / 2 : (i / (labels.length - 1)) * iw);
    const y = (v) => pad.t + ih - ((v - lo) / (hi - lo)) * ih;
    const uid = Math.random().toString(36).slice(2, 8);
    let svg = `<svg class="chart" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="${esc(opt.label || '차트')}">`;
    svg += '<defs>' + series.map((s, i) => `<linearGradient id="g${uid}${i}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${s.color || PALETTE[i]}" stop-opacity=".28"/><stop offset="100%" stop-color="${s.color || PALETTE[i]}" stop-opacity="0"/></linearGradient>`).join('') + '</defs>';
    ticks.forEach((t) => {
      svg += `<line class="grid" x1="${pad.l}" x2="${w - pad.r}" y1="${y(t)}" y2="${y(t)}"/>`;
      svg += `<text class="axis svg-num" x="${pad.l - 8}" y="${y(t) + 4}" text-anchor="end">${esc(yFmt(t))}</text>`;
    });
    const xCount = Math.min(labels.length, Math.max(2, Math.floor(iw / 90)));
    for (let k = 0; k < xCount; k += 1) {
      const i = Math.round((k / Math.max(1, xCount - 1)) * (labels.length - 1));
      svg += `<text class="axis svg-num" x="${x(i)}" y="${h - 6}" text-anchor="${k === 0 ? 'start' : k === xCount - 1 ? 'end' : 'middle'}">${esc(xFmt(labels[i]))}</text>`;
    }
    series.forEach((s, si) => {
      const color = s.color || PALETTE[si];
      let d = '';
      let started = false;
      let first = null;
      let last = null;
      s.values.forEach((v, i) => {
        if (!Number.isFinite(v)) { if (opt.gaps) started = false; return; }
        d += `${started ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
        started = true;
        if (first === null) first = i;
        last = i;
      });
      if (opt.area !== false && si === 0 && first !== null) {
        svg += `<path class="area" d="${d}L${x(last)},${pad.t + ih}L${x(first)},${pad.t + ih}Z" fill="url(#g${uid}${si})"/>`;
      }
      svg += s.dash ? `<path class="line" d="${d}" stroke="${color}" stroke-dasharray="4 4"/>`
        : `<path class="line draw" pathLength="1" d="${d}" stroke="${color}"/>`;
      if (last !== null) svg += `<circle class="end-dot" cx="${x(last)}" cy="${y(s.values[last])}" r="3.5" fill="${color}"/>`;
    });
    svg += `<line class="xhair" x1="0" x2="0" y1="${pad.t}" y2="${pad.t + ih}" style="opacity:0"/>`;
    svg += `<rect class="hit" x="${pad.l}" y="${pad.t}" width="${iw}" height="${ih}" fill="transparent"/>`;
    svg += '</svg>';
    el.innerHTML = `<div class="chart-wrap">${svg}<div class="chart-tip" hidden></div></div>`;
    const root = el.querySelector('svg');
    const tip = el.querySelector('.chart-tip');
    const xh = root.querySelector('.xhair');
    const move = (clientX) => {
      const r = root.getBoundingClientRect();
      const px = ((clientX - r.left) / r.width) * w;
      const i = Math.max(0, Math.min(labels.length - 1, Math.round(((px - pad.l) / iw) * (labels.length - 1))));
      xh.setAttribute('x1', x(i)); xh.setAttribute('x2', x(i)); xh.style.opacity = 1;
      tip.hidden = false;
      tip.innerHTML = `<div class="tip-h">${esc(xFmt(labels[i], true))}</div>` + series.map((s, si) => `<div class="tip-r"><i style="background:${s.color || PALETTE[si]}"></i>${esc(s.name)}<b class="num">${Number.isFinite(s.values[i]) ? esc((s.fmt || yFmt)(s.values[i], i)) : '—'}</b></div>`).join('');
      const left = (x(i) / w) * r.width;
      tip.style.left = `${Math.min(Math.max(left, 70), r.width - 70)}px`;
    };
    const hideTip = () => { tip.hidden = true; xh.style.opacity = 0; };
    const hit = root.querySelector('.hit');
    hit.addEventListener('pointermove', (e) => { if (e.pointerType !== 'touch') move(e.clientX); });
    hit.addEventListener('pointerdown', (e) => move(e.clientX));
    hit.addEventListener('pointerleave', hideTip);
    hit.addEventListener('pointercancel', hideTip);
    const onDocDown = (e) => { if (!el.isConnected) { document.removeEventListener('pointerdown', onDocDown); return; } if (!el.contains(e.target)) hideTip(); };
    document.addEventListener('pointerdown', onDocDown, { passive: true });
  };
  draw();
  observe(el, draw);
}

/** barChart(el, { labels, series:[{name, values, color}], height, yFmt, horizontal? }) — 그룹 세로 막대 */
export function barChart(el, opt) {
  if (!el) return;
  const { labels, series } = opt;
  const height = opt.height || 240;
  const yFmt = opt.yFmt || ((v) => v.toLocaleString('ko-KR'));
  const draw = () => {
    const { w, h } = size(el, height);
    const pad = { l: opt.padLeft || 52, r: 10, t: 16, b: 28 };
    const iw = w - pad.l - pad.r;
    const ih = h - pad.t - pad.b;
    const all = series.flatMap((s) => s.values).filter(Number.isFinite);
    if (!all.length) { el.innerHTML = '<div class="chart-empty">표시할 데이터가 없습니다</div>'; return; }
    const { lo, hi, ticks } = niceTicks(Math.min(0, ...all), Math.max(0, ...all));
    const y = (v) => pad.t + ih - ((v - lo) / (hi - lo)) * ih;
    const gw = iw / labels.length;
    const bw = Math.min(28, (gw * 0.7) / series.length);
    let svg = `<svg class="chart" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="${esc(opt.label || '막대 차트')}">`;
    ticks.forEach((t) => {
      svg += `<line class="grid${t === 0 ? ' zero' : ''}" x1="${pad.l}" x2="${w - pad.r}" y1="${y(t)}" y2="${y(t)}"/>`;
      svg += `<text class="axis svg-num" x="${pad.l - 8}" y="${y(t) + 4}" text-anchor="end">${esc(yFmt(t))}</text>`;
    });
    labels.forEach((lab, i) => {
      const cx = pad.l + gw * i + gw / 2;
      series.forEach((s, si) => {
        const v = s.values[i];
        if (!Number.isFinite(v)) return;
        const bx = cx - (bw * series.length) / 2 + bw * si + 1;
        const y0 = y(0);
        const y1 = y(v);
        const color = (s.colorFn && s.colorFn(v, i)) || s.color || PALETTE[si];
        svg += `<rect class="bar grow" style="--d:${(i * series.length + si) * 30}ms" x="${bx}" y="${Math.min(y0, y1)}" width="${bw - 2}" height="${Math.max(1, Math.abs(y1 - y0))}" rx="4" fill="${color}"><title>${esc(s.name)} ${esc(lab)}: ${esc((s.fmt || yFmt)(v))}</title></rect>`;
      });
      svg += `<text class="axis" x="${cx}" y="${h - 8}" text-anchor="middle">${esc(lab)}</text>`;
    });
    svg += '</svg>';
    el.innerHTML = `<div class="chart-wrap">${svg}</div>`;
  };
  draw();
  observe(el, draw);
}

/** 인라인 스파크라인 SVG 문자열 */
export function sparkline(values, { w = 120, h = 36, color = 'var(--brand)' } = {}) {
  const v = values.filter(Number.isFinite);
  if (v.length < 2) return '';
  const min = Math.min(...v);
  const max = Math.max(...v);
  const pts = values.map((val, i) => Number.isFinite(val)
    ? `${((i / (values.length - 1)) * w).toFixed(1)},${(h - 3 - ((val - min) / (max - min || 1)) * (h - 6)).toFixed(1)}` : null).filter(Boolean);
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" preserveAspectRatio="none" aria-hidden="true"><polyline points="${pts.join(' ')}" fill="none" stroke="${color}" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/></svg>`;
}

const observers = new Map();
/** 화면 전환 시 이전 화면 차트의 ResizeObserver를 모두 해제(메모리 누수 방지) */
export function disposeCharts() {
  observers.forEach((ro) => ro.disconnect());
  observers.clear();
}
function observe(el, draw) {
  observers.get(el)?.disconnect();
  let lastW = el.clientWidth;
  let raf = 0;
  const ro = new ResizeObserver(() => {
    if (!el.isConnected) { ro.disconnect(); observers.delete(el); return; }
    if (Math.abs(el.clientWidth - lastW) < 8) return;
    lastW = el.clientWidth;
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(draw);
  });
  ro.observe(el);
  observers.set(el, ro);
}

/**
 * 첨부 v30 동종사 카드 차트 구성: X축 = 회사, 회사마다 연도별 막대(연도 색), 최근 연도 수치 표기, N/A 표시, 클릭 → 근거.
 * groupedBars(el, { groups:[회사], series:[{name:'2025년', color, values:[...]}], yFmt, valueFmt, labelSeries:[idx], onPick(gi, si) })
 */
export function groupedBars(el, opt) {
  if (!el) return;
  const { groups, series } = opt;
  const height = opt.height || 260;
  const yFmt = opt.yFmt || ((v) => v.toLocaleString('ko-KR'));
  const vFmt = opt.valueFmt || yFmt;
  const labelSet = new Set(opt.labelSeries || [series.length - 1]);
  const draw = () => {
    const minW = groups.length * (opt.minGroupW || series.length * 16 + 34) + 76;
    const { w: cw } = size(el, height);
    const scrollNeeded = minW > cw + 4;
    const w = scrollNeeded ? minW : cw;
    const h = height;
    const pad = { l: opt.padLeft || 54, r: 26, t: 26, b: 34 };
    const iw = w - pad.l - pad.r;
    const ih = h - pad.t - pad.b;
    const clampX = (x) => Math.min(Math.max(x, pad.l + 20), w - 26);
    const all = series.flatMap((s) => s.values).filter(Number.isFinite);
    if (!all.length) { el.innerHTML = '<div class="chart-empty">표시할 데이터가 없습니다 (N/A)</div>'; return; }
    let lo = Math.min(0, ...all);
    let hi = Math.max(0, ...all);
    lo = lo < 0 ? lo * 1.18 : 0; hi = hi > 0 ? hi * 1.18 : 0;
    if (hi === lo) hi = lo + 1;
    const nt = niceTicks(lo, hi);
    const y = (v) => pad.t + ih - ((v - nt.lo) / (nt.hi - nt.lo)) * ih;
    const gw = iw / groups.length;
    const inner = gw * 0.74;
    const bw = inner / series.length;
    const svgStyle = scrollNeeded ? `width:${w}px;min-width:${w}px;height:${h}px` : `width:100%;height:${h}px`;
    let svg = `<svg class="chart" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="${esc(opt.label || '회사별 비교')}" style="${svgStyle}">`;
    nt.ticks.forEach((t) => {
      svg += `<line class="grid${t === 0 ? ' zero' : ''}" x1="${pad.l}" x2="${w - pad.r}" y1="${y(t)}" y2="${y(t)}"/>`;
      svg += `<text class="axis svg-num" x="${pad.l - 8}" y="${y(t) + 4}" text-anchor="end">${esc(yFmt(t))}</text>`;
    });
    const y0 = y(0);
    groups.forEach((g, gi) => {
      const gx = pad.l + gw * gi + (gw - inner) / 2;
      if (opt.highlight === gi) svg += `<rect class="hl" x="${pad.l + gw * gi + 2}" y="${pad.t - 6}" width="${gw - 4}" height="${ih + 6}" rx="6"/>`;
      series.forEach((s, si) => {
        const v = s.values[gi];
        const x = gx + si * bw;
        if (!Number.isFinite(v)) {
          svg += `<text class="na" x="${x + bw / 2}" y="${y0 - 4}" text-anchor="middle">N/A</text>`;
          return;
        }
        const y1 = y(v);
        svg += `<rect class="bar grow pick" data-g="${gi}" data-s="${si}" style="--d:${(gi * series.length + si) * 18}ms" x="${x + 1}" y="${Math.min(y0, y1)}" width="${Math.max(3, bw - 2)}" height="${Math.max(1, Math.abs(y1 - y0))}" rx="3" fill="${s.color}"><title>${esc(g)} · ${esc(s.name)}: ${esc(vFmt(v))}</title></rect>`;
        if (labelSet.has(si) || (opt.highlight === gi && opt.labelHighlight !== false)) svg += `<text class="bar-val svg-num" x="${clampX(x + bw / 2)}" y="${v < 0 ? y1 + 12 : y1 - 5}" text-anchor="middle">${esc(vFmt(v))}</text>`;
      });
      svg += `<text class="axis grp" x="${pad.l + gw * gi + gw / 2}" y="${h - 12}" text-anchor="middle">${esc(g)}</text>`;
    });
    svg += '</svg>';
    el.innerHTML = `<div class="chart-wrap scroll-x${scrollNeeded ? ' has-scroll' : ''}">${svg}</div>${scrollNeeded ? '<div class="chart-scroll-hint">← 좌우로 밀어 전체 보기 →</div>' : ''}`;
    const wrap = el.firstElementChild;
    const syncFade = () => {
      if (!scrollNeeded) return;
      wrap.classList.toggle('at-end', wrap.scrollLeft + wrap.clientWidth >= wrap.scrollWidth - 6);
    };
    if (scrollNeeded) {
      wrap.addEventListener('scroll', syncFade, { passive: true });
      if (Number.isInteger(opt.highlight)) {
        const cx = pad.l + gw * opt.highlight + gw / 2;
        wrap.scrollLeft = Math.max(0, Math.min(w - cw, cx - cw / 2));
      }
      syncFade();
    }
    if (opt.onPick) {
      let sx = 0; let sy = 0; let moved = false;
      wrap.addEventListener('pointerdown', (e) => { sx = e.clientX; sy = e.clientY; moved = false; }, { passive: true });
      wrap.addEventListener('pointermove', (e) => { if (Math.hypot(e.clientX - sx, e.clientY - sy) > 8) moved = true; }, { passive: true });
      el.querySelectorAll('.pick').forEach((r) => r.addEventListener('click', () => { if (!moved) opt.onPick(+r.dataset.g, +r.dataset.s); }));
    }
  };
  draw();
  observe(el, draw);
}
