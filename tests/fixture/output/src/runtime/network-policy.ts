import offlineRoutes from "./offline-routes";

const nativeFetch = globalThis.fetch.bind(globalThis);
const localOrigin = globalThis.location.origin;

function requestUrl(input: RequestInfo | URL) {
  if (input instanceof Request) return new URL(input.url);
  return new URL(String(input), globalThis.location.href);
}

function offlinePath(url: URL) {
  return "/__offline__/" + url.host + url.pathname + url.search;
}

function offlineResponse(url: URL, input: RequestInfo | URL, init?: RequestInit) {
  const method = String(init?.method || (input instanceof Request ? input.method : "GET")).toUpperCase();
  const rule = offlineRoutes.find((candidate) => {
    const methods = candidate.methods || ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];
    const matchesPath = candidate.prefix ? url.pathname.startsWith(candidate.prefix) : url.pathname === candidate.match;
    return matchesPath && methods.includes(method);
  });
  const status = rule?.status ?? 503;
  const body = rule?.json ?? { ok: false, offline: true, error: "External service removed from this local clone." };
  const responseBody = [204, 205, 304].includes(status) ? null : JSON.stringify(body);
  return Promise.resolve(new Response(responseBody, {
    status,
    headers: { "content-type": "application/json", ...(rule?.headers || {}) },
  }));
}

globalThis.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
  const url = requestUrl(input);
  if (url.origin !== localOrigin) {
    return offlineResponse(new URL(offlinePath(url), localOrigin), input, init);
  }
  if (url.pathname.startsWith("/__offline__/")) return offlineResponse(url, input, init);
  return nativeFetch(input, init);
};

if (globalThis.navigator?.sendBeacon) {
  const nativeBeacon = globalThis.navigator.sendBeacon.bind(globalThis.navigator);
  globalThis.navigator.sendBeacon = (input, data) => {
    const url = requestUrl(input);
    if (url.origin !== localOrigin || url.pathname.startsWith("/__offline__/")) return false;
    return nativeBeacon(input, data);
  };
}

Object.assign(globalThis, {
  __HTTRACK_NETWORK_POLICY__: Object.freeze({ localOrigin, offlinePrefix: "/__offline__/" }),
});
