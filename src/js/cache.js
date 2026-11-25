/* 기기 내 영구 데이터 저장소 (IndexedDB) — 한 번 조회한 공개 데이터를 저장해 다음 조회를 즉시 처리
 * - 저장 대상: 시세·공시·재무·지표·뉴스 응답(공개 데이터). API 키·로그인 토큰은 저장하지 않는다.
 * - IndexedDB를 쓸 수 없는 환경(일부 사생활 보호 모드)에서는 메모리 저장으로 자동 대체.
 * - 용량 관리: 항목 수가 한도를 넘으면 오래 쓰지 않은 항목부터 정리.
 */
const DB = 'idf-cache-v1';
const STORE = 'kv';
const MAX_ITEMS = 6000;
const PRUNE_TO = 5000;
/* XBRL 요약(접수번호별·소량)은 다시 받으려면 수 MB가 들므로 자동 정리 대상에서 제외 */
const KEEP_PREFIX = /^xbrl(-idx)?:(?!v\d+:)|^xbrl:v\d+:/; // 최신 XBRL만 보호(구버전은 cleanup에서 정리)

let dbp = null;
const memory = new Map(); // IndexedDB 불가 시 대체

function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') { resolve(null); return; }
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          const s = db.createObjectStore(STORE, { keyPath: 'k' });
          s.createIndex('used', 'used');
        }
      };
      req.onsuccess = () => {
        const db = req.result;
        db.onversionchange = () => { try { db.close(); } catch { /* noop */ } dbp = null; };
        resolve(db);
      };
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbp;
}

function tx(db, mode, fn) {
  return new Promise((resolve) => {
    try {
      const t = db.transaction(STORE, mode);
      const s = t.objectStore(STORE);
      let out;
      const r = fn(s);
      if (r) r.onsuccess = () => { out = r.result; };
      t.oncomplete = () => resolve(out);
      t.onerror = () => resolve(undefined);
      t.onabort = () => resolve(undefined);
    } catch {
      resolve(undefined);
    }
  });
}

let writes = 0;

