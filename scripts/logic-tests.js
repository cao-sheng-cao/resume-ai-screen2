const assert = require('assert');

function isExplicitVetoHitStatus(status) {
  const s = String(status || '').replace(/\s+/g, '').trim();
  if (!s) return false;
  if (s.includes('未命中') || s.includes('不命中') || s.includes('没有命中') || s.includes('未发现命中')) return false;
  return s === '命中' || s.startsWith('命中') || s.includes('已命中') || s.includes('明确命中');
}

function isExplicitVetoNotHitStatus(status) {
  const s = String(status || '').replace(/\s+/g, '').trim();
  return s.includes('未命中') || s.includes('不命中') || s.includes('没有命中') || s.includes('未发现命中');
}

function chooseRecommendationByScore(score, passLine) {
  if (score >= 85) return '优先推进';
  if (score >= passLine) return '建议推进';
  if (score >= 65) return '作为储备';
  return '不建议推进';
}

function containsAffirmativeVetoHitLanguage(text) {
  const s = String(text || '');
  if (!s) return false;
  const negativePatterns = [
    /未命中一票否决/,
    /没有命中一票否决/,
    /未发现一票否决/,
    /一票否决命中\s*[：:]\s*0\s*项/,
    /一票否决\s*[：:]\s*0\s*项/
  ];
  if (negativePatterns.some(p => p.test(s))) return false;
  return /命中一票否决|因一票否决|直接否决|一票否决\s*[：:]\s*[1-9]\d*\s*项|一票否决\s*[1-9]\d*\s*项/i.test(s);
}

const hitTrue = ['命中', '命中风险', '已命中', '明确命中', '命中：缺少硬性资质'];
const hitFalse = ['未命中', '不命中', '没有命中', '未发现命中', '待核实', '部分满足', '未 命中'];

hitTrue.forEach(x => assert.strictEqual(isExplicitVetoHitStatus(x), true, `${x} 应为命中`));
hitFalse.forEach(x => assert.strictEqual(isExplicitVetoHitStatus(x), false, `${x} 不应为命中`));

['未命中', '不命中', '没有命中', '未发现命中'].forEach(x => {
  assert.strictEqual(isExplicitVetoNotHitStatus(x), true, `${x} 应为未命中`);
});

assert.strictEqual(containsAffirmativeVetoHitLanguage('一票否决命中：0项'), false);
assert.strictEqual(containsAffirmativeVetoHitLanguage('未命中一票否决'), false);
assert.strictEqual(containsAffirmativeVetoHitLanguage('命中一票否决'), true);
assert.strictEqual(containsAffirmativeVetoHitLanguage('一票否决：2项'), true);

assert.strictEqual(chooseRecommendationByScore(90, 75), '优先推进');
assert.strictEqual(chooseRecommendationByScore(76, 75), '建议推进');
assert.strictEqual(chooseRecommendationByScore(68, 75), '作为储备');
assert.strictEqual(chooseRecommendationByScore(50, 75), '不建议推进');

console.log('逻辑语义测试通过：一票否决命中、未命中、推荐分档和一票否决语言均符合预期。');
