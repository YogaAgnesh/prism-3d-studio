export function createWorkbookWorkerClient(WorkerClass = globalThis.Worker, options = {}) {
  if (typeof WorkerClass !== 'function' || typeof __PRISM_WORKER_SOURCE__ !== 'string') return null;
  const url = URL.createObjectURL(new Blob([__PRISM_WORKER_SOURCE__], { type: 'text/javascript' }));
  const worker = new WorkerClass(url);
  const pending = new Map();
  let sequence = 0;
  let disposed = false;
  const close = (message) => {
    if (disposed) return;
    disposed = true;
    worker.terminate();
    URL.revokeObjectURL(url);
    for (const request of pending.values()) { clearTimeout(request.timer); request.reject(new Error(message)); }
    pending.clear();
  };

  worker.onmessage = ({ data }) => {
    const request = pending.get(data?.requestId);
    if (!request) return;
    pending.delete(data.requestId);
    clearTimeout(request.timer);
    if (data.ok) request.resolve(data); else request.reject(new Error(data.error));
  };
  worker.onerror = (event) => {
    close(event?.message ?? 'The data worker stopped unexpectedly. Reload the source to recover.');
  };
  worker.onmessageerror = () => close('The data worker response could not be read. Reload the source to recover.');

  const request = (message, transfer = []) => {
    if (disposed) return Promise.reject(new Error('The workbook worker is closed.'));
    const requestId = ++sequence;
    return new Promise((resolve, reject) => {
      const timeout = message.type === 'load' || message.type === 'sheet' ? options.importTimeout ?? 60_000 : options.queryTimeout ?? 30_000;
      const timer = setTimeout(() => close('Data processing timed out. Reload the source, reduce its size, or check its structure.'), timeout);
      pending.set(requestId, { resolve, reject, timer });
      try { worker.postMessage({ ...message, requestId }, transfer); }
      catch (error) { clearTimeout(timer); pending.delete(requestId); reject(error); }
    });
  };

  return {
    get closed() { return disposed; },
    load(bytes, fileName, options = {}, sheetName) { return request({ type: 'load', bytes, fileName, options, sheetName }, [bytes]); },
    sheet(sheetName, options = {}) { return request({ type: 'sheet', sheetName, options }); },
    count(filters) { return request({ type: 'count', filters }); },
    query(input) { return request({ type: 'query', ...input }); },
    override(fieldId, semanticType) { return request({ type: 'override', override: { fieldId, semanticType } }); },
    previewOverride(fieldId, semanticType) { return request({ type: 'previewOverride', fieldId, semanticType }); },
    resetOverride(fieldId) { return request({ type: 'resetOverride', fieldId }); },
    calculation(definition) { return request({ type: 'calculation', definition }); },
    applyProject(overrides, calculations) { return request({ type: 'applyProject', overrides, calculations }); },
    dispose() {
      close('The data request was cancelled.');
    },
  };
}
