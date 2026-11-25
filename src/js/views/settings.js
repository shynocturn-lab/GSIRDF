/* 설정 — Gateway · API 키 재정의 · Firebase · 표시 (입력 즉시 자동 저장) */
import { api, clearCache, errorText, probe, diagnoseGateway, scrubText, savedDataStats, savedDataBreakdown, cleanupSavedData, clearSavedData, exportSavedData, importSavedData, stats as apiStats } from '../api.js';
import { PARSER_VERSION } from '../xbrl.js';
import { validateBackup, BACKUP_FORMAT, BACKUP_MAX_BYTES } from '../cachepolicy.js';
import { fetchReport, quarterRange, latestFiledQuarter } from '../peerdata.js';
import { COMPANIES, DEFAULT_FIREBASE, DEFAULT_GATEWAY, APP } from '../config.js';
import { settings, prefs, normalizeGateway, isKeyValid } from '../store.js';
import { user, idToken, decodeJwt } from '../auth.js';
import { $, $$, esc, toast, segmented, onSeg, placeSegInd } from '../ui.js';

const KEY_FIELDS = [
  ['krx', 'Open KRX 인증키', 'AUTH_KEY'],
  ['dart', 'OpenDART 인증키', 'crtfc_key'],
  ['ecos', '한국은행 ECOS 인증키', 'ECOS'],
  ['naverId', '네이버 Client ID', 'X-Naver-Client-Id'],
  ['naverSecret', '네이버 Client Secret', 'X-Naver-Client-Secret'],
];
const SVC = { krx: 'Open KRX', dart: 'OpenDART', ecos: 'ECOS', naver: 'Naver' };

/* iPadOS: type=password 는 암호 자동완성 막대가 키보드를 붙잡아 멈춤을 유발할 수 있어
   일반 text 입력 + CSS 마스킹(.masked)을 사용한다. 모든 입력은 16px(자동 확대 방지). */
const inputAttrs = 'autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" data-1p-ignore data-lpignore="true"';

