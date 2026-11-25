// 테스트용 XBRL ZIP 생성기 — 실제 DART fnlttXbrl 구조(인스턴스 + 한글 라벨 링크베이스)를 축소 재현
// 함정 포함: 리스 이자비용(제외 대상), 연결/별도 차원, 장부금액 중립 차원, 자산 분류별 차원(합계만 사용),
//           부문 합계·연결조정 멤버(부문에서 제외), 회사 확장 개념(한글 라벨 매칭)
import zlib from 'node:zlib';

const crcTable = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (b) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };

/** files: { name: string|Uint8Array } → ZIP Uint8Array (deflate, 데이터 디스크립터 없음) */
export function makeZip(files, { store = false } = {}) {
  const locals = []; const centrals = []; let off = 0;
  for (const [name, content] of Object.entries(files)) {
    const data = typeof content === 'string' ? Buffer.from(content, 'utf8') : Buffer.from(content);
    const comp = store ? data : zlib.deflateRawSync(data);
    const nm = Buffer.from(name, 'utf8'); const crc = crc32(data);
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6); lh.writeUInt16LE(store ? 0 : 8, 8);
    lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(nm.length, 26);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x0800, 8); ch.writeUInt16LE(store ? 0 : 8, 10);
    ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(nm.length, 28); ch.writeUInt32LE(off, 42);
    locals.push(lh, nm, comp); centrals.push(ch, nm); off += 30 + nm.length + comp.length;
  }
  const cd = Buffer.concat(centrals);
  const e = Buffer.alloc(22); e.writeUInt32LE(0x06054b50, 0); e.writeUInt16LE(centrals.length / 2, 8); e.writeUInt16LE(centrals.length / 2, 10); e.writeUInt32LE(cd.length, 12); e.writeUInt32LE(off, 16);
  return new Uint8Array(Buffer.concat([...locals, cd, e]));
}

const pad = (n) => String(n).padStart(2, '0');
const qEnd = (y, q) => `${y}-${['', '03-31', '06-30', '09-30', '12-31'][q]}`;
const qStart = (y, q) => `${y}-${pad((q - 1) * 3 + 1)}-01`;

/**
 * XBRL 파일 세트. scale로 회사·연도별 규모를 바꾼다. 값 단위: 원
 * opts.ofsOnly: 연결 없이 별도만(차원 없음) · opts.noSingle: 분기 단독 컨텍스트 없음(누적만)
 */
