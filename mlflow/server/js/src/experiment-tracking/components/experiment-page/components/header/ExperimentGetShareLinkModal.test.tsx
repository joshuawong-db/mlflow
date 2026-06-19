import { jest, describe, beforeAll, afterAll, test, expect } from '@jest/globals';
import { omit } from 'lodash';
import type { ExperimentPageSearchFacetsState } from '../../models/ExperimentPageSearchFacetsState';
import { createExperimentPageSearchFacetsState } from '../../models/ExperimentPageSearchFacetsState';
import type { ExperimentPageUIState } from '../../models/ExperimentPageUIState';
import { createExperimentPageUIState } from '../../models/ExperimentPageUIState';
import { ExperimentGetShareLinkModal } from './ExperimentGetShareLinkModal';
import { MockedReduxStoreProvider } from '../../../../../common/utils/TestUtils';
import { render, screen, waitFor } from '@mlflow/mlflow/src/common/utils/TestUtils.react18';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { setExperimentTagApi } from '../../../../actions';
import { shouldUseCompressedExperimentViewSharedState } from '../../../../../common/utils/FeatureUtils';
import { isTextCompressedDeflate, textDecompressDeflate } from '../../../../../common/utils/StringUtils';
import { IntlProvider } from 'react-intl';
import { setupTestRouter, testRoute, TestRouter } from '../../../../../common/utils/RoutingTestUtils';
import { DesignSystemProvider } from '@databricks/design-system';

jest.mock('../../../../../common/utils/FeatureUtils', () => ({
  ...jest.requireActual<typeof import('../../../../../common/utils/FeatureUtils')>(
    '../../../../../common/utils/FeatureUtils',
  ),
  shouldUseCompressedExperimentViewSharedState: jest.fn(),
}));

jest.mock('../../../../actions', () => ({
  ...jest.requireActual<typeof import('../../../../actions')>('../../../../actions'),
  setExperimentTagApi: jest.fn(() => ({ type: 'SET_EXPERIMENT_TAG_API', payload: Promise.resolve() })),
}));

const experimentIds = ['experiment-1'];

// Per-run / personal UI-state fields that must not be embedded in a shared link.
const NON_SHAREABLE_UI_STATE_FIELDS = [
  'runsExpanded',
  'runsPinned',
  'runsHidden',
  'runsVisibilityMap',
  'autoRefreshEnabled',
];

// Extract and decode the viewStateShareKey blob from a copied share URL.
const decodeShareUrl = async (shareUrl: string) => {
  const hash = shareUrl.slice(shareUrl.indexOf('#') + 1);
  const query = hash.slice(hash.indexOf('?') + 1);
  const shareState = new URLSearchParams(query).get('viewStateShareKey') ?? '';
  const json = isTextCompressedDeflate(shareState) ? await textDecompressDeflate(shareState) : shareState;
  return JSON.parse(json);
};

