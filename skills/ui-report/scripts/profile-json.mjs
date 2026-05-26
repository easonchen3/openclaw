#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const input = args[0];
const outIndex = args.indexOf("--out");
const outPath = outIndex >= 0 ? args[outIndex + 1] : "";
const refTimeIndex = args.indexOf("--ref-time");
const refTimeRaw = refTimeIndex >= 0 ? args[refTimeIndex + 1] : null;
const refTimeMs = refTimeRaw
  ? /^\d+$/.test(refTimeRaw)
    ? Number(refTimeRaw)
    : new Date(refTimeRaw).getTime()
  : Date.now();

if (!input) {
  console.error(
    "Usage: node skills/ui-report/scripts/profile-json.mjs <data.json> [--out profile.json] [--ref-time <epochMs>]",
  );
  process.exit(2);
}

const raw = fs.readFileSync(input, "utf8").replace(/^\uFEFF/u, "");
const data = JSON.parse(raw);
const stat = fs.statSync(input);

const parseTimeStep = (stepStr) => {
  if (typeof stepStr !== "string") return null;
  const match =
    /^(\d+)\s*(s|sec|second|seconds|min|m|minute|minutes|h|hr|hour|hours|d|day|days)$/iu.exec(
      stepStr.trim(),
    );
  if (!match) return null;
  const n = Number(match[1]);
  const unit = match[2].toLowerCase();
  if (unit === "s" || unit.startsWith("sec")) return n * 1000;
  if (unit === "min" || unit === "m" || unit.startsWith("minute")) return n * 60000;
  if (unit === "h" || unit === "hr" || unit.startsWith("hour")) return n * 3600000;
  if (unit === "d" || unit.startsWith("day")) return n * 86400000;
  return null;
};

const parseTimeRange = (rangeStr, stepMs, pointCount, refTimeMs) => {
  const relativeMap = {
    最近一周: 7 * 86400000,
    最近一天: 86400000,
    最近两周: 14 * 86400000,
    最近一月: 30 * 86400000,
    最近三月: 90 * 86400000,
    最近半年: 180 * 86400000,
  };
  if (rangeStr && relativeMap[rangeStr]) {
    const durationMs = relativeMap[rangeStr];
    const endTime = refTimeMs;
    const startTime = endTime - durationMs;
    const adjustedEnd = startTime + pointCount * stepMs;
    return {
      startTime,
      endTime: adjustedEnd,
      stepMs,
      durationMs,
      pointCount,
      timeRangeType: "relative",
    };
  }
  if (rangeStr && rangeStr.includes("~")) {
    const [start, end] = rangeStr.split("~");
    const startTime = new Date(start).getTime();
    const endTimeRaw = new Date(end).getTime();
    const adjustedEnd = startTime + pointCount * stepMs;
    return {
      startTime,
      endTime: adjustedEnd,
      stepMs,
      durationMs: adjustedEnd - startTime,
      pointCount,
      timeRangeType: "absolute",
    };
  }
  const durationMs = pointCount * stepMs;
  const endTime = refTimeMs;
  const startTime = endTime - durationMs;
  const adjustedEnd = startTime + pointCount * stepMs;
  return {
    startTime,
    endTime: adjustedEnd,
    stepMs,
    durationMs,
    pointCount,
    timeRangeType: "inferred",
  };
};

const computeGranularityTiers = (stepMs, durationMs) => {
  const stepLabel =
    stepMs >= 86400000
      ? `${stepMs / 86400000}d`
      : stepMs >= 3600000
        ? `${stepMs / 3600000}h`
        : `${stepMs / 60000}min`;
  const tiers = [{ label: `原始 (${stepLabel})`, bucketMs: stepMs }];
  if (durationMs > 3 * 3600000) tiers.push({ label: "小时", bucketMs: 3600000 });
  if (durationMs > 3 * 86400000) tiers.push({ label: "天", bucketMs: 86400000 });
  return tiers;
};

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const hasNumericArray = (value) =>
  isObject(value) &&
  Object.values(value).some(
    (entry) =>
      Array.isArray(entry) &&
      entry.some((item) => typeof item === "number" && Number.isFinite(item)),
  );
const numberStats = (values) => {
  const nums = values.filter((value) => typeof value === "number" && Number.isFinite(value));
  if (nums.length === 0) return null;
  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  for (const value of nums) {
    min = Math.min(min, value);
    max = Math.max(max, value);
    sum += value;
  }
  return {
    count: nums.length,
    min,
    max,
    mean: Number((sum / nums.length).toFixed(4)),
    first: nums[0],
    last: nums[nums.length - 1],
  };
};

