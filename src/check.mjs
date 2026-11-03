// scan(): find compose files, pull their images, and turn them into findings.
import fs from 'node:fs';
import path from 'node:path';
import { extractImages, parseDotenv } from './compose.mjs';
import { findComposeFiles } from './find.mjs';
import { createGithub, GithubError } from './github.mjs';
import { globMatch, loadKnown, loadNonOpenLicences, matchKnown } from './known.mjs';
import { createRegistryClient, githubSlug } from './registry.mjs';
import { YamlError } from './yaml.mjs';
import { VERSION } from './version.mjs';

const MAX_FILE = 5 * 1024 * 1024;
const CONCURRENCY = 4; // registries answer in seconds, not milliseconds; GitHub lookups are cached per repo
const day = (iso) => (iso ? String(iso).slice(0, 10) : null);

/** Run fn over items with at most `limit` in flight. */
async function mapLimit(items, limit, fn) {
  let next = 0;
  const worker = async () => { while (next < items.length) await fn(items[next++]); };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

function readEnv(dir) {
  try { return parseDotenv(fs.readFileSync(path.join(dir, '.env'), 'utf8')); } catch { return {}; }
}

function imageFields(ref) {
  const { raw, registry, namespace, repo, tag, digest, canonical } = ref;
  return { raw, registry, namespace, repo, tag, digest, canonical };
}

function fromEntry(entry, place, ref, evidence = 'known') {
  return {
    kind: entry.kind,
    file: place.file,
    line: place.line,
    service: place.service,
    image: imageFields(ref),
    summary: entry.summary,
    detail: entry.detail ?? null,
    date: entry.date,
    source: entry.sources[0].url,
    sources: entry.sources.map(({ url, checked, note }) => ({ url, checked, ...(note ? { note } : {}) })),
    evidence,
    id: entry.id,
    replacement: entry.replacement ? { text: entry.replacement.text, source: entry.replacement.source } : null,
    upstream: entry.upstream ? { repo: entry.upstream, url: `https://github.com/${entry.upstream}`, via: 'known' } : null,
    ...(entry.licence ? { licence: { ...entry.licence } } : {}),
    live: null,
  };
}

/**
 * Scan compose files. Options:
 *   paths        files and directories (default ['.'])
 *   online       also resolve upstreams and ask GitHub
 *   ignore       image globs to skip, matched against the canonical name or the written text
 *   exclude      directory globs not to enter, matched against the name and the full path
 *   dataFiles    extra known.json files
 *   staleMonths  months without a push before STALE (default 24)
 *   now          Date, for tests
 *   github       { api, token, sleep, now } passed to the GitHub client
 *   registries   { 'docker.io': baseUrl } overrides, for tests
 *   relativeTo   print file paths relative to this directory (the demo uses it)
 * Returns the report object documented in docs/json-schema.md.
 */
export async function scan({
  paths = ['.'], online = false, ignore = [], exclude = [], dataFiles = [], staleMonths = 24, now = new Date(),
  github = {}, registries = {}, relativeTo = null,
} = {}) {
  const { entries } = loadKnown({ files: dataFiles });
  const nonOpen = loadNonOpenLicences();
  const { files: found, errors: pathErrors, skipped } = findComposeFiles(paths, { exclude });
  const shown = (p) => (relativeTo ? path.relative(relativeTo, path.resolve(p)) : p);

  const errors = pathErrors.map((e) => ({ ...e, file: shown(e.file) }));
  const files = [];
  const findings = [];
  const unknown = [];
  const resolved = []; // images whose upstream was found online, findings or not
  const pending = []; // images that need an online look
  let imageCount = 0;

  for (const file of found) {
    const display = shown(file);
    let text;
    try {
      if (fs.statSync(file).size > MAX_FILE) throw new Error('file is larger than 5 MB');
      text = fs.readFileSync(file, 'utf8');
    } catch (e) {
      errors.push({ file: display, line: null, message: `cannot read file: ${e.code ?? e.message}` });
      files.push({ path: display, images: 0, error: true });
      continue;
    }
    let images;
    try {
      images = extractImages(text, { env: readEnv(path.dirname(file)) });
    } catch (e) {
      if (!(e instanceof YamlError)) throw e;
      errors.push({ file: display, line: e.line, message: e.message });
      files.push({ path: display, images: 0, error: true });
      continue;
    }
    files.push({ path: display, images: images.length, error: false });
    for (const img of images) {
      const place = { file: display, line: img.line, service: img.service };
      if (ignore.some((g) => globMatch(g, img.ref?.canonical ?? '') || globMatch(g, img.raw))) continue;
      imageCount++;
      if (!img.ref) {
        unknown.push({ ...place, image: { raw: img.raw }, reason: img.reason });
        continue;
      }
      const mine = matchKnown(img.ref, entries).map((e) => fromEntry(e, place, img.ref));
      findings.push(...mine);
      if (online) pending.push({ place, img, mine });
    }
  }

  if (online) {
    await lookOnline({ pending, findings, unknown, resolved, nonOpen, entries, staleMonths, now, github, registries });
  }

  const order = (a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : (a.line ?? 0) - (b.line ?? 0));
  findings.sort(order);
  unknown.sort(order);
  resolved.sort(order);
  const byKind = {};
  for (const f of findings) byKind[f.kind] = (byKind[f.kind] ?? 0) + 1;
  return {
    tool: 'compose-rot',
    version: VERSION,
    schema: 1,
    online,
    generated: now.toISOString(),
    files,
    findings,
    unknown,
    resolved,
    errors,
    skipped: skipped.map((d) => ({ path: shown(d.path), reason: d.reason })),
    summary: { files: files.length, images: imageCount, findings: findings.length, byKind, errors: errors.length },
  };
}

async function lookOnline({ pending, findings, unknown, resolved, nonOpen, staleMonths, now, github, registries }) {
  const gh = createGithub({
    api: github.api ?? process.env.COMPOSE_ROT_GITHUB_API ?? undefined,
    token: github.token,
    sleep: github.sleep,
    now: github.now ?? (() => now.getTime()),
    userAgent: `compose-rot/${VERSION}`,
  });
  const reg = createRegistryClient({ registries, userAgent: `compose-rot/${VERSION}`, sleep: github.sleep });
  const regCache = new Map();
  const cutoff = new Date(now);
  cutoff.setUTCMonth(cutoff.getUTCMonth() - staleMonths);

  await mapLimit(pending, CONCURRENCY, async ({ place, img, mine }) => {
    const ref = img.ref;
    const unk = (reason) => unknown.push({ ...place, image: imageFields(ref), reason });

    // 1. Where is the upstream? known.json first, then the registry, then give up.
    let upstream = null;
    const withUpstream = mine.find((f) => f.upstream);
    if (withUpstream) upstream = { repo: withUpstream.upstream.repo, via: 'known' };
    else {
      const key = `${ref.canonical}|${ref.digest ?? ref.tag ?? 'latest'}`;
      if (!regCache.has(key)) regCache.set(key, reg.source(ref));
      const r = await regCache.get(key);
      if (r.unknown) { unk(`upstream unknown (${r.unknown})`); return; }
      const g = githubSlug(r.source);
      if (g.other) { unk(`upstream unknown (the image's source is on ${g.other}, not GitHub)`); return; }
      upstream = { repo: g.slug, via: r.via };
    }

    // 2. What does GitHub say about it?
    let live;
    try {
      live = await gh.repo(upstream.repo);
    } catch (e) {
      if (!(e instanceof GithubError)) throw e;
      unk(`upstream unknown (${upstream.repo}: ${e.message})`);
      return;
    }
    if (!live) { unk(`upstream unknown (GitHub has no repo ${upstream.repo})`); return; }

    const liveInfo = { archived: live.archived, pushedAt: live.pushedAt, licence: live.licence, url: live.url };
    resolved.push({ ...place, image: imageFields(ref), upstream: { repo: live.fullName, url: live.url, via: upstream.via }, live: liveInfo });
    for (const f of mine) f.live = liveInfo;
    const has = (...kinds) => mine.some((f) => kinds.includes(f.kind));
    const base = {
      ...place,
      image: imageFields(ref),
      evidence: 'online',
      id: null,
      replacement: null,
      upstream: { repo: live.fullName, url: live.url, via: upstream.via },
      detail: null,
      live: liveInfo,
    };
    const checked = day(now.toISOString());
    const sources = [{ url: live.url, checked }];

    if (live.archived && !has('ARCHIVED')) {
      findings.push({ ...base, kind: 'ARCHIVED', date: day(live.pushedAt), source: live.url, sources,
        summary: `upstream repo ${live.fullName} is archived; its last push was ${day(live.pushedAt)}` });
    }
    const spdx = live.licence;
    const bad = spdx ? nonOpen.get(spdx.toLowerCase()) : null;
    if (bad && !has('RELICENSED', 'NON_OSI')) {
      findings.push({ ...base, kind: 'NON_OSI', date: null, source: live.url, sources, licence: { to: spdx },
        summary: `upstream licence is ${spdx} (${bad.name}), which the OSI has not approved` });
    } else if (!spdx || spdx === 'NOASSERTION') {
      if (!has('RELICENSED', 'NON_OSI')) unk(`licence not detected by GitHub for ${live.fullName} (${spdx ?? 'none'})`);
    }
    if (!live.archived && live.pushedAt && new Date(live.pushedAt) < cutoff) {
      findings.push({ ...base, kind: 'STALE', date: day(live.pushedAt), source: live.url, sources,
        summary: `no push to ${live.fullName} since ${day(live.pushedAt)}, more than ${staleMonths} months before ${checked}` });
    }
  });
}
