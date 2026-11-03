// A small YAML reader for the subset compose files use: block maps and lists,
// flow [] and {}, quoted and plain scalars, block scalars, anchors, aliases,
// `<<` merge keys, comments and multi-document files. Values stay strings
// (null for empty, ~ and null), because the only question asked of a compose
// file is "what text is written here, and on which line".
//
// Not supported, and reported as an error rather than guessed: `? ` complex keys.
// Tags such as !!str are skipped. Every node records the line it was written on.

export class YamlError extends Error {
  constructor(message, line, col = 1) {
    super(message);
    this.name = 'YamlError';
    this.line = line;
    this.col = col;
  }
}

const isSpace = (c) => c === ' ' || c === '\t';

/** Cut a trailing comment. Quote-aware; the result is always a prefix of the input. */
export function stripComment(s) {
  let quote = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quote === '"') {
      if (c === '\\') i++;
      else if (c === '"') quote = null;
    } else if (quote === "'") {
      if (c === "'") {
        if (s[i + 1] === "'") i++;
        else quote = null;
      }
    } else if (c === '#' && (i === 0 || isSpace(s[i - 1]))) {
      return s.slice(0, i);
    } else if ((c === '"' || c === "'") && (i === 0 || isSpace(s[i - 1]) || '[{,'.includes(s[i - 1]))) {
      quote = c;
    }
  }
  return s;
}

const ESCAPES = { 0: '\0', a: '\x07', b: '\b', t: '\t', '\t': '\t', n: '\n', v: '\v', f: '\f', r: '\r', e: '\x1b', ' ': ' ', '"': '"', '/': '/', '\\': '\\', N: '\x85', _: '\xa0', L: ' ', P: ' ' };

function decodeDouble(body, line) {
  let out = '';
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c !== '\\') { out += c; continue; }
    const n = body[++i];
    if (n in ESCAPES) out += ESCAPES[n];
    else if (n === 'x' || n === 'u' || n === 'U') {
      const len = n === 'x' ? 2 : n === 'u' ? 4 : 8;
      const hex = body.slice(i + 1, i + 1 + len);
      if (!new RegExp(`^[0-9a-fA-F]{${len}}$`).test(hex)) throw new YamlError(`invalid \\${n} escape in a quoted string`, line);
      out += String.fromCodePoint(parseInt(hex, 16));
      i += len;
    } else throw new YamlError(`unknown escape \\${n ?? ''} in a quoted string`, line);
  }
  return out;
}

const scalar = (v, line, quoted = false) => ({ t: 'scalar', v, line, quoted });

function plainValue(text, line) {
  const v = text.trim();
  if (v === '' || v === '~' || /^(null|Null|NULL)$/.test(v)) return scalar(null, line);
  return scalar(v, line);
}

/** Split `key: rest`. Returns null when the text is not a mapping entry. */
function splitKey(s, line) {
  if (s.startsWith('? ') || s === '?') throw new YamlError('complex mapping keys ("? ") are not supported', line);
  const first = s[0];
  if (first === '"' || first === "'") {
    let i = 1;
    for (; i < s.length; i++) {
      if (first === '"' && s[i] === '\\') { i++; continue; }
      if (s[i] === first) {
        if (first === "'" && s[i + 1] === "'") { i++; continue; }
        break;
      }
    }
    if (i >= s.length) return null;
    let j = i + 1;
    while (isSpace(s[j])) j++;
    if (s[j] !== ':' || (j + 1 < s.length && !isSpace(s[j + 1]))) return null;
    const body = s.slice(1, i);
    return { key: first === '"' ? decodeDouble(body, line) : body.replace(/''/g, "'"), rest: j + 1, quoted: true };
  }
  if (first === '[' || first === '{' || first === '&' || first === '*' || first === '!' || first === '|' || first === '>') return null;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === ':' && (i + 1 === s.length || isSpace(s[i + 1]))) {
      const key = s.slice(0, i).trim();
      if (!key) return null;
      return { key, rest: i + 1, quoted: false };
    }
  }
  return null;
}