export function xbrlFiles({ y = 2026, q = 2, corp = '00120030', scale = 1, ofsOnly = false, noSingle = false } = {}) {
  const E = `entity${corp}`;
  const ctxs = []; const facts = [];
  const C = 'ifrs-full:ConsolidatedAndSeparateFinancialStatementsAxis';
  const fsDim = (fs) => (ofsOnly ? '' : `<xbrldi:explicitMember dimension="${C}">ifrs-full:${fs === 'OFS' ? 'Separate' : 'Consolidated'}Member</xbrldi:explicitMember>`);
  const ctx = (id, start, end, dims = '') => ctxs.push(`<xbrli:context id="${id}"><xbrli:entity><xbrli:identifier scheme="http://dart.fss.or.kr">${corp}</xbrli:identifier>${dims ? `<xbrli:segment>${dims}</xbrli:segment>` : ''}</xbrli:entity><xbrli:period><xbrli:startDate>${start}</xbrli:startDate><xbrli:endDate>${end}</xbrli:endDate></xbrli:period></xbrli:context>`);
  const fact = (qn, ctxId, v) => facts.push(`<${qn} contextRef="${ctxId}" unitRef="KRW" decimals="-6">${Math.round(v)}</${qn}>`);
  const P = {
    ytd: [qStart(y, 1), qEnd(y, q), 1], single: [qStart(y, q), qEnd(y, q), 1 / q],
    priorYtd: [qStart(y - 1, 1), qEnd(y - 1, q), 0.9], priorSingle: [qStart(y - 1, q), qEnd(y - 1, q), 0.9 / q],
  };
  const g = scale * q / 2;   // 누적 규모(2분기 기준)
  for (const [k, [s, e, f]] of Object.entries(P)) {
    if (noSingle && /ingle/.test(k)) continue;
    const m = g * f;
    for (const fs of ofsOnly ? ['CFS'] : ['CFS', 'OFS']) {
      const sc = fs === 'OFS' ? 0.8 : 1;
      const id = `${k}_${fs}`;
      ctx(id, s, e, fsDim(fs));
      // 감가상각 4종(유형자산은 장부금액 중립 차원과 함께, 음수=변동표 감소)
      const idN = `${id}_acc`;
      ctx(idN, s, e, fsDim(fs) + '<xbrldi:explicitMember dimension="ifrs-full:CarryingAmountAccumulatedDepreciationAmortisationAndImpairmentAndGrossCarryingAmountAxis">ifrs-full:AccumulatedDepreciationAmortisationAndImpairmentMember</xbrldi:explicitMember>');
      fact('ifrs-full:DepreciationPropertyPlantAndEquipment', idN, -100e8 * m * sc);
      // 자산 분류별(건물) — 합계가 아니므로 사용하면 안 됨
      const idB = `${id}_bld`;
      ctx(idB, s, e, fsDim(fs) + '<xbrldi:explicitMember dimension="ifrs-full:ClassesOfPropertyPlantAndEquipmentAxis">ifrs-full:BuildingsMember</xbrldi:explicitMember>');
      fact('ifrs-full:DepreciationPropertyPlantAndEquipment', idB, -999e8);
      fact('ifrs-full:AmortisationIntangibleAssetsOtherThanGoodwill', id, 20e8 * m * sc);
      fact('ifrs-full:DepreciationInvestmentProperty', id, 5e8 * m * sc);
      fact(`${E}:DepreciationOfRightOfUseAssetsCustom`, id, 30e8 * m * sc);   // 확장 개념 → 한글 라벨 '사용권자산상각비'
      // 이자: 리스 이자비용은 이자비용에 섞이면 안 됨
      fact('ifrs-full:InterestExpense', id, 60e8 * m * sc);
      fact('ifrs-full:InterestExpenseOnLeaseLiabilities', id, 7e8 * m * sc);
      fact('ifrs-full:InterestRevenueCalculatedUsingEffectiveInterestMethod', id, 25e8 * m * sc);
      // 연결 합계 매출·영업이익
      fact('ifrs-full:Revenue', id, 30000e8 * m * sc);
      fact('dart:OperatingIncomeLoss', id, 1200e8 * m * sc);
      // 영업부문(연결만 공시)
      if (fs === 'CFS') {
        const segs = [['ArchitectureMember', 20000, 900], ['PlantMember', 8000, -150], ['InfraMember', 2500, 200], ['EliminationMember', -500, 250]];
        for (const [mem, rev, op] of segs) {
          const sid = `${id}_${mem}`;
          ctx(sid, s, e, fsDim(fs) + `<xbrldi:explicitMember dimension="ifrs-full:SegmentsAxis">${E}:${mem}</xbrldi:explicitMember>`);
          fact('ifrs-full:Revenue', sid, rev * 1e8 * m);
          fact('dart:OperatingIncomeLoss', sid, op * 1e8 * m);
        }
        const tid = `${id}_tot`;   // 보고부문 합계 멤버 — 제외 대상
        ctx(tid, s, e, fsDim(fs) + '<xbrldi:explicitMember dimension="ifrs-full:SegmentsAxis">ifrs-full:ReportableSegmentsMember</xbrldi:explicitMember>');
        fact('ifrs-full:Revenue', tid, 30500e8 * m);
      }
    }
  }
  const inst = `<?xml version="1.0" encoding="UTF-8"?>
<xbrli:xbrl xmlns:xbrli="http://www.xbrl.org/2003/instance" xmlns:xbrldi="http://xbrl.org/2006/xbrldi" xmlns:ifrs-full="https://xbrl.ifrs.org/taxonomy/2023-03-23/ifrs-full" xmlns:dart="http://dart.fss.or.kr/xbrl/dte" xmlns:${E}="http://dart.fss.or.kr/${corp}">
<xbrli:unit id="KRW"><xbrli:measure>iso4217:KRW</xbrli:measure></xbrli:unit>
${ctxs.join('\n')}
${facts.join('\n')}
<ifrs-full:Revenue contextRef="ytd_CFS" unitRef="KRW" xsi:nil="true"/>
</xbrli:xbrl>`;
  const lab = [
    [`${E}_ArchitectureMember`, '건축·주택'], [`${E}_PlantMember`, '플랜트'], [`${E}_InfraMember`, '인프라'], [`${E}_EliminationMember`, '연결조정'],
    [`${E}_DepreciationOfRightOfUseAssetsCustom`, '사용권자산 상각비'], ['ifrs-full_Revenue', '수익(매출액)'], ['dart_OperatingIncomeLoss', '영업이익(손실)'],
  ];
  const labXml = `<?xml version="1.0" encoding="UTF-8"?>
<link:linkbase xmlns:link="http://www.xbrl.org/2003/linkbase" xmlns:xlink="http://www.w3.org/1999/xlink">
<link:labelLink xlink:type="extended" xlink:role="http://www.xbrl.org/2003/role/link">
${lab.map(([c, t], i) => `<link:loc xlink:type="locator" xlink:href="entity.xsd#${c}" xlink:label="loc_${i}"/>
<link:label xlink:type="resource" xlink:label="lab_${i}" xlink:role="http://www.xbrl.org/2003/role/label" xml:lang="ko">${t}</link:label>
<link:label xlink:type="resource" xlink:label="lab_${i}" xlink:role="http://www.xbrl.org/2003/role/terseLabel" xml:lang="ko">짧은${t}</link:label>
<link:labelArc xlink:type="arc" xlink:arcrole="http://www.xbrl.org/2003/arcrole/concept-label" xlink:from="loc_${i}" xlink:to="lab_${i}"/>`).join('\n')}
</link:labelLink></link:linkbase>`;
  const base = `entity${corp}_${qEnd(y, q)}`;
  return { [`${base}.xbrl`]: inst, [`${base}_lab-ko.xml`]: labXml, [`${base}_pre.xml`]: '<link:linkbase/>', [`${base}.xsd`]: '<xsd:schema/>' };
}
export const xbrlZip = (opts) => makeZip(xbrlFiles(opts));
