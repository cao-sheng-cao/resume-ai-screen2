// candidate-actions.js - extracted from renderer.js in v1.0.30 modular refactor.
function buildCandidateSummaryText(data) {
  if (!data) return '';
  const profile = data.candidateProfile || {};
  return [
    `候选人：${data.candidateName || profile.nameFromResume || '待识别'}`,
    `评分：${data.score || 0}/100`,
    `证据置信度：${data.confidence || 0}%`,
    `推进建议：${data.recommendation || '待判断'}`,
    `严格度：${data.strictnessLabel || data.strictnessLevel || '未记录'}`,
    `摘要：${data.summary || ''}`,
    `匹配点：${(data.matchedPoints || []).join('；') || '暂无'}`,
    `关键缺失：${(data.missingPoints || []).join('；') || '暂无'}`,
    `风险点：${(data.riskPoints || []).join('；') || '暂无'}`,
    `待核实：${(data.verificationItems || []).join('；') || '暂无'}`
  ].join('\n');
}

function buildRiskText(data) {
  if (!data) return '';
  const veto = Array.isArray(data.vetoCheck) ? data.vetoCheck : [];
  const vetoText = veto.map(x => `${x.item || ''}：${x.status || ''}｜${x.reason || ''}｜依据：${x.evidence || ''}`).join('\n');
  return [
    `候选人：${data.candidateName || '待识别'}`,
    `推进建议：${data.recommendation || '待判断'}｜评分：${data.score || 0}`,
    '',
    '【强风险 / 一票否决】',
    vetoText || '暂无明确命中',
    '',
    '【风险点】',
    (data.riskPoints || []).join('\n') || '暂无',
    '',
    '【关键缺失】',
    (data.missingPoints || []).join('\n') || '暂无',
    '',
    '【必须核实】',
    (data.verificationItems || []).join('\n') || '暂无'
  ].join('\n');
}

async function copyText(text, successMessage = '已复制。') {
  const value = String(text || '').trim();
  if (!value) {
    alert('当前没有可复制内容。');
    return;
  }
  try {
    await navigator.clipboard.writeText(value);
  } catch {
    const textarea = document.createElement('textarea');
    textarea.value = value;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    textarea.remove();
  }
  setStatus('analyzeStatus', successMessage);
}

function copyCurrentSummary() {
  copyText(buildCandidateSummaryText(currentResult), '已复制候选人推荐摘要。');
}

function copyCurrentRisk() {
  copyText(buildRiskText(currentResult), '已复制候选人风险说明。');
}

function copyCurrentQuestions() {
  const questions = currentResult?.interviewQuestions || [];
  copyText(questions.map((x, i) => `${i + 1}. ${x}`).join('\n'), '已复制面试追问清单。');
}

function exportCurrentCandidate() {
  if (!currentResult) {
    alert('当前还没有候选人分析结果。');
    return;
  }
  const content = buildCandidateSummaryText(currentResult) + '\n\n' + buildRiskText(currentResult);
  const blob = new Blob(['\ufeff' + content], { type: 'text/plain;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `候选人分析_${sanitizeFilename(currentResult.candidateName || '待识别')}_${new Date().toISOString().slice(0,10)}.txt`;
  a.click();
  URL.revokeObjectURL(url);
}

async function quickMarkCurrent(category) {
  if (!currentResult) {
    alert('当前还没有候选人分析结果。');
    return;
  }
  let item = leaderboard.find(x => String(x.id) === String(currentResult._leaderboardId));
  if (!item) {
    item = [...leaderboard].reverse().find(x => String(x.candidateName || '') === String(currentResult.candidateName || ''));
  }
  if (!item) {
    alert('当前候选人还没有加入项目卡片/排行榜，请先点击“加入排行榜”。');
    return;
  }
  updateCandidateCategory(item.id, category);
  await persistProjects();
  await window.resumeApp.saveLeaderboard(leaderboard);
  renderLeaderboard();
  renderCandidateCards();
  setStatus('analyzeStatus', `已将 ${item.candidateName || '该候选人'} 标记为：${category}`);
}