const isFiniteNumber = (value) => typeof value === "number" && Number.isFinite(value);

function detectRowFields(rows) {
  const sample = rows.find(isObject) ?? {};
  const keys = Object.keys(sample);
  const timeField = keys.find((key) =>
    /^(time|timestamp|date|datetime|ts|period|bucket)$/iu.test(key),
  );
  const entityField = keys.find((key) =>
    /^(object|entity|name|label|id|host|instance|service|category|group|dimension)$/iu.test(key),
  );
  const valueField = keys.find(
    (key) =>
      isFiniteNumber(sample[key]) &&
      !/^(time|timestamp|date|datetime|ts|period|bucket)$/iu.test(key),
  );
  return { timeField, entityField, valueField };
}

function detectChartRecommendation() {
  if (records.length > 0 && series.some((entry) => entry.arrays.some((array) => array.numeric))) {
    const hasPredictions = records.some(
      (record) => Array.isArray(record.predictions) && record.predictions.some(isFiniteNumber),
    );
    return {
      primary: "line",
      component:
        totalAnomalies > 0
          ? "interactive-anomaly-time-series-canvas"
          : hasPredictions
            ? "interactive-prediction-time-series-canvas"
            : "interactive-time-series-canvas",
      rationale:
        totalAnomalies > 0
          ? "time series with anomaly markers"
          : hasPredictions
            ? "time series with forecast"
            : "time series trend",
    };
  }

  if (Array.isArray(data) && data.every(isObject)) {
    const { timeField, entityField, valueField } = detectRowFields(data);
    if (!timeField && entityField && valueField) {
      return {
        primary: data.length <= 8 ? "donut" : "bar",
        component: data.length <= 8 ? "categorical-donut" : "categorical-bar",
        rationale: data.length <= 8 ? "small categorical composition" : "categorical comparison",
      };
    }
  }

  if (isObject(data)) {
    const numericScalarKeys = Object.entries(data)
      .filter(([, value]) => isFiniteNumber(value))
      .map(([key]) => key);
    if (numericScalarKeys.length >= 2) {
      return {
        primary: numericScalarKeys.length <= 8 ? "donut" : "bar",
        component: numericScalarKeys.length <= 8 ? "categorical-donut" : "categorical-bar",
        rationale: "numeric scalar object",
      };
    }
  }

  return {
    primary: "table",
    component: "table",
    rationale: "generic structured data",
  };
}

const asRecords = (value) => {
  if (Array.isArray(value)) return value;
  if (hasNumericArray(value)) return [value];
  if (isObject(value)) return Object.values(value);
  return [];
};

const records = asRecords(data).filter(isObject);
const fields = [...new Set(records.flatMap((record) => Object.keys(record)))];
const series = [];
let totalPoints = 0;
let maxSeriesPoints = 0;
let totalAnomalies = 0;
let anomalySeriesCount = 0;
let predictionSeriesCount = 0;
let totalPredictionPoints = 0;

function anomalyStats(record, valueLength) {
  const raw = Array.isArray(record.anomaly_indices)
    ? record.anomaly_indices
    : Array.isArray(record.anomalyIndices)
      ? record.anomalyIndices
      : Array.isArray(record.anomalies)
        ? record.anomalies
        : [];
  if (!Array.isArray(raw)) {
    return {
      hasAnomalyFields: false,
      anomalyCount: 0,
      anomalyFlagLength: 0,
      alignsWithValue: false,
    };
  }
  if (
    !Array.isArray(record.anomaly_indices) &&
    !Array.isArray(record.anomalyIndices) &&
    !Array.isArray(record.anomalies)
  ) {
    return {
      hasAnomalyFields: false,
      anomalyCount: 0,
      anomalyFlagLength: 0,
      alignsWithValue: false,
    };
  }
  const anomalyCount = raw.reduce((sum, value) => sum + (value === 1 || value === true ? 1 : 0), 0);
  totalAnomalies += anomalyCount;
  anomalySeriesCount += 1;
  return {
    hasAnomalyFields: true,
    anomalyCount,
    anomalyFlagLength: raw.length,
    alignsWithValue: raw.length === valueLength,
    hasAnomaly: Boolean(record.has_anomaly ?? record.hasAnomaly ?? anomalyCount > 0),
    lowerBound: typeof record.lower_bound === "number" ? record.lower_bound : record.lowerBound,
    upperBound: typeof record.upper_bound === "number" ? record.upper_bound : record.upperBound,
    mean: typeof record.mean === "number" ? record.mean : undefined,
    std: typeof record.std === "number" ? record.std : undefined,
  };
}

