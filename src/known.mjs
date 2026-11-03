// The curated data file: images whose upstream is archived, removed, relicensed or deprecated.
import fs from 'node:fs';

export const ENTRY_KINDS = ['REMOVED', 'ARCHIVED', 'DEPRECATED', 'RELICENSED', 'NON_OSI'];
export const KINDS = [...ENTRY_KINDS, 'STALE', 'UNKNOWN'];

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const STAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const HTTPS = /^https:\/\/[^\s/]+\S*$/;
const realDate = (s) => DATE.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().startsWith(s);

const DEFAULT_FILE = new URL('../data/known.json', import.meta.url);
export const DEFAULT_LICENCES_FILE = new URL('../data/non-open-licences.json', import.meta.url);

/** Problems with one entry, as plain sentences. An empty list means the entry is acceptable. */
export function validateEntry(e) {
  const p = [];
  if (!e || typeof e !== 'object') return ['entry is not an object'];
  if (typeof e.id !== 'string' || !/^[a-z0-9][a-z0-9._-]*$/.test(e.id)) p.push('id must be lowercase letters, digits, dots, dashes');
  if (!Array.isArray(e.match) || e.match.length === 0 || e.match.some((m) => typeof m !== 'string' || m !== m.toLowerCase() || !/^[a-z0-9.:_/*-]+$/.test(m))) {
    p.push('match must be a list of lowercase image names such as docker.io/owner/name, with * allowed');
  }
  if (!ENTRY_KINDS.includes(e.kind)) p.push(`kind must be one of ${ENTRY_KINDS.join(', ')}`);
  if (e.upstream !== undefined && !/^[\w.-]+\/[\w.-]+$/.test(e.upstream)) p.push('upstream must be a GitHub owner/repo');
  if (typeof e.date !== 'string' || !realDate(e.date)) p.push('date must be a real YYYY-MM-DD date of the event');
  if (typeof e.summary !== 'string' || e.summary.trim().length < 10) p.push('summary is required');
  if (!Array.isArray(e.sources) || e.sources.length === 0) p.push('at least one source is required');
  else e.sources.forEach((s, i) => {
    if (!s || typeof s.url !== 'string' || !HTTPS.test(s.url)) p.push(`sources[${i}].url must be an https URL`);
    if (!s || typeof s.checked !== 'string' || !realDate(s.checked)) p.push(`sources[${i}].checked must be the YYYY-MM-DD date the page was opened`);
  });
  if (typeof e.verified !== 'string' || !STAMP.test(e.verified)) p.push('verified must be a UTC timestamp like 2026-11-03T13:30:00Z');
  if (e.replacement !== undefined) {
    const r = e.replacement;
    if (!r || typeof r.text !== 'string' || !r.text.trim() || typeof r.source !== 'string' || !HTTPS.test(r.source)) p.push('replacement needs text and an https source URL');
  }
  if (e.kind === 'RELICENSED' && !(e.licence && typeof e.licence.from === 'string' && typeof e.licence.to === 'string')) p.push('RELICENSED needs licence.from and licence.to');
  if (e.kind === 'NON_OSI' && !(e.licence && typeof e.licence.to === 'string')) p.push('NON_OSI needs licence.to');
  if (e.affects !== undefined && !(e.affects && /^\d+(\.\d+)*$/.test(e.affects.from ?? ''))) p.push('affects.from must be a version like 1.15.0');
  return p;
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) {
    throw new Error(`cannot read data file ${file instanceof URL ? file.pathname : file}: ${e.message}`);
  }
}

/** The built-in entries plus any extra files. Returns { entries }. Invalid extra entries are an error. */
export function loadKnown({ files = [] } = {}) {
  const entries = [...readJson(DEFAULT_FILE).entries];
  for (const f of files) {
    const extra = readJson(f).entries;
    if (!Array.isArray(extra)) throw new Error(`data file ${f} has no entries list`);
    for (const e of extra) {
      const problems = validateEntry(e);
      if (problems.length) throw new Error(`data file ${f}, entry ${e?.id ?? '?'}: ${problems.join('; ')}`);
      entries.push(e);
    }
  }
  return { entries };
}

export function loadNonOpenLicences() {
  const ids = new Map();
  for (const l of readJson(DEFAULT_LICENCES_FILE).licences) ids.set(l.id.toLowerCase(), l);
  return ids;
}

/** `*` matches any run of characters. Case-insensitive. */
export function globMatch(pattern, text) {
  const re = new RegExp(`^${pattern.toLowerCase().replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`);
  return re.test(text.toLowerCase());
}

const nums = (v) => String(v).match(/\d+/g)?.map(Number) ?? [];

/**
 * Does the tag fall in the versions an entry covers? No tag, `latest` and tags that do not
 * start with a version all count as covered. A floating tag with fewer parts than the
 * boundary (1 against 1.15.0) is covered, because it can resolve to a release that is.
 */
export function tagAffected(tag, affects) {
  if (!affects?.from) return true;
  if (!tag || !/^v?\d/.test(tag)) return true;
  const have = nums(tag.replace(/^v/, '').split(/[-+_]/)[0]);
  const from = nums(affects.from);
  const n = Math.min(have.length, from.length);
  for (let i = 0; i < n; i++) {
    if (have[i] > from[i]) return true;
    if (have[i] < from[i]) return false;
  }
  return true;
}

/** Every entry that covers this image ref. */
export function matchKnown(ref, entries) {
  if (!ref) return [];
  return entries.filter((e) => e.match.some((m) => globMatch(m, ref.canonical)) && tagAffected(ref.tag, e.affects));
}
