
function categoryClass(category) {
  const c = String(category || '').trim();
  if (c === '优先推进') return 'category-priority';
  if (c === '建议推进') return 'category-recommend';
  if (c === '待复核') return 'category-review';
  if (c === '作为储备') return 'category-reserve';
  if (c === '不建议推进') return 'category-reject';
  if (c === '已联系') return 'category-contacted';
  if (c === '已面试') return 'category-interview';
  if (c === '已淘汰') return 'category-eliminated';
  return 'category-default';
}

function categoryBadgeHtml(category) {
  const c = String(category || '待归类');
  return `<span class="category-badge ${categoryClass(c)}">${escapeHtml(c)}</span>`;
}

function applyCategorySelectClass(select) {
  if (!select) return;
  select.classList.remove(
    'category-priority',
    'category-recommend',
    'category-review',
    'category-reserve',
    'category-reject',
    'category-contacted',
    'category-interview',
    'category-eliminated',
    'category-default'
  );
  select.classList.add(categoryClass(select.value));
}



function normalizeCandidateNameValue(value) {
  return String(value || '')
    .replace(/\s+/g, '')
    .replace(/[｜|·•,，.。()（）\[\]【】]/g, '')
    .trim()
    .toLowerCase();
}

function candidateIdentityFromData(data) {
  const profile = data?.candidateProfile || {};
  const name = data?.candidateName || profile.nameFromResume || profile.name || '';
  const normalized = normalizeCandidateNameValue(name);
  if (!normalized || normalized.includes('待识别') || normalized.includes('未知')) return '';
  return normalized;
}

function candidateIdentityFromItem(item) {
  const name = item?.candidateName || item?.analysisSnapshot?.candidateName || '';
  const normalized = normalizeCandidateNameValue(name);
  if (!normalized || normalized.includes('待识别') || normalized.includes('未知')) return '';
  return normalized;
}

function findSameCandidateItems(data, excludeId = '') {
  const target = candidateIdentityFromData(data);
  if (!target) return [];
  return (candidates || [])
    .filter(x => String(x.id) !== String(excludeId || data?._leaderboardId || ''))
    .filter(x => candidateIdentityFromItem(x) === target)
    .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
}

function buildScoreStability(data, excludeId = '') {
  const historyItems = findSameCandidateItems(data, excludeId);
  const currentScore = Number(data?.score || 0);
  const history = historyItems.map(x => ({
    id: x.id,
    score: Number(x.score || 0),
    confidence: Number(x.confidence || 0),
    jobTitle: x.jobTitle || '未命名岗位',
    strictnessLevel: x.strictnessLevel || 3,
    strictnessLabel: x.strictnessLabel || strictnessName(x.strictnessLevel || 3),
    recommendation: x.recommendation || '',
    time: x.time || x.createdAt || ''
  }));
  const deltas = history.map(x => Math.abs(currentScore - Number(x.score || 0)));
  const maxDelta = deltas.length ? Math.max(...deltas) : 0;
  const nearest = history[0] || null;
  return {
    history,
    historyCount: history.length,
    currentScore,
    previousScore: nearest ? Number(nearest.score || 0) : null,
    maxDelta,
    warning: maxDelta > 5,
    warningText: maxDelta > 5
      ? `同候选人历史评分最大相差 ${maxDelta} 分，请人工复核评分依据。`
      : (history.length ? `同候选人历史评分波动在 5 分以内。` : '暂无同候选人历史评分。')
  };
}

function makeScoreHistoryEntry(data, item, createdAt) {
  return {
    id: item?.id || data?._leaderboardId || '',
    score: Number(data?.score || item?.score || 0),
    confidence: Number(data?.confidence || item?.confidence || 0),
    jobTitle: item?.jobTitle || value('jobTitle') || '未命名岗位',
    strictnessLevel: data?.strictnessLevel || item?.strictnessLevel || Number(value('strictnessLevel') || 3),
    strictnessLabel: data?.strictnessLabel || item?.strictnessLabel || (STRICTNESS_TEXT[Number(value('strictnessLevel') || 3)]?.label || '3度｜标准推荐'),
    recommendation: data?.recommendation || item?.recommendation || '',
    time: item?.time || new Date(createdAt || Date.now()).toLocaleString()
  };
}


