import React, { useMemo, useState } from 'react';
import {
  ChartLineIcon,
  DialogCombobox,
  DialogComboboxContent,
  DialogComboboxOptionList,
  DialogComboboxOptionListCheckboxItem,
  DialogComboboxOptionListSearch,
  DialogComboboxTrigger,
  SortAscendingIcon,
  SortDescendingIcon,
  Tooltip,
  Typography,
  useDesignSystemTheme,
} from '@databricks/design-system';
import { FormattedMessage, useIntl } from 'react-intl';
import { formatCostUSD } from '@databricks/web-shared/model-trace-explorer';
import { formatCount, formatLatency, useChartColors } from '../utils/chartUtils';
import type { SkillPerformanceData } from '../hooks/useSkillPerformanceSummaryData';
import { useSkillPerformanceSummaryData } from '../hooks/useSkillPerformanceSummaryData';
import {
  OverviewChartContainer,
  OverviewChartErrorState,
  OverviewChartHeader,
  OverviewChartLoadingState,
} from './OverviewChartComponents';
import { RangeBarMetricCell, percentile, useSortState } from './SummaryTableComponents';

type SortKey = 'skillName' | 'totalCalls' | 'avgCost' | 'totalSpend' | 'totalTimeMs' | 'avgTimeMs';

// Columns: Skill | Calls | Avg cost (range bar) | Total spend | Total time | Avg/call (range
// bar). Avg cost and Avg/call use the same min–avg–max range bar; Total spend and Total time
// are plain cumulative numbers.
const ROW_GRID = 'minmax(140px, 1.4fr) 70px minmax(0, 2fr) minmax(0, 1fr) 90px minmax(0, 2fr)';

interface EnrichedRow extends SkillPerformanceData {
  totalSpend: number;
}

/**
 * Clickable column header with sort indicator. Click (or Enter/Space) toggles
 * sort by the column; clicking the same column again flips direction. Right-
 * aligned by default for numeric columns; pass align="left" for text columns.
 */
const ColHeader: React.FC<{
  column: SortKey;
  sortColumn: SortKey;
  sortDirection: 'asc' | 'desc';
  onSort: (column: SortKey) => void;
  align?: 'left' | 'right';
  children: React.ReactNode;
}> = ({ column, sortColumn, sortDirection, onSort, align = 'right', children }) => {
  const { theme } = useDesignSystemTheme();
  const isActive = sortColumn === column;
  const ariaSort: 'ascending' | 'descending' | 'none' = !isActive
    ? 'none'
    : sortDirection === 'asc'
      ? 'ascending'
      : 'descending';
  return (
    <div
      role="columnheader"
      aria-sort={ariaSort}
      tabIndex={0}
      onClick={() => onSort(column)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSort(column);
        }
      }}
      css={{
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        justifyContent: align === 'right' ? 'flex-end' : 'flex-start',
        cursor: 'pointer',
        userSelect: 'none',
        color: isActive ? theme.colors.textPrimary : theme.colors.textSecondary,
        fontSize: theme.typography.fontSizeSm,
        fontWeight: 600,
        '&:hover': { color: theme.colors.textPrimary },
        '&:focus-visible': {
          outline: `2px solid ${theme.colors.actionDefaultBorderFocus}`,
          outlineOffset: 2,
          borderRadius: theme.borders.borderRadiusSm,
        },
      }}
    >
      {children}
      {isActive && (sortDirection === 'asc' ? <SortAscendingIcon /> : <SortDescendingIcon />)}
    </div>
  );
};

/**
 * Renders an em-dash + tooltip when cost can't be calculated for a row (the
 * model used by this skill isn't in the LiteLLM pricing catalog). We detect
 * this from `avgCost === 0 && totalTokens > 0` upstream — the skill produced
 * tokens but pricing was missing, so $0 would be misleading.
 */
