// result-highlights.js - extracted from renderer.js in v1.0.30 modular refactor.
function firstText(items, fallback = '暂无') {
  const arr = Array.isArray(items) ? items.filter(Boolean) : [];
  return arr.length ? String(arr[0]) : fallback;
}

function countStatus(items, tester) {
  const arr = Array.isArray(items) ? items : [];
  return arr.filter(tester).length;
}

function summarizeShort(text, limit = 38) {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  return s.length > limit ? s.slice(0, limit) + '…' : s;
}

function setPriorityCardState(id, state) {
  const el = $(id);
  if (!el) return;
  el.classList.remove('priority-good', 'priority-mid', 'priority-bad');
  el.classList.add(state);
}

function renderPriorityHighlights(data) {
  const strip = $('priorityStrip');
  if (!strip) return;
  strip.style.display = 'grid';

  const score = Number(data.score || 0);
  const rec = data.recommendation || '待判断';
  const level = data.level || '';
  const must = Array.isArray(data.mustHaveCheck) ? data.mustHaveCheck : [];
  const veto = Array.isArray(data.vetoCheck) ? data.vetoCheck : [];
  const riskPoints = Array.isArray(data.riskPoints) ? data.riskPoints : [];
  const missingPoints = Array.isArray(data.missingPoints) ? data.missingPoints : [];
  const verifyItems = Array.isArray(data.verificationItems) ? data.verificationItems : [];

  const vetoHitCount = countStatus(veto, x => String(x.status || '').includes('命中'));
  const vetoUnclearCount = countStatus(veto, x => String(x.status || '').includes('待核实'));
  const mustWeakCount = countStatus(must, x => {
    const s = String(x.status || '');
    return s.includes('不满足') || s.includes('待核实') || s.includes('部分');
  });

  $('priorityDecision').textContent = `${rec}｜${score}分`;
  $('priorityDecisionReason').textContent = `${level || '综合判断'}；必要项风险 ${mustWeakCount} 项`;
  if (rec.includes('优先') || (score >= 85 && vetoHitCount === 0)) setPriorityCardState('decisionCard', 'priority-good');
  else if (rec.includes('不建议') || vetoHitCount > 0 || score < 65) setPriorityCardState('decisionCard', 'priority-bad');
  else setPriorityCardState('decisionCard', 'priority-mid');

  const riskTotal = vetoHitCount;
  $('priorityRisk').textContent = `${riskTotal}项`;
  $('priorityRiskText').textContent = vetoHitCount > 0
    ? `命中一票否决：${summarizeShort(firstText(veto.filter(x => String(x.status || '').includes('命中')).map(x => x.item)))}`
    : (vetoUnclearCount > 0
      ? `一票否决待核实 ${vetoUnclearCount} 项；普通风险 ${riskPoints.length} 项`
      : (riskPoints.length ? `普通风险 ${riskPoints.length} 项，未命中一票否决` : '未命中一票否决'));
  setPriorityCardState('riskCard', vetoHitCount ? 'priority-bad' : (vetoUnclearCount || riskPoints.length ? 'priority-mid' : 'priority-good'));

  const missingTotal = missingPoints.length + mustWeakCount;
  $('priorityMissing').textContent = `${missingTotal}项`;
  $('priorityMissingText').textContent = summarizeShort(firstText(missingPoints, mustWeakCount ? '必要项存在部分满足/待核实' : '暂无关键缺失'));
  setPriorityCardState('missingCard', missingTotal ? 'priority-mid' : 'priority-good');

  $('priorityVerify').textContent = `${verifyItems.length}项`;
  $('priorityVerifyText').textContent = summarizeShort(firstText(verifyItems, '暂无待核实项'));
  setPriorityCardState('verifyCard', verifyItems.length ? 'priority-mid' : 'priority-good');

  const evidence = Array.isArray(data.evidenceQuotes) ? data.evidenceQuotes.filter(Boolean).slice(0, 5) : [];
  const box = $('importantEvidenceBox');
  const list = $('importantEvidenceList');
  if (box && list) {
    list.innerHTML = '';
    if (evidence.length) {
      box.style.display = 'block';
      evidence.forEach(x => {
        const li = document.createElement('li');
        li.textContent = x;
        list.appendChild(li);
      });
    } else {
      box.style.display = 'none';
    }
  }
}