const isSeqItem = (s) => s === '-' || s.startsWith('- ') || s.startsWith('-\t');

class Doc {
  constructor(lines) {
    this.lines = lines; // { no, text, indent }
    this.pos = 0;
    this.anchors = new Map();
  }

  sig(l) { return stripComment(l.text).trimEnd(); }

  /** Next line that is not blank or a comment. Leaves pos on it. */
  peek() {
    while (this.pos < this.lines.length) {
      const l = this.lines[this.pos];
      if (this.sig(l).trim() === '') { this.pos++; continue; }
      if (l.tabIndent) throw new YamlError('tab characters cannot be used for indentation', l.no);
      return l;
    }
    return null;
  }

  parseRoot() {
    const first = this.peek();
    if (!first) return null;
    const node = this.parseBlock(-1);
    const extra = this.peek();
    if (extra) throw new YamlError('unexpected content: indentation does not match the surrounding block', extra.no, extra.indent + 1);
    return node;
  }

  /** The block that starts on the next significant line, if it is indented deeper than parentIndent. */
  parseBlock(parentIndent) {
    const ln = this.peek();
    if (!ln || ln.indent <= parentIndent) return null;
    const s = this.sig(ln).trim();
    if (isSeqItem(s)) return this.parseSeq(ln.indent);
    if (!s.startsWith('&') && splitKey(this.sig(ln), ln.no)) return this.parseMap(ln.indent);
    this.pos++;
    return this.parseValue(ln.text, ln, parentIndent);
  }

  parseSeq(indent) {
    const startLine = this.peek().no;
    const items = [];
    for (;;) {
      const ln = this.peek();
      if (!ln || ln.indent < indent) break;
      if (ln.indent > indent) throw new YamlError('bad indentation of a list item', ln.no, ln.indent + 1);
      const s = this.sig(ln).trim();
      if (!isSeqItem(s)) break;
      const dash = ln.text.indexOf('-');
      const after = ln.text.slice(dash + 1);
      if (stripComment(after).trim() === '') {
        this.pos++;
        items.push(this.parseBlock(indent) ?? scalar(null, ln.no));
      } else {
        const lead = after.length - after.trimStart().length;
        ln.indent = indent + 1 + lead;
        ln.text = after.trimStart();
        items.push(this.parseBlock(indent));
      }
    }
    return { t: 'seq', items, line: startLine };
  }

  parseMap(indent) {
    const startLine = this.peek().no;
    const entries = [];
    const seen = new Set();
    for (;;) {
      const ln = this.peek();
      if (!ln || ln.indent < indent) break;
      if (ln.indent > indent) throw new YamlError('bad indentation of a mapping entry', ln.no, ln.indent + 1);
      const s = this.sig(ln);
      if (isSeqItem(s.trim())) throw new YamlError('unexpected list item where a mapping key was expected', ln.no, ln.indent + 1);
      const ki = splitKey(s, ln.no);
      if (!ki) throw new YamlError(`expected "key: value" but found "${s.trim().slice(0, 40)}"`, ln.no, ln.indent + 1);
      if (ki.key !== '<<' && seen.has(ki.key)) throw new YamlError(`duplicate key "${ki.key}"`, ln.no, ln.indent + 1);
      seen.add(ki.key);
      this.pos++;
      const node = this.parseValue(ln.text.slice(ki.rest), ln, indent, { sameIndentSeq: true });
      entries.push({ k: ki.key, kline: ln.no, node });
    }
    return { t: 'map', entries, line: startLine };
  }

