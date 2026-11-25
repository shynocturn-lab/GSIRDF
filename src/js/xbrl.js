/* XBRL 주석 — OpenDART 재무제표 원본파일(fnlttXbrl.xml, ZIP)에서 주석 수치 추출 (v2.3.2)
 *
 * 추출:
 *   1) 기간(duration): 감가상각비 4종(유형·무형·투자부동산·사용권자산), 이자수익·이자비용, 영업부문별 매출·영업이익
 *   2) 시점(instant): 장단기 차입금·사채·리스부채 7종 + 현재가치할인차금·사채할인발행차금 4종 → 순장부금액 총차입금·단기상환부담액
 * 핵심 개선(v2.3.2):
 *   - FSS DART 표준 축(CarryingAmountAccumulatedDepreciationAmortisationAndImpairmentAndGrossCarryingAmountAxis)의
 *     '공시금액'·'장부금액' 구성요소(회사 lab-ko.xml에 미포함된 표준 dart:*Member)를 중립 차원으로 정확 인식
 *   - lab-ko.xml의 모든 라벨 역할(label·terseLabel·negatedLabel·verboseLabel)을 전부 수집해 매칭
 *   - 할인차금은 동일 컨텍스트/동일 표의 총액 항목에서만 차감해 이중 차감 원천 차단
 *   - 리스부채 유동/비유동 미분리 시 총리스부채(ifrs-full_LeaseLiabilities) 대체 반영
 *   - 유동성장기부채·유동성사채 미탐지 시 단기상환부담액을 0으로 오표기하지 않고 null 반환
 */
import { api, ApiError, isForcing } from './api.js';
import { store } from './cache.js';

export const REPRT = { 1: '11013', 2: '11012', 3: '11014', 4: '11011' };
export const PARSER_VERSION = 11;                // v2.3.12: DOMParser 네이티브 XML 파싱·duration 폴백·allLabels 진단·ZIP 전수목록·원문XML 포렌식 프로브
const KEEP = 10 * 365 * 86400e3;
const MAX_UNZIPPED = 80 * 1024 * 1024;
const MAX_ENTRIES = 300;

/* ============================================================ ZIP */
export function canUnzip() { return typeof DecompressionStream !== 'undefined'; }

async function inflateRaw(bytes) {
  const ds = new DecompressionStream('deflate-raw');
  const stream = new Blob([bytes]).stream().pipeThrough(ds);
  const buf = await new Response(stream).arrayBuffer();
  return new Uint8Array(buf);
}

/** ZIP(ArrayBuffer/Uint8Array) → { 파일명: Uint8Array }. 중앙 디렉터리 기준 */
export async function unzip(buffer, wanted = () => true, allNames = null) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  if (bytes.length < 22) throw new ApiError('XBRL_BAD_ZIP', 'XBRL 파일 형식이 올바르지 않습니다.');
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i -= 1) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new ApiError('XBRL_BAD_ZIP', 'XBRL 파일 형식이 올바르지 않습니다(ZIP 아님).');
  const count = dv.getUint16(eocd + 10, true);
  if (count > MAX_ENTRIES) throw new ApiError('XBRL_BAD_ZIP', 'XBRL 파일 항목 수가 비정상적으로 많습니다.');
  let p = dv.getUint32(eocd + 16, true);
  const out = {};
  let total = 0;
  const dec = new TextDecoder('utf-8');
  for (let n = 0; n < count; n += 1) {
    if (p + 46 > bytes.length || dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true);
    const csize = dv.getUint32(p + 20, true);
    const usize = dv.getUint32(p + 24, true);
    const nlen = dv.getUint16(p + 28, true);
    const xlen = dv.getUint16(p + 30, true);
    const clen = dv.getUint16(p + 32, true);
    const lho = dv.getUint32(p + 42, true);
    const name = dec.decode(bytes.subarray(p + 46, p + 46 + nlen));
    p += 46 + nlen + xlen + clen;
    if (allNames && !name.endsWith('/')) allNames.push(name);
    if (name.endsWith('/') || !wanted(name)) continue;
    if (lho + 30 > bytes.length || dv.getUint32(lho, true) !== 0x04034b50) continue;
    const start = lho + 30 + dv.getUint16(lho + 26, true) + dv.getUint16(lho + 28, true);
    if (start + csize > bytes.length) continue;
    total += usize;
    if (total > MAX_UNZIPPED) throw new ApiError('XBRL_TOO_LARGE', 'XBRL 파일이 너무 큽니다.');
    const raw = bytes.subarray(start, start + csize);
    if (method === 0) out[name] = raw;
    else if (method === 8) out[name] = await inflateRaw(raw);
  }
  return out;
}

export function decodeText(bytes) {
  const head = new TextDecoder('ascii').decode(bytes.subarray(0, Math.min(200, bytes.length)));
  const enc = ((head.match(/encoding=["']([^"']+)["']/i) || [])[1] || 'utf-8').toLowerCase();
  if (/euc-?kr|ks_c_5601|cp949/.test(enc)) { try { return new TextDecoder('euc-kr').decode(bytes); } catch { /* utf-8 */ } }
  return new TextDecoder('utf-8').decode(bytes);
}

/* ============================================================ 파서 */
const attrsOf = (s) => {
  const o = {};
  const re = /([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let m;
  while ((m = re.exec(s)) !== null) o[m[1]] = m[2] !== undefined ? m[2] : m[3];
  return o;
};
const ent = (t) => t.replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d)).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
const conceptOfHref = (href) => { const raw = String(href || '').split('#')[1] || ''; try { return decodeURIComponent(raw); } catch { return raw; } };
const toKey = (qname) => String(qname || '').trim().replace(':', '_');
const localOf = (key) => key.slice(key.indexOf('_') + 1);

/** 라벨 링크베이스(*_lab-ko.xml): labelLink 블록별 격리 파싱(xlink:label 충돌 방지) + negated 역할 감지 */
function parseLabelsFull(xml) {
  const std = {};
  const all = {};
  const negated = new Set();
  const add = (c, list) => {
    if (!c || !list?.length) return;
    const primary = (list.find((x) => /\/role\/label$/.test(x.role)) || list[0]).text;
    if (!std[c]) std[c] = primary;
    const set = all[c] || (all[c] = new Set());
    set.add(primary);
    for (const x of list) {
      set.add(x.text);
      if (/negated/i.test(x.role)) negated.add(c);
    }
  };
  const blocks = [];
  const linkRe = /<(?:[\w-]+:)?labelLink\b[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?labelLink>/g;
  let lm;
  while ((lm = linkRe.exec(xml)) !== null) blocks.push(lm[1]);
  if (!blocks.length) blocks.push(xml);
  const re = /<(?:[\w-]+:)?(loc|label|labelArc)\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:[\w-]+:)?\1>)/g;
  for (const body of blocks) {
    const locs = {}; const res = {}; const arcs = [];
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(body)) !== null) {
      const a = attrsOf(m[2]);
      if (m[1] === 'loc') locs[a['xlink:label']] = conceptOfHref(a['xlink:href']);
      else if (m[1] === 'label') {
        const lang = (a['xml:lang'] || '').toLowerCase();
        if (lang && !lang.startsWith('ko')) continue;
        const role = a['xlink:role'] || '';
        const id = a['xlink:label'];
        const text = ent((m[3] || '').replace(/<[^>]+>/g, '')).trim();
        if (!id || !text) continue;
        (res[id] = res[id] || []).push({ role, text });
      } else arcs.push([a['xlink:from'], a['xlink:to']]);
    }
    for (const [from, to] of arcs) add(locs[from], res[to]);
    for (const [id, list] of Object.entries(res)) { const c = id.replace(/^label_/, ''); if (/_/.test(c)) add(c, list); }
  }
  return { std, all, negated };
}

/** 호환 API: concept → 한글 표준 라벨 */
export function parseLabels(xml) { return parseLabelsFull(xml).std; }

