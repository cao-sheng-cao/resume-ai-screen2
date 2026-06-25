const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const exists = (file) => fs.existsSync(path.join(root, file));

const files = {
  pkg: 'package.json',
  mainEntry: 'main.js',
  main: 'src/main/main.js',
  preload: 'src/main/preload.js',
  html: 'src/renderer/index.html',
  renderer: 'src/renderer/renderer.js',
  layoutModule: 'src/renderer/modules/layout-controls.js',
  resultHighlightsModule: 'src/renderer/modules/result-highlights.js',
  candidateDataModule: 'src/renderer/modules/candidate-data.js',
  candidateActionsModule: 'src/renderer/modules/candidate-actions.js',
  candidateCardsModule: 'src/renderer/modules/candidate-cards.js',
  css: 'src/renderer/styles.css',
  storageService: 'src/main/services/storage.js',
  aiClientService: 'src/main/services/ai-client.js',
  secureSettingsService: 'src/main/services/secure-settings.js',
  workflow: '.github/workflows/build-windows.yml'
};

const results = [];
function check(name, condition, detail = '') {
  results.push({ name, ok: Boolean(condition), detail });
}

for (const file of Object.values(files)) {
  check(`文件存在：${file}`, exists(file));
}

for (const file of [files.mainEntry, files.main, files.preload, files.renderer, files.layoutModule, files.resultHighlightsModule, files.candidateDataModule, files.candidateActionsModule, files.candidateCardsModule, files.storageService, files.aiClientService, files.secureSettingsService]) {
  try {
    execFileSync(process.execPath, ['--check', path.join(root, file)], { stdio: 'pipe' });
    check(`JS语法：${file}`, true);
  } catch (err) {
    check(`JS语法：${file}`, false, String(err.stderr || err.message || err).slice(0, 500));
  }
}

const pkg = JSON.parse(read(files.pkg));
const main = read(files.main);
const preload = read(files.preload);
const html = read(files.html);
const renderer = read(files.renderer);
const css = read(files.css);
const layoutModule = read(files.layoutModule);
const resultHighlightsModule = read(files.resultHighlightsModule);
const candidateDataModule = read(files.candidateDataModule);
const candidateActionsModule = read(files.candidateActionsModule);
const candidateCardsModule = read(files.candidateCardsModule);
const storageService = read(files.storageService);
const aiClientService = read(files.aiClientService);
const secureSettingsService = read(files.secureSettingsService);
const workflow = read(files.workflow);

const badTerms = [
  'path.常驻name',
  'get深度求索Models',
  'export排行榜表格',
  'total令牌s',
  'prompt令牌s',
  '兼容兼容',
  'async async function'
];
const badFound = badTerms.filter(t => [main, preload, html, renderer, layoutModule, resultHighlightsModule, candidateDataModule, candidateActionsModule, candidateCardsModule, storageService, aiClientService, secureSettingsService].some(text => text.includes(t)));
check('历史误替换残留', badFound.length === 0, badFound.join(', '));

const ids = new Set([...html.matchAll(/id="([^"]+)"/g)].map(m => m[1]));
const usedIds = new Set([...renderer.matchAll(/\$\('([^']+)'\)/g)].map(m => m[1]));
const missingIds = [...usedIds].filter(id => !ids.has(id));
check('HTML ID 与前端调用对应', missingIds.length === 0, missingIds.join(', '));

const buttons = [...html.matchAll(/<button[^>]+id="([^"]+)"/g)].map(m => m[1]);
const bound = new Set([...renderer.matchAll(/\$\('([^']+)'\)\.on(?:click|change|input)\s*=/g)].map(m => m[1]));
const dynamicButtons = new Set(['toggleKeyBtn', 'dangerConfirmCancelBtn', 'dangerConfirmOkBtn']);
const unbound = buttons.filter(id => !bound.has(id) && !dynamicButtons.has(id));
check('按钮绑定', unbound.length === 0, unbound.join(', '));

const preloadChannels = [...preload.matchAll(/ipcRenderer\.invoke\(['"]([^'"]+)/g)].map(m => m[1]);
const handlers = new Set([...main.matchAll(/ipcMain\.handle\(['"]([^'"]+)/g)].map(m => m[1]));
const missingHandlers = preloadChannels.filter(ch => !handlers.has(ch));
check('IPC接口对应', missingHandlers.length === 0, missingHandlers.join(', '));

check('原子写入', storageService.includes('.tmp-') && storageService.includes('renameSync'));
check('safeStorage密钥存储', main.includes("./services/secure-settings") && secureSettingsService.includes('function setStoredApiKey') && secureSettingsService.includes('function getStoredApiKey') && secureSettingsService.includes('apiKeyEncrypted'));
check('密钥函数已导入', main.includes('setStoredApiKey') && main.includes('getStoredApiKey') && main.includes('removeStoredApiKey') && main.includes("require('./services/secure-settings')"));
check('候选人卡片与排行榜数据分离', renderer.includes('let candidates') && candidateDataModule.includes('migrateCandidates') && renderer.includes('p.candidates'));
check('双通道OCR预提取', main.includes('async function ocrImageFile') && main.includes('ocrBlocks') && !main.includes('image_url'));
check('严格度隔离排行榜', renderer.includes('String(x.strictnessLevel || 3) !== strictness'));
check('ChatGPT式候选人卡片', html.includes('candidateCards') && candidateCardsModule.includes('renderCandidateCards') && css.includes('analysis-card'));
check('GitHub Actions工作流', workflow.includes('Build Windows Installer') && workflow.includes('electron-builder'));
check('归类颜色标签', candidateDataModule.includes('categoryClass') && candidateCardsModule.includes('categoryBadgeHtml') && css.includes('category-priority') && css.includes('category-reject'));
check('评分历史对比', candidateDataModule.includes('buildScoreStability') && renderer.includes('scoreHistory') && candidateCardsModule.includes('scoreDeltaWarning'));
check('评分差异提醒', resultHighlightsModule.includes('renderScoreTrust') && resultHighlightsModule.includes('maxDelta') && html.includes('scoreDeltaText'));
check('证据覆盖率', resultHighlightsModule.includes('calculateEvidenceCoverage') && html.includes('evidenceCoverageText') && css.includes('score-trust-panel'));
check('渲染模块拆分', html.includes('modules/layout-controls.js') && candidateCardsModule.includes('renderCandidateCards') && resultHighlightsModule.includes('renderPriorityHighlights'));
check('主进程服务拆分', main.includes("./services/storage") && main.includes("./services/ai-client") && storageService.includes('module.exports') && aiClientService.includes('module.exports'));
check('版本号', pkg.version === '1.0.33' && html.includes('v1.0.33'));

for (const r of results) {
  console.log(`${r.ok ? '通过' : '失败'} - ${r.name}${r.detail ? `：${r.detail}` : ''}`);
}

const failed = results.filter(r => !r.ok);
if (failed.length) {
  console.error(`\n自检失败：${failed.length} 项`);
  process.exit(1);
}
console.log('\n自检通过：全部检查项通过。');
