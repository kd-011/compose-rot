# The data file

`data/known.json` is a list of images and what happened to them. It is the part of compose-rot that needs the most care, because a wrong entry is a wrong claim about someone's project.

## Format

```json
{
  "schema": 1,
  "entries": [
    {
      "id": "watchtower",
      "match": ["docker.io/containrrr/watchtower", "ghcr.io/containrrr/watchtower"],
      "kind": "ARCHIVED",
      "upstream": "containrrr/watchtower",
      "date": "2025-12-17",
      "summary": "upstream repo containrrr/watchtower archived on 2025-12-17; the maintainers said they had lost the time and interest to keep it up",
      "detail": "Optional longer text, shown with --verbose.",
      "sources": [
        { "url": "https://github.com/containrrr/watchtower", "checked": "2026-11-03", "note": "repository banner" }
      ],
      "verified": "2026-11-03T13:30:00Z"
    }
  ]
}
```

id: a unique lowercase name for the entry.

match: image names to cover, in the normalised form `registry/namespace/repo` with no tag. Docker Hub images are `docker.io/...`, and official images are `docker.io/library/...`. `*` matches any run of characters, so `docker.io/bitnami/*` covers the whole namespace. Matching ignores case. No two entries may list the same pattern.

kind: one of `REMOVED`, `ARCHIVED`, `DEPRECATED`, `RELICENSED`, `NON_OSI`. `STALE` and `UNKNOWN` are produced by online mode and are not entries.

upstream: optional. The GitHub `owner/repo` that online mode should ask about. Leave it out if you are not sure which repo builds the image.

date: the date of the event, as `YYYY-MM-DD`. For an archived repo, the date on the repository banner. For a licence change, the date it was announced or took effect.

summary: one factual sentence saying what happened and when. No judgement words. "upstream repo archived on 2026-02-10" is right. Words that tell the reader how to feel about the project are not. A test rejects a few of them.

detail: optional. More context, or caveats such as a date that two sources give differently.

sources: at least one. Each has an `https` `url` of a page that says it, and `checked`, the date you opened that page. `note` is optional. The first source is the one printed in the report.

verified: a UTC timestamp, `YYYY-MM-DDTHH:MM:SSZ`, for when you last checked the whole entry.

replacement: optional, with `text` and `source`. Only add one where the project itself names a replacement, and link the page where it does. compose-rot does not suggest alternatives it cannot cite.

licence: required for `RELICENSED` (`from` and `to`) and for `NON_OSI` (`to`). Use SPDX ids where one exists. A licence without an SPDX id is written as its name, for example `CockroachDB Software License`.

affects: optional, `{ "from": "1.15.0" }`. The entry applies only to tags at or above that version. A tag with no version in it (`latest`, none) is treated as affected. A tag with fewer parts than the boundary, such as `1` against `1.15.0`, is treated as affected because it can resolve to a release that is.

## Adding an entry

Open a pull request that edits `data/known.json`.

1. Find the page that says what happened. The upstream repo's banner, its README notice or its licence file are the best sources. A news article can go in as a second source. A claim that only an article makes is weaker, so say that in `detail`.
2. Open the page yourself and write today's date in `checked`. The tests check that the date is a real date, not that you opened the page.
3. Write one factual sentence, with the date, for `summary`.
4. Run `node --test`. `test/known-data.test.mjs` fails if an entry has no source URL, no checked date or no verified timestamp.

For an archived repo you can confirm the current state with `gh api repos/<owner>/<repo> --jq .archived`. That gives the flag but not the date, so take the date from the repo page.

An entry that was true when it was added can stop being true: a repo gets unarchived, a project reverts a licence. Open an issue using the data template when you see one.

## What is in the file

Each entry's `sources` lists the pages that were opened and the date. The file was built on 2026-11-03 from pages opened that day. Where a lead from a news article did not match the project's own page, the entry follows the project's page. Dockhand is one example: an article described a move to BUSL-1.1, but the repo's licence file has been BUSL-1.1 since its first commit on 2025-12-28. What changed in September and October 2026 was the licence's terms, so the entry says that.

## The licence list

`data/non-open-licences.json` lists the SPDX ids that online mode reports as `NON_OSI`: BUSL-1.1, SSPL-1.0, Elastic-2.0, FSL-1.1-ALv2, FSL-1.1-MIT and two PolyForm licences, all of which the SPDX list marks as not OSI approved, plus the Commons Clause, which has no SPDX id. A licence is on the list only if it restricts use or resale. The SPDX list also marks free licences such as CC0-1.0 as not OSI approved, and those are left alone.
