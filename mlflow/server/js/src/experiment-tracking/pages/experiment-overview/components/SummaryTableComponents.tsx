import React, { useState, useCallback } from 'react';
import {
  InfoIcon,
  SortAscendingIcon,
  SortDescendingIcon,
  Tooltip,
  Typography,
  useDesignSystemTheme,
} from '@databricks/design-system';

export type SortDirection = 'asc' | 'desc';

/**
 * Hook for managing table sort state.
 * Returns current sort state and a handler to toggle sorting.
 *
 * @param defaultColumn - Initial column to sort by
 * @param defaultDirection - Initial sort direction (default: 'desc')
 */
export function useSortState<T extends string>(defaultColumn: T, defaultDirection: SortDirection = 'desc') {
  const [sortColumn, setSortColumn] = useState<T>(defaultColumn);
  const [sortDirection, setSortDirection] = useState<SortDirection>(defaultDirection);

  const handleSort = useCallback(
    (column: T) => {
      if (sortColumn === column) {
        setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
      } else {
        setSortColumn(column);
        setSortDirection('desc');
      }
    },
    [sortColumn, sortDirection],
  );

  return { sortColumn, sortDirection, handleSort };
}

interface SortableHeaderProps<T extends string> {
  /** Column identifier for sorting */
  column: T;
  /** Current sorted column */
  sortColumn: T;
  /** Current sort direction */
  sortDirection: SortDirection;
  /** Handler called when header is clicked */
  onSort: (column: T) => void;
  /** Header content */
  children: React.ReactNode;
  /** Whether to center the content */
  centered?: boolean;
}

/**
 * Sortable header cell component for summary tables.
 * Shows sort indicator when this column is the active sort column.
 */
export function SortableHeader<T extends string>({
  column,
  sortColumn,
  sortDirection,
  onSort,
  children,
  centered,
}: SortableHeaderProps<T>) {
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
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onSort(column)}
      css={{
        display: 'flex',
        alignItems: 'center',
        gap: theme.spacing.xs,
        cursor: 'pointer',
        justifyContent: centered ? 'center' : 'flex-start',
        color: theme.colors.textSecondary,
        fontSize: theme.typography.fontSizeSm,
        fontWeight: 600,
        '&:hover': { color: theme.colors.textPrimary },
      }}
    >
      {children}
      {isActive && (sortDirection === 'asc' ? <SortAscendingIcon /> : <SortDescendingIcon />)}
    </div>
  );
}

/**
 * Hook that returns common table styles for summary tables.
 *
 * @param gridColumns - CSS grid-template-columns value (e.g., 'minmax(80px, 2fr) 1fr 1fr')
 */
export function useSummaryTableStyles(gridColumns: string) {
  const { theme } = useDesignSystemTheme();

  const rowStyle = {
    display: 'grid',
    gridTemplateColumns: gridColumns,
    gap: theme.spacing.lg,
    borderBottom: `1px solid ${theme.colors.border}`,
  } as const;

  const headerRowStyle = {
    ...rowStyle,
    padding: `${theme.spacing.sm}px ${theme.spacing.lg}px ${theme.spacing.sm}px 0`,
  } as const;

  const bodyRowStyle = {
    ...rowStyle,
    padding: `${theme.spacing.md}px ${theme.spacing.lg}px ${theme.spacing.md}px 0`,
    alignItems: 'center',
    '&:last-child': { borderBottom: 'none' },
  } as const;

  const cellStyle = { textAlign: 'center' } as const;

  return { rowStyle, headerRowStyle, bodyRowStyle, cellStyle };
}

interface LinkableNameCellProps {
  /** Name to display */
  name: string;
  /** Color for the indicator dot */
  color: string;
  /** ID of the element to scroll to when clicked */
  scrollToElementId: string;
}

/**
 * Table cell displaying a clickable name with a colored indicator dot.
 * Clicking scrolls to the specified element. Used for linking summary table rows to their charts.
 */
export const LinkableNameCell: React.FC<LinkableNameCellProps> = ({ name, color, scrollToElementId }) => {
  const { theme } = useDesignSystemTheme();

  const handleClick = () => {
    const element = document.getElementById(scrollToElementId);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={handleClick}
      onKeyDown={(e) => e.key === 'Enter' && handleClick()}
      css={{
        display: 'flex',
        alignItems: 'center',
        gap: theme.spacing.sm,
        cursor: 'pointer',
        '&:hover': { textDecoration: 'underline' },
      }}
    >
      <div
        css={{
          width: 8,
          height: 8,
          borderRadius: '50%',
          backgroundColor: color,
          flexShrink: 0,
        }}
      />
      <Typography.Text
        css={{
          fontFamily: 'monospace',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          color: theme.colors.actionPrimaryBackgroundDefault,
        }}
      >
        {name}
      </Typography.Text>
    </div>
  );
};

interface RangeBarMetricCellProps {
  /** The headline (average) value rendered above the bar. */
  avg: number;
  /** The minimum value — left edge of the colored range. */
  min: number;
  /** The maximum value — right edge of the colored range. */
  max: number;
  /** The maximum value across all rows; used to normalize percentages so rows
   *  are visually comparable. */
  globalMax: number;
  /** Color of the range overlay + avg tick. */
  color: string;
  /** Formatter used for the headline avg, tooltip, and aria-label. */
  format: (v: number) => string;
  /** Whether to show the "top quartile" InfoIcon next to the headline avg. */
  isNotable: boolean;
  /** Tooltip text for the InfoIcon (only used when `isNotable` is true). */
  notableReason: string;
  /** Human-readable metric name (e.g., "Avg latency") used in the aria-label. */
  metricLabel: string;
  /** Caller-scoped componentId prefix (e.g.
   *  `mlflow.charts.skill_performance_summary`). The component appends
   *  `.notable_tooltip` and `.range_tooltip` for the two Tooltips it owns. */
  componentId: string;
}

/**
 * Per-row cell for a "range-bar" metric layout: headline avg above a gray
 * track / colored-range / avg-tick bar. The colored portion is a focusable
 * <button> so the tooltip (min/avg/max) anchors to the data — not the column
 * midpoint — and keyboard users can Tab to it.
 *
 * Top-quartile rows (per metric) get an InfoIcon marker on the headline value
 * when `isNotable` is true.
 */
export const RangeBarMetricCell: React.FC<RangeBarMetricCellProps> = ({
  avg,
  min,
  max,
  globalMax,
  color,
  format,
  isNotable,
  notableReason,
  metricLabel,
  componentId,
}) => {
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
          <Tooltip componentId={`${componentId}.notable_tooltip`} content={notableReason}>
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
        <Tooltip componentId={`${componentId}.range_tooltip`} content={tooltipBody}>
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
 * Index-based percentile, used to flag top-quartile rows in a range-bar
 * metric column. Cheap and good enough for ~10–100 rows. Returns 0 on
 * empty input.
 */
export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * p)));
  return sorted[idx];
}
