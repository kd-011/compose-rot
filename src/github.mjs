// A small GitHub API client: one repo lookup, in-memory cache, polite about rate limits.
const MAX_WAIT_MS = 60_000;
const RETRIES = 2;
const realSleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class GithubError extends Error {}

/**
 * createGithub({ api, token, sleep, now, userAgent })
 *   .repo('owner/name') -> { fullName, archived, pushedAt, licence, url } or null when not found.
 * Throws GithubError (with a readable message) on rate limits and other failures.
 * The token goes to this API only. Results are cached for the life of the object.
 */
export function createGithub({ api = 'https://api.github.com', token, sleep = realSleep, now = Date.now, userAgent = 'compose-rot' } = {}) {
  const cache = new Map();

  async function request(slug) {
    const headers = { accept: 'application/vnd.github+json', 'user-agent': userAgent, 'x-github-api-version': '2022-11-28' };
    if (token) headers.authorization = `Bearer ${token}`;
    for (let attempt = 0; ; attempt++) {
      let res;
      try {
        res = await fetch(`${api.replace(/\/$/, '')}/repos/${slug}`, { headers, signal: AbortSignal.timeout(20_000) });
      } catch (e) {
        throw new GithubError(`GitHub request failed: ${e.cause?.code ?? e.message}`);
      }
      if (res.status === 404) return null;
      if (res.status === 200) {
        const j = await res.json();
        return {
          fullName: j.full_name ?? slug,
          archived: j.archived === true,
          pushedAt: j.pushed_at ?? null,
          licence: j.license?.spdx_id ?? null,
          url: j.html_url ?? `https://github.com/${j.full_name ?? slug}`,
        };
      }
      const limited = (res.status === 403 || res.status === 429)
        && (res.headers.get('retry-after') !== null || res.headers.get('x-ratelimit-remaining') === '0' || res.status === 429);
      if (!limited) throw new GithubError(`GitHub answered ${res.status} for ${slug}`);
      const retryAfter = Number(res.headers.get('retry-after'));
      const reset = Number(res.headers.get('x-ratelimit-reset'));
      let wait = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : Number.isFinite(reset) && reset > 0 ? reset * 1000 - now() + 1000 : 5000;
      wait = Math.max(wait, 1000);
      if (attempt >= RETRIES || wait > MAX_WAIT_MS) {
        throw new GithubError(`GitHub rate limit reached${token ? '' : '; set GITHUB_TOKEN to raise it'}`);
      }
      await sleep(wait);
    }
  }

  return {
    repo(slug) {
      const key = slug.toLowerCase();
      if (!cache.has(key)) cache.set(key, request(slug));
      return cache.get(key);
    },
  };
}