  /**
   * Parse the value whose text starts at `raw` on line `ln`. The line has already been consumed.
   * ownerIndent is the indent of the key (or dash) that owns the value.
   */
  parseValue(raw, ln, ownerIndent, { sameIndentSeq = false } = {}) {
    let s = raw.trimStart();
    let anchor = null;
    for (;;) {
      const m = /^([&!])(\S*)\s*/.exec(s);
      if (!m) break;
      if (m[1] === '&') anchor = m[2];
      s = s.slice(m[0].length);
    }
    const body = stripComment(s).trim();
    let node;
    if (body === '') {
      const next = this.peek();
      if (next && next.indent > ownerIndent) node = this.parseBlock(ownerIndent);
      else if (sameIndentSeq && next && next.indent === ownerIndent && isSeqItem(this.sig(next).trim())) node = this.parseSeq(ownerIndent);
      node ??= scalar(null, ln.no);
    } else if (body[0] === '*') {
      const name = body.slice(1);
      const target = this.anchors.get(name);
      if (!/^[^\s,[\]{}]+$/.test(name)) throw new YamlError(`invalid alias "${body}"`, ln.no);
      if (!target) throw new YamlError(`alias *${name} refers to an anchor that was not defined`, ln.no);
      node = target;
    } else if (body[0] === '|' || body[0] === '>') {
      node = this.blockScalar(body, ln, ownerIndent);
    } else if (body[0] === '[' || body[0] === '{') {
      node = this.flow(s, ln);
    } else if (body[0] === '"' || body[0] === "'") {
      node = this.quoted(s, ln);
    } else {
      node = this.plain(body, ln, ownerIndent);
    }
    if (anchor) this.anchors.set(anchor, node);
    return node;
  }

  plain(body, ln, ownerIndent) {
    let text = body;
    for (;;) {
      const next = this.peek();
      if (!next || next.indent <= ownerIndent) break;
      const t = this.sig(next).trim();
      if (splitKey(t, next.no)) throw new YamlError('mapping values are not allowed inside a plain scalar (is a quote or indent missing?)', next.no, next.indent + 1);
      text += ` ${t}`;
      this.pos++;
    }
    return plainValue(text, ln.no);
  }

  blockScalar(header, ln, ownerIndent) {
    const folded = header[0] === '>';
    const lines = [];
    let blockIndent = null;
    while (this.pos < this.lines.length) {
      const l = this.lines[this.pos];
      const blank = l.text.trim() === '';
      if (!blank) {
        if (blockIndent === null) {
          if (l.indent <= ownerIndent) break;
          blockIndent = l.indent;
        } else if (l.indent < blockIndent) break;
      }
      lines.push(blank ? '' : ' '.repeat(l.indent - blockIndent) + l.text);
      this.pos++;
    }
    while (lines.length && lines[lines.length - 1] === '') lines.pop();
    const text = folded ? lines.join(' ').replace(/ {2,}/g, ' ').trim() : lines.join('\n');
    return scalar(text, ln.no, true);
  }

  quoted(s, ln) {
    const q = s[0];
    let text = s;
    let end = this.closingQuote(text, q);
    let last = ln;
    while (end < 0) {
      if (this.pos >= this.lines.length) throw new YamlError(`unterminated ${q === '"' ? 'double' : 'single'}-quoted string`, ln.no, ln.indent + 1);
      last = this.lines[this.pos++];
      const joiner = q === '"' && /\\$/.test(text) && !/\\\\$/.test(text) ? '' : ' ';
      text = (joiner === '' ? text.slice(0, -1) : text.trimEnd()) + joiner + last.text.trim();
      end = this.closingQuote(text, q);
    }
    const tail = stripComment(text.slice(end + 1)).trim();
    if (tail !== '') throw new YamlError(`unexpected text after a quoted string: "${tail.slice(0, 30)}"`, last.no);
    const body = text.slice(1, end);
    return scalar(q === '"' ? decodeDouble(body, ln.no) : body.replace(/''/g, "'"), ln.no, true);
  }

  closingQuote(text, q) {
    for (let i = 1; i < text.length; i++) {
      if (q === '"' && text[i] === '\\') { i++; continue; }
      if (text[i] === q) {
        if (q === "'" && text[i + 1] === "'") { i++; continue; }
        return i;
      }
    }
    return -1;
  }