for (const [index, record] of records.entries()) {
  const label = record.object ?? record.name ?? record.label ?? record.id ?? String(index);
  const arrays = Object.entries(record).filter(([, value]) => Array.isArray(value));
  const primaryArray =
    arrays.find(([key, value]) => key === "value" && Array.isArray(value)) ?? arrays[0];
  const anomaly = anomalyStats(
    record,
    Array.isArray(primaryArray?.[1]) ? primaryArray[1].length : 0,
  );
  const arrayProfiles = arrays.map(([key, value]) => {
    const stats = numberStats(value);
    totalPoints += Array.isArray(value) ? value.length : 0;
    maxSeriesPoints = Math.max(maxSeriesPoints, Array.isArray(value) ? value.length : 0);
    return {
      field: key,
      length: value.length,
      itemType: value.length > 0 ? typeof value[0] : "unknown",
      numeric: stats,
      sample: value.slice(0, Math.min(3, value.length)),
    };
  });
  const predictions = Array.isArray(record.predictions)
    ? record.predictions.filter(isFiniteNumber)
    : Array.isArray(record.predicted_values)
      ? record.predicted_values.filter(isFiniteNumber)
      : [];
  if (predictions.length > 0) {
    predictionSeriesCount += 1;
    totalPredictionPoints += predictions.length;
  }
  series.push({
    index,
    label,
    scalarFields: Object.fromEntries(
      Object.entries(record)
        .filter(([, value]) => !Array.isArray(value) && typeof value !== "object")
        .slice(0, 12),
    ),
    ...(anomaly.hasAnomalyFields ? { anomaly } : {}),
    ...(predictions.length > 0
      ? {
          prediction: {
            count: predictions.length,
            sample: predictions.slice(0, 3),
            last: predictions[predictions.length - 1],
          },
        }
      : {}),
    arrays: arrayProfiles,
  });
}

const timeStepStr = isObject(data) ? (data.time_step ?? data.timeStep ?? data.step ?? "") : "";
const timeRangeStr = isObject(data) ? (data.time_range ?? data.timeRange ?? data.range ?? "") : "";
const stepMs = parseTimeStep(timeStepStr) ?? 300000;
const timeInfo = parseTimeRange(timeRangeStr, stepMs, maxSeriesPoints || totalPoints, refTimeMs);
const granularityTiers = computeGranularityTiers(stepMs, timeInfo.durationMs);

const timeMeta = {
  timeRange: timeRangeStr || "(inferred)",
  timeStep: timeStepStr || "(5min default)",
  timeRangeType: timeInfo.timeRangeType,
  startTime: new Date(timeInfo.startTime).toISOString(),
  endTime: new Date(timeInfo.endTime).toISOString(),
  stepMs,
  durationMs: timeInfo.durationMs,
  pointCount: maxSeriesPoints || totalPoints,
  granularityTiers,
};

const profile = {
  source: path.normalize(input),
  fileSizeBytes: stat.size,
  topLevelShape: Array.isArray(data) ? "array" : isObject(data) ? "object" : typeof data,
  topLevelCount: Array.isArray(data) ? data.length : isObject(data) ? Object.keys(data).length : 1,
  recordCount: records.length,
  fields,
  totalArrayPoints: totalPoints,
  detectedShape:
    records.length > 0 && series.some((entry) => entry.arrays.some((array) => array.numeric))
      ? totalAnomalies > 0 || anomalySeriesCount > 0
        ? "anomaly-series-records"
        : predictionSeriesCount > 0
          ? "prediction-series-records"
          : "series-records"
      : Array.isArray(data) && data.every(isObject) && detectRowFields(data).valueField
        ? detectRowFields(data).timeField
          ? "row-time-series"
          : "categorical-records"
        : isObject(data) && Object.values(data).some(isFiniteNumber)
          ? "numeric-object"
          : "generic-json",
  anomalySummary: {
    hasAnomalyFields: anomalySeriesCount > 0,
    seriesWithAnomalyFields: anomalySeriesCount,
    totalAnomalies,
  },
  predictionSummary: {
    hasPredictionFields: predictionSeriesCount > 0,
    seriesWithPredictionFields: predictionSeriesCount,
    totalPredictionPoints,
  },
  timeMeta,
  chartRecommendation: detectChartRecommendation(),
  series: series.slice(0, 24),
};

const json = JSON.stringify(profile, null, 2);
if (outPath) {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${json}\n`, "utf8");
} else {
  process.stdout.write(`${json}\n`);
}
