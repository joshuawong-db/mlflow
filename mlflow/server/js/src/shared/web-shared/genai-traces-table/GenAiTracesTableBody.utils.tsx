import type { ColumnDef } from '@tanstack/react-table';
import { isNil } from 'lodash';

import type { ThemeType } from '@databricks/design-system';
import { Tooltip } from '@databricks/design-system';
import type { IntlShape } from '@databricks/i18n';

import { traceInfoSortingFn } from './GenAiTracesTable.utils';
import {
  AssessmentCell,
  expectationCellRenderer,
  inputColumnCellRenderer,
  traceInfoCellRenderer,
} from './cellRenderers/rendererFunctions';
import {
  getEvaluationResultAssessmentValue,
  KnownEvaluationResultAssessmentStringValue,
  stringifyValue,
} from './components/GenAiEvaluationTracesReview.utils';
import { RESPONSE_COLUMN_ID } from './hooks/useTableColumns';
import type {
  AssessmentValueType,
  EvalTraceComparisonEntry,
  TracesTableColumn,
  AssessmentInfo,
  RunEvaluationResultAssessment,
} from './types';
import { TracesTableColumnType } from './types';
import { timeSinceStr } from './utils/DisplayUtils';
import type { ModelTraceInfoV3 } from '../model-trace-explorer/ModelTrace.types';

const DEFAULT_ASSESSMENT_CELL_WIDTH_PX = 120;
const DEFAULT_ASSESSMENTS_CELL_WIDTH_COMPARE_PX = 120;
const MAX_ASSESSMENT_COLUMN_SIZE = 200;
const DEFAULT_INPUT_COLUMNS_TOTAL_WIDTH_PX = 300;

export function compareAssessmentValues(
  assessmentInfo: AssessmentInfo,
  a: AssessmentValueType,
  b: AssessmentValueType,
): 'greater' | 'less' | 'equal' {
  if (assessmentInfo.dtype === 'pass-fail') {
    if (a === b) {
      return 'equal';
    }
    if (a === KnownEvaluationResultAssessmentStringValue.YES) {
      return 'greater';
    } else if (a === KnownEvaluationResultAssessmentStringValue.NO) {
      return 'less';
    } else {
      return !isNil(b) ? 'less' : 'equal';
    }
  } else if (assessmentInfo.dtype === 'boolean') {
    if (a === b) {
      return 'equal';
    }
    if (a === true) {
      return 'greater';
    } else if (a === false) {
      return 'less';
    } else {
      return !isNil(b) ? 'less' : 'equal';
    }
  } else if (assessmentInfo.dtype === 'string') {
    // Compare the strings in alphabetical sort order.
    if (a === b) {
      return 'equal';
    }
    if (a === null) {
      return 'less';
    }
    if (b === null) {
      return 'greater';
    }
    const aString = a as string | undefined;
    const bString = b as string | undefined;
    if (isNil(aString)) {
      return 'less';
    } else if (isNil(bString)) {
      return 'greater';
    }
    return aString.toString().localeCompare(bString.toString()) === 1 ? 'greater' : 'less';
  } else if (assessmentInfo.dtype === 'numeric') {
    if (a === b) {
      return 'equal';
    }
    if (a === null) {
      return 'less';
    }
    if (b === null) {
      return 'greater';
    }
    const aNumber = a as number;
    const bNumber = b as number;
    return aNumber > bNumber ? 'greater' : 'less';
  }

  return 'equal';
}

/**
 * Pulls a human-readable string out of a serialized response payload.
 *
 * Tries (in priority order):
 *   1a. Plain string wrapper:           {response: "..."}
 *   1b. OpenAI nested under `response`: {response: {choices: [{message: {content}}]}}
 *   2.  OpenAI raw:                     {choices: [{message: {content}}]}
 *   3.  LangChain AIMessage:            {content: "..."}
 *   4.  ChatAgent / message list:       {messages: [..., {role: "assistant", content: "..."}]}
 *        — prefers the last assistant turn; falls back to the last string-content turn.
 *   5.  JSON-encoded plain string:      '"hello"' -> 'hello'
 *   6.  Plain non-JSON string passes through unchanged
 *
 * Falls back to {@link stringifyValue} if none of the shapes match.
 */
export const formatResponseTitle = (outputs: string) => {
  if (!outputs) {
    return outputs;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(outputs);
  } catch {
    // Not JSON — assume a plain string passthrough.
    return outputs;
  }

  // JSON-encoded plain string -> unwrap.
  if (typeof parsed === 'string') {
    return parsed;
  }

  const extracted = extractResponseText(parsed);
  if (!isNil(extracted)) {
    return extracted;
  }

  return stringifyValue(outputs);
};

