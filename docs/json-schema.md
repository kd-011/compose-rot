# JSON output

`compose-rot check --json` and `compose-rot demo --json` print one JSON object. The format is versioned by the `schema` field. Fields are only added within a version. A field is removed or changes meaning only with a new `schema` number.

```
{
  "tool": "compose-rot",
  "version": "0.1.0",
  "schema": 1,
  "online": false,
  "generated": "2026-11-03T13:44:02.478Z",
  "files":    [ { "path", "images", "error" } ],
  "findings": [ Finding ],
  "unknown":  [ Unknown ],
  "resolved": [ Resolved ],
  "errors":   [ { "file", "line", "message" } ],
  "skipped":  [ { "path", "reason" } ],
  "summary":  { "files", "images", "findings", "byKind", "errors" }
}
```

version: the compose-rot version. generated: when the run started, in UTC.

files: one entry per compose file found. `images` is how many service images were read from it. `error` is true when it could not be read or parsed.

errors: files that could not be parsed or read, and paths you named that do not exist. `line` is a 1-based line number, or null when there is none. When this list is not empty the exit code is 2.

skipped: directories inside a walk that could not be read.

summary: `files` and `images` count what was scanned (images after `--ignore`). `findings` is the length of the findings list, `byKind` counts them per kind, and `errors` is the length of the errors list.

## Finding

```
{
  "kind": "ARCHIVED",
  "file": "homelab/apps/docker-compose.yml",
  "line": 5,
  "service": "dashboard",
  "image": { "raw", "registry", "namespace", "repo", "tag", "digest", "canonical" },
  "summary": "upstream repo ajnart/homarr archived on 2026-06-03; ...",
  "detail": null,
  "date": "2026-06-03",
  "source": "https://github.com/ajnart/homarr",
  "sources": [ { "url", "checked", "note" } ],
  "evidence": "known",
  "id": "homarr-v0",
  "replacement": { "text", "source" },
  "upstream": { "repo", "url", "via" },
  "licence": { "from", "to" },
  "live": null
}
```

kind: `REMOVED`, `ARCHIVED`, `DEPRECATED`, `RELICENSED`, `NON_OSI` or `STALE`.

file, line, service: where the `image:` key was written. For an image that came in through a merge key or alias, this is the line in the anchor.

image: the reference as parsed. `raw` is the text after variable expansion. `tag` is null when none was written or when its variable had no value. `digest` is null when there is none. `canonical` is `registry/namespace/repo` and is what the data file is matched against.

summary: one factual sentence.

detail: longer text, or null.

date: the date of the event, `YYYY-MM-DD`. Null for an online `NON_OSI` finding, where the API gives no date. For an online `ARCHIVED` or `STALE` finding it is the date of the last push.

source, sources: the page that backs the finding, and every page the data entry cites with the date it was opened. For an online finding the source is the GitHub repo and `checked` is the day of the run.

evidence: `known` when the finding comes from the data file, `online` when it comes from the registry and GitHub.

id: the data entry's id, or null for an online finding.

replacement: `{ text, source }` when the data entry names a replacement, otherwise null.

upstream: `{ repo, url, via }` or null. `via` is `known`, `oci-label` or `oci-annotation`.

licence: present on `RELICENSED` and `NON_OSI` findings. `from` is only present when the data entry records it.

live: null offline. In online mode, on a finding that came from the data file, `{ archived, pushedAt, licence, url }` as GitHub reported it.

## Unknown

```
{ "file", "line", "service", "image": { "raw", ... }, "reason": "upstream unknown (the image has no org.opencontainers.image.source label)" }
```

An image that could not be checked. `image` has only `raw` when the reference itself could not be parsed or contains an unresolved variable. UNKNOWN never changes the exit code.

## Resolved

```
{ "file", "line", "service", "image", "upstream": { "repo", "url", "via" }, "live": { "archived", "pushedAt", "licence", "url" } }
```

Online mode only. One entry for every image whose upstream was found and read, whether or not it produced a finding.
