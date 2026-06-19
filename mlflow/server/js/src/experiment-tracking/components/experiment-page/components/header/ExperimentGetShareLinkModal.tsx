import { useCallback, useEffect, useMemo, useState } from 'react';
import { FormattedMessage } from 'react-intl';
import { GenericSkeleton, Input, Modal } from '@databricks/design-system';
import { omit } from 'lodash';
import Routes from '../../../../routes';
import { CopyButton } from '../../../../../shared/building_blocks/CopyButton';
import type { ExperimentPageSearchFacetsState } from '../../models/ExperimentPageSearchFacetsState';
import { createExperimentPageSearchFacetsState } from '../../models/ExperimentPageSearchFacetsState';
import type { ExperimentPageUIState } from '../../models/ExperimentPageUIState';
import { createExperimentPageUIState } from '../../models/ExperimentPageUIState';
import { textCompressDeflate } from '../../../../../common/utils/StringUtils';
import Utils from '../../../../../common/utils/Utils';
import { EXPERIMENT_PAGE_VIEW_STATE_SHARE_URL_PARAM_KEY, ExperimentPageTabName } from '../../../../constants';
import { shouldUseCompressedExperimentViewSharedState } from '../../../../../common/utils/FeatureUtils';
import {
  EXPERIMENT_PAGE_VIEW_MODE_QUERY_PARAM_KEY,
  useExperimentPageViewMode,
} from '../../hooks/useExperimentPageViewMode';
import type { ExperimentViewRunsCompareMode } from '../../../../types';
import { loadExperimentViewState } from '../../utils/persistSearchFacets';

type GetShareLinkModalProps = {
  onCancel: () => void;
  visible: boolean;
  experimentIds: string[];
  searchFacetsState?: ExperimentPageSearchFacetsState;
  uiState?: ExperimentPageUIState;
};

type ShareableViewState = ExperimentPageSearchFacetsState & ExperimentPageUIState;

// Typescript-based test to ensure that the keys of the two states are disjoint.
// If they are not disjoint, the state serialization will not work as expected.
const _arePersistedStatesDisjoint: [
  keyof ExperimentPageSearchFacetsState & keyof ExperimentPageUIState extends never ? true : false,
] = [true];

/**
 * UI-state fields excluded from a shared link: per-run state keyed by run UUIDs
 * that won't exist for the recipient, plus personal/ephemeral preferences.
 */
const NON_SHAREABLE_UI_STATE_FIELDS = [
  'runsExpanded',
  'runsPinned',
  'runsHidden',
  'runsVisibilityMap',
  'autoRefreshEnabled',
] as const;

// Guard against pathologically long URLs (charts are the main size driver).
// Browsers and proxies start truncating well above this, so fall back gracefully.
const MAX_SHARE_URL_LENGTH = 8000;

const serializePersistedState = async (state: ShareableViewState) => {
  const shareableState = omit(state, NON_SHAREABLE_UI_STATE_FIELDS);
  const serialized = JSON.stringify(shareableState);
  if (shouldUseCompressedExperimentViewSharedState()) {
    return textCompressDeflate(serialized);
  }
  return serialized;
};

const getShareableUrl = (experimentId: string, shareState: string, viewMode?: ExperimentViewRunsCompareMode) => {
  // The shared view state is consumed by the runs view, so the link must land on
  // the runs tab; the bare experiment route redirects to Overview and drops the param.
  const route = Routes.getExperimentPageTabRoute(experimentId, ExperimentPageTabName.Runs);

  // Begin building the query params
  const queryParams = new URLSearchParams();

  // Embed the serialized view state directly in the URL so the link is self-contained
  queryParams.set(EXPERIMENT_PAGE_VIEW_STATE_SHARE_URL_PARAM_KEY, shareState);

  // If the view mode is set, add it to the query params
  if (viewMode) {
    queryParams.set(EXPERIMENT_PAGE_VIEW_MODE_QUERY_PARAM_KEY, viewMode);
  }

  // In regular implementation, build the hash part of the URL
  const params = queryParams.toString();
  const hashParam = `${route}${params?.startsWith('?') ? '' : '?'}${params}`;
  const shareURL = `${window.location.origin}${window.location.pathname}#${hashParam}`;
  return shareURL;
};

/**
 * Modal that displays a shareable link for the experiment page. The current view
 * (search facets + UI state) is serialized, compressed and embedded directly in the
 * URL, so the link reproduces the view without writing anything to the backend.
 */
export const ExperimentGetShareLinkModal = ({
  onCancel,
  visible,
  experimentIds,
  searchFacetsState,
  uiState,
}: GetShareLinkModalProps) => {
  const [sharedStateUrl, setSharedStateUrl] = useState<string>('');
  const [linkInProgress, setLinkInProgress] = useState(true);
  const [viewMode] = useExperimentPageViewMode();

  const persistKey = useMemo(() => JSON.stringify([...experimentIds].sort()), [experimentIds]);

  // When the live search facets / UI state are passed in (classic experiment view),
  // serialize those directly. The modern tabbed page doesn't plumb them into the
  // header, so read the snapshot persisted in local storage instead.
  const liveState = useMemo<ShareableViewState | null>(
    () => (searchFacetsState && uiState ? { ...searchFacetsState, ...uiState } : null),
    [searchFacetsState, uiState],
  );

  const createShareableUrl = useCallback(async () => {
    // Read the current view at generation time so changes made after the modal
    // mounted (e.g. resizing a column, then clicking Share) are reflected.
    const state =
      liveState ??
      ({
        ...createExperimentPageSearchFacetsState(),
        ...createExperimentPageUIState(),
        ...loadExperimentViewState(persistKey),
      } as ShareableViewState);

    // Multiple experiments don't map to a single self-contained route; copy the
    // current URL (its search facets already round-trip through query params).
    if (experimentIds.length !== 1) {
      setSharedStateUrl(window.location.href);
      setLinkInProgress(false);
      return;
    }
    setLinkInProgress(true);
    const [experimentId] = experimentIds;
    try {
      const data = await serializePersistedState(state);
      const url = getShareableUrl(experimentId, data, viewMode);

      // If the encoded view overflows the URL budget, fall back to the plain URL
      // (search facets still ride along; only the heavier UI state is dropped).
      setSharedStateUrl(url.length > MAX_SHARE_URL_LENGTH ? window.location.href : url);
      setLinkInProgress(false);
    } catch (e) {
      Utils.logErrorAndNotifyUser('Failed to create shareable link for experiment');
      throw e;
    }
  }, [liveState, persistKey, experimentIds, viewMode]);

  useEffect(() => {
    if (!visible) {
      return;
    }
    createShareableUrl();
  }, [visible, createShareableUrl]);

  return (
    <Modal
      componentId="codegen_mlflow_app_src_experiment-tracking_components_experiment-page_components_header_experimentgetsharelinkmodal.tsx_101"
      title={
        <FormattedMessage
          defaultMessage="Get shareable link"
          description='Title text for the experiment "Get link" modal'
        />
      }
      visible={visible}
      onCancel={onCancel}
    >
      <div css={{ display: 'flex', gap: 8 }}>
        {linkInProgress ? (
          <GenericSkeleton css={{ flex: 1 }} />
        ) : (
          <Input
            componentId="codegen_mlflow_app_src_experiment-tracking_components_experiment-page_components_header_experimentgetsharelinkmodal.tsx_115"
            placeholder="Click button on the right to create shareable state"
            value={sharedStateUrl}
            readOnly
          />
        )}
        <CopyButton loading={linkInProgress} copyText={sharedStateUrl} data-testid="share-link-copy-button" />
      </div>
    </Modal>
  );
};
