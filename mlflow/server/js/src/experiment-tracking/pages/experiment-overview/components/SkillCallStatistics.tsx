import React, { useMemo } from 'react';
import {
  useDesignSystemTheme,
  SparkleIcon,
  WrenchIcon,
  DollarIcon,
  LightningIcon,
  QuestionMarkIcon,
  Tooltip,
  Typography,
} from '@databricks/design-system';
import { FormattedMessage } from 'react-intl';
import { formatCostUSD } from '@databricks/web-shared/model-trace-explorer';
import { useSkillPerformanceSummaryData } from '../hooks/useSkillPerformanceSummaryData';
import { formatCount } from '../utils/chartUtils';
import { StatCard } from './OverviewLayoutComponents';

export const SkillCallStatistics: React.FC = () => {
  const { theme } = useDesignSystemTheme();
  const { skillsData, isLoading, hasData, error } = useSkillPerformanceSummaryData();

  const totalInvocations = useMemo(() => skillsData.reduce((acc, s) => acc + s.totalCalls, 0), [skillsData]);
  const totalSpend = useMemo(() => skillsData.reduce((acc, s) => acc + s.avgCost * s.totalCalls, 0), [skillsData]);
  const biggestSpender = useMemo(
    () => [...skillsData].sort((a, b) => b.avgCost * b.totalCalls - a.avgCost * a.totalCalls)[0],
    [skillsData],
  );

  // Skills are optional — hide the entire strip when no skill spans exist.
  // Also hide on error: any failed query (cost, especially) would otherwise render
  // a confidently-wrong "$0.00 Total Skill Spend" from the partial data.
  if (!isLoading && (error || !hasData)) {
    return null;
  }

  return (
    <div>
      <div css={{ display: 'flex', alignItems: 'center', gap: theme.spacing.xs, marginBottom: theme.spacing.sm }}>
        <Typography.Text size="md" bold color="secondary">
          <FormattedMessage defaultMessage="Skills" description="Section header above the skill statistics callouts" />
        </Typography.Text>
        <Tooltip
          componentId="mlflow.charts.skill_call_statistics.subset_explanation"
          content={
            <FormattedMessage
              defaultMessage="Skills are a subset of Tool calls — every skill invocation is also a tool call."
              description="Tooltip clarifying that skills are a marked subset of tool calls"
            />
          }
        >
          <span css={{ display: 'inline-flex', color: theme.colors.textSecondary, cursor: 'help' }}>
            <QuestionMarkIcon />
          </span>
        </Tooltip>
      </div>
      <div
        css={{
          display: 'flex',
          gap: theme.spacing.md,
          flexWrap: 'wrap',
        }}
      >
        <StatCard
          icon={<SparkleIcon />}
          iconColor={theme.colors.purple}
          iconBgColor={`${theme.colors.purple}1A`}
          value={formatCount(skillsData.length)}
          label={<FormattedMessage defaultMessage="Skills Tracked" description="Label for total skills tracked" />}
          isLoading={isLoading}
        />
        <StatCard
          icon={<WrenchIcon />}
          iconColor={theme.colors.blue500}
          iconBgColor={`${theme.colors.blue500}1A`}
          value={formatCount(totalInvocations)}
          label={
            <FormattedMessage defaultMessage="Skill Invocations" description="Label for total skill invocations" />
          }
          isLoading={isLoading}
        />
        <StatCard
          icon={<DollarIcon />}
          iconColor={theme.colors.green500}
          iconBgColor={`${theme.colors.green500}1A`}
          value={formatCostUSD(totalSpend)}
          label={<FormattedMessage defaultMessage="Total Skill Spend" description="Label for cumulative skill cost" />}
          isLoading={isLoading}
        />
        <StatCard
          icon={<LightningIcon />}
          iconColor={theme.colors.yellow500}
          iconBgColor={`${theme.colors.yellow500}1A`}
          value={biggestSpender?.skillName ?? '—'}
          label={
            <FormattedMessage
              defaultMessage="Biggest Spending Skill"
              description="Label for the skill with the highest total spend"
            />
          }
          isLoading={isLoading}
        />
      </div>
    </div>
  );
};
