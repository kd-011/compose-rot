// Plain-text report. Colour only when asked for.

const COLOURS = { REMOVED: '31', ARCHIVED: '31', DEPRECATED: '33', RELICENSED: '33', NON_OSI: '33', STALE: '36', UNKNOWN: '90' };
const WIDTH = 100;

export function wrap(text, width, indent) {
  const lines = [];
  let line = '';
  for (const word of String(text).split(/\s+/)) {
    if (line && indent.length + line.length + 1 + word.length > width) { lines.push(line); line = word; }
    else line = line ? `${line} ${word}` : word;
  }
  if (line) lines.push(line);
  return lines.map((l) => indent + l);
}

export function renderText(report, { verbose = false, colour = false, banner = null } = {}) {
  const paint = (code, s) => (colour ? `\x1b[${code}m${s}\x1b[0m` : s);
  const out = [];
  const pad = ' '.repeat(12);
  const where = (x) => `${x.file}${x.line ? `:${x.line}` : ''}`;
  if (banner) out.push(banner, '');

  for (const f of report.findings) {
    out.push(`${paint(`1;${COLOURS[f.kind]}`, f.kind.padEnd(12))}${f.image.raw}`);
    out.push(`${pad}${paint('90', where(f))}  service ${f.service}`);
    out.push(...wrap(f.summary, WIDTH, pad));
    if (verbose && f.detail) out.push(...wrap(f.detail, WIDTH, pad));
    if (f.replacement) out.push(...wrap(`replacement: ${f.replacement.text}`, WIDTH, pad));
    const checked = f.sources[0]?.checked;
    out.push(`${pad}${paint('90', [f.date, f.source, checked ? `(checked ${checked})` : null].filter(Boolean).join('  '))}`);
    out.push('');
  }

  if (verbose) {
    for (const r of report.resolved ?? []) {
      const l = r.live;
      out.push(`${paint('1;32', 'OK'.padEnd(12))}${r.image.raw}`);
      out.push(`${pad}${paint('90', where(r))}  service ${r.service}`);
      out.push(`${pad}upstream ${r.upstream.repo} (via ${r.upstream.via}), licence ${l.licence ?? 'none'}, last push ${String(l.pushedAt ?? '').slice(0, 10) || 'unknown'}${l.archived ? ', archived' : ''}`);
      out.push('');
    }
    for (const u of report.unknown) {
      out.push(`${paint(`1;${COLOURS.UNKNOWN}`, 'UNKNOWN'.padEnd(12))}${u.image.raw}`);
      out.push(`${pad}${paint('90', where(u))}  service ${u.service}`);
      out.push(...wrap(u.reason, WIDTH, pad));
      out.push('');
    }
  }

  if (verbose) {
    for (const d of report.skipped ?? []) {
      out.push(`${paint('1;90', 'SKIPPED'.padEnd(12))}${d.path}`, `${pad}cannot read directory (${d.reason})`, '');
    }
  }

  for (const e of report.errors) {
    out.push(`${paint('1;31', 'ERROR'.padEnd(12))}${e.file}${e.line ? `:${e.line}` : ''}`);
    out.push(...wrap(e.message, WIDTH, pad));
    out.push('');
  }

  const s = report.summary;
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  const scope = `${plural(s.images, 'image')} in ${plural(s.files, 'compose file')}`;
  if (s.findings === 0) out.push(`no findings in ${scope}${report.online ? ' (checked online)' : ''}.`);
  else {
    const kinds = Object.entries(s.byKind).map(([k, n]) => `${n} ${k}`).join(', ');
    out.push(`${plural(s.findings, 'finding')} across ${scope}: ${kinds}.`);
  }
  if (!verbose && report.unknown.length) {
    out.push(`${plural(report.unknown.length, 'image')} could not be checked; --verbose lists them.`);
  }
  if (!verbose && report.skipped?.length) {
    out.push(`${plural(report.skipped.length, 'directory')} could not be read and ${report.skipped.length === 1 ? 'was' : 'were'} skipped; --verbose lists them.`);
  }
  if (s.errors) out.push(`${plural(s.errors, 'file')} or path could not be read.`);
  return `${out.join('\n')}\n`;
}
