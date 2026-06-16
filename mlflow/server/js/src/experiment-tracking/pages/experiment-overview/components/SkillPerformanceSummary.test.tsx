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
    const mockCountData = [
      createCountDataPoint('alpha-skill', SpanStatus.OK, 500),
      createCountDataPoint('beta-skill', SpanStatus.OK, 900),
      createCountDataPoint('gamma-skill', SpanStatus.OK, 200),
    ];

    const mockCostData = [
      createCostDataPoint('alpha-skill', 0.02, 0.005, 0.05),
      createCostDataPoint('beta-skill', 0.01, 0.002, 0.03),
      createCostDataPoint('gamma-skill', 0.05, 0.01, 0.12),
    ];

    it('should render the section title', async () => {
      setupHandlers(mockCountData, mockCostData);

      renderComponent();

      await waitFor(() => {
        expect(screen.getByText('Skills Performance')).toBeInTheDocument();
      });
    });

    it('should render the four sortable column headers', async () => {
      setupHandlers(mockCountData, mockCostData);

      renderComponent();

      await waitFor(() => {
        // Skill header includes "(visible of total)" — match the prefix only.
        expect(screen.getByText(/^Skill \(\d+ of \d+\)$/)).toBeInTheDocument();
      });
      expect(screen.getByText('Calls')).toBeInTheDocument();
      expect(screen.getByText('Avg cost')).toBeInTheDocument();
      expect(screen.getByText('Total spend')).toBeInTheDocument();
    });

    it('should render every skill name', async () => {
      setupHandlers(mockCountData, mockCostData);

      renderComponent();

      await waitFor(() => {
        expect(screen.getByText('alpha-skill')).toBeInTheDocument();
      });
      expect(screen.getByText('beta-skill')).toBeInTheDocument();
      expect(screen.getByText('gamma-skill')).toBeInTheDocument();
    });

    it('should render formatted cost values for each row', async () => {
      setupHandlers(mockCountData, mockCostData);

      renderComponent();

      await waitFor(() => {
        expect(screen.getByText('alpha-skill')).toBeInTheDocument();
      });
      // gamma avg cost = $0.05; cost formatter renders "$0.05"
      expect(screen.getAllByText('$0.05').length).toBeGreaterThanOrEqual(1);
    });

    it('should expose every header as a sortable columnheader', async () => {
      setupHandlers(mockCountData, mockCostData);

      renderComponent();

      await waitFor(() => {
        expect(screen.getByText('Skills Performance')).toBeInTheDocument();
      });
      expect(screen.getByRole('columnheader', { name: /^Skill/ })).toBeInTheDocument();
      expect(screen.getByRole('columnheader', { name: 'Calls' })).toBeInTheDocument();
      expect(screen.getByRole('columnheader', { name: 'Avg cost' })).toBeInTheDocument();
      expect(screen.getByRole('columnheader', { name: 'Total spend' })).toBeInTheDocument();
    });
  });

  describe('sorting', () => {
    // alpha: 500 calls, $0.02 avg → spend=$10
    // beta:  900 calls, $0.01 avg → spend=$9
    // gamma: 200 calls, $0.05 avg → spend=$10
    const mockCountData = [
      createCountDataPoint('alpha-skill', SpanStatus.OK, 500),
      createCountDataPoint('beta-skill', SpanStatus.OK, 900),
      createCountDataPoint('gamma-skill', SpanStatus.OK, 200),
    ];
    const mockCostData = [
      createCostDataPoint('alpha-skill', 0.02),
      createCostDataPoint('beta-skill', 0.01),
      createCostDataPoint('gamma-skill', 0.05),
    ];

    const getOrderedSkillNames = () =>
      screen.getAllByText(/^(alpha|beta|gamma)-skill$/).map((el) => el.textContent ?? '');

    it('should default-sort by Total spend descending', async () => {
      setupHandlers(mockCountData, mockCostData);

      renderComponent();

      await waitFor(() => {
        expect(screen.getByText('alpha-skill')).toBeInTheDocument();
      });
      // alpha = 500*$0.02 = $10; beta = 900*$0.01 = $9; gamma = 200*$0.05 = $10 (tied)
      // alpha and gamma lead (tied at $10); beta is last.
      const ordered = getOrderedSkillNames();
      const top2 = new Set([ordered[0], ordered[1]]);
      expect(top2.has('alpha-skill')).toBe(true);
      expect(top2.has('gamma-skill')).toBe(true);
      expect(ordered[2]).toBe('beta-skill');
    });

    it('should sort by Calls descending when the Calls header is clicked', async () => {
      setupHandlers(mockCountData, mockCostData);

      renderComponent();

      await waitFor(() => {
        expect(screen.getByText('alpha-skill')).toBeInTheDocument();
      });

      await userEvent.click(screen.getByRole('columnheader', { name: 'Calls' }));

      const ordered = getOrderedSkillNames();
      expect(ordered[0]).toBe('beta-skill'); // 900
      expect(ordered[1]).toBe('alpha-skill'); // 500
      expect(ordered[2]).toBe('gamma-skill'); // 200
    });

    it('should sort by Avg cost descending when the Avg cost header is clicked', async () => {
      setupHandlers(mockCountData, mockCostData);

      renderComponent();

      await waitFor(() => {
        expect(screen.getByText('alpha-skill')).toBeInTheDocument();
      });

      await userEvent.click(screen.getByRole('columnheader', { name: 'Avg cost' }));

      const ordered = getOrderedSkillNames();
      expect(ordered[0]).toBe('gamma-skill'); // $0.05
      expect(ordered[1]).toBe('alpha-skill'); // $0.02
      expect(ordered[2]).toBe('beta-skill'); // $0.01
    });

    it('should flip sort direction when the active column header is clicked again', async () => {
      setupHandlers(mockCountData, mockCostData);

      renderComponent();

      await waitFor(() => {
        expect(screen.getByText('alpha-skill')).toBeInTheDocument();
      });

      // Default is Total spend desc; clicking it once flips to asc (beta first at $9).
      await userEvent.click(screen.getByRole('columnheader', { name: 'Total spend' }));

      const ordered = getOrderedSkillNames();
      expect(ordered[0]).toBe('beta-skill'); // $9 (lowest)
      const rest = new Set([ordered[1], ordered[2]]);
      expect(rest.has('alpha-skill')).toBe(true);
      expect(rest.has('gamma-skill')).toBe(true);
    });
  });
});
