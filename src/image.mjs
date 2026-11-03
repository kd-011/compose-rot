// Image references: `[registry/]path[:tag][@digest]`, normalised the way Docker does it.

const HUB = new Set(['docker.io', 'index.docker.io', 'registry-1.docker.io', 'registry.hub.docker.com']);
const COMPONENT = /^[a-z0-9]+(?:(?:[._]|__|-+)[a-z0-9]+)*$/;
const TAG = /^[\w][\w.-]{0,127}$/;
const DIGEST = /^[A-Za-z][A-Za-z0-9+.-]*:[0-9a-fA-F]{32,}$/;

/**
 * Returns { raw, registry, namespace, repo, path, tag, digest, canonical } or null when
 * the text is not a valid reference. Docker Hub is always `docker.io`, and a bare name
 * lives in `library`.
 */
export function parseImage(raw) {
  if (typeof raw !== 'string') return null;
  let s = raw.trim();
  if (!s || /\s/.test(s)) return null;

  let digest = null;
  const at = s.indexOf('@');
  if (at >= 0) {
    digest = s.slice(at + 1);
    s = s.slice(0, at);
    if (!DIGEST.test(digest)) return null;
  }

  let tag = null;
  const colon = s.indexOf(':', s.lastIndexOf('/') + 1);
  if (colon >= 0) {
    tag = s.slice(colon + 1);
    s = s.slice(0, colon);
    if (!TAG.test(tag)) return null;
  }
  if (!s) return null;

  const parts = s.split('/');
  if (parts.some((p) => !p)) return null;
  let registry = 'docker.io';
  if (parts.length > 1 && (parts[0].includes('.') || parts[0].includes(':') || parts[0] === 'localhost')) {
    registry = parts.shift().toLowerCase();
    if (HUB.has(registry)) registry = 'docker.io';
  }
  const lower = parts.map((p) => p.toLowerCase());
  if (!lower.every((p) => COMPONENT.test(p))) return null;
  if (registry === 'docker.io' && lower.length === 1) lower.unshift('library');

  const repo = lower[lower.length - 1];
  const namespace = lower.slice(0, -1).join('/');
  const path = namespace ? `${namespace}/${repo}` : repo;
  return { raw, registry, namespace, repo, path, tag, digest, canonical: `${registry}/${path}` };
}
