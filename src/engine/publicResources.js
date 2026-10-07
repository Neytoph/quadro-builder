import manifest from 'virtual:public-resources';

export const ENGINE_VERSION = manifest.engineVersion;
export function resourceVersion(path) { return manifest.resources[path]?.hash || null; }
export function publicResourceUrl(path) {
  return `${import.meta.env.BASE_URL}${manifest.resources[path]?.url || path}`;
}

/** 仅重写本机明确列入公共清单的资源，个人接口和外部URL保持原契约。 */
export function versionPublicSource(source) {
  const url = new URL(source, location.href);
  const base = new URL(import.meta.env.BASE_URL, location.href);
  if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname)) return source;
  const path = url.pathname.slice(base.pathname.length);
  return manifest.resources[path] ? publicResourceUrl(path) : source;
}
