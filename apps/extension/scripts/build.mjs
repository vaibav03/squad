// Bundles the MV3 extension into dist/. Hosts are build-time config; defaults are local dev only.
import { build } from 'esbuild';
import { cpSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const hub = process.env.SQUAD_HUB_URL ?? 'http://localhost:8930';
const web = process.env.SQUAD_WEB_ORIGIN ?? 'http://localhost:5330';
const dist = join(root, 'dist');
mkdirSync(dist, { recursive: true });

await build({
  entryPoints: ['background', 'content', 'canvas-seen', 'options'].map((n) =>
    join(root, 'src', `${n}.ts`),
  ),
  outdir: dist,
  bundle: true,
  format: 'esm',
  target: 'chrome120',
  define: { __SQUAD_HUB_URL__: JSON.stringify(hub), __SQUAD_WEB_ORIGIN__: JSON.stringify(web) },
  logLevel: 'info',
});
cpSync(join(root, 'public'), dist, { recursive: true });

const manifest = {
  manifest_version: 3,
  name: 'Squad Canvas bridge',
  description:
    'Lets Squad read your own Canvas courses, assignments and files with your logged-in browser session.',
  version: '0.1.0',
  background: { service_worker: 'background.js', type: 'module' },
  content_scripts: [
    { matches: [`${web}/*`], js: ['content.js'], run_at: 'document_start' },
    { matches: ['https://*.instructure.com/*'], js: ['canvas-seen.js'], run_at: 'document_idle' },
  ],
  externally_connectable: { matches: [`${web}/*`] },
  permissions: ['storage'],
  host_permissions: ['https://*.instructure.com/*', `${hub}/*`],
  optional_host_permissions: ['https://*/*'],
  options_ui: { page: 'options.html', open_in_tab: true },
  action: { default_title: 'Squad' },
};
writeFileSync(join(dist, 'manifest.json'), JSON.stringify(manifest, null, 2));
