
/* ---------------- v2.3.10: 분리 contextRef(동일 차원) + 양수 차감계정(cal.xml weight=-1 / negatedLabel) + pre.xml 멤버 순서 ---------------- */
test('v2.3.10: 서로 다른 contextRef + 양수 할인차금(cal.xml weight=-1) + 멤버 표 pre.xml 직후 형제 차감', () => {
  const M = 1e6;
  const lab = `<?xml version="1.0" encoding="UTF-8"?>
  <link:linkbase xmlns:link="http://www.xbrl.org/2003/linkbase" xmlns:xlink="http://www.w3.org/1999/xlink">
    <link:labelLink xlink:role="http://www.xbrl.org/2003/role/link">
      <link:loc xlink:href="gs.xsd#entity00120030_LiqTr" xlink:label="l0"/>
      <link:label xlink:label="t0" xlink:role="http://www.xbrl.org/2003/role/label" xml:lang="ko">차감 : 유동성대체</link:label>
      <link:labelArc xlink:from="l0" xlink:to="t0"/>
      <link:loc xlink:href="gs.xsd#entity00120030_C1" xlink:label="l1"/>
      <link:label xlink:label="t1" xlink:role="http://www.xbrl.org/2003/role/label" xml:lang="ko">유동성장기차입금</link:label>
      <link:labelArc xlink:from="l1" xlink:to="t1"/>
      <link:loc xlink:href="gs.xsd#entity00120030_C2" xlink:label="l2"/>
      <link:label xlink:label="t2" xlink:role="http://www.xbrl.org/2009/role/negatedLabel" xml:lang="ko">차감항목</link:label>
      <link:labelArc xlink:from="l2" xlink:to="t2"/>
    </link:labelLink>
  </link:linkbase>`;
  const cal = `<?xml version="1.0" encoding="UTF-8"?>
  <link:linkbase xmlns:link="http://www.xbrl.org/2003/linkbase" xmlns:xlink="http://www.w3.org/1999/xlink">
    <link:calculationLink xlink:role="http://dart.fss.or.kr/role/Note17">
      <link:loc xlink:href="gs.xsd#entity00120030_STFin" xlink:label="p"/>
      <link:loc xlink:href="gs.xsd#entity00120030_C1" xlink:label="c1"/>
      <link:loc xlink:href="gs.xsd#entity00120030_C2" xlink:label="c2"/>
      <link:calculationArc xlink:from="p" xlink:to="c1" order="1" weight="1"/>
      <link:calculationArc xlink:from="p" xlink:to="c2" order="2" weight="-1"/>
    </link:calculationLink>
  </link:linkbase>`;
  const pre = `<?xml version="1.0" encoding="UTF-8"?>
  <link:linkbase xmlns:link="http://www.xbrl.org/2003/linkbase" xmlns:xlink="http://www.w3.org/1999/xlink">
    <link:presentationLink xlink:role="http://dart.fss.or.kr/role/Note17">
      <link:loc xlink:href="gs.xsd#entity00120030_Dom" xlink:label="p"/>
      <link:loc xlink:href="gs.xsd#entity00120030_M1" xlink:label="m1"/>
      <link:loc xlink:href="gs.xsd#entity00120030_M2" xlink:label="m2"/>
      <link:presentationArc xlink:from="p" xlink:to="m1" order="1"/>
      <link:presentationArc xlink:from="p" xlink:to="m2" order="2"/>
    </link:presentationLink>
  </link:linkbase>`;
  const xbrl = `<?xml version="1.0" encoding="UTF-8"?>
  <xbrli:xbrl xmlns:xbrli="http://www.xbrl.org/2003/instance" xmlns:xbrldi="http://xbrl.org/2006/xbrldi" xmlns:ifrs-full="http://xbrl.ifrs.org/taxonomy" xmlns:dart="http://dart.fss.or.kr" xmlns:entity00120030="http://dart.fss.or.kr/gs">
    <xbrli:context id="I_PLAIN"><xbrli:entity><xbrli:identifier scheme="http://dart.fss.or.kr">00120030</xbrli:identifier><xbrli:segment><xbrldi:explicitMember dimension="ifrs-full:ConsolidatedAndSeparateFinancialStatementsAxis">ifrs-full:ConsolidatedMember</xbrldi:explicitMember></xbrli:segment></xbrli:entity><xbrli:period><xbrli:instant>2026-06-30</xbrli:instant></xbrli:period></xbrli:context>
    <xbrli:context id="I_TR"><xbrli:entity><xbrli:identifier scheme="http://dart.fss.or.kr">00120030</xbrli:identifier><xbrli:segment><xbrldi:explicitMember dimension="ifrs-full:ConsolidatedAndSeparateFinancialStatementsAxis">ifrs-full:ConsolidatedMember</xbrldi:explicitMember><xbrldi:explicitMember dimension="entity00120030:BorrowingDetailAxis">entity00120030:LiqTr</xbrldi:explicitMember></xbrli:segment></xbrli:entity><xbrli:period><xbrli:instant>2026-06-30</xbrli:instant></xbrli:period></xbrli:context>
    <xbrli:context id="I_ROW1"><xbrli:entity><xbrli:identifier scheme="http://dart.fss.or.kr">00120030</xbrli:identifier><xbrli:segment><xbrldi:explicitMember dimension="ifrs-full:ConsolidatedAndSeparateFinancialStatementsAxis">ifrs-full:ConsolidatedMember</xbrldi:explicitMember><xbrldi:explicitMember dimension="dart:CarryingAmountAxis">dart:DisclosedAmountMember</xbrldi:explicitMember></xbrli:segment></xbrli:entity><xbrli:period><xbrli:instant>2026-06-30</xbrli:instant></xbrli:period></xbrli:context>
    <xbrli:context id="I_ROW2"><xbrli:entity><xbrli:identifier scheme="http://dart.fss.or.kr">00120030</xbrli:identifier><xbrli:segment><xbrldi:explicitMember dimension="dart:CarryingAmountAxis">dart:DisclosedAmountMember</xbrldi:explicitMember><xbrldi:explicitMember dimension="ifrs-full:ConsolidatedAndSeparateFinancialStatementsAxis">ifrs-full:ConsolidatedMember</xbrldi:explicitMember></xbrli:segment></xbrli:entity><xbrli:period><xbrli:instant>2026-06-30</xbrli:instant></xbrli:period></xbrli:context>
    <xbrli:context id="I_M1"><xbrli:entity><xbrli:identifier scheme="http://dart.fss.or.kr">00120030</xbrli:identifier><xbrli:segment><xbrldi:explicitMember dimension="ifrs-full:ConsolidatedAndSeparateFinancialStatementsAxis">ifrs-full:ConsolidatedMember</xbrldi:explicitMember><xbrldi:explicitMember dimension="entity00120030:RowAxis">entity00120030:M1</xbrldi:explicitMember><xbrldi:explicitMember dimension="dart:CarryingAmountAxis">dart:DisclosedAmountMember</xbrldi:explicitMember></xbrli:segment></xbrli:entity><xbrli:period><xbrli:instant>2026-06-30</xbrli:instant></xbrli:period></xbrli:context>
    <xbrli:context id="I_M2"><xbrli:entity><xbrli:identifier scheme="http://dart.fss.or.kr">00120030</xbrli:identifier><xbrli:segment><xbrldi:explicitMember dimension="dart:CarryingAmountAxis">dart:DisclosedAmountMember</xbrldi:explicitMember><xbrldi:explicitMember dimension="entity00120030:RowAxis">entity00120030:M2</xbrldi:explicitMember><xbrldi:explicitMember dimension="ifrs-full:ConsolidatedAndSeparateFinancialStatementsAxis">ifrs-full:ConsolidatedMember</xbrldi:explicitMember></xbrli:segment></xbrli:entity><xbrli:period><xbrli:instant>2026-06-30</xbrli:instant></xbrli:period></xbrli:context>
    <ifrs-full:ShorttermBorrowings contextRef="I_PLAIN">${1200605 * M}</ifrs-full:ShorttermBorrowings>
    <ifrs-full:CurrentLeaseLiabilities contextRef="I_PLAIN">${74928 * M}</ifrs-full:CurrentLeaseLiabilities>
    <dart:LongTermBorrowingsGross contextRef="I_PLAIN">${2335213 * M}</dart:LongTermBorrowingsGross>
    <dart:LongTermBorrowingsGross contextRef="I_TR">${-2058163 * M}</dart:LongTermBorrowingsGross>
    <dart:BondsIssued contextRef="I_PLAIN">${425404 * M}</dart:BondsIssued>
    <dart:BondsIssued contextRef="I_TR">${-145311 * M}</dart:BondsIssued>
    <ifrs-full:NoncurrentLeaseLiabilities contextRef="I_PLAIN">${276430 * M}</ifrs-full:NoncurrentLeaseLiabilities>
    <entity00120030:C1 contextRef="I_ROW1">${2058163 * M}</entity00120030:C1>
    <entity00120030:C2 contextRef="I_ROW2">${3762 * M}</entity00120030:C2>
    <entity00120030:STFinAmt contextRef="I_M1">${145311 * M}</entity00120030:STFinAmt>
    <entity00120030:STFinAmt contextRef="I_M2">${-183 * M}</entity00120030:STFinAmt>
  </xbrli:xbrl>`;
  const p = parseXbrlFiles(enc({ 'gs.xbrl': xbrl, 'gs_lab-ko.xml': lab, 'gs_pre.xml': pre, 'gs_cal.xml': cal }), { y: 2026, q: 2, fs: 'CFS' });
  assert.equal(p.borrow.end.items.currentLongBorrow.disc, 3762 * M);
  assert.equal(p.borrow.end.items.currentBonds.disc, 183 * M);
  assert.equal(p.borrow.end.total, 6512109 * M);
});
/* ---------------- v2.3.11: 유니코드(한글) 확장 태그명 + TextBlock HTML 표 폴백 추출 검증 ---------------- */
test('v2.3.11: 한글 XML 태그명(entity00120030:유동성장기차입금현재가치할인차금 등) 직접 파싱', () => {
  const M = 1e6;
  const lab = `<?xml version="1.0" encoding="UTF-8"?>
  <link:linkbase xmlns:link="http://www.xbrl.org/2003/linkbase" xmlns:xlink="http://www.w3.org/1999/xlink">
    <link:labelLink xlink:role="http://www.xbrl.org/2003/role/link">
      <link:loc xlink:href="gs.xsd#entity00120030_LiqTr" xlink:label="l0"/>
      <link:label xlink:label="t0" xlink:role="http://www.xbrl.org/2003/role/label" xml:lang="ko">차감 : 유동성대체</link:label>
      <link:labelArc xlink:from="l0" xlink:to="t0"/>
    </link:labelLink>
  </link:linkbase>`;
  const xbrl = `<?xml version="1.0" encoding="UTF-8"?>
  <xbrli:xbrl xmlns:xbrli="http://www.xbrl.org/2003/instance" xmlns:xbrldi="http://xbrl.org/2006/xbrldi" xmlns:ifrs-full="http://xbrl.ifrs.org/taxonomy" xmlns:dart="http://dart.fss.or.kr" xmlns:entity00120030="http://dart.fss.or.kr/gs">
    <xbrli:context id="I_PLAIN"><xbrli:entity><xbrli:identifier scheme="http://dart.fss.or.kr">00120030</xbrli:identifier><xbrli:segment><xbrldi:explicitMember dimension="ifrs-full:ConsolidatedAndSeparateFinancialStatementsAxis">ifrs-full:ConsolidatedMember</xbrldi:explicitMember></xbrli:segment></xbrli:entity><xbrli:period><xbrli:instant>2026-06-30</xbrli:instant></xbrli:period></xbrli:context>
    <xbrli:context id="I_DISC"><xbrli:entity><xbrli:identifier scheme="http://dart.fss.or.kr">00120030</xbrli:identifier><xbrli:segment><xbrldi:explicitMember dimension="ifrs-full:ConsolidatedAndSeparateFinancialStatementsAxis">ifrs-full:ConsolidatedMember</xbrldi:explicitMember><xbrldi:explicitMember dimension="ifrs-full:CarryingAmountAccumulatedDepreciationAmortisationAndImpairmentAndGrossCarryingAmountAxis">dart:DisclosedAmountMember</xbrldi:explicitMember></xbrli:segment></xbrli:entity><xbrli:period><xbrli:instant>2026-06-30</xbrli:instant></xbrli:period></xbrli:context>
    <xbrli:context id="I_TR"><xbrli:entity><xbrli:identifier scheme="http://dart.fss.or.kr">00120030</xbrli:identifier><xbrli:segment><xbrldi:explicitMember dimension="ifrs-full:ConsolidatedAndSeparateFinancialStatementsAxis">ifrs-full:ConsolidatedMember</xbrldi:explicitMember><xbrldi:explicitMember dimension="entity00120030:BorrowingsByNameAxis">entity00120030:LiqTr</xbrldi:explicitMember></xbrli:segment></xbrli:entity><xbrli:period><xbrli:instant>2026-06-30</xbrli:instant></xbrli:period></xbrli:context>
    <ifrs-full:ShorttermBorrowings contextRef="I_PLAIN">${1200605 * M}</ifrs-full:ShorttermBorrowings>
    <ifrs-full:CurrentLeaseLiabilities contextRef="I_PLAIN">${74928 * M}</ifrs-full:CurrentLeaseLiabilities>
    <dart:LongTermBorrowingsGross contextRef="I_PLAIN">${2335213 * M}</dart:LongTermBorrowingsGross>
    <dart:LongTermBorrowingsGross contextRef="I_TR">${-2058163 * M}</dart:LongTermBorrowingsGross>
    <dart:BondsIssued contextRef="I_PLAIN">${425404 * M}</dart:BondsIssued>
    <dart:BondsIssued contextRef="I_TR">${-145311 * M}</dart:BondsIssued>
    <ifrs-full:NoncurrentLeaseLiabilities contextRef="I_PLAIN">${276430 * M}</ifrs-full:NoncurrentLeaseLiabilities>
    <entity00120030:유동성장기차입금 contextRef="I_DISC">${2058163 * M}</entity00120030:유동성장기차입금>
    <entity00120030:유동성장기차입금현재가치할인차금 contextRef="I_DISC">${3762 * M}</entity00120030:유동성장기차입금현재가치할인차금>
    <entity00120030:유동성사채 contextRef="I_DISC">${145311 * M}</entity00120030:유동성사채>
    <entity00120030:유동성사채할인발행차금 contextRef="I_DISC">${183 * M}</entity00120030:유동성사채할인발행차금>
  </xbrli:xbrl>`;
  const p = parseXbrlFiles(enc({ 'gs.xbrl': xbrl, 'gs_lab-ko.xml': lab }), { y: 2026, q: 2, fs: 'CFS' });
  assert.equal(p.stats.unicodeFacts, 4);
  assert.equal(p.borrow.end.items.currentLongBorrow.disc, 3762 * M);
  assert.equal(p.borrow.end.items.currentBonds.disc, 183 * M);
  assert.equal(p.borrow.end.total, 6512109 * M);
});