export async function render(root) {
  const s = settings.get();
  const fb = s.firebase || {};
  const u = user();
  root.innerHTML = `
  <section class="page-head"><div><p class="eyebrow">SETTINGS</p><h1>설정</h1></div><p class="page-meta">IDF Web v${APP.version} · <span id="saveState" class="mut">입력하면 자동 저장됩니다</span></p></section>

  <section class="card">
    <div class="card-hd"><h2>연결 상태</h2><button class="btn sm" id="btnCheck" type="button">연결 점검</button></div>
    <div class="status-grid">
      <div class="status-item"><span>로그인</span><b>${u ? esc(u.email) : '—'}</b></div>
      <div class="status-item"><span>Gateway</span><b id="stGw">${settings.gateway() ? '설정됨' : '<span class="amber-text">미설정</span>'}</b></div>
      ${Object.entries(SVC).map(([k, n]) => `<div class="status-item"><span>${n}</span><b id="st-${k}" class="mut">점검 전</b></div>`).join('')}
    </div>
    <p class="help" id="checkHelp" style="margin:12px 0 0"></p>
  </section>

  <section class="card">
    <div class="card-hd"><h2>외부 API 진단</h2><button class="btn sm primary" id="btnDiag" type="button">진단 실행</button></div>
    <p class="help">Worker가 실제로 KRX·OpenDART·한국은행·네이버에 요청해 응답을 확인합니다. 데이터가 안 나올 때 원인(키 오류·차단·지연)을 찾는 데 사용하세요.</p>
    <div id="diagOut"></div>
  </section>

  <section class="card">
    <div class="card-hd"><h2>인증 보안 검증</h2><button class="btn sm primary" id="btnSec" type="button">검증 실행</button></div>
    <p class="help">실제 Worker에 위조·변조 요청을 보내 서버가 차단하는지 이 기기에서 직접 확인합니다. 모두 PASS면 승인된 계정의 정상 토큰만 데이터에 접근할 수 있습니다.</p>
    <div id="secOut"></div>
  </section>

  <section class="card">
    <div class="card-hd"><h2>API Gateway</h2><span class="chip">Cloudflare Worker</span></div>
    <p class="help">KRX·DART·ECOS·네이버 API는 브라우저에서 직접 호출할 수 없어 Worker가 중계합니다.${DEFAULT_GATEWAY ? ' 기본 주소가 이미 들어 있으니 바꿀 필요가 없습니다.' : ''}</p>
    <label class="field"><span>Gateway 주소</span>
      <input id="gw" type="text" inputmode="url" value="${esc(s.gateway || DEFAULT_GATEWAY)}" placeholder="https://idf-gateway.계정.workers.dev" ${inputAttrs}></label>
  </section>

  <section class="card">
    <div class="card-hd"><h2>API 키</h2><button class="btn sm primary" id="btnSaveKeys" type="button">저장</button></div>
    <p class="help">각자 발급받은 API 키를 입력하고 [저장]을 누르세요. 키는 이 브라우저에 로그인 계정별로 저장되며 조회 시 팀 Worker를 거쳐 해당 API에 전달됩니다. 암호화 보관이 아니므로 공유 기기에는 저장하지 마세요.</p>
    <div class="field-grid">
      ${KEY_FIELDS.map(([k, label, hint]) => `<label class="field"><span>${label} <em class="mut">${hint}</em></span>
        <div class="pw"><input id="key-${k}" class="masked" type="text" value="${esc(s.keys[k])}" placeholder="본인 API 키 입력" ${inputAttrs}>
        <button type="button" class="pw-eye" data-eye="key-${k}" aria-label="키 보기/숨기기">보기</button></div>
        <em class="key-src" id="src-${k}">${s.keys[k] ? '이 기기에 저장된 키 사용' : '미입력'}</em></label>`).join('')}
    </div>
    <div class="key-actions"><span id="keyState" class="mut"></span><button class="btn sm ghost" id="btnClearKeys" type="button">이 기기 키 지우기</button><button class="btn primary" id="btnSaveKeys2" type="button">저장하고 연결 점검</button></div>
  </section>

  <section class="card">
    <div class="card-hd"><h2>표시</h2></div>
    <div class="pref-row"><span>테마</span>${segmented('theme', [['dark', '다크'], ['light', '라이트']], prefs.theme())}</div>
    <div class="pref-row"><span>상승 / 하락 색상</span>${segmented('color', [['kr', '상승 빨강'], ['us', '상승 초록']], prefs.color())}</div>
    <label class="pref-row"><span>기준 회사</span>
      <select id="company" class="select">${COMPANIES.map((c) => `<option value="${c.id}"${c.id === s.company ? ' selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label>
  </section>

  <details class="card adv">
    <summary><h2>고급 · Firebase(Google 로그인)</h2></summary>
    <p class="help">팀 관리자가 제공한 Firebase 설정을 입력합니다. Worker의 <code>FIREBASE_PROJECT_ID</code>와 일치해야 합니다.</p>
    <div class="field-grid">
      <label class="field"><span>apiKey</span><input id="fbApiKey" type="text" value="${esc(fb.apiKey || '')}" placeholder="${esc(DEFAULT_FIREBASE.apiKey)}" ${inputAttrs}></label>
      <label class="field"><span>authDomain</span><input id="fbAuthDomain" type="text" value="${esc(fb.authDomain || '')}" placeholder="${esc(DEFAULT_FIREBASE.authDomain)}" ${inputAttrs}></label>
      <label class="field"><span>projectId</span><input id="fbProjectId" type="text" value="${esc(fb.projectId || '')}" placeholder="${esc(DEFAULT_FIREBASE.projectId)}" ${inputAttrs}></label>
      <label class="field"><span>appId</span><input id="fbAppId" type="text" value="${esc(fb.appId || '')}" placeholder="${esc(DEFAULT_FIREBASE.appId)}" ${inputAttrs}></label>
    </div>
    <div style="display:flex;justify-content:flex-end;margin-top:12px"><button class="btn primary" type="button" id="btnFbApply">Firebase 설정 적용(새로고침)</button></div>
  </details>

  <section class="card">
    <div class="card-hd wrap"><h2>저장된 데이터</h2><div style="display:flex;gap:6px;flex-wrap:wrap"><button class="btn sm" id="btnCleanupData" type="button">만료·구버전 정리</button><button class="btn sm ghost" id="btnClearData" type="button">저장 데이터 비우기</button></div></div>
    <p class="help">한 번 조회한 시세·재무·지표·회사정보·XBRL 주석을 이 기기에 저장해 다음 조회를 빠르게 하고, 없는 부분만 추가로 받아옵니다. 공시가 끝난 보고서는 저장본을 즉시 보여주고 정정 여부는 뒤에서 확인합니다. 과거 확정 데이터(지난 거래일 종가, 1년 이상 지난 보고서)는 오래 보관하고, 오늘 시세·공시 목록·뉴스는 짧게 보관합니다. 서버 장애 시에는 저장본을 대신 보여줍니다. API 키는 저장하지 않습니다. 상단 ↻ 버튼은 변동 데이터를 새로 받습니다.</p>
    <div class="status-grid" id="dataStats"><div class="status-item"><span>저장 항목</span><b class="mut">확인 중…</b></div></div>
    <div class="data-tools">
      <div class="data-tool"><b>10개사 재무제표 미리 저장</b><span class="help">최근 12개 분기 보고서(연결, 없으면 별도)를 한 번에 받아 둡니다. 이미 저장된 보고서는 건너뛰므로 다시 눌러도 새 공시만 받습니다.</span>
        <div class="data-tool-btns"><button class="btn sm primary" type="button" id="btnPrefetch">미리 저장 시작</button><button class="btn sm ghost" type="button" id="btnPrefetchStop" hidden>중단</button></div>
        <div id="prefetchProg"></div></div>
      <div class="data-tool"><b>저장 데이터 백업 · 복원</b><span class="help">다른 기기로 옮기거나 초기화 전에 보관할 때 사용합니다. 조회 데이터만 담기며 API 키·로그인 정보는 포함되지 않습니다.</span>
        <div class="data-tool-btns"><button class="btn sm" type="button" id="btnExport">백업 파일 내보내기</button><button class="btn sm" type="button" id="btnImport">백업 파일 불러오기</button><input type="file" id="inpImport" accept="application/json,.json" hidden></div></div>
    </div>
  </section>

  <div class="danger-row"><button class="btn ghost" type="button" id="btnReset">이 기기 설정 초기화</button></div>`;
  placeSegInd(root);

  onSeg(root, 'theme', (v) => prefs.setTheme(v));
  onSeg(root, 'color', (v) => prefs.setColor(v));

  /* 보기/숨기기 */
  root.addEventListener('click', (e) => {
    const eye = e.target.closest('[data-eye]');
    if (!eye) return;
    const inp = $('#' + eye.dataset.eye, root);
    inp.classList.toggle('masked');
    eye.textContent = inp.classList.contains('masked') ? '보기' : '숨기기';
  });

  /* 자동 저장 */
  let timer = 0;
  let lastSig = JSON.stringify([settings.gateway(), settings.get().keys]);
  let checkTimer = 0;
  const state = $('#saveState', root);
  const validate = () => {
    let bad = 0;
    KEY_FIELDS.forEach(([k]) => {
      const el = $('#key-' + k, root);
      const ok = isKeyValid(el.value);
      el.classList.toggle('invalid', !ok);
      if (!ok) { bad += 1; $('#src-' + k, root).innerHTML = '<span class="amber-text">사용할 수 없는 문자(한글·특수공백)가 있어 무시됩니다. 영문·숫자만 입력하세요.</span>'; }
    });
    return bad;
  };
  const save = () => {
    const bad = validate();
    settings.set({
      gateway: normalizeGateway($('#gw', root).value),
      company: $('#company', root).value,
      keys: Object.fromEntries(KEY_FIELDS.map(([k]) => [k, $('#key-' + k, root).value.trim()])),
    });
    clearCache();
    state.textContent = '저장됨 ✓';
    state.className = 'ok-text';
    document.dispatchEvent(new CustomEvent('idf:settings'));
    KEY_FIELDS.forEach(([k]) => {
      const el = $('#key-' + k, root);
      if (el.classList.contains('invalid')) return;
      const clean = settings.get().keys[k];
      if (el.value.trim() && clean !== el.value.trim()) el.value = clean; // 공백·따옴표 자동 정리 반영
      $('#src-' + k, root).textContent = clean ? '이 기기에 저장된 키 사용' : '미입력';
    });
    if (bad) toast('잘못된 문자가 있는 키는 사용하지 않습니다', 'warn');
    // 저장 내용이 바뀌면 연결 상태를 자동으로 다시 점검(이전 결과가 남아 보이지 않도록)
    const sig = JSON.stringify([settings.gateway(), settings.get().keys]);
    if (sig !== lastSig) { lastSig = sig; if (settings.gateway()) { clearTimeout(checkTimer); checkTimer = setTimeout(() => check(root), 300); } }
  };
  const saveNow = (msg) => {
    clearTimeout(timer);
    lastSig = '';
    save();
    $('#keyState', root).innerHTML = '<span class="ok-text">저장됨 ✓ · 연결 점검 중…</span>';
    if (msg) toast(msg);
  };
  const schedule = () => {
    state.textContent = '저장 중…';
    state.className = 'mut';
    clearTimeout(timer);
    timer = setTimeout(save, 500);
  };
  $$('#gw, [id^="key-"]', root).forEach((el) => {
    el.addEventListener('input', schedule);
    el.addEventListener('change', () => { clearTimeout(timer); save(); });
    el.addEventListener('blur', () => { clearTimeout(timer); save(); });
  });
  $('#company', root).addEventListener('change', save);

  $('#btnFbApply', root).addEventListener('click', () => {
    const cfg = { apiKey: $('#fbApiKey', root).value.trim(), authDomain: $('#fbAuthDomain', root).value.trim(), projectId: $('#fbProjectId', root).value.trim(), appId: $('#fbAppId', root).value.trim() };
    settings.set({ firebase: cfg.apiKey && cfg.projectId ? cfg : null });
    toast('Firebase 설정을 적용합니다');
    setTimeout(() => location.reload(), 500);
  });
  const showData = async () => {
    const [s, bd] = await Promise.all([savedDataStats(), savedDataBreakdown(PARSER_VERSION)]);
    const box = $('#dataStats', root);
    if (!box) return;
    const mb = s.bytes ? `${(s.bytes / 1048576).toFixed(1)} MB` : '—';
    box.innerHTML = `<div class="status-item"><span>저장 항목</span><b>${s.count.toLocaleString('ko-KR')}개</b></div>
      <div class="status-item"><span>유형별 내역</span><b>DART ${bd.dart} · XBRL ${bd.xbrl}${bd.xbrlNa ? ` (미제공 ${bd.xbrlNa})` : ''} · KRX ${bd.krx} · ECOS ${bd.ecos}</b></div>
      <div class="status-item"><span>사용 용량 · 방식</span><b>${mb} · ${s.persistent ? '기기 저장' : '<span class="amber-text">임시</span>'}</b></div>
      <div class="status-item"><span>이번 접속 재사용</span><b>${apiStats.hit.toLocaleString('ko-KR')}건 · 새로 받음 ${apiStats.miss.toLocaleString('ko-KR')}건${apiStats.swr ? ` · SWR ${apiStats.swr}건` : ''}${bd.obsolete + bd.expired ? ` · <span class="amber-text">정리대상 ${bd.obsolete + bd.expired}건</span>` : ''}</b></div>`;
  };
  showData();

  /* 10개사 재무제표 미리 저장 — 저장본이 있는 보고서는 네트워크 없이 건너뜀 */
  let stopPrefetch = false;
  $('#btnPrefetch', root).addEventListener('click', async () => {
    const btn = $('#btnPrefetch', root); const stop = $('#btnPrefetchStop', root); const prog = $('#prefetchProg', root);
    btn.disabled = true; stop.hidden = false; stopPrefetch = false;
    const e = latestFiledQuarter(); const s0 = e.y * 4 + e.q - 1 - 11;
    const qs = quarterRange(Math.floor(s0 / 4), (s0 % 4) + 1, e.y, e.q);
    const jobs = COMPANIES.flatMap((c) => qs.map(({ y, q }) => [c, y, q]));
    const before = { ...apiStats };
    let done = 0; let fail = 0; let i = 0;
    const paint = () => { prog.innerHTML = `<div class="pc-progress"><span>${done}/${jobs.length}</span><i><em style="width:${(done / jobs.length) * 100}%"></em></i></div>`; };
    paint();
    const worker = async () => {
      while (i < jobs.length && !stopPrefetch) {
        const [c, y, q] = jobs[i++];
        try { await fetchReport(c.corp, y, q, 'CFS'); } catch { fail += 1; }
        done += 1; paint();
      }
    };
    await Promise.all([worker(), worker(), worker()]);
    const got = apiStats.miss - before.miss; const reused = apiStats.hit - before.hit;
    prog.innerHTML = `<p class="help">${stopPrefetch ? '중단됨 · ' : '완료 · '}보고서 ${done}건 확인 — 새로 받음 ${got}건, 저장본 재사용 ${reused}건${fail ? `, 실패 ${fail}건` : ''}</p>`;
    btn.disabled = false; stop.hidden = true;
    showData();
  });
  $('#btnPrefetchStop', root).addEventListener('click', () => { stopPrefetch = true; });

  /* 백업 내보내기 / 불러오기(검증 후 더 최신 데이터만 반영) */
  $('#btnExport', root).addEventListener('click', async () => {
    const entries = await exportSavedData();
    const blob = new Blob([JSON.stringify({ app: 'IDF', format: BACKUP_FORMAT, version: APP.version, exportedAt: new Date().toISOString(), entries })], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `idf-data-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 3000);
    toast(`저장 데이터 ${entries.length.toLocaleString('ko-KR')}건을 백업 파일로 내보냈습니다`);
  });
  $('#btnImport', root).addEventListener('click', () => $('#inpImport', root).click());
  $('#inpImport', root).addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > BACKUP_MAX_BYTES) { toast('백업 파일이 너무 큽니다(80MB 초과)', 'err'); return; }
    let obj = null;
    try { obj = JSON.parse(await file.text()); } catch { toast('백업 파일을 읽을 수 없습니다(JSON 형식 아님)', 'err'); return; }
    const v = validateBackup(obj, Date.now(), file.size);
    if (!v.ok) { toast(v.reason, 'err'); return; }
    const n = await importSavedData(v.entries);
    toast(`복원 ${n.toLocaleString('ko-KR')}건${v.entries.length - n ? ` · 이미 최신 ${(v.entries.length - n).toLocaleString('ko-KR')}건 유지` : ''}${v.skipped ? ` · 형식 불일치 ${v.skipped.toLocaleString('ko-KR')}건 제외` : ''}`);
    showData();
  });
  $('#btnCleanupData', root).addEventListener('click', async () => {
    const r = await cleanupSavedData(PARSER_VERSION);
    toast(r.removed ? `구버전 XBRL ${r.obsolete}건 · 만료 항목 ${r.expired}건 정리 완료` : '정리할 구버전·만료 데이터가 없습니다');
    showData();
  });
  $('#btnClearData', root).addEventListener('click', async () => {
    if (!confirm('이 기기에 저장된 조회 데이터를 모두 지울까요? (설정·로그인은 유지)')) return;
    await clearSavedData();
    toast('저장 데이터를 비웠습니다');
    showData();
  });
  $('#btnReset', root).addEventListener('click', async () => {
    if (!confirm('이 기기의 설정(Gateway·키·표시)과 저장 데이터를 모두 초기화할까요?')) return;
    await clearSavedData();
    settings.reset();
    clearCache();
    location.reload();
  });
  $('#btnSec', root).addEventListener('click', () => securityTest(root));
  $('#btnDiag', root).addEventListener('click', () => upstreamDiag(root));
  $('#btnCheck', root).addEventListener('click', () => { saveNow(); });
  $('#btnSaveKeys', root).addEventListener('click', () => saveNow('API 키를 저장했습니다'));
  $('#btnSaveKeys2', root).addEventListener('click', () => saveNow('API 키를 저장했습니다'));
  $('#btnClearKeys', root).addEventListener('click', () => {
    KEY_FIELDS.forEach(([k]) => { $('#key-' + k, root).value = ''; });
    saveNow('이 기기에 저장된 API 키를 지웠습니다');
  });

  /* 처음 열 때 기본 Gateway를 저장해 두고 점검 */
  if (!s.gateway && DEFAULT_GATEWAY) save();
  if (settings.gateway()) check(root);
}

