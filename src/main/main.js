const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');

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

function dataPath(filename) {
  const dir = app.getPath('userData');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, filename);
}

function readJson(filename, fallback) {
  try {
    const file = dataPath(filename);
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch {
    return fallback;
  }
}

function writeJson(filename, data) {
  fs.writeFileSync(dataPath(filename), JSON.stringify(data, null, 2), 'utf-8');
  return true;
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

const DEEPSEEK_MODELS = [
  { id: 'deepseek-v4-flash', label: '深度求索第四代极速｜快速评分', thinking: 'disabled', note: '速度快、成本低，适合批量初筛' },
  { id: 'deepseek-v4-flash', label: '深度求索第四代极速｜严谨推理', thinking: 'enabled', note: '默认推荐的严谨模式，适合重点候选人复核' },
  { id: 'deepseek-v4-pro', label: '深度求索第四代专业｜高质量评分', thinking: 'disabled', note: '质量更高、成本更高' },
  { id: 'deepseek-v4-pro', label: '深度求索第四代专业｜高质量推理', thinking: 'enabled', note: '最严谨但更慢、更贵' },
  { id: 'deepseek-chat', label: '旧版对话模型｜兼容快速模式', thinking: '', note: '旧兼容模型名，对应非思考模式' },
  { id: 'deepseek-reasoner', label: '旧版推理模型｜兼容推理模式', thinking: '', note: '旧兼容模型名，对应思考模式' }
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
- 情况A：候选人有云生态/合作伙伴/云市场经验，但没有明确写“直接销售云产品并独立完成客户成交”。
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

function normalizeChecks(value) {
  if (!Array.isArray(value)) return [];
  return value.map(x => ({
    item: String(x?.item || ''),
    status: String(x?.status || '待核实'),
    evidence: String(x?.evidence || ''),
    reason: String(x?.reason || ''),
    confidence: clamp(x?.confidence ?? 0, 0, 100)
  })).filter(x => x.item);
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


function normalizeResult(data, passLine) {
  const score = clamp(data?.score ?? 0, 0, 100);
  const confidence = clamp(data?.confidence ?? 0, 0, 100);

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

  return {
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
      uncertaintyReason: String(data?.dataQuality?.uncertaintyReason || '')
    },
    mustHaveCheck: normalizeChecks(data?.mustHaveCheck),
    bonusCheck: normalizeChecks(data?.bonusCheck),
    vetoCheck: normalizeChecks(data?.vetoCheck),
    matchedPoints: arr(data?.matchedPoints),
    riskPoints: arr(data?.riskPoints),
    missingPoints: arr(data?.missingPoints),
    verificationItems: arr(data?.verificationItems),
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
    createdAt: new Date().toISOString()
  };
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
7. 必须尽量识别候选人姓名，并在 candidateProfile 中给出大致年龄推断。
8. 年龄推断只能基于简历里的本科/硕士/博士年份、毕业年份、第一份全职工作年份、累计工作年限等信息；不得凭空编造。
9. 年龄只输出“约xx岁”或“约xx-xx岁”这类粗略范围，并写明推断依据与置信度；信息不足时写“待推断”。

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
  jobTitle: '腾讯云法国高级战略销售负责人',
  positionOverview: '腾讯云法国/南欧高级战略销售岗。岗位常驻巴黎，负责法国及南欧战略客户开发、云业务收入增长、大客户签约、高价值合同谈判，重点行业包括 零售、电信、电商、游戏。',
  scoringRule: '总分100分：企业销售年限与强度20分；云/科技/数字化行业背景20分；战略大客户经验15分；主动开发与成交能力15分；法国/南欧市场匹配10分；语言能力10分；目标行业经验5分；云厂、人工智能、电商加分5分。缺少 销售、法语、法国或巴黎常驻任一核心项时，原则上不建议推进。',
  mustHave: [
    '必须有明确 企业销售 经历，简历中需体现客户开发、销售指标、合同签约或 收入结果；仅售前、客户成功、市场岗位不算完全满足。',
    '必须有10年以上科技/云计算/数字化领域 企业销售经验。',
    '必须有完整销售周期经验：线索挖掘、潜在客户开发、客户推进、合同签订、账户拓展。',
    '必须有战略大客户或企业级客户管理经验，最好对接 企业高层决策人。',
    '必须英语流利，能进行跨国团队协作和商务沟通。',
    '必须法语熟练，能支持法国客户商务沟通、谈判或高层关系维护。',
    '必须能够 常驻巴黎或法国，或明确愿意 迁往巴黎或法国。',
    '必须体现 主动开发、成交、销售指标/收入结果导向。'
  ],
  niceToHave: [
    '有 主流云厂商或云服务商 等云厂或云服务商销售经验优先。',
    '卖过 基础云服务、平台云服务、内容分发、安全、数据库、人工智能云服务、数据平台、企业软件 等复杂云/数字化解决方案优先。',
    '有法国或南欧战略客户资源优先，尤其是 零售、电信、电商、游戏 行业客户。',
    '有百万欧元级别或复杂高价值合同谈判经验优先。',
    '有 人工智能项目、人工智能基础设施、大语言模型、智能化解决方案经验优先。',
    '有电商行业背景或服务电商客户经验优先。'
  ],
  vetoItems: [
    '没有真正 销售经历，只是售前、技术、产品、客户成功或市场。',
    '不会法语，且无法支持法国本地客户商务沟通。',
    '不能常驻巴黎或法国，也没有法国或南欧市场经验。',
    '没有科技、云计算、数字化或企业软件行业销售经验。'
  ]
}));

ipcMain.handle('app:get-deepseek-models', () => DEEPSEEK_MODELS);

ipcMain.handle('settings:load-key', () => {
  const settings = readJson('settings.json', {});
  return { apiKey: settings.apiKey || '', modelKey: settings.modelKey || 'deepseek-v4-flash:enabled', strictnessLevel: settings.strictnessLevel || 3 };
});

ipcMain.handle('settings:save-key', (event, apiKey) => {
  const key = String(apiKey || '').trim();
  if (!key) throw new Error('请先输入深度求索接口密钥。');
  if (!key.startsWith('sk-')) throw new Error('这个密钥看起来格式不太对。深度求索接口密钥通常以 sk- 开头。');
  const settings = readJson('settings.json', {});
  settings.apiKey = key;
  writeJson('settings.json', settings);
  return { ok: true };
});

ipcMain.handle('settings:clear-key', () => {
  const settings = readJson('settings.json', {});
  delete settings.apiKey;
  writeJson('settings.json', settings);
  return { ok: true };
});

ipcMain.handle('settings:save-model', (event, modelKey) => {
  const settings = readJson('settings.json', {});
  settings.modelKey = String(modelKey || 'deepseek-v4-flash:enabled');
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
  if (!includeApiKey) {
    delete safeSettings.apiKey;
  }

  return {
    appName: APP_NAME,
    appId: 'com.resume.ai.screener',
    appVersion: app.getVersion(),
    backupVersion: 1,
    backupTime: new Date().toISOString(),
    apiKeyIncluded: includeApiKey && Boolean(settings.apiKey),
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
  const mergedSettings = {
    ...currentSettings,
    ...importedSettings
  };

  // 如果导入的备份不包含接口密钥，则保留当前电脑本地已有密钥。
  if (!importedSettings.apiKey && currentSettings.apiKey) {
    mergedSettings.apiKey = currentSettings.apiKey;
  }

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
  return normalizeResult({
    ...parsed,
    model: data.model || modelConfig.id,
    modelLabel: modelConfig.label,
    thinkingMode: modelConfig.thinking || '',
    strictnessLevel: strictnessConfig.level,
    strictnessLabel: strictnessConfig.label,
    usage: data.usage || {}
  }, passLine);
});