// candidate-data.js - extracted from renderer.js in v1.0.30 modular refactor.
function migrateCandidates(items, fallbackLeaderboard = []) {
  const source = Array.isArray(items) && items.length ? items : fallbackLeaderboard;
  const arr = Array.isArray(source) ? source : [];
  return arr.map((x) => ({
    ...x,
    id: x.id || `candidate_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    jobTitle: x.jobTitle || '历史导入候选人',
    category: x.category || inferCategory(x),
    note: x.note || '',
    createdAt: x.createdAt || new Date().toISOString(),
    weekKey: x.weekKey || getWeekKey(x.createdAt || x.time || new Date()),
    strictnessLevel: x.strictnessLevel || 3,
    strictnessLabel: x.strictnessLabel || '3度｜标准推荐',
    totalTokens: Number(x.totalTokens || 0),
    extractionTokens: Number(x.extractionTokens || 0),
    scoringTokens: Number(x.scoringTokens || 0),
    analysisSnapshot: x.analysisSnapshot || null
  }));
}

function syncCandidateFromLeaderboardItem(item) {
  if (!item) return;
  const idx = candidates.findIndex(x => String(x.id) === String(item.id));
  const next = {
    ...item,
    analysisSnapshot: item.analysisSnapshot || candidates[idx]?.analysisSnapshot || null
  };
  if (idx >= 0) candidates[idx] = next;
  else candidates.push(next);
}

function updateCandidateCategory(id, category) {
  const c = candidates.find(x => String(x.id) === String(id));
  if (c) c.category = category;
  const r = leaderboard.find(x => String(x.id) === String(id));
  if (r) r.category = category;
}

function updateCandidateNote(id, note) {
  const c = candidates.find(x => String(x.id) === String(id));
  if (c) c.note = note;
  const r = leaderboard.find(x => String(x.id) === String(id));
  if (r) r.note = note;
}

function removeCandidateEverywhere(id) {
  candidates = candidates.filter(x => String(x.id) !== String(id));
  leaderboard = leaderboard.filter(x => String(x.id) !== String(id));
}

function makeAnalysisSnapshot(data) {
  return JSON.parse(JSON.stringify({
    candidateName: data.candidateName || '',
    candidateProfile: data.candidateProfile || {},
    score: data.score || 0,
    confidence: data.confidence || 0,
    level: data.level || '',
    recommendation: data.recommendation || '',
    summary: data.summary || '',
    dataQuality: data.dataQuality || {},
    mustHaveCheck: data.mustHaveCheck || [],
    bonusCheck: data.bonusCheck || [],
    vetoCheck: data.vetoCheck || [],
    matchedPoints: data.matchedPoints || [],
    riskPoints: data.riskPoints || [],
    missingPoints: data.missingPoints || [],
    verificationItems: data.verificationItems || [],
    interviewQuestions: data.interviewQuestions || [],
    evidenceQuotes: data.evidenceQuotes || [],
    scoreBreakdown: data.scoreBreakdown || {},
    model: data.model || '',
    modelLabel: data.modelLabel || '',
    strictnessLevel: data.strictnessLevel || Number(value('strictnessLevel') || 3),
    strictnessLabel: data.strictnessLabel || (STRICTNESS_TEXT[Number(value('strictnessLevel') || 3)]?.label || '3度｜标准推荐'),
    usage: data.usage || {},
    extractionUsage: data.extractionUsage || {},
    scoringUsage: data.scoringUsage || {},
    tokenUsageNote: data.tokenUsageNote || ''
  }));
}

function updateWorkflowStatus() {
  const p = activeProject();
  setText('statusProject', p?.name || '默认项目');
  setText('statusJob', value('jobTitle') || p?.standard?.jobTitle || '未命名岗位');
  const strictnessLevel = Number(value('strictnessLevel') || 3);
  setText('statusStrictness', STRICTNESS_TEXT[strictnessLevel]?.label || `${strictnessLevel}度`);
  const modelKey = value('modelSelect');
  const model = deepseekModels.find(x => `${x.id}:${x.thinking || ''}` === modelKey);
  setText('statusModel', model?.label || modelKey || '-');
  setText('statusCandidateCount', `${candidates.length || 0}人`);
  const cardProject = $('candidateCardsProjectName');
  if (cardProject) cardProject.textContent = p?.name || '默认项目';
}
