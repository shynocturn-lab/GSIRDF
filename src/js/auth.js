/* Google 로그인 (Firebase Auth, modular SDK — 필요할 때만 로드) */
import { settings } from './store.js';

const SDK = 'https://www.gstatic.com/firebasejs/10.12.2/';
let mod = null;
let auth = null;
let currentUser = null;

async function load() {
  if (mod) return mod;
  const [app, a] = await Promise.all([import(SDK + 'firebase-app.js'), import(SDK + 'firebase-auth.js')]);
  mod = { app, a };
  return mod;
}

export async function initAuth(onChange) {
  const { app, a } = await load();
  const cfg = settings.firebase();
  const instance = app.getApps().length ? app.getApp() : app.initializeApp(cfg);
  auth = a.getAuth(instance);
  await a.setPersistence(auth, remember() ? a.browserLocalPersistence : a.browserSessionPersistence).catch(() => {});
  try { await a.getRedirectResult(auth); } catch (err) { onChange(null, err); }
  a.onAuthStateChanged(auth, (user) => { currentUser = user; onChange(user, null); });
}

const remember = () => settings.get().remember !== false;

export async function signIn() {
  const { a } = await load();
  await a.setPersistence(auth, remember() ? a.browserLocalPersistence : a.browserSessionPersistence).catch(() => {});
  const provider = new a.GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  // GitHub Pages에서 리다이렉트 로그인은 브라우저의 저장소 차단에 영향을 받을 수 있어 팝업만 사용합니다.
  await a.signInWithPopup(auth, provider);
}

export async function signOutUser() {
  const { a } = await load();
  if (auth) await a.signOut(auth);
}

export const user = () => currentUser;

export async function idToken() {
  return currentUser ? currentUser.getIdToken() : '';
}

/** ID 토큰의 공개 클레임(서명 검증 아님 — 표시용) */
export function decodeJwt(token) {
  try {
    const part = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const json = decodeURIComponent(escape(atob(part + '='.repeat((4 - (part.length % 4)) % 4))));
    return JSON.parse(json);
  } catch {
    return null;
  }
}
