import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseImage } from '../src/image.mjs';

const cases = [
  ['nginx', { registry: 'docker.io', namespace: 'library', repo: 'nginx', tag: null, digest: null, canonical: 'docker.io/library/nginx' }],
  ['nginx:1.27', { registry: 'docker.io', namespace: 'library', repo: 'nginx', tag: '1.27', canonical: 'docker.io/library/nginx' }],
  ['bitnami/redis:7', { registry: 'docker.io', namespace: 'bitnami', repo: 'redis', tag: '7', canonical: 'docker.io/bitnami/redis' }],
  ['docker.io/library/nginx', { registry: 'docker.io', namespace: 'library', repo: 'nginx', tag: null, canonical: 'docker.io/library/nginx' }],
  ['docker.io/nginx', { registry: 'docker.io', namespace: 'library', repo: 'nginx', canonical: 'docker.io/library/nginx' }],
  ['index.docker.io/grafana/grafana:11.0.0', { registry: 'docker.io', namespace: 'grafana', repo: 'grafana', tag: '11.0.0' }],
  ['registry-1.docker.io/library/alpine', { registry: 'docker.io', canonical: 'docker.io/library/alpine' }],
  ['ghcr.io/org/sub/path/tool:0.9', { registry: 'ghcr.io', namespace: 'org/sub/path', repo: 'tool', tag: '0.9', canonical: 'ghcr.io/org/sub/path/tool' }],
  ['localhost:5000/app:dev', { registry: 'localhost:5000', namespace: '', repo: 'app', tag: 'dev', canonical: 'localhost:5000/app' }],
  ['localhost/app', { registry: 'localhost', repo: 'app' }],
  ['registry.example.com:8443/team/app:1', { registry: 'registry.example.com:8443', namespace: 'team', repo: 'app', tag: '1' }],
  ['quay.io/prometheus/prometheus:v2.53.0', { registry: 'quay.io', namespace: 'prometheus', repo: 'prometheus', tag: 'v2.53.0' }],
  ['gcr.io/kaniko-project/executor:v1.23.2', { registry: 'gcr.io', namespace: 'kaniko-project', repo: 'executor' }],
  ['ghcr.io/org/app@sha256:' + 'a'.repeat(64), { registry: 'ghcr.io', tag: null, digest: 'sha256:' + 'a'.repeat(64) }],
  ['ghcr.io/org/tool:2.1@sha256:' + 'b'.repeat(64), { tag: '2.1', digest: 'sha256:' + 'b'.repeat(64) }],
  ['myhost:5000', { registry: 'docker.io', repo: 'myhost', tag: '5000' }],
  ['Nginx:Latest', { repo: 'nginx', tag: 'Latest' }],
];
for (const [input, want] of cases) {
  test(`parseImage(${input.length > 40 ? input.slice(0, 40) + '...' : input})`, () => {
    const got = parseImage(input);
    assert.ok(got, 'should parse');
    for (const [k, v] of Object.entries(want)) assert.equal(got[k], v, k);
    assert.equal(got.raw, input);
  });
}

for (const bad of ['', '   ', 'has space', 'a//b', ':tag', 'repo:', '@sha256:abc', 'a/b:c:d']) {
  test(`parseImage(${JSON.stringify(bad)}) is null`, () => {
    assert.equal(parseImage(bad), null);
  });
}
