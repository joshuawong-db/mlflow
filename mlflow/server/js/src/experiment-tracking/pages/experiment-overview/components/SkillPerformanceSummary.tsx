import React, { useMemo, useState } from 'react';
import {
  ChartLineIcon,
  DialogCombobox,
  DialogComboboxContent,
  DialogComboboxOptionList,
  DialogComboboxOptionListCheckboxItem,
  DialogComboboxOptionListSearch,
  DialogComboboxTrigger,
  InfoIcon,
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
import { useSortState } from './SummaryTableComponents';

type SortKey = 'skillName' | 'totalCalls' | 'avgLatency' | 'avgCost' | 'totalSpend';

// Last column = Total spend (avgCost × totalCalls) — the cumulative dollars
// burned by the skill, the most actionable per-skill business value.
const ROW_GRID = 'minmax(140px, 1.4fr) 70px minmax(0, 2fr) minmax(0, 2fr) minmax(0, 1fr)';

interface EnrichedRow extends SkillPerformanceData {
  totalSpend: number;
}

/**
 * Index-based percentile, used to flag top-quartile rows. Cheap and good
 * enough for ~10–100 skills. Returns 0 on empty input.
 */
function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * p)));
  return sorted[idx];
}

/**
 * Default per-row cell for the "range-bar" layout: headline avg above a
 * gray-track / colored-range / avg-tick bar. The colored portion is a
 * focusable <button> so the tooltip (min/avg/max) anchors to the data — not
 * the column midpoint — and keyboard users can Tab to it.
 *
 * Top-quartile rows (per metric) get an InfoIcon marker on the headline value.
 */
const RangeBarMetricCell: React.FC<{
  avg: number;
  min: number;
  max: number;
  globalMax: number;
  color: string;
  format: (v: number) => string;
  isNotable: boolean;
  notableReason: string;
  metricLabel: string;
}> = ({ avg, min, max, globalMax, color, format, isNotable, notableReason, metricLabel }) => {
  const { theme } = useDesignSystemTheme();
  const avgPct = globalMax > 0 ? Math.max(0, Math.min(100, (avg / globalMax) * 100)) : 0;
  const minPct = globalMax > 0 ? Math.max(0, (min / globalMax) * 100) : 0;
  const maxPct = globalMax > 0 ? Math.min(100, (max / globalMax) * 100) : 0;
  const rangeWidth = Math.max(maxPct - minPct, 0.5);

  const ariaLabel = `${metricLabel}: avg ${format(avg)}, range ${format(min)} to ${format(max)}`;
  const tooltipBody = (
    <div css={{ fontVariantNumeric: 'tabular-nums' }}>
      <div>min · {format(min)}</div>
      <div>
        <strong>avg · {format(avg)}</strong>
      </div>
      <div>max · {format(max)}</div>
    </div>
  );

  return (
    <div css={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
      <div css={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6 }}>
        {isNotable && (
          <Tooltip componentId="mlflow.charts.skill_performance_summary.notable_tooltip" content={notableReason}>
            <span
              css={{
                display: 'inline-flex',
                alignItems: 'center',
                color: theme.colors.actionLinkDefault,
                cursor: 'help',
                fontSize: 16,
              }}
            >
              <InfoIcon aria-label={notableReason} />
            </span>
          </Tooltip>
        )}
        <Typography.Text css={{ fontVariantNumeric: 'tabular-nums', fontWeight: 500 }}>{format(avg)}</Typography.Text>
      </div>
      <div
        role="presentation"
        css={{
          position: 'relative',
          width: '100%',
          height: 8,
          backgroundColor: theme.colors.backgroundSecondary,
          borderRadius: theme.borders.borderRadiusMd,
        }}
      >
        <Tooltip componentId="mlflow.charts.skill_performance_summary.range_tooltip" content={tooltipBody}>
          <button
            type="button"
            aria-label={ariaLabel}
            css={{
              position: 'absolute',
              left: `${minPct}%`,
              width: `${rangeWidth}%`,
              top: 0,
              bottom: 0,
              backgroundColor: color,
              opacity: 0.45,
              borderRadius: theme.borders.borderRadiusMd,
              cursor: 'help',
              border: 'none',
              padding: 0,
              margin: 0,
              outline: 'none',
              font: 'inherit',
              '&:focus-visible': {
                boxShadow: `0 0 0 2px ${theme.colors.actionDefaultBorderFocus}`,
                opacity: 0.7,
              },
              '&:hover': { opacity: 0.7 },
            }}
          />
        </Tooltip>
        <div
          css={{
            position: 'absolute',
            left: `${avgPct}%`,
            top: -3,
            bottom: -3,
            width: 3,
            backgroundColor: color,
            borderRadius: 1,
            transform: 'translateX(-1.5px)',
            pointerEvents: 'none',
          }}
        />
      </div>
    </div>
  );
};

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
  const { sortColumn, sortDirection, handleSort } = useSortState<SortKey>('avgLatency', 'desc');
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

  const globalMaxLatency = useMemo(() => Math.max(...skillsData.map((s) => s.maxLatency), 1), [skillsData]);
  const globalMaxCost = useMemo(() => Math.max(...skillsData.map((s) => s.maxCost), 0), [skillsData]);

  // Top-quartile thresholds — drive the InfoIcon "notable" marker in the
  // range-bar layout. Computed across the full dataset (not the filtered
  // view) so the marker semantics are stable as the user filters.
  const p75Latency = useMemo(
    () =>
      percentile(
        skillsData.map((s) => s.avgLatency),
        0.75,
      ),
    [skillsData],
  );
  const p75Cost = useMemo(
    () =>
      percentile(
        skillsData.map((s) => s.avgCost),
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
            defaultMessage="Per-skill latency and token cost across all invocations"
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
        <ColHeader sortColumn={sortColumn} sortDirection={sortDirection} onSort={handleSort} column="avgLatency">
          <FormattedMessage defaultMessage="Avg latency" description="Avg latency column header" />
        </ColHeader>
        <ColHeader sortColumn={sortColumn} sortDirection={sortDirection} onSort={handleSort} column="avgCost">
          <FormattedMessage defaultMessage="Avg cost" description="Avg cost column header" />
        </ColHeader>
        <ColHeader sortColumn={sortColumn} sortDirection={sortDirection} onSort={handleSort} column="totalSpend">
          <FormattedMessage defaultMessage="Total spend" description="Total spend column header" />
        </ColHeader>
      </div>

      <div css={{ maxHeight: 360, overflowY: 'auto' }}>
        {visible.map((s) => {
          const idx = allSkillNames.indexOf(s.skillName);
          const color = getChartColor(idx === -1 ? 0 : idx);
          const isLatencyNotable = s.avgLatency >= p75Latency && p75Latency > 0;
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
              <RangeBarMetricCell
                avg={s.avgLatency}
                min={s.minLatency}
                max={s.maxLatency}
                globalMax={globalMaxLatency}
                color={color}
                format={formatLatency}
                isNotable={isLatencyNotable}
                notableReason={intl.formatMessage({
                  defaultMessage: 'Among the highest by avg latency (top quartile)',
                  description: 'Tooltip text on the notable-row InfoIcon for the latency column',
                })}
                metricLabel={intl.formatMessage({
                  defaultMessage: 'Avg latency',
                  description: 'Avg latency aria-label for the range bar',
                })}
              />
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
                />
              )}
              {isCostUnavailable ? (
                <UnavailableCostCell tooltip={unavailableTooltip} />
              ) : (
                <PlainNumber value={formatCostUSD(s.totalSpend)} />
              )}
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
