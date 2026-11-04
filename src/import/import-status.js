const clampProgress = (value, maximum = 99) => Math.max(0, Math.min(maximum, Math.round(Number(value) || 0)));

export function createImportState(overrides = {}) {
  return {
    status: 'idle', busy: false, fileName: '', progress: 0,
    message: 'Choose an Excel or CSV file', error: '', ...overrides,
  };
}

export function startImport(state, fileName) {
  return {
    ...createImportState(state), status: 'loading', busy: true,
    fileName: String(fileName ?? '').trim(), progress: 8,
    message: 'Reading file securely on this device', error: '',
  };
}

export function advanceImport(state, message, progress) {
  const current = createImportState(state);
  return {
    ...current, status: 'loading', busy: true,
    progress: Math.max(current.progress, clampProgress(progress)),
    message: String(message ?? current.message).trim() || current.message,
    error: '',
  };
}

export function completeImport(state, { rows = 0, fields = 0 } = {}) {
  const current = createImportState(state);
  return {
    ...current, status: 'ready', busy: false, progress: 100,
    message: `${Number(rows).toLocaleString()} rows · ${Number(fields).toLocaleString()} fields ready`, error: '',
  };
}

export function failImport(state, error) {
  const current = createImportState(state);
  return {
    ...current, status: 'error', busy: false, progress: 0,
    message: 'Could not read this spreadsheet · try another file',
    error: String(error ?? 'Unknown import error'),
  };
}
