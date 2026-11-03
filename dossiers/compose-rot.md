---
slug: compose-rot
name: compose-rot
repo: .
status: active
last_verified: 2026-11-03
tags: [cli, node, docker, compose, supply-chain]
---

A command line tool that reads docker compose files and reports images whose upstream is archived, removed or relicensed. These claims are the README's main promises, each tied to the code that keeps it.

## Features

- Runs on Node 22 or newer and installs one command, `compose-rot`. <!-- src: package.json:12, package.json:14 -->
- Has no runtime or development dependencies, only Node built-ins. <!-- src: package.json -->
- Finds compose files by name (`compose.yml`, `docker-compose*.yml`, `*.compose.yml`, either spelling of the extension), skips `node_modules` and `.git`, and does not follow symlinked directories. <!-- src: src/find.mjs:5-6, src/find.mjs:39-42 -->
- Reads variables for image names from a `.env` file next to the compose file, then from the default written in the file, and never from the shell environment. <!-- src: src/check.mjs:23-25, src/compose.mjs:11-12 -->
- An image whose registry, namespace or repo is an unresolved variable is listed as unknown and never guessed at. <!-- src: src/compose.mjs:84-91 -->
- Exits 2 when a file or path could not be read, 1 when there are findings and 0 otherwise. <!-- src: src/cli.mjs:30-33 -->

## Architecture

- Online mode takes the upstream from the data file first, then from the registry's source label, and otherwise reports the image as unknown. <!-- src: src/check.mjs:162-178 -->
- `GITHUB_TOKEN` is sent to the GitHub API client only. <!-- src: src/github.mjs:19 -->
- On a GitHub rate limit it waits up to 60 seconds and retries twice before giving up. <!-- src: src/github.mjs:2-3, src/github.mjs:45 -->
- A data entry without an https source URL, a checked date and a verified timestamp is rejected. <!-- src: src/known.mjs:16-40 -->
- The licences reported as NON_OSI come from `data/non-open-licences.json`. <!-- src: src/known.mjs:64-68 -->
- A file larger than 5 MB is not read. <!-- src: src/check.mjs:12, src/check.mjs:88 -->

## Deploy

- CI runs `node --test` on Node 22 and 24 for every pull request and once a week. <!-- src: .github/workflows/ci.yml:3-12, .github/workflows/ci.yml:24 -->
- Dependabot opens grouped weekly updates for GitHub Actions and qualifying ones merge automatically once CI is green. <!-- src: .github/dependabot.yml, .github/scripts/automerge-eligible.mjs -->

<!-- auto:start -->
- package: compose-rot 0.1.0
- npm scripts (1): test
<!-- auto:end -->
