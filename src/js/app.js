/* IDF Web — 앱 셸: 인증 게이트 · 라우팅 · 헤더 */
import { APP, COMPANIES } from './config.js';
import { settings, prefs } from './store.js';
import { initAuth, signIn, signOutUser, user } from './auth.js';
import { api, clearCache, forceRefresh, cleanupSavedData, errorText, diagnoseGateway } from './api.js';
import { PARSER_VERSION } from './xbrl.js';
import { $, $$, esc, fmt, dirClass, toast, icon, placeSegInd, errorBox as errorBoxHtml } from './ui.js';
import { disposeCharts } from './charts.js';

const ROUTES = [
  { path: 'now', label: 'IR NOW', icon: 'home', load: () => import('./views/now.js') },
  { path: 'stock', label: '주가', icon: 'chart', load: () => import('./views/stock.js') },
  { path: 'financial', label: '재무', icon: 'bars', load: () => import('./views/financial.js') },
  { path: 'peers', label: '동종사', icon: 'building', load: () => import('./views/peers.js') },
  { path: 'disclosure', label: '공시', icon: 'doc', load: () => import('./views/disclosure.js') },
  { path: 'news', label: '뉴스', icon: 'news', load: () => import('./views/news.js') },
  { path: 'indicators', label: '금융지표', icon: 'pulse', load: () => import('./views/indicators.js') },
  { path: 'settings', label: '설정', icon: 'gear', load: () => import('./views/settings.js') },
];

const DEV = false; // 팀 공유본에는 인증 생략 모드가 없습니다.
let booted = false;
let bootedEmail = '';
let renderSeq = 0;

