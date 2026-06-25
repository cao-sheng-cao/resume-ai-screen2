// candidate-cards.js - extracted from renderer.js in v1.0.30 modular refactor.
function compactList(items, fallback = '暂无') {
  const arr = Array.isArray(items) ? items.filter(Boolean) : [];
  return arr.length ? arr.slice(0, 2).map(x => `<li>${escapeHtml(x)}</li>`).join('') : `<li>${fallback}</li>`;
}

function renderCandidateCards() {
  const listBox = $('candidateCardList');
  if (!listBox) return;

  const p = activeProject();
  const projectName = p?.name || '默认项目';
  const heading = $('candidateCardsProjectName');
  if (heading) heading.textContent = projectName;

  const hint = $('candidateCardHint');
  const items = [...(candidates || [])].sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
  if (hint) hint.textContent = `当前项目 ${items.length} 张候选人卡片`;

  updateWorkflowStatus();

  if (!items.length) {
    listBox.innerHTML = `<div class="empty-card">
      <strong>当前项目暂无候选人分析卡片</strong>
      <span>完成一次候选人评分后，会自动在这里生成二级候选人卡片。</span>
    </div>`;
    return;
  }

  listBox.innerHTML = '';
  items.forEach((x, index) => {
    const snapshot = x.analysisSnapshot || null;
    const riskItems = snapshot?.riskPoints || [];
    const missingItems = snapshot?.missingPoints || [];
    const verifyItems = snapshot?.verificationItems || [];
    const historyCount = Array.isArray(x.scoreHistory) ? Math.max(0, x.scoreHistory.length - 1) : 0;
    const deltaText = x.scoreDeltaWarning ? `分差${Number(x.scoreDeltaAmount || 0)}` : (historyCount ? '稳定' : '首次');
    const evidenceText = Number(x.evidenceCoveragePercent || 0) ? `${Number(x.evidenceCoveragePercent || 0)}%` : '待算';
    const state = String(x.recommendation || '').includes('不建议') || Number(x.score || 0) < 65
      ? 'bad'
      : (String(x.recommendation || '').includes('优先') || Number(x.score || 0) >= 85 ? 'good' : 'mid');

    const card = document.createElement('article');
    card.className = `analysis-card analysis-card-${state}`;
    card.innerHTML = `
      <div class="analysis-card-head">
        <div>
          <span class="analysis-card-kicker">二级候选人卡片 #${index + 1}</span>
          <h3>${escapeHtml(x.candidateName || '待识别')}</h3>
          <p>${escapeHtml(x.jobTitle || '未命名岗位')}｜${escapeHtml(x.strictnessLabel || strictnessName(x.strictnessLevel || 3))}</p>
        </div>
        <div class="analysis-score">
          <strong>${Number(x.score || 0)}</strong>
          <span>${escapeHtml(x.recommendation || '待判断')}</span>
        </div>
      </div>
      <div class="analysis-card-summary">${escapeHtml(x.summary || '暂无摘要')}</div>
      <div class="analysis-card-flags">
        <div><span>风险</span><strong>${riskItems.length}</strong></div>
        <div><span>缺失</span><strong>${missingItems.length}</strong></div>
        <div><span>待核实</span><strong>${verifyItems.length}</strong></div>
        <div><span>证据覆盖</span><strong>${escapeHtml(evidenceText)}</strong></div>
        <div><span>历史评分</span><strong>${historyCount}次</strong></div>
        <div><span>评分波动</span><strong class="${x.scoreDeltaWarning ? 'score-delta-warn' : ''}">${escapeHtml(deltaText)}</strong></div>
        <div><span>归类</span><strong>${categoryBadgeHtml(x.category || '待归类')}</strong></div>
      </div>
      <details class="analysis-card-detail">
        <summary>展开卡片重点</summary>
        <div class="analysis-card-detail-grid">
          <div><h4>风险点</h4><ul>${compactList(riskItems, '暂无风险点')}</ul></div>
          <div><h4>关键缺失</h4><ul>${compactList(missingItems, '暂无关键缺失')}</ul></div>
          <div><h4>必须核实</h4><ul>${compactList(verifyItems, '暂无待核实项')}</ul></div>
        </div>
      </details>
      <div class="analysis-card-actions">
        <button class="ghost small" data-view-card="${x.id}" ${snapshot ? '' : 'disabled'}>查看完整结果</button>
        <button class="ghost small" data-copy-card="${x.id}">复制摘要</button>
        <button class="ghost small" data-mark-card="${x.id}" data-category="优先推进">标记优先</button>
        <button class="ghost small" data-mark-card="${x.id}" data-category="待复核">标记待核实</button>
      </div>
    `;
    listBox.appendChild(card);
  });

  listBox.querySelectorAll('[data-view-card]').forEach(btn => btn.onclick = () => {
    const item = candidates.find(x => String(x.id) === String(btn.dataset.viewCard));
    if (!item?.analysisSnapshot) return;
    currentResult = { ...item.analysisSnapshot, _leaderboardId: item.id };
    renderResult(currentResult);
    $('result').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  listBox.querySelectorAll('[data-copy-card]').forEach(btn => btn.onclick = () => {
    const item = candidates.find(x => String(x.id) === String(btn.dataset.copyCard));
    if (!item) return;
    const snapshot = item.analysisSnapshot || item;
    copyText(buildCandidateSummaryText(snapshot), '已复制该候选人卡片摘要。');
  });

  listBox.querySelectorAll('[data-mark-card]').forEach(btn => btn.onclick = async () => {
    const item = candidates.find(x => String(x.id) === String(btn.dataset.markCard));
    if (!item) return;
    updateCandidateCategory(item.id, btn.dataset.category || '待复核');
    await persistProjects();
    await window.resumeApp.saveLeaderboard(leaderboard);
    renderLeaderboard();
    renderCandidateCards();
  });
}
