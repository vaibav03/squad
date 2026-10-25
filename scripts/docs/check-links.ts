/**
 * Markdown link checker for the product docs (no network).
 *
 *   tsx scripts/docs/check-links.ts          README.md plus the guide, architecture, api docs and top-level docs
 *   tsx scripts/docs/check-links.ts --all    every tracked .md under the repo (excluding node_modules)
 *
 * Checks: relative links and images point at an existing file or folder; `#anchor` fragments match a heading
 * in the target file; also scans the checked files for strings that look like API keys. Exits 1 on any problem.
 * http(s) links are not fetched.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const all = process.argv.includes('--all');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.git' || name === 'data') continue;
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.md')) out.push(p);
  }
  return out;
}

const files = all
  ? walk(ROOT)
  : [
      path.join(ROOT, 'README.md'),
      ...['docs/guide', 'docs/architecture', 'docs/api'].flatMap((d) =>
        existsSync(path.join(ROOT, d)) ? walk(path.join(ROOT, d)) : [],
      ),
      ...['CONTRIBUTING', 'FAQ', 'CREDITS', 'SUBMISSION-STORY']
        .map((n) => path.join(ROOT, 'docs', `${n}.md`))
        .filter(existsSync),
    ];

const slug = (h: string): string =>
  h
    .trim()
    .toLowerCase()
    .replace(/`/g, '')
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s/g, '-');

const anchorCache = new Map<string, Set<string>>();
function anchors(file: string): Set<string> {
  let s = anchorCache.get(file);
  if (!s) {
    s = new Set();
    let fence = false;
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      if (line.startsWith('```')) fence = !fence;
      const m = !fence && /^#{1,6}\s+(.*)$/.exec(line);
      if (m) s.add(slug(m[1]!));
    }
    anchorCache.set(file, s);
  }
  return s;
}

const SECRET = /(AIza[0-9A-Za-z_-]{30,}|sk_[a-z]{0,5}_?[0-9a-f]{24,}|sk-[A-Za-z0-9]{32,}|-----BEGIN [A-Z ]*PRIVATE KEY-----)/;
const problems: string[] = [];
let links = 0;

for (const file of files) {
  const rel = path.relative(ROOT, file);
  const text = readFileSync(file, 'utf8');
  const lines = text.split('\n');
  let fence = false;
  lines.forEach((line, i) => {
    if (line.startsWith('```')) fence = !fence;
    if (SECRET.test(line)) problems.push(`${rel}:${i + 1}: looks like a secret`);
    if (fence) return;
    const noCode = line.replace(/`[^`]*`/g, '');
    for (const m of noCode.matchAll(/!?\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
      const target = m[1]!;
      if (/^(https?:|mailto:)/.test(target)) continue;
      links++;
      const [pathPart, frag] = target.split('#') as [string, string | undefined];
      const resolved = pathPart ? path.resolve(path.dirname(file), decodeURI(pathPart)) : file;
      if (!existsSync(resolved)) {
        problems.push(`${rel}:${i + 1}: missing target ${target}`);
        continue;
      }
      if (frag && resolved.endsWith('.md') && !anchors(resolved).has(frag.toLowerCase())) {
        problems.push(`${rel}:${i + 1}: no heading for #${frag} in ${path.relative(ROOT, resolved)}`);
      }
    }
  });
}

console.log(`checked ${files.length} files, ${links} relative links`);
if (problems.length) {
  for (const p of problems) console.log(`FAIL ${p}`);
  process.exit(1);
}
console.log('ok');