const UnavailableCostCell: React.FC<{ tooltip: React.ReactNode }> = ({ tooltip }) => {
  const { theme } = useDesignSystemTheme();
  return (
    <Tooltip componentId="mlflow.charts.skill_performance_summary.cost_unavailable" content={tooltip}>
      <span
        css={{
          display: 'block',
          textAlign: 'right',
          cursor: 'help',
          color: theme.colors.textSecondary,
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        —
      </span>
    </Tooltip>
  );
};

/** Plain-layout right-aligned numeric cell (no bar). */
const PlainNumber: React.FC<{ value: string; muted?: boolean }> = ({ value, muted }) => (
  <Typography.Text
    size={muted ? 'sm' : 'md'}
    color={muted ? 'secondary' : undefined}
    css={{ display: 'block', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}
  >
    {value}
  </Typography.Text>
);

export const SkillPerformanceSummary: React.FC = () => {
  const { theme } = useDesignSystemTheme();
  const intl = useIntl();
  const { getChartColor } = useChartColors();
  const { sortColumn, sortDirection, handleSort } = useSortState<SortKey>('totalCalls', 'desc');
  const [selectedSkills, setSelectedSkills] = useState<string[]>([]);
  const [skillFilterSearch, setSkillFilterSearch] = useState('');
  const { skillsData, isLoading, error, hasData } = useSkillPerformanceSummaryData();

  const allSkillNames = useMemo(() => skillsData.map((s) => s.skillName), [skillsData]);
  const selectedSkillsSet = useMemo(() => new Set(selectedSkills), [selectedSkills]);

  const filteredOptions = useMemo(() => {
    const q = skillFilterSearch.trim().toLowerCase();
    return q ? allSkillNames.filter((n) => n.toLowerCase().includes(q)) : allSkillNames;
  }, [allSkillNames, skillFilterSearch]);

  const enriched = useMemo<EnrichedRow[]>(
    () => skillsData.map((s) => ({ ...s, totalSpend: s.avgCost * s.totalCalls })),
    [skillsData],
  );

  const visible = useMemo(() => {
    const filtered =
      selectedSkills.length === 0 ? enriched : enriched.filter((s) => selectedSkillsSet.has(s.skillName));
    const dir = sortDirection === 'asc' ? 1 : -1;
    return [...filtered].sort((a, b) => {
      if (sortColumn === 'skillName') return a.skillName.localeCompare(b.skillName) * dir;
      return (a[sortColumn] - b[sortColumn]) * dir;
    });
  }, [enriched, selectedSkills, selectedSkillsSet, sortColumn, sortDirection]);

  const globalMaxCost = useMemo(() => Math.max(...skillsData.map((s) => s.maxCost), 0), [skillsData]);
  const globalMaxTime = useMemo(() => Math.max(...skillsData.map((s) => s.maxTimeMs), 0), [skillsData]);

  // Top-quartile thresholds — drive the InfoIcon "notable" marker in the
  // range-bar layout. Computed across the full dataset (not the filtered
  // view) so the marker semantics are stable as the user filters.
  const p75Cost = useMemo(
    () =>
      percentile(
        skillsData.map((s) => s.avgCost),
        0.75,
      ),
    [skillsData],
  );
  const p75Time = useMemo(
    () =>
      percentile(
        skillsData.map((s) => s.avgTimeMs),
        0.75,
      ),
    [skillsData],
  );

  // DialogCombobox renders ``renderDisplayedValue`` once per entry in ``value``;
  // collapse to a single summary so the count text renders once.
  const triggerText = useMemo(() => {
    if (selectedSkills.length === 0) return '';
    if (selectedSkills.length === 1) return selectedSkills[0];
    return intl.formatMessage(
      {
        defaultMessage: '{count} skills selected',
        description: 'Skill performance summary > filter trigger > N selected',
      },
      { count: selectedSkills.length },
    );
  }, [selectedSkills, intl]);
  const triggerValue = useMemo(() => (triggerText ? [triggerText] : []), [triggerText]);

  const toggleSkill = (name: string) => {
    setSelectedSkills((prev) => (prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name]));
  };

  if (isLoading) return <OverviewChartLoadingState />;
  if (error) return <OverviewChartErrorState />;
  if (!hasData) return null;

  return (
    <OverviewChartContainer componentId="mlflow.charts.skill_performance_summary">
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
            defaultMessage="Per-skill time and token cost across all invocations"
            description="Subtitle for the skills performance summary section"
          />
        }
      />

      <div
        css={{
          display: 'flex',
          alignItems: 'center',
          gap: theme.spacing.md,
          flexWrap: 'wrap',
          marginBottom: theme.spacing.md,
        }}
      >
        <DialogCombobox
          componentId="mlflow.charts.skill_performance_summary.filter"
          label={intl.formatMessage({
            defaultMessage: 'All skills',
            description: 'Skill filter dropdown label',
          })}
          multiSelect
          value={triggerValue}
        >
          <DialogComboboxTrigger
            placeholder={intl.formatMessage(
              {
                defaultMessage: 'All skills ({count})',
                description: 'Skill filter trigger placeholder showing total skill count',
              },
              { count: allSkillNames.length },
            )}
            allowClear={selectedSkills.length > 0}
            onClear={() => setSelectedSkills([])}
            width={220}
          />
          <DialogComboboxContent>
            <DialogComboboxOptionList>
              <DialogComboboxOptionListSearch
                controlledValue={skillFilterSearch}
                setControlledValue={setSkillFilterSearch}
              >
                {filteredOptions.length === 0 ? (
                  <DialogComboboxOptionListCheckboxItem value="" checked={false} onChange={() => {}} disabled>
                    <FormattedMessage
                      defaultMessage="No matching skills"
                      description="Empty state in the skill filter dropdown"
                    />
                  </DialogComboboxOptionListCheckboxItem>
                ) : (
                  filteredOptions.map((name) => (
                    <DialogComboboxOptionListCheckboxItem
                      key={name}
                      value={name}
                      checked={selectedSkillsSet.has(name)}
                      onChange={() => toggleSkill(name)}
                    />
                  ))
                )}
              </DialogComboboxOptionListSearch>
            </DialogComboboxOptionList>
          </DialogComboboxContent>
        </DialogCombobox>
      </div>

      {/* Sticky header row — adapts to the active layout. Each header is
          clickable to sort by that column (Enter / Space also work for
          keyboard). Sort direction toggles on repeat clicks. */}
      <div
        css={{
          position: 'sticky',
          top: 0,
          zIndex: 1,
          display: 'grid',
          gridTemplateColumns: ROW_GRID,
          gap: theme.spacing.md,
          padding: `${theme.spacing.md}px ${theme.spacing.sm}px`,
          borderBottom: `1px solid ${theme.colors.border}`,
          backgroundColor: theme.colors.backgroundPrimary,
        }}
      >
        <ColHeader
          sortColumn={sortColumn}
          sortDirection={sortDirection}
          onSort={handleSort}
          column="skillName"
          align="left"
        >
          <FormattedMessage
            defaultMessage="Skill ({visible} of {total})"
            description="Skill column header showing visible/total count"
            values={{ visible: visible.length, total: skillsData.length }}
          />
        </ColHeader>
        <ColHeader sortColumn={sortColumn} sortDirection={sortDirection} onSort={handleSort} column="totalCalls">
          <FormattedMessage defaultMessage="Calls" description="Calls column header" />
        </ColHeader>
        <ColHeader sortColumn={sortColumn} sortDirection={sortDirection} onSort={handleSort} column="avgCost">
          <FormattedMessage defaultMessage="Avg cost" description="Avg cost column header" />
        </ColHeader>
        <ColHeader sortColumn={sortColumn} sortDirection={sortDirection} onSort={handleSort} column="totalSpend">
          <FormattedMessage defaultMessage="Total spend" description="Total spend column header" />
        </ColHeader>
        <ColHeader sortColumn={sortColumn} sortDirection={sortDirection} onSort={handleSort} column="totalTimeMs">
          <FormattedMessage defaultMessage="Total time" description="Total skill time column header" />
        </ColHeader>
        <ColHeader sortColumn={sortColumn} sortDirection={sortDirection} onSort={handleSort} column="avgTimeMs">
          <FormattedMessage defaultMessage="Avg / call" description="Average time per invocation column header" />
        </ColHeader>
      </div>

      <div css={{ maxHeight: 360, overflowY: 'auto' }}>
        {visible.map((s) => {
          const idx = allSkillNames.indexOf(s.skillName);
          const color = getChartColor(idx === -1 ? 0 : idx);
          const isCostNotable = s.avgCost >= p75Cost && p75Cost > 0;
          // Heuristic: treat $0 cost as "unavailable" (not zero) whenever the
          // skill made any calls. Skills are LLM-backed by definition, so $0
          // cost on a real call almost always means the model used isn't in
          // the LiteLLM pricing catalog. Showing $0 would mislead the user.
          // (A more precise check would compare tokens > 0, but span-level
          // token metrics aren't exposed by the backend; revisit if needed.)
          const isCostUnavailable = s.avgCost === 0 && s.totalCalls > 0;
          const unavailableTooltip = intl.formatMessage({
            defaultMessage: "Pricing unavailable — the model used by this skill isn't in the pricing catalog.",
            description: 'Tooltip explaining the em-dash placeholder in the cost column',
          });
          return (
            <div
              key={s.skillName}
              css={{
                display: 'grid',
                gridTemplateColumns: ROW_GRID,
                gap: theme.spacing.md,
                padding: `${theme.spacing.md}px ${theme.spacing.sm}px`,
                alignItems: 'center',
                borderBottom: `1px solid ${theme.colors.borderDecorative}`,
              }}
            >
              <div css={{ display: 'flex', alignItems: 'center', gap: theme.spacing.xs, overflow: 'hidden' }}>
                <span css={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: color, flexShrink: 0 }} />
                <Typography.Text
                  css={{
                    fontFamily: 'monospace',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {s.skillName}
                </Typography.Text>
              </div>
              <PlainNumber value={formatCount(s.totalCalls)} />
              {isCostUnavailable ? (
                <UnavailableCostCell tooltip={unavailableTooltip} />
              ) : (
                <RangeBarMetricCell
                  avg={s.avgCost}
                  min={s.minCost}
                  max={s.maxCost}
                  globalMax={globalMaxCost}
                  color={color}
                  format={formatCostUSD}
                  isNotable={isCostNotable}
                  notableReason={intl.formatMessage({
                    defaultMessage: 'Among the highest by avg cost (top quartile)',
                    description: 'Tooltip text on the notable-row InfoIcon for the cost column',
                  })}
                  metricLabel={intl.formatMessage({
                    defaultMessage: 'Avg cost',
                    description: 'Avg cost aria-label for the range bar',
                  })}
                  componentId="mlflow.charts.skill_performance_summary"
                />
              )}
              {isCostUnavailable ? (
                <UnavailableCostCell tooltip={unavailableTooltip} />
              ) : (
                <PlainNumber value={formatCostUSD(s.totalSpend)} />
              )}
              <PlainNumber value={formatLatency(s.totalTimeMs)} />
              <RangeBarMetricCell
                avg={s.avgTimeMs}
                min={s.minTimeMs}
                max={s.maxTimeMs}
                globalMax={globalMaxTime}
                color={color}
                format={formatLatency}
                isNotable={s.avgTimeMs >= p75Time && p75Time > 0}
                notableReason={intl.formatMessage({
                  defaultMessage: 'Among the slowest by avg time per call (top quartile)',
                  description: 'Tooltip text on the notable-row InfoIcon for the avg time column',
                })}
                metricLabel={intl.formatMessage({
                  defaultMessage: 'Avg time per call',
                  description: 'Avg time per call aria-label for the range bar',
                })}
                componentId="mlflow.charts.skill_performance_summary.time"
              />
            </div>
          );
        })}
        {visible.length === 0 && (
          <div css={{ padding: theme.spacing.lg, textAlign: 'center' }}>
            <Typography.Text color="secondary">
              <FormattedMessage
                defaultMessage="No skills match the current filter."
                description="Empty state for the skill performance list when filter excludes all skills"
              />
            </Typography.Text>
          </div>
        )}
      </div>
    </OverviewChartContainer>
  );
};
