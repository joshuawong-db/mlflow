import React, { useMemo } from 'react';
import { WrenchIcon, Typography } from '@databricks/design-system';
import { FormattedMessage, useIntl } from 'react-intl';
import { useToolPerformanceSummaryData } from '../hooks/useToolPerformanceSummaryData';
import {
  OverviewChartLoadingState,
  OverviewChartErrorState,
  OverviewChartEmptyState,
  OverviewChartHeader,
  OverviewChartContainer,
} from './OverviewChartComponents';
import { formatCount, formatLatency, useChartColors } from '../utils/chartUtils';
import {
  LinkableNameCell,
  RangeBarMetricCell,
  SortableHeader,
  percentile,
  useSortState,
  useSummaryTableStyles,
} from './SummaryTableComponents';

type SortColumn = 'toolName' | 'totalCalls' | 'successRate' | 'avgLatency';

/**
 * Tool Performance Summary component displaying per-tool metrics in a table-like view.
 * Shows tool name, call count, success rate, and average latency for each tool.
 */
export const ToolPerformanceSummary: React.FC = () => {
  const intl = useIntl();
  const { getChartColor } = useChartColors();
  const { sortColumn, sortDirection, handleSort } = useSortState<SortColumn>('totalCalls');
  const { headerRowStyle, bodyRowStyle, cellStyle } = useSummaryTableStyles('minmax(80px, 2fr) 1fr 1fr 1fr');

  // Fetch tool performance data
  const { toolsData, isLoading, error, hasData } = useToolPerformanceSummaryData();

  // Normalizer for the latency range bar — bars in every row share this
  // denominator so they're visually comparable.
  const globalMaxLatency = useMemo(() => Math.max(...toolsData.map((t) => t.maxLatency), 1), [toolsData]);

  // Top-quartile threshold drives the InfoIcon "notable" marker on rows whose
  // avg latency is in the top quartile across the dataset.
  const p75Latency = useMemo(
    () =>
      percentile(
        toolsData.map((t) => t.avgLatency),
        0.75,
      ),
    [toolsData],
  );

  // Sort the data
  const sortedToolsData = useMemo(() => {
    if (!toolsData.length) return toolsData;

    return [...toolsData].sort((a, b) => {
      let comparison = 0;
      switch (sortColumn) {
        case 'toolName':
          comparison = a.toolName.localeCompare(b.toolName);
          break;
        case 'totalCalls':
          comparison = a.totalCalls - b.totalCalls;
          break;
        case 'successRate':
          comparison = a.successRate - b.successRate;
          break;
        case 'avgLatency':
          comparison = a.avgLatency - b.avgLatency;
          break;
      }
      return sortDirection === 'asc' ? comparison : -comparison;
    });
  }, [toolsData, sortColumn, sortDirection]);

  if (isLoading) {
    return <OverviewChartLoadingState />;
  }

  if (error) {
    return <OverviewChartErrorState />;
  }

  return (
    <OverviewChartContainer componentId="mlflow.charts.tool_performance_summary">
      <OverviewChartHeader
        icon={<WrenchIcon />}
        title={
          <FormattedMessage
            defaultMessage="Tool Performance Summary"
            description="Title for the tool performance summary section"
          />
        }
      />

      {hasData ? (
        <div css={{ display: 'flex', flexDirection: 'column' }}>
          {/* Table header */}
          <div css={headerRowStyle}>
            <SortableHeader column="toolName" sortColumn={sortColumn} sortDirection={sortDirection} onSort={handleSort}>
              <FormattedMessage defaultMessage="Tool" description="Column header for tool name" />
            </SortableHeader>
            <SortableHeader
              column="totalCalls"
              sortColumn={sortColumn}
              sortDirection={sortDirection}
              onSort={handleSort}
              centered
            >
              <FormattedMessage defaultMessage="Calls" description="Column header for call count" />
            </SortableHeader>
            <SortableHeader
              column="successRate"
              sortColumn={sortColumn}
              sortDirection={sortDirection}
              onSort={handleSort}
              centered
            >
              <FormattedMessage defaultMessage="Success" description="Column header for success rate" />
            </SortableHeader>
            <SortableHeader
              column="avgLatency"
              sortColumn={sortColumn}
              sortDirection={sortDirection}
              onSort={handleSort}
              centered
            >
              <FormattedMessage defaultMessage="Latency (AVG)" description="Column header for average latency" />
            </SortableHeader>
          </div>

          {/* Scrollable table body */}
          <div css={{ maxHeight: 200, overflowY: 'auto' }}>
            {sortedToolsData.map((tool, index) => {
              const originalIndex = toolsData.findIndex((t) => t.toolName === tool.toolName);
              const colorIndex = originalIndex === -1 ? index : originalIndex;
              return (
                <div key={tool.toolName} css={bodyRowStyle}>
                  <LinkableNameCell
                    name={tool.toolName}
                    color={getChartColor(colorIndex)}
                    scrollToElementId={`tool-chart-${tool.toolName}`}
                  />
                  <Typography.Text css={cellStyle}>{formatCount(tool.totalCalls)}</Typography.Text>
                  <Typography.Text css={cellStyle}>{tool.successRate.toFixed(2)}%</Typography.Text>
                  <RangeBarMetricCell
                    avg={tool.avgLatency}
                    min={tool.minLatency}
                    max={tool.maxLatency}
                    globalMax={globalMaxLatency}
                    color={getChartColor(colorIndex)}
                    format={formatLatency}
                    isNotable={tool.avgLatency >= p75Latency && p75Latency > 0}
                    notableReason={intl.formatMessage({
                      defaultMessage: 'Among the highest by avg latency (top quartile)',
                      description: 'Tooltip text on the notable-row InfoIcon for the tool latency column',
                    })}
                    metricLabel={intl.formatMessage({
                      defaultMessage: 'Avg latency',
                      description: 'Avg latency aria-label for the tool performance range bar',
                    })}
                    componentId="mlflow.charts.tool_performance_summary"
                  />
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <OverviewChartEmptyState />
      )}
    </OverviewChartContainer>
  );
};