/* ---------------------------------------------------------------- shell */
function buildShell() {
  $('#topNav').innerHTML = '<span class="nav-ind" aria-hidden="true"></span>' + ROUTES.map((r) => `<a class="nav-item" href="#/${r.path}" data-path="${r.path}">${r.label}</a>`).join('');
  $('#tabBar').innerHTML = ROUTES.filter((r) => ['now', 'stock', 'financial', 'disclosure', 'indicators'].includes(r.path))
    .map((r) => `<a class="tab" href="#/${r.path}" data-path="${r.path}">${icon(r.icon)}<span>${r.label}</span></a>`).join('')
    + `<button class="tab" id="tabMore">${icon('gear')}<span>더보기</span></button>`;
  $('#moreSheet .sheet-body').innerHTML = ROUTES.filter((r) => ['peers', 'news', 'settings'].includes(r.path))
    .map((r) => `<a class="sheet-item" href="#/${r.path}">${icon(r.icon)}<span>${r.label}</span></a>`).join('');
  $('#tabMore').addEventListener('click', () => toggleSheet(true));
  $('#moreSheet').addEventListener('click', (e) => { if (e.target.id === 'moreSheet' || e.target.closest('.sheet-item')) toggleSheet(false); });

  $('#btnTheme').addEventListener('click', () => {
    prefs.setTheme(prefs.theme() === 'dark' ? 'light' : 'dark');
    themeIcon();
    document.dispatchEvent(new CustomEvent('idf:theme'));
  });
  $('#btnRefresh').addEventListener('click', () => { forceRefresh(); route(true); if ((location.hash.replace(/^#\/?/, '') || 'now').split('?')[0] !== 'now') tape(); toast('최신 데이터로 새로고침했습니다'); });
  document.addEventListener('idf:tape', (e) => { if (e.detail) paintTape(e.detail); });
  document.addEventListener('idf:stale', (e) => {
    const at = e.detail?.savedAt ? new Date(e.detail.savedAt) : null;
    toast(`서버 연결이 원활하지 않아 저장된 데이터로 표시합니다${at ? ` (${at.getMonth() + 1}/${at.getDate()} ${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')} 저장)` : ''}`, 'warn');
  });
  document.addEventListener('idf:revised', () => {
    forceRefresh(1000);
    toast('정정공시가 감지되었습니다 — 새로고침(↻)으로 최신 보고서를 반영하세요');
  });
  $('#btnLogout').addEventListener('click', async () => { await signOutUser(); toast('로그아웃했습니다'); });
  $('#brandHome').addEventListener('click', () => { location.hash = '#/now'; });
  themeIcon();
  window.addEventListener('hashchange', () => route());
  document.addEventListener('idf:settings', () => { tapeDebounced(); });
  let lastWinW = window.innerWidth;
  window.addEventListener('resize', () => { if (window.innerWidth === lastWinW) return; lastWinW = window.innerWidth; requestAnimationFrame(() => { navInd(); placeSegInd(document); }); });
  document.fonts?.ready.then(navInd);
}

function toggleSheet(open) {
  $('#moreSheet').classList.toggle('open', open);
  document.body.classList.toggle('sheet-lock', open);
}

function themeIcon() {
  $('#btnTheme').innerHTML = icon(prefs.theme() === 'dark' ? 'sun' : 'moon');
}

function navInd() {
  const nav = $('#topNav');
  const on = $('.nav-item.active', nav);
  const ind = $('.nav-ind', nav);
  if (!on || !ind) return;
  nav.classList.add('has-ind');
  ind.style.width = on.offsetWidth + 'px';
  ind.style.transform = `translateX(${on.offsetLeft - 3}px)`;
  // 가로 스크롤만 보정(scrollIntoView는 iPad Safari sticky 헤더에서 전체 화면을 최상단으로 이동시킴)
  const left = on.offsetLeft, right = left + on.offsetWidth;
  if (left < nav.scrollLeft) nav.scrollLeft = Math.max(0, left - 8);
  else if (right > nav.scrollLeft + nav.clientWidth) nav.scrollLeft = right - nav.clientWidth + 8;
}

/* ---------------------------------------------------------------- route */
async function route(force = false) {
  const path = (location.hash.replace(/^#\/?/, '') || 'now').split('?')[0];
  const r = ROUTES.find((x) => x.path === path) || ROUTES[0];
  $$('[data-path]').forEach((a) => a.classList.toggle('active', a.dataset.path === r.path));
  $$('.nav-item').forEach((a) => a.setAttribute('aria-current', a.dataset.path === r.path ? 'page' : 'false'));
  navInd();
  document.title = `${r.label} · ${APP.name}`;
  const seq = ++renderSeq;
  const view = $('#view');
  let mod;
  try {
    mod = await r.load();
  } catch (err) {
    view.innerHTML = `<div class="view-pane active"><div class="view-body">${errorBoxHtml('화면을 불러오지 못했습니다. 새로고침하세요.')}</div></div>`;
    return;
  }
  if (seq !== renderSeq) return;
  disposeCharts();
  view.innerHTML = '';
  const pane = document.createElement('div');
  pane.className = 'view-pane active';
  view.appendChild(pane);
  const body = document.createElement('div');
  body.className = 'view-body';
  pane.appendChild(body);
  // 렌더는 기다리지 않는다(네트워크 대기 중에도 UI가 멈추지 않도록). 오류는 화면에 표시.
  Promise.resolve().then(() => mod.render(body, { force })).catch((err) => {
    console.error(err);
    if (seq === renderSeq) body.insertAdjacentHTML('afterbegin', errorBoxHtml(`화면 오류: ${err?.message || err}`));
  });
  booted = true;
  window.scrollTo(0, 0);
}

/* 상단 시세 테이프 */
let tapeTimer = 0;
function tapeDebounced() { clearTimeout(tapeTimer); tapeTimer = setTimeout(tape, 1200); }
function paintTape(snap) {
  const el = $('#tapeInner');
  if (!el || !snap) return;
  const items = [];
  const k = snap.index?.kospi; const q = snap.index?.kosdaq;
  if (k) items.push(['KOSPI', fmt.n(k.close, 2), k.rate]);
  if (q) items.push(['KOSDAQ', fmt.n(q.close, 2), q.rate]);
  (snap.stocks || []).forEach((s) => {
    const c = COMPANIES.find((x) => x.ticker === s.code);
    items.push([c?.name || s.name, fmt.int(s.close), s.rate]);
  });
  const html = items.map(([n, v, r]) => `<a class="tape-item" href="#/stock"><b>${esc(n)}</b><span class="num">${v}</span><span class="num ${dirClass(r)}">${fmt.pct(r)}</span></a>`).join('');
  el.innerHTML = html + `<span class="tape-dup">${html}</span>`;
  el.classList.add('marquee');
  $('#tapeBar').hidden = false;
  $('#tapeDate').textContent = snap.live
    ? `실시간 ${snap.tradedAt || ''}`.trim()
    : snap.source === 'naver'
      ? `${fmt.date(snap.basDd)} 잠정`
      : fmt.date(snap.basDd);
}
async function tape() {
  const el = $('#tapeInner');
  if (!settings.gateway()) { el.innerHTML = ''; $('#tapeBar').hidden = true; return; }
  try {
    const codes = COMPANIES.filter((c) => c.ticker).map((c) => c.ticker);
    const snap = await api.liveSnapshot(codes);
    paintTape(snap);
  } catch {
    $('#tapeBar').hidden = true;
  }
}

/* ----------------------------------------------------------------- auth */
function gateMsg(html, ok = false) {
  const box = $('#lockGateErrorBox');
  box.innerHTML = html || '';
  box.classList.toggle('show', !!html);
  box.classList.toggle('ok', ok);
}
function gateBusy(busy) {
  const b = $('#gateBtn');
  b.disabled = busy;
  b.classList.toggle('busy', busy);
  $('#gateBtn span').textContent = busy ? '인증 확인 중…' : 'Google 계정으로 계속하기';
}
function gateLive(text, warn = false) {
  const el = $('#lockLive');
  el.classList.toggle('warn', warn);
  el.innerHTML = `<span class="sync-dot"></span><span>${esc(text)}</span>`;
}
function lock() {
  document.body.classList.add('app-locked');
  gateBusy(false);
}
function unlock() {
  document.body.classList.remove('app-locked');
  gateMsg('');
}

let gateRetry = false;
function setGateMode(retry) {
  gateRetry = retry;
  $('#gateBtn span').textContent = retry ? '다시 확인' : 'Google 계정으로 계속하기';
  $('#gateSwitch').hidden = !retry;
}

/** 서버(Worker) 승인 확인을 통과해야만 잠금을 해제한다 — 실패 시 닫힌 상태 유지(fail-closed) */
async function enter() {
  const u = user();
  $('#userChip').innerHTML = u?.photoURL ? `<img src="${esc(u.photoURL)}" alt="" referrerpolicy="no-referrer">` : esc((u?.email || 'D')[0].toUpperCase());
  $('#userChip').title = u?.email || 'DEV';
  gateBusy(true);
  gateMsg('');
  let h = null;
  try {
    h = await api.health();
  } catch (err) {
    if (!user() || user().uid !== u?.uid) return;
    if (err.code === 'NOT_APPROVED' || String(err.code).startsWith('TOKEN') || err.code === 'AUTH_REQUIRED') {
      await signOutUser();
      lock();
      setGateMode(false);
      gateMsg(`🚫 <b>${esc(u?.email || '')}</b> 계정은 승인되지 않았습니다. 승인된 계정으로 다시 로그인하세요.`);
      return;
    }
    if (!DEV) {
      lock();
      setGateMode(true);
      gateMsg(`⚠️ 서버 인증을 완료하지 못해 잠금을 유지합니다. 원인을 진단 중…`);
      gateLive('Worker 연결 진단 중', true);
      const d = await diagnoseGateway();
      const detail = d.ok ? esc(errorText(err)) : esc(d.text);
      gateMsg(`⚠️ 서버 인증을 완료하지 못해 잠금을 유지합니다.<br><b>진단:</b> ${detail}<br><span style="font-weight:600">해결 후 [다시 확인]을 누르세요. Gateway 주소는 아래 ⚙️ 연결 설정에서 바꿀 수 있습니다.</span>`);
      gateLive(d.ok ? `Worker v${d.version} 응답 · 인증 오류` : 'Worker 연결 실패', true);
      return;
    }
  }
  if (!user() || user().uid !== u?.uid) return;
  if (!DEV && (!h?.ok || String(h.user || '').toLowerCase() !== String(u?.email || '').toLowerCase())) {
    await signOutUser();
    lock();
    setGateMode(false);
    gateMsg('🚫 서버가 확인한 계정과 로그인 계정이 일치하지 않습니다. 다시 로그인하세요.');
    return;
  }
  setGateMode(false);
  bootedEmail = String(u?.email || 'DEV').toLowerCase();
  gateLive(`서버 승인 완료 · ${h?.user || 'DEV'}`);
  unlock();
  if (!booted) { cleanupSavedData(PARSER_VERSION).catch(() => {}); route(); tape(); } else { route(true); }
  requestAnimationFrame(navInd);
}

function setupBox() {
  const s = settings.get();
  const fb = s.firebase || {};
  $('#lockGateway').value = s.gateway || '';
  $('#lockFbApiKey').value = fb.apiKey || '';
  $('#lockFbAuthDomain').value = fb.authDomain || '';
  $('#lockFbProjectId').value = fb.projectId || '';
  $('#lockFbAppId').value = fb.appId || '';
  $('#lockSetupToggle').addEventListener('click', () => $('#lockSetup').classList.toggle('open'));
  $('#lockSetupSave').addEventListener('click', () => {
    const cfg = { apiKey: $('#lockFbApiKey').value.trim(), authDomain: $('#lockFbAuthDomain').value.trim(), projectId: $('#lockFbProjectId').value.trim(), appId: $('#lockFbAppId').value.trim() };
    settings.set({ gateway: $('#lockGateway').value.trim(), firebase: cfg.apiKey && cfg.projectId ? cfg : null });
    location.reload();
  });
  $('#vaultTheme').addEventListener('click', () => { prefs.setTheme(prefs.theme() === 'dark' ? 'light' : 'dark'); themeIcon(); });
}

function boot() {
  buildShell();
  setupBox();
  $('#lockRemember').checked = settings.get().remember !== false;
  $('#lockRemember').addEventListener('change', (e) => settings.set({ remember: e.target.checked }));
  $('#gateSwitch').addEventListener('click', async () => {
    await signOutUser();
    setGateMode(false);
    gateMsg('');
    $('#gateBtn').click();
  });
  $('#gateBtn').addEventListener('click', async () => {
    if (gateRetry && user()) { enter(); return; }
    gateBusy(true);
    gateMsg('');
    try { await signIn(); } catch (err) {
      gateBusy(false);
      const code = err.code || '';
      if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') return;
      gateMsg(code === 'auth/unauthorized-domain'
        ? `⚠️ <b>${esc(location.hostname)}</b> 이(가) Firebase 승인 도메인에 없습니다.<br>Firebase 콘솔 → Authentication → 설정 → 승인된 도메인에 추가하세요.`
        : /popup-blocked|operation-not-supported/.test(code) ? '⚠️ 팝업을 허용하고 일반 브라우저에서 다시 시도하세요.' : `⚠️ 로그인 실패: ${esc(code || err.message)}`);
    }
  });
  if (DEV) { gateLive('DEV 모드 (로그인 생략)'); enter(); return; }
  const fb = settings.firebase();
  if (!fb.apiKey || !fb.authDomain || !fb.projectId || !fb.appId || !settings.gateway()) {
    gateBusy(true);
    gateLive('팀 연결 설정 필요', true);
    gateMsg('⚙️ 연결 설정을 열어 팀 관리자가 제공한 Gateway와 Firebase 설정을 입력하세요. 설정 후 Google 계정으로 로그인할 수 있습니다.');
    $('#lockSetup').classList.add('open');
    return;
  }
  gateBusy(true);
  initAuth((u, err) => {
    if (err) { gateBusy(false); gateMsg(`⚠️ 로그인 오류: ${esc(err.code || err.message)}`); return; }
    gateLive(`Firebase 인증 활성 · ${settings.firebase().projectId}`);
    settings.activateUser(u?.uid || '');
    clearCache();
    if (u) { const em = String(u.email || '').toLowerCase(); if (booted && bootedEmail === em && !document.body.classList.contains('app-locked')) return; enter(); } else { bootedEmail = ''; lock(); }
  }).catch((err) => {
    gateBusy(false);
    gateLive('Firebase 연결 실패', true);
    gateMsg(`⚠️ Firebase SDK를 불러오지 못했습니다. 네트워크를 확인하세요. (${esc(err.message)})`);
  });
}

boot();
