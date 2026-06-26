const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');
const { dataPath, readJson, writeJson, removeJson } = require('./services/storage');
const { requestDeepSeek } = require('./services/ai-client');
const { canUseSafeStorage, getStoredApiKey, setStoredApiKey, removeStoredApiKey } = require('./services/secure-settings');

const APP_NAME = '简历岗位匹配评分系统';

function createWindow() {
  const win = new BrowserWindow({
    width: 1380,
    height: 920,
    minWidth: 1100,
    minHeight: 760,
    title: APP_NAME,
    backgroundColor: '#f4f7fb',
    icon: path.join(__dirname, '../assets/app-icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  const settingsForZoom = readJson('settings.json', {});
  currentZoomFactor = clampZoom(settingsForZoom.zoomFactor || currentZoomFactor || 1);
  win.webContents.on('did-finish-load', () => {
    win.webContents.setZoomFactor(currentZoomFactor);
  });

  win.loadFile(path.join(__dirname, '../renderer/index.html'));
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

let currentZoomFactor = 1;

function clampZoom(value) {
  const n = Number(value || 1);
  return Math.max(0.7, Math.min(1.45, Math.round(n * 100) / 100));
}

function applyZoomToAllWindows() {
  BrowserWindow.getAllWindows().forEach(win => {
    if (!win.isDestroyed()) {
      win.webContents.setZoomFactor(currentZoomFactor);
    }
  });
}

function saveZoomFactor() {
  const settings = readJson('settings.json', {});
  settings.zoomFactor = currentZoomFactor;
  writeJson('settings.json', settings);
}

function cleanText(value) {
  return String(value || '')
    .replace(/\r/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, 90000);
}

function safeBaseName(filePath) {
  try {
    return path.basename(String(filePath || ''));
  } catch {
    return String(filePath || '').split(/[\\/]/).pop() || '候选人简历';
  }
}

async function parseResumeFile(filePath) {
  const lower = filePath.toLowerCase();
  const buffer = fs.readFileSync(filePath);
  let text = '';
  let warning = '';

  try {
    if (lower.endsWith('.txt') || lower.endsWith('.md')) {
      text = buffer.toString('utf-8');
    } else if (lower.endsWith('.docx')) {
      const result = await mammoth.extractRawText({ buffer });
      text = result.value || '';
    } else if (lower.endsWith('.pdf')) {
      const result = await pdfParse(buffer);
      text = result.text || '';
      if (text.trim().length < 100) {
        warning = '这个 PDF 可能是扫描件、图片型 PDF，或文字层较少。可以继续手动复制正文到文本框后评分。';
      }
    } else {
      throw new Error('暂不支持该文件格式。请上传 PDF、Word、txt，或直接粘贴简历正文。');
    }
  } catch (err) {
    const reason = err && err.message ? err.message : String(err);
    throw new Error(
      '简历读取失败：' + reason +
      '。建议：1）确认文件没有加密或损坏；2）优先上传可复制文字的 PDF 或 Word；3）如果是扫描件，请直接复制简历正文粘贴到文本框。'
    );
  }

  const cleaned = cleanText(text);

  return {
    filename: safeBaseName(filePath),
    filePath,
    text: cleaned,
    charCount: cleaned.length,
    warning
  };
}

function parseModelJson(text) {
  const cleaned = String(text || '')
    .trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```$/i, '')
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('模型没有返回合法 JSON：' + cleaned.slice(0, 500));
    return JSON.parse(match[0]);
  }
}

function clamp(n, min, max) {
  const v = Number(n);
  if (Number.isNaN(v)) return min;
  return Math.max(min, Math.min(max, v));
}

function arr(value) {
  return Array.isArray(value) ? value.map(String) : [];
}

function normalizeUsage(usage) {
  const u = usage || {};
  const details = u.completion_tokens_details || {};
  return {
    promptTokens: Number(u.prompt_tokens || 0),
    completionTokens: Number(u.completion_tokens || 0),
    totalTokens: Number(u.total_tokens || 0),
    cacheHitTokens: Number(u.prompt_cache_hit_tokens || 0),
    cacheMissTokens: Number(u.prompt_cache_miss_tokens || 0),
    reasoningTokens: Number(details.reasoning_tokens || 0)
  };
}

function mergeUsage(...items) {
  return items.map(normalizeUsage).reduce((acc, u) => ({
    promptTokens: acc.promptTokens + Number(u.promptTokens || 0),
    completionTokens: acc.completionTokens + Number(u.completionTokens || 0),
    totalTokens: acc.totalTokens + Number(u.totalTokens || 0),
    cacheHitTokens: acc.cacheHitTokens + Number(u.cacheHitTokens || 0),
    cacheMissTokens: acc.cacheMissTokens + Number(u.cacheMissTokens || 0),
    reasoningTokens: acc.reasoningTokens + Number(u.reasoningTokens || 0)
  }), {
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    cacheHitTokens: 0,
    cacheMissTokens: 0,
    reasoningTokens: 0
  });
}

function imageMimeFromPath(filePath) {
  const ext = path.extname(String(filePath || '')).toLowerCase();
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.png') return 'image/png';
  if (ext === '.webp') return 'image/webp';
  return '';
}

function isImageFile(filePath) {
  return Boolean(imageMimeFromPath(filePath));
}

async function ocrImageFile(filePath) {
  try {
    const { recognize } = require('tesseract.js');
    let result;
    try {
      result = await recognize(filePath, 'eng+fra');
    } catch (firstErr) {
      result = await recognize(filePath, 'eng');
    }
    const text = cleanText(result?.data?.text || '');
    return {
      filename: safeBaseName(filePath),
      text,
      confidence: Math.round(Number(result?.data?.confidence || 0))
    };
  } catch (err) {
    return {
      filename: safeBaseName(filePath),
      text: '',
      confidence: 0,
      error: err.message || String(err)
    };
  }
}

function buildProfileExtractionPrompt({ textBlocks, ocrBlocks, imageCount, filenames }) {
  return `
请你作为招聘资料整理助手，对候选人的个人主页、网页打印PDF、截图OCR文本、简历片段进行一次【候选人信息预提取】。

重要规则：
1. 你不是做最终岗位匹配评分，只负责把资料整理成清晰、完整、可供下一步评分使用的候选人资料。
2. 必须基于上传资料中的可见信息，不得编造。
3. 截图图片已经先通过本地OCR转换为文字；请基于OCR文本提取可见的职位、公司、项目、教育、技能、地点、语言、时间线。OCR可能有错字，需要结合上下文保守修正。
4. 如果资料来自个人主页或网页截图，请提取页面中的所有候选人相关信息，包括简介、经历、教育、技能、证书、项目、联系方式、地理位置、语言、链接、成就等。
5. 如果某些信息不完整，请写“待核实”。
6. 输出必须是合法 JSON，不要输出 Markdown，不要额外解释。

【文本通道：PDF/Word/TXT直接读取结果】
${textBlocks.join('\n\n---\n\n') || '无文本层资料。'}

【图片通道：截图图片本地OCR结果】
${ocrBlocks.join('\n\n---\n\n') || '无图片OCR资料。'}

【上传文件名】
${filenames.map((x, i) => `${i + 1}. ${x}`).join('\n')}

【图片数量】
${imageCount}

请输出 JSON：
{
  "candidateName": "候选人姓名，无法识别写待识别",
  "headline": "候选人个人标题/当前职位/主页简介",
  "location": "地点，无法识别写待核实",
  "contact": ["邮箱/电话/主页链接/社媒链接，无法识别可为空"],
  "languages": ["语言能力"],
  "education": ["教育经历，含学校/专业/年份"],
  "experience": [
    {
      "company": "公司",
      "title": "职位",
      "period": "时间",
      "location": "地点",
      "description": "职责、业务、客户、项目、成果"
    }
  ],
  "skills": ["技能、产品、行业、工具、技术、业务关键词"],
  "certifications": ["证书/奖项/认证"],
  "projects": ["项目/案例/作品/重点经历"],
  "achievements": ["可量化成果/销售结果/合同/增长/管理规模等"],
  "sourceEvidence": ["关键原文依据或图片中可见短语"],
  "uncertainFields": ["需要人工核实的信息"],
  "normalizedResumeText": "把以上信息整理为一份完整候选人资料，适合后续与岗位条件进行深度匹配评分，控制在3000字以内。"
}`.trim();
}

const DEEPSEEK_MODELS = [
  { id: 'deepseek-chat', label: '旧版对话模型｜兼容快速模式', thinking: '', note: '兼容模型，适合普通批量初筛' },
  { id: 'deepseek-reasoner', label: '旧版推理模型｜兼容推理模式', thinking: '', note: '兼容推理模型，适合重点候选人复核' },
  { id: 'deepseek-v4-flash', label: '深度求索第四代极速｜严谨推理', thinking: 'enabled', note: '如账号支持该模型，可用于严谨复核' },
  { id: 'deepseek-v4-flash', label: '深度求索第四代极速｜快速评分', thinking: 'disabled', note: '如账号支持该模型，可用于快速评分' },
  { id: 'deepseek-v4-pro', label: '深度求索第四代专业｜高质量推理', thinking: 'enabled', note: '如账号支持该模型，可用于高质量复核' },
  { id: 'deepseek-v4-pro', label: '深度求索第四代专业｜高质量评分', thinking: 'disabled', note: '如账号支持该模型，可用于高质量评分' }
];

const STRICTNESS_LEVELS = {
  1: {
    label: '1度｜宽松探索',
    temperature: 0.25,
    guide: '用于人才池拓展。可以认可相邻行业、相关职责和潜力匹配；简历未写得很硬但有明显相关经历时，可判为部分满足并给较高区间。'
  },
  2: {
    label: '2度｜适度宽松',
    temperature: 0.2,
    guide: '用于一般初筛。允许把相关经验折算为部分满足，但核心必要项仍不能放宽；证据不足必须写待核实。'
  },
  3: {
    label: '3度｜标准推荐',
    temperature: 0.15,
    guide: '默认推荐。严格按岗位标准和简历原文判断；没有明确证据不得给满分；相关但不直接的经历一般判为部分满足。'
  },
  4: {
    label: '4度｜严格证据',
    temperature: 0.1,
    guide: '用于重点岗位复核。必须有清晰原文证据；相邻经验只能给较低部分分；缺少 销售指标、合同规模、客户层级等硬证据要明显扣分。'
  },
  5: {
    label: '5度｜极严格硬筛',
    temperature: 0.05,
    guide: '用于终面前硬筛或高价值岗位。只承认直接、明确、可验证的证据；没有写出的内容一律不得推断为满足；必要项模糊时倾向待核实/不满足。'
  }
};

function getStrictnessConfig(level) {
  const n = Math.max(1, Math.min(5, Number(level || 3)));
  return { level: n, ...(STRICTNESS_LEVELS[n] || STRICTNESS_LEVELS[3]) };
}

function buildStrictnessInstruction(level) {
  const cfg = getStrictnessConfig(level);
  const table = {
    1: '宽松：相关经验可给较高部分分，允许把潜力和相邻经验纳入判断；但不得编造事实。',
    2: '适度宽松：相关经验可部分折算，核心必要项仍需证据；证据不足写待核实。',
    3: '标准：以岗位标准和简历原文为准；直接证据给高分，相关但不直接给部分分。',
    4: '严格：必须有明确原文证据；缺少硬指标、客户层级、签约结果时明显扣分。',
    5: '极严格：只承认直接、明确、可验证证据；没有写出的内容不得推断，模糊项倾向不满足或待核实。'
  };
  return `【人工智能判断严格程度】
当前严格度：${cfg.label}
总体原则：${cfg.guide}
执行规则：${table[cfg.level]}

同一种情况的参考判断：
- 情况A：候选人有云生态/合作伙伴/云市场经验，但没有明确写“直接销售相关产品并独立完成客户成交”。
  1度：可视为较强相关，销售与云背景可给较高部分分；
  3度：云背景部分满足，直接云销售与成交能力需待核实；
  5度：不得视为直接云销售，云销售/成交能力只能给低部分分或待核实。
- 情况B：候选人写“管理战略客户关系”，但没有写企业高层、合同金额、销售指标。
  1度：可判定有大客户相关经验，但列为待核实；
  3度：战略客户部分满足，企业高层和销售指标证据不足要扣分；
  5度：不得判定为完整战略大客户销售能力，关键项待核实或不满足。
- 情况C：候选人年限够，但行业不是完全同类。
  1度：可给较高行业迁移分；
  3度：按相邻行业部分满足；
  5度：如果岗位要求强行业匹配，只给低部分分。`;
}

function getModelConfig(modelKey) {
  const key = String(modelKey || 'deepseek-v4-flash:enabled');
  const [id, thinking = ''] = key.split(':');
  const found = DEEPSEEK_MODELS.find(m => m.id === id && String(m.thinking || '') === thinking);
  if (found) return found;
  if (id) return { id, label: id, thinking, note: '自定义模型' };
  return DEEPSEEK_MODELS[1];
}

function hasExplicitEvidence(text) {
  const s = String(text || '').trim();
  if (!s) return false;
  const weak = ['无明确证据', '无证据', '未体现', '未提及', '没有明确', '待核实', '无法判断'];
  return !weak.some(x => s.includes(x));
}

function normalizeCheckConfidence(item) {
  const status = String(item?.status || '待核实');
  const evidence = String(item?.evidence || '');
  let c = clamp(item?.confidence ?? 0, 0, 100);

  if (hasExplicitEvidence(evidence)) {
    if (status === '满足' || status === '有' || status === '未命中') c = Math.max(c, 72);
    else if (status.includes('部分')) c = Math.max(c, 66);
    else if (status.includes('不满足') || status === '无' || status === '命中') c = Math.max(c, 70);
    else if (status.includes('待核实')) c = Math.min(Math.max(c, 45), 65);
  } else {
    if (status.includes('待核实')) c = Math.min(Math.max(c, 35), 55);
    else c = Math.min(Math.max(c, 45), 62);
  }

  return clamp(c, 0, 100);
}

function calibrateConfidence(data, rawConfidence) {
  const checks = [
    ...(Array.isArray(data?.mustHaveCheck) ? data.mustHaveCheck : []),
    ...(Array.isArray(data?.bonusCheck) ? data.bonusCheck : []),
    ...(Array.isArray(data?.vetoCheck) ? data.vetoCheck : [])
  ];

  const total = checks.length;
  const explicitEvidenceCount = checks.filter(x => hasExplicitEvidence(x?.evidence)).length + (Array.isArray(data?.evidenceQuotes) ? data.evidenceQuotes.filter(Boolean).length : 0);
  const waitingCount = checks.filter(x => String(x?.status || '').includes('待核实')).length;
  const directRatio = total ? explicitEvidenceCount / Math.max(total, 1) : 0;
  const waitingRatio = total ? waitingCount / Math.max(total, 1) : 0;

  let c = clamp(rawConfidence ?? 0, 0, 100);

  // 置信度代表“这次分析有多少证据支撑”，不是“候选人匹配度高不高”。
  // 所以：候选人不匹配，但简历证据清楚，也可以有较高置信度。
  if (total >= 3 && explicitEvidenceCount >= 3) c = Math.max(c, 70);
  if (total >= 5 && explicitEvidenceCount >= 5 && directRatio >= 0.5) c = Math.max(c, 76);
  if (total >= 6 && explicitEvidenceCount >= 7 && directRatio >= 0.65 && waitingRatio <= 0.35) c = Math.max(c, 82);
  if (Array.isArray(data?.evidenceQuotes) && data.evidenceQuotes.length >= 3) c = Math.max(c, 74);

  const completeness = clamp(data?.dataQuality?.resumeCompleteness ?? 0, 0, 100);
  const sufficiency = clamp(data?.dataQuality?.evidenceSufficiency ?? 0, 0, 100);
  if (completeness >= 70 && sufficiency >= 65) c = Math.max(c, 72);
  if (completeness >= 80 && sufficiency >= 75) c = Math.max(c, 80);

  // 限制条件：如果大量项目待核实，或几乎没有证据，不应虚高。
  if (waitingRatio > 0.55) c = Math.min(c, 68);
  if (waitingRatio > 0.75) c = Math.min(c, 58);
  if (explicitEvidenceCount === 0) c = Math.min(c, 55);

  return clamp(Math.round(c), 0, 100);
}

function normalizeChecks(value) {
  if (!Array.isArray(value)) return [];
  return value.map(x => ({
    item: String(x?.item || ''),
    status: String(x?.status || '待核实'),
    evidence: String(x?.evidence || ''),
    reason: String(x?.reason || ''),
    confidence: normalizeCheckConfidence(x)
  })).filter(x => x.item);
}



function containsAnyTerm(text, terms) {
  const s = String(text || '').toLowerCase();
  return terms.some(t => s.includes(String(t).toLowerCase()));
}

function hasSalesLikeEvidence(text) {
  const terms = [
    'sales',
    'selling',
    'sell ',
    'sold ',
    'revenue target',
    'revenue targets',
    'quota',
    'pipeline',
    'negotiation',
    'deal',
    'deals',
    'commercial',
    'business development',
    'account executive',
    'sales manager',
    '销售',
    '售卖',
    '售前销售',
    '商务拓展',
    '业务拓展',
    '营收',
    '收入目标',
    '销售目标',
    '销售额',
    '客户拓展',
    '成交',
    '合同',
    '谈判',
    '大客户'
  ];
  return containsAnyTerm(text, terms);
}

function claimsNoSalesExperience(item) {
  const text = [
    item?.item,
    item?.status,
    item?.evidence,
    item?.reason
  ].join(' ').toLowerCase();

  const salesTerms = ['sales', 'selling', 'sell', 'revenue', 'quota', 'pipeline', '销售', '售卖', '营收', '收入', '客户拓展', '成交', '商务拓展'];
  const negativeTerms = ['没有', '无', '缺少', '不具备', '未体现', '未显示', 'no ', 'not ', 'lack', 'without'];

  return containsAnyTerm(text, salesTerms) && containsAnyTerm(text, negativeTerms);
}

function reconcileContradictoryVeto(result, contextText = '') {
  const outputEvidenceCorpus = [
    contextText,
    ...(Array.isArray(result?.evidenceQuotes) ? result.evidenceQuotes : []),
    ...(Array.isArray(result?.matchedPoints) ? result.matchedPoints : []),
    ...(Array.isArray(result?.riskPoints) ? result.riskPoints : []),
    ...(Array.isArray(result?.missingPoints) ? result.missingPoints : [])
  ].join('\n');

  const warnings = [];
  const salesEvidenceExists = hasSalesLikeEvidence(outputEvidenceCorpus);
  const vetoCheck = Array.isArray(result?.vetoCheck) ? result.vetoCheck : [];

  if (!salesEvidenceExists) {
    return { ...result, consistencyWarnings: arr(result?.consistencyWarnings) };
  }

  const fixedVeto = vetoCheck.map(item => {
    const status = String(item?.status || '');
    if (status.includes('命中') && claimsNoSalesExperience(item)) {
      const originalReason = String(item.reason || '');
      warnings.push('系统发现简历中存在 sales/selling/revenue/negotiation 等销售相关证据，但模型同时判定“没有Sales经历”并命中一票否决。已自动降级为待核实，请人工确认是否为岗位要求的直接销售责任。');
      return {
        ...item,
        status: '待核实',
        evidence: item.evidence && item.evidence !== '无明确证据'
          ? item.evidence
          : '存在销售相关表达，需要人工确认是否满足直接Sales/Quota要求。',
        reason: `原判断可能与简历销售相关证据冲突，不能直接按一票否决处理。${originalReason ? '原原因：' + originalReason : ''}`,
        confidence: Math.min(Number(item.confidence || 55), 55)
      };
    }
    return item;
  });

  const riskPoints = arr(result?.riskPoints).map(x => {
    const s = String(x || '');
    if (claimsNoSalesExperience({ item: s, reason: s }) && salesEvidenceExists) {
      return `【需复核】${s}（注意：简历中存在 sales/selling/revenue/negotiation 等销售相关证据，不能直接等同于“无Sales经历”。）`;
    }
    return s;
  });

  const verificationItems = [
    ...arr(result?.verificationItems),
    ...warnings
  ];

  return {
    ...result,
    vetoCheck: fixedVeto,
    riskPoints,
    verificationItems: [...new Set(verificationItems)],
    consistencyWarnings: [...new Set([...(arr(result?.consistencyWarnings)), ...warnings])]
  };
}


function normalizeCandidateProfile(profile) {
  const p = profile && typeof profile === 'object' ? profile : {};
  const timeline = Array.isArray(p.educationTimeline) ? p.educationTimeline.map(x => String(x)).filter(Boolean) : [];
  return {
    nameFromResume: String(p.nameFromResume || ''),
    ageEstimate: String(p.ageEstimate || '待推断'),
    ageRange: String(p.ageRange || '待推断'),
    ageConfidence: clamp(p.ageConfidence ?? 0, 0, 100),
    ageInferenceBasis: String(p.ageInferenceBasis || '简历年份信息不足，无法可靠推断。'),
    educationTimeline: timeline,
    firstFullTimeWorkYear: String(p.firstFullTimeWorkYear || ''),
    ageWarning: String(p.ageWarning || '年龄为基于教育年份与工作年份的粗略推断，仅供初筛参考，不应作为录用或淘汰依据。')
  };
}



function isVetoHit(item) {
  return String(item?.status || '').includes('命中');
}

function isVetoUnclear(item) {
  return String(item?.status || '').includes('待核实');
}

function chooseRecommendationByScore(score, passLine) {
  if (score >= 85) return '优先推进';
  if (score >= passLine) return '建议推进';
  if (score >= 65) return '作为储备';
  return '不建议推进';
}

function containsVetoLanguage(text) {
  return /一票否决|否决|没有\s*Sales|无\s*Sales|没有销售|无销售|缺少销售|不具备销售/i.test(String(text || ''));
}

function softenContradictoryText(text, vetoHitCount, vetoUnclearCount) {
  let s = String(text || '');
  if (!s || vetoHitCount > 0) return s;

  s = s
    .replace(/命中一票否决/g, '存在一票否决待核实风险')
    .replace(/一票否决\s*[：:]\s*[1-9]\d*\s*项/g, `一票否决命中：0项，待核实：${vetoUnclearCount}项`)
    .replace(/一票否决\s*[1-9]\d*\s*项/g, `一票否决命中0项，待核实${vetoUnclearCount}项`)
    .replace(/因一票否决/g, '因关键风险待核实')
    .replace(/直接否决/g, '需人工复核');

  return s;
}

function finalizeResultConsistency(result, passLine) {
  const vetoCheck = Array.isArray(result?.vetoCheck) ? result.vetoCheck : [];
  const vetoHitCount = vetoCheck.filter(isVetoHit).length;
  const vetoUnclearCount = vetoCheck.filter(isVetoUnclear).length;
  const warnings = arr(result?.consistencyWarnings);

  let recommendation = String(result.recommendation || chooseRecommendationByScore(result.score, passLine));
  let level = String(result.level || '');
  let summary = String(result.summary || '');

  const recMentionsVeto = containsVetoLanguage(recommendation);
  const summaryMentionsVeto = containsVetoLanguage(summary);

  if (vetoHitCount === 0) {
    if (recMentionsVeto && Number(result.score || 0) >= 65) {
      recommendation = chooseRecommendationByScore(Number(result.score || 0), passLine);
      warnings.push('系统发现推荐结论提到一票否决，但 vetoCheck 明细没有任何“命中”项，已按分数规则重新校准推进建议。');
    }

    if (summaryMentionsVeto) {
      summary = softenContradictoryText(summary, vetoHitCount, vetoUnclearCount);
      warnings.push('系统发现摘要中提到一票否决，但 vetoCheck 明细没有任何“命中”项，已修正摘要口径。');
    }
  } else {
    if (recommendation === '优先推进' || recommendation === '建议推进') {
      recommendation = Number(result.score || 0) >= 65 ? '作为储备' : '不建议推进';
      warnings.push('系统发现存在一票否决命中项，但推进建议偏积极，已自动降级。');
    }
  }

  const riskPoints = arr(result.riskPoints).map(x => softenContradictoryText(x, vetoHitCount, vetoUnclearCount));
  const missingPoints = arr(result.missingPoints).map(x => softenContradictoryText(x, vetoHitCount, vetoUnclearCount));

  const logicAudit = {
    vetoHitCount,
    vetoUnclearCount,
    vetoNotHitCount: vetoCheck.filter(x => String(x?.status || '').includes('未命中')).length,
    riskPointCount: riskPoints.length,
    missingPointCount: missingPoints.length,
    rule: '一票否决命中数量只来自 vetoCheck.status 包含“命中”的项目；riskPoints 普通风险不计入一票否决命中数量。',
    warning: vetoHitCount === 0 && (recMentionsVeto || summaryMentionsVeto)
      ? '已发现并修正“一票否决结论”和 vetoCheck 明细不一致的问题。'
      : ''
  };

  return {
    ...result,
    recommendation,
    level,
    summary,
    riskPoints,
    missingPoints,
    consistencyWarnings: [...new Set(warnings)],
    logicAudit
  };
}


function normalizeResult(data, passLine, contextText = '') {
  data = reconcileContradictoryVeto(data, contextText);
  const score = clamp(data?.score ?? 0, 0, 100);
  const confidence = calibrateConfidence(data, data?.confidence ?? 0);

  let level = data?.level;
  if (!level) {
    if (score >= 85) level = '强匹配';
    else if (score >= passLine) level = '基本匹配';
    else if (score >= 65) level = '一般匹配';
    else level = '匹配度较低';
  }

  let recommendation = data?.recommendation;
  if (!recommendation) {
    if (score >= 85) recommendation = '优先推进';
    else if (score >= passLine) recommendation = '建议推进';
    else if (score >= 65) recommendation = '作为储备';
    else recommendation = '不建议推进';
  }

  const normalized = {
    candidateName: data?.candidateName || data?.candidateProfile?.nameFromResume || '待识别',
    candidateProfile: normalizeCandidateProfile(data?.candidateProfile),
    score,
    confidence,
    level,
    recommendation,
    summary: data?.summary || '',
    dataQuality: {
      resumeCompleteness: clamp(data?.dataQuality?.resumeCompleteness ?? confidence, 0, 100),
      evidenceSufficiency: clamp(data?.dataQuality?.evidenceSufficiency ?? confidence, 0, 100),
      uncertaintyReason: String(data?.dataQuality?.uncertaintyReason || (confidence >= 70 ? '简历中存在较多可引用证据，分析置信度已按证据充分度校准。' : '证据不足或待核实项较多，置信度偏保守。'))
    },
    mustHaveCheck: normalizeChecks(data?.mustHaveCheck),
    bonusCheck: normalizeChecks(data?.bonusCheck),
    vetoCheck: normalizeChecks(data?.vetoCheck),
    matchedPoints: arr(data?.matchedPoints),
    riskPoints: arr(data?.riskPoints),
    missingPoints: arr(data?.missingPoints),
    verificationItems: arr(data?.verificationItems),
    consistencyWarnings: arr(data?.consistencyWarnings),
    interviewQuestions: arr(data?.interviewQuestions),
    evidenceQuotes: arr(data?.evidenceQuotes),
    scoreBreakdown: {
      sales: clamp(data?.scoreBreakdown?.sales ?? 0, 0, 100),
      industry: clamp(data?.scoreBreakdown?.industry ?? 0, 0, 100),
      account: clamp(data?.scoreBreakdown?.account ?? 0, 0, 100),
      成交: clamp(data?.scoreBreakdown?.成交 ?? 0, 0, 100),
      location: clamp(data?.scoreBreakdown?.location ?? 0, 0, 100),
      language: clamp(data?.scoreBreakdown?.language ?? 0, 0, 100),
      bonus: clamp(data?.scoreBreakdown?.bonus ?? 0, 0, 100),
      overall: clamp(data?.scoreBreakdown?.overall ?? score, 0, 100)
    },
    model: data?.model || 'deepseek-v4-flash',
    modelLabel: data?.modelLabel || data?.model || '深度求索',
    thinkingMode: data?.thinkingMode || '',
    strictnessLevel: clamp(data?.strictnessLevel ?? 3, 1, 5),
    strictnessLabel: data?.strictnessLabel || getStrictnessConfig(data?.strictnessLevel || 3).label,
    usage: normalizeUsage(data?.usage),
    extractionUsage: normalizeUsage(data?.extractionUsage),
    scoringUsage: normalizeUsage(data?.scoringUsage),
    tokenUsageNote: String(data?.tokenUsageNote || ''),
    createdAt: new Date().toISOString()
  };

  return finalizeResultConsistency(normalized, passLine);
}

function buildPrompt(payload) {
  const {
    jobTitle, positionOverview, scoringRule, mustHave, niceToHave, vetoItems,
    extraNotes, resumeText, passLine, strictnessLevel
  } = payload;
  const strictnessInstruction = buildStrictnessInstruction(strictnessLevel || 3);

  return `
请你作为严谨的招聘初筛顾问，按照【用户可编辑岗位标准】评估候选人简历。

重要要求：
1. 必须基于简历原文判断，不允许编造简历中没有的信息。
2. 每个必要项、加分项、一票否决项都要给出“判断 + 简历原文依据 + 原因 + 置信度”。
3. 如果简历没有明确写出证据，请写“待核实”，不要强行判断满足。
4. 对低置信度、证据不足、PDF读取可能不完整的情况，要写入 verificationItems。
5. 评分要严格按照岗位标准，不要因为简历写得漂亮就放宽硬性要求。
6. 输出必须是合法 JSON，不要输出 Markdown。
7. 全局结论必须和明细一致：如果 vetoCheck 全部是“未命中/待核实”，summary、recommendation、riskPoints 不能写“命中一票否决”；riskPoints 只是普通风险，不能等同于一票否决。
8. 必须尽量识别候选人姓名，并在 candidateProfile 中给出大致年龄推断。
9. 年龄推断只能基于简历里的本科/硕士/博士年份、毕业年份、第一份全职工作年份、累计工作年限等信息；不得凭空编造。
10. 年龄只输出“约xx岁”或“约xx-xx岁”这类粗略范围，并写明推断依据与置信度；信息不足时写“待推断”。

【一致性校验规则：必须严格执行】
- 一票否决项只有在简历原文明确证明该否决条件成立时，才能写“命中”。
- 不能因为候选人标题不是 Sales，就直接判定“没有 Sales 经历”。
- 如果简历中出现 sales、selling、revenue targets、quota、pipeline、negotiation、deal、commercial、business development、销售、营收、销售目标、成交、大客户谈判等证据，禁止在一票否决中写“没有Sales经历/无销售经验”。
- 如果这些证据是否属于“直接Sales/Quota承担”不确定，应写“待核实”或“部分满足”，不得写“命中一票否决”。
- 输出 JSON 前必须自检：vetoCheck、riskPoints、missingPoints、evidenceQuotes 之间不能互相矛盾。
- 如果发现“风险/否决判断”和“关键原文依据”存在冲突，必须放入 verificationItems，而不是直接否决。

【置信度校准规则】
- confidence 表示“本次分析是否有充分简历证据支撑”，不是候选人匹配分。
- 候选人匹配度低，但简历证据清楚，也可以给 75-90 的高置信度。
- 候选人匹配度高，但关键证据缺失，才应降低置信度。
- 如果简历内容完整、经历时间线清楚、每个判断都有原文依据，整体 confidence 通常不应低于 75。
- 如果有 3 条以上明确原文证据，且多数必要项能判断为满足/不满足/部分满足，整体 confidence 通常不应低于 70。
- 如果只是部分项待核实，但大部分判断有证据，整体 confidence 不应过低。
- 只有当简历很短、PDF疑似读取不完整、关键字段缺失、大部分检查项都是待核实时，整体 confidence 才应低于 60。
- 单项检查的 confidence 也按证据充分度判断：有原文依据通常 70+；部分证据 60-75；无证据且待核实通常 35-55。

${strictnessInstruction}

【岗位名称】
${jobTitle}

【岗位说明】
${positionOverview}

【必要项 Must-have】
${mustHave.map((x, i) => `${i + 1}. ${x}`).join('\n')}

【加分项 Nice-to-have】
${niceToHave.length ? niceToHave.map((x, i) => `${i + 1}. ${x}`).join('\n') : '无'}

【一票否决 / 强风险项】
${vetoItems.length ? vetoItems.map((x, i) => `${i + 1}. ${x}`).join('\n') : '无'}

【评分规则】
${scoringRule}

【推进规则】
- ${passLine} 分及以上建议推进。
- 85分以上：强匹配，优先推进。
- 75-84分：基本匹配，建议推进但需验证核心风险。
- 65-74分：可作为储备，除非某项特别突出。
- 65分以下：不建议推进。
- 如果命中一票否决项，recommendation 应倾向于“不建议推进”或“作为储备”，并写清原因。

【额外备注】
${extraNotes || '无'}


【候选人姓名与年龄推断规则】
- candidateName 必须优先从简历抬头、姓名字段、LinkedIn姓名、文件内容中识别；无法识别写“待识别”。
- 年龄推断不是硬性评价标准，不得因为年龄本身给候选人加分或扣分。
- 年龄推断只能用于招聘沟通时了解候选人大致资历阶段，必须保守表达。
- 可参考以下经验规则：
  1. 如果有本科毕业年份，可粗略按“本科毕业年龄约22岁”推算。
  2. 如果有硕士毕业年份，可粗略按“硕士毕业年龄约24-26岁”推算。
  3. 如果有博士毕业年份，可粗略按“博士毕业年龄约27-32岁”推算。
  4. 如果只有第一份全职工作年份，可粗略按“开始全职工作年龄约22-24岁”推算。
  5. 如果只有“工作经验X年”，可按当前年份减工作年限，再结合22-24岁起步推断年龄范围。
- 如果教育年份与工作年份互相矛盾，年龄置信度必须降低，并写入 ageWarning 或 verificationItems。
- 当前年份按 2026 年计算。

【候选人简历】
${resumeText}

请严格输出下面这个 JSON 结构：
{
  "candidateName": "候选人姓名，无法识别写待识别",
  "candidateProfile": {
    "nameFromResume": "从简历中识别出的姓名",
    "ageEstimate": "约xx岁/约xx-xx岁/待推断",
    "ageRange": "例如 35-39岁；无法推断写待推断",
    "ageConfidence": 0,
    "ageInferenceBasis": "用一句话说明年龄推断依据，例如：本科2009年毕业，按22岁本科毕业推算，2026年约39岁。",
    "educationTimeline": ["本科：学校/专业/年份", "硕士：学校/专业/年份", "博士：学校/专业/年份"],
    "firstFullTimeWorkYear": "第一份全职工作年份，无法识别写空字符串",
    "ageWarning": "年龄为粗略推断，仅供初筛沟通参考，不作为录用或淘汰依据；如证据不足请说明。"
  },
  "score": 0,
  "confidence": 0,
  "confidenceNote": "置信度代表分析证据可靠度，不代表候选人匹配度；证据充分时，即使分数较低也可以高置信度。",
  "level": "强匹配/基本匹配/一般匹配/匹配度较低",
  "recommendation": "优先推进/建议推进/作为储备/不建议推进",
  "strictnessLevel": 3,
  "strictnessLabel": "3度｜标准推荐",
  "summary": "150字以内总体判断",
  "dataQuality": {
    "resumeCompleteness": 0,
    "evidenceSufficiency": 0,
    "uncertaintyReason": "如果置信度不足，说明原因"
  },
  "mustHaveCheck": [
    {"item": "必要项原文", "status": "满足/部分满足/不满足/待核实", "evidence": "简历原文短引用；没有证据写无明确证据", "reason": "简短原因", "confidence": 0}
  ],
  "bonusCheck": [
    {"item": "加分项原文", "status": "有/部分有/无/待核实", "evidence": "简历原文短引用；没有证据写无明确证据", "reason": "简短原因", "confidence": 0}
  ],
  "vetoCheck": [
    {"item": "一票否决项原文", "status": "命中/未命中/待核实", "evidence": "简历原文短引用；没有证据写无明确证据", "reason": "简短原因", "confidence": 0}
  ],
  "matchedPoints": ["匹配点1"],
  "riskPoints": ["风险点1"],
  "missingPoints": ["缺失点1"],
  "verificationItems": ["需要人工核实的问题1"],
  "interviewQuestions": ["建议面试追问1"],
  "evidenceQuotes": ["最关键的简历原文依据1"],
  "logicAudit": {"vetoHitCount": 0, "vetoUnclearCount": 0, "riskPointCount": 0, "warning": "如有前后矛盾请说明"},
  "scoreBreakdown": {
    "sales": 0,
    "industry": 0,
    "account": 0,
    "成交": 0,
    "location": 0,
    "language": 0,
    "bonus": 0,
    "overall": 0
  }
}`.trim();
}

ipcMain.handle('app:get-default-standard', () => ({
  jobTitle: '某某公司｜某某岗位',
  positionOverview: '某某公司某某岗位。请在这里填写岗位负责的业务范围、目标客户、核心任务、工作地点、业务目标和重点行业。',
  scoringRule: '总分100分：核心经验与年限20分；行业背景20分；客户/项目/业务复杂度15分；关键能力15分；目标市场或工作地点匹配10分；语言或沟通能力10分；目标行业经验5分；其他加分项5分。缺少岗位最关键必要项时，原则上不建议推进。',
  mustHave: [
    '必须具备岗位要求中的核心工作经验，简历中需要体现具体职责、成果或项目证据。',
    '必须满足岗位要求的最低年限或资历阶段。',
    '必须具备完整的关键业务流程经验，例如从需求识别、方案推进到结果交付。',
    '必须具备目标客户、目标项目或目标业务场景相关经验。',
    '必须具备岗位要求的沟通、协作和跨团队推进能力。',
    '必须满足岗位要求中的语言、地点、行业或资质等硬性条件。',
    '必须体现结果导向，简历中最好有可验证的业绩、项目成果或量化指标。'
  ],
  niceToHave: [
    '有目标行业头部公司、同类公司或相近业务经验优先。',
    '有复杂项目、重点客户、高价值合同或核心业务场景经验优先。',
    '有岗位相关工具、平台、系统、产品或方法论经验优先。',
    '有管理经验、跨区域协作经验或团队推进经验优先。',
    '有人工智能、数据化、自动化或数字化转型相关经验优先。',
    '有可量化成果、明确奖项、认证或标杆案例优先。'
  ],
  vetoItems: [
    '没有岗位最关键的核心经验。',
    '不满足岗位明确要求的语言、地点、资质或行业硬性条件。',
    '简历内容与岗位方向明显不相关。',
    '关键经历无法提供任何原文证据，且需要大量主观推断。'
  ]
}));

ipcMain.handle('app:get-deepseek-models', () => DEEPSEEK_MODELS);

ipcMain.handle('settings:load-key', () => {
  const settings = readJson('settings.json', {});
  const apiKey = getStoredApiKey(settings);
  // 读取旧版明文密钥时，自动迁移为 safeStorage 加密密钥。
  if (settings.apiKey && canUseSafeStorage()) {
    setStoredApiKey(settings, settings.apiKey);
    writeJson('settings.json', settings);
  }
  return {
    apiKey,
    modelKey: settings.modelKey || 'deepseek-reasoner:',
    strictnessLevel: settings.strictnessLevel || 3,
    apiKeyStorage: settings.apiKeyStorage || (settings.apiKey ? 'plain' : 'none')
  };
});

ipcMain.handle('settings:save-key', (event, apiKey) => {
  const key = String(apiKey || '').trim();
  if (!key) throw new Error('请先输入深度求索接口密钥。');
  if (!key.startsWith('sk-')) throw new Error('这个密钥看起来格式不太对。深度求索接口密钥通常以 sk- 开头。');
  const settings = readJson('settings.json', {});
  setStoredApiKey(settings, key);
  writeJson('settings.json', settings);
  return { ok: true };
});

ipcMain.handle('settings:clear-key', () => {
  const settings = readJson('settings.json', {});
  removeStoredApiKey(settings);
  writeJson('settings.json', settings);
  return { ok: true };
});

ipcMain.handle('settings:save-model', (event, modelKey) => {
  const settings = readJson('settings.json', {});
  settings.modelKey = String(modelKey || 'deepseek-reasoner:');
  writeJson('settings.json', settings);
  return { ok: true };
});

ipcMain.handle('settings:save-strictness', (event, level) => {
  const settings = readJson('settings.json', {});
  settings.strictnessLevel = Math.max(1, Math.min(5, Number(level || 3)));
  writeJson('settings.json', settings);
  return { ok: true };
});

ipcMain.handle('standard:load', () => readJson('standard.json', null));
ipcMain.handle('standard:save', (event, standard) => {
  writeJson('standard.json', standard);
  return { ok: true };
});
ipcMain.handle('standard:clear', () => {
  const file = dataPath('standard.json');
  if (fs.existsSync(file)) fs.unlinkSync(file);
  return { ok: true };
});

ipcMain.handle('resume:select-and-parse', async () => {
  try {
    const result = await dialog.showOpenDialog({
      title: '选择候选人简历',
      properties: ['openFile'],
      filters: [
        { name: '简历文件', extensions: ['pdf', 'docx', 'txt', 'md'] },
        { name: '全部文件', extensions: ['*'] }
      ]
    });

    if (result.canceled || !result.filePaths?.length) return { canceled: true };
    return await parseResumeFile(result.filePaths[0]);
  } catch (err) {
    const msg = err && err.message ? err.message : String(err);
    throw new Error('简历读取失败：' + msg);
  }
});


ipcMain.handle('profile:select-and-extract', async (event, payload = {}) => {
  const settings = readJson('settings.json', {});
  const apiKey = String(payload.apiKey || settings.apiKey || '').trim();
  if (!apiKey) throw new Error('请先输入并保存接口密钥，再进行个人主页PDF/图片双通道预提取。');

  const modelKey = String(payload.modelKey || settings.modelKey || 'deepseek-reasoner:');
  const modelConfig = getModelConfig(modelKey);
  const strictnessConfig = getStrictnessConfig(payload.strictnessLevel || settings.strictnessLevel || 3);

  const result = await dialog.showOpenDialog({
    title: '选择候选人个人主页PDF、简历PDF或截图图片（图片最多9张）',
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: '候选人资料', extensions: ['pdf', 'docx', 'txt', 'md', 'png', 'jpg', 'jpeg', 'webp'] },
      { name: 'PDF / Word / 文本', extensions: ['pdf', 'docx', 'txt', 'md'] },
      { name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp'] },
      { name: '全部文件', extensions: ['*'] }
    ]
  });

  if (result.canceled || !result.filePaths?.length) return { canceled: true };

  const files = result.filePaths;
  const imageFiles = files.filter(isImageFile);
  if (imageFiles.length > 9) throw new Error('图片最多支持上传9张。请减少截图数量后重新上传。');

  const textBlocks = [];
  const ocrBlocks = [];
  const warnings = [];
  const filenames = files.map(safeBaseName);
  const ocrResults = [];

  for (const filePath of files) {
    if (isImageFile(filePath)) {
      const ocr = await ocrImageFile(filePath);
      ocrResults.push(ocr);
      if (ocr.text) {
        ocrBlocks.push(`【图片OCR：${ocr.filename}｜OCR置信度约${ocr.confidence || 0}%】\n${ocr.text.slice(0, 20000)}`);
        if (ocr.confidence && ocr.confidence < 45) {
          warnings.push(`${ocr.filename}：OCR置信度较低，建议人工核对截图内容。`);
        }
      } else {
        warnings.push(`${ocr.filename}：本地OCR未能读取到有效文字。${ocr.error ? '原因：' + ocr.error : ''}`);
      }
      continue;
    }

    try {
      const parsed = await parseResumeFile(filePath);
      if (parsed.text) {
        textBlocks.push(`【文件：${parsed.filename}】\n${parsed.text.slice(0, 45000)}`);
      }
      if (parsed.warning) warnings.push(`${parsed.filename}：${parsed.warning}`);
    } catch (err) {
      warnings.push(`${safeBaseName(filePath)}：${err.message || String(err)}`);
    }
  }

  if (!textBlocks.length && !ocrBlocks.length) {
    throw new Error('没有可用于预提取的文字资料。请上传可复制文字的PDF/Word/TXT，或上传清晰PNG/JPG/WEBP截图。');
  }

  const prompt = buildProfileExtractionPrompt({ textBlocks, ocrBlocks, imageCount: imageFiles.length, filenames });

  const aiResult = await requestDeepSeek({
    apiKey,
    modelConfig,
    temperature: Math.min(0.2, strictnessConfig.temperature + 0.05),
    json: true,
    messages: [
      {
        role: 'system',
        content: '你是严谨的候选人资料预提取助手。你必须只输出合法 JSON，不要输出 Markdown。'
      },
      {
        role: 'user',
        content: prompt
      }
    ]
  });

  const parsed = parseModelJson(aiResult.content);
  const normalizedResumeText = cleanText(
    parsed.normalizedResumeText ||
    [
      `候选人姓名：${parsed.candidateName || '待识别'}`,
      `个人标题：${parsed.headline || '待核实'}`,
      `地点：${parsed.location || '待核实'}`,
      `联系方式：${arr(parsed.contact).join('；')}`,
      `语言：${arr(parsed.languages).join('；')}`,
      `教育经历：${arr(parsed.education).join('；')}`,
      `工作经历：${JSON.stringify(parsed.experience || [], null, 2)}`,
      `技能关键词：${arr(parsed.skills).join('；')}`,
      `证书/奖项：${arr(parsed.certifications).join('；')}`,
      `项目/案例：${arr(parsed.projects).join('；')}`,
      `成果：${arr(parsed.achievements).join('；')}`,
      `关键依据：${arr(parsed.sourceEvidence).join('；')}`,
      `待核实：${arr(parsed.uncertainFields).join('；')}`
    ].join('\n')
  );

  const readable = [
    '【AI预提取候选人资料｜双通道】',
    `资料来源：${filenames.join('；')}`,
    `文本通道文件数：${files.length - imageFiles.length}`,
    `图片OCR通道文件数：${imageFiles.length}`,
    `候选人姓名：${parsed.candidateName || '待识别'}`,
    `个人标题/当前职位：${parsed.headline || '待核实'}`,
    `地点：${parsed.location || '待核实'}`,
    '',
    '【联系方式】',
    arr(parsed.contact).join('\n') || '待核实',
    '',
    '【语言】',
    arr(parsed.languages).join('\n') || '待核实',
    '',
    '【教育经历】',
    arr(parsed.education).join('\n') || '待核实',
    '',
    '【工作经历】',
    Array.isArray(parsed.experience) ? parsed.experience.map((x, i) => `${i + 1}. ${x.title || ''}｜${x.company || ''}｜${x.period || ''}｜${x.location || ''}\n${x.description || ''}`).join('\n\n') : '待核实',
    '',
    '【技能/关键词】',
    arr(parsed.skills).join('；') || '待核实',
    '',
    '【证书/奖项】',
    arr(parsed.certifications).join('\n') || '待核实',
    '',
    '【项目/案例】',
    arr(parsed.projects).join('\n') || '待核实',
    '',
    '【成果】',
    arr(parsed.achievements).join('\n') || '待核实',
    '',
    '【关键依据】',
    arr(parsed.sourceEvidence).join('\n') || '待核实',
    '',
    '【待人工核实】',
    arr(parsed.uncertainFields).join('\n') || '无',
    '',
    '【整理版候选人资料】',
    normalizedResumeText
  ].join('\n');

  const usage = normalizeUsage(aiResult.usage);

  return {
    canceled: false,
    filenames,
    imageCount: imageFiles.length,
    textFileCount: files.length - imageFiles.length,
    ocrResults,
    warnings,
    extracted: parsed,
    text: cleanText(readable),
    charCount: cleanText(readable).length,
    extractionUsage: usage,
    model: aiResult.data.model || modelConfig.id,
    modelLabel: modelConfig.label,
    pipeline: '文本通道 + 图片OCR通道 + DeepSeek资料整理'
  };
});

ipcMain.handle('leaderboard:load', () => readJson('leaderboard.json', []));
ipcMain.handle('leaderboard:save', (event, items) => {
  writeJson('leaderboard.json', Array.isArray(items) ? items : []);
  return { ok: true };
});
ipcMain.handle('leaderboard:clear', () => {
  writeJson('leaderboard.json', []);
  return { ok: true };
});


ipcMain.handle('projects:load', () => readJson('projects.json', []));
ipcMain.handle('projects:save', (event, projects) => {
  writeJson('projects.json', Array.isArray(projects) ? projects : []);
  return { ok: true };
});
ipcMain.handle('projects:get-active', () => {
  const settings = readJson('settings.json', {});
  return settings.activeProjectId || '';
});
ipcMain.handle('projects:save-active', (event, projectId) => {
  const settings = readJson('settings.json', {});
  settings.activeProjectId = String(projectId || '');
  writeJson('settings.json', settings);
  return { ok: true };
});

ipcMain.handle('app:open-data-folder', () => shell.openPath(app.getPath('userData')));

ipcMain.handle('app:adjust-zoom', (event, delta) => {
  currentZoomFactor = clampZoom(currentZoomFactor + Number(delta || 0));
  applyZoomToAllWindows();
  saveZoomFactor();
  return { zoomFactor: currentZoomFactor };
});

ipcMain.handle('app:reset-zoom', () => {
  currentZoomFactor = 1;
  applyZoomToAllWindows();
  saveZoomFactor();
  return { zoomFactor: currentZoomFactor };
});

ipcMain.handle('app:get-zoom', () => ({ zoomFactor: currentZoomFactor }));


function safeFileTimestamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function buildBackupObject(options = {}) {
  const includeApiKey = Boolean(options.includeApiKey);
  const settings = readJson('settings.json', {});
  const standard = readJson('standard.json', null);
  const leaderboard = readJson('leaderboard.json', []);
  const projects = readJson('projects.json', []);

  const safeSettings = { ...settings };
  const plainApiKey = getStoredApiKey(settings);
  delete safeSettings.apiKey;
  delete safeSettings.apiKeyEncrypted;
  safeSettings.apiKeyStorage = 'none';

  if (includeApiKey && plainApiKey) {
    // 备份跨电脑导入时无法解密本机 safeStorage 密文，所以只有用户明确选择时才导出明文。
    safeSettings.apiKey = plainApiKey;
    safeSettings.apiKeyStorage = 'plain-backup';
  }

  return {
    appName: APP_NAME,
    appId: 'com.resume.ai.screener',
    appVersion: app.getVersion(),
    backupVersion: 1,
    backupTime: new Date().toISOString(),
    apiKeyIncluded: includeApiKey && Boolean(plainApiKey),
    settings: safeSettings,
    standard,
    projects: Array.isArray(projects) ? projects : [],
    leaderboard: Array.isArray(leaderboard) ? leaderboard : [],
    meta: {
      note: includeApiKey
        ? '该备份可能包含深度求索接口密钥，请勿分享给他人。'
        : '该备份不包含深度求索接口密钥。',
      exportedFrom: process.platform
    }
  };
}

function validateBackupObject(data) {
  if (!data || typeof data !== 'object') {
    throw new Error('备份文件格式不正确。');
  }
  if (!data.backupVersion) {
    throw new Error('这不是有效的本应用备份文件：缺少 backupVersion。');
  }
  if (data.backupVersion > 1) {
    throw new Error('备份文件版本高于当前应用支持版本，请先升级应用。');
  }
  return true;
}

ipcMain.handle('backup:export', async (event, options = {}) => {
  const includeApiKey = Boolean(options.includeApiKey);
  const defaultPath = path.join(
    app.getPath('documents'),
    `resume-screener-backup-${safeFileTimestamp()}${includeApiKey ? '-with-key' : ''}.json`
  );

  const result = await dialog.showSaveDialog({
    title: '导出完整数据备份',
    defaultPath,
    filters: [
      { name: '数据备份文件', extensions: ['json'] }
    ]
  });

  if (result.canceled || !result.filePath) {
    return { canceled: true };
  }

  const backup = buildBackupObject({ includeApiKey });
  fs.writeFileSync(result.filePath, JSON.stringify(backup, null, 2), 'utf-8');

  return {
    ok: true,
    filePath: result.filePath,
    apiKeyIncluded: backup.apiKeyIncluded,
    leaderboardCount: backup.leaderboard.length,
    projectCount: Array.isArray(backup.projects) ? backup.projects.length : 0,
    hasStandard: Boolean(backup.standard)
  };
});

ipcMain.handle('backup:import', async () => {
  const result = await dialog.showOpenDialog({
    title: '导入完整数据备份',
    properties: ['openFile'],
    filters: [
      { name: '数据备份文件', extensions: ['json'] },
      { name: '全部文件', extensions: ['*'] }
    ]
  });

  if (result.canceled || !result.filePaths?.length) {
    return { canceled: true };
  }

  const filePath = result.filePaths[0];
  const raw = fs.readFileSync(filePath, 'utf-8');
  const backup = JSON.parse(raw);
  validateBackupObject(backup);

  const currentSettings = readJson('settings.json', {});
  const importedSettings = backup.settings && typeof backup.settings === 'object' ? backup.settings : {};
  const currentApiKey = getStoredApiKey(currentSettings);
  const importedApiKey = String(importedSettings.apiKey || '').trim();

  const mergedSettings = {
    ...currentSettings,
    ...importedSettings
  };

  // 先移除备份中的明文或旧密文，再按当前电脑能力重新保存。
  removeStoredApiKey(mergedSettings);

  // 如果导入的备份不包含接口密钥，则保留当前电脑已有密钥；如果包含，则重新加密保存。
  setStoredApiKey(mergedSettings, importedApiKey || currentApiKey);

  writeJson('settings.json', mergedSettings);

  if (Object.prototype.hasOwnProperty.call(backup, 'standard')) {
    if (backup.standard) writeJson('standard.json', backup.standard);
    else {
      const standardFile = dataPath('standard.json');
      if (fs.existsSync(standardFile)) fs.unlinkSync(standardFile);
    }
  }

  if (Array.isArray(backup.leaderboard)) {
    writeJson('leaderboard.json', backup.leaderboard);
  }

  if (Array.isArray(backup.projects) && backup.projects.length) {
    writeJson('projects.json', backup.projects);
    const firstProject = backup.projects[0];
    if (firstProject?.id) {
      const settingsAfterProject = readJson('settings.json', {});
      settingsAfterProject.activeProjectId = firstProject.id;
      writeJson('settings.json', settingsAfterProject);
    }
  } else {
    // 兼容旧版备份：旧版备份没有 projects 字段，只包含 standard / leaderboard。
    // 导入后删除旧 projects.json，让前端启动时自动把 standard + leaderboard 迁移成一个默认项目。
    const projectsFile = dataPath('projects.json');
    if (fs.existsSync(projectsFile)) fs.unlinkSync(projectsFile);
    const settingsAfterLegacyImport = readJson('settings.json', {});
    delete settingsAfterLegacyImport.activeProjectId;
    writeJson('settings.json', settingsAfterLegacyImport);
  }

  return {
    ok: true,
    filePath,
    apiKeyImported: Boolean(importedSettings.apiKey),
    apiKeyPreserved: Boolean(!importedSettings.apiKey && currentSettings.apiKey),
    hasStandard: Boolean(backup.standard),
    leaderboardCount: Array.isArray(backup.leaderboard) ? backup.leaderboard.length : 0,
    projectCount: Array.isArray(backup.projects) ? backup.projects.length : 0,
    backupTime: backup.backupTime || ''
  };
});


ipcMain.handle('ai:analyze', async (event, payload) => {
  const settings = readJson('settings.json', {});
  const apiKey = String(payload.apiKey || settings.apiKey || '').trim();
  if (!apiKey) throw new Error('请先输入并保存深度求索接口密钥。');

  const resumeText = cleanText(payload.resumeText);
  if (!resumeText) throw new Error('简历正文为空。请先读取简历或直接粘贴简历正文。');

  const passLine = Number(payload.passLine || 75);
  const strictnessConfig = getStrictnessConfig(payload.strictnessLevel || settings.strictnessLevel || 3);
  settings.strictnessLevel = strictnessConfig.level;
  const prompt = buildPrompt({ ...payload, resumeText, passLine, strictnessLevel: strictnessConfig.level });

  const modelKey = String(payload.modelKey || settings.modelKey || 'deepseek-v4-flash:enabled');
  const modelConfig = getModelConfig(modelKey);
  settings.modelKey = modelKey;
  writeJson('settings.json', settings);

  const requestBody = {
    model: modelConfig.id,
    messages: [
      {
        role: 'system',
        content: '你是严谨的中文招聘评估助手。你必须只输出合法 JSON，不要输出 Markdown，不要输出多余解释。'
      },
      { role: 'user', content: prompt }
    ],
    temperature: strictnessConfig.temperature,
    stream: false,
    response_format: { type: 'json_object' }
  };

  if (modelConfig.thinking === 'enabled' || modelConfig.thinking === 'disabled') {
    requestBody.thinking = { type: modelConfig.thinking };
  }

  const response = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + apiKey
    },
    body: JSON.stringify(requestBody)
  });

  const raw = await response.text();
  if (!response.ok) {
    throw new Error('深度求索接口请求失败：' + raw.slice(0, 800));
  }

  const data = JSON.parse(raw);
  const content = data.choices?.[0]?.message?.content || '';
  const parsed = parseModelJson(content);

  const extractionUsage = normalizeUsage(payload.preExtractionUsage || {});
  const scoringUsage = normalizeUsage(data.usage || {});
  const combinedUsage = mergeUsage(extractionUsage, scoringUsage);

  return normalizeResult({
    ...parsed,
    model: data.model || modelConfig.id,
    modelLabel: modelConfig.label,
    thinkingMode: modelConfig.thinking || '',
    strictnessLevel: strictnessConfig.level,
    strictnessLabel: strictnessConfig.label,
    extractionUsage,
    scoringUsage,
    usage: combinedUsage,
    tokenUsageNote: extractionUsage.totalTokens > 0
      ? '总令牌已合并：候选人资料AI预提取 + 岗位匹配深度评分。'
      : '总令牌为岗位匹配深度评分消耗。'
  }, passLine, resumeText);
});
