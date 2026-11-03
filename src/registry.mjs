// Find the upstream source repo of an image from its registry, with the anonymous token flow
// Docker Hub, ghcr.io and quay.io all use. Reads the OCI source annotation or label only.

const SOURCE = 'org.opencontainers.image.source';
const ACCEPT = [
  'application/vnd.oci.image.index.v1+json',
  'application/vnd.docker.distribution.manifest.list.v2+json',
  'application/vnd.oci.image.manifest.v1+json',
  'application/vnd.docker.distribution.manifest.v2+json',
].join(', ');

export function registryBase(registry, overrides = {}) {
  if (overrides[registry]) return overrides[registry].replace(/\/$/, '');
  if (registry === 'docker.io') return 'https://registry-1.docker.io';
  return `https://${registry}`;
}

/** owner/name from a source URL, lowercase, or { other: host } when it is not GitHub. */
export function githubSlug(url) {
  const m = /^(?:https?:\/\/|ssh:\/\/git@|git@)(?:www\.)?github\.com[/:]([^/\s]+)\/([^/\s#?]+?)(?:\.git)?(?:[/#?].*)?$/i.exec(String(url).trim());
  if (m) return { slug: `${m[1]}/${m[2]}`.toLowerCase() };
  const host = /^(?:https?:\/\/|ssh:\/\/git@|git@)([^/:\s]+)/i.exec(String(url).trim());
  return { other: host ? host[1].toLowerCase() : String(url).slice(0, 40) };
}

const RETRY_STATUS = new Set([429, 502, 503, 504]);
const realSleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function createRegistryClient({ registries = {}, userAgent = 'compose-rot', sleep = realSleep } = {}) {
  const tokens = new Map();

  // A slow link or a busy registry drops connections and answers 429. Two polite retries, then give up.
  async function fetchRetry(url, init) {
    for (let attempt = 0; ; attempt++) {
      let res;
      try {
        res = await fetch(url, { ...init, signal: AbortSignal.timeout(30_000) });
      } catch (e) {
        if (attempt >= 2) throw e;
        await sleep(1000 * (attempt + 1));
        continue;
      }
      if (!RETRY_STATUS.has(res.status) || attempt >= 2) return res;
      const wait = Number(res.headers.get('retry-after'));
      await sleep(Math.min(Number.isFinite(wait) && wait > 0 ? wait * 1000 : 1000 * (attempt + 1), 10_000));
    }
  }

  async function get(base, name, resource, ref, accept) {
    const url = `${base}/v2/${name}/${resource}/${ref}`;
    const key = `${base}|${name}`;
    const headers = { accept, 'user-agent': userAgent };
    if (tokens.has(key)) headers.authorization = `Bearer ${tokens.get(key)}`;
    let res = await fetchRetry(url, { headers });
    if (res.status === 401 && !tokens.has(key)) {
      const challenge = res.headers.get('www-authenticate') ?? '';
      const realm = /realm="([^"]+)"/.exec(challenge)?.[1];
      if (realm) {
        const service = /service="([^"]+)"/.exec(challenge)?.[1];
        const scope = /scope="([^"]+)"/.exec(challenge)?.[1] ?? `repository:${name}:pull`;
        const t = new URL(realm);
        if (service) t.searchParams.set('service', service);
        t.searchParams.set('scope', scope);
        const tr = await fetchRetry(t, { headers: { 'user-agent': userAgent } });
        if (tr.ok) {
          const body = await tr.json();
          const token = body.token ?? body.access_token;
          if (token) {
            tokens.set(key, token);
            res = await fetchRetry(url, { headers: { ...headers, authorization: `Bearer ${token}` } });
          }
        }
      }
    }
    return res;
  }

  /**
   * -> { source, via } when the image names its source repo, else { unknown: reason }.
   * via is 'oci-annotation' (on the index or manifest) or 'oci-label' (in the image config).
   */
  async function source(ref) {
    const base = registryBase(ref.registry, registries);
    const name = ref.path;
    const where = ref.digest ?? ref.tag ?? 'latest';
    try {
      let res = await get(base, name, 'manifests', where, ACCEPT);
      if (!res.ok) return { unknown: `registry answered ${res.status} for ${ref.canonical}:${where}` };
      let doc = await res.json();
      const index = doc;
      if (Array.isArray(doc.manifests)) {
        const pick = doc.manifests.find((m) => m.platform?.os === 'linux' && m.platform?.architecture === 'amd64')
          ?? doc.manifests.find((m) => m.platform?.os === 'linux')
          ?? doc.manifests.find((m) => m.platform?.os !== 'unknown' && m.digest);
        if (index.annotations?.[SOURCE]) return { source: index.annotations[SOURCE], via: 'oci-annotation' };
        if (!pick) return { unknown: 'the image index lists no usable platform' };
        res = await get(base, name, 'manifests', pick.digest, ACCEPT);
        if (!res.ok) return { unknown: `registry answered ${res.status} for the platform manifest` };
        doc = await res.json();
      }
      if (doc.annotations?.[SOURCE]) return { source: doc.annotations[SOURCE], via: 'oci-annotation' };
      const digest = doc.config?.digest;
      if (!digest) return { unknown: 'the manifest has no config blob' };
      res = await get(base, name, 'blobs', digest, 'application/json');
      if (!res.ok) return { unknown: `registry answered ${res.status} for the config blob` };
      const cfg = await res.json();
      const label = cfg.config?.Labels?.[SOURCE] ?? cfg.Labels?.[SOURCE];
      if (label) return { source: label, via: 'oci-label' };
      return { unknown: `the image has no ${SOURCE} label` };
    } catch (e) {
      return { unknown: `registry request failed: ${e.cause?.code ?? e.message}` };
    }
  }

  return { source };
}
