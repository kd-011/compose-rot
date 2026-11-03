// The data file is the product. Every entry must say where it came from.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { KINDS, loadKnown, validateEntry } from '../src/known.mjs';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const STAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

test('the data file has at least 20 entries and loads', () => {
  const { entries } = loadKnown();
  assert.ok(entries.length >= 20, `only ${entries.length}`);
});

test('every entry passes validateEntry', () => {
  const { entries } = loadKnown();
  const problems = entries.flatMap((e) => validateEntry(e).map((p) => `${e.id}: ${p}`));
  assert.deepEqual(problems, []);
});

test('every entry has a source URL, a checked date and a verified timestamp', () => {
  for (const e of loadKnown().entries) {
    assert.ok(Array.isArray(e.sources) && e.sources.length > 0, `${e.id}: no sources`);
    for (const s of e.sources) {
      assert.match(s.url, /^https:\/\/\S+$/, `${e.id}: source url`);
      assert.match(s.checked, DATE, `${e.id}: source checked date`);
    }
    assert.match(e.verified, STAMP, `${e.id}: verified`);
    assert.match(e.date, DATE, `${e.id}: date`);
  }
});

test('ids are unique and match patterns do not overlap between entries', () => {
  const { entries } = loadKnown();
  assert.equal(new Set(entries.map((e) => e.id)).size, entries.length);
  const seen = new Map();
  for (const e of entries) for (const m of e.match) {
    assert.equal(seen.get(m), undefined, `${m} is in ${seen.get(m)} and ${e.id}`);
    seen.set(m, e.id);
  }
});

test('wording is factual: no judgement words in summaries', () => {
  for (const e of loadKnown().entries) {
    assert.doesNotMatch(`${e.summary} ${e.detail ?? ''}`, /dangerous|unsafe|insecure|vulnerab|malicious|dead\b|abandon/i, e.id);
  }
});

test('a replacement is only allowed with its own source', () => {
  for (const e of loadKnown().entries.filter((x) => x.replacement)) {
    assert.ok(e.replacement.text && /^https:\/\//.test(e.replacement.source), e.id);
  }
});

test('the seed cases from the brief are present', () => {
  const by = Object.fromEntries(loadKnown().entries.map((e) => [e.id, e]));
  assert.equal(by.bitnami.kind, 'REMOVED');
  assert.equal(by.minio.kind, 'ARCHIVED');
  assert.equal(by.watchtower.kind, 'ARCHIVED');
  assert.equal(by.watchtower.date, '2025-12-17');
  assert.equal(by.dockhand.kind, 'NON_OSI');
  assert.equal(by.dockhand.licence.to, 'BUSL-1.1');
});

// Guard test: validateEntry is what stops an entry with no source from landing.
const GOOD = {
  id: 'x', match: ['docker.io/example/x'], kind: 'ARCHIVED', upstream: 'example/x', date: '2026-01-01',
  summary: 'upstream repo archived on 2026-01-01', sources: [{ url: 'https://github.com/example/x', checked: '2026-11-03' }],
  verified: '2026-11-03T00:00:00Z',
};
test('validateEntry accepts a complete entry', () => {
  assert.deepEqual(validateEntry(GOOD), []);
});
for (const [name, patch, re] of [
  ['no sources', { sources: [] }, /source/],
  ['a source without a URL', { sources: [{ checked: '2026-11-03' }] }, /url/],
  ['a non-https source', { sources: [{ url: 'http://example.com', checked: '2026-11-03' }] }, /url/],
  ['a source without a checked date', { sources: [{ url: 'https://example.com' }] }, /checked/],
  ['no verified timestamp', { verified: undefined }, /verified/],
  ['a bad kind', { kind: 'DANGEROUS' }, /kind/],
  ['no event date', { date: undefined }, /date/],
  ['a replacement with no source', { replacement: { text: 'use y' } }, /replacement/],
  ['RELICENSED without licences', { kind: 'RELICENSED' }, /licence/],
]) {
  test(`validateEntry rejects ${name}`, () => {
    const problems = validateEntry({ ...GOOD, ...patch });
    assert.ok(problems.some((p) => re.test(p)), JSON.stringify(problems));
  });
}

test('KINDS lists exactly the kinds the docs describe', () => {
  assert.deepEqual([...KINDS].sort(), ['ARCHIVED', 'DEPRECATED', 'NON_OSI', 'REMOVED', 'RELICENSED', 'STALE', 'UNKNOWN'].sort());
});
