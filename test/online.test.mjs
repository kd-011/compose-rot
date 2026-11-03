// --online against real HTTP servers standing in for a registry and for the GitHub API.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { scan } from '../src/check.mjs';
import { json, stubServer, tmpdir, writeTree } from '../test-support/helpers.mjs';

const NOW = new Date('2026-11-03T00:00:00Z');
const OLD = '2023-01-01T00:00:00Z';
const RECENT = '2026-09-01T00:00:00Z';

function githubStub(repos, { onRequest } = {}) {
  return stubServer((req, res) => {
    onRequest?.(req, res);
    if (res.writableEnded) return;
    const m = req.url.match(/^\/repos\/([^/]+\/[^/?]+)/);
    const repo = m && repos[m[1].toLowerCase()];
    if (!repo) return json(res, 404, { message: 'Not Found' });
    json(res, 200, repo);
  });
}

// A registry that wants an anonymous token first, serves an index, a manifest and a config blob.
function registryStub(images) {
  let base;
  const server = stubServer((req, res) => {
    const url = new URL(req.url, base);
    if (url.pathname === '/token') return json(res, 200, { token: 'stubtoken' });
    if (req.headers.authorization !== 'Bearer stubtoken') {
      return json(res, 401, { errors: [{ code: 'UNAUTHORIZED' }] }, {
        'www-authenticate': `Bearer realm="${base}/token",service="stub",scope="repository:x:pull"`,
      });
    }
    const m = url.pathname.match(/^\/v2\/(.+)\/(manifests|blobs)\/(.+)$/);
    if (!m) return json(res, 404, {});
    const [, name, kind, ref] = m;
    const img = images[name];
    if (!img) return json(res, 404, { errors: [{ code: 'NAME_UNKNOWN' }] });
    if (kind === 'manifests' && !ref.startsWith('sha256:')) {
      if (img.noTag) return json(res, 404, { errors: [{ code: 'MANIFEST_UNKNOWN' }] });
      return json(res, 200, {
        schemaVersion: 2, mediaType: 'application/vnd.oci.image.index.v1+json',
        ...(img.indexAnnotation ? { annotations: { 'org.opencontainers.image.source': img.indexAnnotation } } : {}),
        manifests: [
          { digest: 'sha256:att', platform: { os: 'unknown', architecture: 'unknown' } },
          { digest: 'sha256:amd', platform: { os: 'linux', architecture: 'amd64' } },
        ],
      });
    }
    if (kind === 'manifests') return json(res, 200, { schemaVersion: 2, mediaType: 'application/vnd.oci.image.manifest.v1+json', config: { digest: 'sha256:cfg' } });
    if (kind === 'blobs') return json(res, 200, { config: { Labels: img.source ? { 'org.opencontainers.image.source': img.source } : {} } });
    json(res, 404, {});
  });
  return server.then((s) => { base = s.url; return s; });
}

const compose = (...images) => `services:\n${images.map((im, i) => `  s${i}:\n    image: ${im}\n`).join('')}`;

async function scanOnline(composeText, { gh, reg, token, extra = {} } = {}) {
  const dir = writeTree(tmpdir(), { 'compose.yml': composeText });
  return scan({
    paths: [dir], online: true, now: NOW,
    github: { api: gh.url, token, sleep: async () => {}, ...extra.github },
    registries: reg ? { 'docker.io': reg.url } : {},
    ...extra.scan,
  });
}

test('resolves the upstream from the OCI source label, then flags an archived repo', async () => {
  const reg = await registryStub({ 'example/app': { source: 'https://github.com/Example/App.git' } });
  const gh = await githubStub({ 'example/app': { full_name: 'example/app', archived: true, pushed_at: '2026-02-10T08:00:00Z', license: { spdx_id: 'MIT' }, html_url: 'https://github.com/example/app' } });
  try {
    const r = await scanOnline(compose('example/app:1'), { gh, reg });
    assert.equal(r.findings.length, 1);
    const f = r.findings[0];
    assert.equal(f.kind, 'ARCHIVED');
    assert.equal(f.evidence, 'online');
    assert.equal(f.upstream.repo, 'example/app');
    assert.equal(f.upstream.via, 'oci-label');
    assert.equal(f.source, 'https://github.com/example/app');
    assert.match(f.summary, /archived/);
    assert.match(f.summary, /2026-02-10/);
    assert.match(f.date, /2026-02-10/);
    assert.ok(reg.requests.some((q) => q.url.includes('/manifests/1')));
  } finally { await reg.close(); await gh.close(); }
});