  flow(first, ln) {
    // Gather text (and the line of each character) until the brackets balance. Quote and
    // bracket state carry across lines, so a quoted string may wrap inside a flow sequence.
    let src = '';
    const lineAt = [];
    const st = { quote: null, depth: 0 };
    const feed = (line, no, lead) => {
      let kept = lead;
      for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (st.quote === '"') { kept += c; if (c === '\\') { kept += line[++i] ?? ''; } else if (c === '"') st.quote = null; continue; }
        if (st.quote === "'") {
          kept += c;
          if (c === "'") { if (line[i + 1] === "'") kept += line[++i]; else st.quote = null; }
          continue;
        }
        if (c === '#' && (i === 0 || isSpace(line[i - 1]))) break;
        if ((c === '"' || c === "'") && (i === 0 || isSpace(line[i - 1]) || '[{,:'.includes(line[i - 1]))) st.quote = c;
        else if (c === '[' || c === '{') st.depth++;
        else if (c === ']' || c === '}') st.depth--;
        kept += c;
      }
      kept = st.quote ? kept : kept.trimEnd();
      src += kept;
      for (let i = 0; i < kept.length; i++) lineAt.push(no);
    };
    feed(first.trimEnd(), ln.no, '');
    while (st.depth > 0 || st.quote) {
      if (this.pos >= this.lines.length) throw new YamlError('unterminated flow collection (missing ] or })', ln.no, ln.indent + 1);
      const l = this.lines[this.pos++];
      feed(l.text.trim(), l.no, ' ');
    }
    const p = new Flow(src, lineAt, this.anchors, ln.no);
    const node = p.parseValue();
    p.skipWs();
    if (p.i < src.length) throw new YamlError('unexpected text after a flow collection', p.lineHere());
    return node;
  }
}

class Flow {
  constructor(src, lineAt, anchors, startLine) {
    this.src = src;
    this.lineAt = lineAt;
    this.anchors = anchors;
    this.startLine = startLine;
    this.i = 0;
  }

  lineHere() { return this.lineAt[Math.min(this.i, this.lineAt.length - 1)] ?? this.startLine; }
  skipWs() { while (this.i < this.src.length && /\s/.test(this.src[this.i])) this.i++; }

  parseValue() {
    this.skipWs();
    const c = this.src[this.i];
    const line = this.lineHere();
    if (c === '[') return this.seq();
    if (c === '{') return this.map();
    if (c === '"' || c === "'") return this.quoted();
    if (c === '*') {
      const m = /^\*([^\s,[\]{}]+)/.exec(this.src.slice(this.i));
      if (!m) throw new YamlError('invalid alias', line);
      const target = this.anchors.get(m[1]);
      if (!target) throw new YamlError(`alias *${m[1]} refers to an anchor that was not defined`, line);
      this.i += m[0].length;
      return target;
    }
    if (c === '&' || c === '!') {
      const m = /^[&!]\S*\s*/.exec(this.src.slice(this.i));
      this.i += m[0].length;
      return this.parseValue();
    }
    return this.plain(false);
  }

  quoted() {
    const q = this.src[this.i];
    const line = this.lineHere();
    let j = this.i + 1;
    for (; j < this.src.length; j++) {
      if (q === '"' && this.src[j] === '\\') { j++; continue; }
      if (this.src[j] === q) {
        if (q === "'" && this.src[j + 1] === "'") { j++; continue; }
        break;
      }
    }
    if (j >= this.src.length) throw new YamlError('unterminated quoted string in a flow collection', line);
    const body = this.src.slice(this.i + 1, j);
    this.i = j + 1;
    return scalar(q === '"' ? decodeDouble(body, line) : body.replace(/''/g, "'"), line, true);
  }

