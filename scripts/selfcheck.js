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
  css: 'src/renderer/styles.css',
  workflow: '.github/workflows/build-windows.yml'
};

const results = [];
function check(name, condition, detail = '') {
  results.push({ name, ok: Boolean(condition), detail });
}

for (const file of Object.values(files)) {
  check(`文件存在：${file}`, exists(file));
}

for (const file of [files.mainEntry, files.main, files.preload, files.renderer]) {
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
const badFound = badTerms.filter(t => main.includes(t) || preload.includes(t) || html.includes(t) || renderer.includes(t));
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

check('原子写入', main.includes('.tmp-') && main.includes('renameSync'));
check('safeStorage密钥存储', main.includes('safeStorage') && main.includes('apiKeyEncrypted') && main.includes('getStoredApiKey'));
check('候选人卡片与排行榜数据分离', renderer.includes('let candidates') && renderer.includes('migrateCandidates') && renderer.includes('p.candidates'));
check('双通道OCR预提取', main.includes('async function ocrImageFile') && main.includes('ocrBlocks') && !main.includes('image_url'));
check('严格度隔离排行榜', renderer.includes('String(x.strictnessLevel || 3) !== strictness'));
check('ChatGPT式候选人卡片', html.includes('candidateCards') && renderer.includes('renderCandidateCards') && css.includes('analysis-card'));
check('GitHub Actions工作流', workflow.includes('Build Windows Installer') && workflow.includes('electron-builder'));
check('版本号', pkg.version === '1.0.29' && html.includes('v1.0.29'));

for (const r of results) {
  console.log(`${r.ok ? '通过' : '失败'} - ${r.name}${r.detail ? `：${r.detail}` : ''}`);
}

const failed = results.filter(r => !r.ok);
if (failed.length) {
  console.error(`\n自检失败：${failed.length} 项`);
  process.exit(1);
}
console.log('\n自检通过：全部检查项通过。');