let checkSeq = 0;
async function check(root) {
  const seq = ++checkSeq;
  const set = (k, html) => { const el = $('#st-' + k, root); if (el) { el.className = ''; el.innerHTML = html; } };
  const help = $('#checkHelp', root);
  Object.keys(SVC).forEach((k) => set(k, '<span class="mut">점검 중…</span>'));
  $('#stGw', root).innerHTML = '<span class="mut">점검 중…</span>';
  help.textContent = '';
  try {
    const h = await api.health();
    if (seq !== checkSeq) return;
    Object.entries(h.keys).forEach(([k, ok]) => set(k, ok ? '<span class="ok-text">● 키 있음</span>' : '<span class="amber-text">● 키 없음</span>'));
    $('#stGw', root).innerHTML = `<span class="ok-text">● 연결됨${h.version ? ' · v' + esc(h.version) : ''}</span>`;
    const missing = Object.entries(h.keys).filter(([, ok]) => !ok).map(([k]) => SVC[k]);
    const ks = $('#keyState', root);
    if (ks) ks.innerHTML = missing.length ? `<span class="amber-text">키 없음: ${esc(missing.join(', '))}</span>` : '<span class="ok-text">모든 키 입력됨 · 유효성 미확인</span>';
    help.innerHTML = missing.length
      ? `<span class="amber-text">${esc(missing.join(', '))} 키가 없습니다.</span> 위 API 키 칸에 본인의 키를 입력하세요.`
      : '<span class="ok-text">모든 키가 입력되어 있습니다.</span> 실제 유효 여부는 외부 API 진단으로 확인하세요.';
  } catch (err) {
    if (seq !== checkSeq) return;
    $('#stGw', root).innerHTML = `<span class="amber-text">● 실패</span>`;
    Object.keys(SVC).forEach((k) => set(k, '<span class="mut">—</span>'));
    const hint = {
      NETWORK: 'Gateway 주소와 Worker 배포 상태를 확인하세요.',
      NOT_APPROVED: 'Cloudflare Worker의 ALLOWED_EMAILS 값에 로그인한 이메일이 있는지 확인하세요.',
      TOKEN_AUDIENCE: 'Cloudflare Worker의 FIREBASE_PROJECT_ID가 팀 Firebase 프로젝트와 일치하는지 확인하세요.',
      NOT_FOUND: 'Worker 코드가 IDF Gateway 코드로 배포되었는지 확인하세요.',
    }[err.code] || '';
    help.innerHTML = `<span class="amber-text">${esc(errorText(err))}</span> ${esc(hint)}`;
    if (err.code === 'NETWORK' || err.code === 'TIMEOUT' || err.code === 'BAD_GATEWAY_RESPONSE') {
      help.innerHTML = '<span class="mut">연결 원인 진단 중…</span>';
      const d = await diagnoseGateway();
      if (seq !== checkSeq) return;
      help.innerHTML = `<span class="amber-text">진단: ${esc(d.ok ? errorText(err) : d.text)}</span>`;
    }
  }
}

