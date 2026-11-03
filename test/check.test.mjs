// Offline findings, end to end through scan(): real compose files in a temp dir.
import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import { scan } from '../src/check.mjs';
import { lineOf, tmpdir, writeTree } from '../test-support/helpers.mjs';

const STACK = `services:
  db:
    image: bitnami/postgresql:16
  s3:
    image: minio/minio:RELEASE.2025-04-22T22-12-26Z
  updater:
    image: containrrr/watchtower
  ui:
    image: fnsys/dockhand:latest
  vault-old:
    image: hashicorp/vault:1.14.0
  vault-new:
    image: hashicorp/vault:1.15.2
  vault-floating:
    image: hashicorp/vault
  web:
    image: nginx:1.27
  quoted:
    image: "ghcr.io/containrrr/watchtower:1.7.1"
`;

async function scanStack(extra = {}) {
  const dir = writeTree(tmpdir(), { 'media/compose.yml': STACK });
  const file = path.join(dir, 'media/compose.yml');
  return { dir, file, report: await scan({ paths: [dir], ...extra }) };
}

test('flags the known cases and names file, line, image, date and source', async () => {
  const { file, report } = await scanStack();
  const by = (svc) => report.findings.filter((f) => f.service === svc);
  const bit = by('db')[0];
  assert.equal(bit.kind, 'REMOVED');
  assert.equal(bit.file, file);
  assert.equal(bit.line, lineOf(STACK, 'image: bitnami/postgresql:16'));
  assert.equal(bit.image.canonical, 'docker.io/bitnami/postgresql');
  assert.equal(bit.image.raw, 'bitnami/postgresql:16');
  assert.equal(bit.date, '2025-08-28');
  assert.match(bit.source, /^https:\/\//);
  assert.equal(bit.evidence, 'known');
  assert.equal(by('s3')[0].kind, 'ARCHIVED');
  assert.equal(by('s3')[0].date, '2026-04-25');
  assert.equal(by('updater')[0].kind, 'ARCHIVED');
  assert.equal(by('updater')[0].date, '2025-12-17');
  assert.equal(by('quoted')[0].kind, 'ARCHIVED');
  assert.equal(by('ui')[0].kind, 'NON_OSI');
  assert.equal(by('web').length, 0);
});

test('a version-limited licence change applies only to the versions it covers', async () => {
  const { report } = await scanStack();
  const kinds = (svc) => report.findings.filter((f) => f.service === svc).map((f) => f.kind);
  assert.deepEqual(kinds('vault-old'), []);
  assert.deepEqual(kinds('vault-new'), ['RELICENSED']);
  assert.deepEqual(kinds('vault-floating'), ['RELICENSED']);
});

test('RELICENSED findings carry both licences', async () => {
  const { report } = await scanStack();
  const f = report.findings.find((x) => x.service === 'vault-new');
  assert.equal(f.licence.from, 'MPL-2.0');
  assert.equal(f.licence.to, 'BUSL-1.1');
});

test('wording is factual and states the date', async () => {
  const { report } = await scanStack();
  for (const f of report.findings) {
    assert.match(f.summary, /\d{4}-\d{2}-\d{2}|\d{4}/, f.service);
    assert.doesNotMatch(f.summary, /dangerous|unsafe|insecure|vulnerab/i);
  }
});

test('a replacement appears only where the data carries one with a source', async () => {
  const { report } = await scanStack();
  for (const f of report.findings) {
    if (f.replacement) assert.match(f.replacement.source, /^https:\/\//);
  }
});

test('summary counts add up', async () => {
  const { report } = await scanStack();
  assert.equal(report.summary.files, 1);
  assert.equal(report.summary.images, 9);
  assert.equal(report.summary.findings, report.findings.length);
  assert.equal(Object.values(report.summary.byKind).reduce((a, b) => a + b, 0), report.findings.length);
});

test('--ignore drops matching images', async () => {
  const { report } = await scanStack({ ignore: ['*/bitnami/*', 'docker.io/containrrr/watchtower'] });
  assert.equal(report.findings.some((f) => f.service === 'db'), false);
  assert.equal(report.findings.some((f) => f.service === 'updater'), false);
  assert.equal(report.findings.some((f) => f.service === 'quoted'), true);
});

test('an extra data file adds entries without replacing the built-in ones', async () => {
  const dir = writeTree(tmpdir(), {
    'compose.yml': 'services:\n  a:\n    image: example/mine:1\n  b:\n    image: minio/minio\n',
    'mine.json': JSON.stringify({ schema: 1, entries: [{
      id: 'mine', match: ['docker.io/example/mine'], kind: 'ARCHIVED', upstream: 'example/mine', date: '2026-01-01',
      summary: 'upstream repo archived on 2026-01-01', sources: [{ url: 'https://github.com/example/mine', checked: '2026-11-03' }],
      verified: '2026-11-03T00:00:00Z',
    }] }),
  });
  const report = await scan({ paths: [path.join(dir, 'compose.yml')], dataFiles: [path.join(dir, 'mine.json')] });
  assert.deepEqual(report.findings.map((f) => f.service).sort(), ['a', 'b']);
});

test('unresolved images are listed as unknown, never as findings', async () => {
  const dir = writeTree(tmpdir(), { 'compose.yml': 'services:\n  a:\n    image: ${WHOLE}\n' });
  const report = await scan({ paths: [dir] });
  assert.deepEqual(report.findings, []);
  assert.equal(report.unknown.length, 1);
  assert.match(report.unknown[0].reason, /variable/);
});

test('a .env file next to the compose file supplies variables, and only for images', async () => {
  const dir = writeTree(tmpdir(), {
    'compose.yml': 'services:\n  a:\n    image: ${REPO}/postgresql:${TAG:-1}\n',
    '.env': 'REPO=bitnami\nSECRET_TOKEN=hunter2\n',
  });
  const report = await scan({ paths: [dir] });
  assert.equal(report.findings[0].kind, 'REMOVED');
  assert.doesNotMatch(JSON.stringify(report), /hunter2|SECRET_TOKEN/);
});

test('one malformed file is reported with file and line and the rest still scan', async () => {
  const dir = writeTree(tmpdir(), {
    'good/compose.yml': 'services:\n  a:\n    image: containrrr/watchtower\n',
    'bad/compose.yml': 'services:\n  web:\n    image: "nginx:1\n    restart: always\n',
  });
  const report = await scan({ paths: [dir] });
  assert.equal(report.findings.length, 1);
  assert.equal(report.errors.length, 1);
  assert.equal(report.errors[0].file, path.join(dir, 'bad/compose.yml'));
  assert.equal(report.errors[0].line, 3);
  assert.match(report.errors[0].message, /unterminated/i);
});

test('the same image in two files gives one finding per place', async () => {
  const dir = writeTree(tmpdir(), {
    'a/compose.yml': 'services:\n  w:\n    image: containrrr/watchtower\n',
    'b/compose.yml': 'services:\n  w:\n    image: containrrr/watchtower\n',
  });
  assert.equal((await scan({ paths: [dir] })).findings.length, 2);
});
