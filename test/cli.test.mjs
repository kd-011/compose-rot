import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { ROOT, run, tmpdir, writeTree } from '../test-support/helpers.mjs';

const PKG = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const clean = () => writeTree(tmpdir(), { 'compose.yml': 'services:\n  a:\n    image: nginx:1.27\n' });
const dirty = () => writeTree(tmpdir(), { 'compose.yml': 'services:\n  a:\n    image: containrrr/watchtower\n' });
const broken = () => writeTree(tmpdir(), { 'compose.yml': 'services:\n  a:\n    image: "nginx\n' });

test('--version prints the package version and exits 0', () => {
  for (const flag of ['--version', '-v']) {
    const r = run([flag]);
    assert.equal(r.code, 0);
    assert.equal(r.stdout.trim(), PKG.version);
  }
});

test('--help and no arguments print usage', () => {
  assert.equal(run(['--help']).code, 0);
  assert.match(run(['--help']).stdout, /compose-rot check/);
  const none = run([]);
  assert.equal(none.code, 0);
  assert.match(none.stdout, /Usage/);
});

test('exit 0 when clean', () => {
  const r = run(['check', clean()]);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /no findings/i);
});

test('exit 1 when there are findings, and the text names file:line and the image', () => {
  const dir = dirty();
  const r = run(['check', dir]);
  assert.equal(r.code, 1, r.stderr);
  assert.match(r.stdout, /ARCHIVED/);
  assert.match(r.stdout, new RegExp(`${path.join(dir, 'compose.yml').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:3`));
  assert.match(r.stdout, /containrrr\/watchtower/);
  assert.match(r.stdout, /2025-12-17/);
  assert.match(r.stdout, /https:\/\/github\.com\/containrrr\/watchtower/);
});

test('exit 2 on a parse error, with file:line, and no stack trace', () => {
  const dir = broken();
  const r = run(['check', dir]);
  assert.equal(r.code, 2);
  assert.match(r.stdout + r.stderr, /compose\.yml:3/);
  assert.doesNotMatch(r.stdout + r.stderr, /at .*\.mjs:\d+/);
});

test('exit 2 on a path that does not exist and on an unknown option', () => {
  assert.equal(run(['check', '/nonexistent/compose-rot']).code, 2);
  const r = run(['check', '--nope']);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /nope/);
  assert.equal(run(['frobnicate']).code, 2);
});

test('exit 2 when a file fails to parse even though another has findings', () => {
  const dir = writeTree(tmpdir(), {
    'a/compose.yml': 'services:\n  a:\n    image: containrrr/watchtower\n',
    'b/compose.yml': 'services:\n  a:\n    image: "x\n',
  });
  const r = run(['check', dir]);
  assert.equal(r.code, 2);
  assert.match(r.stdout, /ARCHIVED/);
});

test('--json prints the documented schema', () => {
  const dir = dirty();
  const r = run(['check', dir, '--json']);
  assert.equal(r.code, 1);
  const out = JSON.parse(r.stdout);
  assert.equal(out.tool, 'compose-rot');
  assert.equal(out.version, PKG.version);
  assert.equal(out.schema, 1);
  assert.equal(out.online, false);
  assert.deepEqual(Object.keys(out.summary).sort(), ['byKind', 'errors', 'files', 'findings', 'images']);
  const f = out.findings[0];
  for (const k of ['kind', 'file', 'line', 'service', 'image', 'summary', 'date', 'source', 'sources', 'evidence', 'replacement', 'upstream']) assert.ok(k in f, k);
  for (const k of ['raw', 'registry', 'namespace', 'repo', 'tag', 'digest', 'canonical']) assert.ok(k in f.image, k);
  assert.ok(Array.isArray(out.unknown) && Array.isArray(out.errors) && Array.isArray(out.files));
});

test('--json is valid and has an empty findings list when clean', () => {
  const r = run(['check', clean(), '--json']);
  assert.equal(r.code, 0);
  assert.deepEqual(JSON.parse(r.stdout).findings, []);
});

test('--json errors are objects with file, line and message', () => {
  const r = run(['check', broken(), '--json']);
  assert.equal(r.code, 2);
  const e = JSON.parse(r.stdout).errors[0];
  assert.equal(e.line, 3);
  assert.match(e.file, /compose\.yml$/);
  assert.ok(e.message);
});

test('UNKNOWN is shown only with --verbose', () => {
  const dir = writeTree(tmpdir(), { 'compose.yml': 'services:\n  a:\n    image: ${WHOLE}\n' });
  assert.doesNotMatch(run(['check', dir]).stdout, /UNKNOWN/);
  assert.match(run(['check', dir, '--verbose']).stdout, /UNKNOWN/);
});

test('with no path it scans the current directory', () => {
  const dir = dirty();
  const r = run(['check'], { cwd: dir });
  assert.equal(r.code, 1);
  assert.match(r.stdout, /watchtower/);
});

test('check never writes anywhere', () => {
  const dir = dirty();
  const before = fs.readdirSync(dir).sort();
  run(['check', dir]);
  assert.deepEqual(fs.readdirSync(dir).sort(), before);
});

test('demo runs from a clean HOME with no setup, finds things, and exits 1', () => {
  const home = tmpdir('compose-rot-home-');
  const r = run(['demo'], { env: { HOME: home }, cwd: home });
  assert.equal(r.code, 1, r.stderr);
  for (const kind of ['REMOVED', 'ARCHIVED', 'RELICENSED', 'NON_OSI', 'DEPRECATED']) assert.match(r.stdout, new RegExp(kind));
  assert.match(r.stdout, /bitnami/);
  assert.deepEqual(fs.readdirSync(home), [], 'demo wrote into HOME');
});

test('demo --json works', () => {
  const r = run(['demo', '--json']);
  assert.equal(r.code, 1);
  assert.ok(JSON.parse(r.stdout).findings.length >= 5);
});
