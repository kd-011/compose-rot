// Regenerates docs/screenshots/terminal.png and .github/social-preview.png from a real
// `compose-rot demo` run. Not part of the package. Needs a Chromium-family browser: set
// BROWSER, or it tries chromium, chromium-browser, google-chrome and brave-browser on PATH.
//   node scripts/make-assets.mjs
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const demo = spawnSync(process.execPath, [path.join(root, 'bin/compose-rot.mjs'), 'demo'], { encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' } });
if (demo.status !== 1) throw new Error(`demo should exit 1 (it finds things on purpose), got ${demo.status}\n${demo.stderr}`);
const lines = demo.stdout.trimEnd().split('\n');

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const KIND = /^(REMOVED|ARCHIVED|DEPRECATED|RELICENSED|NON_OSI|STALE)\b/;
function render(subset) {
  return subset.map((line) => {
    const m = KIND.exec(line);
    if (m) {
      const cls = m[1] === 'REMOVED' || m[1] === 'ARCHIVED' ? 'red' : 'amber';
      return `<div><span class="${cls}">${esc(line.slice(0, 12))}</span>${esc(line.slice(12))}</div>`;
    }
    if (/^ {12}\S+:\d+ /.test(line) || /^ {12}\d{4}-\d{2}-\d{2} /.test(line)) return `<div class="dim">${esc(line)}</div>`;
    if (line.startsWith('demo:')) return `<div class="dim">${esc(line)}</div>`;
    return `<div>${esc(line) || '&nbsp;'}</div>`;
  }).join('');
}

const BAR = '<div class="bar"><i style="background:#ff5f57"></i><i style="background:#febc2e"></i><i style="background:#28c840"></i></div>';
const FONT = '"IBM Plex Mono","Fira Mono","DejaVu Sans Mono",monospace';
const candidates = [process.env.BROWSER, 'chromium', 'chromium-browser', 'google-chrome', 'brave-browser'].filter(Boolean);
const browser = candidates.find((b) => spawnSync('sh', ['-c', `command -v ${b}`]).status === 0);
if (!browser) throw new Error('no Chromium-family browser found; set BROWSER');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cr-assets-'));

function shoot(html, out, w, h) {
  const page = path.join(dir, 'page.html');
  fs.writeFileSync(page, html);
  const r = spawnSync(browser, ['--headless', '--no-sandbox', '--hide-scrollbars', '--force-device-scale-factor=1', `--window-size=${w},${h}`, `--screenshot=${out}`, `file://${page}`], { encoding: 'utf8' });
  if (r.status !== 0 || !fs.existsSync(out)) throw new Error(`screenshot failed: ${r.stderr}`);
  console.log(`wrote ${path.relative(root, out)}`);
}

// Hero: the whole demo run.
const LH = 36;
shoot(`<!doctype html><meta charset="utf-8"><style>
body{margin:0;background:#0d1117;color:#d6dbe3;font:20px/${LH}px ${FONT};white-space:pre}
.bar{padding:26px 44px 0;height:24px}.bar i{display:inline-block;width:20px;height:20px;border-radius:50%;margin-right:14px}
main{padding:28px 44px 28px}.red{color:#ff7b72;font-weight:700}.amber{color:#e3b341;font-weight:700}.dim{color:#7d8590}
</style>${BAR}<main>${render(lines)}</main>`, path.join(root, 'docs/screenshots/terminal.png'), 2100, 70 + 56 + lines.length * LH);

// Social preview: title on the left, the first findings on the right.
// Only the kind, image and place of each finding, so nothing is cut off.
const cut = [lines[0], '', ...lines.slice(1).filter((l) => KIND.test(l) || /^ {12}\S+:\d+ /.test(l)).slice(0, 14)];
shoot(`<!doctype html><meta charset="utf-8"><style>
body{margin:0;width:1280px;height:640px;background:radial-gradient(circle at 0% 100%,#1a2a22 0,#0d1014 45%);color:#eef0f4;font-family:"Fira Sans","DejaVu Sans",sans-serif;position:relative}
.rule{position:absolute;left:72px;top:96px;width:64px;height:8px;border-radius:4px;background:#f0a35b}
h1{position:absolute;left:72px;top:118px;margin:0;font-size:92px;letter-spacing:-3px;font-weight:700}
p{position:absolute;left:72px;top:262px;width:520px;margin:0;font-size:36px;line-height:44px;color:#9aa3b2}
.repo{position:absolute;left:72px;bottom:54px;font:30px ${FONT};color:#f0a35b}
.term{position:absolute;left:624px;top:222px;width:600px;border:1px solid #2a2f38;border-radius:16px;background:#12161c;padding-bottom:14px;font:13px/21px ${FONT};white-space:pre;color:#d6dbe3;overflow:hidden}
.term .bar{padding:14px 14px 0;height:14px}.term .bar i{display:inline-block;width:11px;height:11px;border-radius:50%;margin-right:8px}
.term main{padding:12px 14px 0}.red{color:#ff7b72}.amber{color:#e3b341}.dim{color:#7d8590}
</style><div class="rule"></div><h1>compose-rot</h1>
<p>Scans docker compose files for images whose upstream is archived, removed or relicensed.</p>
<div class="repo">kd-011/compose-rot</div>
<div class="term">${BAR}<main>${render(cut)}</main></div>`, path.join(root, '.github/social-preview.png'), 1280, 640);

fs.rmSync(dir, { recursive: true, force: true });
