// npm run release -- <version>: cut a release. Sets the version everywhere (package.json,
// tauri.conf.json, Cargo.toml and its lock), commits, tags v<version> and pushes. GitHub Actions
// (.github/workflows/release.yml) then builds and signs the installer into a DRAFT release; nothing
// reaches anyone until you publish that draft on GitHub (see RELEASING.md).
//   npm run release -- 0.2.0
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const version = process.argv[2];
if (!/^\d+\.\d+\.\d+$/.test(version || '')) {
  console.error('usage: npm run release -- <major.minor.patch>');
  process.exit(1);
}
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
if (git('status', '--porcelain')) {
  console.error('Commit or stash your changes first: a release is cut from a clean tree.');
  process.exit(1);
}
if (git('tag', '--list', `v${version}`)) {
  console.error(`v${version} is already tagged.`);
  process.exit(1);
}

const edit = (file, fn) => {
  const p = path.join(root, file);
  fs.writeFileSync(p, fn(fs.readFileSync(p, 'utf8')));
};
edit('package.json', (s) => s.replace(/"version": "[^"]+"/, `"version": "${version}"`));
edit('src-tauri/tauri.conf.json', (s) => s.replace(/"version": "[^"]+"/, `"version": "${version}"`));
edit('src-tauri/Cargo.toml', (s) => s.replace(/^version = "[^"]+"/m, `version = "${version}"`));
// the lockfiles carry the version too
spawnSync('npm', ['install', '--package-lock-only', '--silent'], { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
spawnSync('cargo', ['update', '--workspace', '--manifest-path', 'src-tauri/Cargo.toml'], { cwd: root, stdio: 'inherit' });

git('add', 'package.json', 'package-lock.json', 'src-tauri/tauri.conf.json', 'src-tauri/Cargo.toml', 'src-tauri/Cargo.lock');
git('commit', '-m', `Release v${version}`);
git('tag', `v${version}`);
git('push');
git('push', 'origin', `v${version}`);
console.log(`v${version} pushed. GitHub is building it into a draft release; publish the draft to ship it.`);