/** 표시 링크베이스(*_pre.xml): 역할별 부모 → 정렬된 자식 개념 목록 추출(주석 표 행 순서 보존) */
function parsePresentation(xml) {
  const siblings = [];
  const linkRe = /<(?:[\w-]+:)?presentationLink\b[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?presentationLink>/g;
  let lm;
  while ((lm = linkRe.exec(xml)) !== null) {
    const body = lm[1];
    const locs = {};
    const byParent = {};
    const re = /<(?:[\w-]+:)?(loc|presentationArc)\b([^>]*?)\/?>/g;
    let m;
    while ((m = re.exec(body)) !== null) {
      const a = attrsOf(m[2]);
      if (m[1] === 'loc') locs[a['xlink:label']] = conceptOfHref(a['xlink:href']);
      else {
        const p = a['xlink:from']; const c = a['xlink:to'];
        if (!p || !c) continue;
        (byParent[p] = byParent[p] || []).push({ to: c, ord: Number(a.order || 0) });
      }
    }
    for (const children of Object.values(byParent)) {
      if (children.length < 2) continue;
      children.sort((a, b) => a.ord - b.ord);
      const list = children.map((x) => locs[x.to]).filter(Boolean);
      if (list.length >= 2) siblings.push(list);
    }
  }
  return siblings;
}

/** 계산 링크베이스(*_cal.xml): 역할별 부모 → { concept, weight, ord } 추출(차감계정 weight=-1 판별) */
function parseCalculation(xml) {
  const groups = [];
  const linkRe = /<(?:[\w-]+:)?calculationLink\b[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?calculationLink>/g;
  let lm;
  while ((lm = linkRe.exec(xml)) !== null) {
    const body = lm[1];
    const locs = {};
    const byParent = {};
    const re = /<(?:[\w-]+:)?(loc|calculationArc)\b([^>]*?)\/?>/g;
    let m;
    while ((m = re.exec(body)) !== null) {
      const a = attrsOf(m[2]);
      if (m[1] === 'loc') locs[a['xlink:label']] = conceptOfHref(a['xlink:href']);
      else {
        const p = a['xlink:from']; const c = a['xlink:to'];
        if (!p || !c) continue;
        (byParent[p] = byParent[p] || []).push({ to: c, weight: Number(a.weight || 1), ord: Number(a.order || 0) });
      }
    }
    for (const children of Object.values(byParent)) {
      if (children.length < 2) continue;
      children.sort((a, b) => a.ord - b.ord);
      const list = children.map((x) => ({ c: locs[x.to], w: x.weight })).filter((x) => x.c);
      if (list.length >= 2) groups.push(list);
    }
  }
  return groups;
}

const decodeHtmlBlock = (s) => {
  let out = ent(String(s || ''));
  if (/&lt;(?:table|tr|td|th|div)/i.test(out)) out = ent(out);
  return out;
};

/** 브라우저 네이티브 DOMParser 기반 XBRL 인스턴스 파서 (정규식 누락 0건 · 기본네임스페이스/튜플/주석/CDATA 완전 대응) */
function parseInstanceDom(xml) {
  if (typeof DOMParser === 'undefined') return null;
  let doc;
  try { doc = new DOMParser().parseFromString(xml, 'application/xml'); } catch { return null; }
  const root = doc && doc.documentElement;
  if (!root || root.localName === 'parsererror' || doc.getElementsByTagName('parsererror').length) return null;
  const contexts = {};
  const facts = [];
  const textBlocks = [];
  let unicodeFacts = 0;
  const SKIP_PFX = /^(xbrli|link|xlink|xbrldi|xsi)$/;

  const walkContext = (el) => {
    const id = (el.getAttribute('id') || '').trim();
    if (!id) return;
    let start = null; let end = null; let instant = null;
    const dims = [];
    const stack = [...el.children];
    while (stack.length) {
      const node = stack.shift();
      const ln = node.localName;
      if (ln === 'startDate') start = (node.textContent || '').trim() || null;
      else if (ln === 'endDate') end = (node.textContent || '').trim() || null;
      else if (ln === 'instant') instant = (node.textContent || '').trim() || null;
      else if (ln === 'explicitMember' || ln === 'typedMember') {
        const axis = toKey(node.getAttribute('dimension') || '');
        const rawTxt = (node.textContent || '').trim();
        dims.push({ axis, member: ln === 'explicitMember' ? toKey(rawTxt) : (rawTxt ? `typed_${rawTxt}` : 'typed') });
      } else if (node.children && node.children.length) {
        for (let i = 0; i < node.children.length; i += 1) stack.push(node.children[i]);
      }
    }
    contexts[id] = { id, start, end, instant, dims };
  };

  // 1패스: 모든 context 수집
  const top = root.children;
  for (let i = 0; i < top.length; i += 1) {
    if (top[i].localName === 'context') walkContext(top[i]);
  }
  // 2패스: 모든 팩트(튜플 중첩 포함) 수집
  const visitFact = (el, depth) => {
    const ln = el.localName;
    if (ln === 'context' || ln === 'unit' || ln === 'schemaRef' || ln === 'linkbaseRef' || ln === 'roleRef' || ln === 'arcroleRef' || ln === 'footnoteLink') return;
    const pfx = el.prefix || '';
    if (pfx && SKIP_PFX.test(pfx)) return;
    const ref = (el.getAttribute('contextRef') || '').trim();
    if (!ref) {
      if (depth < 3 && el.children && el.children.length) {
        for (let i = 0; i < el.children.length; i += 1) visitFact(el.children[i], depth + 1);
      }
      return;
    }
    if (!contexts[ref]) return;
    const nil = el.getAttribute('xsi:nil') || el.getAttributeNS('http://www.w3.org/2001/XMLSchema-instance', 'nil');
    if (nil === 'true' || nil === '1') return;
    const txt = (el.textContent || '').trim();
    if (!txt) return;
    const c = pfx ? `${pfx}_${ln}` : `_${ln}`;
    if (/^[-+]?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?$/.test(txt)) {
      if (/[^\x00-\x7F]/.test(ln)) unicodeFacts += 1;
      facts.push({ c, ctx: ref, v: Number(txt) });
      return;
    }
    if (txt.length >= 40) {
      const dec = decodeHtmlBlock(txt);
      if (/(<table|할인|차입|사채|금융부채|Discount|Borrow)/i.test(dec)) {
        textBlocks.push({ c, ctx: ref, html: dec });
      }
    }
  };
  for (let i = 0; i < top.length; i += 1) visitFact(top[i], 0);
  return { contexts, facts, textBlocks, unicodeFacts, engine: 'dom' };
}

/**
 * XBRL 인스턴스 파서:
 *  - 브라우저 환경에서는 네이티브 DOMParser를 최우선 사용하여 XML 파싱 누락 0건 보장
 *  - Node 테스트/비정상 XML 환경에서는 개선된 정규식 파서(옵션 접두사·유니코드·문자열 표 지원)로 자동 폴백
 */
export function parseInstance(xml) {
  const domRes = parseInstanceDom(xml);
  if (domRes && (domRes.facts.length > 0 || Object.keys(domRes.contexts).length > 0)) return domRes;
  const contexts = {};
  const cre = /<(?:[\w-]+:)?context\b([^>]*)>([\s\S]*?)<\/(?:[\w-]+:)?context\s*>/g;
  let m;
  while ((m = cre.exec(xml)) !== null) {
    const id = (attrsOf(m[1]).id || '').trim();
    if (!id) continue;
    const body = m[2];
    const tag = (t) => ((body.match(new RegExp(`<(?:[\\w-]+:)?${t}\\b[^>]*>\\s*([^<\\s]+)\\s*<`)) || [])[1] || null);
    const dims = [];
    const dre = /<(?:[\w-]+:)?(explicitMember|typedMember)\b([^>]*)>([\s\S]*?)<\/(?:[\w-]+:)?\1\s*>/g;
    let d;
    while ((d = dre.exec(body)) !== null) {
      const axis = toKey(attrsOf(d[2]).dimension);
      const rawTxt = ent(d[3].replace(/<[^>]+>/g, '')).trim();
      dims.push({ axis, member: d[1] === 'explicitMember' ? toKey(rawTxt) : (rawTxt ? `typed_${rawTxt}` : 'typed') });
    }
    contexts[id] = { id, start: tag('startDate'), end: tag('endDate'), instant: tag('instant'), dims };
  }
  const facts = [];
  let unicodeFacts = 0;
  // 접두사 선택형 + 유니코드(한글) 태그명 지원
  const fre = /<(?:([^\s/<>=:]+):)?([^\s/<>=:]+)\s+([^>]*\bcontextRef\s*=\s*["'][^"']+["'][^>]*)>\s*([-+]?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?)\s*<\/(?:\1:)?\2\s*>/g;
  while ((m = fre.exec(xml)) !== null) {
    const pfx = m[1] || '';
    if (pfx && /^(xbrli|link|xlink|xbrldi|xsi)$/.test(pfx)) continue;
    const a = attrsOf(m[3]);
    const ref = (a.contextRef || '').trim();
    if (!contexts[ref]) continue;
    const local = m[2];
    if (/[^\x00-\x7F]/.test(local)) unicodeFacts += 1;
    facts.push({ c: `${pfx}_${local}`, ctx: ref, v: Number(m[4]) });
  }
  const textBlocks = [];
  const tbre = /<((?:[^\s/<>=:]+:)?[^\s/<>=:]+)\s+([^>]*\bcontextRef\s*=\s*["'][^"']+["'][^>]*)>([\s\S]*?)<\/\1\s*>/gi;
  while ((m = tbre.exec(xml)) !== null) {
    const rawHtml = (m[3] || '').trim();
    if (rawHtml.length < 40 || /^[-+]?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?$/.test(rawHtml)) continue;
    const a = attrsOf(m[2]);
    const ref = (a.contextRef || '').trim();
    if (!contexts[ref]) continue;
    const dec = decodeHtmlBlock(rawHtml);
    if (!/(<table|할인|차입|사채|금융부채|Discount|Borrow)/i.test(dec)) continue;
    textBlocks.push({ c: toKey(m[1]), ctx: ref, html: dec });
  }
  return { contexts, facts, textBlocks, unicodeFacts, engine: 'regex' };
}

/* 개념 사전 — 표준 개념 우선 + 정확한 한글 라벨(개별 개념 또는 차원 멤버) 보조 */
const DEP = {
  ppe: {
    c: ['ifrs-full_DepreciationPropertyPlantAndEquipment', 'dart_DepreciationPropertyPlantAndEquipment'],
    l: ['유형자산감가상각비', '유형자산의감가상각비', '유형자산상각비'],
  },
  intangible: {
    c: ['ifrs-full_AmortisationIntangibleAssetsOtherThanGoodwill', 'dart_AmortisationIntangibleAssetsOtherThanGoodwill', 'ifrs-full_AdjustmentsForAmortisationExpense', 'ifrs-full_AmortisationExpense', 'dart_AmortisationExpense'],
    l: ['무형자산상각비', '무형자산의상각비', '무형자산감가상각비', '무형자산상각'],
  },
  invProp: {
    c: ['ifrs-full_DepreciationInvestmentProperty', 'dart_DepreciationInvestmentProperty'],
    l: ['투자부동산감가상각비', '투자부동산의감가상각비', '투자부동산상각비'],
  },
  rou: {
    c: ['ifrs-full_DepreciationRightofuseAssets', 'dart_DepreciationRightOfUseAssets', 'dart_DepreciationRightofuseAssets'],
    l: ['사용권자산감가상각비', '사용권자산상각비', '사용권자산의감가상각비', '리스자산감가상각비', '사용권자산상각'],
  },
};
/* 유형자산 전용 상각비가 없을 때만 폴백하는 범용 '감가상각비'(투자부동산·사용권자산 포함 시 중복 차감) */
const DEP_PPE_GENERIC = {
  c: ['ifrs-full_AdjustmentsForDepreciationExpense', 'ifrs-full_DepreciationExpense', 'dart_DepreciationExpense'],
  l: ['감가상각비'],
};
const DEP_COMBINED = {
  c: ['ifrs-full_DepreciationAndAmortisationExpense', 'ifrs-full_AdjustmentsForDepreciationAndAmortisationExpense'],
  l: ['감가상각비및상각비', '감가상각비와상각비', '감가상각비및무형자산상각비'],
};
const INTEREST = {
  income: {
    c: ['ifrs-full_InterestRevenueCalculatedUsingEffectiveInterestMethod', 'ifrs-full_RevenueFromInterest', 'ifrs-full_InterestIncome', 'dart_InterestIncome'],
    l: ['이자수익', '이자수익(금융수익)', '금융수익이자수익'],
  },
  expense: {
    c: ['ifrs-full_InterestExpense', 'dart_InterestExpense', 'ifrs-full_InterestExpenseOnBorrowings'],
    l: ['이자비용', '이자비용(금융원가)', '이자비용(금융비용)', '금융원가이자비용', '금융비용이자비용'],
  },
};
const BORROW_NOTE = {
  shortBorrow: { c: ['ifrs-full_ShorttermBorrowings', 'dart_ShortTermBorrowings'], l: ['단기차입금', '단기사채', '단기차입금및단기사채'] },
  currentLongBorrow: { c: ['ifrs-full_CurrentPortionOfLongtermBorrowings', 'dart_CurrentPortionOfLongTermBorrowings', 'dart_CurrentPortionOfLongtermBorrowings', 'dart_CurrentPortionOfLongTermBorrowingsGross'], l: ['유동성장기차입금', '유동성장기부채', '유동성장기차입부채', '유동성차입금', '유동성장기차입금및사채', '유동성장기부채및사채', '유동성사채및장기차입금'] },
  currentLongDisc: { c: ['dart_PresentValueDiscountsCurrentPortionOfLongTermBorrowings', 'dart_CurrentPortionOfLongTermBorrowingsPresentValueDiscount'], l: ['유동성장기차입금현재가치할인차금', '유동성장기부채현재가치할인차금', '유동성장기차입금할인차금', '유동성장기차입금의현재가치할인차금', '현재가치할인차금유동성장기차입금', '유동성장기차입금할인발행차금'] },
  currentBonds: { c: ['dart_CurrentPortionOfBonds', 'ifrs-full_CurrentPortionOfBondsIssued', 'dart_CurrentPortionOfBondsIssued', 'dart_CurrentPortionOfCorporateBonds', 'dart_CurrentPortionOfBondsGross'], l: ['유동성사채', '유동성회사채', '유동성일반사채', '유동성공모사채', '유동성무보증사채', '유동성사채및전환사채'] },
  currentBondsDisc: { c: ['dart_DiscountOnCurrentPortionOfBonds', 'dart_CurrentPortionOfBondsDiscount', 'dart_PresentValueDiscountsCurrentPortionOfBonds'], l: ['유동성사채할인발행차금', '유동성사채현재가치할인차금', '유동성사채할인차금', '유동성사채의할인발행차금', '사채할인발행차금유동성사채', '유동성회사채할인발행차금'] },
  currentLease: { c: ['ifrs-full_CurrentLeaseLiabilities', 'dart_CurrentLeaseLiabilities'], l: ['유동리스부채', '유동성리스부채', '단기리스부채', '리스부채(유동)'] },
  longBorrow: { c: ['ifrs-full_LongtermBorrowings', 'dart_LongTermBorrowings', 'dart_LongTermBorrowingsGross'], l: ['장기차입금', '비유동차입금'] },
  longBorrowDisc: { c: ['dart_PresentValueDiscountsLongTermBorrowings'], l: ['장기차입금현재가치할인차금', '장기차입금할인차금', '장기차입금의현재가치할인차금'] },
  bonds: { c: ['dart_BondsIssued', 'ifrs-full_BondsIssued', 'dart_NoncurrentBondsIssued'], l: ['사채', '회사채', '비유동사채'] },
  bondsDisc: { c: ['dart_DiscountOnBondsIssued', 'dart_DiscountOnBondsPayable'], l: ['사채할인발행차금', '사채현재가치할인차금', '사채의할인발행차금'] },
  longLease: { c: ['ifrs-full_NoncurrentLeaseLiabilities', 'dart_NoncurrentLeaseLiabilities'], l: ['비유동리스부채', '장기리스부채', '리스부채(비유동)'] },
  totalLease: { c: ['ifrs-full_LeaseLiabilities'], l: ['총리스부채', '리스부채합계'] },
};
const DISC_FLEX_RE = {
  currentLongDisc: {
    ko: /(유동성장기(차입|부채)|유동성차입|유동성비유동차입).*(할인차금|할인발행차금|현재가치할인)|(할인차금|할인발행차금|현재가치할인).*유동성장기/,
    en: /(CurrentPortion.*(LongTerm|Longterm|Noncurrent)?.*(Borrow|Debt|Liabilit|Loan).*Discount|(?:PresentValue)?Discount.*(CurrentPortion|CurrentLong).*(Borrow|Debt|Liabilit|Loan)?|CurrentPortion.*PresentValueDiscount|(?:Borrow|Debt|Loan).*Discount.*Current)/i,
  },
  currentBondsDisc: {
    ko: /유동성(사채|회사채).*(할인발행차금|할인차금|현재가치할인)|(할인발행차금|할인차금|현재가치할인).*유동성(사채|회사채)/,
    en: /(CurrentPortion.*(Bond|Debenture).*Discount|Discount.*(CurrentPortion.*(Bond|Debenture)|(Bond|Debenture).*CurrentPortion)|(Bond|Debenture).*Discount.*Current)/i,
  },
};
const ANY_DISC_KO_RE = /(현재가치할인차금|할인발행차금|할인차금|현재가치할인|사채할인)/;
const ANY_DISC_EN_RE = /(PresentValueDiscount|Discount(?:s)?(?:On|Of|For|Current|Long|Bond|Debenture|Borrow|Debt)|IssuanceDiscount|Unamorti[sz]edDiscount|(?:Bond|Debenture|Borrow|Debt|LongTerm|CurrentPortion).*Discount)/i;
const DISC_CONTRA_BAD_MEM_RE = /(AccumulatedDepreciation|AccumulatedAmortisation|AccumulatedImpairment|LossAllowance|AllowanceFor|Impairment|FairValue|Revaluation)/i;
const DISC_CONTRA_BAD_KO_RE = /(감가상각누계|상각누계|손상차손누계|대손충당금|손실충당금|공정가치|재평가)/;
const BORROW_MAIN_KEYS = ['shortBorrow', 'currentLongBorrow', 'currentBonds', 'currentLease', 'longBorrow', 'bonds', 'longLease'];

const SEG_REV = { c: ['ifrs-full_Revenue', 'ifrs-full_RevenueFromContractsWithCustomers'], l: ['매출액', '수익(매출액)', '영업수익', '부문수익', '부문매출액'] };
const SEG_OP = { c: ['dart_OperatingIncomeLoss', 'ifrs-full_ProfitLossFromOperatingActivities'], l: ['영업이익', '영업이익(손실)', '영업손익', '부문손익', '부문영업이익'] };
const CONSOL_AXIS = 'ifrs-full_ConsolidatedAndSeparateFinancialStatementsAxis';

/* FSS DART '공시금액' / '장부금액' 중립 축·차원 판별
 * 핵심: FSS DART XBRL에서 '공시금액 [구성요소]'는 CarryingAmount...Axis 위 표준 dart:*Member로 기재되나
 *       회사 ZIP의 lab-ko.xml에는 표준 dart:* 라벨이 포함되지 않으므로 축(Axis) 기준으로 중립 판별한다. */
const CARRYING_AXIS_RE = /(CarryingAmountAccumulatedDepreciation|CarryingAmount.*Axis|MeasurementBasisAxis|ValuationBasisAxis|AmountTypeAxis|NoteAmountAxis)/i;
/* 주의: AmortisedCostMember(상각후원가)가 CostMember에 오탐되지 않도록 Historical/Acquisition/단독 CostMember만 제외 */
const CONTRA_CARRYING_MEM_RE = /(GrossCarryingAmount|AccumulatedDepreciation|AccumulatedAmortisation|AccumulatedImpairment|LossAllowance|AllowanceFor|Impairment|(?:^|_)(?:Historical|Acquisition)?CostMember$|FairValue|Revaluation|AcquisitionCost)/i;
const CONTRA_CARRYING_DEP_MEM_RE = /(GrossCarryingAmount|LossAllowance|AllowanceFor|(?:^|_)(?:Historical|Acquisition)?CostMember$|FairValue|Revaluation|AcquisitionCost)/i;
const CONTRA_CARRYING_KO_RE = /(취득원가|총장부금액|감가상각누계|상각누계|손상차손누계|대손충당금|손실충당금|공정가치|재평가)/;
const CONTRA_CARRYING_DEP_KO_RE = /(취득원가|총장부금액|대손충당금|손실충당금|공정가치|재평가)/;

const NEUTRAL_MEMBER_RE = /^(ifrs-full|dart)_(Total)?(PropertyPlantAndEquipment|IntangibleAssetsOtherThanGoodwill|InvestmentProperty|RightofuseAssets|CarryingAmount|BookValue|DisclosedAmount|DisclosureAmount|ReportedAmount|PresentationAmount|NoteAmount|AccumulatedDepreciationAndAmortisation|AccumulatedDepreciationAmortisationAndImpairment|Total|FinancialLiabilities|FinancialAssets|Borrowings|LeaseLiabilities)Member$/;
const NEUTRAL_ANY_PREFIX_RE = /(DisclosedAmount|DisclosureAmount|ReportedAmount|PresentationAmount|NoteAmount|CarryingAmount|BookValue)Member$/i;
const NEUTRAL_LABEL_SET = new Set(['장부금액', '공시금액', '합계', '계', '총계', '장부금액합계', '기말장부금액', '공시금액합계']);
const BORROW_SCOPE_MEM_RE = /(CurrentMember|NoncurrentMember|ShortTermFinancialLiabilities|LongTermFinancialLiabilities|CurrentFinancialLiabilities|NoncurrentFinancialLiabilities|AmortisedCost|AmortizedCost)Member$/i;
const BORROW_SCOPE_KO = new Set(['유동', '비유동', '단기금융부채', '장기금융부채', '유동금융부채', '비유동금융부채', '단기금융부채내역', '장기금융부채내역', '상각후원가', '상각후원가측정금융부채']);
const INTEREST_CAT_RE = /(FinanceIncome|FinanceCost|FinancialIncome|FinancialCost)/i;
const INTEREST_CAT_KO = new Set(['금융수익', '금융원가', '금융비용', '금융수익및금융비용', '금융수익과금융비용']);

const GENERIC_MEASURE_RE = /(DisclosedAmount|DisclosureAmount|ReportedAmount|CarryingAmount|FinancialLiabilit(y|ies)|Borrowings|LeaseLiabilit(y|ies)|FinanceCosts|FinanceIncome|Interest|Adjustments|Amount|Balance|Details?|Breakdown|Note|AmortisedCost|AmortizedCost)$/i;
const NON_MONEY_MEASURE_RE = /(Rate|Ratio|Percent|Maturity|Date|Period|Number|Count|Shares|Quantity|FairValue|Notional|Nominal|Collateral|Guarantee|Limit|Text|Description|Name|Currency)$/i;
const NON_MONEY_MEASURE_KO_RE = /(이자율|금리|비율|만기|수량|주식수|공정가치|약정|한도|통화|명칭)/;
const NON_CASH_CTX_RE = /(NonCash|Noncash|SignificantNonCash|CashFlowSupplemental|비현금)/i;
const NON_CASH_FACT_KO_RE = /^(차입금의|사채의)유동성대체$/;
const GENERIC_MEASURE_KO = new Set(['공시금액', '장부금액', '금액', '당기금액', '기말금액', '조정항목', '단기금융부채', '장기금융부채', '유동금융부채', '비유동금융부채', '단기금융부채내역', '장기금융부채내역', '금융부채', '리스부채', '금융수익', '금융원가', '금융비용']);
const NON_SEGMENT = /(Total|Elimination|Adjustment|Reconcil|Consolidat|Unallocated|InterSegment|^ifrs-full_(OperatingSegments|ReportableSegments|AllOtherSegments)Member$)/i;
const NON_SEGMENT_KO = /(합계|총계|소계|조정|제거|내부거래|연결|미배분|공통)/;

const cleanKo = (s) => String(s || '').replace(/\[[^\]]*\]/g, '').replace(/[\s·ㆍ:：\-]/g, '');
const qEnd = (y, q) => `${y}-${['', '03-31', '06-30', '09-30', '12-31'][q]}`;
const qStart = (y, q) => `${y}-${['', '01-01', '04-01', '07-01', '10-01'][q]}`;

export function parseXbrlFiles(files, { y, q, fs = 'CFS', ofsOnly = false, zipFiles = null }) {
  let labels = {};
  const allLabels = {}; // concept → Set<string> (표준·terse·negated·verbose 라벨 전부)
  const negatedConcepts = new Set();
  const names = Object.keys(files);
  const mergeLab = (n) => {
    const r = parseLabelsFull(decodeText(files[n]));
    labels = { ...labels, ...r.std };
    for (const c of r.negated || []) { negatedConcepts.add(c); negatedConcepts.add(localOf(c)); }
    for (const [k, s] of Object.entries(r.all)) {
      const dst = allLabels[k] || (allLabels[k] = new Set());
      for (const t of s) dst.add(t);
    }
  };
  // 표준 라벨 먼저, 회사(entity*) 라벨을 나중에 병합해 회사 공시 한글명이 우선되도록 정렬
  const labFiles = names.filter((n) => /lab.*\.xml$/i.test(n) && !/(?:^|[_-])en\.xml$/i.test(n))
    .sort((a, b) => (/entity/i.test(a) ? 1 : 0) - (/entity/i.test(b) ? 1 : 0));
  for (const n of labFiles) mergeLab(n);
  const preSiblings = [];
  for (const n of names) if (/_pre\.xml$/i.test(n)) preSiblings.push(...parsePresentation(decodeText(files[n])));
  const calGroups = [];
  for (const n of names) if (/_cal\.xml$/i.test(n)) calGroups.push(...parseCalculation(decodeText(files[n])));
  // 접두사 불일치(예: .xbrl의 ns0:Foo vs lab-ko.xml의 entity00120030_Foo) 방어용 로컬명 보조 색인
  const localLabels = {};
  for (const [k, s] of Object.entries(allLabels)) {
    const loc = localOf(k);
    if (!loc) continue;
    const dst = localLabels[loc] || (localLabels[loc] = new Set());
    for (const t of s) dst.add(t);
  }
  const instTexts = [];
  const instNames = names.filter((n) => {
    if (/\.xbrl$/i.test(n)) return true;
    if (/\.xml$/i.test(n) && !/(?:lab|_pre|_cal|_def)\b/i.test(n)) {
      const head = decodeText(files[n].subarray(0, Math.min(800, files[n].length)));
      return /<(?:[\w-]+:)?xbrl\b/i.test(head);
    }
    return false;
  });
  if (!instNames.length) throw new ApiError('XBRL_NO_INSTANCE', 'XBRL 인스턴스 파일이 없습니다.');
  const contexts = {};
  const facts = [];
  const textBlocks = [];
  let unicodeFacts = 0;
  let parseEngine = 'regex';
  for (const n of instNames) {
    const xmlStr = decodeText(files[n]);
    instTexts.push({ name: n, xml: xmlStr });
    const parsed = parseInstance(xmlStr);
    parseEngine = parsed.engine || parseEngine;
    const pref = instNames.length > 1 ? `${n}#` : '';
    unicodeFacts += parsed.unicodeFacts || 0;
    for (const [id, ctx] of Object.entries(parsed.contexts)) contexts[pref + id] = ctx;
    for (const f of parsed.facts) facts.push({ ...f, ctx: pref + f.ctx });
    for (const tb of parsed.textBlocks || []) textBlocks.push({ ...tb, ctx: pref + tb.ctx });
  }
  // ZIP 내 별도 HTML/XHTML 파일이 있으면 표 폴백 후보로 편입
  for (const n of names) {
    if (/\.(?:xhtml|html?)$/i.test(n)) {
      const htmlStr = decodeText(files[n]);
      if (/<table/i.test(htmlStr)) textBlocks.push({ c: `html_${n}`, ctx: '', html: htmlStr });
    }
  }
  if (fs === 'OFS' && !Object.values(contexts).some((c) => c.dims.some((d) => /SeparateMember$/.test(d.member)))) ofsOnly = true;

  const periods = {
    ytd: [qStart(y, 1), qEnd(y, q)], single: [qStart(y, q), qEnd(y, q)],
    priorYtd: [qStart(y - 1, 1), qEnd(y - 1, q)], priorSingle: [qStart(y - 1, q), qEnd(y - 1, q)],
  };
  const kindOf = (ctx) => {
    if (!ctx.start || !ctx.end) return null;
    const out = [];
    for (const [k, [s, e]] of Object.entries(periods)) if (ctx.start === s && ctx.end === e) out.push(k);
    return out.length ? out : null;
  };
  const fsOk = (ctx) => {
    const m = (ctx.dims.find((d) => d.axis === CONSOL_AXIS) || {}).member || '';
    if (fs === 'OFS') return /SeparateMember$/.test(m) || (ofsOnly && !m);
    return /ConsolidatedMember$/.test(m) || (!m && !ofsOnly);
  };
  const extraDims = (ctx) => ctx.dims.filter((d) => d.axis !== CONSOL_AXIS);
  const labelOf = (c) => {
    if (labels[c]) return cleanKo(labels[c]);
    const loc = localOf(c);
    const ls = localLabels[loc];
    if (ls) return cleanKo([...ls][0]);
    return /[가-힣]/.test(loc) ? cleanKo(loc) : '';
  };
  const allCleanLabels = (c) => {
    const loc = localOf(c);
    const s = allLabels[c] || localLabels[loc];
    const out = s ? [...s].map(cleanKo) : (labels[c] ? [cleanKo(labels[c])] : []);
    if (/[가-힣]/.test(loc)) {
      const lc = cleanKo(loc);
      if (lc && !out.includes(lc)) out.push(lc);
    }
    return out;
  };
  const labelIndex = (c, list) => {
    const std = labelOf(c);
    const si = list.indexOf(std);
    if (si >= 0) return si;
    for (const t of allCleanLabels(c)) {
      const i = list.indexOf(t);
      if (i >= 0) return i + 0.5;
    }
    return -1;
  };

  /** 중립 차원 판별 (FSS DART CarryingAmount...Axis 공시금액·장부금액, 상각비 변동표 누계열, 차입금 표 범위 차원 허용) */
  const isNeutralDim = (d, { extraInterestCat = false, allowAccumDep = false, allowBorrowScope = false } = {}) => {
    const mLbls = allCleanLabels(d.member);
    if (CARRYING_AXIS_RE.test(d.axis)) {
      const memRe = allowAccumDep ? CONTRA_CARRYING_DEP_MEM_RE : CONTRA_CARRYING_MEM_RE;
      const koRe = allowAccumDep ? CONTRA_CARRYING_DEP_KO_RE : CONTRA_CARRYING_KO_RE;
      if (memRe.test(d.member)) return false;
      if (mLbls.some((t) => koRe.test(t))) return false;
      return true;
    }
    if (NEUTRAL_MEMBER_RE.test(d.member) || NEUTRAL_ANY_PREFIX_RE.test(d.member)) return true;
    if (mLbls.some((t) => NEUTRAL_LABEL_SET.has(t))) return true;
    if (extraInterestCat && (INTEREST_CAT_RE.test(d.member) || mLbls.some((t) => INTEREST_CAT_KO.has(t)))) return true;
    if (allowBorrowScope && (BORROW_SCOPE_MEM_RE.test(d.member) || mLbls.some((t) => BORROW_SCOPE_KO.has(t)))) return true;
    return false;
  };
  const isGenericMeasure = (c) => GENERIC_MEASURE_RE.test(localOf(c)) || allCleanLabels(c).some((t) => GENERIC_MEASURE_KO.has(t));
  const isMoneyMeasure = (c) => !NON_MONEY_MEASURE_RE.test(localOf(c)) && !allCleanLabels(c).some((t) => NON_MONEY_MEASURE_KO_RE.test(t));
  const allCleanLabelsWithTyped = (m) => {
    if (m && m.startsWith('typed_')) return [cleanKo(m.slice(6))];
    return allCleanLabels(m);
  };

  const isNonCashCtx = (ctx) => NON_CASH_CTX_RE.test(ctx.id) || ctx.dims.some((d) =>
    NON_CASH_CTX_RE.test(d.axis) || NON_CASH_CTX_RE.test(d.member) || allCleanLabels(d.member).some((t) => /비현금/.test(t)));
  const isNonCashFact = (f) => NON_CASH_CTX_RE.test(f.c) || allCleanLabels(f.c).some((t) => NON_CASH_FACT_KO_RE.test(t));
  /* 괄호 주석('(사채 포함)' 등)을 제거한 순수 라벨이 실제로 사채와 결합된 계정(예: 유동성장기차입금및사채)인지 판별 */
  const isCombinedWithBonds = (label) => {
    const s = cleanKo(String(label || '').replace(/\([^)]*\)/g, ''));
    return /(및|과|와).*사채|사채.*(및|과|와)/.test(s);
  };

  /**
   * 팩트 후보 수집기(이중 매칭):
   *  - tier 0: 개별 개념(f.c) 매칭, 비중립 차원 없음(금융수익/원가 보조 차원 미사용)
   *  - tier 1: 개별 개념(f.c) 매칭, 금융수익/원가 보조 차원 사용(extraInterestCat)
   *  - tier 2: 범용 측정 개념 + 단일 비중립 차원 멤버 라벨 정확 일치 (방식 B)
   */
  function collectFacts(def, matchCtx, { allowNeutral = true, keepSign = false, extraInterestCat = false, allowAccumDep = false, allowBorrowScope = false, allowAnyMoneyMeasure = false, excludeNonCash = false, requireCtx = null, sameTableOf = null } = {}) {
    const out = [];
    for (const f of facts) {
      if (requireCtx && f.ctx !== requireCtx) continue;
      const ctx = contexts[f.ctx];
      if (!matchCtx(ctx) || !fsOk(ctx)) continue;
      if (excludeNonCash && (isNonCashCtx(ctx) || isNonCashFact(f))) continue;
      const ex = extraDims(ctx);
      const nonNeutralBase = ex.filter((d) => !isNeutralDim(d, { extraInterestCat: false, allowAccumDep, allowBorrowScope }));
      const nonNeutral = extraInterestCat ? ex.filter((d) => !isNeutralDim(d, { extraInterestCat: true, allowAccumDep, allowBorrowScope })) : nonNeutralBase;
      const usedIntCat = extraInterestCat && nonNeutralBase.length > 0 && nonNeutral.length === 0;

      // 방식 A: 개별 개념 매칭
      const ci = def.c.indexOf(f.c);
      const li = ci < 0 ? labelIndex(f.c, def.l) : -1;
      if ((ci >= 0 || li >= 0) && (!ex.length || (allowNeutral && nonNeutral.length === 0))) {
        if (sameTableOf && sameTableOf.mode === 'A' && f.ctx !== sameTableOf.ctx) continue;
        const tier = usedIntCat ? 1 : 0;
        const rank = tier * 1000 + (ci >= 0 ? ci : 50 + li) * 10 + ex.length;
        const lbl = labels[f.c] || localOf(f.c);
        out.push({
          tier, rank, value: keepSign ? f.v : Math.abs(f.v), concept: f.c, label: lbl,
          ctx: f.ctx, mode: 'A', baseC: f.c, axis: null, exactBsLabel: labelIndex(f.c, def.l) >= 0,
        });
        continue;
      }

      // 방식 B: 차원 멤버 표 매칭 (단일 비중립 멤버의 한글 라벨 정확 일치 + 금액 측정 개념)
      if (nonNeutral.length === 1 && (isGenericMeasure(f.c) || (allowAnyMoneyMeasure && isMoneyMeasure(f.c)))) {
        const mem = nonNeutral[0].member;
        const ax = nonNeutral[0].axis;
        if (sameTableOf && (sameTableOf.mode !== 'B' || sameTableOf.baseC !== f.c || sameTableOf.axis !== ax)) continue;
        let mi = labelIndex(mem, def.l);
        if (mi < 0 && mem.startsWith('typed_')) mi = def.l.indexOf(cleanKo(mem.slice(6)));
        if (mi >= 0) {
          const rank = 2000 + mi * 10 + ex.length + (isGenericMeasure(f.c) ? 0 : 200);
          out.push({
            tier: 2, rank, value: keepSign ? f.v : Math.abs(f.v), concept: `${f.c}[${mem}]`, label: mem.startsWith('typed_') ? mem.slice(6) : (labels[mem] || localOf(mem)),
            ctx: f.ctx, mode: 'B', baseC: f.c, axis: ax, exactBsLabel: true,
          });
        }
      }
    }
    return out;
  }

  function pickFact(def, matchCtx, opts = {}) {
    const cands = collectFacts(def, matchCtx, opts);
    if (!cands.length) return null;
    if (opts.preferLarger) {
      // 이자수익·이자비용: 최우선 티어(0: 순수 공시금액/무차원 → 1: 금융수익·원가 차원 → 2: 표 멤버) 중 가장 큰 총계 금액 선택
      const minTier = Math.min(...cands.map((x) => x.tier));
      const pool = cands.filter((x) => x.tier === minTier);
      pool.sort((a, b) => Math.abs(b.value) - Math.abs(a.value) || a.rank - b.rank);
      return pool[0];
    }
    cands.sort((a, b) => a.rank - b.rank);
    return cands[0];
  }

  const scalar = (def, kind, allowNeutral = true, opts = {}) =>
    pickFact(def, (ctx) => { const ks = kindOf(ctx); return !!(ks && ks.includes(kind)); }, { allowNeutral, keepSign: false, ...opts });

  const instantScalar = (def, dateStr, opts = {}) =>
    pickFact(def, (ctx) => ctx.instant === dateStr, { allowNeutral: true, ...opts });

  /** 주석 17·18 세부정보의 '차감 : 유동성대체' 추출(표준 ID + 회사 확장 개념 모두 지원) */
  function liquidityTransferOf(dateStr, baseDef) {
    for (const f of facts) {
      if (!baseDef.c.includes(f.c) && labelIndex(f.c, baseDef.l) < 0) continue;
      const ctx = contexts[f.ctx];
      if (ctx.instant !== dateStr || !fsOk(ctx) || isNonCashCtx(ctx)) continue;
      const ex = extraDims(ctx);
      if (!ex.length) continue;
      const hit = ex.some((d) => allCleanLabelsWithTyped(d.member).some((t) => {
        const s = t.replace(/[()]/g, '');
        return /^(차감)?유동성대체(액|분|금액)?$|^유동성대체차감$/.test(s);
      }));
      if (hit && Number.isFinite(f.v) && f.v !== 0) {
        return {
          value: Math.abs(f.v), concept: `${f.c}[유동성대체]`, label: '유동성대체(세부표)',
          ctx: f.ctx, mode: 'B', baseC: f.c, axis: ex[0].axis, isGrossTransfer: true,
        };
      }
    }
    return null;
  }

  /**
   * 유동성장기차입금·유동성사채 전용 할인차금 다단계 탐색:
   *  1) 동일 표/컨텍스트의 명시적 할인차금
   *  2) 금액 앵커(단기금융부채 내역 표 자동 특정): 동일 날짜에 원금(g.value)과 일치하는 팩트가 존재하는 주석 표를 찾아
   *     그 표 안의 pre.xml 직후 형제 또는 동일 표/컨텍스트 할인차금 행(단축 라벨 '현재가치할인차금'·'할인발행차금' 포함) 추출
   *  3) 동일 날짜 전체에서 전용 할인차금 개념·멤버 유연 탐색
   *  - 안전장치: 공정가치·비현금 제외, 할인차금 크기는 원금의 20% 미만만 허용
   */
  function findCurrentDiscount(dKey, dateStr, g, transfer) {
    const bOpts = { keepSign: true, excludeNonCash: true, allowBorrowScope: true, allowAnyMoneyMeasure: true };
    const validDisc = (x) => x && Math.abs(x.value) > 0 && Math.abs(x.value) < g.value * 0.2;
    const same = instantScalar(BORROW_NOTE[dKey], dateStr, { ...bOpts, sameTableOf: g });
    if (validDisc(same)) return same;
    // 유동성장기차입금·유동성사채가 이미 순액인지 방어(세부표 총액과 일치하거나 isGrossTransfer이거나 별도 표 전용 할인차금이 존재할 때만 차감)
    const likelyGross = g.isGrossTransfer || !transfer || Math.abs(g.value - transfer.value) <= transfer.value * 0.005;
    if (!likelyGross) return null;

    // 2단계: 금액 앵커 기반 주석 표(단기금융부채 내역 등) 내 할인차금 직접 추출
    // - contextRef ID 문자열이 달라도 차원 구성(dimSig)이 같으면 동일 표로 인식
    // - 멤버 표는 축 순서에 무관한 Map 비교 + _pre.xml 멤버 순서·_cal.xml 음수 가중치(weight=-1)·negatedLabel 모두 지원
    const isBonds = dKey === 'currentBondsDisc';
    const isContraBad = (ctx) => extraDims(ctx).some((d) => DISC_CONTRA_BAD_MEM_RE.test(d.member) || allCleanLabelsWithTyped(d.member).some((t) => DISC_CONTRA_BAD_KO_RE.test(t)));
    const dimSigOf = (ctx) => extraDims(ctx).map((d) => `${d.axis}=${d.member}`).sort().join('|');
    const dimMapOf = (ctx) => new Map(extraDims(ctx).map((d) => [d.axis, d.member]));
    const discTagMatch = (f, ctx) => {
      const cLbls = allCleanLabels(f.c);
      const ex = extraDims(ctx);
      const cHit = ANY_DISC_EN_RE.test(localOf(f.c)) || cLbls.some((t) => ANY_DISC_KO_RE.test(t));
      const mHit = !cHit && ex.find((d) => ANY_DISC_EN_RE.test(localOf(d.member)) || allCleanLabelsWithTyped(d.member).some((t) => ANY_DISC_KO_RE.test(t)));
      if (!cHit && !mHit) return null;
      const text = (cHit ? `${localOf(f.c)} ${cLbls.join(' ')}` : `${localOf(mHit.member)} ${allCleanLabelsWithTyped(mHit.member).join(' ')}`);
      const mentionsBond = /(사채|Bond|Debenture)/i.test(text);
      const mentionsBorrow = /(차입|장기|부채|Borrow|Debt|Loan)/i.test(text);
      if (isBonds && mentionsBorrow && !mentionsBond) return null;
      if (!isBonds && mentionsBond && !mentionsBorrow) return null;
      return {
        concept: cHit ? f.c : `${f.c}[${mHit.member}]`,
        label: cHit ? (labels[f.c] || localOf(f.c)) : (mHit.member.startsWith('typed_') ? mHit.member.slice(6) : (labels[mHit.member] || localOf(mHit.member))),
        specific: isBonds ? mentionsBond : mentionsBorrow,
      };
    };
    const nextInPre = (id) => {
      const nexts = new Set();
      if (!id) return nexts;
      const locId = localOf(id);
      for (const list of preSiblings) {
        const i = list.findIndex((x) => x === id || localOf(x) === locId);
        if (i >= 0) {
          if (list[i + 1]) { nexts.add(list[i + 1]); nexts.add(localOf(list[i + 1])); }
          if (list[i + 2]) { nexts.add(list[i + 2]); nexts.add(localOf(list[i + 2])); }
        }
      }
      return nexts;
    };
    const calNextContra = (concept) => {
      const negs = new Set();
      const locC = localOf(concept);
      for (const grp of calGroups) {
        const i = grp.findIndex((x) => x.c === concept || localOf(x.c) === locC);
        if (i >= 0) {
          for (const j of [i + 1, i + 2]) {
            if (grp[j] && grp[j].w < 0) { negs.add(grp[j].c); negs.add(localOf(grp[j].c)); }
          }
        }
      }
      return negs;
    };
    // 원금 g.value(양수, 0.2% 이내)와 일치하는 주석 표 앵커 팩트 탐색(instant 우선 + duration 기간말 폴백)
    const isDateMatch = (ctx) => ctx.instant === dateStr || (!ctx.instant && ctx.end === dateStr);
    const anchors = facts.filter((f) => {
      if (!Number.isFinite(f.v) || f.v <= 0) return false;
      if (Math.abs(f.v - g.value) > Math.max(1e6, g.value * 0.002)) return false;
      const ctx = contexts[f.ctx];
      return isDateMatch(ctx) && fsOk(ctx) && !isNonCashCtx(ctx) && !isContraBad(ctx);
    });
    let anchorBest = null;
    for (const anc of anchors) {
      const ancCtx = contexts[anc.ctx];
      const ancIsInstant = ancCtx.instant === dateStr;
      const ancSig = dimSigOf(ancCtx);
      const ancMap = dimMapOf(ancCtx);
      const preNextC = nextInPre(anc.c);
      const calNegC = calNextContra(anc.c);
      for (const f of facts) {
        if (f === anc || !Number.isFinite(f.v) || f.v === 0) continue;
        const absV = Math.abs(f.v);
        if (absV >= g.value * 0.2) continue;
        const ctx = contexts[f.ctx];
        const fSamePeriod = ancIsInstant ? ctx.instant === dateStr : (!ctx.instant && ctx.end === dateStr);
        if (!fSamePeriod || !fsOk(ctx) || isNonCashCtx(ctx) || isContraBad(ctx)) continue;
        if (!isMoneyMeasure(f.c)) continue;
        const sameDims = f.ctx === anc.ctx || dimSigOf(ctx) === ancSig;
        let sameMemberTable = false;
        let ancDiffMem = null;
        let fDiffMem = null;
        if (!sameDims && f.c === anc.c && ancMap.size >= 1) {
          const fMap = dimMapOf(ctx);
          if (fMap.size === ancMap.size) {
            let diffs = 0; let okAxes = true;
            for (const [ax, mem] of ancMap.entries()) {
              if (!fMap.has(ax)) { okAxes = false; break; }
              if (fMap.get(ax) !== mem) { diffs += 1; ancDiffMem = mem; fDiffMem = fMap.get(ax); }
            }
            if (okAxes && diffs === 1) sameMemberTable = true;
          }
        }
        if (!sameDims && !sameMemberTable) continue;
        const dm = discTagMatch(f, ctx);
        const isPreNextC = sameDims && (preNextC.has(f.c) || preNextC.has(localOf(f.c)));
        const isCalNeg = sameDims && (calNegC.has(f.c) || calNegC.has(localOf(f.c)));
        const isPreNextM = sameMemberTable && fDiffMem && (() => {
          const pn = nextInPre(ancDiffMem);
          return pn.has(fDiffMem) || pn.has(localOf(fDiffMem));
        })();
        const isNegRole = negatedConcepts.has(f.c) || negatedConcepts.has(localOf(f.c)) || (fDiffMem && (negatedConcepts.has(fDiffMem) || negatedConcepts.has(localOf(fDiffMem))));
        const isContraSign = f.v < 0 || isCalNeg || isNegRole;
        const isAdj = isPreNextC || isPreNextM || isCalNeg;
        if (!dm && !(isAdj && isContraSign)) continue;
        const rank = (ancIsInstant ? 0 : 60) + (isAdj ? 0 : 40) + (dm?.specific ? 0 : 20) + (isContraSign ? 0 : 10) + (sameDims ? 0 : 5);
        if (!anchorBest || rank < anchorBest.rank) {
          anchorBest = {
            rank, value: f.v,
            concept: dm ? dm.concept : (fDiffMem ? `${f.c}[${fDiffMem}]` : f.c),
            label: dm ? dm.label : (fDiffMem ? (labels[fDiffMem] || localOf(fDiffMem)) : (labels[f.c] || localOf(f.c))),
          };
        }
      }
    }
    if (anchorBest) return anchorBest;

    // 3단계: 동일 날짜 전체에서 명시적 사전 및 유연 정규식 탐색
    const any = instantScalar(BORROW_NOTE[dKey], dateStr, bOpts);
    if (validDisc(any)) return any;
    const flex = DISC_FLEX_RE[dKey];
    if (!flex) return null;
    let best = null;
    for (const f of facts) {
      if (!Number.isFinite(f.v) || f.v === 0) continue;
      const absV = Math.abs(f.v);
      if (absV >= g.value * 0.2) continue;
      const ctx = contexts[f.ctx];
      const isInst = ctx.instant === dateStr;
      const isDur = !ctx.instant && ctx.end === dateStr;
      if ((!isInst && !isDur) || !fsOk(ctx) || isNonCashCtx(ctx) || isContraBad(ctx)) continue;
      if (!isMoneyMeasure(f.c)) continue;
      const ex = extraDims(ctx);
      const cHit = flex.en.test(localOf(f.c)) || allCleanLabels(f.c).some((t) => flex.ko.test(t));
      const mHit = !cHit && ex.find((d) => flex.en.test(localOf(d.member)) || allCleanLabelsWithTyped(d.member).some((t) => flex.ko.test(t)));
      if (!cHit && !mHit) continue;
      const rank = (isInst ? 0 : 200) + (cHit ? 0 : 100) + ex.length * 10 + (f.v < 0 ? 0 : 5);
      if (!best || rank < best.rank) {
        best = {
          rank, value: f.v,
          concept: cHit ? f.c : `${f.c}[${mHit.member}]`,
          label: cHit ? (labels[f.c] || localOf(f.c)) : (mHit.member.startsWith('typed_') ? mHit.member.slice(6) : (labels[mHit.member] || localOf(mHit.member))),
        };
      }
    }
    if (best) return best;

    // 4단계 안전장치: XBRL 주석 HTML TextBlock 표에서 원금 앵커(g.value)로 표·단위·열을 특정해 할인차금 추출
    const parseHtmlNum = (raw) => {
      const s = String(raw || '').replace(/<[^>]+>/g, '').replace(/[\s,]/g, '').trim();
      if (!s || s === '-' || s === '—') return null;
      const neg = /^\(([^)]+)\)$/.test(s);
      const t = neg ? s.slice(1, -1) : s;
      if (!/^[+-]?\d+(?:\.\d+)?$/.test(t)) return null;
      const v = Number(t);
      return Number.isFinite(v) ? (neg ? -Math.abs(v) : v) : null;
    };
    for (const tb of textBlocks) {
      if (tb.ctx) {
        const tCtx = contexts[tb.ctx];
        if (!tCtx || !fsOk(tCtx)) continue;
        const tbEnd = tCtx.end || tCtx.instant;
        if (tbEnd && tbEnd !== dateStr) continue;
      }
      const tblRe = /<table\b[^>]*>([\s\S]*?)<\/table>/gi;
      let tm;
      while ((tm = tblRe.exec(tb.html)) !== null) {
        const tblHtml = tm[1];
        const rows = [];
        const trRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
        let rm;
        while ((rm = trRe.exec(tblHtml)) !== null) {
          const cells = [];
          const tdRe = /<(?:td|th)\b[^>]*>([\s\S]*?)<\/(?:td|th)>/gi;
          let cm;
          while ((cm = tdRe.exec(rm[1])) !== null) cells.push(cm[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
          if (cells.length >= 2) rows.push(cells);
        }
        if (rows.length < 2) continue;
        // 원금(g.value)과 일치하는 (행, 열, 단위배율) 앵커 탐색
        let anchorCol = -1; let scale = 0;
        for (const r of rows) {
          for (let ci = 1; ci < r.length; ci += 1) {
            const v = parseHtmlNum(r[ci]);
            if (v === null || v <= 0) continue;
            for (const sc of [1e6, 1e3, 1]) {
              if (Math.abs(v * sc - g.value) <= Math.max(sc, g.value * 0.002)) { anchorCol = ci; scale = sc; break; }
            }
            if (scale) break;
          }
          if (scale) break;
        }
        if (!scale) continue;
        // 동일 표·동일 열에서 할인차금 행 탐색
        const exactList = BORROW_NOTE[dKey].l;
        for (const r of rows) {
          const rowLbl = cleanKo(r[0]);
          const matched = exactList.includes(rowLbl) || flex.ko.test(rowLbl);
          if (!matched) continue;
          const dv = parseHtmlNum(r[anchorCol]);
          if (dv === null || dv === 0) continue;
          const valWon = dv * scale;
          if (Math.abs(valWon) > 0 && Math.abs(valWon) < g.value * 0.2) {
            return { value: valWon, concept: `${tb.c}[table]`, label: r[0] };
          }
        }
      }
    }
    return null;
  }

  /**
   * 유동성장기차입금·유동성사채 정밀 선택:
   *  - 비현금거래(주석 31 '차입금의 유동성 대체' 등) 오매칭을 차단하고
   *  - 주석 17 단기금융부채 내역(정확한 한글 라벨·할인차금 동반·세부표 '차감:유동성대체' 일치)을 최우선 선택
   */
  function pickCurrentMaturity(gKey, dKey, dateStr, transfer) {
    const def = BORROW_NOTE[gKey];
    const discDef = BORROW_NOTE[dKey];
    const bOpts = { allowNeutral: true, excludeNonCash: true, allowBorrowScope: true, allowAnyMoneyMeasure: true };
    const cands = collectFacts(def, (ctx) => ctx.instant === dateStr, bOpts);
    if (cands.length) {
      const scored = cands.map((cand) => {
        const hasDisc = !!instantScalar(discDef, dateStr, { keepSign: true, sameTableOf: cand, excludeNonCash: true, allowBorrowScope: true, allowAnyMoneyMeasure: true });
        const matchesTr = !!(transfer && transfer.value > 0 && Math.abs(cand.value - transfer.value) <= transfer.value * 0.02);
        const score = cand.rank - (matchesTr ? 2500 : 0) - (hasDisc ? 1500 : 0) - (cand.exactBsLabel ? 800 : 0);
        return { cand, hasDisc, matchesTr, score };
      });
      scored.sort((a, b) => a.score - b.score);
      const top = scored[0];
      // 세부표 '차감:유동성대체'(총액)가 존재하는데, 후보가 BS 전용 라벨·할인차금·유동성대체 일치 중 어느 것도 없으면 비현금거래 오매칭으로 판단해 세부표 우선
      if (transfer && !top.matchesTr && !top.hasDisc && !top.cand.exactBsLabel) {
        return transfer;
      }
      return top.cand;
    }
    return transfer || null;
  }

  /** 차입금 7종 + 할인차금 4종 순장부금액 계산 (동일 표/컨텍스트 할인차금 우선 차감, 유동성 대체 총액은 전용 할인차금 유연 매칭) */
  function buildBorrowSnapshot(dateStr) {
    const bOpts = { excludeNonCash: true, allowBorrowScope: true, allowAnyMoneyMeasure: true };
    const ltTransfer = liquidityTransferOf(dateStr, BORROW_NOTE.longBorrow);
    const bdTransfer = liquidityTransferOf(dateStr, BORROW_NOTE.bonds);
    const main = {
      shortBorrow: instantScalar(BORROW_NOTE.shortBorrow, dateStr, bOpts),
      currentLongBorrow: pickCurrentMaturity('currentLongBorrow', 'currentLongDisc', dateStr, ltTransfer),
      currentBonds: pickCurrentMaturity('currentBonds', 'currentBondsDisc', dateStr, bdTransfer),
      currentLease: instantScalar(BORROW_NOTE.currentLease, dateStr, bOpts),
      longBorrow: instantScalar(BORROW_NOTE.longBorrow, dateStr, bOpts),
      bonds: instantScalar(BORROW_NOTE.bonds, dateStr, bOpts),
      longLease: instantScalar(BORROW_NOTE.longLease, dateStr, bOpts),
    };

    // 실제로 사채와 결합된 계정명(예: 유동성장기차입금및사채)일 때만 유동성사채 중복 합산 방지 — '(사채 포함)' 괄호 주석은 제외
    if (main.currentLongBorrow && isCombinedWithBonds(main.currentLongBorrow.label) && main.currentBonds) {
      main.currentBonds = null;
    }

    // 보조: 유동·비유동 리스부채가 모두 미분리이면 총리스부채(ifrs-full_LeaseLiabilities)로 대체 반영
    let totalLeaseFallback = null;
    if (!main.currentLease && !main.longLease) {
      totalLeaseFallback = instantScalar(BORROW_NOTE.totalLease, dateStr, bOpts);
    }

    const foundKeys = BORROW_MAIN_KEYS.filter((k) => main[k] !== null);
    if (!foundKeys.length && !totalLeaseFallback) return null;

    // 할인차금 차감: 장기차입금·사채는 동일 표만(이중차감 원천 차단), 유동성장기차입금·유동성사채는 전용 유연 탐색 적용
    const netPair = (gKey, dKey, tr = null) => {
      const g = main[gKey];
      if (!g) return null;
      const d = (gKey === 'currentLongBorrow' || gKey === 'currentBonds')
        ? findCurrentDiscount(dKey, dateStr, g, tr)
        : instantScalar(BORROW_NOTE[dKey], dateStr, { keepSign: true, sameTableOf: g, excludeNonCash: true, allowBorrowScope: true, allowAnyMoneyMeasure: true });
      const disc = d ? Math.abs(d.value) : 0;
      const val = disc > 0 && g.value >= disc ? g.value - disc : g.value;
      return { gross: g.value, disc, net: val, concept: g.concept, label: g.label, discLabel: d ? d.label : null };
    };
    const simple = (g) => (g ? { gross: g.value, disc: 0, net: g.value, concept: g.concept, label: g.label, discLabel: null } : null);

    const items = {
      shortBorrow: simple(main.shortBorrow),
      currentLongBorrow: netPair('currentLongBorrow', 'currentLongDisc', ltTransfer),
      currentBonds: netPair('currentBonds', 'currentBondsDisc', bdTransfer),
      currentLease: simple(main.currentLease),
      longBorrow: netPair('longBorrow', 'longBorrowDisc'),
      bonds: netPair('bonds', 'bondsDisc'),
      longLease: simple(main.longLease || totalLeaseFallback),
    };
    const nv = (k) => (items[k] ? items[k].net : 0);
    const currentTotal = nv('shortBorrow') + nv('currentLongBorrow') + nv('currentBonds') + nv('currentLease');
    const nonCurrentTotal = nv('longBorrow') + nv('bonds') + nv('longLease');
    const total = currentTotal + nonCurrentTotal;
    // 유동성장기부채·유동성사채 중 하나라도 추출됐을 때만 단기상환부담액 산출(미탐지 시 0 오표기 방지 → null)
    const hasShortRepay = !!(items.currentLongBorrow || items.currentBonds);
    const shortRepay = hasShortRepay ? nv('currentLongBorrow') + nv('currentBonds') : null;
    const totalDiscount = ['currentLongBorrow', 'currentBonds', 'longBorrow', 'bonds'].reduce((s, k) => s + (items[k]?.disc || 0), 0);
    // 개발·검증용 XBRL 차입금/할인차금 진단 트레이스(개별 은행 BorrowingsByNameAxis 행 제외 → 할인차금·원금앵커·요약 우선 표시)
    const diagCands = [];
    const seenDiag = new Set();
    const clbGross = items.currentLongBorrow?.gross || 0;
    const cbGross = items.currentBonds?.gross || 0;
    const BANK_AXIS_RE = /(ByName|Counterpart|Lender|Creditor|FinancialInstitution|IndividualBorrowing|ByEntity)/i;
    const pushDiag = (f, ctx, prio) => {
      const ex = extraDims(ctx);
      const lbl = labels[f.c] || (localLabels[localOf(f.c)] ? [...localLabels[localOf(f.c)]][0] : '');
      const mTxts = ex.map((d) => `${localOf(d.axis)}=${labels[d.member] || localOf(d.member)}`);
      const sig = `${f.c}|${f.v}|${mTxts.join(',')}`;
      if (seenDiag.has(sig)) return;
      seenDiag.add(sig);
      diagCands.push({ prio, c: localOf(f.c), lbl: lbl || localOf(f.c), v: Math.round(f.v / 1e6), dims: mTxts.slice(0, 3) });
    };
    for (const f of facts) {
      if (!Number.isFinite(f.v) || f.v === 0) continue;
      const ctx = contexts[f.ctx];
      const dateHit = ctx.instant === dateStr || (!ctx.instant && ctx.end === dateStr);
      if (!dateHit || !fsOk(ctx)) continue;
      const ex = extraDims(ctx);
      const isBankRow = ex.some((d) => BANK_AXIS_RE.test(d.axis));
      const cAll = allCleanLabels(f.c).join(' ');
      const allTxt = `${localOf(f.c)} ${cAll} ${ex.map((d) => `${localOf(d.axis)} ${localOf(d.member)} ${allCleanLabelsWithTyped(d.member).join(' ')}`).join(' ')}`;
      if (/(할인|Discount)/i.test(allTxt)) { pushDiag(f, ctx, 0); continue; }
      const nearAnchor = (clbGross > 0 && Math.abs(Math.abs(f.v) - clbGross) <= Math.max(1e6, clbGross * 0.005))
        || (cbGross > 0 && Math.abs(Math.abs(f.v) - cbGross) <= Math.max(1e6, cbGross * 0.005));
      if (nearAnchor) { pushDiag(f, ctx, 1); continue; }
      if (!isBankRow && /(유동성|단기금융부채|장기금융부채|CurrentPortion|ShortTermFinancial|LongTermFinancial)/i.test(allTxt)) {
        pushDiag(f, ctx, 2);
      }
    }
    diagCands.sort((a, b) => a.prio - b.prio || Math.abs(b.v) - Math.abs(a.v));
    const diag = diagCands.slice(0, 30).map(({ prio, ...rest }) => rest);

    // 할인차금이 0일 때만 원문 XML·전체 컨텍스트 포렌식 프로브 수행(누락 원인 1회 즉시 특정용)
    let probe = null;
    if ((items.currentLongBorrow && !items.currentLongBorrow.disc) || (items.currentBonds && !items.currentBonds.disc)) {
      const anyCtxHits = [];
      const seenAny = new Set();
      for (const f of facts) {
        if (!Number.isFinite(f.v) || f.v === 0) continue;
        const absV = Math.abs(f.v);
        let matched = false;
        for (const tgt of [clbGross, cbGross]) {
          if (!tgt) continue;
          for (const sc of [1, 1e3, 1e6]) {
            if (Math.abs(absV * sc - tgt) <= Math.max(1e6, tgt * 0.002)) { matched = true; break; }
          }
          if (matched) break;
        }
        if (!matched) continue;
        const ctx = contexts[f.ctx];
        const per = ctx.instant ? `I:${ctx.instant}` : `D:${ctx.start || ''}..${ctx.end || ''}`;
        const dims = ctx.dims.map((d) => `${localOf(d.axis)}=${labels[d.member] || localOf(d.member)}`).join(', ');
        const key = `${f.c}|${f.v}|${per}|${dims}`;
        if (seenAny.has(key)) continue;
        seenAny.add(key);
        anyCtxHits.push({ c: localOf(f.c), v: f.v, per, fsOk: fsOk(ctx), dims: dims.slice(0, 120) });
        if (anyCtxHits.length >= 12) break;
      }
      // 원문 XML에서 유동성장기차입금 원금(백만 단위 숫자) 출현 위치 직접 스캔
      const rawHits = [];
      const needle = clbGross > 0 ? String(Math.round(clbGross / 1e6)) : '';
      if (needle.length >= 5) {
        for (const { name, xml } of instTexts) {
          let pos = 0;
          while (rawHits.length < 8) {
            const at = xml.indexOf(needle, pos);
            if (at < 0) break;
            rawHits.push(`${name}: ${xml.slice(Math.max(0, at - 65), Math.min(xml.length, at + 55)).replace(/\s+/g, ' ')}`);
            pos = at + needle.length;
          }
        }
      }
      // 라벨 XML에서 '할인차금' 또는 '할인발행' 포함 개념명 스캔
      const discLabels = [];
      for (const [k, s] of Object.entries(allLabels)) {
        const hit = [...s].find((t) => /할인차금|할인발행/.test(t));
        if (hit) {
          discLabels.push(`${localOf(k)}=${hit}`);
          if (discLabels.length >= 12) break;
        }
      }
      probe = { anyCtxHits, rawHits, discLabels };
    }
    return {
      date: dateStr, items, currentTotal, nonCurrentTotal, total, shortRepay, totalDiscount,
      count: foundKeys.length + (totalLeaseFallback ? 1 : 0), diag,
      meta: { totalFacts: facts.length, unicodeFacts, textBlocks: textBlocks.length, labFiles: labFiles.length, engine: parseEngine, zipFiles: (zipFiles || names).slice(0, 15) },
      probe,
    };
  }

  const kinds = ['ytd', 'single', 'priorYtd', 'priorSingle'];
  const dep = {}; const interest = {};
  for (const k of kinds) {
    const d4 = Object.fromEntries(Object.entries(DEP).map(([n, d]) => [n, scalar(d, k, true, { allowAccumDep: true })]));
    // 유형자산 전용 감가상각비가 없을 때만 범용 '감가상각비' 폴백 (투자부동산·사용권자산 상각비 중복 합산 차감)
    if (!d4.ppe) {
      const gen = scalar(DEP_PPE_GENERIC, k, true, { allowAccumDep: true });
      if (gen) {
        const otherDep = (d4.invProp?.value || 0) + (d4.rou?.value || 0);
        d4.ppe = otherDep > 0 && gen.value > otherDep
          ? { ...gen, value: gen.value - otherDep, label: `${gen.label}(유형자산 환산)` }
          : gen;
      }
    }
    // 4종이 하나도 안 잡힌 회사에 한해 통합 상각비(감가상각비및상각비) 보조 추출
    if (!Object.values(d4).some(Boolean)) {
      const comb = scalar(DEP_COMBINED, k, true, { allowAccumDep: true });
      if (comb) d4.ppe = comb;
    }
    dep[k] = d4;
    interest[k] = Object.fromEntries(Object.entries(INTEREST).map(([n, d]) => [n, scalar(d, k, true, { extraInterestCat: true, preferLarger: true })]));
  }
  const borrow = {
    end: buildBorrowSnapshot(qEnd(y, q)),
    prev: buildBorrowSnapshot(qEnd(y - 1, 4)),
  };

  /* 영업부문: 부문 축(SegmentsAxis) 단일 차원 팩트 */
  const segs = new Map();
  let revConcept = null; let opConcept = null;
  const pickRank = (def, c) => { const ci = def.c.indexOf(c); if (ci >= 0) return ci; const li = labelIndex(c, def.l); return li >= 0 && !/^(ifrs-full|ifrs)_/.test(c) ? 50 + li : -1; };
  for (const f of facts) {
    const ctx = contexts[f.ctx];
    const ks = kindOf(ctx);
    if (!ks || !fsOk(ctx)) continue;
    const ex = extraDims(ctx).filter((d) => !isNeutralDim(d));
    if (ex.length !== 1 || !/Segment/i.test(ex[0].axis)) continue;
    const mem = ex[0].member;
    const memKo = labels[mem] || localOf(mem).replace(/Member$/, '');
    if (NON_SEGMENT.test(mem) || NON_SEGMENT_KO.test(cleanKo(memKo))) continue;
    const rr = pickRank(SEG_REV, f.c); const orr = pickRank(SEG_OP, f.c);
    if (rr < 0 && orr < 0) continue;
    const s = segs.get(mem) || { id: mem, name: memKo, rev: {}, op: {}, rr: {}, or: {} };
    for (const k of ks) {
      if (rr >= 0 && (s.rr[k] === undefined || rr < s.rr[k])) { s.rev[k] = f.v; s.rr[k] = rr; if (k === 'ytd') revConcept = revConcept && pickRank(SEG_REV, revConcept) <= rr ? revConcept : f.c; }
      if (orr >= 0 && (s.or[k] === undefined || orr < s.or[k])) { s.op[k] = f.v; s.or[k] = orr; if (k === 'ytd') opConcept = opConcept && pickRank(SEG_OP, opConcept) <= orr ? opConcept : f.c; }
    }
    segs.set(mem, s);
  }
  const segments = [...segs.values()].map(({ rr, or, ...s }) => s).sort((a, b) => (b.rev.ytd ?? -Infinity) - (a.rev.ytd ?? -Infinity));
  const total = {};
  for (const k of kinds) total[k] = { rev: scalar(SEG_REV, k, false)?.value ?? null, op: null };
  for (const k of kinds) {
    const o = scalar(SEG_OP, k, false);
    total[k].op = o ? o.value : null;
  }
  for (const k of kinds) {
    for (const f of facts) {
      const ctx = contexts[f.ctx]; const ks = kindOf(ctx);
      if (!ks || !ks.includes(k) || !fsOk(ctx) || extraDims(ctx).length) continue;
      if (SEG_OP.c.includes(f.c)) { total[k].op = f.v; break; }
    }
  }

  return {
    v: PARSER_VERSION, y, q, fs,
    dep, interest, borrow, segments, total,
    concepts: { segRev: revConcept ? (labels[revConcept] || localOf(revConcept)) : null, segOp: opConcept ? (labels[opConcept] || localOf(opConcept)) : null },
    stats: { files: names.length, facts: facts.length, unicodeFacts, textBlocks: textBlocks.length, contexts: Object.keys(contexts).length, labels: Object.keys(labels).length },
  };
}

export function depTotal(d) {
  if (!d) return null;
  const vals = ['ppe', 'intangible', 'invProp', 'rou'].map((k) => d[k]?.value).filter((v) => Number.isFinite(v));
  return vals.length ? vals.reduce((a, b) => a + b, 0) : null;
}

export function basisValue(cur, prev, pick, basis) {
  const v = (s, k) => { const x = pick(s?.[k] ?? null); return Number.isFinite(x) ? x : null; };
  if (basis === 'ytd' || cur?.q === 1) return { value: v(cur, 'ytd'), prior: v(cur, 'priorYtd'), derived: false };
  const direct = v(cur, 'single');
  if (direct !== null) return { value: direct, prior: v(cur, 'priorSingle'), derived: false };
  const a = v(cur, 'ytd'); const b = prev ? v(prev, 'ytd') : null;
  const pa = v(cur, 'priorYtd'); const pb = prev ? v(prev, 'priorYtd') : null;
  return { value: a !== null && b !== null ? a - b : null, prior: pa !== null && pb !== null ? pa - pb : null, derived: true };
}

/* ============================================================ 저장 · 증분 갱신 */
const keyOf = (rcept, fs) => `xbrl:v${PARSER_VERSION}:${rcept}:${fs}`;
const naKeyOf = (rcept, fs) => `xbrl-na:v${PARSER_VERSION}:${rcept}:${fs}`;
const idxOf = (corp, y, q, fs) => `xbrl-idx:${corp}:${y}:${q}:${fs}`;
const NA_KEEP = 7 * 86400e3; // 비상장사·미제공 보고서(013/014)는 7일간 재요청 생략(새로고침 시 재확인)

export async function savedXbrl(corp, y, q, fs, rcept) {
  if (rcept) {
    const cur = await store.get(keyOf(rcept, fs));
    if (cur?.data) return { status: 'fresh', data: cur.data };
  }
  const idx = await store.get(idxOf(corp, y, q, fs));
  if (idx?.data?.rcept && idx.data.rcept !== rcept) {
    const old = await store.get(keyOf(idx.data.rcept, fs));
    if (old?.data) return { status: 'outdated', data: old.data, oldRcept: idx.data.rcept };
  }
  return { status: 'none' };
}

const inflight = new Map();
export async function loadXbrl({ corp, y, q, fs = 'CFS', rcept, ofsOnly = false }) {
  if (!rcept) throw new ApiError('XBRL_NO_RCEPT', '보고서 접수번호가 없습니다.');
  const k = keyOf(rcept, fs);
  const saved = await store.get(k);
  if (saved?.data) return { data: saved.data, fromStore: true };
  const nak = naKeyOf(rcept, fs);
  if (!isForcing()) {
    const na = await store.get(nak);
    if (na && na.exp > Date.now()) throw new ApiError(na.data?.code || 'DART_013', '해당 보고서의 XBRL 원본이 제공되지 않습니다(저장 확인됨).');
  }
  if (inflight.has(k)) return inflight.get(k);
  const p = (async () => {
    if (!canUnzip()) throw new ApiError('XBRL_UNSUPPORTED', '이 브라우저는 XBRL 압축 해제를 지원하지 않습니다(iOS 16.4 이상 · 최신 Chrome/Safari 필요).');
    let buf;
    try {
      buf = await api.dartXbrl(rcept, REPRT[q]);
    } catch (err) {
      if (err?.code === 'DART_013' || err?.code === 'DART_014') {
        const now = Date.now();
        store.put({ k: nak, data: { code: err.code }, exp: now + NA_KEEP, ttl: NA_KEEP, at: now });
      }
      throw err;
    }
    const allZipNames = [];
    const files = await unzip(buf, (n) => /\.(?:xbrl|xhtml|html?|xml)$/i.test(n) && !/(?:^|[_-])en\.xml$|_def\.xml$/i.test(n), allZipNames);
    const data = { ...parseXbrlFiles(files, { y, q, fs, ofsOnly, zipFiles: allZipNames }), rcept, corp, at: Date.now(), bytes: buf.byteLength };
    const now = Date.now();
    await store.put({ k, data, exp: now + KEEP, ttl: KEEP, at: now });
    await store.put({ k: idxOf(corp, y, q, fs), data: { rcept, at: now }, exp: now + KEEP, ttl: KEEP, at: now });
    return { data, fromStore: false };
  })();
  inflight.set(k, p);
  p.finally(() => inflight.delete(k)).catch(() => {});
  return p;
}
