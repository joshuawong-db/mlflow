import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithIntl } from '../../../../common/utils/TestUtils.react18';
import { SkillPerformanceSummary } from './SkillPerformanceSummary';
import { DesignSystemProvider } from '@databricks/design-system';
import { QueryClient, QueryClientProvider } from '@mlflow/mlflow/src/common/utils/reactQueryHooks';
import {
  AggregationType,
  SpanMetricKey,
  SpanDimensionKey,
  SpanStatus,
} from '@databricks/web-shared/model-trace-explorer';
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

describe('SkillPerformanceSummary', () => {
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

  const createQueryClient = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });

  const renderComponent = () => {
    const queryClient = createQueryClient();
    return renderWithIntl(
      <QueryClientProvider client={queryClient}>
        <DesignSystemProvider>
          <OverviewChartProvider {...contextProps}>
            <SkillPerformanceSummary />
          </OverviewChartProvider>
        </DesignSystemProvider>
      </QueryClientProvider>,
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
    it('should not render content while loading', async () => {
      server.use(
        rest.post(getAjaxUrl('ajax-api/3.0/mlflow/traces/metrics'), (_req, res, ctx) => {
          return res(ctx.delay('infinite'));
        }),
      );

      renderComponent();

      expect(screen.queryByText('Skills Performance')).not.toBeInTheDocument();
    });
  });

  describe('error state', () => {
    it('should render error message when API call fails', async () => {
      server.use(
        rest.post(getAjaxUrl('ajax-api/3.0/mlflow/traces/metrics'), (_req, res, ctx) => {
          return res(ctx.status(500), ctx.json({ error: 'API Error' }));
        }),
      );

      renderComponent();

      await waitFor(() => {
        expect(screen.getByText('Failed to load chart data')).toBeInTheDocument();
      });
    });
  });

  describe('empty state', () => {
    it('should render empty state when no data', async () => {
      renderComponent();

      await waitFor(() => {
        expect(screen.getByText('No data available for the selected time range')).toBeInTheDocument();
      });
    });
  });

  describe('with data', () => {
    const mockCountData = [
      createCountDataPoint('review-pr', SpanStatus.OK, 38),
      createCountDataPoint('review-pr', SpanStatus.ERROR, 2),
      createCountDataPoint('analyze-trace', SpanStatus.OK, 142),
      createCountDataPoint('query-metrics', SpanStatus.OK, 67),
    ];

    const mockLatencyData = [
      createLatencyDataPoint('review-pr', 18400),
      createLatencyDataPoint('analyze-trace', 4200),
      createLatencyDataPoint('query-metrics', 2800),
    ];

    it('should display the section title', async () => {
      setupHandlers(mockCountData, mockLatencyData);

      renderComponent();

      await waitFor(() => {
        expect(screen.getByText('Skills Performance')).toBeInTheDocument();
      });
    });

    it('should display table column headers in table view', async () => {
      setupHandlers(mockCountData, mockLatencyData);

      renderComponent();

      await waitFor(() => {
        expect(screen.getByText('Skill')).toBeInTheDocument();
        expect(screen.getByText('Calls')).toBeInTheDocument();
        expect(screen.getByText('Latency (AVG)')).toBeInTheDocument();
      });
    });

    it('should display skill names', async () => {
      setupHandlers(mockCountData, mockLatencyData);

      renderComponent();

      await waitFor(() => {
        expect(screen.getByText('review-pr')).toBeInTheDocument();
        expect(screen.getByText('analyze-trace')).toBeInTheDocument();
        expect(screen.getByText('query-metrics')).toBeInTheDocument();
      });
    });

    it('should display formatted call counts', async () => {
      setupHandlers(mockCountData, mockLatencyData);

      renderComponent();

      await waitFor(() => {
        // analyze-trace: 142 calls
        expect(screen.getByText('142')).toBeInTheDocument();
      });
    });

    it('should display formatted average latency', async () => {
      setupHandlers(mockCountData, mockLatencyData);

      renderComponent();

      await waitFor(() => {
        // review-pr: 18.40s
        expect(screen.getByText('18.40s')).toBeInTheDocument();
      });
    });

    it('should sort skills by total calls descending by default', async () => {
      setupHandlers(mockCountData, mockLatencyData);

      renderComponent();

      await waitFor(() => {
        expect(screen.getByText('analyze-trace')).toBeInTheDocument();
      });

      const skillNames = screen.getAllByText(/review-pr|analyze-trace|query-metrics/);
      expect(skillNames[0].textContent).toBe('analyze-trace'); // 142 calls
      expect(skillNames[1].textContent).toBe('query-metrics'); // 67 calls
      expect(skillNames[2].textContent).toBe('review-pr'); // 40 calls
    });

    it('should show Table/Chart toggle controls', async () => {
      setupHandlers(mockCountData, mockLatencyData);

      renderComponent();

      await waitFor(() => {
        expect(screen.getByText('Skills Performance')).toBeInTheDocument();
      });

      expect(screen.getByText('Table')).toBeInTheDocument();
      expect(screen.getByText('Chart')).toBeInTheDocument();
    });

    it('should hide table headers when switching to chart view', async () => {
      setupHandlers(mockCountData, mockLatencyData);

      renderComponent();

      await waitFor(() => {
        expect(screen.getByText('Skill')).toBeInTheDocument();
      });

      const chartButton = screen.getByRole('radio', { name: /Chart/i });
      await userEvent.click(chartButton);

      expect(screen.queryByText('Calls')).not.toBeInTheDocument();
    });

    it('should restore table headers when switching back to table view', async () => {
      setupHandlers(mockCountData, mockLatencyData);

      renderComponent();

      await waitFor(() => {
        expect(screen.getByText('Skill')).toBeInTheDocument();
      });

      const chartButton = screen.getByRole('radio', { name: /Chart/i });
      await userEvent.click(chartButton);

      const tableButton = screen.getByRole('radio', { name: /Table/i });
      await userEvent.click(tableButton);

      await waitFor(() => {
        expect(screen.getByText('Calls')).toBeInTheDocument();
      });
    });
  });

  describe('sorting functionality', () => {
    const mockCountData = [
      createCountDataPoint('alpha-skill', SpanStatus.OK, 500),
      createCountDataPoint('beta-skill', SpanStatus.OK, 900),
      createCountDataPoint('gamma-skill', SpanStatus.OK, 200),
    ];

    const mockLatencyData = [
      createLatencyDataPoint('alpha-skill', 300),
      createLatencyDataPoint('beta-skill', 100),
      createLatencyDataPoint('gamma-skill', 500),
    ];

    it('should sort by calls descending by default', async () => {
      setupHandlers(mockCountData, mockLatencyData);

      renderComponent();

      await waitFor(() => {
        expect(screen.getByText('beta-skill')).toBeInTheDocument();
      });

      const skillNames = screen.getAllByText(/alpha-skill|beta-skill|gamma-skill/);
      expect(skillNames[0].textContent).toBe('beta-skill'); // 900 calls
      expect(skillNames[1].textContent).toBe('alpha-skill'); // 500 calls
      expect(skillNames[2].textContent).toBe('gamma-skill'); // 200 calls
    });

    it('should sort by skill name when clicking Skill header', async () => {
      setupHandlers(mockCountData, mockLatencyData);

      renderComponent();

      await waitFor(() => {
        expect(screen.getByText('beta-skill')).toBeInTheDocument();
      });

      const skillHeader = screen.getByRole('button', { name: /^Skill$/i });
      await userEvent.click(skillHeader);

      const skillNames = screen.getAllByText(/alpha-skill|beta-skill|gamma-skill/);
      expect(skillNames[0].textContent).toBe('gamma-skill');
      expect(skillNames[1].textContent).toBe('beta-skill');
      expect(skillNames[2].textContent).toBe('alpha-skill');
    });

    it('should sort by avg latency when clicking Latency header', async () => {
      setupHandlers(mockCountData, mockLatencyData);

      renderComponent();

      await waitFor(() => {
        expect(screen.getByText('beta-skill')).toBeInTheDocument();
      });

      const latencyHeader = screen.getByRole('button', { name: /Latency \(AVG\)/i });
      await userEvent.click(latencyHeader);

      const skillNames = screen.getAllByText(/alpha-skill|beta-skill|gamma-skill/);
      expect(skillNames[0].textContent).toBe('gamma-skill'); // 500ms
      expect(skillNames[1].textContent).toBe('alpha-skill'); // 300ms
      expect(skillNames[2].textContent).toBe('beta-skill'); // 100ms
    });
  });
});
