import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseYaml, toJS, YamlError } from '../src/yaml.mjs';

const js = (text) => toJS(parseYaml(text).docs[0]);

test('block maps, nested maps and lists', () => {
  assert.deepEqual(js('a: 1\nb:\n  c: two\n  d:\n    - x\n    - y\n'), { a: '1', b: { c: 'two', d: ['x', 'y'] } });
});

test('a list at the same indent as its key', () => {
  assert.deepEqual(js('a:\n- x\n- "y"\nb: z\n'), { a: ['x', 'y'], b: 'z' });
});

test('lists of maps, with the first key on the dash line', () => {
  assert.deepEqual(
    js('v:\n  - type: bind\n    source: ./d\n  - type: volume\n    source: c\n'),
    { v: [{ type: 'bind', source: './d' }, { type: 'volume', source: 'c' }] },
  );
});

test('quoted scalars keep comment characters and colons, and unescape', () => {
  assert.deepEqual(js('a: "x # y: z"\nb: \'it\'\'s\'\nc: "tab\\there"\n'), { a: 'x # y: z', b: "it's", c: 'tab\there' });
});

test('comments are dropped only where YAML drops them', () => {
  assert.deepEqual(js('a: b # gone\nc: d#kept\n# whole line\ne:   f   \n'), { a: 'b', c: 'd#kept', e: 'f' });
});

test('flow sequences and maps, including across lines', () => {
  assert.deepEqual(js('a: [1, "b c", {d: e}]\nf: {g: [h, i], j: k}\nl: [\n  m,\n  n\n]\n'),
    { a: ['1', 'b c', { d: 'e' }], f: { g: ['h', 'i'], j: 'k' }, l: ['m', 'n'] });
});

test('null, tilde and empty values are null', () => {
  assert.deepEqual(js('a:\nb: ~\nc: null\nd: x\n'), { a: null, b: null, c: null, d: 'x' });
});

test('block scalars are read as text, not as structure', () => {
  const v = js('a: |\n  image: fake\n  more: lines\nb: >-\n  folded\n  text\nc: d\n');
  assert.match(v.a, /image: fake\nmore: lines/);
  assert.equal(v.b, 'folded text');
  assert.equal(v.c, 'd');
});

test('anchors, aliases and merge keys', () => {
  const v = js('base: &b\n  x: 1\n  y: 2\nuse:\n  <<: *b\n  y: 3\nlist:\n  <<: [*b, {z: 9}]\nsc: &s hello\nre: *s\n');
  assert.deepEqual(v.use, { x: '1', y: '3' });
  assert.deepEqual(v.list, { x: '1', y: '2', z: '9' });
  assert.equal(v.re, 'hello');
});

test('multi-document files', () => {
  const { docs } = parseYaml('---\na: 1\n---\nb: 2\n...\n---\nc: 3\n');
  assert.deepEqual(docs.map(toJS), [{ a: '1' }, { b: '2' }, { c: '3' }]);
});

test('CRLF line endings', () => {
  assert.deepEqual(js('a: b\r\nc:\r\n  - d\r\n'), { a: 'b', c: ['d'] });
});

test('every node carries the line it was written on', () => {
  const { docs } = parseYaml('services:\n  web:\n    image: nginx\n');
  const services = docs[0].entries[0].node;
  assert.equal(docs[0].entries[0].kline, 1);
  assert.equal(services.entries[0].kline, 2);
  assert.equal(services.entries[0].node.entries[0].kline, 3);
  assert.equal(services.entries[0].node.entries[0].node.line, 3);
});

test('an empty document parses to nothing', () => {
  assert.deepEqual(parseYaml('').docs.map(toJS), []);
  assert.deepEqual(parseYaml('# only a comment\n').docs.map(toJS), []);
});

const BAD = [
  ['a tab used for indentation', 'services:\n\tweb:\n\t\timage: x\n', 2, /tab/i],
  ['an unterminated double quote', 'services:\n  web:\n    image: "nginx:1\n    restart: always\n', 3, /unterminated/i],
  ['an unterminated single quote', 'services:\n  web:\n    image: \'nginx\n', 3, /unterminated/i],
  ['an indent that matches no outer level', 'services:\n    web:\n      image: x\n  db:\n    image: y\n', 4, /indent/i],
  ['a duplicate key', 'services:\n  web:\n    image: a\n    image: b\n', 4, /duplicate/i],
  ['an unterminated flow sequence', 'services:\n  web:\n    ports: ["80:80", "81:81"\n    image: x\n', 3, /unterminated|unclosed/i],
  ['a map key inside a plain scalar', 'services:\n  web\n    image: x\n', 3, /mapping|key|colon/i],
  ['a list item where a key is expected', 'services:\n  web:\n    image: x\n  - oops\n', 4, /list|expected|unexpected/i],
  ['an alias with no anchor', 'services:\n  web:\n    <<: *nope\n    image: x\n', 3, /alias/i],
];
for (const [name, text, line, re] of BAD) {
  test(`malformed: ${name} reports line ${line}`, () => {
    assert.throws(() => parseYaml(text), (e) => {
      assert.ok(e instanceof YamlError, `expected YamlError, got ${e}`);
      assert.equal(e.line, line);
      assert.match(e.message, re);
      return true;
    });
  });
}

test('garbage input never throws anything but YamlError', () => {
  const samples = ['{{{{', ']]]', '- - - -', ': : :', '"', "'", '&', '*', '!!', '? a\n: b', 'a: [', 'a: {b', '%YAML 1.1\n---\na: 1', '\x00\x01', 'a:\n  - b\n c: d'];
  for (const s of samples) {
    try { parseYaml(s); } catch (e) { assert.ok(e instanceof YamlError, `${JSON.stringify(s)} threw ${e}`); assert.ok(e.line >= 1); }
  }
});
