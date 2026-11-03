import fs from 'node:fs';
import path from 'node:path';
import { globMatch } from './known.mjs';

const SKIP = new Set(['node_modules', '.git']);
const NAMES = [/^(docker-)?compose(\..+)?\.ya?ml$/i, /^docker-compose.*\.ya?ml$/i, /\.compose\.ya?ml$/i];
export const isComposeName = (name) => NAMES.some((re) => re.test(name));

/**
 * Compose files under the given files and directories. Directories are walked
 * recursively, skipping node_modules and .git and never following symlinked
 * directories. A file named directly is always returned. A directory that cannot be
 * read inside a walk is listed in `skipped`; a path named directly that cannot be read is an error. `exclude` is a list of
 * globs matched against a directory's name and its full path; a match is not entered
 * (use it for a network mount that hangs).
 */
export function findComposeFiles(paths, { exclude = [] } = {}) {
  const files = [];
  const errors = [];
  const skippedDirs = [];
  const seen = new Set();
  const skipped = (name, full) => SKIP.has(name) || exclude.some((g) => globMatch(g, name) || globMatch(g, full));
  const add = (p, viaLink = false) => {
    let key = path.resolve(p);
    if (viaLink) { try { key = fs.realpathSync(p); } catch { /* keep the resolved path */ } }
    if (seen.has(key)) return;
    seen.add(key);
    files.push(p);
  };
  const walk = (dir) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) {
      skippedDirs.push({ path: dir, reason: e.code ?? e.message });
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (!skipped(e.name, p)) walk(p); }
      else if (e.isFile() && isComposeName(e.name)) add(p);
      else if (e.isSymbolicLink() && isComposeName(e.name)) {
        try { if (fs.statSync(p).isFile()) add(p, true); } catch { /* dangling link */ }
      }
    }
  };
  for (const p of paths) {
    let st;
    try { st = fs.statSync(p); } catch (e) {
      errors.push({ file: p, line: null, message: e.code === 'ENOENT' ? 'no such file or directory' : `cannot read: ${e.code ?? e.message}` });
      continue;
    }
    if (st.isDirectory()) walk(p); else add(p, true);
  }
  return { files, errors, skipped: skippedDirs };
}