test('reads the source annotation on the index when the config has no label', async () => {
  const reg = await registryStub({ 'example/app': { indexAnnotation: 'https://github.com/example/app' } });
  const gh = await githubStub({ 'example/app': { full_name: 'example/app', archived: true, pushed_at: RECENT, license: { spdx_id: 'MIT' } } });
  try {
    const r = await scanOnline(compose('example/app'), { gh, reg });
    assert.equal(r.findings[0].upstream.via, 'oci-annotation');
  } finally { await reg.close(); await gh.close(); }
});

test('a known upstream is used first and the registry is not asked', async () => {
  const reg = await registryStub({});
  const gh = await githubStub({ 'containrrr/watchtower': { full_name: 'containrrr/watchtower', archived: true, pushed_at: '2025-12-17T14:44:11Z', license: { spdx_id: 'Apache-2.0' } } });
  try {
    const r = await scanOnline(compose('containrrr/watchtower'), { gh, reg });
    assert.equal(reg.requests.length, 0);
    const kinds = r.findings.map((f) => f.kind);
    assert.deepEqual(kinds, ['ARCHIVED']);
    assert.equal(r.findings[0].evidence, 'known');
    assert.equal(r.findings[0].live.archived, true);
  } finally { await reg.close(); await gh.close(); }
});

test('no label and no known upstream: upstream unknown, never a guess', async () => {
  const reg = await registryStub({ 'example/bare': {} });
  const gh = await githubStub({ 'example/bare': { full_name: 'example/bare', archived: true, pushed_at: OLD, license: { spdx_id: 'MIT' } } });
  try {
    const r = await scanOnline(compose('example/bare:1'), { gh, reg });
    assert.deepEqual(r.findings, []);
    assert.equal(r.unknown.length, 1);
    assert.match(r.unknown[0].reason, /upstream unknown/);
    assert.equal(gh.requests.length, 0, 'must not guess a GitHub repo from the image name');
  } finally { await reg.close(); await gh.close(); }
});

test('a missing image or tag is unknown with the registry error, not REMOVED', async () => {
  const reg = await registryStub({ 'example/gone': { noTag: true } });
  const gh = await githubStub({});
  try {
    const r = await scanOnline(compose('example/gone:9', 'example/nothere:1'), { gh, reg });
    assert.deepEqual(r.findings, []);
    assert.equal(r.unknown.length, 2);
    assert.match(r.unknown[0].reason, /upstream unknown/);
  } finally { await reg.close(); await gh.close(); }
});

test('an upstream that is not on GitHub is unknown, saying where it is', async () => {
  const reg = await registryStub({ 'example/lab': { source: 'https://gitlab.com/example/lab' } });
  const gh = await githubStub({});
  try {
    const r = await scanOnline(compose('example/lab'), { gh, reg });
    assert.match(r.unknown[0].reason, /gitlab\.com/);
  } finally { await reg.close(); await gh.close(); }
});

const LICENCE_CASES = [
  ['BUSL-1.1', 'NON_OSI'], ['SSPL-1.0', 'NON_OSI'], ['Elastic-2.0', 'NON_OSI'], ['Commons-Clause', 'NON_OSI'],
  ['MIT', null], ['Apache-2.0', null], ['AGPL-3.0', null],
];
for (const [spdx, kind] of LICENCE_CASES) {
  test(`licence ${spdx} -> ${kind ?? 'no finding'}`, async () => {
    const reg = await registryStub({ 'example/app': { source: 'https://github.com/example/app' } });
    const gh = await githubStub({ 'example/app': { full_name: 'example/app', archived: false, pushed_at: RECENT, license: { spdx_id: spdx } } });
    try {
      const r = await scanOnline(compose('example/app'), { gh, reg });
      assert.deepEqual(r.findings.map((f) => f.kind), kind ? [kind] : []);
      if (kind) assert.match(r.findings[0].summary, new RegExp(spdx));
    } finally { await reg.close(); await gh.close(); }
  });
}

