/* 기기별 설정 저장 (localStorage). 실패해도 앱은 기본값으로 동작합니다. */
import { DEFAULT_FIREBASE, DEFAULT_GATEWAY } from './config.js';

const KEY = 'idf_team_shared_v2';
const USER_KEY_PREFIX = 'idf_team_userkeys_v2:';
let activeUserKey = '';
let userKeys = {};

/**
 * API 키 정리: iPad 키보드가 넣는 보이지 않는 공백·스마트 따옴표·전각문자 제거.
 * HTTP 헤더에 넣을 수 없는 문자(한글 등)가 남으면 사용하지 않는다(빈 값 처리).
 */
export function sanitizeKey(v) {
  const t = String(v ?? '').normalize('NFKC')
    .replace(/[\s\u00A0\u200B-\u200D\u2060\uFEFF\u2018\u2019\u201C\u201D'"`]/g, '');
  return /^[\x21-\x7E]{1,200}$/.test(t) ? t : '';
}
export const isKeyValid = (v) => !String(v ?? '').trim() || sanitizeKey(v) !== '';
const cleanKeys = (k = {}) => Object.fromEntries(Object.entries(k).map(([n, v]) => [n, sanitizeKey(v)]));

const DEFAULTS = {
  gateway: DEFAULT_GATEWAY,
  firebase: null, // null → DEFAULT_FIREBASE
  keys: { krx: '', dart: '', ecos: '', naverId: '', naverSecret: '' }, // 로그인 계정별 브라우저 키
  company: 'gs',
  newsQuery: 'GS건설',
};

function read() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '{}');
    const { keys: ignored, ...shared } = raw;
    return { ...DEFAULTS, ...shared, keys: { ...DEFAULTS.keys } };
  } catch { return structuredClone(DEFAULTS); }
}
let state = read();
function saveShared() {
  const { keys: ignored, ...shared } = state;
  try { localStorage.setItem(KEY, JSON.stringify(shared)); } catch { /* 세션 내 유지 */ }
}
export const settings = {
  get: () => ({ ...state, keys: { ...DEFAULTS.keys, ...userKeys } }),
  activateUser(uid) {
    activeUserKey = uid ? USER_KEY_PREFIX + encodeURIComponent(settings.firebase().projectId || '') + ':' + encodeURIComponent(uid) : '';
    userKeys = {};
    if (activeUserKey) {
      try { userKeys = cleanKeys(JSON.parse(localStorage.getItem(activeUserKey) || '{}')); } catch { userKeys = {}; }
    }
  },
  set(patch) {
    const { keys, ...shared } = patch;
    state = { ...state, ...shared };
    if (keys && activeUserKey) {
      userKeys = { ...userKeys, ...cleanKeys(keys) };
      try { localStorage.setItem(activeUserKey, JSON.stringify(userKeys)); } catch { /* 세션 내 유지 */ }
    }
    saveShared();
    return settings.get();
  },
  reset() {
    state = structuredClone(DEFAULTS); userKeys = {};
    try { localStorage.removeItem(KEY); if (activeUserKey) localStorage.removeItem(activeUserKey); } catch { /* noop */ }
  },
  firebase: () => state.firebase && state.firebase.apiKey ? state.firebase : DEFAULT_FIREBASE,
  gateway: () => normalizeGateway(state.gateway) || normalizeGateway(DEFAULT_GATEWAY),
};

/** 사용자가 입력한 Gateway 주소 정리: 공백 제거, https:// 보정, 끝 슬래시·경로 제거 */
export function normalizeGateway(v) {
  let t = String(v || '').trim().replace(/\s+/g, '');
  if (!t) return '';
  if (!/^https?:\/\//i.test(t)) t = 'https://' + t;
  try {
    const u = new URL(t);
    if (u.protocol !== 'https:' && !(u.protocol === 'http:' && /^(localhost|127\.0\.0\.1)$/.test(u.hostname))) return '';
    return `${u.protocol}//${u.host}`;
  } catch {
    return '';
  }
}

/* 테마 · 등락 색상 */
export const prefs = {
  theme: () => document.documentElement.dataset.theme || 'dark',
  setTheme(t) {
    document.documentElement.dataset.theme = t;
    try { localStorage.setItem('idf_theme', t); } catch { /* noop */ }
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', t === 'light' ? '#F2F4F7' : '#0A0D13');
  },
  color: () => document.documentElement.dataset.color || 'kr',
  setColor(c) {
    document.documentElement.dataset.color = c;
    try { localStorage.setItem('idf_color', c); } catch { /* noop */ }
  },
};