const extractResponseText = (parsed: unknown): string | undefined => {
  if (!parsed || typeof parsed !== 'object') {
    return undefined;
  }
  const record = parsed as Record<string, unknown>;

  // 1. OpenAI nested under `response` (object form), or a plain `{response: "..."}` wrapper.
  const responseField = record['response'];
  if (typeof responseField === 'string') {
    return responseField;
  }
  const nestedChoices = (responseField as Record<string, unknown> | undefined)?.['choices'];
  const nestedContent = getFirstChoiceContent(nestedChoices);
  if (!isNil(nestedContent)) {
    return nestedContent;
  }

  // 2. OpenAI raw choices
  const rawContent = getFirstChoiceContent(record['choices']);
  if (!isNil(rawContent)) {
    return rawContent;
  }

  // 3. LangChain AIMessage
  if (typeof record['content'] === 'string') {
    return record['content'];
  }

  // 4. ChatAgent / message list — prefer the last assistant turn with string content,
  // falling back to the last entry with string content so partial/legacy traces still
  // surface something readable.
  const messages = record['messages'];
  if (Array.isArray(messages) && messages.length > 0) {
    const assistantContent = findLastMessageContent(messages, 'assistant');
    if (!isNil(assistantContent)) {
      return assistantContent;
    }
    const anyContent = findLastMessageContent(messages);
    if (!isNil(anyContent)) {
      return anyContent;
    }
  }

  return undefined;
};

const findLastMessageContent = (messages: unknown[], requiredRole?: string): string | undefined => {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (!message || typeof message !== 'object') {
      continue;
    }
    const record = message as Record<string, unknown>;
    if (requiredRole && record['role'] !== requiredRole) {
      continue;
    }
    if (typeof record['content'] === 'string') {
      return record['content'];
    }
  }
  return undefined;
};

const getFirstChoiceContent = (choices: unknown): string | undefined => {
  if (!Array.isArray(choices) || choices.length === 0) {
    return undefined;
  }
  const message = (choices[0] as Record<string, unknown> | undefined)?.['message'] as
    | Record<string, unknown>
    | undefined;
  const content = message?.['content'];
  return typeof content === 'string' ? content : undefined;
};

