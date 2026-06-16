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

const createCostDataPoint = (skillName: string, avg: number, min = 0, max = 0) => ({
  metric_name: SpanMetricKey.TOTAL_COST,
  dimensions: { [SpanDimensionKey.SKILL_NAME]: skillName },
  values: { [AggregationType.AVG]: avg, 'P0.0': min, 'P100.0': max },
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

  const setupHandlers = (countDataPoints: any[], costDataPoints: any[] = []) => {
    server.use(
      rest.post(getAjaxUrl('ajax-api/3.0/mlflow/traces/metrics'), async (req, res, ctx) => {
        const body = await req.json();
        const metricName: string | undefined = body.metric_name;
        const metricNames: string[] = body.metric_names ?? [];
        if (metricName === SpanMetricKey.SPAN_COUNT || metricNames.includes(SpanMetricKey.SPAN_COUNT)) {
          return res(ctx.json({ data_points: countDataPoints }));
        }
        if (metricName === SpanMetricKey.TOTAL_COST || metricNames.includes(SpanMetricKey.TOTAL_COST)) {
          return res(ctx.json({ data_points: costDataPoints }));
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

    const mockCostData = [
      createCostDataPoint('review-pr', 0.12, 0.05, 0.4),
      createCostDataPoint('analyze-trace', 0.02, 0.005, 0.08),
    ];

    it('should return processed skill data with correct totalCalls', async () => {
      setupHandlers(mockCountData, mockCostData);

      const { result } = renderHook(() => useSkillPerformanceSummaryData(), { wrapper: createWrapper() });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      const reviewPr = result.current.skillsData.find((s) => s.skillName === 'review-pr');
      expect(reviewPr?.totalCalls).toBe(40); // 38 + 2
    });

    it('should return avg, min, and max cost per skill', async () => {
      setupHandlers(mockCountData, mockCostData);

      const { result } = renderHook(() => useSkillPerformanceSummaryData(), { wrapper: createWrapper() });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      const reviewPr = result.current.skillsData.find((s) => s.skillName === 'review-pr');
      expect(reviewPr?.avgCost).toBeCloseTo(0.12);
      expect(reviewPr?.minCost).toBeCloseTo(0.05);
      expect(reviewPr?.maxCost).toBeCloseTo(0.4);
    });

    it('should include skills with count data even when cost is missing', async () => {
      setupHandlers([createCountDataPoint('no-data-skill', SpanStatus.OK, 10)], []);

      const { result } = renderHook(() => useSkillPerformanceSummaryData(), { wrapper: createWrapper() });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      const skill = result.current.skillsData.find((s) => s.skillName === 'no-data-skill');
      expect(skill).toBeDefined();
      expect(skill?.avgCost).toBe(0);
      expect(skill?.minCost).toBe(0);
      expect(skill?.maxCost).toBe(0);
    });

    it('should sort skills by total calls descending', async () => {
      setupHandlers(mockCountData, mockCostData);

      const { result } = renderHook(() => useSkillPerformanceSummaryData(), { wrapper: createWrapper() });

      await waitFor(() => {
        expect(result.current.skillsData.length).toBeGreaterThan(0);
      });

      const calls = result.current.skillsData.map((s) => s.totalCalls);
      expect(calls[0]).toBeGreaterThanOrEqual(calls[1]);
    });

    it('should set hasData=true when skills are returned', async () => {
      setupHandlers(mockCountData, mockCostData);

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
