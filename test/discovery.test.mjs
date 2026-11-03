import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { findComposeFiles } from '../src/find.mjs';
import { tmpdir, writeTree } from '../test-support/helpers.mjs';

const Y = 'services:\n  a:\n    image: alpine\n';

test('finds compose files by name, recursively, and nothing else', () => {
  const dir = writeTree(tmpdir(), {
    'compose.yml': Y,
    'compose.yaml': Y,
    'compose.override.yml': Y,
    'docker-compose.yml': Y,
    'docker-compose.prod.yaml': Y,
    'docker-compose-extra.yml': Y,
    'app/web.compose.yml': Y,
    'deep/er/still/compose.yml': Y,
    'notes.yml': Y,
    'config.yaml': Y,
    'compose.txt': Y,
    'composer.yml': Y,
    'my-compose.yml.bak': Y,
  });
  const { files } = findComposeFiles([dir]);
  assert.deepEqual(files.map((f) => path.relative(dir, f)).sort(), [
    'app/web.compose.yml',
    'compose.override.yml',
    'compose.yaml',
    'compose.yml',
    'deep/er/still/compose.yml',
    'docker-compose-extra.yml',
    'docker-compose.prod.yaml',
    'docker-compose.yml',
  ]);
});

test('skips node_modules and .git', () => {
  const dir = writeTree(tmpdir(), {
    'compose.yml': Y,
    'node_modules/pkg/compose.yml': Y,
    'a/node_modules/compose.yml': Y,
    '.git/compose.yml': Y,
    'sub/.git/docker-compose.yml': Y,
  });
  assert.deepEqual(findComposeFiles([dir]).files.map((f) => path.relative(dir, f)), ['compose.yml']);
});

test('a file named on the command line is scanned whatever it is called', () => {
  const dir = writeTree(tmpdir(), { 'stack.yml': Y });
  assert.deepEqual(findComposeFiles([path.join(dir, 'stack.yml')]).files, [path.join(dir, 'stack.yml')]);
});

test('does not follow symlinked directories, so a loop cannot hang it', () => {
  const dir = writeTree(tmpdir(), { 'compose.yml': Y });
  fs.symlinkSync(dir, path.join(dir, 'loop'));
  assert.equal(findComposeFiles([dir]).files.length, 1);
});

test('a path that does not exist is an error entry, not a crash', () => {
  const { files, errors } = findComposeFiles(['/nonexistent/compose-rot-test']);
  assert.deepEqual(files, []);
  assert.equal(errors.length, 1);
  assert.match(errors[0].message, /no such|not found|ENOENT/i);
});

test('the same file given twice is scanned once', () => {
  const dir = writeTree(tmpdir(), { 'compose.yml': Y });
  assert.equal(findComposeFiles([dir, path.join(dir, 'compose.yml')]).files.length, 1);
});
