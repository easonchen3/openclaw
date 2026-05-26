#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const args = process.argv.slice(2);
const rawInput = args[0];
const specIdx = args.indexOf("--spec");
const outIdx = args.indexOf("--out");
const htmlIdx = args.indexOf("--html-out");
const payloadIdx = args.indexOf("--payload-out");
const refTimeIdx = args.indexOf("--ref-time");
const canvasRootIdx = args.indexOf("--canvas-root");
const analysisMdIdx = args.indexOf("--analysis-md");

if (!rawInput) {
  console.error(
    "Usage: node render-report.mjs <data.json> [--spec spec.json] [--out pointer.json] [--html-out report.html] [--payload-out payload.json] [--canvas-root canvasDir] [--ref-time epochMs|ISO]",
  );
  process.exit(2);
}

function resolveUserPath(value) {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) return "";
  if (trimmed === "~") return os.homedir();
  if (trimmed.startsWith("~/") || trimmed.startsWith("~\\")) {
    return path.join(os.homedir(), trimmed.slice(2));
  }
  return path.resolve(trimmed);
}

function findReportDataFile(directory) {
  const candidates = ["anomalies.json", "predicted.json", "analyzed.json"].map((name) =>
    path.join(directory, name),
  );
  return candidates.find(
    (candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile(),
  );
}

function resolveInputPath(value) {
  const trimmed = String(value ?? "").trim();
  const resolved = resolveUserPath(trimmed);
  if (fs.existsSync(resolved)) {
    const stat = fs.statSync(resolved);
    if (stat.isFile()) return resolved;
    if (stat.isDirectory()) {
      const nested = findReportDataFile(resolved);
      if (nested) return nested;
    }
  }

  const sessionDirectory = path.join("/tmp", "noe-kpi-analyst", trimmed);
  const sessionData = findReportDataFile(sessionDirectory);
  if (sessionData) return sessionData;

  const sharedData = findReportDataFile(path.join("/tmp", "noe-kpi-analyst"));
  if (sharedData) return sharedData;

  return resolved;
}

const input = resolveInputPath(rawInput);

const specPath = specIdx >= 0 ? args[specIdx + 1] : "";
const outPath = outIdx >= 0 ? args[outIdx + 1] : "";
const htmlOutPath = htmlIdx >= 0 ? args[htmlIdx + 1] : "";
const payloadOutPath = payloadIdx >= 0 ? args[payloadIdx + 1] : "";
const refTimeRaw = refTimeIdx >= 0 ? args[refTimeIdx + 1] : null;
const canvasRootArg = canvasRootIdx >= 0 ? args[canvasRootIdx + 1] : "";
const analysisMdArg = analysisMdIdx >= 0 ? args[analysisMdIdx + 1] : "";
const refTimeMs = refTimeRaw
  ? /^\d+$/u.test(refTimeRaw)
    ? Number(refTimeRaw)
    : new Date(refTimeRaw).getTime()
  : Date.now();

const spec =
  specPath && fs.existsSync(specPath)
    ? JSON.parse(fs.readFileSync(specPath, "utf8").replace(/^\uFEFF/u, ""))
    : {};
const data = JSON.parse(fs.readFileSync(input, "utf8").replace(/^\uFEFF/u, ""));

const CANVAS_HOST_PATH = "/__openclaw__/canvas";

function resolveStateDir() {
  const override = process.env.OPENCLAW_STATE_DIR?.trim();
  return override ? resolveUserPath(override) : path.join(os.homedir(), ".openclaw");
}

function resolveConfigPath(stateDir) {
  const override = process.env.OPENCLAW_CONFIG_PATH?.trim();
  return override ? resolveUserPath(override) : path.join(stateDir, "openclaw.json");
}

async function parseConfigFile(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return {};
  const raw = fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/u, "");
  try {
    return JSON.parse(raw);
  } catch {
    try {
      const json5 = await import("json5");
      return json5.default.parse(raw);
    } catch {
      return {};
    }
  }
}

async function resolveCanvasRoot() {
  if (canvasRootArg) return path.resolve(resolveUserPath(canvasRootArg));
  const stateDir = resolveStateDir();
  const config = await parseConfigFile(resolveConfigPath(stateDir));
  const configuredRoot =
    isObject(config) && isObject(config.canvasHost) && typeof config.canvasHost.root === "string"
      ? config.canvasHost.root.trim()
      : "";
  return path.resolve(
    configuredRoot ? resolveUserPath(configuredRoot) : path.join(stateDir, "canvas"),
  );
}

function slugify(value) {
  const slug = String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 48);
  return slug || "report";
}

function isPathInside(parent, child) {
  const relative = path.relative(parent, child);
  return Boolean(relative) && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function canvasRelativePath(canvasRoot, filePath) {
  const relative = path.relative(canvasRoot, filePath);
  return relative
    .split(path.sep)
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function canvasUrlForPath(canvasRoot, filePath) {
  return `${CANVAS_HOST_PATH}/${canvasRelativePath(canvasRoot, filePath)}`;
}

function defaultCanvasHtmlPath(canvasRoot, titleValue) {
  const stamp = new Date()
    .toISOString()
    .replace(/[-:]/gu, "")
    .replace(/\.\d{3}Z$/u, "Z");
  return path.join(
    canvasRoot,
    "documents",
    `ui-report-${stamp}-${slugify(titleValue)}`,
    "index.html",
  );
}

function resolveAnalysisMarkdown() {
  const explicitPath =
    analysisMdArg ||
    (typeof spec.analysisMarkdownPath === "string" ? spec.analysisMarkdownPath : "");
  if (explicitPath) {
    const resolved = path.resolve(resolveUserPath(explicitPath));
    return fs.existsSync(resolved)
      ? {
          markdown: fs.readFileSync(resolved, "utf8").replace(/^\uFEFF/u, ""),
          sourcePath: resolved,
        }
      : { markdown: "", sourcePath: resolved };
  }
  if (typeof spec.analysisMarkdown === "string" && spec.analysisMarkdown.trim()) {
    return { markdown: spec.analysisMarkdown, sourcePath: "" };
  }
  const inputPath = path.resolve(input);
  const inputDir = path.dirname(inputPath);
  const baseName = path.basename(inputPath, path.extname(inputPath));
  const candidates = [
    path.join(inputDir, `${baseName}.md`),
    path.join(inputDir, "analysis.md"),
    path.join(inputDir, "analyzed.md"),
    path.join(inputDir, "report.md"),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return {
        markdown: fs.readFileSync(candidate, "utf8").replace(/^\uFEFF/u, ""),
        sourcePath: candidate,
      };
    }
  }
  return { markdown: "", sourcePath: "" };
}

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const isFiniteNumber = (value) => typeof value === "number" && Number.isFinite(value);
const escapeHtml = (value) =>
  String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
const escapeScriptJson = (value) => JSON.stringify(value).replace(/<\/script>/giu, "<\\/script>");

function parseStepMs(value) {
  if (typeof value !== "string") return null;
  const match =
    /^(\d+)\s*(s|sec|second|seconds|min|m|minute|minutes|h|hr|hour|hours|d|day|days)$/iu.exec(
      value.trim(),
    );
  if (!match) return null;
  const n = Number(match[1]);
  const unit = match[2].toLowerCase();
  if (unit === "s" || unit.startsWith("sec")) return n * 1000;
  if (unit === "min" || unit === "m" || unit.startsWith("minute")) return n * 60000;
  if (unit === "h" || unit === "hr" || unit.startsWith("hour")) return n * 3600000;
  if (unit === "d" || unit.startsWith("day")) return n * 86400000;
  return null;
}

function parseTimeValue(value) {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number" && Number.isFinite(value)) {
    return value > 100000000000 ? value : value * 1000;
  }
  if (typeof value !== "string" || !value.trim()) return null;
  const trimmed = value.trim();
  if (/^\d+$/u.test(trimmed)) return parseTimeValue(Number(trimmed));
  const parsed = new Date(trimmed).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

function parseTimeRange(rangeStr, stepMs, pointCount) {
  const fallbackDuration = stepMs && pointCount ? stepMs * pointCount : 86400000;
  if (typeof rangeStr !== "string" || !rangeStr.trim()) {
    return {
      startTime: refTimeMs - fallbackDuration,
      endTime: refTimeMs,
      durationMs: fallbackDuration,
      type: "inferred",
    };
  }

  const text = rangeStr.trim();
  const relative = [
    [/最近\s*一?\s*天|last\s+1?\s*day/iu, 1],
    [/最近\s*两\s*天|最近\s*2\s*天|last\s+2\s*days/iu, 2],
    [/最近\s*一?\s*周|last\s+1?\s*week/iu, 7],
    [/最近\s*两\s*周|最近\s*2\s*周|last\s+2\s*weeks/iu, 14],
    [/最近\s*一?\s*月|最近\s*30\s*天|last\s+1?\s*month/iu, 30],
    [/最近\s*三\s*月|最近\s*3\s*月|last\s+3\s*months/iu, 90],
    [/最近\s*半年|last\s+6\s*months/iu, 180],
  ];
  for (const [pattern, days] of relative) {
    if (pattern.test(text)) {
      const durationMs = days * 86400000;
      return {
        startTime: refTimeMs - durationMs,
        endTime: refTimeMs,
        durationMs,
        type: "relative",
      };
    }
  }

  const absolute = text.split(/\s*(?:~|至|到|\.\.)\s*/u);
  if (absolute.length === 2) {
    const startTime = parseTimeValue(absolute[0]);
    const endTime = parseTimeValue(absolute[1]);
    if (startTime !== null && endTime !== null && endTime > startTime) {
      return {
        startTime,
        endTime,
        durationMs: endTime - startTime,
        type: "absolute",
      };
    }
  }

  return {
    startTime: refTimeMs - fallbackDuration,
    endTime: refTimeMs,
    durationMs: fallbackDuration,
    type: "inferred",
  };
}

function stats(values) {
  const nums = values.filter(isFiniteNumber);
  if (nums.length === 0) {
    return { count: 0, min: 0, max: 0, mean: 0, first: 0, last: 0, change: 0 };
  }
  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  for (const value of nums) {
    min = Math.min(min, value);
    max = Math.max(max, value);
    sum += value;
  }
  const first = nums[0];
  const last = nums[nums.length - 1];
  return {
    count: nums.length,
    min,
    max,
    mean: sum / nums.length,
    first,
    last,
    change: last - first,
  };
}

function fmt(value) {
  if (!Number.isFinite(value)) return "-";
  if (Math.abs(value) >= 1000) return Math.round(value).toLocaleString("en-US");
  return Number(value.toFixed(2)).toLocaleString("en-US");
}

function hasNumericArray(value) {
  return (
    isObject(value) &&
    Object.values(value).some(
      (entry) => Array.isArray(entry) && entry.some((item) => isFiniteNumber(item)),
    )
  );
}

function firstNumericArray(record) {
  for (const key of ["value", "values", "points", "data", "series"]) {
    if (Array.isArray(record[key]) && record[key].some(isFiniteNumber)) return record[key];
  }
  return Object.values(record).find(
    (value) => Array.isArray(value) && value.some((item) => isFiniteNumber(item)),
  );
}

function normalizeAnomalyFlags(record, expectedLength) {
  if (!isObject(record)) return [];
  const raw = Array.isArray(record.anomaly_indices)
    ? record.anomaly_indices
    : Array.isArray(record.anomalyIndices)
      ? record.anomalyIndices
      : Array.isArray(record.anomalies)
        ? record.anomalies
        : [];
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, expectedLength).map((value) => value === 1 || value === true);
}

