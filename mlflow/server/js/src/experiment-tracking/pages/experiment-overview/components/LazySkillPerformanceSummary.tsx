import React from 'react';
import { OverviewChartLoadingState } from './OverviewChartComponents';

const SkillPerformanceSummary = React.lazy(() =>
  import('./SkillPerformanceSummary').then((module) => ({ default: module.SkillPerformanceSummary })),
);

export const LazySkillPerformanceSummary: React.FC = () => (
  <React.Suspense fallback={<OverviewChartLoadingState />}>
    <SkillPerformanceSummary />
  </React.Suspense>
);