function evidenceTextIsValid(value) {
  const s = String(value || '').trim();
  if (!s) return false;
  return !['无', '无明确证据', '暂无', '待核实', '未提供'].some(x => s === x || s.includes(`无${x}`));
}

function collectEvidenceJudgments(data) {
  const groups = [
    ['必要项', data.mustHaveCheck],
    ['加分项', data.bonusCheck],
    ['一票否决', data.vetoCheck]
  ];
  const judgments = [];
  groups.forEach(([group, items]) => {
    (Array.isArray(items) ? items : []).forEach(x => {
      judgments.push({
        group,
        item: x.item || '未命名判断',
        status: x.status || '待核实',
        evidence: x.evidence || '',
        reason: x.reason || ''
      });
    });
  });
  return judgments;
}

function calculateEvidenceCoverage(data) {
  const judgments = collectEvidenceJudgments(data);
  const total = judgments.length;
  const withEvidence = judgments.filter(x => evidenceTextIsValid(x.evidence)).length;
  const missing = judgments.filter(x => !evidenceTextIsValid(x.evidence));
  const percent = total ? Math.round((withEvidence / total) * 100) : 0;
  return { total, withEvidence, missing, percent };
}

function setTrustCardState(id, state) {
  const el = $(id);
  if (!el) return;
  el.classList.remove('trust-good', 'trust-mid', 'trust-bad');
  el.classList.add(state);
}

function renderScoreTrust(data) {
  const panel = $('scoreTrustPanel');
  if (!panel) return;
  panel.style.display = 'block';

  const stability = buildScoreStability(data, data?._leaderboardId || '');
  const coverage = calculateEvidenceCoverage(data);

  const historyText = stability.historyCount
    ? `${stability.historyCount}次历史`
    : '暂无历史';
  setText('scoreHistoryText', historyText);
  setText(
    'scoreHistoryDetail',
    stability.historyCount
      ? `最近一次 ${stability.previousScore} 分；当前 ${stability.currentScore} 分`
      : '该项目内首次识别到此候选人'
  );
  setTrustCardState('scoreHistoryCard', stability.historyCount ? 'trust-mid' : 'trust-good');

  setText('scoreDeltaText', stability.warning ? `相差 ${stability.maxDelta} 分` : '暂无异常');
  setText('scoreDeltaDetail', stability.warningText);
  setTrustCardState('scoreDeltaCard', stability.warning ? 'trust-bad' : (stability.historyCount ? 'trust-good' : 'trust-mid'));

  setText('evidenceCoverageText', `${coverage.percent}%`);
  setText('evidenceCoverageDetail', `${coverage.withEvidence}/${coverage.total || 0} 项关键判断有原文依据`);
  setTrustCardState('evidenceCoverageCard', coverage.percent >= 80 ? 'trust-good' : (coverage.percent >= 60 ? 'trust-mid' : 'trust-bad'));

  const gaps = coverage.missing.slice(0, 8);
  const gapBox = $('evidenceGapBox');
  const gapList = $('evidenceGapList');
  if (gapBox && gapList) {
    gapList.innerHTML = '';
    if (gaps.length) {
      gapBox.style.display = 'block';
      gaps.forEach(x => {
        const li = document.createElement('li');
        li.innerHTML = `<strong>${escapeHtml(x.group)}｜${escapeHtml(x.item)}</strong><span>${escapeHtml(x.status)}｜${escapeHtml(x.reason || '缺少明确原文依据')}</span>`;
        gapList.appendChild(li);
      });
    } else {
      gapBox.style.display = 'none';
    }
  }

  const trustBadge = $('trustBadge');
  if (trustBadge) {
    trustBadge.className = 'trust-badge';
    if (stability.warning || coverage.percent < 60) {
      trustBadge.textContent = '需要复核';
      trustBadge.classList.add('trust-bad');
    } else if (coverage.percent < 80 || stability.historyCount) {
      trustBadge.textContent = '建议核对';
      trustBadge.classList.add('trust-mid');
    } else {
      trustBadge.textContent = '相对稳定';
      trustBadge.classList.add('trust-good');
    }
  }

  data.scoreStability = stability;
  data.evidenceCoverage = coverage;
}