function resolveRecords(value) {
  if (Array.isArray(value)) return value;
  if (hasNumericArray(value)) return [value];
  if (isObject(value)) return Object.values(value);
  return [];
}

function detectRowFields(rows) {
  const sample = rows.find(isObject) ?? {};
  const keys = Object.keys(sample);
  const timeField = keys.find((key) =>
    /^(time|timestamp|date|datetime|ts|period|bucket)$/iu.test(key),
  );
  const entityField = keys.find((key) =>
    /^(object|entity|name|label|id|host|instance|service|category|group)$/iu.test(key),
  );
  const valueField = keys.find(
    (key) =>
      isFiniteNumber(sample[key]) &&
      !/^(time|timestamp|date|datetime|ts|period|bucket)$/iu.test(key),
  );
  return { timeField, entityField, valueField };
}

function normalizeCategoryData(raw) {
  if (Array.isArray(raw) && raw.every(isObject)) {
    const { timeField, entityField, valueField } = detectRowFields(raw);
    if (!timeField && entityField && valueField) {
      return raw
        .map((row) => ({
          label: String(row[entityField] ?? ""),
          value: Number(row[valueField]),
        }))
        .filter((item) => item.label && Number.isFinite(item.value));
    }
  }
  if (isObject(raw)) {
    return Object.entries(raw)
      .filter(([, value]) => isFiniteNumber(value))
      .map(([label, value]) => ({ label, value: Number(value) }));
  }
  return [];
}

function chooseChartType(specValue, normalized, categoryItems) {
  const requested = String(specValue ?? "")
    .trim()
    .toLowerCase();
  if (requested && requested !== "auto") return requested;
  if (normalized.kind === "time-series") {
    const seriesCount = Array.isArray(normalized.series) ? normalized.series.length : 0;
    return seriesCount > 1 ? "combo" : "line";
  }
  if (categoryItems.length > 0) return categoryItems.length <= 8 ? "pie" : "bar";
  return "table";
}

function deriveAvailableChartTypes(normalized, categoryItems, series) {
  const options = [];
  const push = (type) => {
    if (!options.includes(type) && options.length < 3) options.push(type);
  };

  if (normalized.kind === "time-series") {
    if (series.length > 1) {
      push("combo");
      push("line");
    } else {
      push("line");
    }
    if ((normalized.tableRows ?? []).length > 0) push("table");
    return options;
  }

  if (normalized.kind === "category-series" || categoryItems.length > 0) {
    if (categoryItems.length === 1) {
      push("pie");
      push("donut");
    } else if (categoryItems.length <= 8) {
      push("pie");
      push("donut");
      push("bar");
    } else {
      push("bar");
    }
    return options;
  }

  if (normalized.kind === "table" || normalized.kind === "object") {
    if (categoryItems.length > 0) {
      if (categoryItems.length === 1) {
        push("pie");
        push("donut");
      } else if (categoryItems.length <= 8) {
        push("pie");
        push("donut");
        push("bar");
      } else {
        push("bar");
      }
    }
    return options;
  }

  return options;
}

function chartTypeLabel(type, isZh) {
  if (isZh) {
    switch (type) {
      case "line":
        return "折线图";
      case "bar":
        return "柱状图";
      case "pie":
        return "饼图";
      case "donut":
        return "环形图";
      case "combo":
        return "组合图";
      default:
        return type;
    }
  }
  switch (type) {
    case "line":
      return "Line";
    case "bar":
      return "Bar";
    case "pie":
      return "Pie";
    case "donut":
      return "Donut";
    case "combo":
      return "Combo";
    default:
      return type;
  }
}

function normalizeSeries(raw) {
  if (Array.isArray(raw) && raw.every(isFiniteNumber)) {
    return {
      series: [{ label: "value", values: raw, timestamps: [] }],
      kind: "time-series",
      timeSource: "index",
    };
  }

  const records = resolveRecords(raw).filter(isObject);
  if (records.some(hasNumericArray)) {
    return {
      series: records.filter(hasNumericArray).map((record, index) => {
        const values = firstNumericArray(record).filter(isFiniteNumber);
        const predictions = Array.isArray(record.predictions)
          ? record.predictions.filter(isFiniteNumber)
          : Array.isArray(record.predicted_values)
            ? record.predicted_values.filter(isFiniteNumber)
            : [];
        const anomalyFlags = normalizeAnomalyFlags(record, values.length);
        return {
          label: String(record.object ?? record.name ?? record.label ?? record.id ?? index),
          values,
          predictions,
          anomalyFlags,
          timestamps: [],
          scalarFields: Object.fromEntries(
            Object.entries(record).filter(([, value]) => !Array.isArray(value) && !isObject(value)),
          ),
        };
      }),
      kind: "time-series",
      timeSource: "index",
    };
  }

  if (Array.isArray(raw) && raw.every(isObject)) {
    const { timeField, entityField, valueField } = detectRowFields(raw);
    if (valueField) {
      const groups = new Map();
      for (const row of raw) {
        const label = entityField ? String(row[entityField]) : valueField;
        const value = row[valueField];
        if (!isFiniteNumber(value)) continue;
        const timestamp = timeField ? parseTimeValue(row[timeField]) : null;
        const existing = groups.get(label) ?? { label, values: [], timestamps: [] };
        existing.values.push(value);
        if (timestamp !== null) existing.timestamps.push(timestamp);
        groups.set(label, existing);
      }
      return {
        series: [...groups.values()],
        kind: timeField ? "time-series" : "category-series",
        timeSource: timeField ? "field" : "index",
      };
    }
  }

  return {
    series: [],
    kind: Array.isArray(raw) ? "table" : "object",
    tableRows: Array.isArray(raw) ? raw : records,
    timeSource: "none",
  };
}

const normalized = normalizeSeries(data);
const categoryItems = normalizeCategoryData(data);
const maxSeries = spec.primaryChart?.maxSeries ?? spec.maxSeries ?? 12;
const chartType = chooseChartType(
  spec.primaryChart?.type ?? spec.chartType,
  normalized,
  categoryItems,
);
const language = "zh-CN";
const isZh = true;
const labels = isZh
  ? {
      series: "序列",
      points: "原始点数",
      mean: "均值",
      max: "最大值",
      min: "最小值",
      chart: "趋势概览",
      ranking: "序列排行",
      source: "",
      object: "对象",
      first: "首值",
      last: "末值",
      change: "变化",
      all: "全部",
      resetZoom: "重置缩放",
      granularity: "粒度",
      auto: "自动",
      raw: "原始",
      hour: "小时",
      day: "天",
      visible: "可视点",
      dateRange: "日期范围",
      anomalies: "异常点",
      anomaly: "异常",
      sigmaBand: "3σ 阈值",
      analysisReport: "分析结论",
      exportReport: "导出报告",
      analysisLead: "指标分析",
      noChart: "未检测到可绘制的数值序列，当前展示表格数据与分析结论。",
    }
  : {
      series: "Series",
      points: "Raw points",
      mean: "Mean",
      max: "Max",
      min: "Min",
      chart: "Trend overview",
      ranking: "Series ranking",
      source: "",
      object: "Object",
      first: "First",
      last: "Last",
      change: "Change",
      all: "All",
      resetZoom: "Reset zoom",
      granularity: "Granularity",
      auto: "Auto",
      raw: "Raw",
      hour: "Hour",
      day: "Day",
      visible: "Visible",
      dateRange: "Date range",
      anomalies: "Anomalies",
      anomaly: "Anomaly",
      sigmaBand: "3σ band",
      analysisReport: "Analysis",
      exportReport: "Export report",
      analysisLead: "Analysis",
      noChart: "No drawable numeric series was detected. The report shows table data and analysis.",
    };

labels.chart =
  chartType === "bar"
    ? isZh
      ? "分类对比"
      : "Category comparison"
    : chartType === "pie"
      ? isZh
        ? "占比分析"
        : "Share analysis"
      : chartType === "donut"
        ? isZh
          ? "构成分析"
          : "Composition"
        : labels.chart;
