# Security

## Reporting a vulnerability

Please use GitHub private vulnerability reporting. Open the Security tab of this repository and choose "Report a vulnerability". The report stays private until a fix is out. Don't open a public issue for something exploitable.

Say what you ran, what you expected and what happened. A compose file that reproduces it helps most. Take out real passwords and hostnames first.

## What is in scope

compose-rot reads compose files and, with `--online`, makes requests to image registries and to the GitHub API. These are the areas worth a look:

- Anything that makes it write, rename or delete a file.
- The `.env` handling: only variables used in an `image:` value may be read into the report, and no other value may appear in output.
- `GITHUB_TOKEN` being sent anywhere other than the GitHub API, or appearing in output.
- A compose file or a registry response that makes it hang, run without bound, or run code.
- The YAML reader: input that crashes it instead of giving a file and line.

## Supported versions

Only the latest release gets fixes. The project is small and has no runtime dependencies.
