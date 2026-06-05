import React, { useMemo, useState } from 'react';
import {
  ChartLineIcon,
  SegmentedControlButton,
  SegmentedControlGroup,
  Typography,
  useDesignSystemTheme,
} from '@databricks/design-system';
import { FormattedMessage } from 'react-intl';
import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatCount, formatLatency, useChartColors } from '../utils/chartUtils';
import type { SkillPerformanceData } from '../hooks/useSkillPerformanceSummaryData';
import { useSkillPerformanceSummaryData } from '../hooks/useSkillPerformanceSummaryData';
import {
  OverviewChartContainer,
  OverviewChartEmptyState,
  OverviewChartErrorState,
  OverviewChartHeader,
  OverviewChartLoadingState,
} from './OverviewChartComponents';
import { SortableHeader, useSortState, useSummaryTableStyles } from './SummaryTableComponents';

type PerfMode = 'table' | 'chart';
type SortColumn = 'skillName' | 'totalCalls' | 'avgLatency';

const SkillChartTooltip: React.FC<any> = ({ active, payload }) => {
  const { theme } = useDesignSystemTheme();
  if (!active || !payload?.length) return null;
  const row = payload[0].payload as SkillPerformanceData;
  return (
    <div
      style={{
        background: theme.colors.backgroundPrimary,
        border: `1px solid ${theme.colors.border}`,
        borderRadius: theme.borders.borderRadiusMd,
        padding: `${theme.spacing.sm}px ${theme.spacing.md}px`,
        fontSize: theme.typography.fontSizeSm,
        color: theme.colors.textPrimary,
        lineHeight: 1.8,
      }}
    >
      <div style={{ fontWeight: 600, marginBottom: theme.spacing.xs }}>{row.skillName}</div>
      <div>Avg latency: {formatLatency(row.avgLatency)}</div>
      <div style={{ color: theme.colors.textSecondary, marginTop: theme.spacing.xs }}>Calls: {row.totalCalls}</div>
    </div>
  );
};

