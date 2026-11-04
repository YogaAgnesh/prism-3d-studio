import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { build } from 'esbuild';
import { createHash } from 'node:crypto';

const projectRoot = path.resolve(import.meta.dirname, '..');
const paths = {
  html: path.join(projectRoot, 'index.html'),
  css: path.join(projectRoot, 'src', 'styles.css'),
  app: path.join(projectRoot, 'src', 'app.js'),
  worker: path.join(projectRoot, 'src', 'worker', 'workbook-worker-entry.js'),
  xlsx: path.join(projectRoot, 'node_modules', 'xlsx', 'dist', 'xlsx.full.min.js'),
  plotly: path.join(projectRoot, 'node_modules', 'plotly.js-dist-min', 'plotly.min.js'),
  dist: path.join(projectRoot, 'dist'),
  hosted: path.join(projectRoot, 'hosted', 'public', 'studio'),
};

const [template, css, xlsx, plotly] = await Promise.all([
  readFile(paths.html, 'utf8'),
  readFile(paths.css, 'utf8'),
  readFile(paths.xlsx, 'utf8'),
  readFile(paths.plotly, 'utf8'),
]);

const workerBundle = await build({
  entryPoints: [paths.worker],
  bundle: true,
  write: false,
  minify: true,
  format: 'iife',
  platform: 'browser',
  target: ['chrome100', 'edge100', 'firefox100'],
  legalComments: 'none',
});

async function appBundle(hosted) {
  return build({
    entryPoints: [paths.app], bundle: true, write: false, minify: true, format: 'iife', platform: 'browser',
    target: ['chrome100', 'edge100', 'firefox100'], legalComments: 'none',
    define: {
      'process.env.NODE_ENV': '"production"',
      __PRISM_WORKER_SOURCE__: JSON.stringify(workerBundle.outputFiles[0].text),
      __PRISM_HOSTED__: String(hosted),
    },
  });
}

const safeScript = (source) => source.replace(/<\/script/gi, '<\\/script');
function replaceRequired(source, pattern, replacement, label) {
  if (!pattern.test(source)) throw new Error(`Could not find the ${label} placeholder in index.html.`);
  return source.replace(pattern, () => replacement);
}

async function renderArtifact(hosted) {
  const bundle = await appBundle(hosted);
  let html = template;
  html = replaceRequired(html, /<link[^>]+data-inline="styles"[^>]*>/, `<style>${css}</style>`, 'stylesheet');
  html = replaceRequired(html, /<script[^>]+data-inline="xlsx"[^>]*><\/script>/, `<script>${safeScript(`/*\n${licenses[0].replace(/\*\//g,'* /')}\n*/\n${xlsx}`)}</script>`, 'SheetJS script');
  html = replaceRequired(html, /<script[^>]+data-inline="plotly"[^>]*><\/script>/, `<script id="prism-plotly-runtime">${safeScript(`/*\n${licenses[1].replace(/\*\//g,'* /')}\n*/\n${plotly}`)}</script>`, 'Plotly script');
  html = replaceRequired(html, /<script[^>]+data-inline="app"[^>]*><\/script>/, `<script>${safeScript(bundle.outputFiles[0].text)}</script>`, 'application script');
  return html.replace('<head>', `<head>\n  <!-- ${hosted ? 'Hosted Prism authoring build with same-origin publishing.' : 'Self-contained offline build: all data processing stays in this browser tab.'} -->`);
}

await mkdir(paths.dist, { recursive: true });
await mkdir(paths.hosted, { recursive: true });
const outputPath = path.join(paths.dist, '3d-viz-studio.html');
const licenses = await Promise.all([
  readFile(path.join(projectRoot,'node_modules','xlsx','LICENSE'),'utf8'),
  readFile(path.join(projectRoot,'node_modules','plotly.js-dist-min','LICENSE'),'utf8'),
  readFile(path.join(projectRoot,'node_modules','esbuild','LICENSE.md'),'utf8'),
]);
const [html, hostedHtml] = await Promise.all([renderArtifact(false), renderArtifact(true)]);
await Promise.all([writeFile(outputPath, html, 'utf8'), writeFile(path.join(paths.hosted, 'index.html'), hostedHtml, 'utf8')]);
const notices = `# Third-party notices\n\nPrism 2.0 bundles SheetJS Community Edition 0.20.3 (Apache-2.0) and Plotly.js 3.1.0 (MIT). esbuild 0.25.9 (MIT) is used only during development/build. The generated artifact is an offline application; distribution of this file retains these notices.\n\nSheetJS official distribution: https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz\nPlotly source: https://github.com/plotly/plotly.js\nesbuild source: https://github.com/evanw/esbuild\n\n## SheetJS license\n\n${licenses[0]}\n\n## Plotly license\n\n${licenses[1]}\n\n## esbuild license\n\n${licenses[2]}\n`;
await Promise.all([
  writeFile(path.join(projectRoot,'THIRD_PARTY_NOTICES.md'),notices,'utf8'),
  writeFile(path.join(paths.dist,'THIRD_PARTY_NOTICES.md'),notices,'utf8'),
  writeFile(path.join(paths.dist,'3d-viz-studio.sha256'),`${createHash('sha256').update(html).digest('hex')}  3d-viz-studio.html\n`,'utf8'),
]);
const sizeMb = Buffer.byteLength(html) / (1024 * 1024);
console.log(`Built ${outputPath} (${sizeMb.toFixed(2)} MB, fully self-contained).`);
console.log(`Built hosted/public/studio/index.html (${(Buffer.byteLength(hostedHtml) / (1024 * 1024)).toFixed(2)} MB).`);