labels.forecast = isZh ? "预测点数" : "Forecast points";
labels.prediction = isZh ? "预测" : "Prediction";
labels.chartTypes = {
  line: chartTypeLabel("line", isZh),
  bar: chartTypeLabel("bar", isZh),
  pie: chartTypeLabel("pie", isZh),
  donut: chartTypeLabel("donut", isZh),
  combo: chartTypeLabel("combo", isZh),
};

const series = normalized.series
  .filter((entry) => entry.values.length > 0)
  .slice(0, maxSeries)
  .map((entry) => ({ ...entry, stats: stats(entry.values) }));
const availableChartTypes = deriveAvailableChartTypes(normalized, categoryItems, series);

const firstRecord = resolveRecords(data).find(isObject) ?? data;
const timeStepRaw = isObject(data) ? (data.time_step ?? data.timeStep ?? data.step) : undefined;
const timeRangeRaw = isObject(data) ? (data.time_range ?? data.timeRange ?? data.range) : undefined;
const stepMs = parseStepMs(timeStepRaw) ?? null;
const pointCount = Math.max(0, ...series.map((entry) => entry.values.length));
const explicitTimes = series.flatMap((entry) => entry.timestamps).filter(isFiniteNumber);
const hasExplicitTimes = explicitTimes.length > 0;
const inferredStepMs =
  stepMs ??
  (hasExplicitTimes && explicitTimes.length > 1
    ? Math.max(
        1,
        explicitTimes.toSorted((a, b) => a - b)[1] - explicitTimes.toSorted((a, b) => a - b)[0],
      )
    : 300000);
const timeInfo = hasExplicitTimes
  ? {
      startTime: Math.min(...explicitTimes),
      endTime: Math.max(...explicitTimes) + inferredStepMs,
      durationMs: Math.max(...explicitTimes) - Math.min(...explicitTimes) + inferredStepMs,
      type: "field",
    }
  : parseTimeRange(timeRangeRaw, inferredStepMs, pointCount);

for (const entry of series) {
  if (entry.timestamps.length !== entry.values.length) {
    entry.timestamps = Array.from(
      { length: entry.values.length },
      (_, index) => timeInfo.startTime + index * inferredStepMs,
    );
  }
  entry.predictionTimestamps = Array.from(
    { length: entry.predictions?.length ?? 0 },
    (_, index) =>
      timeInfo.startTime + entry.values.length * inferredStepMs + index * inferredStepMs,
  );
}

const predictionEndTime = Math.max(
  timeInfo.endTime,
  ...series
    .flatMap((entry) => entry.predictionTimestamps ?? [])
    .map((value) => value + inferredStepMs),
);
timeInfo.endTime = predictionEndTime;
timeInfo.durationMs = Math.max(inferredStepMs, predictionEndTime - timeInfo.startTime);

function formatAnalysisTime(ms) {
  const d = new Date(ms);
  const two = (value) => String(value).padStart(2, "0");
  return `${d.getUTCFullYear()}-${two(d.getUTCMonth() + 1)}-${two(d.getUTCDate())} ${two(d.getUTCHours())}:${two(d.getUTCMinutes())}`;
}

function summarizeAnomalyDirection(entry) {
  const values = entry.values ?? [];
  const flags = entry.anomalyFlags ?? [];
  const meta = entry.scalarFields ?? {};
  const upper = Number(meta.upper_bound ?? meta.upperBound);
  const lower = Number(meta.lower_bound ?? meta.lowerBound);
  let above = 0;
  let below = 0;
  for (let index = 0; index < Math.min(values.length, flags.length); index += 1) {
    if (!flags[index]) continue;
    const value = values[index];
    if (Number.isFinite(upper) && value > upper) above += 1;
    else if (Number.isFinite(lower) && value < lower) below += 1;
  }
  if (above > 0 && below > 0) return isZh ? "既有突增也有回落" : "spikes and dips";
  if (above > 0) return isZh ? "以突增为主" : "mostly spikes";
  if (below > 0) return isZh ? "以下探为主" : "mostly dips";
  return isZh ? "波动异常" : "irregular fluctuation";
}

const allValues = series.flatMap((entry) => entry.values);
const globalStats = stats(allValues);
const totalRawPoints = series.reduce((sum, entry) => sum + entry.values.length, 0);
const totalPredictionPoints = series.reduce(
  (sum, entry) => sum + (entry.predictions?.length ?? 0),
  0,
);
const anomalyCountFor = (entry) =>
  Array.isArray(entry.anomalyFlags)
    ? entry.anomalyFlags.reduce((count, flag) => count + (flag ? 1 : 0), 0)
    : 0;
const totalAnomalies = series.reduce((sum, entry) => sum + anomalyCountFor(entry), 0);
const colors = [
  "#2563eb",
  "#059669",
  "#dc2626",
  "#7c3aed",
  "#ca8a04",
  "#0891b2",
  "#be123c",
  "#4f46e5",
];
const ranking = [...series]
  .sort((a, b) => b.stats.max - a.stats.max)
  .slice(0, spec.ranking?.limit ?? 8);
const defaultTitle =
  isObject(firstRecord) && typeof firstRecord.kpi_name === "string" && firstRecord.kpi_name.trim()
    ? `${firstRecord.kpi_name.trim()} 趋势报告`
    : normalized.kind === "time-series"
      ? isZh
        ? "趋势报告"
        : "Trend report"
      : isZh
        ? "数据报告"
        : "Data report";
const title = spec.title ?? defaultTitle;
const analysis = resolveAnalysisMarkdown();

