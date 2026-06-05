import React, { useMemo, useState } from 'react';
import {
  ChartLineIcon,
  DialogCombobox,
  DialogComboboxContent,
  DialogComboboxOptionList,
  DialogComboboxOptionListCheckboxItem,
  DialogComboboxOptionListSearch,
  DialogComboboxTrigger,
  SegmentedControlButton,
  SegmentedControlGroup,
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

type SortKey = 'impact' | 'totalCalls' | 'avgLatency' | 'avgCost' | 'totalSpend';

const ROW_GRID = 'minmax(140px, 1.4fr) 70px minmax(0, 2.2fr) minmax(0, 2.2fr)';

interface EnrichedRow extends SkillPerformanceData {
  spend: number;
  cumulativeMs: number;
  impact: number;
}

interface RangePositions {
  minPct: number;
  avgPct: number;
  maxPct: number;
  hasData: boolean;
}

/**
 * Compute bar percentages once per row so the bar and the label row above it
 * read from the same source of truth — preventing label/bar drift.
 */
function rangePositions(min: number, max: number, avg: number, globalMax: number): RangePositions {
  if (globalMax <= 0) return { minPct: 0, avgPct: 0, maxPct: 0, hasData: false };
  return {
    minPct: Math.max(0, (min / globalMax) * 100),
    maxPct: Math.min(100, (max / globalMax) * 100),
    avgPct: Math.max(0, Math.min(100, (avg / globalMax) * 100)),
    hasData: true,
  };
}

const RangeBar: React.FC<{
  positions: RangePositions;
  color: string;
}> = ({ positions, color }) => {
  const { theme } = useDesignSystemTheme();
  if (!positions.hasData) {
    return (
      <div
        css={{
          height: 10,
          backgroundColor: theme.colors.backgroundSecondary,
          borderRadius: theme.borders.borderRadiusMd,
        }}
      />
    );
  }
  const { minPct, avgPct, maxPct } = positions;
  const rangeWidth = Math.max(maxPct - minPct, 0.5);
  return (
    <div
      css={{
        position: 'relative',
        height: 10,
        backgroundColor: theme.colors.backgroundSecondary,
        borderRadius: theme.borders.borderRadiusMd,
      }}
    >
      <div
        css={{
          position: 'absolute',
          left: `${minPct}%`,
          width: `${rangeWidth}%`,
          top: 0,
          bottom: 0,
          backgroundColor: color,
          opacity: 0.35,
          borderRadius: theme.borders.borderRadiusMd,
        }}
      />
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
        }}
      />
    </div>
  );
};

/**
 * Labels for min / avg / max, absolutely-positioned at the same percentages the
 * bar marks use so the eye sees label and mark in the same column. Avg is
 * always shown (it's the headline value); min and max are collision-suppressed
 * when they would visually overlap avg.
 */
const RangeLabels: React.FC<{
  min: number;
  avg: number;
  max: number;
  positions: RangePositions;
  format: (v: number) => string;
}> = ({ min, avg, max, positions, format }) => {
  const { theme } = useDesignSystemTheme();
  const { minPct, avgPct, maxPct, hasData } = positions;

  // ~12% is roughly two short numeric tokens at the default sm font size.
  const COLLISION_PCT = 12;
  const showMin = hasData && Math.abs(avgPct - minPct) >= COLLISION_PCT;
  const showMax = hasData && Math.abs(maxPct - avgPct) >= COLLISION_PCT;

  const labelStyle = (pct: number, bold: boolean) => ({
    position: 'absolute' as const,
    left: `${pct}%`,
    // Edge-clamp so labels at 0% / 100% don't clip outside the cell.
    transform: pct < 5 ? 'translateX(0)' : pct > 95 ? 'translateX(-100%)' : 'translateX(-50%)',
    fontSize: theme.typography.fontSizeSm,
    fontWeight: bold ? 600 : 400,
    color: bold ? theme.colors.textPrimary : theme.colors.textSecondary,
    whiteSpace: 'nowrap' as const,
    fontVariantNumeric: 'tabular-nums' as const,
  });

  return (
    <div
      css={{
        position: 'relative',
        height: Number(theme.typography.lineHeightSm.replace('px', '')) || 18,
        marginBottom: 2,
      }}
    >
      {showMin && <span css={labelStyle(minPct, false)}>{format(min)}</span>}
      {hasData && <span css={labelStyle(avgPct, true)}>{format(avg)}</span>}
      {showMax && <span css={labelStyle(maxPct, false)}>{format(max)}</span>}
    </div>
  );
};

