# Changelog

Notable changes are listed here, newest first. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [semantic versioning](https://semver.org/).

## 0.1.0 - 2026-11-03

First version.

- `compose-rot check [path ...]` finds compose files under the paths you give it, pulls out every service image and compares each one with `data/known.json`. It prints a finding for each image whose upstream is archived, whose free catalogue was removed, or whose licence changed, with the file and line, the date and a source link.
- `--online` also finds each image's upstream repo (the data file first, then the `org.opencontainers.image.source` label from Docker Hub, ghcr.io or quay.io) and asks GitHub whether it is archived, when it was last pushed and what its licence is.
- `compose-rot demo` runs on a made-up homelab bundled with the tool and needs no setup.
- `--json` prints a documented, versioned schema. Exit codes are 0 for no findings, 1 for findings and 2 for a file that could not be read or bad usage.
- A YAML reader for the part of YAML compose files use, with no dependencies. It reports a file and line for a file it cannot read.
- 24 data entries, each with a source URL and the date it was checked.
