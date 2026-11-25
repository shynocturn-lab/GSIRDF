// IDF Web 단일 파일 빌드: src/ → index.html (CSS·JS·아이콘 모두 인라인)
// 사용: cd tools && npm install && npm run build
import { build, transform } from 'esbuild';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = (p) => path.join(root, 'src', p);

const js = await build({
  entryPoints: [src('js/app.js')], bundle: true, format: 'esm', write: false, minify: true,
  target: ['safari15', 'chrome100', 'firefox100'], legalComments: 'none',
});
const cssSrc = (await readFile(src('app.css'), 'utf8')) + '\n' + (await readFile(src('peers.css'), 'utf8'));
const css = await transform(cssSrc, { loader: 'css', minify: true, target: ['safari15', 'chrome100'] });
const icon = encodeURIComponent((await readFile(src('icon.svg'), 'utf8')).trim());
const tpl = await readFile(src('index.html'), 'utf8');

const code = js.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const out = tpl
  .replace('__ICON__', () => icon)
  .replace('__CSS__', () => css.code)
  .replace('__JS__', () => code);
for (const token of ['__ICON__', '__CSS__', '__JS__']) if (out.includes(token)) throw new Error('미치환 토큰: ' + token);
await writeFile(path.join(root, 'index.html'), out);
console.log(`index.html ${(out.length / 1024).toFixed(1)} KB (JS ${(code.length / 1024).toFixed(1)} KB, CSS ${(css.code.length / 1024).toFixed(1)} KB)`);
