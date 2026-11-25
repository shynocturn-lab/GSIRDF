/* 공시 — OpenDART 공시검색 (list.json) */
import { api, errorText, kst, ymd } from '../api.js';
import { COMPANIES, companyById } from '../config.js';
import { settings } from '../store.js';
import { $, esc, fmt, skeleton, errorBox, emptyBox, segmented, onSeg, placeSegInd, icon } from '../ui.js';

const TYPES = [['', '전체'], ['A', '정기'], ['B', '주요사항'], ['C', '발행'], ['D', '지분'], ['E', '기타'], ['I', '거래소']];
const PERIODS = [['30', '1개월'], ['90', '3개월'], ['180', '6개월'], ['365', '1년']];

export async function render(root) {
  let sel = companyById(settings.get().company);
  let type = '';
  let days = '90';
  let page = 1;
  let items = [];
  let q = '';

  root.innerHTML = `
  <section class="page-head">
    <div><p class="eyebrow">DISCLOSURE · OpenDART</p><h1>공시</h1></div>
    ${segmented('days', PERIODS, days)}
  </section>
  <div class="chips" id="coChips">${COMPANIES.map((c) => `<button class="chip-btn${c.id === sel.id ? ' on' : ''}" data-id="${c.id}">${esc(c.name)}</button>`).join('')}</div>
  <section class="card">
    <div class="card-hd wrap">
      ${segmented('type', TYPES, type)}
      <label class="search-box">${icon('search')}<input id="discQ" type="search" placeholder="보고서명 검색" autocomplete="off"></label>
    </div>
    <div id="discList">${skeleton(360)}</div>
    <div class="more-wrap"><button class="btn ghost" id="discMore" hidden>더 보기</button></div>
  </section>`;
  placeSegInd(root);

  const paint = () => {
    const shown = q ? items.filter((d) => d.report_nm.includes(q)) : items;
    $('#discList', root).innerHTML = shown.length ? `<ul class="disc-list">${shown.map((d) => `
      <li><a href="https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${esc(d.rcept_no)}" target="_blank" rel="noopener">
        <div class="disc-date num">${fmt.date(d.rcept_dt)}</div>
        <div class="disc-main"><b>${esc(d.report_nm.trim())}</b><span class="mut">${esc(d.flr_nm)}${d.rm ? ` · ${esc(d.rm)}` : ''}</span></div>
        <div class="disc-tags">${/정정/.test(d.report_nm) ? '<span class="tag amber">정정</span>' : ''}${d.corp_cls === 'Y' ? '<span class="tag">유가</span>' : ''}${icon('ext', 'ico mut')}</div>
      </a></li>`).join('')}</ul>` : emptyBox('조건에 맞는 공시가 없습니다.');
  };

  let seq = 0;
  const load = async (append = false) => {
    const my = ++seq;
    if (!append) { page = 1; items = []; $('#discList', root).innerHTML = skeleton(360); }
    try {
      const end = kst();
      const bgn = new Date(end.getTime() - Number(days) * 86400e3);
      const body = await api.dart('list', {
        corp_code: sel.corp, bgn_de: ymd(bgn), end_de: ymd(end), page_no: page, page_count: 100, pblntf_ty: type,
      });
      if (my !== seq) return;
      items = items.concat(body.list || []);
      $('#discMore', root).hidden = !(body.total_page > page);
      paint();
    } catch (err) {
      if (my !== seq) return;
      $('#discList', root).innerHTML = errorBox(errorText(err));
    }
  };

  onSeg(root, 'days', (v) => { days = v; load(); });
  onSeg(root, 'type', (v) => { type = v; load(); });
  $('#discQ', root).addEventListener('input', (e) => { q = e.target.value.trim(); paint(); });
  $('#discMore', root).addEventListener('click', () => { page += 1; load(true); });
  $('#coChips', root).addEventListener('click', (e) => {
    const b = e.target.closest('.chip-btn');
    if (!b) return;
    sel = companyById(b.dataset.id);
    root.querySelectorAll('#coChips .chip-btn').forEach((x) => x.classList.toggle('on', x === b));
    load();
  });
  load();
}