function inlineMarkdownToHtml(text) {
  return escapeHtml(text)
    .replace(/\*\*([^*]+)\*\*/gu, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/gu, "<em>$1</em>")
    .replace(/`([^`]+)`/gu, "<code>$1</code>")
    .replace(
      /\[([^\]]+)\]\(([^)]+)\)/gu,
      '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>',
    );
}

function markdownToHtml(markdown) {
  const lines = String(markdown ?? "")
    .replace(/\r\n/gu, "\n")
    .split("\n");
  const out = [];
  let inList = false;
  let paragraph = [];
  let tableHeader = null;
  let tableRowsBuffer = [];
  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    out.push(`<p>${inlineMarkdownToHtml(paragraph.join(" "))}</p>`);
    paragraph = [];
  };
  const closeList = () => {
    if (!inList) return;
    out.push("</ul>");
    inList = false;
  };
  const isTableSeparator = (line) =>
    /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/u.test(line.trim());
  const parseTableCells = (line) => {
    const trimmed = line.trim().replace(/^\|/u, "").replace(/\|$/u, "");
    return trimmed.split("|").map((cell) => cell.trim());
  };
  const flushTable = () => {
    if (!tableHeader || tableRowsBuffer.length === 0) {
      tableHeader = null;
      tableRowsBuffer = [];
      return;
    }
    out.push('<div class="analysis-table-wrap"><table>');
    out.push(
      `<thead><tr>${tableHeader
        .map((cell) => `<th>${inlineMarkdownToHtml(cell)}</th>`)
        .join("")}</tr></thead>`,
    );
    out.push(
      `<tbody>${tableRowsBuffer
        .map(
          (row) =>
            `<tr>${row.map((cell) => `<td>${inlineMarkdownToHtml(cell)}</td>`).join("")}</tr>`,
        )
        .join("")}</tbody>`,
    );
    out.push("</table></div>");
    tableHeader = null;
    tableRowsBuffer = [];
  };
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    const trimmed = line.trim();
    if (!trimmed) {
      flushParagraph();
      closeList();
      flushTable();
      continue;
    }
    if (tableHeader) {
      if (trimmed.includes("|")) {
        tableRowsBuffer.push(parseTableCells(trimmed));
        continue;
      }
      flushTable();
    }
    if (trimmed.includes("|")) {
      const nextLine = lines[lineIndex + 1];
      if (typeof nextLine === "string" && isTableSeparator(nextLine)) {
        flushParagraph();
        closeList();
        tableHeader = parseTableCells(trimmed);
        tableRowsBuffer = [];
        lineIndex += 1;
        continue;
      }
    }
    const heading = /^(#{1,3})\s+(.+)$/u.exec(trimmed);
    if (heading) {
      flushParagraph();
      closeList();
      flushTable();
      const level = Math.min(3, heading[1].length) + 1;
      out.push(`<h${level}>${inlineMarkdownToHtml(heading[2])}</h${level}>`);
      continue;
    }
    const bullet = /^[-*]\s+(.+)$/u.exec(trimmed);
    if (bullet) {
      flushParagraph();
      flushTable();
      if (!inList) {
        out.push("<ul>");
        inList = true;
      }
      out.push(`<li>${inlineMarkdownToHtml(bullet[1])}</li>`);
      continue;
    }
    paragraph.push(trimmed);
  }
  flushParagraph();
  closeList();
  flushTable();
  return out.join("");
}

const analysisMarkdown =
  analysis.markdown ||
  (typeof spec.analysisMarkdown === "string" && spec.analysisMarkdown.trim()
    ? spec.analysisMarkdown
    : "");
const analysisHtml =
  typeof spec.analysisHtml === "string" && spec.analysisHtml.trim()
    ? spec.analysisHtml
    : markdownToHtml(analysisMarkdown);
const hasAnalysis = Boolean(analysisMarkdown.trim() || analysisHtml.trim());

function plainTextFromMarkdown(markdown) {
  return String(markdown ?? "")
    .replace(/\r\n/gu, "\n")
    .replace(/^#{1,6}\s+/gmu, "")
    .replace(/^[-*]\s+/gmu, "")
    .replace(/`([^`]+)`/gu, "$1")
    .replace(/\*\*([^*]+)\*\*/gu, "$1")
    .replace(/\*([^*]+)\*/gu, "$1")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/gu, "$1")
    .replace(/\n+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

const analysisSummaryText = plainTextFromMarkdown(analysisMarkdown);
const summaryMarkdownBase =
  spec.summaryMarkdown ?? (analysisSummaryText ? `${title}: ${analysisSummaryText}` : title);
const canvasRoot = await resolveCanvasRoot();
const exportHtmlPath = path.resolve(
  path.join(
    canvasRoot,
    "documents",
    `ui-report-export-${new Date()
      .toISOString()
      .replace(/[-:]/gu, "")
      .replace(/\.\d{3}Z$/u, "Z")}-${slugify(title)}`,
    "index.html",
  ),
);
const exportCanvasUrl = canvasUrlForPath(canvasRoot, exportHtmlPath);

const tableRows = (normalized.tableRows ?? []).slice(0, spec.table?.limit ?? 100);
const tableColumns =
  tableRows.length > 0 && isObject(tableRows[0]) ? Object.keys(tableRows[0]).slice(0, 12) : [];
const embeddedData = {
  chartKind: series.length > 0 ? "time-series" : "table",
  series: series.map((entry) => ({
    label: entry.label,
    values: entry.values,
    predictions: entry.predictions ?? [],
    anomalyFlags: entry.anomalyFlags ?? [],
    anomalyMeta: {
      hasAnomaly: Boolean(entry.scalarFields?.has_anomaly ?? entry.scalarFields?.hasAnomaly),
      anomalyCount: Number(
        entry.scalarFields?.anomaly_count ??
          entry.scalarFields?.anomalyCount ??
          anomalyCountFor(entry),
      ),
      mean: Number(entry.scalarFields?.mean),
      std: Number(entry.scalarFields?.std),
      lowerBound: Number(entry.scalarFields?.lower_bound ?? entry.scalarFields?.lowerBound),
      upperBound: Number(entry.scalarFields?.upper_bound ?? entry.scalarFields?.upperBound),
      anomalyThreshold:
        entry.scalarFields?.anomaly_threshold ?? entry.scalarFields?.anomalyThreshold ?? null,
    },
    timestamps: entry.timestamps,
    predictionTimestamps: entry.predictionTimestamps ?? [],
  })),
  anomalySummary: {
    count: totalAnomalies,
    hasAnomaly: totalAnomalies > 0,
  },
  predictionSummary: {
    count: totalPredictionPoints,
    hasPrediction: totalPredictionPoints > 0,
  },
  analysis: {
    markdown: analysisMarkdown,
    html: analysisHtml,
    sourcePath: analysis.sourcePath,
  },
  categories: categoryItems,
  selectedChartType: chartType,
  availableChartTypes,
  sourcePath: path.normalize(input),
  summaryMarkdown: summaryMarkdownBase,
  exportReportUrl: exportCanvasUrl,
  tableRows,
  tableColumns,
  timeMeta: {
    startTime: timeInfo.startTime,
    endTime: timeInfo.endTime,
    stepMs: inferredStepMs,
    durationMs: timeInfo.durationMs,
    pointCount,
    predictionPointCount: totalPredictionPoints,
    timeRange: timeRangeRaw ?? "",
    timeStep: timeStepRaw ?? "",
    timeRangeType: timeInfo.type,
  },
  language,
  colors,
  labels,
};

const chartJs = String.raw`
var reportData = JSON.parse(document.getElementById('report-data').textContent);
var series = reportData.series;
var categories = Array.isArray(reportData.categories) ? reportData.categories : [];
var availableChartTypes = Array.isArray(reportData.availableChartTypes) ? reportData.availableChartTypes : [];
var timeMeta = reportData.timeMeta;
var colors = reportData.colors;
var labels = reportData.labels;
var selectedChartType = reportData.selectedChartType || 'line';
var predictionAccent = '#f59e0b';
var title = document.title;
var sourcePathForExport = reportData.sourcePath || '';
var summaryForExport = reportData.summaryMarkdown || '';
var analysisTitleForExport = labels.analysisReport || 'Analysis';
var emptyAnalysisForExport = labels.noAnalysis || 'No analysis markdown was provided.';
var exportReportUrl = reportData.exportReportUrl || '';
var visible = series.map(function() { return true; });
var canvas = document.getElementById('chart-canvas');
var ctx = canvas.getContext('2d');
var dpr = window.devicePixelRatio || 1;
var pad = { left: 64, right: 22, top: 18, bottom: 42 };
var state = {
  viewStart: timeMeta.startTime,
  viewEnd: timeMeta.endTime,
  mouseX: -1,
  mouseY: -1,
  isPanning: false,
  panStartX: 0,
  panViewStart: 0,
  panViewEnd: 0,
  granularity: 'auto'
};

function pad2(n) { return n < 10 ? '0' + n : String(n); }
function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
function formatValue(v) {
  if (!isFinite(v)) return '-';
  if (Math.abs(v) >= 1000) return Math.round(v).toLocaleString();
  return Number(v.toFixed(2)).toLocaleString();
}
function formatTime(ms, visibleDuration) {
  var d = new Date(ms);
  if (visibleDuration > 14*86400000) return pad2(d.getMonth()+1) + '/' + pad2(d.getDate());
  if (visibleDuration > 86400000) return pad2(d.getMonth()+1) + '/' + pad2(d.getDate()) + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  if (visibleDuration > 2*3600000) return pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  return pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds());
}
function formatFullTime(ms) {
  var d = new Date(ms);
  return d.getFullYear() + '-' + pad2(d.getMonth()+1) + '-' + pad2(d.getDate()) + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
}
function toDateInput(ms) {
  var d = new Date(ms);
  return d.getFullYear() + '-' + pad2(d.getMonth()+1) + '-' + pad2(d.getDate());
}
function chooseBucketMs() {
  var visibleDuration = state.viewEnd - state.viewStart;
  if (state.granularity === 'raw') return timeMeta.stepMs || 1;
  if (state.granularity === 'hour') return 3600000;
  if (state.granularity === 'day') return 86400000;
  var estimated = visibleDuration / Math.max(timeMeta.stepMs || 1, 1);
  if (estimated <= 800) return timeMeta.stepMs || 1;
  if (visibleDuration / 3600000 <= 800) return 3600000;
  if (visibleDuration / 86400000 <= 800) return 86400000;
  return Math.max(timeMeta.stepMs || 1, visibleDuration / 700);
}
function aggregateSeries(s, bucketMs) {
  var outTimes = [];
  var outValues = [];
  var outAnomalies = [];
  var outPredictionTimes = [];
  var outPredictionValues = [];
  var bucket = NaN;
  var sum = 0;
  var count = 0;
  var hasAnomaly = false;
  for (var i = 0; i < s.timestamps.length; i++) {
    var t = s.timestamps[i];
    if (t < state.viewStart || t > state.viewEnd) continue;
    var b = Math.floor((t - state.viewStart) / bucketMs);
    if (Number.isNaN(bucket)) bucket = b;
    if (b !== bucket) {
      if (count > 0) {
        outTimes.push(state.viewStart + bucket * bucketMs);
        outValues.push(sum / count);
        outAnomalies.push(hasAnomaly);
      }
      bucket = b;
      sum = 0;
      count = 0;
      hasAnomaly = false;
    }
    sum += s.values[i];
    count++;
    hasAnomaly = hasAnomaly || Boolean(s.anomalyFlags && s.anomalyFlags[i]);
  }
  if (count > 0) {
    outTimes.push(state.viewStart + bucket * bucketMs);
    outValues.push(sum / count);
    outAnomalies.push(hasAnomaly);
  }
  bucket = NaN;
  sum = 0;
  count = 0;
  for (var j = 0; j < (s.predictionTimestamps || []).length; j++) {
    var pt = s.predictionTimestamps[j];
    if (pt < state.viewStart || pt > state.viewEnd) continue;
    var pb = Math.floor((pt - state.viewStart) / bucketMs);
    if (Number.isNaN(bucket)) bucket = pb;
    if (pb !== bucket) {
      if (count > 0) {
        outPredictionTimes.push(state.viewStart + bucket * bucketMs);
        outPredictionValues.push(sum / count);
      }
      bucket = pb;
      sum = 0;
      count = 0;
    }
    sum += s.predictions[j];
    count++;
  }
  if (count > 0) {
    outPredictionTimes.push(state.viewStart + bucket * bucketMs);
    outPredictionValues.push(sum / count);
  }
  return { times: outTimes, values: outValues, anomalies: outAnomalies, predictionTimes: outPredictionTimes, predictionValues: outPredictionValues };
}
function visibleBucketed() {
  var bucketMs = chooseBucketMs();
  return {
    bucketMs: bucketMs,
    data: series.map(function(s, index) {
      return visible[index] ? aggregateSeries(s, bucketMs) : { times: [], values: [] };
    })
  };
}
function currentCategoryItems() {
  if (categories.length > 0) return categories.slice(0, 20);
  return series
    .map(function(item) {
      return {
        label: item.label,
        value: item.stats ? item.stats.last : (item.values && item.values.length ? item.values[item.values.length - 1] : 0)
      };
    })
    .filter(function(item) { return isFinite(item.value); })
    .slice(0, 20);
}
function drawCategoryChart() {
  var w = canvas.width / dpr;
  var h = canvas.height / dpr;
  ctx.clearRect(0, 0, w, h);
  var items = currentCategoryItems();
  if (!items.length) return;
  if (selectedChartType === 'pie' || selectedChartType === 'donut') {
    var total = items.reduce(function(sum, item) { return sum + item.value; }, 0) || 1;
    var cx = w / 2;
    var cy = h / 2;
    var radius = Math.min(w, h) * 0.28;
    var inner = radius * 0.58;
    var start = -Math.PI / 2;
    items.forEach(function(item, index) {
      var angle = (item.value / total) * Math.PI * 2;
      ctx.beginPath();
      ctx.fillStyle = colors[index % colors.length];
      if (selectedChartType === 'pie') {
        ctx.moveTo(cx, cy);
        ctx.arc(cx, cy, radius, start, start + angle);
        ctx.closePath();
        ctx.fill();
      } else {
        ctx.strokeStyle = colors[index % colors.length];
        ctx.lineWidth = radius - inner;
        ctx.arc(cx, cy, (radius + inner) / 2, start, start + angle);
        ctx.stroke();
      }
      start += angle;
    });
    ctx.fillStyle = '#18202f';
    ctx.textAlign = 'center';
    ctx.font = '600 16px -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif';
    if (selectedChartType === 'donut') {
      ctx.fillText(labels.chart, cx, cy - 4);
      ctx.font = '12px -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif';
      ctx.fillStyle = '#667085';
      ctx.fillText(total.toLocaleString(), cx, cy + 16);
    } else {
      ctx.fillText(labels.chart, cx, Math.max(22, cy - radius - 18));
    }
    document.getElementById('density-label').textContent = labels.visible + ': ' + items.length;
    return;
  }
  var padBar = { left: 120, right: 24, top: 18, bottom: 28 };
  var cw = Math.max(10, w - padBar.left - padBar.right);
  var ch = Math.max(10, h - padBar.top - padBar.bottom);
  var maxValue = Math.max.apply(null, items.map(function(item) { return item.value; }).concat([1]));
  var rowHeight = Math.max(24, Math.floor(ch / items.length));
  items.forEach(function(item, index) {
    var y = padBar.top + index * rowHeight + 4;
    var barWidth = (item.value / maxValue) * cw;
    ctx.fillStyle = '#667085';
    ctx.textAlign = 'right';
    ctx.font = '12px -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif';
    ctx.fillText(item.label, padBar.left - 10, y + 12);
    ctx.fillStyle = colors[index % colors.length];
    ctx.fillRect(padBar.left, y, Math.max(2, barWidth), Math.max(14, rowHeight - 8));
    ctx.fillStyle = '#18202f';
    ctx.textAlign = 'left';
    ctx.fillText(formatValue(item.value), padBar.left + barWidth + 8, y + 12);
  });
  document.getElementById('density-label').textContent = labels.visible + ': ' + items.length;
}
function drawChart() {
  if (selectedChartType === 'bar' || selectedChartType === 'pie' || selectedChartType === 'donut') {
    drawCategoryChart();
    return;
  }
  var w = canvas.width / dpr;
  var h = canvas.height / dpr;
  ctx.clearRect(0, 0, w, h);
  var cw = Math.max(10, w - pad.left - pad.right);
  var ch = Math.max(10, h - pad.top - pad.bottom);
  var viewDuration = state.viewEnd - state.viewStart;
  var bucketed = visibleBucketed();
  var yMin = Infinity;
  var yMax = -Infinity;
  var visiblePoints = 0;
  bucketed.data.forEach(function(item) {
    visiblePoints += item.values.length;
    item.values.forEach(function(v) {
      yMin = Math.min(yMin, v);
      yMax = Math.max(yMax, v);
    });
    (item.predictionValues || []).forEach(function(v) {
      yMin = Math.min(yMin, v);
      yMax = Math.max(yMax, v);
    });
  });
  if (!isFinite(yMin) || !isFinite(yMax)) {
    yMin = 0;
    yMax = 1;
  }
  var yPad = (yMax - yMin) * 0.06 || 1;
  yMin -= yPad;
  yMax += yPad;
  ctx.font = '12px -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif';
  ctx.strokeStyle = '#d9dee8';
  ctx.lineWidth = 1;
  for (var gi = 0; gi < 5; gi++) {
    var y = pad.top + ch - ch * gi / 4;
    var yVal = yMin + (yMax - yMin) * gi / 4;
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(pad.left + cw, y);
    ctx.stroke();
    ctx.fillStyle = '#667085';
    ctx.textAlign = 'right';
    ctx.fillText(formatValue(yVal), pad.left - 8, y + 4);
  }
  ctx.textAlign = 'center';
  for (var ti = 0; ti <= 6; ti++) {
    var t = state.viewStart + viewDuration * ti / 6;
    var x = pad.left + cw * ti / 6;
    ctx.fillStyle = '#667085';
    ctx.fillText(formatTime(t, viewDuration), x, h - 10);
  }
  var forecastStart = null;
  bucketed.data.forEach(function(item) {
    if (!item.predictionTimes || item.predictionTimes.length === 0) return;
    var first = item.predictionTimes[0];
    if (forecastStart === null || first < forecastStart) forecastStart = first;
  });
  if (forecastStart !== null && forecastStart < state.viewEnd && forecastStart > state.viewStart) {
    var forecastX = pad.left + ((forecastStart - state.viewStart) / viewDuration) * cw;
    ctx.save();
    ctx.fillStyle = 'rgba(245, 158, 11, 0.10)';
    ctx.fillRect(forecastX, pad.top, pad.left + cw - forecastX, ch);
    ctx.strokeStyle = predictionAccent;
    ctx.setLineDash([4, 4]);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(forecastX, pad.top);
    ctx.lineTo(forecastX, pad.top + ch);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = predictionAccent;
    ctx.font = '600 12px -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(labels.prediction + '区', Math.min(forecastX + 8, pad.left + cw - 48), pad.top + 14);
    ctx.restore();
  }
  bucketed.data.forEach(function(item, index) {
    if (item.times.length === 0) return;
    ctx.beginPath();
    ctx.strokeStyle = colors[index % colors.length];
    ctx.lineWidth = selectedChartType === 'combo' ? 1.5 : 2;
    item.times.forEach(function(t, pointIndex) {
      var x = pad.left + ((t - state.viewStart) / viewDuration) * cw;
      var y = pad.top + ch - ((item.values[pointIndex] - yMin) / (yMax - yMin)) * ch;
      if (pointIndex === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
    if (selectedChartType === 'combo') {
      var barWidth = Math.max(4, Math.min(24, cw / Math.max(visiblePoints, 24) * 12));
      item.times.forEach(function(t, pointIndex) {
        var x = pad.left + ((t - state.viewStart) / viewDuration) * cw;
        var y = pad.top + ch - ((item.values[pointIndex] - yMin) / (yMax - yMin)) * ch;
        ctx.save();
        ctx.globalAlpha = 0.18;
        ctx.fillStyle = colors[index % colors.length];
        ctx.fillRect(x - barWidth / 2, y, barWidth, pad.top + ch - y);
        ctx.restore();
      });
    }
  });
  bucketed.data.forEach(function(item, index) {
    if (!item.predictionTimes || item.predictionTimes.length === 0) return;
    ctx.save();
    ctx.beginPath();
    ctx.strokeStyle = predictionAccent;
    ctx.setLineDash([10, 6]);
    ctx.lineWidth = 2.5;
    item.predictionTimes.forEach(function(t, pointIndex) {
      var x = pad.left + ((t - state.viewStart) / viewDuration) * cw;
      var y = pad.top + ch - ((item.predictionValues[pointIndex] - yMin) / (yMax - yMin)) * ch;
      if (pointIndex === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
    item.predictionTimes.forEach(function(t, pointIndex) {
      var x = pad.left + ((t - state.viewStart) / viewDuration) * cw;
      var y = pad.top + ch - ((item.predictionValues[pointIndex] - yMin) / (yMax - yMin)) * ch;
      ctx.beginPath();
      ctx.fillStyle = predictionAccent;
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1.5;
      ctx.arc(x, y, 3.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    });
    ctx.restore();
  });
  bucketed.data.forEach(function(item, index) {
    if (!item.anomalies || item.anomalies.length === 0) return;
    item.anomalies.forEach(function(isAnomaly, pointIndex) {
      if (!isAnomaly) return;
      var x = pad.left + ((item.times[pointIndex] - state.viewStart) / viewDuration) * cw;
      var y = pad.top + ch - ((item.values[pointIndex] - yMin) / (yMax - yMin)) * ch;
      ctx.save();
      ctx.beginPath();
      ctx.fillStyle = '#ef4444';
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.arc(x, y, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.strokeStyle = '#ef4444';
      ctx.lineWidth = 1.5;
      ctx.arc(x, y, 8, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    });
  });
  var visibleAnomalies = bucketed.data.reduce(function(sum, item) {
    return sum + (item.anomalies || []).reduce(function(count, flag) { return count + (flag ? 1 : 0); }, 0);
  }, 0);
  var visiblePredictions = bucketed.data.reduce(function(sum, item) {
    return sum + ((item.predictionValues || []).length);
  }, 0);
  document.getElementById('density-label').textContent = labels.visible + ': ' + visiblePoints + ' · ' + labels.forecast + ': ' + visiblePredictions + ' · ' + labels.anomalies + ': ' + visibleAnomalies + ' · ' + labels.granularity + ': ' + formatBucket(bucketed.bucketMs);
  drawHover(bucketed, yMin, yMax, cw, ch, viewDuration);
}
function formatBucket(ms) {
  if (ms >= 86400000) return Math.round(ms / 86400000) + 'd';
  if (ms >= 3600000) return Math.round(ms / 3600000) + 'h';
  if (ms >= 60000) return Math.round(ms / 60000) + 'min';
  return Math.round(ms / 1000) + 's';
}
function exportReportHtml() {
  var analysis = reportData.analysis || {};
  var exportedTitle = title + ' - Analysis Report';
  var chartImage = canvas.toDataURL('image/png');
  var html = '<!doctype html><html lang="' + document.documentElement.lang + '"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>' + escapeExportHtml(exportedTitle) + '</title><style>' +
    'body{margin:0;background:#f6f7f9;color:#18202f;font:15px/1.7 -apple-system,BlinkMacSystemFont,\"Segoe UI\",Roboto,sans-serif;}' +
    '.report{width:min(100%,1280px);margin:0 auto;padding:28px 24px 48px;}' +
    '.panel{background:#fff;border:1px solid #d9dee8;border-radius:10px;padding:18px;margin-top:16px;}' +
    'h1{margin:0 0 8px;font-size:28px;line-height:1.2;}' +
    'h2{margin:0 0 12px;font-size:18px;line-height:1.3;}' +
    '.meta{color:#667085;font-size:13px;}' +
    '.summary{margin-top:8px;color:#475467;}' +
    '.chart{display:block;width:100%;border:1px solid #e5e7eb;border-radius:8px;background:#fff;}' +
    '.analysis h2,.analysis h3,.analysis h4{margin:18px 0 10px;}' +
    '.analysis p{margin:10px 0;}' +
    '.analysis ul{margin:10px 0 10px 20px;padding:0;}' +
    '.analysis li{margin:6px 0;}' +
    '.analysis code{padding:1px 5px;border-radius:4px;background:#eef2f7;font:13px ui-monospace,SFMono-Regular,Consolas,monospace;}' +
    '.analysis a{color:#2563eb;text-decoration:none;}' +
    '</style></head><body><main class="report">' +
    '<h1>' + escapeExportHtml(title) + '</h1>' +
    '<div class="meta">' + escapeExportHtml(labels.source + ': ' + sourcePathForExport) + '</div>' +
    '<div class="summary">' + escapeExportHtml(summaryForExport) + '</div>' +
    '<section class="panel"><h2>' + escapeExportHtml(labels.chart) + '</h2><img class="chart" alt="' + escapeExportHtml(title) + '" src="' + chartImage + '"></section>' +
    (analysis.html ? '<section class="panel analysis"><h2>' + escapeExportHtml(analysisTitleForExport) + '</h2>' + analysis.html + '</section>' : '') +
    '</main></body></html>';
  return html;
}
function escapeExportHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\"/g, '&quot;');
}
function downloadExportReport() {
  if (exportReportUrl) {
    window.location.assign(exportReportUrl);
    return;
  }
  var html = exportReportHtml();
  var blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  a.download = (title || 'analysis-report').replace(/[^a-z0-9._-]+/gi, '-') + '-analysis-report.html';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(function() { URL.revokeObjectURL(url); }, 1000);
}
function drawHover(bucketed, yMin, yMax, cw, ch, viewDuration) {
  var tip = document.getElementById('tooltip');
  if (state.mouseX < pad.left || state.mouseX > pad.left + cw || state.mouseY < pad.top || state.mouseY > pad.top + ch) {
    tip.style.display = 'none';
    return;
  }
  var hoverTime = state.viewStart + ((state.mouseX - pad.left) / cw) * viewDuration;
  ctx.save();
  ctx.beginPath();
  ctx.strokeStyle = '#18202f';
  ctx.setLineDash([4, 4]);
  ctx.moveTo(state.mouseX, pad.top);
  ctx.lineTo(state.mouseX, pad.top + ch);
  ctx.stroke();
  ctx.restore();
  var lines = [formatFullTime(hoverTime)];
  bucketed.data.forEach(function(item, index) {
    if (item.times.length === 0 && (!item.predictionTimes || item.predictionTimes.length === 0)) return;
    var nearest = 0;
    var best = Infinity;
    var nearestIsPrediction = false;
    for (var i = 0; i < item.times.length; i++) {
      var dist = Math.abs(item.times[i] - hoverTime);
      if (dist < best) {
        best = dist;
        nearest = i;
        nearestIsPrediction = false;
      }
    }
    for (var j = 0; j < (item.predictionTimes || []).length; j++) {
      var pdist = Math.abs(item.predictionTimes[j] - hoverTime);
      if (pdist < best) {
        best = pdist;
        nearest = j;
        nearestIsPrediction = true;
      }
    }
    var pointTime = nearestIsPrediction ? item.predictionTimes[nearest] : item.times[nearest];
    var pointValue = nearestIsPrediction ? item.predictionValues[nearest] : item.values[nearest];
    var x = pad.left + ((pointTime - state.viewStart) / viewDuration) * cw;
    var y = pad.top + ch - ((pointValue - yMin) / (yMax - yMin)) * ch;
    ctx.beginPath();
    var isAnomaly = !nearestIsPrediction && Boolean(item.anomalies && item.anomalies[nearest]);
    ctx.fillStyle = isAnomaly ? '#ef4444' : colors[index % colors.length];
    ctx.arc(x, y, isAnomaly ? 6 : 4, 0, Math.PI * 2);
    ctx.fill();
    if (isAnomaly) {
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    lines.push(series[index].label + ': ' + formatValue(pointValue) + (nearestIsPrediction ? ' · ' + labels.prediction : '') + (isAnomaly ? ' · ' + labels.anomaly : ''));
  });
  tip.innerHTML = lines.join('<br>');
  tip.style.display = 'block';
  var tx = state.mouseX + 12;
  var ty = state.mouseY - 12;
  if (tx + tip.offsetWidth > canvas.clientWidth) tx = state.mouseX - tip.offsetWidth - 12;
  tip.style.left = tx + 'px';
  tip.style.top = ty + 'px';
}
function resizeCanvas() {
  var container = document.getElementById('chart-container');
  dpr = window.devicePixelRatio || 1;
  var w = Math.max(320, container.clientWidth);
  var h = 380;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  canvas.style.width = w + 'px';
  canvas.style.height = h + 'px';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  drawChart();
}
function setView(start, end) {
  var minDuration = Math.max((timeMeta.stepMs || 1) * 4, 30 * 60000);
  var maxDuration = timeMeta.endTime - timeMeta.startTime;
  var duration = clamp(end - start, minDuration, maxDuration);
  start = clamp(start, timeMeta.startTime, timeMeta.endTime - duration);
  state.viewStart = start;
  state.viewEnd = start + duration;
  syncDateInputs();
  updateDayPills();
  drawChart();
}
canvas.addEventListener('wheel', function(e) {
  e.preventDefault();
  var rect = canvas.getBoundingClientRect();
  var cw = rect.width - pad.left - pad.right;
  var ratio = clamp((e.clientX - rect.left - pad.left) / cw, 0, 1);
  var duration = state.viewEnd - state.viewStart;
  var factor = e.deltaY > 0 ? 1.25 : 0.8;
  var newDuration = duration * factor;
  var anchor = state.viewStart + duration * ratio;
  setView(anchor - newDuration * ratio, anchor + newDuration * (1 - ratio));
}, { passive: false });
canvas.addEventListener('mousedown', function(e) {
  state.isPanning = true;
  state.panStartX = e.clientX;
  state.panViewStart = state.viewStart;
  state.panViewEnd = state.viewEnd;
  canvas.style.cursor = 'grabbing';
});
window.addEventListener('mouseup', function() {
  state.isPanning = false;
  canvas.style.cursor = 'crosshair';
});
canvas.addEventListener('mousemove', function(e) {
  var rect = canvas.getBoundingClientRect();
  state.mouseX = e.clientX - rect.left;
  state.mouseY = e.clientY - rect.top;
  if (state.isPanning) {
    var cw = rect.width - pad.left - pad.right;
    var duration = state.panViewEnd - state.panViewStart;
    var dx = e.clientX - state.panStartX;
    var shift = -(dx / cw) * duration;
    setView(state.panViewStart + shift, state.panViewEnd + shift);
    return;
  }
  drawChart();
});
canvas.addEventListener('mouseleave', function() {
  state.mouseX = -1;
  state.mouseY = -1;
  document.getElementById('tooltip').style.display = 'none';
  drawChart();
});
function buildDayPills() {
  if (selectedChartType !== 'line' && selectedChartType !== 'combo') {
    document.getElementById('day-pills').style.display = 'none';
    return;
  }
  var totalDays = Math.ceil((timeMeta.endTime - timeMeta.startTime) / 86400000);
  var container = document.getElementById('day-pills');
  container.innerHTML = '';
  if (totalDays > 31) {
    container.style.display = 'none';
    return;
  }
  container.style.display = 'flex';
  var all = document.createElement('button');
  all.className = 'chip active';
  all.textContent = labels.all;
  all.onclick = function() { setView(timeMeta.startTime, timeMeta.endTime); };
  container.appendChild(all);
  for (var i = 0; i < totalDays; i++) {
    var start = timeMeta.startTime + i * 86400000;
    var end = Math.min(start + 86400000, timeMeta.endTime);
    var d = new Date(start);
    var button = document.createElement('button');
    button.className = 'chip';
    button.dataset.start = String(start);
    button.dataset.end = String(end);
    button.textContent = pad2(d.getMonth()+1) + '/' + pad2(d.getDate());
    button.onclick = function() { setView(Number(this.dataset.start), Number(this.dataset.end)); };
    container.appendChild(button);
  }
}
function updateDayPills() {
  var chips = document.querySelectorAll('#day-pills .chip');
  for (var i = 0; i < chips.length; i++) {
    var chip = chips[i];
    var start = chip.dataset.start ? Number(chip.dataset.start) : timeMeta.startTime;
    var end = chip.dataset.end ? Number(chip.dataset.end) : timeMeta.endTime;
    chip.classList.toggle('active', Math.abs(state.viewStart - start) < 60000 && Math.abs(state.viewEnd - end) < 60000);
  }
}
function syncDateInputs() {
  if (selectedChartType !== 'line' && selectedChartType !== 'combo') return;
  document.getElementById('date-start').value = toDateInput(state.viewStart);
  document.getElementById('date-end').value = toDateInput(state.viewEnd - 1);
}
function buildLegend() {
  var legend = document.getElementById('legend');
  legend.innerHTML = '';
  if (selectedChartType === 'bar' || selectedChartType === 'donut') {
    currentCategoryItems().forEach(function(item, index) {
      var label = document.createElement('div');
      label.className = 'legend-item';
      label.innerHTML = '<span class="swatch" style="background:' + colors[index % colors.length] + '"></span><span class="truncate">' + item.label.replace(/[&<>"]/g, function(c) { return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]); }) + '</span><span>' + formatValue(item.value) + '</span>';
      legend.appendChild(label);
    });
    return;
  }
  series.forEach(function(s, index) {
    var label = document.createElement('label');
    label.className = 'legend-item';
    label.innerHTML = '<input type="checkbox" checked data-index="' + index + '"><span class="swatch" style="background:' + colors[index % colors.length] + '"></span><span class="truncate">' + s.label.replace(/[&<>"]/g, function(c) { return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]); }) + '</span>' + ((s.predictions || []).length ? '<span class="swatch" style="background:' + predictionAccent + ';border-radius:999px"></span><span>' + labels.prediction + '</span>' : '');
    label.querySelector('input').onchange = function() {
      visible[Number(this.dataset.index)] = this.checked;
      drawChart();
    };
    legend.appendChild(label);
  });
}
function buildViewSwitcher() {
  function chartTypeIcon(type) {
    if (type === 'line') {
      return '<svg viewBox="0 0 16 16" aria-hidden="true"><polyline points="2,11 6,8 9,9 14,4"></polyline><circle cx="6" cy="8" r="1"></circle><circle cx="9" cy="9" r="1"></circle><circle cx="14" cy="4" r="1"></circle></svg>';
    }
    if (type === 'bar') {
      return '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="2" y="8" width="2.5" height="5"></rect><rect x="6.75" y="5" width="2.5" height="8"></rect><rect x="11.5" y="3" width="2.5" height="10"></rect></svg>';
    }
    if (type === 'pie') {
      return '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 8 L8 2.5 A5.5 5.5 0 1 1 2.8 9.6 Z"></path></svg>';
    }
    if (type === 'donut') {
      return '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="4.5"></circle><circle cx="8" cy="8" r="2.1" class="cutout"></circle><path d="M8 3.5 A4.5 4.5 0 0 1 12.5 8"></path></svg>';
    }
    if (type === 'combo') {
      return '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="2" y="9" width="2.5" height="4"></rect><rect x="6.75" y="6" width="2.5" height="7"></rect><polyline points="2,7 6.75,5 10,7 14,3.5"></polyline></svg>';
    }
    return '';
  }
  var host = document.getElementById('view-switcher');
  if (!host) return;
  host.innerHTML = '';
  availableChartTypes.forEach(function(type) {
    var button = document.createElement('button');
    button.className = 'chip chart-type-chip' + (selectedChartType === type ? ' active' : '');
    button.innerHTML = '<span class="chart-type-chip__icon">' + chartTypeIcon(type) + '</span><span>' + (labels.chartTypes[type] || type) + '</span>';
    button.onclick = function() {
      selectedChartType = type;
      document.getElementById('time-controls').hidden = !(type === 'line' || type === 'combo');
      buildDayPills();
      buildLegend();
      syncDateInputs();
      drawChart();
      buildViewSwitcher();
    };
    host.appendChild(button);
  });
}
document.getElementById('reset-zoom').onclick = function() { if (selectedChartType === 'line' || selectedChartType === 'combo') setView(timeMeta.startTime, timeMeta.endTime); };
document.getElementById('granularity').onchange = function() {
  state.granularity = this.value;
  drawChart();
};
document.getElementById('date-start').onchange = function() {
  if (selectedChartType !== 'line' && selectedChartType !== 'combo') return;
  var start = new Date(this.value).getTime();
  setView(start, state.viewEnd);
};
document.getElementById('date-end').onchange = function() {
  if (selectedChartType !== 'line' && selectedChartType !== 'combo') return;
  var end = new Date(this.value).getTime() + 86400000;
  setView(state.viewStart, end);
};
if (typeof ResizeObserver !== 'undefined') new ResizeObserver(resizeCanvas).observe(document.getElementById('chart-container'));
else window.addEventListener('resize', resizeCanvas);
buildLegend();
buildDayPills();
syncDateInputs();
buildViewSwitcher();
resizeCanvas();
`;

function renderTableRows(rows, columns) {
  if (rows.length === 0 || columns.length === 0) return "";
  return rows
    .map(
      (row) =>
        `<tr>${columns.map((column) => `<td>${escapeHtml(row?.[column] ?? "")}</td>`).join("")}</tr>`,
    )
    .join("");
}

const resolvedHtmlPath = htmlOutPath
  ? path.resolve(htmlOutPath)
  : defaultCanvasHtmlPath(canvasRoot, title);
const isCanvasHosted =
  resolvedHtmlPath === canvasRoot || isPathInside(canvasRoot, resolvedHtmlPath);
const defaultBase = outPath
  ? path.join(path.dirname(outPath), path.basename(outPath, path.extname(outPath)))
  : path.join(
      path.dirname(resolvedHtmlPath),
      path.basename(resolvedHtmlPath, path.extname(resolvedHtmlPath)),
    );
const resolvedPayloadPath = path.resolve(payloadOutPath || `${defaultBase}.payload.json`);
const canvasUrl = isCanvasHosted ? canvasUrlForPath(canvasRoot, resolvedHtmlPath) : "";
const summaryMarkdown = canvasUrl
  ? `${summaryMarkdownBase}\n\n[打开完整报表](${canvasUrl})`
  : summaryMarkdownBase;

const html = `<!doctype html>
<html lang="${escapeHtml(language)}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <style>
    :root { --bg:#f6f7f9; --panel:#fff; --text:#18202f; --muted:#667085; --border:#d9dee8; --soft:#eef2f7; --accent:#2563eb; --radius:8px; font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif; }
    * { box-sizing:border-box; }
    html { width:100%; min-width:0; overflow-y:auto; }
    body { width:100%; min-width:0; margin:0; background:var(--bg); color:var(--text); overflow-x:hidden; }
    .report { width:min(100%,1180px); margin:0 auto; padding:22px clamp(18px,3vw,42px); }
    header { display:flex; justify-content:space-between; gap:16px; align-items:flex-start; margin-bottom:16px; }
    h1 { margin:0 0 6px; font-size:24px; line-height:1.2; letter-spacing:0; }
    h2 { margin:0; font-size:15px; }
    .meta,.note,footer { color:var(--muted); font-size:13px; line-height:1.5; }
    .cards { display:grid; grid-template-columns:repeat(6,minmax(120px,1fr)); gap:10px; margin-bottom:14px; }
    .card,.panel { background:var(--panel); border:1px solid var(--border); border-radius:var(--radius); }
    .card { padding:12px; min-height:76px; }
    .label { color:var(--muted); font-size:12px; margin-bottom:7px; }
    .value { font-size:22px; font-weight:650; line-height:1.15; }
    .panel { padding:14px; margin-top:12px; }
    .panel-title { display:flex; align-items:baseline; justify-content:space-between; gap:12px; margin-bottom:10px; }
    .toolbar { display:flex; gap:8px; align-items:center; flex-wrap:wrap; margin-bottom:10px; }
    .toolbar[hidden] { display:none; }
    .toolbar-group { display:flex; gap:8px; align-items:center; flex-wrap:wrap; }
    .chip,.button,select,input[type="date"] { min-height:28px; padding:4px 9px; border:1px solid var(--border); border-radius:5px; background:#fff; color:var(--text); font-size:12px; }
    .chip { cursor:pointer; color:var(--muted); }
    .chip.active { background:var(--accent); color:#fff; border-color:var(--accent); }
    .chart-type-chip { display:inline-flex; align-items:center; gap:6px; }
    .chart-type-chip__icon { display:inline-flex; width:14px; height:14px; align-items:center; justify-content:center; }
    .chart-type-chip__icon svg { width:14px; height:14px; stroke:currentColor; fill:none; stroke-width:1.6; stroke-linecap:round; stroke-linejoin:round; }
    .chart-type-chip__icon svg rect { fill:currentColor; stroke:none; rx:0.9; ry:0.9; }
    .chart-type-chip__icon svg .cutout { fill:#fff; stroke:none; }
    a.button { display:inline-flex; align-items:center; text-decoration:none; }
    .chart-container { position:relative; min-height:440px; overflow:visible; }
    #chart-canvas { display:block; width:100%; height:440px; cursor:crosshair; }
    .tooltip { position:absolute; display:none; pointer-events:none; z-index:10; background:#fff; border:1px solid var(--border); border-radius:6px; padding:7px 10px; box-shadow:0 2px 10px rgba(15,23,42,.12); font-size:12px; white-space:nowrap; }
    .legend { display:grid; grid-template-columns:repeat(auto-fit,minmax(220px,1fr)); gap:8px 14px; margin-top:10px; }
    .legend-item { display:flex; gap:8px; align-items:center; min-width:0; font-size:12px; color:var(--muted); }
    .swatch { width:10px; height:10px; border-radius:2px; flex:0 0 auto; }
    .truncate { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .table-wrap { width:100%; overflow:visible; max-height:none; }
    table { width:100%; border-collapse:collapse; font-size:13px; }
    th,td { padding:8px 10px; border-bottom:1px solid var(--soft); text-align:left; }
    th { color:var(--muted); font-weight:600; background:#fafbfc; }
    td.num,th.num { text-align:right; font-variant-numeric:tabular-nums; }
    .analysis-body h2 { margin:18px 0 10px; font-size:18px; line-height:1.35; }
    .analysis-body h3,.analysis-body h4 { margin:16px 0 8px; font-size:16px; line-height:1.35; }
    .analysis-body p { margin:10px 0; line-height:1.7; }
    .analysis-body ul { margin:10px 0 10px 20px; padding:0; }
    .analysis-body ol { margin:10px 0 10px 20px; padding:0; }
    .analysis-body li { margin:6px 0; }
    .analysis-body blockquote { margin:12px 0; padding:8px 12px; border-left:3px solid var(--border); background:#fafbfc; color:var(--muted); }
    .analysis-body code { padding:1px 5px; border-radius:4px; background:var(--soft); font:12px ui-monospace,SFMono-Regular,Consolas,monospace; }
    .analysis-body a { color:var(--accent); text-decoration:none; }
    .analysis-body .analysis-table-wrap { width:100%; overflow-x:auto; margin:12px 0; }
    .analysis-body table { width:100%; border-collapse:collapse; font-size:13px; }
    .analysis-body th,.analysis-body td { padding:8px 10px; border:1px solid var(--soft); text-align:left; vertical-align:top; }
    .analysis-body th { background:#fafbfc; color:var(--muted); font-weight:600; }
    @media (max-width:760px) { .report{padding:14px;} header{display:block;} .cards{grid-template-columns:repeat(2,minmax(0,1fr));} .chart-container{min-height:360px;} #chart-canvas{height:360px;} h1{font-size:20px;} .value{font-size:19px;} }
  </style>
</head>
<body>
  <main class="report">
    <header>
      <div>
        <h1>${escapeHtml(title)}</h1>
      </div>
    </header>

    <section class="cards" aria-label="summary">
      <div class="card"><div class="label">${escapeHtml(labels.series)}</div><div class="value">${series.length}</div></div>
      <div class="card"><div class="label">${escapeHtml(labels.points)}</div><div class="value">${totalRawPoints.toLocaleString("en-US")}</div></div>
      <div class="card"><div class="label">${escapeHtml(labels.forecast)}</div><div class="value">${totalPredictionPoints.toLocaleString("en-US")}</div></div>
      <div class="card"><div class="label">${escapeHtml(labels.mean)}</div><div class="value">${escapeHtml(fmt(globalStats.mean))}</div></div>
      <div class="card"><div class="label">${escapeHtml(labels.max)}</div><div class="value">${escapeHtml(fmt(globalStats.max))}</div></div>
      <div class="card"><div class="label">${escapeHtml(labels.min)}</div><div class="value">${escapeHtml(fmt(globalStats.min))}</div></div>
    </section>

    ${
      series.length > 0
        ? `<section class="panel">
      <div class="panel-title"><h2>${escapeHtml(labels.chart)}</h2><span class="meta" id="density-label"></span></div>
      <div class="toolbar">
        <div id="view-switcher" class="toolbar-group"></div>
        <div id="time-controls" class="toolbar-group" ${chartType === "line" || chartType === "combo" ? "" : "hidden"}>
        <div id="day-pills" class="toolbar-group"></div>
        <span class="meta">${escapeHtml(labels.dateRange)}</span>
        <input type="date" id="date-start">
        <input type="date" id="date-end">
        <span class="meta">${escapeHtml(labels.granularity)}</span>
        <select id="granularity">
          <option value="auto">${escapeHtml(labels.auto)}</option>
          <option value="raw">${escapeHtml(labels.raw)}</option>
          <option value="hour">${escapeHtml(labels.hour)}</option>
          <option value="day">${escapeHtml(labels.day)}</option>
        </select>
        <button class="button" id="reset-zoom">${escapeHtml(labels.resetZoom)}</button>
        </div>
      </div>
      <div class="chart-container" id="chart-container"><canvas id="chart-canvas"></canvas><div class="tooltip" id="tooltip"></div></div>
      <div class="legend" id="legend"></div>
    </section>`
        : `<section class="panel"><div class="panel-title"><h2>Table</h2><span class="meta">${tableRows.length}</span></div><div class="table-wrap"><table><thead><tr>${tableColumns
            .map((column) => `<th>${escapeHtml(column)}</th>`)
            .join(
              "",
            )}</tr></thead><tbody>${renderTableRows(tableRows, tableColumns)}</tbody></table></div></section>`
    }

    <section class="panel">
      <div class="panel-title"><h2>${escapeHtml(labels.ranking)}</h2><span class="meta">Top ${ranking.length}</span></div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>${escapeHtml(labels.object)}</th><th class="num">${escapeHtml(labels.mean)}</th><th class="num">${escapeHtml(labels.max)}</th><th class="num">${escapeHtml(labels.min)}</th><th class="num">${escapeHtml(labels.first)}</th><th class="num">${escapeHtml(labels.last)}</th><th class="num">${escapeHtml(labels.change)}</th></tr></thead>
          <tbody>${ranking
            .map(
              (entry) =>
                `<tr><td>${escapeHtml(entry.label)}</td><td class="num">${escapeHtml(fmt(entry.stats.mean))}</td><td class="num">${escapeHtml(fmt(entry.stats.max))}</td><td class="num">${escapeHtml(fmt(entry.stats.min))}</td><td class="num">${escapeHtml(fmt(entry.stats.first))}</td><td class="num">${escapeHtml(fmt(entry.stats.last))}</td><td class="num">${escapeHtml(fmt(entry.stats.change))}</td></tr>`,
            )
            .join("")}</tbody>
        </table>
      </div>
    </section>

    ${
      hasAnalysis
        ? `<section class="panel">
      <div class="panel-title"><h2>${escapeHtml(labels.analysisReport)}</h2></div>
      <div class="analysis-body">${analysisHtml}</div>
    </section>`
        : ""
    }
  </main>
  <script id="report-data" type="application/json">${escapeScriptJson(embeddedData)}</script>
  <script>${series.length > 0 || categoryItems.length > 0 ? chartJs : ""}</script>
</body>
</html>`;

fs.mkdirSync(path.dirname(resolvedHtmlPath), { recursive: true });
fs.writeFileSync(resolvedHtmlPath, html, "utf8");

const exportedReportHtml = `<!doctype html>
<html lang="${escapeHtml(language)}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)} - ${escapeHtml(labels.analysisReport)}</title>
  <style>
    body { margin:0; background:#f6f7f9; color:#18202f; font:15px/1.7 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif; }
    .report { width:min(100%,1280px); margin:0 auto; padding:28px 24px 48px; }
    .panel { background:#fff; border:1px solid #d9dee8; border-radius:10px; padding:18px; margin-top:16px; }
    h1 { margin:0 0 8px; font-size:28px; line-height:1.2; }
    h2 { margin:0 0 12px; font-size:18px; line-height:1.3; }
    .meta { color:#667085; font-size:13px; }
    .summary { margin-top:8px; color:#475467; }
    .chart-frame { width:100%; min-height:720px; border:1px solid #e5e7eb; border-radius:8px; background:#fff; }
    .analysis-body h2 { margin:18px 0 10px; font-size:18px; line-height:1.35; }
    .analysis-body h3,.analysis-body h4 { margin:18px 0 10px; }
    .analysis-body p { margin:10px 0; }
    .analysis-body ul,.analysis-body ol { margin:10px 0 10px 20px; padding:0; }
    .analysis-body li { margin:6px 0; }
    .analysis-body blockquote { margin:12px 0; padding:8px 12px; border-left:3px solid #d9dee8; background:#fafbfc; color:#667085; }
    .analysis-body code { padding:1px 5px; border-radius:4px; background:#eef2f7; font:13px ui-monospace,SFMono-Regular,Consolas,monospace; }
    .analysis-body a { color:#2563eb; text-decoration:none; }
    .analysis-body .analysis-table-wrap { width:100%; overflow-x:auto; margin:12px 0; }
    .analysis-body table { width:100%; border-collapse:collapse; font-size:13px; }
    .analysis-body th,.analysis-body td { padding:8px 10px; border:1px solid #eef2f7; text-align:left; vertical-align:top; }
    .analysis-body th { background:#fafbfc; color:#667085; font-weight:600; }
  </style>
</head>
<body>
  <main class="report">
    <h1>${escapeHtml(title)}</h1>
    <section class="panel">
      <h2>${escapeHtml(labels.chart)}</h2>
      <iframe class="chart-frame" src="${escapeHtml(canvasUrl)}" title="${escapeHtml(title)}" sandbox="allow-scripts"></iframe>
    </section>
    ${
      hasAnalysis
        ? `<section class="panel analysis">
      <h2>${escapeHtml(labels.analysisReport)}</h2>
      <div class="analysis-body">${analysisHtml}</div>
    </section>`
        : ""
    }
  </main>
</body>
</html>
`;
fs.mkdirSync(path.dirname(exportHtmlPath), { recursive: true });
fs.writeFileSync(exportHtmlPath, exportedReportHtml, "utf8");

const payload = {
  title,
  summaryMarkdown,
  html,
  preferredHeight: spec.preferredHeight ?? 620,
};

if (payloadOutPath || spec.emitFullPayload === true) {
  fs.mkdirSync(path.dirname(resolvedPayloadPath), { recursive: true });
  fs.writeFileSync(resolvedPayloadPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

const pointer = {
  title,
  summaryMarkdown,
  htmlPath: resolvedHtmlPath,
  ...(canvasUrl ? { canvasUrl } : {}),
  canvasRoot,
  ...(exportCanvasUrl ? { exportReportUrl: exportCanvasUrl } : {}),
  ...(payloadOutPath || spec.emitFullPayload === true ? { payloadPath: resolvedPayloadPath } : {}),
  preferredHeight: payload.preferredHeight,
  bytes: {
    html: Buffer.byteLength(html, "utf8"),
    ...(payloadOutPath || spec.emitFullPayload === true
      ? { payload: fs.statSync(resolvedPayloadPath).size }
      : {}),
  },
  render: {
    sourcePath: path.resolve(input),
    analysisSourcePath: analysis.sourcePath || "",
    exportHtmlPath,
    exportCanvasUrl,
    component:
      chartType === "bar"
        ? "categorical-bar-canvas"
        : chartType === "donut"
          ? "categorical-donut-canvas"
          : chartType === "combo"
            ? "interactive-combo-canvas"
            : totalPredictionPoints > 0
              ? "interactive-prediction-time-series-canvas"
              : series.length > 0
                ? "interactive-time-series-canvas"
                : "table",
    chartType,
    hostedByCanvas: Boolean(canvasUrl),
    seriesCount: series.length,
    rawPointCount: totalRawPoints,
    anomalySummary: embeddedData.anomalySummary,
    interactive: series.length > 0,
    downsampled: false,
    timeMeta: embeddedData.timeMeta,
  },
};

const pointerJson = `${JSON.stringify(pointer, null, 2)}\n`;
if (outPath) {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, pointerJson, "utf8");
} else {
  process.stdout.write(pointerJson);
}