const SkillTableView: React.FC<{
  skillsData: SkillPerformanceData[];
  allSkillNames: string[];
}> = ({ skillsData, allSkillNames }) => {
  const { theme } = useDesignSystemTheme();
  const { getChartColor } = useChartColors();
  const { sortColumn, sortDirection, handleSort } = useSortState<SortColumn>('totalCalls');
  const { headerRowStyle, bodyRowStyle, cellStyle } = useSummaryTableStyles('minmax(100px, 2fr) 1fr 1fr');

  const sorted = useMemo(() => {
    return [...skillsData].sort((a, b) => {
      let cmp = 0;
      switch (sortColumn) {
        case 'skillName':
          cmp = a.skillName.localeCompare(b.skillName);
          break;
        case 'totalCalls':
          cmp = a.totalCalls - b.totalCalls;
          break;
        case 'avgLatency':
          cmp = a.avgLatency - b.avgLatency;
          break;
      }
      return sortDirection === 'asc' ? cmp : -cmp;
    });
  }, [skillsData, sortColumn, sortDirection]);

  return (
    <div css={{ display: 'flex', flexDirection: 'column' }}>
      <div css={headerRowStyle}>
        <SortableHeader column="skillName" sortColumn={sortColumn} sortDirection={sortDirection} onSort={handleSort}>
          <FormattedMessage defaultMessage="Skill" description="Column header for skill name" />
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
          column="avgLatency"
          sortColumn={sortColumn}
          sortDirection={sortDirection}
          onSort={handleSort}
          centered
        >
          <FormattedMessage defaultMessage="Latency (AVG)" description="Column header for average latency" />
        </SortableHeader>
      </div>
      <div css={{ maxHeight: 200, overflowY: 'auto' }}>
        {sorted.map((skill, index) => {
          const originalIndex = allSkillNames.indexOf(skill.skillName);
          const colorIndex = originalIndex === -1 ? index : originalIndex;
          return (
            <div key={skill.skillName} css={bodyRowStyle}>
              <div
                css={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: theme.spacing.sm,
                  overflow: 'hidden',
                }}
              >
                <div
                  css={{
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    backgroundColor: getChartColor(colorIndex),
                    flexShrink: 0,
                  }}
                />
                <Typography.Text
                  css={{
                    fontFamily: 'monospace',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {skill.skillName}
                </Typography.Text>
              </div>
              <Typography.Text css={cellStyle}>{formatCount(skill.totalCalls)}</Typography.Text>
              <Typography.Text css={cellStyle}>{formatLatency(skill.avgLatency)}</Typography.Text>
            </div>
          );
        })}
      </div>
    </div>
  );
};

const SkillChartView: React.FC<{
  skillsData: SkillPerformanceData[];
  allSkillNames: string[];
}> = ({ skillsData, allSkillNames }) => {
  const { theme } = useDesignSystemTheme();
  const { getChartColor } = useChartColors();

  const sorted = useMemo(() => [...skillsData].sort((a, b) => b.avgLatency - a.avgLatency), [skillsData]);

  return (
    <div css={{ height: 260, marginTop: theme.spacing.sm }}>
      <Typography.Text size="sm" color="secondary">
        <FormattedMessage defaultMessage="Avg latency per call" description="Chart subtitle for skill latency chart" />
      </Typography.Text>
      <div css={{ height: 220, marginTop: theme.spacing.xs }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={sorted} layout="vertical" margin={{ top: 4, right: 48, left: 0, bottom: 4 }}>
            <XAxis
              type="number"
              tick={{ fontSize: theme.typography.fontSizeSm }}
              tickFormatter={(v) => formatLatency(v)}
            />
            <YAxis type="category" dataKey="skillName" width={180} tick={{ fontSize: theme.typography.fontSizeSm }} />
            <Tooltip content={<SkillChartTooltip />} />
            <Bar dataKey="avgLatency" radius={[0, 2, 2, 0]}>
              {sorted.map((row) => {
                const originalIndex = allSkillNames.indexOf(row.skillName);
                return <Cell key={row.skillName} fill={getChartColor(originalIndex === -1 ? 0 : originalIndex)} />;
              })}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};

export const SkillPerformanceSummary: React.FC = () => {
  const [mode, setMode] = useState<PerfMode>('table');
  const { skillsData, isLoading, error, hasData } = useSkillPerformanceSummaryData();

  const allSkillNames = useMemo(() => skillsData.map((s) => s.skillName), [skillsData]);

  if (isLoading) {
    return <OverviewChartLoadingState />;
  }

  if (error) {
    return <OverviewChartErrorState />;
  }

  return (
    <OverviewChartContainer componentId="mlflow.charts.skill_performance_summary">
      <div css={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <OverviewChartHeader
          icon={<ChartLineIcon />}
          title={
            <FormattedMessage
              defaultMessage="Skills Performance"
              description="Title for the skills performance summary section"
            />
          }
          subtitle={
            <FormattedMessage
              defaultMessage="avg latency per invocation · sorted by call count"
              description="Subtitle for the skills performance summary section"
            />
          }
        />
        <div css={{ flexShrink: 0 }}>
          <SegmentedControlGroup
            componentId="mlflow.charts.skill_performance_summary.view_mode"
            name="skill-perf-view-mode"
            value={mode}
            onChange={({ target: { value } }) => setMode(value as PerfMode)}
          >
            <SegmentedControlButton value="table">
              <FormattedMessage defaultMessage="Table" description="Table view toggle label" />
            </SegmentedControlButton>
            <SegmentedControlButton value="chart">
              <FormattedMessage defaultMessage="Chart" description="Chart view toggle label" />
            </SegmentedControlButton>
          </SegmentedControlGroup>
        </div>
      </div>

      {hasData ? (
        mode === 'table' ? (
          <SkillTableView skillsData={skillsData} allSkillNames={allSkillNames} />
        ) : (
          <SkillChartView skillsData={skillsData} allSkillNames={allSkillNames} />
        )
      ) : (
        <OverviewChartEmptyState />
      )}
    </OverviewChartContainer>
  );
};
