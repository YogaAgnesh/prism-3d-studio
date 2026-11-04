const SEVERITY = Object.freeze({ suggestion: 0, important: 1, blocker: 2 });

function issue(severity, code, message, action, actionLabel) {
  return { severity, code, message, action, actionLabel };
}

function missingAxes(spec) {
  if (!spec) return [];
  const scene = spec.layout?.scene ?? {};
  return ['x', 'y', 'z'].filter((axis) => {
    const config = scene[`${axis}axis`];
    return config?.visible === false || !String(config?.title?.text ?? '').trim();
  });
}

export function assessChartHealth({ contract, diagnostics = {}, spec } = {}) {
  if (!contract || diagnostics.mappingValid === false || Object.keys(diagnostics).length === 0) {
    return { status: 'building', label: 'Building', publishable: false, issues: [] };
  }

  const issues = [];
  if (diagnostics.binned) issues.push(issue('suggestion','binned-coordinates','Continuous coordinates are grouped into equal-width bins; heights represent aggregate values.','inspectSurfaceGrid','Review surface bins'));
  const includedRows = diagnostics.filteredRows ?? diagnostics.validRows;
  if ((diagnostics.sourceRows ?? 0) > 0 && includedRows === 0) {
    issues.push(issue('blocker', 'empty-result', 'The active filters or mappings exclude every valid row.', 'clearFilters', 'Clear filters'));
  }
  const rendered = diagnostics.renderedPoints ?? diagnostics.groups ?? 0;
  if (contract?.budgets?.maxMarks && rendered > contract.budgets.maxMarks) {
    issues.push(issue('important', 'mark-budget', `${rendered.toLocaleString()} marks exceed the readable budget.`, 'enableSampling', 'Optimize density'));
  }
  if ((diagnostics.excludedRows ?? 0) > 0 && (diagnostics.sourceRows ?? 0) > 0) {
    issues.push(issue('suggestion', 'excluded-rows', `${diagnostics.excludedRows.toLocaleString()} rows were excluded because required values were blank or invalid.`, 'inspectData', 'Inspect rows'));
  }
  if ((diagnostics.omittedGroups ?? 0) > 0) {
    issues.push(issue('important', 'top-n', `${diagnostics.omittedGroups.toLocaleString()} lower-ranked groups are hidden by the readability limit.`, 'inspectTransformation', 'Review Top N'));
  }
  if ((diagnostics.sampledOutRows ?? 0) > 0) {
    issues.push(issue('suggestion', 'sampled-rows', `${diagnostics.sampledOutRows.toLocaleString()} valid observations are not drawn; a deterministic sample is shown.`, 'inspectTransformation', 'Review sampling'));
  }
  if ((diagnostics.duplicateOrderValues ?? 0) > 0) {
    issues.push(issue('important', 'duplicate-order', `${diagnostics.duplicateOrderValues.toLocaleString()} sequence positions are duplicated within a trajectory.`, 'sortTrajectory', 'Review line order'));
  }
  if ((diagnostics.invalidOrderValues ?? 0) > 0) {
    issues.push(issue('important', 'invalid-order', `${diagnostics.invalidOrderValues.toLocaleString()} records have no valid sequence position.`, 'inspectLineOrder', 'Inspect order values'));
  }
  if ((diagnostics.gapCount ?? 0) > 0) {
    issues.push(issue('suggestion', 'line-gaps', `${diagnostics.gapCount.toLocaleString()} trajectory positions contain coordinate gaps.`, 'inspectLineGaps', 'Inspect gaps'));
  }
  if (diagnostics.interpolated) {
    issues.push(issue('important', 'surface-interpolation', 'The surface connects missing cells, which may imply values that were not observed.', 'preserveSurfaceGaps', 'Preserve missing cells'));
  } else if ((diagnostics.missingCells ?? 0) > 0) {
    issues.push(issue('suggestion', 'surface-gaps', `${diagnostics.missingCells.toLocaleString()} surface cells are missing and remain visible as gaps.`, 'inspectSurfaceGrid', 'Inspect grid'));
  }
  if ((diagnostics.gridCells ?? 0) > 4 && Number.isFinite(diagnostics.gridDensity) && diagnostics.gridDensity < 0.5) {
    issues.push(issue('important', 'sparse-surface', 'Fewer than half of the surface grid cells contain observed values.', 'inspectSurfaceGrid', 'Review surface grid'));
  }
  const axes = missingAxes(spec);
  if (axes.length) {
    issues.push(issue('important', 'missing-axis-title', `${axes.map((axis) => axis.toUpperCase()).join(', ')} axis titles must be visible before presentation.`, 'formatAxes', 'Format axes'));
  }

  const highest = issues.reduce((current, currentIssue) => Math.max(current, SEVERITY[currentIssue.severity]), -1);
  const status = highest >= SEVERITY.important ? 'needs-attention' : 'presentation-ready';
  return {
    status,
    label: status === 'presentation-ready' ? 'Presentation ready' : 'Needs attention',
    publishable: status === 'presentation-ready',
    issues,
  };
}
