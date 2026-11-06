import { cp, mkdir, readFile, writeFile, copyFile, realpath } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
if (process.platform !== 'win32') throw new Error('Build on Windows.');
const output = join(root, 'release', `GalResourcesTool-${Date.now()}`);
function run(args, cwd = root) {
  const result = spawnSync(process.execPath, args, { cwd, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error('Build failed');
}
const tsc = join(root, 'node_modules/typescript/bin/tsc');
for (const path of ['packages/contracts', 'apps/api']) run([tsc, '-p', `${path}/tsconfig.json`]);
run([tsc, '-p', 'apps/web/tsconfig.json', '--noEmit']);
run([join(root, 'apps/web/node_modules/vite/bin/vite.js'), 'build'], join(root, 'apps/web'));

// Resolve pnpm symlinks into ordinary directories; retain package licenses.
async function copyPackage(source, destination, parents = []) {
  source = await realpath(source);
  const metadata = JSON.parse(await readFile(join(source, 'package.json'), 'utf8'));
  const key = `${metadata.name}@${metadata.version}`;
  if (parents.includes(key)) throw new Error(`Dependency cycle: ${key}`);
  await mkdir(dirname(destination), { recursive: true });
  await cp(source, destination, { recursive: true, dereference: true,
    filter: path => {
      if (path === source) return true;
      const parts = path.slice(source.length + 1).split(/[\\/]/);
      if (parts.some(part => ['node_modules', '.git', 'data', 'private', 'secrets', 'local-config'].includes(part))) return false;
      if (parts.some(part => part.startsWith('.env') || part === '.npmrc' || /\.(?:sqlite|db)(?:-.*)?$|\.local\.(?:json|ya?ml)$|\.(?:pem|key|p12|pfx)$/i.test(part))) return false;
      // Workspace packages ship compiled runtime files only.
      if (metadata.name.startsWith('@gal/')) return parts[0] === 'dist' || parts[0] === 'package.json';
      return true;
    } });
  const require = createRequire(join(source, 'package.json'));
  for (const name of Object.keys(metadata.dependencies ?? {})) {
    let found;
    for (const search of require.resolve.paths(name) ?? []) {
      try { await readFile(join(search, name, 'package.json')); found = join(search, name); break; }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    if (!found) throw new Error(`Missing dependency: ${name}`);
    await copyPackage(found, join(destination, 'node_modules', name), [...parents, key]);
  }
}
await mkdir(join(output, 'runtime'), { recursive: true });
await mkdir(join(output, 'data'), { recursive: true });
await copyFile(process.execPath, join(output, 'runtime/node.exe'));
try { await copyFile(join(dirname(process.execPath), 'LICENSE'), join(output, 'runtime/LICENSE')); }
catch (error) {
  if (error.code !== 'ENOENT' || process.version !== 'v22.17.0') throw error;
  await copyFile(join(root, 'scripts/Node-LICENSE.txt'), join(output, 'runtime/LICENSE'));
}
await copyPackage(join(root, 'apps/api'), join(output, 'app/apps/api'));
await cp(join(root, 'apps/web/dist'), join(output, 'app/apps/web/dist'), { recursive: true });
await copyFile(join(root, 'scripts/start-portable.cmd'), join(output, '启动.cmd'));
await copyFile(join(root, '.env.example'), join(output, '.env.example'));
await copyFile(join(root, '实现与验收.md'), join(output, '实现与验收.md'));
await copyFile(join(root, 'scripts/backup.mjs'), join(output, 'backup.mjs'));
await writeFile(join(output, '使用说明.txt'), '双击 启动.cmd，打开 http://127.0.0.1:3001\r\n按 Ctrl+C 退出后，备份整个 data 目录。请先解压再运行。\r\n当前仅支持本机单人使用。\r\n');
await writeFile(join(output, 'build-info.json'), JSON.stringify({ node: process.version, arch: process.arch, builtAt: new Date().toISOString() }, null, 2));
console.log(`Portable package: ${output}`);