export const getColumnConfig = (
  col: TracesTableColumn,
  {
    evaluationInputs,
    isComparing,
    theme,
    intl,
    experimentId,
    onChangeEvaluationId,
    onTraceTagsEdit,
  }: {
    evaluationInputs: TracesTableColumn[];
    isComparing: boolean;
    theme: ThemeType;
    intl: IntlShape;
    experimentId?: string;
    onChangeEvaluationId: (evaluationId: string | undefined, traceInfo?: ModelTraceInfoV3) => void;
    onTraceTagsEdit?: (trace: ModelTraceInfoV3) => void;
  },
): ColumnDef<EvalTraceComparisonEntry> => {
  const baseColConfig: ColumnDef<EvalTraceComparisonEntry> = {
    header: col.label,
    id: col.id,
    accessorFn: (originalRow) => originalRow,
  };

  switch (col.type) {
    case TracesTableColumnType.INPUT:
      return {
        ...baseColConfig,
        sortingFn: (a, b) => {
          const aValue = a.getValue(col.id) as EvalTraceComparisonEntry;
          const bValue = b.getValue(col.id) as EvalTraceComparisonEntry;
          const aSortValue = {
            request: aValue.currentRunValue?.inputs[col.id] || aValue.otherRunValue?.inputs[col.id] || '',
            evalId: aValue.currentRunValue?.evaluationId || aValue.otherRunValue?.evaluationId || '',
          };
          const bSortValue = {
            request: bValue.currentRunValue?.inputs[col.id] || bValue.otherRunValue?.inputs[col.id] || '',
            evalId: bValue.currentRunValue?.evaluationId || bValue.otherRunValue?.evaluationId || '',
          };

          return JSON.stringify(aSortValue).localeCompare(JSON.stringify(bSortValue));
        },
        size: DEFAULT_INPUT_COLUMNS_TOTAL_WIDTH_PX / evaluationInputs.length,
        minSize: 120,
        cell: (cell) =>
          inputColumnCellRenderer(
            onChangeEvaluationId,
            cell,
            isComparing,
            theme,
            col.id,
            (cell?.table?.options?.meta as any)?.getRunColor,
          ),
      };
    case TracesTableColumnType.ASSESSMENT:
      return {
        ...baseColConfig,
        accessorFn: (originalRow) => {
          return { isComparing, assessmentInfo: col.assessmentInfo, comparisonEntry: originalRow };
        },
        sortingFn: (a, b) => {
          const { comparisonEntry: aValue } = a.getValue(col.id) as {
            comparisonEntry: EvalTraceComparisonEntry;
          };
          const { comparisonEntry: bValue } = b.getValue(col.id) as {
            comparisonEntry: EvalTraceComparisonEntry;
          };
          if (col.assessmentInfo) {
            const aAssessment = {
              currentValue: aValue.currentRunValue?.responseAssessmentsByName[col.assessmentInfo.name]?.[0],
              otherValue: aValue.otherRunValue?.responseAssessmentsByName[col.assessmentInfo.name]?.[0],
            };
            const bAssessment = {
              currentValue: bValue.currentRunValue?.responseAssessmentsByName[col.assessmentInfo.name]?.[0],
              otherValue: bValue.otherRunValue?.responseAssessmentsByName[col.assessmentInfo.name]?.[0],
            };
            return sortCompareAssessments(col.assessmentInfo, aAssessment, bAssessment);
          }
          return 0;
        },
        maxSize: MAX_ASSESSMENT_COLUMN_SIZE,
        size: isComparing ? DEFAULT_ASSESSMENTS_CELL_WIDTH_COMPARE_PX : DEFAULT_ASSESSMENT_CELL_WIDTH_PX,
        minSize: isComparing ? DEFAULT_ASSESSMENTS_CELL_WIDTH_COMPARE_PX : DEFAULT_ASSESSMENT_CELL_WIDTH_PX,
        cell: (cell) => {
          const { isComparing, assessmentInfo, comparisonEntry } = cell.getValue() as {
            isComparing: boolean;
            assessmentInfo: AssessmentInfo;
            comparisonEntry: EvalTraceComparisonEntry;
          };
          return (
            <AssessmentCell
              isComparing={isComparing}
              assessmentInfo={assessmentInfo}
              comparisonEntry={comparisonEntry}
            />
          );
        },
      };
    case TracesTableColumnType.EXPECTATION:
      return {
        ...baseColConfig,
        accessorFn: (originalRow) => {
          return { isComparing, expectationName: col.expectationName, comparisonEntry: originalRow };
        },
        maxSize: MAX_ASSESSMENT_COLUMN_SIZE,
        size: isComparing ? DEFAULT_ASSESSMENTS_CELL_WIDTH_COMPARE_PX : DEFAULT_ASSESSMENT_CELL_WIDTH_PX,
        minSize: isComparing ? DEFAULT_ASSESSMENTS_CELL_WIDTH_COMPARE_PX : DEFAULT_ASSESSMENT_CELL_WIDTH_PX,
        cell: (cell) => {
          const { isComparing, expectationName, comparisonEntry } = cell.getValue() as {
            isComparing: boolean;
            expectationName: string;
            comparisonEntry: EvalTraceComparisonEntry;
          };
          return expectationCellRenderer(theme, intl, isComparing, expectationName, comparisonEntry);
        },
      };
    case TracesTableColumnType.TRACE_INFO:
      return {
        ...baseColConfig,
        accessorFn: (originalRow) => {
          return { isComparing, comparisonEntry: originalRow };
        },
        sortingFn: (a, b) => {
          const { comparisonEntry: aValue } = a.getValue(col.id) as {
            comparisonEntry: EvalTraceComparisonEntry;
          };
          const { comparisonEntry: bValue } = b.getValue(col.id) as {
            comparisonEntry: EvalTraceComparisonEntry;
          };

          return traceInfoSortingFn(aValue?.currentRunValue?.traceInfo, bValue?.currentRunValue?.traceInfo, col.id);
        },
        size: col.id === RESPONSE_COLUMN_ID ? 300 : 100,
        minSize: col.id === RESPONSE_COLUMN_ID ? 120 : 100,
        cell: (cell) => {
          const { isComparing, comparisonEntry } = cell.getValue() as {
            isComparing: boolean;
            comparisonEntry: EvalTraceComparisonEntry;
          };

          const { traceIdToTurnMap, searchQuery } = (cell.table?.options?.meta as any) ?? {};

          return traceInfoCellRenderer(
            isComparing,
            col.id,
            comparisonEntry,
            onChangeEvaluationId,
            intl,
            theme,
            experimentId,
            onTraceTagsEdit,
            traceIdToTurnMap,
            searchQuery,
          );
        },
      };
    case TracesTableColumnType.INTERNAL_MONITOR_REQUEST_TIME:
      return {
        ...baseColConfig,
        accessorFn: (originalRow) => originalRow.currentRunValue?.requestTime,
        sortingFn: (a, b) => {
          const aValue = a.getValue(col.id);
          const bValue = b.getValue(col.id);
          return JSON.stringify(aValue).localeCompare(JSON.stringify(bValue));
        },
        size: 100,
        minSize: 100,
        cell: (cell) => {
          const requestTime = cell.getValue() as string | undefined;
          if (!requestTime) {
            return null;
          }
          const date = new Date(requestTime);
          return (
            <Tooltip
              componentId="mlflow.experiment-evaluation-monitoring.trace-info-hover-request-time"
              content={date.toLocaleString(navigator.language, { timeZoneName: 'short' })}
            >
              <span>{timeSinceStr(date)}</span>
            </Tooltip>
          );
        },
      };
    default:
      return baseColConfig;
  }
};

