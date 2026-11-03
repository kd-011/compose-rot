// Image extraction over 18 compose files written the way people write them.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { extractImages } from '../src/compose.mjs';
import { fixture, lineOf } from '../test-support/helpers.mjs';

// [file, [needle on the `image:` key line, service, resolved image]]
// The line reported is the line of the `image:` key, wherever the text was written.
const TABLE = {
  '01-plain.yml': [
    ['image: nginx:1.27', 'web', 'nginx:1.27'],
    ['image: postgres:16-alpine', 'db', 'postgres:16-alpine'],
    ['image: "redis:7"', 'cache', 'redis:7'],
    ["image: 'rabbitmq:3-management'", 'queue', 'rabbitmq:3-management'],
  ],
  '02-version-header.yml': [
    ['image: ghcr.io/example/app:1.4.2', 'app', 'ghcr.io/example/app:1.4.2'],
    ['image: traefik:v3.1', 'proxy', 'traefik:v3.1'],
  ],
  '03-anchors-merge.yml': [
    ['image: ghcr.io/example/app:1.2.3', 'app1', 'ghcr.io/example/app:1.2.3'],
    ['image: ghcr.io/example/app:2.0.0', 'app2', 'ghcr.io/example/app:2.0.0'],
    ['image: ghcr.io/example/worker', 'worker', 'ghcr.io/example/worker'],
  ],
  '05-longform-quotes-comments.yml': [
    ['image: "redis:7" # cache', 'cache', 'redis:7'],
    ['minio/minio:RELEASE', 'storage', 'minio/minio:RELEASE.2025-04-22T22-12-26Z'],
    ['image: ghcr.io/org/app@sha256:0123', 'pinned', 'ghcr.io/org/app@sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'],
    ['image: ghcr.io/org/tool:2.1@sha', 'both', 'ghcr.io/org/tool:2.1@sha256:fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210'],
    ['image: nginx # comment with', 'noisy', 'nginx'],
    ['example/odd#tag:1', 'hash', 'example/odd#tag:1'],
  ],
  '06-multi-document.yml': [
    ['alpine:3.20', 'first', 'alpine:3.20'],
    ['busybox:1.36', 'second', 'busybox:1.36'],
    ['debian:12', 'third', 'debian:12'],
  ],
  '07-crlf.yml': [
    ['image: nginx:stable', 'crlf', 'nginx:stable'],
    ['image: "caddy:2"', 'other', 'caddy:2'],
  ],
  '08-profiles-extends.yml': [
    ['example/base:1', 'base', 'example/base:1'],
    ['registry.example.com:8443/team/built', 'built-and-named', 'registry.example.com:8443/team/built:latest'],
    ['example/tools:9', 'tools', 'example/tools:9'],
  ],
  '09-flow-style.yml': [
    ['inline: {image: nginx:1.25', 'inline', 'nginx:1.25'],
    ['image: redis:7.2', 'mixed', 'redis:7.2'],
    ['image: mariadb:11', 'multiline', 'mariadb:11'],
  ],
  '10-block-scalars.yml': [
    ['image: alpine:3.20', 'script', 'alpine:3.20'],
    ['image: busybox:1.36', 'folded', 'busybox:1.36'],
    ['image: debian:12', 'strip', 'debian:12'],
  ],
  '11-env-and-labels.yml': [['image: ghcr.io/example/app:3', 'app', 'ghcr.io/example/app:3']],
  '12-registry-forms.yml': [
    ['localhost:5000/app:dev', 'local', 'localhost:5000/app:dev'],
    ['registry.example.com:8443/team/app:1', 'private', 'registry.example.com:8443/team/app:1'],
    ['docker.io/library/nginx', 'explicit-hub', 'docker.io/library/nginx'],
    ['index.docker.io/grafana', 'index-hub', 'index.docker.io/grafana/grafana:11.0.0'],
    ['lscr.io/linuxserver/sonarr', 'lscr', 'lscr.io/linuxserver/sonarr:latest'],
    ['quay.io/prometheus', 'quay', 'quay.io/prometheus/prometheus:v2.53.0'],
    ['gcr.io/example-project', 'gcr', 'gcr.io/example-project/img:1'],
    ['mcr.microsoft.com', 'mcr', 'mcr.microsoft.com/mssql/server:2022-latest'],
    ['ghcr.io/org/sub/path/tool', 'deep', 'ghcr.io/org/sub/path/tool:0.9'],
  ],
  '13-v1-legacy.yml': [
    ['image: nginx:1.19', 'web', 'nginx:1.19'],
    ['image: mysql:5.7', 'db', 'mysql:5.7'],
  ],
  '14-long-form-volumes.yml': [['image: example/app:5', 'app', 'example/app:5']],
  '15-quoted-keys-and-anchored-scalars.yml': [
    ['"image": "nginx:1.26"', 'quoted', 'nginx:1.26'],
    ['image: !!str nginx:1.25', 'tagged', 'nginx:1.25'],
    ['image: &img postgres:15', 'anchored', 'postgres:15'],
    ['image: *img', 'reused', 'postgres:15'],
    ['image: example/dotted:1', 'dotted.name', 'example/dotted:1'],
  ],
  '16-multiline-values.yml': [
    ['image: >-', 'folded-image', 'ghcr.io/example/folded:1.0'],
    ['image: "ghcr.io/example/\\', 'quoted-wrap', 'ghcr.io/example/wrapped:2.0'],
  ],
  '17-unindented-sequences.yml': [
    ['image: busybox', 'a', 'busybox'],
    ['image: alpine', 'b', 'alpine'],
  ],
  '18-nulls-and-empties.yml': [['image: nginx', 'real', 'nginx']],
};

