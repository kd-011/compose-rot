// Pull every service `image:` out of a compose file, with the line it was written on.
import { getEntry, mapEntries, parseYaml } from './yaml.mjs';
import { parseImage } from './image.mjs';

const OPEN = '\u0001';
const CLOSE = '\u0002';
const NAME = /[A-Za-z_][A-Za-z0-9_]*/y;

/**
 * Expand $VAR, ${VAR}, ${VAR:-default}, ${VAR-default}, ${VAR:+alt}, ${VAR:?err} and $$.
 * Values come from `env` (a .env file), then the written default. A variable with neither
 * is left as a marker and recorded as unresolved. Returns { value, vars }.
 */
export function interpolate(str, env = {}) {
  const vars = [];
  const lookup = (name) => (Object.hasOwn(env, name) ? env[name] : undefined);
  const note = (name, source) => vars.push({ name, source });
  const unresolved = (name) => { note(name, 'unresolved'); return `${OPEN}${name}${CLOSE}`; };

  function expand(s) {
    let out = '';
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (c !== '$') { out += c; continue; }
      const n = s[i + 1];
      if (n === '$') { out += '$'; i++; continue; }
      if (n === '{') {
        let depth = 1;
        let j = i + 2;
        for (; j < s.length && depth > 0; j++) {
          if (s[j] === '{') depth++;
          else if (s[j] === '}') depth--;
        }
        if (depth > 0) { out += s.slice(i); break; }
        out += braced(s.slice(i + 2, j - 1));
        i = j - 1;
        continue;
      }
      NAME.lastIndex = i + 1;
      const m = NAME.exec(s);
      if (!m) { out += c; continue; }
      const v = lookup(m[0]);
      if (v !== undefined && v !== '') { note(m[0], 'env'); out += v; } else out += unresolved(m[0]);
      i += m[0].length;
    }
    return out;
  }

  function braced(inner) {
    NAME.lastIndex = 0;
    const m = NAME.exec(inner);
    if (!m) return `\${${inner}}`;
    const name = m[0];
    const op = inner.slice(name.length);
    const v = lookup(name);
    const set = v !== undefined;
    const filled = set && v !== '';
    if (op === '') return filled ? (note(name, 'env'), v) : unresolved(name);
    const colon = op[0] === ':';
    const kind = op[colon ? 1 : 0];
    const arg = op.slice(colon ? 2 : 1);
    const present = colon ? filled : set;
    if (kind === '-') { if (present) { note(name, 'env'); return v; } note(name, 'default'); return expand(arg); }
    if (kind === '+') { if (present) { note(name, 'env'); return expand(arg); } return ''; }
    if (kind === '?') return present ? (note(name, 'env'), v) : unresolved(name);
    return `\${${inner}}`;
  }

  return { value: expand(String(str)), vars };
}

const show = (value) => value.replace(new RegExp(`${OPEN}([^${CLOSE}]*)${CLOSE}`, 'g'), (_, n) => `\${${n}}`);

function describe(raw, env) {
  const { value, vars } = interpolate(raw, env);
  const out = { raw, resolved: show(value), vars, ref: null, tagUnresolved: false, reason: null };
  if (!value.includes(OPEN)) {
    out.ref = parseImage(value);
    if (!out.ref) out.reason = 'not a valid image reference';
    return out;
  }
  const slash = value.lastIndexOf('/');
  const head = value.slice(0, slash + 1);
  const tail = value.slice(slash + 1);
  const cut = tail.search(/[:@]/);
  const name = head + (cut < 0 ? tail : tail.slice(0, cut));
  if (name.includes(OPEN)) {
    const v = vars.find((x) => x.source === 'unresolved');
    out.reason = `the image name contains the variable \${${v?.name ?? '?'}}, which has no value or default`;
    return out;
  }
  out.ref = parseImage(name);
  if (!out.ref) { out.reason = 'not a valid image reference'; return out; }
  out.tagUnresolved = true;
  return out;
}

const RESERVED = new Set(['version', 'name', 'services', 'networks', 'volumes', 'secrets', 'configs', 'include', 'models']);

function serviceMaps(root) {
  const services = getEntry(root, 'services');
  if (services) return services.node?.t === 'map' ? mapEntries(services.node) : [];
  // Compose v1: service names at the top level.
  return mapEntries(root).filter((e) => !RESERVED.has(e.k) && !e.k.startsWith('x-') && e.node?.t === 'map' && getEntry(e.node, 'image'));
}

/**
 * Every service image in a compose file, in file order:
 * { service, line, raw, resolved, vars, ref, tagUnresolved, reason }.
 * `line` is where the `image:` key was written (for an image that comes from a merge key
 * or an alias, the line in the anchor). Throws YamlError for a file that does not parse.
 * extends and profiles are ignored: a service in a profile still counts.
 */
export function extractImages(text, { env = {} } = {}) {
  const found = [];
  for (const root of parseYaml(text).docs) {
    if (root.t !== 'map') continue;
    for (const svc of serviceMaps(root)) {
      if (svc.node?.t !== 'map') continue;
      const image = getEntry(svc.node, 'image');
      if (!image || image.node?.t !== 'scalar' || image.node.v == null) continue;
      const raw = String(image.node.v).trim();
      if (!raw) continue;
      found.push({ service: svc.k, line: image.kline, ...describe(raw, env) });
    }
  }
  return found;
}

/** Parse a .env file into a map. Only the keys asked for by image strings are ever used or shown. */
export function parseDotenv(text) {
  const env = {};
  for (const line of String(text).split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"') && v.length > 1) || (v.startsWith("'") && v.endsWith("'") && v.length > 1)) v = v.slice(1, -1);
    else v = v.replace(/\s+#.*$/, '');
    env[m[1]] = v;
  }
  return env;
}
