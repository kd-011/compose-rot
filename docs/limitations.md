# What compose-rot does not check

It reads `image:` lines in compose files and nothing else. It does not look inside the image, and it does not know what the software does.

## Scope

- Dockerfiles. A `FROM` line is not read, and neither is a `build:` section. A service that builds its own image and has no `image:` is skipped.
- Kubernetes manifests, Helm charts, Nomad jobs and anything else that is not a compose file.
- `include:` and `extends:`. Included files are found only if the directory walk reaches them. A service that gets its image through `extends` is not seen.
- Variables from your shell. Only a `.env` file next to the compose file and the default written in the file are used. If your real value lives in the shell environment, the image may show as unknown or be read with its default.
- Vulnerabilities, outdated tags and image size. Use Trivy, Grype, Renovate or Diun for those. compose-rot says nothing about whether the tag you run is current.
- Whether an image you pull from a mirror or a fork has the same state as the one in the data file. Matching is by image name. A fork published under another name is not covered unless someone adds it.

## The data file

- Offline mode knows only what `data/known.json` says. It has a few dozen entries. A clean run means none of your images are in the file. It does not mean they are healthy.
- Every entry was true on the date it was checked and may not be now. A repo can be unarchived and a licence can change back. Each entry carries the date it was checked so you can judge that.
- Tag handling is thin. Only entries with `affects.from` look at the tag, and only for a tag that starts with a number. The MongoDB entry applies to every tag, including old ones released before the licence change.
- Entries mostly name the image as it is on Docker Hub, ghcr.io or quay.io. The same software on a registry that is not listed is not matched.

## Online mode

- The upstream is found from the `org.opencontainers.image.source` label or annotation. Many images do not set it. In a run over 23 images from one homelab, 5 had no source label and a sixth was rate limited by its registry, so 6 were reported as unknown. When the label is missing compose-rot does not guess a repo from the image name.
- The label points at whatever repo the image's maintainer put there. For linuxserver.io images that is the packaging repo, not the application's own repo, so the archived flag is about the packaging repo.
- Registries that need a login are not read. Only the anonymous token flow is used.
- GitHub's `archived` flag says the repo is read-only. The API does not say when it was archived, so online findings use the date of the last push. A last push on any branch counts, so a repo can look recent when its main branch is quiet.
- STALE is a count of months since the last push. Plenty of finished software has no recent pushes.
- The licence is the one GitHub detects for the repo's default branch, not for the tag you run. A relicensing that applies from a later version shows up on an image that is still on the old version. A repo with several licence files, or a custom licence, is reported as `NOASSERTION`, which compose-rot lists as unknown.
- Only a short list of licences is flagged, in `data/non-open-licences.json`. A source-available licence that is not on it passes without comment. AGPL and other OSI-approved licences are never flagged, even where a company dislikes them.
- Docker Hub and GitHub rate limits apply. Without `GITHUB_TOKEN`, GitHub allows 60 requests an hour.

## Wording

A finding states a fact with a date and a link. It does not say whether you should do anything about it. Many of these projects are fine to run for years after an archive, and a licence such as BUSL-1.1 leaves most homelab uses open. What it means for you is your call, and for a licence it is a question for the licence text.

## The YAML reader

It handles the part of YAML that compose files use: block and flow collections, quoted, plain and block scalars, anchors, aliases, merge keys, multiple documents and comments. It does not support `? ` complex keys, and it ignores tags such as `!!str`. A file larger than 5 MB is not read. For a file it cannot read it gives the file and line and carries on with the others.

It does not validate the compose schema. A file with an unknown key is read as long as the YAML is valid.
