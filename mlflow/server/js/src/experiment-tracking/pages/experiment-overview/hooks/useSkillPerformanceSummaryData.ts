import { useMemo } from 'react';
import {
  MetricViewType,
  AggregationType,
  SpanMetricKey,
  SpanStatus,
  SpanDimensionKey,
} from '@databricks/web-shared/model-trace-explorer';
import { useTraceMetricsQuery } from './useTraceMetricsQuery';
import { useOverviewChartContext } from '../OverviewChartContext';

export interface SkillPerformanceData {
  skillName: string;
  totalCalls: number;
  avgLatency: number;
}

export interface UseSkillPerformanceSummaryDataResult {
  skillsData: SkillPerformanceData[];
  isLoading: boolean;
  error: unknown;
  hasData: boolean;
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
    aggregations: [{ aggregation_type: AggregationType.AVG }],
    dimensions: [SpanDimensionKey.SKILL_NAME],
    enabled,
  });

  const skillsData = useMemo(() => {
    const countMap = new Map<string, number>();
    const latencyMap = new Map<string, number>();

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
        const avg = dp.values?.[AggregationType.AVG];
        if (avg !== undefined) latencyMap.set(skillName, avg);
      }
    }

    const result: SkillPerformanceData[] = [];
    for (const [skillName, totalCalls] of countMap.entries()) {
      result.push({
        skillName,
        totalCalls,
        avgLatency: latencyMap.get(skillName) ?? 0,
      });
    }

    result.sort((a, b) => b.totalCalls - a.totalCalls);
    return result;
  }, [countData?.data_points, latencyData?.data_points]);

  return {
    skillsData,
    isLoading: isLoadingCounts || isLoadingLatency,
    error: countsError || latencyError,
    hasData: skillsData.length > 0,
  };
}