test('v2.3.11: TextBlock HTML 표 폴백 — 원금 앵커로 단위(백만원)·당기열 특정 후 할인차금 차감', () => {
  const M = 1e6;
  const lab = `<?xml version="1.0" encoding="UTF-8"?>
  <link:linkbase xmlns:link="http://www.xbrl.org/2003/linkbase" xmlns:xlink="http://www.w3.org/1999/xlink">
    <link:labelLink xlink:role="http://www.xbrl.org/2003/role/link">
      <link:loc xlink:href="gs.xsd#entity00120030_LiqTr" xlink:label="l0"/>
      <link:label xlink:label="t0" xlink:role="http://www.xbrl.org/2003/role/label" xml:lang="ko">차감 : 유동성대체</link:label>
      <link:labelArc xlink:from="l0" xlink:to="t0"/>
    </link:labelLink>
  </link:linkbase>`;
  const tbHtml = `&lt;table&gt;&lt;tr&gt;&lt;th&gt;구분&lt;/th&gt;&lt;th&gt;공시금액&lt;/th&gt;&lt;/tr&gt;&lt;tr&gt;&lt;td&gt;유동성장기차입금&lt;/td&gt;&lt;td&gt;2,058,163&lt;/td&gt;&lt;/tr&gt;&lt;tr&gt;&lt;td&gt;유동성장기차입금현재가치할인차금&lt;/td&gt;&lt;td&gt;(3,762)&lt;/td&gt;&lt;/tr&gt;&lt;tr&gt;&lt;td&gt;유동성사채&lt;/td&gt;&lt;td&gt;145,311&lt;/td&gt;&lt;/tr&gt;&lt;tr&gt;&lt;td&gt;유동성사채할인발행차금&lt;/td&gt;&lt;td&gt;(183)&lt;/td&gt;&lt;/tr&gt;&lt;/table&gt;`;
  const xbrl = `<?xml version="1.0" encoding="UTF-8"?>
  <xbrli:xbrl xmlns:xbrli="http://www.xbrl.org/2003/instance" xmlns:xbrldi="http://xbrl.org/2006/xbrldi" xmlns:ifrs-full="http://xbrl.ifrs.org/taxonomy" xmlns:dart="http://dart.fss.or.kr" xmlns:entity00120030="http://dart.fss.or.kr/gs">
    <xbrli:context id="I_PLAIN"><xbrli:entity><xbrli:identifier scheme="http://dart.fss.or.kr">00120030</xbrli:identifier><xbrli:segment><xbrldi:explicitMember dimension="ifrs-full:ConsolidatedAndSeparateFinancialStatementsAxis">ifrs-full:ConsolidatedMember</xbrldi:explicitMember></xbrli:segment></xbrli:entity><xbrli:period><xbrli:instant>2026-06-30</xbrli:instant></xbrli:period></xbrli:context>
    <xbrli:context id="D_YTD"><xbrli:entity><xbrli:identifier scheme="http://dart.fss.or.kr">00120030</xbrli:identifier><xbrli:segment><xbrldi:explicitMember dimension="ifrs-full:ConsolidatedAndSeparateFinancialStatementsAxis">ifrs-full:ConsolidatedMember</xbrldi:explicitMember></xbrli:segment></xbrli:entity><xbrli:period><xbrli:startDate>2026-01-01</xbrli:startDate><xbrli:endDate>2026-06-30</xbrli:endDate></xbrli:period></xbrli:context>
    <xbrli:context id="I_TR"><xbrli:entity><xbrli:identifier scheme="http://dart.fss.or.kr">00120030</xbrli:identifier><xbrli:segment><xbrldi:explicitMember dimension="ifrs-full:ConsolidatedAndSeparateFinancialStatementsAxis">ifrs-full:ConsolidatedMember</xbrldi:explicitMember><xbrldi:explicitMember dimension="entity00120030:BorrowingsByNameAxis">entity00120030:LiqTr</xbrldi:explicitMember></xbrli:segment></xbrli:entity><xbrli:period><xbrli:instant>2026-06-30</xbrli:instant></xbrli:period></xbrli:context>
    <ifrs-full:ShorttermBorrowings contextRef="I_PLAIN">${1200605 * M}</ifrs-full:ShorttermBorrowings>
    <ifrs-full:CurrentLeaseLiabilities contextRef="I_PLAIN">${74928 * M}</ifrs-full:CurrentLeaseLiabilities>
    <dart:LongTermBorrowingsGross contextRef="I_PLAIN">${2335213 * M}</dart:LongTermBorrowingsGross>
    <dart:LongTermBorrowingsGross contextRef="I_TR">${-2058163 * M}</dart:LongTermBorrowingsGross>
    <dart:BondsIssued contextRef="I_PLAIN">${425404 * M}</dart:BondsIssued>
    <dart:BondsIssued contextRef="I_TR">${-145311 * M}</dart:BondsIssued>
    <ifrs-full:NoncurrentLeaseLiabilities contextRef="I_PLAIN">${276430 * M}</ifrs-full:NoncurrentLeaseLiabilities>
    <dart:DisclosureOfShortTermFinancialLiabilitiesTextBlock contextRef="D_YTD">${tbHtml}</dart:DisclosureOfShortTermFinancialLiabilitiesTextBlock>
  </xbrli:xbrl>`;
  const p = parseXbrlFiles(enc({ 'gs.xbrl': xbrl, 'gs_lab-ko.xml': lab }), { y: 2026, q: 2, fs: 'CFS' });
  assert.equal(p.borrow.end.items.currentLongBorrow.disc, 3762 * M);
  assert.equal(p.borrow.end.items.currentBonds.disc, 183 * M);
  assert.equal(p.borrow.end.total, 6512109 * M);
});
/* ---------------- v2.3.12: duration 컨텍스트 폴백 + 기본네임스페이스(접두사 없음) + 포렌식 프로브 ---------------- */
test('v2.3.12: 단기금융부채 내역이 duration 컨텍스트(2026-01-01~2026-06-30)로 기재된 경우에도 할인차금 추출', () => {
  const M = 1e6;
  const lab = `<?xml version="1.0" encoding="UTF-8"?>
  <link:linkbase xmlns:link="http://www.xbrl.org/2003/linkbase" xmlns:xlink="http://www.w3.org/1999/xlink">
    <link:labelLink xlink:role="http://www.xbrl.org/2003/role/link">
      <link:loc xlink:href="gs.xsd#entity00120030_LiqTr" xlink:label="l0"/>
      <link:label xlink:label="t0" xlink:role="http://www.xbrl.org/2003/role/label" xml:lang="ko">차감 : 유동성대체</link:label>
      <link:labelArc xlink:from="l0" xlink:to="t0"/>
      <link:loc xlink:href="gs.xsd#entity00120030_CurLongDisc" xlink:label="l1"/>
      <link:label xlink:label="t1" xlink:role="http://www.xbrl.org/2003/role/terseLabel" xml:lang="ko">유동성장기차입금현재가치할인차금</link:label>
      <link:labelArc xlink:from="l1" xlink:to="t1"/>
      <link:loc xlink:href="gs.xsd#entity00120030_CurBondDisc" xlink:label="l2"/>
      <link:label xlink:label="t2" xlink:role="http://www.xbrl.org/2003/role/terseLabel" xml:lang="ko">유동성사채할인발행차금</link:label>
      <link:labelArc xlink:from="l2" xlink:to="t2"/>
    </link:labelLink>
  </link:linkbase>`;
  const xbrl = `<?xml version="1.0" encoding="UTF-8"?>
  <xbrli:xbrl xmlns:xbrli="http://www.xbrl.org/2003/instance" xmlns:xbrldi="http://xbrl.org/2006/xbrldi" xmlns:ifrs-full="http://xbrl.ifrs.org/taxonomy" xmlns:dart="http://dart.fss.or.kr" xmlns:entity00120030="http://dart.fss.or.kr/gs">
    <xbrli:context id="I_PLAIN"><xbrli:entity><xbrli:identifier scheme="http://dart.fss.or.kr">00120030</xbrli:identifier><xbrli:segment><xbrldi:explicitMember dimension="ifrs-full:ConsolidatedAndSeparateFinancialStatementsAxis">ifrs-full:ConsolidatedMember</xbrldi:explicitMember></xbrli:segment></xbrli:entity><xbrli:period><xbrli:instant>2026-06-30</xbrli:instant></xbrli:period></xbrli:context>
    <xbrli:context id="D_DISC"><xbrli:entity><xbrli:identifier scheme="http://dart.fss.or.kr">00120030</xbrli:identifier><xbrli:segment><xbrldi:explicitMember dimension="ifrs-full:ConsolidatedAndSeparateFinancialStatementsAxis">ifrs-full:ConsolidatedMember</xbrldi:explicitMember><xbrldi:explicitMember dimension="ifrs-full:CarryingAmountAccumulatedDepreciationAmortisationAndImpairmentAndGrossCarryingAmountAxis">dart:DisclosedAmountMember</xbrldi:explicitMember></xbrli:segment></xbrli:entity><xbrli:period><xbrli:startDate>2026-01-01</xbrli:startDate><xbrli:endDate>2026-06-30</xbrli:endDate></xbrli:period></xbrli:context>
    <xbrli:context id="I_TR"><xbrli:entity><xbrli:identifier scheme="http://dart.fss.or.kr">00120030</xbrli:identifier><xbrli:segment><xbrldi:explicitMember dimension="ifrs-full:ConsolidatedAndSeparateFinancialStatementsAxis">ifrs-full:ConsolidatedMember</xbrldi:explicitMember><xbrldi:explicitMember dimension="entity00120030:BorrowingsByNameAxis">entity00120030:LiqTr</xbrldi:explicitMember></xbrli:segment></xbrli:entity><xbrli:period><xbrli:instant>2026-06-30</xbrli:instant></xbrli:period></xbrli:context>
    <ifrs-full:ShorttermBorrowings contextRef="I_PLAIN">${1200605 * M}</ifrs-full:ShorttermBorrowings>
    <ifrs-full:CurrentLeaseLiabilities contextRef="I_PLAIN">${74928 * M}</ifrs-full:CurrentLeaseLiabilities>
    <dart:LongTermBorrowingsGross contextRef="I_PLAIN">${2335213 * M}</dart:LongTermBorrowingsGross>
    <dart:LongTermBorrowingsGross contextRef="I_TR">${-2058163 * M}</dart:LongTermBorrowingsGross>
    <dart:BondsIssued contextRef="I_PLAIN">${425404 * M}</dart:BondsIssued>
    <dart:BondsIssued contextRef="I_TR">${-145311 * M}</dart:BondsIssued>
    <ifrs-full:NoncurrentLeaseLiabilities contextRef="I_PLAIN">${276430 * M}</ifrs-full:NoncurrentLeaseLiabilities>
    <entity00120030:CurLongDisc contextRef="D_DISC">${-3762 * M}</entity00120030:CurLongDisc>
    <entity00120030:CurBondDisc contextRef="D_DISC">${-183 * M}</entity00120030:CurBondDisc>
  </xbrli:xbrl>`;
  const p = parseXbrlFiles(enc({ 'gs.xbrl': xbrl, 'gs_lab-ko.xml': lab }), { y: 2026, q: 2, fs: 'CFS' });
  assert.equal(p.borrow.end.items.currentLongBorrow.disc, 3762 * M);
  assert.equal(p.borrow.end.items.currentBonds.disc, 183 * M);
  assert.equal(p.borrow.end.total, 6512109 * M);
});
