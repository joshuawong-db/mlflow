import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@mlflow/mlflow/src/common/utils/reactQueryHooks';
import { useSkillPerformanceSummaryData } from './useSkillPerformanceSummaryData';
import {
  AggregationType,
  SpanMetricKey,
  SpanDimensionKey,
  SpanStatus,
} from '@databricks/web-shared/model-trace-explorer';
import type { ReactNode } from 'react';
import { setupServer } from '../../../../common/utils/setup-msw';
import { rest } from 'msw';
import { OverviewChartProvider } from '../OverviewChartContext';
import { getAjaxUrl } from '@mlflow/mlflow/src/common/utils/FetchUtils';

const createCountDataPoint = (skillName: string, status: string, count: number) => ({
  metric_name: SpanMetricKey.SPAN_COUNT,
  dimensions: {
    [SpanDimensionKey.SKILL_NAME]: skillName,
    [SpanDimensionKey.SPAN_STATUS]: status,
  },
  values: { [AggregationType.COUNT]: count },
});

const createLatencyDataPoint = (skillName: string, avg: number) => ({
  metric_name: SpanMetricKey.LATENCY,
  dimensions: { [SpanDimensionKey.SKILL_NAME]: skillName },
  values: { [AggregationType.AVG]: avg },
});

describe('useSkillPerformanceSummaryData', () => {
  const testExperimentId = 'test-experiment-123';
  const startTimeMs = new Date('2025-12-22T10:00:00Z').getTime();
  const endTimeMs = new Date('2025-12-22T12:00:00Z').getTime();
  const timeIntervalSeconds = 3600;
  const timeBuckets = [startTimeMs, startTimeMs + 3600000, endTimeMs];

  const contextProps = {
    experimentIds: [testExperimentId],
    startTimeMs,
    endTimeMs,
    timeIntervalSeconds,
    timeBuckets,
  };

  const server = setupServer();

  const createWrapper =
    () =>
    ({ children }: { children: ReactNode }) => {
      const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      return (
        <QueryClientProvider client={queryClient}>
          <OverviewChartProvider {...contextProps}>{children}</OverviewChartProvider>
        </QueryClientProvider>
      );
    };

  const setupHandlers = (countDataPoints: any[], latencyDataPoints: any[]) => {
    server.use(
      rest.post(getAjaxUrl('ajax-api/3.0/mlflow/traces/metrics'), async (req, res, ctx) => {
        const body = await req.json();
        const metricName: string | undefined = body.metric_name;
        const metricNames: string[] = body.metric_names ?? [];
        if (metricName === SpanMetricKey.SPAN_COUNT || metricNames.includes(SpanMetricKey.SPAN_COUNT)) {
          return res(ctx.json({ data_points: countDataPoints }));
        }
        if (metricName === SpanMetricKey.LATENCY || metricNames.includes(SpanMetricKey.LATENCY)) {
          return res(ctx.json({ data_points: latencyDataPoints }));
        }
        return res(ctx.json({ data_points: [] }));
      }),
    );
  };

  beforeEach(() => {
    jest.clearAllMocks();
    setupHandlers([], []);
  });

  describe('loading state', () => {
    it('should be in loading state while fetching', () => {
      server.use(
        rest.post(getAjaxUrl('ajax-api/3.0/mlflow/traces/metrics'), (_req, res, ctx) => {
          return res(ctx.delay('infinite'));
        }),
      );

      const { result } = renderHook(() => useSkillPerformanceSummaryData(), { wrapper: createWrapper() });

      expect(result.current.isLoading).toBe(true);
    });
  });

  describe('empty state', () => {
    it('should return empty skillsData and hasData=false when no data points', async () => {
      const { result } = renderHook(() => useSkillPerformanceSummaryData(), { wrapper: createWrapper() });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.skillsData).toEqual([]);
      expect(result.current.hasData).toBe(false);
    });
  });

  describe('with data', () => {
    const mockCountData = [
      createCountDataPoint('review-pr', SpanStatus.OK, 38),
      createCountDataPoint('review-pr', SpanStatus.ERROR, 2),
      createCountDataPoint('analyze-trace', SpanStatus.OK, 142),
    ];

    const mockLatencyData = [createLatencyDataPoint('review-pr', 18400), createLatencyDataPoint('analyze-trace', 4200)];

    it('should return processed skill data with correct totalCalls', async () => {
      setupHandlers(mockCountData, mockLatencyData);

      const { result } = renderHook(() => useSkillPerformanceSummaryData(), { wrapper: createWrapper() });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      const reviewPr = result.current.skillsData.find((s) => s.skillName === 'review-pr');
      expect(reviewPr?.totalCalls).toBe(40); // 38 + 2
    });

    it('should return average latency per skill', async () => {
      setupHandlers(mockCountData, mockLatencyData);

      const { result } = renderHook(() => useSkillPerformanceSummaryData(), { wrapper: createWrapper() });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      const reviewPr = result.current.skillsData.find((s) => s.skillName === 'review-pr');
      expect(reviewPr?.avgLatency).toBe(18400);
    });

    it('should include skills with count data even when latency is missing', async () => {
      setupHandlers([createCountDataPoint('no-latency-skill', SpanStatus.OK, 10)], []);

      const { result } = renderHook(() => useSkillPerformanceSummaryData(), { wrapper: createWrapper() });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      const skill = result.current.skillsData.find((s) => s.skillName === 'no-latency-skill');
      expect(skill).toBeDefined();
      expect(skill?.avgLatency).toBe(0);
    });

    it('should sort skills by total calls descending', async () => {
      setupHandlers(mockCountData, mockLatencyData);

      const { result } = renderHook(() => useSkillPerformanceSummaryData(), { wrapper: createWrapper() });

      await waitFor(() => {
        expect(result.current.skillsData.length).toBeGreaterThan(0);
      });

      const calls = result.current.skillsData.map((s) => s.totalCalls);
      expect(calls[0]).toBeGreaterThanOrEqual(calls[1]);
    });

    it('should set hasData=true when skills are returned', async () => {
      setupHandlers(mockCountData, mockLatencyData);

      const { result } = renderHook(() => useSkillPerformanceSummaryData(), { wrapper: createWrapper() });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.hasData).toBe(true);
    });
  });

  describe('error state', () => {
    it('should expose error when API call fails', async () => {
      server.use(
        rest.post(getAjaxUrl('ajax-api/3.0/mlflow/traces/metrics'), (_req, res, ctx) => {
          return res(ctx.status(500), ctx.json({ error: 'Server Error' }));
        }),
      );

      const { result } = renderHook(() => useSkillPerformanceSummaryData(), { wrapper: createWrapper() });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.error).toBeTruthy();
    });
  });

  describe('disabled state', () => {
    it('should not fetch when enabled=false', () => {
      const { result } = renderHook(() => useSkillPerformanceSummaryData({ enabled: false }), {
        wrapper: createWrapper(),
      });

      expect(result.current.isLoading).toBe(false);
      expect(result.current.skillsData).toEqual([]);
    });
  });
});
