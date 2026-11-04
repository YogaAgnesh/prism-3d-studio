const offlineError = () => new Error('Network access is disabled: Prism is an offline-only application.');

export function installNetworkGuard(target = globalThis, { allowSameOriginPublishing = false } = {}) {
  const original = {
    fetch: target.fetch,
    WebSocket: target.WebSocket,
    XMLHttpRequest: target.XMLHttpRequest,
    EventSource: target.EventSource,
    sendBeacon: target.navigator?.sendBeacon,
  };

  target.fetch = async (input, init) => {
    if (allowSameOriginPublishing && original.fetch) {
      const base = target.location?.origin ?? 'http://localhost';
      const url = new URL(typeof input === 'string' ? input : input?.url, base);
      if (url.origin === base && url.pathname.startsWith('/api/briefings')) return original.fetch.call(target, input, init);
    }
    throw offlineError();
  };
  target.WebSocket = class OfflineWebSocket { constructor() { throw offlineError(); } };
  target.XMLHttpRequest = class OfflineXMLHttpRequest { constructor() { throw offlineError(); } };
  target.EventSource = class OfflineEventSource { constructor() { throw offlineError(); } };
  if (target.navigator) Object.defineProperty(target.navigator, 'sendBeacon', { configurable: true, value: () => { throw offlineError(); } });

  return () => {
    target.fetch = original.fetch;
    target.WebSocket = original.WebSocket;
    target.XMLHttpRequest = original.XMLHttpRequest;
    target.EventSource = original.EventSource;
    if (target.navigator) Object.defineProperty(target.navigator, 'sendBeacon', { configurable: true, value: original.sendBeacon });
  };
}
