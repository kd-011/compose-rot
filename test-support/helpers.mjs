// Shared helpers for the acceptance tests. Everything is built for real: real files
// in a temp dir, the real CLI in a child process, real HTTP servers for --online.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const BIN = fileURLToPath(new URL('../bin/compose-rot.mjs', import.meta.url));
export const ROOT = fileURLToPath(new URL('..', import.meta.url));
export const FIXTURES = path.join(ROOT, 'test/fixtures/compose');

const made = [];
process.on('exit', () => {
  for (const d of made) fs.rmSync(d, { recursive: true, force: true });
});

export function tmpdir(prefix = 'compose-rot-test-') {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  made.push(d);
  return d;
}

/** Write { 'a/b.yml': 'text' } under dir. */
export function writeTree(dir, files) {
  for (const [rel, text] of Object.entries(files)) {
    const p = path.join(dir, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, text);
  }
  return dir;
}

export function fixture(name) {
  return fs.readFileSync(path.join(FIXTURES, name), 'utf8');
}

/** 1-based number of the first line containing needle. */
export function lineOf(text, needle) {
  const i = text.split(/\r?\n/).findIndex((l) => l.includes(needle));
  if (i < 0) throw new Error(`needle not in text: ${needle}`);
  return i + 1;
}

export function run(args, { cwd, env = {}, input } = {}) {
  const r = spawnSync(process.execPath, [BIN, ...args], {
    cwd,
    input: input ?? '',
    encoding: 'utf8',
    env: { PATH: process.env.PATH, HOME: process.env.HOME, NO_COLOR: '1', ...env },
  });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
}

/** Start an HTTP server on a free port. handler(req, res, body). Returns { url, requests, close }. */
export async function stubServer(handler) {
  const requests = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      requests.push({ method: req.method, url: req.url, headers: req.headers });
      handler(req, res, Buffer.concat(chunks).toString());
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  return { url, requests, close: () => new Promise((resolve) => { server.closeAllConnections?.(); server.close(resolve); }) };
}

export function json(res, status, body, headers = {}) {
  res.writeHead(status, { 'content-type': 'application/json', ...headers });
  res.end(JSON.stringify(body));
}