test('NOASSERTION is reported as unknown, not as a bad licence', async () => {
  const reg = await registryStub({ 'example/app': { source: 'https://github.com/example/app' } });
  const gh = await githubStub({ 'example/app': { full_name: 'example/app', archived: false, pushed_at: RECENT, license: { spdx_id: 'NOASSERTION' } } });
  try {
    const r = await scanOnline(compose('example/app'), { gh, reg });
    assert.deepEqual(r.findings, []);
    assert.match(r.unknown[0].reason, /licen[cs]e.*(not detected|NOASSERTION|unknown)/i);
  } finally { await reg.close(); await gh.close(); }
});

test('a repo with no licence field at all is unknown too', async () => {
  const reg = await registryStub({ 'example/app': { source: 'https://github.com/example/app' } });
  const gh = await githubStub({ 'example/app': { full_name: 'example/app', archived: false, pushed_at: RECENT, license: null } });
  try {
    const r = await scanOnline(compose('example/app'), { gh, reg });
    assert.deepEqual(r.findings, []);
    assert.equal(r.unknown.length, 1);
  } finally { await reg.close(); await gh.close(); }
});

test('STALE after 24 months without a push, not before, and not when also archived', async () => {
  const reg = await registryStub({
    'example/old': { source: 'https://github.com/example/old' },
    'example/fresh': { source: 'https://github.com/example/fresh' },
    'example/edge': { source: 'https://github.com/example/edge' },
    'example/both': { source: 'https://github.com/example/both' },
  });
  const gh = await githubStub({
    'example/old': { full_name: 'example/old', archived: false, pushed_at: OLD, license: { spdx_id: 'MIT' } },
    'example/fresh': { full_name: 'example/fresh', archived: false, pushed_at: RECENT, license: { spdx_id: 'MIT' } },
    'example/edge': { full_name: 'example/edge', archived: false, pushed_at: '2024-11-10T00:00:00Z', license: { spdx_id: 'MIT' } },
    'example/both': { full_name: 'example/both', archived: true, pushed_at: OLD, license: { spdx_id: 'MIT' } },
  });
  try {
    const r = await scanOnline(compose('example/old', 'example/fresh', 'example/edge', 'example/both'), { gh, reg });
    const by = Object.fromEntries(r.findings.map((f) => [f.image.raw, f.kind]));
    assert.deepEqual(by, { 'example/old': 'STALE', 'example/both': 'ARCHIVED' });
    assert.match(r.findings.find((f) => f.kind === 'STALE').summary, /2023-01-01/);
  } finally { await reg.close(); await gh.close(); }
});

test('STALE window is configurable', async () => {
  const reg = await registryStub({ 'example/edge': { source: 'https://github.com/example/edge' } });
  const gh = await githubStub({ 'example/edge': { full_name: 'example/edge', archived: false, pushed_at: '2025-06-01T00:00:00Z', license: { spdx_id: 'MIT' } } });
  try {
    const r = await scanOnline(compose('example/edge'), { gh, reg, extra: { scan: { staleMonths: 12 } } });
    assert.deepEqual(r.findings.map((f) => f.kind), ['STALE']);
  } finally { await reg.close(); await gh.close(); }
});

test('a known RELICENSED entry is checked against the live licence', async () => {
  const gh = await githubStub({ 'hashicorp/vault': { full_name: 'hashicorp/vault', archived: false, pushed_at: RECENT, license: { spdx_id: 'BUSL-1.1' } } });
  try {
    const r = await scanOnline(compose('hashicorp/vault:1.20'), { gh });
    assert.deepEqual(r.findings.map((f) => f.kind), ['RELICENSED']);
    assert.equal(r.findings[0].live.licence, 'BUSL-1.1');
  } finally { await gh.close(); }
});