for (const [file, expected] of Object.entries(TABLE)) {
  test(`extracts the images of ${file}`, () => {
    const text = fixture(file);
    const got = extractImages(text, { env: {} }).filter((i) => i.service);
    const want = expected.map(([needle, service, image]) => ({ service, image, line: lineOf(text, needle) }));
    assert.deepEqual(
      got.map((i) => ({ service: i.service, image: i.resolved, line: i.line })),
      want,
    );
  });
}

test('the fixture set has the 15+ files the brief asks for', () => {
  assert.ok(Object.keys(TABLE).length >= 15);
});

test('04: interpolation uses the stated fallback and says where each value came from', () => {
  const text = fixture('04-interpolation.yml');
  const got = Object.fromEntries(extractImages(text, { env: {} }).map((i) => [i.service, i]));
  assert.equal(got.a.resolved, 'docker.io/library/alpine:3.20');
  assert.deepEqual(got.a.vars.map((v) => [v.name, v.source]), [['REGISTRY', 'default'], ['ALPINE_TAG', 'default']]);
  assert.equal(got.d.resolved, 'bitnami/redis:7.2');
  assert.equal(got.d.ref.canonical, 'docker.io/bitnami/redis');
  assert.equal(got.f.resolved, 'busybox:$LITERAL');
});

test('04: an unresolved tag still leaves the repository to check', () => {
  const b = extractImages(fixture('04-interpolation.yml'), { env: {} }).find((i) => i.service === 'b');
  assert.equal(b.ref.canonical, 'docker.io/library/postgres');
  assert.equal(b.ref.tag, null);
  assert.equal(b.tagUnresolved, true);
  assert.deepEqual(b.vars, [{ name: 'PG_VERSION', source: 'unresolved' }]);
});

test('04: an unresolved repository gives no ref and a reason, never a guess', () => {
  const all = extractImages(fixture('04-interpolation.yml'), { env: {} });
  for (const s of ['c', 'e', 'g']) {
    const i = all.find((x) => x.service === s);
    assert.equal(i.ref, null, s);
    assert.match(i.reason, /variable/i, s);
  }
});

test('04: values from an env map win over the fallback', () => {
  const all = extractImages(fixture('04-interpolation.yml'), { env: { ALPINE_TAG: '3.19', PG_VERSION: '15', WHOLE_IMAGE: 'nginx:1' } });
  const by = Object.fromEntries(all.map((i) => [i.service, i]));
  assert.equal(by.a.resolved, 'docker.io/library/alpine:3.19');
  assert.equal(by.a.vars[1].source, 'env');
  assert.equal(by.b.resolved, 'postgres:15');
  assert.equal(by.c.resolved, 'nginx:1');
});

test('an alias-merged image is reported at the line where its text was written', () => {
  const text = fixture('03-anchors-merge.yml');
  const app1 = extractImages(text, { env: {} }).find((i) => i.service === 'app1');
  assert.equal(app1.line, lineOf(text, 'image: ghcr.io/example/app:1.2.3'));
});

test('a compose file with no services gives no images', () => {
  assert.deepEqual(extractImages('name: demo\nvolumes:\n  a:\n', { env: {} }), []);
  assert.deepEqual(extractImages('', { env: {} }), []);
});