export const store = {
  async get(k) {
    const db = await open();
    if (!db) return memory.get(k);
    const v = await tx(db, 'readonly', (s) => s.get(k));
    return v || undefined;
  },
  async getMany(keys) {
    const db = await open();
    if (!db) return keys.map((k) => memory.get(k));
    const out = new Array(keys.length);
    await new Promise((resolve) => {
      try {
        const t = db.transaction(STORE, 'readonly');
        const s = t.objectStore(STORE);
        keys.forEach((k, i) => { const r = s.get(k); r.onsuccess = () => { out[i] = r.result || undefined; }; });
        t.oncomplete = resolve; t.onerror = resolve; t.onabort = resolve;
      } catch { resolve(); }
    });
    return out;
  },
  /** v = { k, data, exp } ; used(마지막 사용 시각)는 자동 기록 */
  async put(entry) {
    const e = { ...entry, used: Date.now() };
    const db = await open();
    if (!db) { memory.set(e.k, e); if (memory.size > MAX_ITEMS) memory.delete(memory.keys().next().value); return; }
    await tx(db, 'readwrite', (s) => s.put(e));
    if (++writes % 50 === 0) prune();
  },
  async putMany(entries) {
    if (!entries.length) return;
    const db = await open();
    const now = Date.now();
    if (!db) { entries.forEach((e) => memory.set(e.k, { ...e, used: now })); return; }
    await new Promise((resolve) => {
      try {
        const t = db.transaction(STORE, 'readwrite');
        const s = t.objectStore(STORE);
        entries.forEach((e) => s.put({ ...e, used: now }));
        t.oncomplete = resolve; t.onerror = resolve; t.onabort = resolve;
      } catch { resolve(); }
    });
    writes += entries.length;
    if (writes > 50) { writes = 0; prune(); }
  },
  async del(k) {
    const db = await open();
    if (!db) { memory.delete(k); return; }
    await tx(db, 'readwrite', (s) => s.delete(k));
  },
  async clear() {
    memory.clear();
    const db = await open();
    if (db) await tx(db, 'readwrite', (s) => s.clear());
  },
  async stats() {
    const db = await open();
    const count = db ? await tx(db, 'readonly', (s) => s.count()) : memory.size;
    let bytes = null;
    try { const est = await navigator.storage?.estimate?.(); bytes = est?.usageDetails?.indexedDB ?? est?.usage ?? null; } catch { /* noop */ }
    return { count: count || 0, bytes, persistent: !!db };
  },
  /** 전체 저장 항목(백업용) */
  async exportAll() {
    const db = await open();
    if (!db) return [...memory.values()];
    const all = await tx(db, 'readonly', (s) => s.getAll());
    return Array.isArray(all) ? all : [];
  },
  /** 백업 복원: 검증된 항목만, 이미 더 최신 저장본이 있으면 덮어쓰지 않음 → 추가된 수 */
  async importAll(entries) {
    if (!Array.isArray(entries) || !entries.length) return 0;
    const existing = await this.getMany(entries.map((e) => e.k));
    const fresh = entries.filter((e, i) => !existing[i] || (existing[i].at || 0) < (e.at || 0));
    for (let i = 0; i < fresh.length; i += 500) await this.putMany(fresh.slice(i, i + 500));
    return fresh.length;
  },
  /** 저장소 유형별 집계(DART · KRX · ECOS · XBRL · 구버전/만료) */
  async breakdown(curXbrlVer = 0) {
    const all = await this.exportAll();
    const now = Date.now();
    const out = { total: all.length, dart: 0, krx: 0, ecos: 0, xbrl: 0, xbrlNa: 0, obsolete: 0, expired: 0 };
    const isObsolete = (k) => {
      if (!curXbrlVer) return false;
      const m = /^xbrl(?:-na)?:v(\d+):/.exec(k);
      return !!(m && +m[1] < curXbrlVer);
    };
    const isSwrDart = (k) => k.startsWith('/api/dart/') && !k.startsWith('/api/dart/list.json');
    for (const e of all) {
      const k = String(e.k || '');
      if (isObsolete(k)) { out.obsolete += 1; continue; }
      if (e.exp && e.exp < now && !isSwrDart(k)) out.expired += 1;
      if (k.startsWith('xbrl:v')) out.xbrl += 1;
      else if (k.startsWith('xbrl-na:')) out.xbrlNa += 1;
      else if (k.startsWith('xbrl-idx:')) { /* index */ }
      else if (k.startsWith('/api/dart/')) out.dart += 1;
      else if (k.startsWith('krx:') || k.startsWith('/api/krx/') || k.startsWith('/api/stock/')) out.krx += 1;
      else if (k.startsWith('ecos:') || k.startsWith('/api/ecos/')) out.ecos += 1;
    }
    return out;
  },
  /** 구버전 XBRL(v1..vN-1)과 만료된 비-SWR 항목을 정리해 기기 용량 최적화 */
  async cleanup(curXbrlVer = 0) {
    const all = await this.exportAll();
    const now = Date.now();
    const isSwrDart = (k) => k.startsWith('/api/dart/') && !k.startsWith('/api/dart/list.json');
    const dead = [];
    let obsolete = 0; let expired = 0;
    for (const e of all) {
      const k = String(e.k || '');
      const m = /^xbrl(?:-na)?:v(\d+):/.exec(k);
      if (curXbrlVer && m && +m[1] < curXbrlVer) { dead.push(k); obsolete += 1; continue; }
      if (e.exp && e.exp < now && !isSwrDart(k)) { dead.push(k); expired += 1; }
    }
    if (!dead.length) return { removed: 0, obsolete: 0, expired: 0 };
    const db = await open();
    if (!db) { dead.forEach((k) => memory.delete(k)); return { removed: dead.length, obsolete, expired }; }
    await new Promise((resolve) => {
      try {
        const t = db.transaction(STORE, 'readwrite');
        const s = t.objectStore(STORE);
        dead.forEach((k) => s.delete(k));
        t.oncomplete = resolve; t.onerror = resolve; t.onabort = resolve;
      } catch { resolve(); }
    });
    return { removed: dead.length, obsolete, expired };
  },
};

/** 오래 사용하지 않은 항목부터 정리 */
async function prune() {
  const db = await open();
  if (!db) return;
  const count = await tx(db, 'readonly', (s) => s.count());
  if (!(count > MAX_ITEMS)) return;
  // 1단계: 이미 만료된 항목 우선 정리 → 2단계: 초과분만 오래된 순 삭제(최신 XBRL 요약 보호)
  const cleaned = await store.cleanup(0);
  let remove = count - cleaned.removed - PRUNE_TO;
  if (remove <= 0) return;
  await new Promise((resolve) => {
    try {
      const t = db.transaction(STORE, 'readwrite');
      const idx = t.objectStore(STORE).index('used');
      const cur = idx.openCursor();
      cur.onsuccess = () => {
        const c = cur.result;
        if (!c || remove <= 0) return;
        if (!KEEP_PREFIX.test(String(c.primaryKey))) { c.delete(); remove -= 1; }
        c.continue();
      };
      t.oncomplete = resolve; t.onerror = resolve; t.onabort = resolve;
    } catch { resolve(); }
  });
}
export const _prune = prune; // 테스트용
