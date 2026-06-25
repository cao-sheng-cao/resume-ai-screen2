# v1.0.30 模块化拆分说明

本版本完成了 v1.0.29 后续建议中的模块化拆分。

## 主进程拆分

- `src/main/services/storage.js`
  - dataPath
  - readJson
  - writeJson
  - removeJson
  - 原子写入逻辑

- `src/main/services/ai-client.js`
  - DeepSeek API 请求

## 渲染进程拆分

- `src/renderer/modules/layout-controls.js`
  - 页面缩放
  - 左侧功能区折叠
  - 设置区折叠

- `src/renderer/modules/result-highlights.js`
  - 评估结果关键信息突出显示

- `src/renderer/modules/candidate-data.js`
  - candidates 数据迁移
  - 候选人/排行榜同步
  - 当前任务状态栏

- `src/renderer/modules/candidate-actions.js`
  - 复制摘要
  - 复制风险
  - 复制面试追问
  - 导出候选人
  - 快捷标记

- `src/renderer/modules/candidate-cards.js`
  - 项目内候选人卡片渲染
  - 查看完整结果
  - 卡片复制/标记

## 为什么暂时不改 ES Module

当前应用使用传统 Electron + preload + 全局函数方式运行。为了降低回归风险，本次采用传统 script 拆分：

```html
<script src="modules/layout-controls.js"></script>
<script src="modules/result-highlights.js"></script>
<script src="modules/candidate-data.js"></script>
<script src="modules/candidate-actions.js"></script>
<script src="modules/candidate-cards.js"></script>
<script src="renderer.js"></script>
```

这样既减少单文件体积，又尽量不破坏历史功能。

## 后续建议

- 引入统一状态管理。
- 为关键流程增加 E2E 测试。
- 若数据量继续增大，将 JSON 升级为 SQLite。
