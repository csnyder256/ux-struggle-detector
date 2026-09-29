import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile, mkdir, readdir, copyFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);
const pkgDir = path.join(root, 'packages/sdk');
const pkg = JSON.parse(await readFile(path.join(pkgDir, 'package.json'), 'utf8'));
const version = (await readFile('VERSION', 'utf8')).trim();
if (version !== pkg.version) throw new Error('SDK and application versions disagree');
await rm(path.join(pkgDir, 'dist'), { recursive: true, force: true });
await mkdir(path.join(pkgDir, 'dist'), { recursive: true });
const common = { bundle: true, target: 'es2020', legalComments: 'none', logLevel: 'warning' };
for (const [format, filename] of [['esm', 'index.js'], ['cjs', 'index.cjs']]) {
  await build({ ...common, entryPoints: ['src/sdk/package-entry.ts'], format, outfile: path.join(pkgDir, 'dist', filename) });
}
for (const minify of [false, true]) {
  await build({ ...common, entryPoints: ['src/sdk/script-entry.ts'], format: 'iife', globalName: 'ClarusHeal', minify, outfile: path.join(pkgDir, 'dist', minify ? 'sdk.min.js' : 'sdk.js') });
}
execFileSync(process.execPath, ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.sdk.json'], { stdio: 'inherit' });
async function fixTypes(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) await fixTypes(p);
    else if (entry.name.endsWith('.d.ts')) {
      const source = await readFile(p, 'utf8');
      await writeFile(p, source.replace(/(from\s+|import\()(['"])(\.{1,2}\/[^'"]+)\2/g, (whole, prefix, quote, name) => prefix + quote + (name.endsWith('.js') ? name : name + '.js') + quote));
    }
  }
}
await fixTypes(path.join(pkgDir, 'dist/types'));
await copyFile('LICENSE', path.join(pkgDir, 'LICENSE'));
await mkdir('dist-sdk', { recursive: true });
for (const p of await readdir('dist-sdk')) if (p.endsWith('.tgz')) await rm(path.join('dist-sdk', p));
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const result = JSON.parse(execFileSync(npm, ['pack', './packages/sdk', '--ignore-scripts', '--json', '--pack-destination', 'dist-sdk'], { encoding: 'utf8' }))[0];
const sourceSha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const checksum = b => createHash('sha256').update(b).digest('hex');
const provenance = { schema_version: 1, package: pkg.name, version, source_sha: sourceSha, filename: result.filename, sha256: checksum(await readFile(path.join('dist-sdk', result.filename))), files: result.files.map(f => f.path).sort(), runtime_dependencies: [] };
await writeFile('dist-sdk/sdk-provenance.json', JSON.stringify(provenance, null, 2) + '\n');
console.log('Packed', pkg.name, version, result.filename, result.size, 'bytes');