export const SkillPerformanceSummary: React.FC = () => {
  const { theme } = useDesignSystemTheme();
  const intl = useIntl();
  const { getChartColor } = useChartColors();
  const [sortKey, setSortKey] = useState<SortKey>('impact');
  const [selectedSkills, setSelectedSkills] = useState<string[]>([]);
  const [skillFilterSearch, setSkillFilterSearch] = useState('');
  const { skillsData, isLoading, error, hasData } = useSkillPerformanceSummaryData();

  const allSkillNames = useMemo(() => skillsData.map((s) => s.skillName), [skillsData]);
  const selectedSkillsSet = useMemo(() => new Set(selectedSkills), [selectedSkills]);

  const filteredOptions = useMemo(() => {
    const q = skillFilterSearch.trim().toLowerCase();
    return q ? allSkillNames.filter((n) => n.toLowerCase().includes(q)) : allSkillNames;
  }, [allSkillNames, skillFilterSearch]);

  const maxSpend = useMemo(() => Math.max(...skillsData.map((s) => s.avgCost * s.totalCalls), 1), [skillsData]);
  const maxTime = useMemo(() => Math.max(...skillsData.map((s) => s.avgLatency * s.totalCalls), 1), [skillsData]);

  const enriched = useMemo<EnrichedRow[]>(
    () =>
      skillsData.map((s) => {
        const spend = s.avgCost * s.totalCalls;
        const cumulativeMs = s.avgLatency * s.totalCalls;
        const impact = spend / maxSpend + cumulativeMs / maxTime;
        return { ...s, spend, cumulativeMs, impact };
      }),
    [skillsData, maxSpend, maxTime],
  );

  const visible = useMemo(() => {
    const filtered =
      selectedSkills.length === 0 ? enriched : enriched.filter((s) => selectedSkillsSet.has(s.skillName));
    return [...filtered].sort((a, b) => {
      switch (sortKey) {
        case 'impact':
          return b.impact - a.impact;
        case 'totalCalls':
          return b.totalCalls - a.totalCalls;
        case 'avgLatency':
          return b.avgLatency - a.avgLatency;
        case 'avgCost':
          return b.avgCost - a.avgCost;
        case 'totalSpend':
          return b.spend - a.spend;
        default:
          return 0;
      }
    });
  }, [enriched, selectedSkills, selectedSkillsSet, sortKey]);

  const globalMaxLatency = useMemo(() => Math.max(...skillsData.map((s) => s.maxLatency), 1), [skillsData]);
  const globalMaxCost = useMemo(() => Math.max(...skillsData.map((s) => s.maxCost), 0), [skillsData]);

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
  // Skills are an optional feature — hide the entire card when no skill spans exist.
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
        <div css={{ display: 'flex', alignItems: 'center', gap: theme.spacing.sm }}>
          <Typography.Text size="sm" color="secondary">
            <FormattedMessage defaultMessage="Sort by" description="Label preceding the sort selector" />
          </Typography.Text>
          <SegmentedControlGroup
            componentId="mlflow.charts.skill_performance_summary.sort"
            name="skill-perf-sort"
            value={sortKey}
            onChange={({ target: { value } }) => setSortKey(value as SortKey)}
          >
            <SegmentedControlButton value="impact">
              <FormattedMessage defaultMessage="Impact" description="Sort by combined impact score" />
            </SegmentedControlButton>
            <SegmentedControlButton value="totalCalls">
              <FormattedMessage defaultMessage="Calls" description="Sort by total invocation count" />
            </SegmentedControlButton>
            <SegmentedControlButton value="avgLatency">
              <FormattedMessage defaultMessage="Avg latency" description="Sort by average latency per call" />
            </SegmentedControlButton>
            <SegmentedControlButton value="avgCost">
              <FormattedMessage defaultMessage="Avg cost" description="Sort by average token cost per call" />
            </SegmentedControlButton>
            <SegmentedControlButton value="totalSpend">
              <FormattedMessage defaultMessage="Total spend" description="Sort by cumulative spend" />
            </SegmentedControlButton>
          </SegmentedControlGroup>
        </div>

        <DialogCombobox
          componentId="mlflow.charts.skill_performance_summary.filter"
          label={intl.formatMessage({
            defaultMessage: 'Skills',
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

      <div
        css={{
          display: 'grid',
          gridTemplateColumns: ROW_GRID,
          gap: theme.spacing.md,
          padding: `${theme.spacing.md}px ${theme.spacing.sm}px`,
          borderBottom: `1px solid ${theme.colors.border}`,
        }}
      >
        <Typography.Text size="sm" color="secondary" bold>
          <FormattedMessage
            defaultMessage="Skill ({visible} of {total})"
            description="Skill column header showing visible/total count"
            values={{ visible: visible.length, total: skillsData.length }}
          />
        </Typography.Text>
        <Typography.Text size="sm" color="secondary" bold>
          <FormattedMessage defaultMessage="Calls" description="Calls column header" />
        </Typography.Text>
        <Typography.Text size="sm" color="secondary" bold>
          <FormattedMessage defaultMessage="Latency" description="Latency column header" />
        </Typography.Text>
        <Typography.Text size="sm" color="secondary" bold>
          <FormattedMessage defaultMessage="Cost" description="Cost column header" />
        </Typography.Text>
      </div>

      <div css={{ maxHeight: 360, overflowY: 'auto' }}>
        {visible.map((s) => {
          const idx = allSkillNames.indexOf(s.skillName);
          const color = getChartColor(idx === -1 ? 0 : idx);
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
              <Typography.Text>{formatCount(s.totalCalls)}</Typography.Text>
              {(() => {
                const latencyPositions = rangePositions(s.minLatency, s.maxLatency, s.avgLatency, globalMaxLatency);
                const costPositions = rangePositions(s.minCost, s.maxCost, s.avgCost, globalMaxCost);
                return (
                  <>
                    <div>
                      <RangeLabels
                        min={s.minLatency}
                        avg={s.avgLatency}
                        max={s.maxLatency}
                        positions={latencyPositions}
                        format={formatLatency}
                      />
                      <RangeBar positions={latencyPositions} color={color} />
                    </div>
                    <div>
                      <RangeLabels
                        min={s.minCost}
                        avg={s.avgCost}
                        max={s.maxCost}
                        positions={costPositions}
                        format={formatCostUSD}
                      />
                      <RangeBar positions={costPositions} color={color} />
                    </div>
                  </>
                );
              })()}
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

      <Typography.Text size="sm" color="secondary" css={{ marginTop: theme.spacing.sm, display: 'block' }}>
        <FormattedMessage
          defaultMessage="Default sort is Impact = normalized total spend + normalized total time. Pick one or more skills in the dropdown to filter."
          description="Caption explaining the default impact sort and filter usage"
        />
      </Typography.Text>
    </OverviewChartContainer>
  );
};
