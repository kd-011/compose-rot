# Reference

## Commands

```
compose-rot check [path ...] [--online] [--json] [--verbose]
                  [--stale-months N] [--ignore image] [--exclude dir] [--data file]
compose-rot demo [--json]
compose-rot --version
```

With no path, `check` scans the current directory.

### What counts as a compose file

A directory is walked recursively. A file is read if its name is `compose.yml`, `compose.yaml`, `compose.<anything>.yml` (for example `compose.override.yml`), `docker-compose<anything>.yml`, or ends in `.compose.yml`. The `.yaml` spelling works for all of them. `node_modules` and `.git` are skipped, and symlinked directories are not followed. A file you name on the command line is always read, whatever it is called.

A directory that cannot be read during a walk is skipped and listed under `skipped` in the JSON, and in the text report with `--verbose`. A path you name that cannot be read is an error.

### Options

`--online` also looks up each image's upstream repo and asks GitHub about it. See [Online mode](#online-mode).

`--json` prints the report as JSON. The format is in [json-schema.md](json-schema.md).

`--verbose` adds three things to the text report: images that could not be checked (`UNKNOWN`), with the reason; with `--online`, every image whose upstream was found (`OK`), with the repo, licence and last push; and each finding's longer `detail` text.

`--stale-months N` sets how long without a push counts as stale in online mode. The default is 24.

`--ignore image` skips images. It takes a glob where `*` matches any run of characters, matched against the normalised name (`docker.io/library/redis`) and against the text as written in the file. It can be repeated.

`--exclude dir` keeps the directory walk out of a directory. It takes a glob matched against the directory's name and its full path, and can be repeated. Use it for a network mount that is slow or hangs.

`--data file` adds entries from another data file in the same format as `data/known.json`. The built-in entries stay. An invalid entry in the file is an error.

### Exit codes

0 means no findings. 1 means at least one finding. 2 means a compose file could not be parsed or read, a path you named does not exist, or the usage was wrong. A 2 wins over a 1: findings are still printed, but the exit code says the scan was incomplete.

`UNKNOWN` results never change the exit code.

## How images are read

Every service's `image:` is read, including services in `profiles`. `extends` is not followed. A service with only `build:` has no image and is skipped. Compose v1 files, where service names sit at the top level, are read too.

Anchors, aliases and `<<` merge keys are resolved. An image that arrives through a merge is reported at the line where its text was written, which is in the anchor.

Each reference is split into registry, namespace, repo, tag and digest. Docker Hub is always `docker.io`, and a bare name such as `redis` is `docker.io/library/redis`. `index.docker.io` and `registry-1.docker.io` are folded into `docker.io`.

### Variables

`${VAR:-default}`, `${VAR-default}`, `${VAR:+alt}`, `${VAR:?message}`, `${VAR}`, `$VAR` and `$$` are expanded. A value comes from a `.env` file in the same directory as the compose file, then from the written default. The shell environment is not consulted, so a run gives the same answer on every machine. Only variables that appear inside an `image:` value are ever read from `.env`, and nothing else from that file is kept or printed.

If a variable has neither a value nor a default and it sits in the tag, the image is still checked and the tag is reported as unknown. If it sits in the registry, namespace or repo, the image cannot be checked. It is listed as `UNKNOWN`, and compose-rot does not guess.

## Finding kinds

REMOVED: the image, or the free catalogue it came from, is gone or moved. Comes from the data file only.

ARCHIVED: the upstream repo is archived. From the data file, or from GitHub in online mode.

DEPRECATED: the maintainer or the registry marks the image as deprecated, with no archive involved. From the data file only.

RELICENSED: the licence changed. The finding carries `licence.from` and `licence.to`. From the data file only.

NON_OSI: the upstream licence is one the OSI has not approved and that restricts use or resale, such as BUSL-1.1, SSPL-1.0 or Elastic-2.0. From the data file, or from GitHub in online mode.

STALE: no push to the upstream repo in 24 months (configurable). Online mode only. A repo that is archived is reported as archived and not also as stale.

UNKNOWN: online mode could not find or read the upstream. Shown only with `--verbose` in the text report, and always in the JSON `unknown` list.

REMOVED, DEPRECATED and NON_OSI are wider than the list in the project brief. A removed catalogue and an archived repo are different events, and a licence that was never open is different from one that changed. Mixing them under one label would make the report less accurate.

## Online mode

For each image, in this order:

1. If the data file has an entry that covers the image and names an upstream, that upstream is used.
2. Otherwise the registry is asked for the image's manifest, using the anonymous token flow that Docker Hub, ghcr.io and quay.io use. The `org.opencontainers.image.source` annotation on the index or manifest is read first, then the same key in the image config's labels.
3. If neither gives a GitHub repo, the image is `UNKNOWN` with the reason, for example "the image has no org.opencontainers.image.source label". The image name is never turned into a guess at a repo.

Then GitHub's repo endpoint is asked for the `archived` flag, `pushed_at` and the SPDX licence id.

The licence check flags only a short list of licences, in `data/non-open-licences.json`. A licence id GitHub reports as `NOASSERTION`, or no licence at all, is listed as `UNKNOWN`, because it means GitHub could not tell and says nothing about the licence. Any other licence is left alone.

A finding that comes from GitHub has `"evidence": "online"`. Its `date` is the date of the last push, because the API does not give the date a repo was archived or relicensed.

When an image has a data entry, the live archived flag, last push and licence are attached to that finding as `live`.

Details of the requests:

- `GITHUB_TOKEN`, if set, is sent to the GitHub API and nowhere else. `COMPOSE_ROT_GITHUB_API` changes the API base URL, for GitHub Enterprise.
- On a rate limit (403 or 429 with `Retry-After` or `X-RateLimit-Remaining: 0`) it waits as long as the response says, up to 60 seconds, and retries twice. After that the image is `UNKNOWN` and the reason says to set `GITHUB_TOKEN`.
- A registry that answers 429, 502, 503 or 504, or drops the connection, is retried twice.
- Up to four images are looked up at once. Each upstream repo is fetched once per run.
- Nothing is cached on disk. There is no telemetry.
