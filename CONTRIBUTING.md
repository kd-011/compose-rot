# Contributing

Bug reports, fixes and new data entries are all welcome.

## Ground rules

- Node 22, ES modules, no npm dependencies. Use `node:` built-ins.
- compose-rot only reads. It never edits a compose file, never writes next to one, and keeps nothing on disk between runs.
- Wording in findings is factual: what changed, on what date, with a link. No judgement words about the project or its maintainers.
- A data entry needs a source URL and the date you opened it. An entry without one fails the tests. See [docs/data.md](docs/data.md).
- Tests build real fixtures: real compose files in a temp dir, a real HTTP server standing in for a registry and for the GitHub API. A guard (a check that stops a wrong finding) needs a test that goes red when the guard is weakened.

## Running the tests

```sh
node --test                          # everything, a few seconds
node --test test/compose.test.mjs    # one file while you work
```

## Adding a data entry

Edit `data/known.json`, following [docs/data.md](docs/data.md). Open the source page yourself on the day you add the entry, and put that date in `sources[].checked`. If you cannot find a page that says it, leave the entry out.

## Sign-off (DCO)

There is no CLA. Certify the [Developer Certificate of Origin](https://developercertificate.org/) by signing off each commit:

```sh
git commit -s -m "Add the foo image to the data file"
```

That adds a `Signed-off-by:` line with your git name and email.

## Dependency updates and CI

Dependabot proposes GitHub Actions updates weekly. Patch and minor updates, and any update to an action from the `actions/` organisation, merge on their own once the required checks pass. Other major updates wait for a person. CI runs `node --test` on Node 22 and 24, and once a week so the badge shows the current state of `main`.

A weekly job checks the links in the README, the docs and the sources in `data/known.json`, and runs `dossier-scribe check` against this repository's dossier in `dossiers/`. Each problem opens one issue. To clear a dossier issue, re-read the cited files, fix any claims that are no longer true, run `dossier-scribe pin` and commit the dossier and lock.

## Pull requests

Keep them small, add or update a test, and update the README when behaviour changes. Plain imperative commit messages are fine.