test('rate limit: waits until the reset, then succeeds', async () => {
  let hits = 0;
  const slept = [];
  const gh = await githubStub({ 'example/app': { full_name: 'example/app', archived: true, pushed_at: RECENT, license: { spdx_id: 'MIT' } } }, {
    onRequest: (req, res) => {
      hits++;
      if (hits === 1) json(res, 403, { message: 'API rate limit exceeded' }, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(Math.floor(NOW.getTime() / 1000) + 5) });
    },
  });
  const reg = await registryStub({ 'example/app': { source: 'https://github.com/example/app' } });
  try {
    const r = await scanOnline(compose('example/app'), { gh, reg, extra: { github: { sleep: async (ms) => { slept.push(ms); }, now: () => NOW.getTime() } } });
    assert.equal(r.findings[0].kind, 'ARCHIVED');
    assert.equal(hits, 2);
    assert.equal(slept.length, 1);
    assert.ok(slept[0] > 0 && slept[0] <= 60_000, `slept ${slept[0]}`);
  } finally { await reg.close(); await gh.close(); }
});

test('rate limit that does not clear: unknown, naming GITHUB_TOKEN, and no crash', async () => {
  const gh = await githubStub({}, { onRequest: (req, res) => json(res, 429, { message: 'slow down' }, { 'retry-after': '3' }) });
  const reg = await registryStub({ 'example/app': { source: 'https://github.com/example/app' } });
  try {
    const r = await scanOnline(compose('example/app'), { gh, reg });
    assert.deepEqual(r.findings, []);
    assert.match(r.unknown[0].reason, /rate limit/i);
    assert.match(r.unknown[0].reason, /GITHUB_TOKEN/);
  } finally { await reg.close(); await gh.close(); }
});

test('honours a token on GitHub and never sends it to a registry', async () => {
  const reg = await registryStub({ 'example/app': { source: 'https://github.com/example/app' } });
  const gh = await githubStub({ 'example/app': { full_name: 'example/app', archived: false, pushed_at: RECENT, license: { spdx_id: 'MIT' } } });
  try {
    await scanOnline(compose('example/app'), { gh, reg, token: 'ghp_testtoken' });
    assert.ok(gh.requests.every((q) => q.headers.authorization === 'Bearer ghp_testtoken'));
    assert.ok(gh.requests.every((q) => /compose-rot/.test(q.headers['user-agent'])));
    assert.ok(reg.requests.every((q) => q.headers.authorization !== 'Bearer ghp_testtoken'));
    const noToken = await githubStub({ 'example/app': { full_name: 'example/app', archived: false, pushed_at: RECENT, license: { spdx_id: 'MIT' } } });
    await scanOnline(compose('example/app'), { gh: noToken, reg });
    assert.ok(noToken.requests.every((q) => !q.headers.authorization));
    await noToken.close();
  } finally { await reg.close(); await gh.close(); }
});

test('the same upstream is fetched once per run', async () => {
  const reg = await registryStub({ 'example/a': { source: 'https://github.com/example/shared' }, 'example/b': { source: 'https://github.com/example/shared' } });
  const gh = await githubStub({ 'example/shared': { full_name: 'example/shared', archived: false, pushed_at: RECENT, license: { spdx_id: 'MIT' } } });
  try {
    await scanOnline(compose('example/a', 'example/b'), { gh, reg });
    assert.equal(gh.requests.length, 1);
  } finally { await reg.close(); await gh.close(); }
});

test('offline never touches the network', async () => {
  const gh = await githubStub({});
  const reg = await registryStub({});
  try {
    const dir = writeTree(tmpdir(), { 'compose.yml': compose('containrrr/watchtower', 'example/app') });
    await scan({ paths: [dir], github: { api: gh.url }, registries: { 'docker.io': reg.url } });
    assert.equal(gh.requests.length + reg.requests.length, 0);
  } finally { await reg.close(); await gh.close(); }
});
