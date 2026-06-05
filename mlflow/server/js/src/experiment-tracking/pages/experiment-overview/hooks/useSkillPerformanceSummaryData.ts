import { useMemo } from 'react';
import {
  MetricViewType,
  AggregationType,
  SpanMetricKey,
  SpanDimensionKey,
} from '@databricks/web-shared/model-trace-explorer';
import { useTraceMetricsQuery } from './useTraceMetricsQuery';
import { useOverviewChartContext } from '../OverviewChartContext';

// PERCENTILE response keys are formatted as `P{value}.0` by the backend
// (e.g., {"aggregation_type": "PERCENTILE", "percentile_value": 0} → "P0.0").
// MIN/MAX are unsupported at the span-level for LATENCY and *_COST metrics,
// so we approximate them via 0th and 100th percentiles.
const PERCENTILE_MIN_KEY = 'P0.0';
const PERCENTILE_MAX_KEY = 'P100.0';

const MIN_MAX_AGGS = [
  { aggregation_type: AggregationType.AVG },
  { aggregation_type: AggregationType.PERCENTILE, percentile_value: 0 },
  { aggregation_type: AggregationType.PERCENTILE, percentile_value: 100 },
];

export interface SkillPerformanceData {
  skillName: string;
  totalCalls: number;
  avgLatency: number;
  minLatency: number;
  maxLatency: number;
  avgCost: number;
  minCost: number;
  maxCost: number;
}

export interface UseSkillPerformanceSummaryDataResult {
  skillsData: SkillPerformanceData[];
  isLoading: boolean;
  error: unknown;
  hasData: boolean;
}

interface AggregatedMetric {
  avg: number;
  min: number;
  max: number;
}

function readAvgMinMax(values: Record<string, number> | undefined): AggregatedMetric {
  return {
    avg: values?.[AggregationType.AVG] ?? 0,
    min: values?.[PERCENTILE_MIN_KEY] ?? 0,
    max: values?.[PERCENTILE_MAX_KEY] ?? 0,
  };
}

export function useSkillPerformanceSummaryData({
  enabled = true,
}: { enabled?: boolean } = {}): UseSkillPerformanceSummaryDataResult {
  const { experimentIds, startTimeMs, endTimeMs } = useOverviewChartContext();

  const {
    data: countData,
    isLoading: isLoadingCounts,
    error: countsError,
  } = useTraceMetricsQuery({
    experimentIds,
    startTimeMs,
    endTimeMs,
    viewType: MetricViewType.SPANS,
    metricName: SpanMetricKey.SPAN_COUNT,
    aggregations: [{ aggregation_type: AggregationType.COUNT }],
    dimensions: [SpanDimensionKey.SKILL_NAME, SpanDimensionKey.SPAN_STATUS],
    enabled,
  });

  const {
    data: latencyData,
    isLoading: isLoadingLatency,
    error: latencyError,
  } = useTraceMetricsQuery({
    experimentIds,
    startTimeMs,
    endTimeMs,
    viewType: MetricViewType.SPANS,
    metricName: SpanMetricKey.LATENCY,
    aggregations: MIN_MAX_AGGS,
    dimensions: [SpanDimensionKey.SKILL_NAME],
    enabled,
  });

  const {
    data: costData,
    isLoading: isLoadingCost,
    error: costError,
  } = useTraceMetricsQuery({
    experimentIds,
    startTimeMs,
    endTimeMs,
    viewType: MetricViewType.SPANS,
    metricName: SpanMetricKey.TOTAL_COST,
    aggregations: MIN_MAX_AGGS,
    dimensions: [SpanDimensionKey.SKILL_NAME],
    enabled,
  });

  const skillsData = useMemo(() => {
    const countMap = new Map<string, number>();
    const latencyMap = new Map<string, AggregatedMetric>();
    const costMap = new Map<string, AggregatedMetric>();

    if (countData?.data_points) {
      for (const dp of countData.data_points) {
        const skillName = dp.dimensions?.[SpanDimensionKey.SKILL_NAME];
        if (!skillName) continue;
        const count = dp.values?.[AggregationType.COUNT] ?? 0;
        countMap.set(skillName, (countMap.get(skillName) ?? 0) + count);
      }
    }

    if (latencyData?.data_points) {
      for (const dp of latencyData.data_points) {
        const skillName = dp.dimensions?.[SpanDimensionKey.SKILL_NAME];
        if (!skillName) continue;
        latencyMap.set(skillName, readAvgMinMax(dp.values));
      }
    }

    if (costData?.data_points) {
      for (const dp of costData.data_points) {
        const skillName = dp.dimensions?.[SpanDimensionKey.SKILL_NAME];
        if (!skillName) continue;
        costMap.set(skillName, readAvgMinMax(dp.values));
      }
    }

    const result: SkillPerformanceData[] = [];
    for (const [skillName, totalCalls] of countMap.entries()) {
      const latency = latencyMap.get(skillName);
      const cost = costMap.get(skillName);
      result.push({
        skillName,
        totalCalls,
        avgLatency: latency?.avg ?? 0,
        minLatency: latency?.min ?? 0,
        maxLatency: latency?.max ?? 0,
        avgCost: cost?.avg ?? 0,
        minCost: cost?.min ?? 0,
        maxCost: cost?.max ?? 0,
      });
    }

    result.sort((a, b) => b.totalCalls - a.totalCalls);
    return result;
  }, [countData?.data_points, latencyData?.data_points, costData?.data_points]);

  return {
    skillsData,
    isLoading: isLoadingCounts || isLoadingLatency || isLoadingCost,
    error: countsError || latencyError || costError,
    hasData: skillsData.length > 0,
  };
}