/* ---------------------------------------------------------- 인증 보안 검증 */
const b64u = (str) => btoa(unescape(encodeURIComponent(str))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function securityTest(root) {
  const out = $('#secOut', root);
  const btn = $('#btnSec', root);
  const u = user();
  if (!u) { out.innerHTML = '<p class="amber-text">Google 로그인 상태에서만 실행할 수 있습니다.</p>'; return; }
  btn.disabled = true;
  const token = await idToken();
  const [h, p, sig] = token.split('.');
  const claims = decodeJwt(token) || {};
  const forge = (patch) => `${h}.${b64u(JSON.stringify({ ...claims, ...patch }))}.${sig}`;
  const flipSig = `${h}.${p}.${sig.slice(0, -4)}${sig.slice(-4) === 'AAAA' ? 'BBBB' : 'AAAA'}`;
  const H = (t) => (t ? { Authorization: 'Bearer ' + t } : {});
  const projectId = settings.firebase().projectId;
  const now = Math.floor(Date.now() / 1000);

  const tests = [
    { name: '로그인 토큰 없이 요청', expect: '401 차단', run: () => probe('/api/health'), ok: (r) => r.status === 401 },
    { name: '서명을 변조한 토큰', expect: '401 차단', run: () => probe('/api/health', H(flipSig)), ok: (r) => r.status === 401 },
    { name: '이메일을 다른 계정으로 바꾼 위조 토큰', expect: '401 차단', run: () => probe('/api/health', H(forge({ email: 'attacker@example.com' }))), ok: (r) => r.status === 401 },
    { name: '만료시간을 늘린 위조 토큰', expect: '401 차단', run: () => probe('/api/health', H(forge({ exp: now + 86400 * 365 }))), ok: (r) => r.status === 401 },
    { name: '형식이 깨진 토큰', expect: '401 차단', run: () => probe('/api/health', H('not-a-token')), ok: (r) => r.status === 401 },
    { name: '토큰 없이 데이터(DART) 직접 요청', expect: '401 차단', run: () => probe('/api/dart/list.json?corp_code=00120030'), ok: (r) => r.status === 401 },
    { name: '토큰 없이 데이터(KRX) 직접 요청', expect: '401 차단', run: () => probe('/api/krx/snapshot?codes=006360'), ok: (r) => r.status === 401 },
    { name: '정상 토큰(현재 로그인 계정)', expect: '200 승인 · 같은 이메일', run: () => probe('/api/health', H(token)),
      ok: (r) => r.status === 200 && String(r.body?.user || '').toLowerCase() === String(u.email).toLowerCase() },
  ];
  const row = (t, i) => `<tr><td class="num">${i + 1}</td><td>${esc(t.name)}</td><td class="mut">${esc(t.expect)}</td><td id="sec-r${i}"><span class="sec-badge run">…</span></td></tr>`;
  out.innerHTML = `<table class="sec-table"><thead><tr><th>#</th><th>시험</th><th>기대 결과</th><th>실제</th></tr></thead><tbody>${tests.map(row).join('')}</tbody></table>
    <table class="sec-table kv" style="margin-top:14px"><thead><tr><th colspan="2">현재 로그인 토큰 정보 (Google 발급)</th></tr></thead><tbody>
      <tr><td>계정</td><td>${esc(claims.email || '—')} ${claims.email_verified ? '<span class="sec-badge pass">이메일 인증됨</span>' : '<span class="sec-badge fail">미인증</span>'}</td></tr>
      <tr><td>발급자</td><td>${esc(claims.iss || '—')} ${claims.iss === 'https://securetoken.google.com/' + projectId ? '<span class="sec-badge pass">일치</span>' : '<span class="sec-badge fail">불일치</span>'}</td></tr>
      <tr><td>대상 프로젝트</td><td>${esc(claims.aud || '—')} ${claims.aud === projectId ? '<span class="sec-badge pass">일치</span>' : '<span class="sec-badge fail">불일치</span>'}</td></tr>
      <tr><td>로그인 방식</td><td>${esc(claims.firebase?.sign_in_provider || '—')}</td></tr>
      <tr><td>토큰 만료</td><td>${claims.exp ? new Date(claims.exp * 1000).toLocaleString('ko-KR') : '—'} <span class="mut">(1시간마다 자동 갱신)</span></td></tr>
    </tbody></table><div id="secSum"></div>`;
  let pass = 0;
  for (const [i, t] of tests.entries()) {
    const r = await t.run();
    const good = t.ok(r);
    if (good) pass += 1;
    const detail = `${r.status || '연결 실패'} ${r.body?.error || (r.body?.user ? '· ' + r.body.user : '')}`;
    $('#sec-r' + i, root).innerHTML = `<span class="sec-badge ${good ? 'pass' : 'fail'}">${good ? 'PASS' : 'FAIL'}</span> <span class="mut num">${esc(detail)}</span>`;
  }
  const all = pass === tests.length;
  $('#secSum', root).innerHTML = `<div class="sec-sum ${all ? 'pass' : 'fail'}">${all
    ? `✓ ${pass}/${tests.length} 통과 — 서버가 위조·변조·무토큰 요청을 차단했습니다. 팀원만 허용되는지는 별도 서버 정책을 확인하세요.`
    : `✗ ${pass}/${tests.length} 통과 — FAIL 항목을 확인하세요. (Worker 코드·변수 설정 점검 필요)`}</div>
    <p class="help" style="margin:10px 0 0">추가 확인: 서버의 접근 정책을 확인하세요. 허용 목록 또는 회사 도메인을 확인하세요.</p>`;
  btn.disabled = false;
}

/* ---------------------------------------------------------- 외부 API 진단 */
async function upstreamDiag(root) {
  const out = $('#diagOut', root);
  const btn = $('#btnDiag', root);
  btn.disabled = true;
  out.innerHTML = '<p class="mut">Worker가 각 API에 요청하는 중… (10초 내외)</p>';
  try {
    const d = await api.diag();
    // 이전 Worker(v1.5)의 '기본 요청' 행은 비교용 — 앱이 쓰는 '브라우저 헤더' 요청이 정상이면 문제 아님
    const headerOk = d.checks.some((c) => /브라우저 헤더/.test(c.name) && c.ok);
    d.checks = d.checks.map((c) => (/기본 요청/.test(c.name) && headerOk ? { ...c, ok: true, note: '참고용 비교(헤더 없는 요청은 차단됨) — 앱은 브라우저 헤더 방식을 사용하므로 정상' } : c));
    const blocked = d.checks.filter((c) => !c.ok && /차단/.test(c.note));
    const rows = d.checks.map((c) => `<tr><td>${esc(c.name)}</td><td><span class="sec-badge ${c.ok ? 'pass' : 'fail'}">${c.ok ? '정상' : '실패'}</span></td>
      <td class="mut">${esc(scrubText(c.note || ''))}</td><td class="num mut">${c.status || '—'} · ${c.ms ?? '—'}ms</td></tr>`).join('');
    out.innerHTML = `<table class="sec-table"><thead><tr><th>API</th><th>결과</th><th>내용</th><th>HTTP · 시간</th></tr></thead><tbody>${rows}</tbody></table>
      <table class="sec-table kv" style="margin-top:12px"><tbody>
        <tr><td>Worker 실행 위치</td><td>${esc(d.worker?.colo || '—')} ${d.worker?.country ? '(' + esc(d.worker.country) + ')' : ''}</td></tr>
        <tr><td>외부로 나가는 IP 위치</td><td>${esc(d.egress?.loc || '—')} · ${esc(d.egress?.colo || '—')} <span class="mut">(${esc(d.egress?.ip || '—')})</span></td></tr>
        <tr><td>Worker 버전</td><td>v${esc(d.version || '—')}</td></tr>
      </tbody></table>
      ${blocked.length ? `<div class="sec-sum fail">${esc(blocked.map((c) => c.name).join(', '))}: 서버가 Worker 요청을 차단합니다${d.egress?.loc && d.egress.loc !== 'KR' ? ` — Worker의 출구 IP가 해외(${esc(d.egress.loc)})로 인식되는 것이 원인일 가능성이 큽니다` : ''}. 이 결과 화면을 개발자에게 전달하세요.</div>`
        : d.checks.every((c) => c.ok) ? `<div class="sec-sum pass">✓ ${d.checks.length}개 항목 모두 정상 응답합니다.</div>`
          : d.checks.some((c) => !c.ok && /권한 없음|인증키 오류/.test(c.note || '')) ? `<div class="sec-sum fail">${esc(d.checks.filter((c) => !c.ok).map((c) => c.name).join(', '))}: 키 또는 서비스 이용 승인을 확인하세요(내용 열 참고).</div>` : ''}
      ${/^1\.[0-5]\./.test(d.version || '') ? '<p class="amber-text" style="margin-top:10px">Worker v' + esc(d.version) + ' — v1.6으로 교체하면 OpenDART가 실제 요청 방식으로 판정되고, KRX 서비스별 승인 여부·외국인/PER/PBR 항목이 진단됩니다.</p>' : ''}`;
  } catch (err) {
    out.innerHTML = `<p class="amber-text">${esc(err.code === 'NOT_FOUND' ? 'Worker가 이전 버전입니다. v1.5 Worker 코드로 교체하세요.' : errorText(err))}</p>`;
  }
  btn.disabled = false;
}
