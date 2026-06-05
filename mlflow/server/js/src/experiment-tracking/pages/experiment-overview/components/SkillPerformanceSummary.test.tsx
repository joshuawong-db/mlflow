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

const createLatencyDataPoint = (skillName: string, avg: number, min = 0, max = 0) => ({
  metric_name: SpanMetricKey.LATENCY,
  dimensions: { [SpanDimensionKey.SKILL_NAME]: skillName },
  values: { [AggregationType.AVG]: avg, 'P0.0': min, 'P100.0': max },
});

const createCostDataPoint = (skillName: string, avg: number, min = 0, max = 0) => ({
  metric_name: SpanMetricKey.TOTAL_COST,
  dimensions: { [SpanDimensionKey.SKILL_NAME]: skillName },
  values: { [AggregationType.AVG]: avg, 'P0.0': min, 'P100.0': max },
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

  const setupHandlers = (countDataPoints: any[], latencyDataPoints: any[], costDataPoints: any[] = []) => {
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
        if (metricName === SpanMetricKey.TOTAL_COST || metricNames.includes(SpanMetricKey.TOTAL_COST)) {
          return res(ctx.json({ data_points: costDataPoints }));
        }
        return res(ctx.json({ data_points: [] }));
      }),
    );
  };

  beforeEach(() => {
    jest.clearAllMocks();
    setupHandlers([], [], []);
  });

  describe('loading state', () => {
    it('should not render the card while loading', async () => {
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
    it('should render the error message when API call fails', async () => {
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
    it('should render nothing when no skill spans exist', async () => {
      const { container } = renderComponent();

      await waitFor(() => {
        expect(screen.queryByText('Skills Performance')).not.toBeInTheDocument();
      });

      expect(container.textContent).toBe('');
    });
  });

  describe('with data', () => {
    // alpha:  500 calls × 300ms avg ×  $0.02 avg → impact term spend=10, time=150000
    // beta:   900 calls × 100ms avg ×  $0.01 avg → impact term spend=9,  time=90000
    // gamma:  200 calls × 500ms avg ×  $0.05 avg → impact term spend=10, time=100000
    // After normalisation: alpha and gamma tie on spend, alpha leads on time → alpha first.
    const mockCountData = [
      createCountDataPoint('alpha-skill', SpanStatus.OK, 500),
      createCountDataPoint('beta-skill', SpanStatus.OK, 900),
      createCountDataPoint('gamma-skill', SpanStatus.OK, 200),
    ];

    const mockLatencyData = [
      createLatencyDataPoint('alpha-skill', 300, 100, 800),
      createLatencyDataPoint('beta-skill', 100, 50, 250),
      createLatencyDataPoint('gamma-skill', 500, 200, 1200),
    ];

    const mockCostData = [
      createCostDataPoint('alpha-skill', 0.02, 0.005, 0.05),
      createCostDataPoint('beta-skill', 0.01, 0.002, 0.03),
      createCostDataPoint('gamma-skill', 0.05, 0.01, 0.12),
    ];

    it('should render the section title', async () => {
      setupHandlers(mockCountData, mockLatencyData, mockCostData);

      renderComponent();

      await waitFor(() => {
        expect(screen.getByText('Skills Performance')).toBeInTheDocument();
      });
    });

    it('should render the four column headers (Skill, Calls, Latency, Cost)', async () => {
      setupHandlers(mockCountData, mockLatencyData, mockCostData);

      renderComponent();

      await waitFor(() => {
        // Skill header includes "(visible of total)" — match the prefix only.
        expect(screen.getByText(/^Skill \(\d+ of \d+\)$/)).toBeInTheDocument();
      });
      // "Calls" appears twice (sort button + column header); ensure at least one column header instance exists.
      expect(screen.getAllByText('Calls').length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText('Latency')).toBeInTheDocument();
      expect(screen.getByText('Cost')).toBeInTheDocument();
    });

    it('should render every skill name', async () => {
      setupHandlers(mockCountData, mockLatencyData, mockCostData);

      renderComponent();

      await waitFor(() => {
        expect(screen.getByText('alpha-skill')).toBeInTheDocument();
      });
      expect(screen.getByText('beta-skill')).toBeInTheDocument();
      expect(screen.getByText('gamma-skill')).toBeInTheDocument();
    });

    it('should render formatted latency values (min/avg/max) for each row', async () => {
      setupHandlers(mockCountData, mockLatencyData, mockCostData);

      renderComponent();

      await waitFor(() => {
        expect(screen.getByText('alpha-skill')).toBeInTheDocument();
      });
      // gamma row: min 200ms, avg 500ms, max 1.20s
      expect(screen.getByText('200.00ms')).toBeInTheDocument();
      expect(screen.getByText('500.00ms')).toBeInTheDocument();
      expect(screen.getByText('1.20s')).toBeInTheDocument();
    });

    it('should render formatted cost values for each row', async () => {
      setupHandlers(mockCountData, mockLatencyData, mockCostData);

      renderComponent();

      await waitFor(() => {
        expect(screen.getByText('alpha-skill')).toBeInTheDocument();
      });
      // gamma avg cost = $0.05; cost formatter renders "$0.05"
      expect(screen.getAllByText('$0.05').length).toBeGreaterThanOrEqual(1);
    });

    it('should render all five sort options', async () => {
      setupHandlers(mockCountData, mockLatencyData, mockCostData);

      renderComponent();

      await waitFor(() => {
        expect(screen.getByText('Skills Performance')).toBeInTheDocument();
      });
      expect(screen.getByRole('radio', { name: /Impact/i })).toBeInTheDocument();
      expect(screen.getByRole('radio', { name: /^Calls$/i })).toBeInTheDocument();
      expect(screen.getByRole('radio', { name: /Avg latency/i })).toBeInTheDocument();
      expect(screen.getByRole('radio', { name: /Avg cost/i })).toBeInTheDocument();
      expect(screen.getByRole('radio', { name: /Total spend/i })).toBeInTheDocument();
    });

    it('should render the impact caption', async () => {
      setupHandlers(mockCountData, mockLatencyData, mockCostData);

      renderComponent();

      await waitFor(() => {
        expect(
          screen.getByText(/Default sort is Impact = normalized total spend \+ normalized total time/),
        ).toBeInTheDocument();
      });
    });
  });

  describe('sorting', () => {
    // alpha: 500 calls, 300ms avg, $0.02 avg → spend=10,  cum_time=150000
    // beta:  900 calls, 100ms avg, $0.01 avg → spend=9,   cum_time=90000
    // gamma: 200 calls, 500ms avg, $0.05 avg → spend=10,  cum_time=100000
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
    const mockCostData = [
      createCostDataPoint('alpha-skill', 0.02),
      createCostDataPoint('beta-skill', 0.01),
      createCostDataPoint('gamma-skill', 0.05),
    ];

    const getOrderedSkillNames = () =>
      screen.getAllByText(/^(alpha|beta|gamma)-skill$/).map((el) => el.textContent ?? '');

    it('should default-sort by Impact (alpha first by combined spend + cumulative time)', async () => {
      setupHandlers(mockCountData, mockLatencyData, mockCostData);

      renderComponent();

      await waitFor(() => {
        expect(screen.getByText('alpha-skill')).toBeInTheDocument();
      });
      // alpha leads (spend tied with gamma, but cum_time 150000 > gamma 100000)
      expect(getOrderedSkillNames()[0]).toBe('alpha-skill');
    });

    it('should sort by Calls descending when Calls is selected', async () => {
      setupHandlers(mockCountData, mockLatencyData, mockCostData);

      renderComponent();

      await waitFor(() => {
        expect(screen.getByText('alpha-skill')).toBeInTheDocument();
      });

      await userEvent.click(screen.getByRole('radio', { name: /^Calls$/i }));

      const ordered = getOrderedSkillNames();
      expect(ordered[0]).toBe('beta-skill'); // 900
      expect(ordered[1]).toBe('alpha-skill'); // 500
      expect(ordered[2]).toBe('gamma-skill'); // 200
    });

    it('should sort by Avg latency descending when Avg latency is selected', async () => {
      setupHandlers(mockCountData, mockLatencyData, mockCostData);

      renderComponent();

      await waitFor(() => {
        expect(screen.getByText('alpha-skill')).toBeInTheDocument();
      });

      await userEvent.click(screen.getByRole('radio', { name: /Avg latency/i }));

      const ordered = getOrderedSkillNames();
      expect(ordered[0]).toBe('gamma-skill'); // 500ms
      expect(ordered[1]).toBe('alpha-skill'); // 300ms
      expect(ordered[2]).toBe('beta-skill'); // 100ms
    });

    it('should sort by Avg cost descending when Avg cost is selected', async () => {
      setupHandlers(mockCountData, mockLatencyData, mockCostData);

      renderComponent();

      await waitFor(() => {
        expect(screen.getByText('alpha-skill')).toBeInTheDocument();
      });

      await userEvent.click(screen.getByRole('radio', { name: /Avg cost/i }));

      const ordered = getOrderedSkillNames();
      expect(ordered[0]).toBe('gamma-skill'); // $0.05
      expect(ordered[1]).toBe('alpha-skill'); // $0.02
      expect(ordered[2]).toBe('beta-skill'); // $0.01
    });

    it('should sort by Total spend descending when Total spend is selected', async () => {
      setupHandlers(mockCountData, mockLatencyData, mockCostData);

      renderComponent();

      await waitFor(() => {
        expect(screen.getByText('alpha-skill')).toBeInTheDocument();
      });

      await userEvent.click(screen.getByRole('radio', { name: /Total spend/i }));

      const ordered = getOrderedSkillNames();
      // alpha = 500*$0.02 = $10; beta = 900*$0.01 = $9; gamma = 200*$0.05 = $10 (tied)
      // sort is stable enough that the first $10 entry wins; both alpha and gamma should be in top 2
      const top2 = new Set([ordered[0], ordered[1]]);
      expect(top2.has('alpha-skill')).toBe(true);
      expect(top2.has('gamma-skill')).toBe(true);
      expect(ordered[2]).toBe('beta-skill');
    });
  });
});