  plain(inKey) {
    const line = this.lineHere();
    let j = this.i;
    for (; j < this.src.length; j++) {
      const c = this.src[j];
      if (c === ',' || c === ']' || c === '}') break;
      if (c === ':' && (j + 1 >= this.src.length || /[\s,\]}]/.test(this.src[j + 1]))) { if (inKey) break; }
    }
    const text = this.src.slice(this.i, j);
    this.i = j;
    return plainValue(text, line);
  }

  seq() {
    const line = this.lineHere();
    this.i++;
    const items = [];
    for (;;) {
      this.skipWs();
      if (this.i >= this.src.length) throw new YamlError('unterminated flow sequence (missing ])', line);
      if (this.src[this.i] === ']') { this.i++; break; }
      const startAt = this.i;
      const v = this.parseValue();
      if (v.t === 'scalar' && v.v === null && !v.quoted && this.i === startAt) throw new YamlError('empty item in a flow sequence', this.lineHere());
      items.push(v);
      this.skipWs();
      if (this.src[this.i] === ',') this.i++;
      else if (this.src[this.i] !== ']') throw new YamlError('expected "," or "]" in a flow sequence', this.lineHere());
    }
    return { t: 'seq', items, line };
  }

  map() {
    const line = this.lineHere();
    this.i++;
    const entries = [];
    for (;;) {
      this.skipWs();
      if (this.i >= this.src.length) throw new YamlError('unterminated flow mapping (missing })', line);
      if (this.src[this.i] === '}') { this.i++; break; }
      const kline = this.lineHere();
      const kc = this.src[this.i];
      const keyNode = kc === '"' || kc === "'" ? this.quoted() : this.plain(true);
      const key = keyNode.v ?? '';
      this.skipWs();
      let node = scalar(null, kline);
      if (this.src[this.i] === ':') {
        this.i++;
        this.skipWs();
        if (this.src[this.i] !== ',' && this.src[this.i] !== '}') node = this.parseValue();
      }
      entries.push({ k: key, kline, node });
      this.skipWs();
      if (this.src[this.i] === ',') this.i++;
      else if (this.src[this.i] !== '}') throw new YamlError('expected "," or "}" in a flow mapping', this.lineHere());
    }
    return { t: 'map', entries, line };
  }
}

function splitDocuments(text) {
  const raw = text.replace(/^﻿/, '').split(/\r?\n/);
  const docs = [];
  let cur = [];
  const flush = () => { if (cur.length) docs.push(cur); cur = []; };
  raw.forEach((t, i) => {
    const no = i + 1;
    if (/^---(\s|$)/.test(t)) {
      flush();
      const rest = t.slice(3);
      if (stripComment(rest).trim() !== '') cur.push({ no, text: rest.trimStart(), indent: 0 });
      return;
    }
    if (/^\.\.\.(\s|$)/.test(t)) { flush(); return; }
    if (cur.length === 0 && /^%/.test(t)) return;
    const indentMatch = /^[ \t]*/.exec(t)[0];
    cur.push({
      no,
      text: t.slice(indentMatch.length),
      indent: indentMatch.replace(/\t/g, '').length,
      tabIndent: indentMatch.includes('\t'),
    });
  });
  flush();
  return docs;
}

/** Parse a YAML string. Returns { docs: Node[] }. Throws YamlError with a 1-based line. */
export function parseYaml(text) {
  const docs = [];
  let current = 1;
  try {
    for (const lines of splitDocuments(String(text))) {
      current = lines[0]?.no ?? current;
      const doc = new Doc(lines);
      const node = doc.parseRoot();
      if (node) docs.push(node);
    }
  } catch (e) {
    if (e instanceof YamlError) throw e;
    throw new YamlError(`could not parse this file (${e.message})`, current);
  }
  return { docs };
}

/** The entries of a map after applying `<<` merge keys. Own keys win, then earlier merge sources. */
export function mapEntries(node) {
  if (!node || node.t !== 'map') return [];
  const out = [];
  const have = new Set();
  const take = (e) => { if (!have.has(e.k)) { have.add(e.k); out.push(e); } };
  const merges = [];
  for (const e of node.entries) {
    if (e.k === '<<') merges.push(e.node); else take(e);
  }
  const sources = (n) => (n.t === 'seq' ? n.items : [n]);
  for (const m of merges) for (const src of sources(m)) for (const e of mapEntries(src)) take(e);
  return out;
}

export function getEntry(node, key) {
  return mapEntries(node).find((e) => e.k === key) ?? null;
}

export function toJS(node) {
  if (!node) return null;
  if (node.t === 'scalar') return node.v;
  if (node.t === 'seq') return node.items.map(toJS);
  return Object.fromEntries(mapEntries(node).map((e) => [e.k, toJS(e.node)]));
}
