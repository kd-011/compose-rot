import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { scan } from './check.mjs';
import { renderText } from './report.mjs';
import { VERSION } from './version.mjs';

const HELP = `compose-rot ${VERSION}
Scan docker compose files for images whose upstream is archived, removed or relicensed.

Usage:
  compose-rot check [path ...] [--online] [--json] [--verbose]
                    [--stale-months N] [--ignore image] [--exclude dir] [--data file]
  compose-rot demo [--json]
  compose-rot --version

check walks the paths (default: the current directory) for compose files and
compares every service image with the data in data/known.json. --online also
asks the image registry and GitHub about each image's upstream repo. Set
GITHUB_TOKEN to raise GitHub's rate limit.

Exit codes: 0 no findings, 1 findings, 2 a file or path could not be read, or bad usage.
Docs: https://github.com/kd-011/compose-rot#readme
`;

class UsageError extends Error {}

const colourOn = () => process.stdout.isTTY && !process.env.NO_COLOR;

function exitCode(report) {
  if (report.errors.length) return 2;
  return report.findings.length ? 1 : 0;
}

function emit(report, values, out, banner) {
  if (values.json) out(`${JSON.stringify(report, null, 2)}\n`);
  else out(renderText(report, { verbose: values.verbose, colour: colourOn(), banner }));
  return exitCode(report);
}

async function cmdCheck(args, out) {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      online: { type: 'boolean' },
      json: { type: 'boolean' },
      verbose: { type: 'boolean' },
      'stale-months': { type: 'string' },
      ignore: { type: 'string', multiple: true },
      exclude: { type: 'string', multiple: true },
      data: { type: 'string', multiple: true },
    },
  });
  let staleMonths = 24;
  if (values['stale-months'] !== undefined) {
    staleMonths = Number(values['stale-months']);
    if (!Number.isInteger(staleMonths) || staleMonths < 1) throw new UsageError('--stale-months needs a whole number of months, 1 or more');
  }
  const report = await scan({
    paths: positionals.length ? positionals : ['.'],
    online: values.online === true,
    ignore: values.ignore ?? [],
    exclude: values.exclude ?? [],
    dataFiles: values.data ?? [],
    staleMonths,
    github: { token: process.env.GITHUB_TOKEN || undefined },
  });
  return emit(report, values, out, null);
}

async function cmdDemo(args, out) {
  const { values } = parseArgs({ args, options: { json: { type: 'boolean' } } });
  const root = fileURLToPath(new URL('../demo', import.meta.url));
  const report = await scan({ paths: [path.join(root, 'homelab')], relativeTo: root });
  return emit(report, values, out, 'demo: a made-up homelab bundled with compose-rot, checked offline');
}

export async function main(argv, { stdout = (s) => process.stdout.write(s), stderr = (s) => process.stderr.write(s) } = {}) {
  const [cmd, ...rest] = argv;
  try {
    if (cmd === '--version' || cmd === '-v') { stdout(`${VERSION}\n`); return 0; }
    if (cmd === undefined || cmd === '--help' || cmd === '-h' || cmd === 'help') { stdout(HELP); return 0; }
    if (cmd === 'check') return await cmdCheck(rest, stdout);
    if (cmd === 'demo') return await cmdDemo(rest, stdout);
    throw new UsageError(`unknown command "${cmd}". Run compose-rot --help.`);
  } catch (e) {
    if (e instanceof UsageError || e?.code?.startsWith?.('ERR_PARSE_ARGS')) {
      stderr(`compose-rot: ${e.message}\n`);
      return 2;
    }
    stderr(`compose-rot: ${e.message}\n`);
    return 2;
  }
}