describe('ExperimentGetShareLinkModal', () => {
  const onCancel = jest.fn();
  const { history } = setupTestRouter();

  let navigatorClipboard: Clipboard;
  let copiedText = '';

  beforeAll(() => {
    navigatorClipboard = navigator.clipboard;
    // @ts-expect-error: navigator is overridable in tests
    navigator.clipboard = {
      writeText: jest.fn((text: string) => {
        copiedText = text;
        return Promise.resolve();
      }),
    };
  });

  afterAll(() => {
    jest.restoreAllMocks();
    // @ts-expect-error: navigator is overridable in tests
    navigator.clipboard = navigatorClipboard;
  });

  const renderExperimentGetShareLinkModal = (
    searchFacetsState = createExperimentPageSearchFacetsState(),
    uiState = createExperimentPageUIState(),
    initialUrl = '/',
  ) => {
    const Component = ({
      searchFacetsState,
      uiState,
    }: {
      searchFacetsState: ExperimentPageSearchFacetsState;
      uiState: ExperimentPageUIState;
    }) => {
      const [visible, setVisible] = useState(false);
      return (
        <IntlProvider locale="en">
          <DesignSystemProvider>
            <MockedReduxStoreProvider>
              <button onClick={() => setVisible(true)}>get link</button>
              <ExperimentGetShareLinkModal
                experimentIds={experimentIds}
                onCancel={onCancel}
                searchFacetsState={searchFacetsState}
                uiState={uiState}
                visible={visible}
              />
            </MockedReduxStoreProvider>
          </DesignSystemProvider>
        </IntlProvider>
      );
    };
    const { rerender } = render(<Component searchFacetsState={searchFacetsState} uiState={uiState} />, {
      wrapper: ({ children }) => (
        <TestRouter routes={[testRoute(<>{children}</>, '/')]} history={history} initialEntries={[initialUrl]} />
      ),
    });
    return {
      rerender: (
        searchFacetsState = createExperimentPageSearchFacetsState(),
        uiState = createExperimentPageUIState(),
      ) => rerender(<Component searchFacetsState={searchFacetsState} uiState={uiState} />),
    };
  };

  test.each([true, false])(
    'embeds the serialized view state directly in the share URL when compression enabled: %s',
    async (isCompressionEnabled) => {
      jest.mocked(shouldUseCompressedExperimentViewSharedState).mockImplementation(() => isCompressionEnabled);

      // Initial facets and UI state
      const initialSearchState = { ...createExperimentPageSearchFacetsState(), searchFilter: 'metrics.m1 = 2' };
      const initialUIState = { ...createExperimentPageUIState(), viewMaximized: true };

      // Render the modal and open it
      renderExperimentGetShareLinkModal(initialSearchState, initialUIState);
      await waitFor(() => expect(screen.getByText('get link')).toBeInTheDocument());
      await userEvent.click(screen.getByText('get link'));

      // Wait for the link to be processed and copy button to be visible
      await waitFor(() => {
        expect(screen.getByTestId('share-link-copy-button')).toBeInTheDocument();
      });

      // Click the copy button and assert that the URL was copied to the clipboard
      await userEvent.click(screen.getByTestId('share-link-copy-button'));
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
        expect.stringMatching(/\/experiments\/experiment-1\/runs\?viewStateShareKey=/),
      );

      // No backend tag should be written for a self-contained link
      expect(setExperimentTagApi).not.toHaveBeenCalled();

      // The embedded blob should decode back to the shareable view state
      const decoded = await decodeShareUrl(copiedText);
      expect(decoded).toEqual(omit({ ...initialSearchState, ...initialUIState }, NON_SHAREABLE_UI_STATE_FIELDS));
    },
  );

  test('does not embed per-run or personal UI state in the shared link', async () => {
    jest.mocked(shouldUseCompressedExperimentViewSharedState).mockImplementation(() => true);

    const initialSearchState = createExperimentPageSearchFacetsState();
    const initialUIState = {
      ...createExperimentPageUIState(),
      runsPinned: ['run-a', 'run-b'],
      runsExpanded: { 'run-a': true },
      runsHidden: ['run-c'],
      autoRefreshEnabled: true,
    };

    renderExperimentGetShareLinkModal(initialSearchState, initialUIState);
    await waitFor(() => expect(screen.getByText('get link')).toBeInTheDocument());
    await userEvent.click(screen.getByText('get link'));

    await waitFor(() => {
      expect(screen.getByTestId('share-link-copy-button')).toBeInTheDocument();
    });
    await userEvent.click(screen.getByTestId('share-link-copy-button'));

    const decoded = await decodeShareUrl(copiedText);
    expect(decoded).not.toHaveProperty('runsPinned');
    expect(decoded).not.toHaveProperty('runsExpanded');
    expect(decoded).not.toHaveProperty('runsHidden');
    expect(decoded).not.toHaveProperty('runsVisibilityMap');
    expect(decoded).not.toHaveProperty('autoRefreshEnabled');
  });

  test('propagate experiment page view mode', async () => {
    jest.mocked(shouldUseCompressedExperimentViewSharedState).mockImplementation(() => true);
    const initialSearchState = { ...createExperimentPageSearchFacetsState(), searchFilter: 'metrics.m1 = 2' };
    const initialUIState = { ...createExperimentPageUIState(), viewMaximized: true };

    renderExperimentGetShareLinkModal(initialSearchState, initialUIState, '/?compareRunsMode=CHART');
    await waitFor(() => expect(screen.getByText('get link')).toBeInTheDocument());

    await userEvent.click(screen.getByText('get link'));

    // Expect shareable URL to contain the view mode query param
    await waitFor(() => expect(screen.getByRole<HTMLInputElement>('textbox').value).toContain('compareRunsMode=CHART'));
  });

  test('produces identical links for identical view state and distinct links otherwise', async () => {
    jest.mocked(shouldUseCompressedExperimentViewSharedState).mockImplementation(() => true);

    const initialSearchState = { ...createExperimentPageSearchFacetsState(), searchFilter: 'metrics.m1 = 2' };
    const initialUIState = { ...createExperimentPageUIState(), viewMaximized: true };

    const { rerender } = renderExperimentGetShareLinkModal(initialSearchState, initialUIState);

    await waitFor(() => expect(screen.getByText('get link')).toBeInTheDocument());
    await userEvent.click(screen.getByText('get link'));
    await waitFor(() => expect(screen.getByTestId('share-link-copy-button')).toBeInTheDocument());
    await userEvent.click(screen.getByTestId('share-link-copy-button'));
    const firstUrl = copiedText;

    // Update the view state and rerender; the link must change
    const updatedSearchState = { ...initialSearchState, searchFilter: 'metrics.m1 = 5' };
    const updatedUIState = { ...initialUIState, viewMaximized: false };
    rerender(updatedSearchState, updatedUIState);
    await waitFor(() => expect(screen.getByTestId('share-link-copy-button')).toBeInTheDocument());
    await userEvent.click(screen.getByTestId('share-link-copy-button'));
    const secondUrl = copiedText;
    expect(secondUrl).not.toEqual(firstUrl);

    // Revert to the initial view state (new object references); the link must match the first
    rerender({ ...updatedSearchState, searchFilter: 'metrics.m1 = 2' }, { ...updatedUIState, viewMaximized: true });
    await waitFor(() => expect(screen.getByTestId('share-link-copy-button')).toBeInTheDocument());
    await userEvent.click(screen.getByTestId('share-link-copy-button'));
    expect(copiedText).toEqual(firstUrl);
  });
});