export function sortCompareAssessments(
  assessmentInfo: AssessmentInfo,
  a: {
    currentValue?: RunEvaluationResultAssessment;
    otherValue?: RunEvaluationResultAssessment;
  },
  b: {
    currentValue?: RunEvaluationResultAssessment;
    otherValue?: RunEvaluationResultAssessment;
  },
) {
  const aCurrentValue = a.currentValue ? getEvaluationResultAssessmentValue(a.currentValue) : undefined;
  const bCurrentValue = b.currentValue ? getEvaluationResultAssessmentValue(b.currentValue) : undefined;
  const aOtherValue = a.otherValue ? getEvaluationResultAssessmentValue(a.otherValue) : undefined;
  const bOtherValue = b.otherValue ? getEvaluationResultAssessmentValue(b.otherValue) : undefined;

  if (assessmentInfo.dtype === 'pass-fail') {
    // Priorities:
    // Pass => Fail
    // Fail
    // Fail => Pass
    // Pass
    const aIsPassToFail =
      aOtherValue === KnownEvaluationResultAssessmentStringValue.YES &&
      aCurrentValue === KnownEvaluationResultAssessmentStringValue.NO;
    const bIsPassToFail =
      bOtherValue === KnownEvaluationResultAssessmentStringValue.YES &&
      bCurrentValue === KnownEvaluationResultAssessmentStringValue.NO;
    const aIsFailToPass =
      aOtherValue === KnownEvaluationResultAssessmentStringValue.NO &&
      aCurrentValue === KnownEvaluationResultAssessmentStringValue.YES;
    const bIsFailToPass =
      bOtherValue === KnownEvaluationResultAssessmentStringValue.NO &&
      bCurrentValue === KnownEvaluationResultAssessmentStringValue.YES;
    const aIsFailToFail =
      aOtherValue === KnownEvaluationResultAssessmentStringValue.NO &&
      aCurrentValue === KnownEvaluationResultAssessmentStringValue.NO;
    const bIsFailToFail =
      bOtherValue === KnownEvaluationResultAssessmentStringValue.NO &&
      bCurrentValue === KnownEvaluationResultAssessmentStringValue.NO;
    const aIsPassToPass =
      aOtherValue === KnownEvaluationResultAssessmentStringValue.YES &&
      aCurrentValue === KnownEvaluationResultAssessmentStringValue.YES;
    const bIsPassToPass =
      bOtherValue === KnownEvaluationResultAssessmentStringValue.YES &&
      bCurrentValue === KnownEvaluationResultAssessmentStringValue.YES;

    // Sort according to priority
    if (aIsPassToFail && !bIsPassToFail) return -1;
    if (!aIsPassToFail && bIsPassToFail) return 1;

    if (aIsFailToFail && !bIsFailToFail) return -1;
    if (!aIsFailToFail && bIsFailToFail) return 1;

    if (aIsFailToPass && !bIsFailToPass) return -1;
    if (!aIsFailToPass && bIsFailToPass) return 1;

    if (aIsPassToPass && !bIsPassToPass) return -1;
    if (!aIsPassToPass && bIsPassToPass) return 1;

    return sortPassFailAssessments(a.currentValue, b.currentValue);
  } else {
    if (aCurrentValue === bCurrentValue) {
      return 0;
    }
    if (!isNil(aCurrentValue) && !isNil(bCurrentValue)) {
      return aCurrentValue > bCurrentValue ? 1 : -1;
    } else {
      return isNil(aCurrentValue) ? -1 : 1;
    }
  }
}

function sortPassFailAssessments(a?: RunEvaluationResultAssessment, b?: RunEvaluationResultAssessment) {
  if (!a && b) {
    return 1;
  } else if (a && !b) {
    return -1;
  }
  if (!a || !b) {
    return 0;
  }

  const aIsPassing =
    a.stringValue === KnownEvaluationResultAssessmentStringValue.YES
      ? true
      : a.stringValue === KnownEvaluationResultAssessmentStringValue.NO
        ? false
        : undefined;
  const bIsPassing =
    b.stringValue === KnownEvaluationResultAssessmentStringValue.YES
      ? true
      : b.stringValue === KnownEvaluationResultAssessmentStringValue.NO
        ? false
        : undefined;

  if (aIsPassing === bIsPassing) {
    return 0;
  }
  // Null values get sorted last.
  if (aIsPassing === undefined) {
    return 1;
  }
  if (bIsPassing === undefined) {
    return -1;
  }
  return aIsPassing ? 1 : -1;
}
