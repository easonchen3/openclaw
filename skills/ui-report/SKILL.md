---
name: ui-report
description: 当用户需要把大表格、长时间序列、KPI、异常检测结果、预测结果、分类汇总、占比结构或其他结构化数据生成图表、报表、看板、可视化 UI，且 Markdown 难以阅读或可能撑爆上下文时，使用本 skill。始终优先使用脚本生成路径式 artifact，避免把全量数据或完整 HTML 放进模型上下文。
command-dispatch: tool
command-tool: ui_artifact
command-arg-mode: raw
---

# UI Report

生成通用数据可视化 UI companion。不要把这个 skill 设计成只会折线图的 KPI 页面；它需要根据输入数据的结构、字段语义、数据量和用户意图，自动选择更合适的图表或组件。

优先输出文件路径式 artifact：模型只看小 profile、小 spec、小 pointer；完整数据和完整 HTML 留在磁盘文件里。

## 必守规则

- 不要直接读取超过 50 KB 的原始 JSON、CSV、HTML 到上下文。
- 不要把完整 `html` 字符串粘进回复、工具参数草稿或中间摘要。
- 不要默认渲染全量明细表、几千个 SVG 点或超大 DOM。
- 不要把复杂确定性逻辑写进 SKILL.md；放进 `scripts/`。
- 中文请求默认生成中文 UI；始终输出 UTF-8 HTML。
- 分析结论由模型生成，渲染脚本只负责展示。

## 目标

把输入数据拆成两类处理：

- **短数据**：数据规模小、结构简单、不会撑爆上下文时，可以直接生成 UI HTML。
- **长数据**：必须走两阶段流程，先识别数据形态和元数据，再生成模板，再把完整数据填入模板，避免上下文爆炸。

## 标准流程

1. 定位数据文件。若用户未给路径，优先检查 `skills/ui-report/test_data` 下的样例数据。
2. 检查文件大小。超过 50 KB 时，只运行 profile 脚本，不读全文。
3. 运行 profile 脚本，获取：
   - `detectedShape`
   - `chartRecommendation`
   - `timeMeta`
   - `anomalySummary`
   - `predictionSummary`
4. 若 `detectedShape` 为 `anomaly-series-records`，或 `anomalySummary.hasAnomalyFields=true`，必须按异常分析数据处理：保留原始时序、异常点标记、异常计数摘要。
5. 若输入为 `predicted.json`，或记录中存在 `predictions` 数组，必须按预测数据处理：历史值保留为实线，预测值以未来时间段显示，并与历史段做视觉区分。
6. 模型基于 profile 和用户意图生成：
   - 小 `spec.json`
   - 分析 Markdown
7. 运行 render 脚本生成 `pointer.json` 和最终 HTML。默认不要传 `--html-out`，让脚本把 HTML 写入 canvas 目录。
8. 只读取 `pointer.json` 进入上下文；不要读取完整 HTML。
9. 调用 `ui_artifact` 时优先传 `{ title, summaryMarkdown, htmlPath, canvasUrl, preferredHeight }`。

## 预测数据

- 预测数据常见文件名为 `predicted.json`。
- 每条记录若包含 `predictions` 数组，则表示未来预测值。
- 历史值与预测值必须共用同一指标语义和时间步长。
- 折线图和组合图中，预测值应以未来时间段显示，并与历史值做明显区分。

## 图表选择规则

优先让脚本按数据形态自动选图，不要在上下文里手工拼大段 HTML。

- 时间序列、KPI、监控指标、预测结果、异常分析：优先 `line`
- 多序列时间趋势对比：优先 `combo`
- 按类别比较单个数值：优先 `bar`
- 分类占比且类别不多，通常 `<= 8`：优先 `donut`
- 结构化但不适合图表，或字段语义不明确：回退 `table`

如果用户显式指定图表类型，再通过 `spec.primaryChart.type` 覆盖自动选择。

## 命令

```bash
node skills/ui-report/scripts/profile-json.mjs <data.json> --out <profile.json> [--ref-time <epochMs|ISO>]
node skills/ui-report/scripts/render-report.mjs <data.json> [--spec <spec.json>] --out <pointer.json> [--canvas-root <canvasDir>] [--analysis-md <analysis.md>] [--ref-time <epochMs|ISO>]
```

`--analysis-md` 用于传入模型生成的最终分析 Markdown。render 脚本不会自己产出分析结论。

`--html-out` 只在用户显式要求固定文件名时使用；路径必须位于 canvas root 内，否则 canvas 可能加载不到。

兼容旧式完整 payload 时才加：

```bash
node skills/ui-report/scripts/render-report.mjs <data.json> --spec <spec.json> --out <pointer.json> --payload-out <payload.json>
```

## Spec 最小模板

保持 spec 小于 8 KB，不放原始数组。

```json
{
  "title": "指标报告",
  "language": "zh-CN",
  "intent": "auto",
  "primaryChart": {
    "type": "auto",
    "maxSeries": 8
  },
  "ranking": {
    "by": "max",
    "limit": 8
  },
  "table": {
    "limit": 20
  },
  "preferredHeight": 620
}
```

## Profile 关注点

`profile-json.mjs` 应提供足够小的结构摘要，供模型决定后续 UI，而不是把完整数据读进上下文。重点关注：

- `detectedShape`
- `chartRecommendation.primary`
- `chartRecommendation.component`
- `timeMeta`
- `anomalySummary`
- `predictionSummary`
- `series`

## Pointer 关注点

`render-report.mjs` 默认输出 pointer，而不是完整 HTML。至少检查：

- `htmlPath`
- `canvasUrl`
- `preferredHeight`
- `render.component`
- `render.chartType`
- `render.hostedByCanvas`
- `render.timeMeta`
- `render.anomalySummary`

只把 pointer 读入上下文。不要读取 `htmlPath` 或 `payloadPath` 指向的正文文件。

## 交互式能力

当前 render 输出应支持以下能力，按图表类型启用：

- `line`
  - 缩放
  - 拖拽平移
  - 日期范围切换
  - 自动粒度调整
  - 异常点标记
  - 预测段显示
- `combo`
  - 多序列组合视图
  - 折线加柱形兼容观察
  - 与 `line` 共享时间范围切换和缩放
  - 预测段显示
- `bar`
  - 分类对比
  - 图例与数值显示
- `donut`
  - 构成分析
  - 图例与数值显示
- `table`
  - 关键字段子集展示

页面内优先提供视图切换能力，但必须收敛：每个数据源默认只展示当前最合适的 1 个图表，最多只提供 3 个确实适配该数据的候选图表。不要为了看起来丰富而展示不合适的图表类型。

## UI 输出约束

- 报表型、运营型、数据优先；不要营销页、hero、装饰气泡、重渐变。
- 浅色中性背景、白色面板、系统 sans 字体、克制边框、6-8 px 圆角。
- 第一屏展示标题、关键摘要、主图表。
- 表格只放关键子集，数值对齐，异常高亮克制。
- 图表必须服务于判断：看趋势、看峰谷、看结构、看异常、看预测、看变化。

## 完成前检查

- profile、spec、pointer 进入上下文；原始大数据和完整 HTML 没有进入上下文。
- `pointer.json` 足够小，且包含绝对 `htmlPath`、`canvasUrl`。
- `render.hostedByCanvas` 为 `true`。
- HTML 文件存在、UTF-8、自包含。
- 图表类型选择与数据形态一致，而不是无脑折线图。
