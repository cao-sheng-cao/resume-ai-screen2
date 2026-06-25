# v1.0.29 工程整理说明

本版本目标是降低 vibe slop 风险，而不是继续堆新功能。

## 已完成

- JSON 原子写入
- Electron safeStorage API Key 加密保存
- 旧版明文 API Key 自动迁移
- 备份默认移除 API Key 与 safeStorage 密文
- 项目内 candidates 与 leaderboard 分离
- 新增 scripts/selfcheck.js
- 新增 npm run selfcheck / npm run check

## 仍建议后续做

- 拆分 renderer.js
- 拆分 main.js
- 引入 SQLite
- 在 GitHub Actions 中加入 npm run check
- 增加端到端测试
