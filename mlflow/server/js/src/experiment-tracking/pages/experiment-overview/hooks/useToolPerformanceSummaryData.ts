import { useMemo } from 'react';
import {
  MetricViewType,
  AggregationType,
  SpanMetricKey,
  SpanFilterKey,
  SpanType,
  SpanStatus,
  SpanDimensionKey,
  createSpanFilter,
} from '@databricks/web-shared/model-trace-explorer';
import { useTraceMetricsQuery } from './useTraceMetricsQuery';
import { useOverviewChartContext } from '../OverviewChartContext';

// PERCENTILE response keys are formatted as `P{value}.0` by the backend
// (e.g., {"aggregation_type": "PERCENTILE", "percentile_value": 0} → "P0.0").
// MIN/MAX are unsupported at the span level for LATENCY, so we approximate
// them via 0th and 100th percentiles.
const PERCENTILE_MIN_KEY = 'P0.0';
const PERCENTILE_MAX_KEY = 'P100.0';

const LATENCY_AGGS = [
  { aggregation_type: AggregationType.AVG },
  { aggregation_type: AggregationType.PERCENTILE, percentile_value: 0 },
  { aggregation_type: AggregationType.PERCENTILE, percentile_value: 100 },
];

export interface ToolPerformanceData {
  /** Tool name (span_name) */
  toolName: string;
  /** Total number of calls to this tool */
  totalCalls: number;
  /** Success rate as a percentage (0-100) */
  successRate: number;
  /** Average latency in milliseconds */
  avgLatency: number;
  /** Minimum latency observed (P0.0 — used as min proxy) */
  minLatency: number;
  /** Maximum latency observed (P100.0 — used as max proxy) */
  maxLatency: number;
}

export interface UseToolPerformanceSummaryDataResult {
  /** Performance data for each tool */
  toolsData: ToolPerformanceData[];
  /** Whether data is currently being fetched */
  isLoading: boolean;
  /** Error if data fetching failed */
  error: unknown;
  /** Whether there is any data */
  hasData: boolean;
}

/**
 * Custom hook that fetches and processes tool performance summary data.
 * Queries span metrics grouped by tool name to get counts, success rates, and latencies.
 * Uses OverviewChartContext to get chart props.
 *
 * @returns Tool performance data, loading state, and error state
 */
export function useToolPerformanceSummaryData({
  enabled = true,
}: { enabled?: boolean } = {}): UseToolPerformanceSummaryDataResult {
  const { experimentIds, startTimeMs, endTimeMs } = useOverviewChartContext();
  // Filter for TOOL type spans
  const toolFilter = useMemo(() => [createSpanFilter(SpanFilterKey.TYPE, SpanType.TOOL)], []);

  // Query tool call counts grouped by span_name and status
  const {
    data: countByToolAndStatusData,
    isLoading: isLoadingCounts,
    error: countsError,
  } = useTraceMetricsQuery({
    experimentIds,
    startTimeMs,
    endTimeMs,
    viewType: MetricViewType.SPANS,
    metricName: SpanMetricKey.SPAN_COUNT,
    aggregations: [{ aggregation_type: AggregationType.COUNT }],
    filters: toolFilter,
    dimensions: [SpanDimensionKey.SPAN_NAME, SpanDimensionKey.SPAN_STATUS],
    enabled,
  });

  // Query average latency grouped by span_name
  const {
    data: latencyByToolData,
    isLoading: isLoadingLatency,
    error: latencyError,
  } = useTraceMetricsQuery({
    experimentIds,
    startTimeMs,
    endTimeMs,
    viewType: MetricViewType.SPANS,
    metricName: SpanMetricKey.LATENCY,
    aggregations: LATENCY_AGGS,
    filters: toolFilter,
    dimensions: [SpanDimensionKey.SPAN_NAME],
    enabled,
  });

  // Process data into per-tool performance metrics
  const toolsData = useMemo(() => {
    const toolCountsMap = new Map<string, { total: number; success: number }>();
    const toolLatencyMap = new Map<string, { avg: number; min: number; max: number }>();

    // Process count data grouped by tool and status
    if (countByToolAndStatusData?.data_points) {
      for (const dp of countByToolAndStatusData.data_points) {
        const toolName = dp.dimensions?.[SpanDimensionKey.SPAN_NAME];
        const status = dp.dimensions?.[SpanDimensionKey.SPAN_STATUS];
        const count = dp.values?.[AggregationType.COUNT] || 0;

        if (!toolName) continue;

        const existing = toolCountsMap.get(toolName) || { total: 0, success: 0 };
        existing.total += count;
        if (status === SpanStatus.OK) {
          existing.success += count;
        }
        toolCountsMap.set(toolName, existing);
      }
    }

    // Process latency data grouped by tool (avg + P0/P100 as min/max proxies)
    if (latencyByToolData?.data_points) {
      for (const dp of latencyByToolData.data_points) {
        const toolName = dp.dimensions?.[SpanDimensionKey.SPAN_NAME];
        if (!toolName) continue;
        toolLatencyMap.set(toolName, {
          avg: dp.values?.[AggregationType.AVG] ?? 0,
          min: dp.values?.[PERCENTILE_MIN_KEY] ?? 0,
          max: dp.values?.[PERCENTILE_MAX_KEY] ?? 0,
        });
      }
    }

    // Combine into final data structure, sorted by total calls descending
    const result: ToolPerformanceData[] = [];
    for (const [toolName, counts] of toolCountsMap.entries()) {
      const successRate = counts.total > 0 ? (counts.success / counts.total) * 100 : 0;
      const latency = toolLatencyMap.get(toolName);
      result.push({
        toolName,
        totalCalls: counts.total,
        successRate,
        avgLatency: latency?.avg ?? 0,
        minLatency: latency?.min ?? 0,
        maxLatency: latency?.max ?? 0,
      });
    }

    // Sort by total calls descending
    result.sort((a, b) => b.totalCalls - a.totalCalls);

    return result;
  }, [countByToolAndStatusData?.data_points, latencyByToolData?.data_points]);

  const isLoading = isLoadingCounts || isLoadingLatency;
  const error = countsError || latencyError;

  return {
    toolsData,
    isLoading,
    error,
    hasData: toolsData.length > 0,
  };
}
