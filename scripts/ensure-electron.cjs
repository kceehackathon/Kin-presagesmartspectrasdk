#!/usr/bin/env node
'use strict';

// electron-builder's dependency installer is usually reliable, but on a clean
// Windows machine it can fail before Electron's own postinstall has extracted
// the runtime (for example when the VC++ runtime is missing). Retry once with
// vendor/vc-runtime on PATH so a fresh `npm install` is self-healing.
//
// This runs after dependencies are installed. It never fails the install: the
// app can still be built on a machine that does not need Electron.

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const electronDir = path.join(root, 'node_modules', 'electron');
const executable = process.platform === 'win32'
  ? 'electron.exe'
  : process.platform === 'darwin'
    ? 'Electron.app/Contents/MacOS/Electron'
    : 'electron';
const distPath = path.join(electronDir, 'dist', executable);
const vendor = path.join(root, 'vendor', 'vc-runtime');

if (!fs.existsSync(electronDir)) {
  console.log('[electron] package not installed; skipping binary check.');
  process.exit(0);
}

if (fs.existsSync(distPath)) {
  process.exit(0);
}

console.log('[electron] Runtime binary is missing; retrying Electron install...');
const env = { ...process.env };
if (process.platform === 'win32' && fs.existsSync(vendor)) {
  env.PATH = `${vendor};${env.PATH || ''}`;
}

const result = spawnSync(process.execPath, [path.join(electronDir, 'install.js')], {
  cwd: electronDir,
  env,
  stdio: 'inherit',
});

if (result.status !== 0 || !fs.existsSync(distPath)) {
  console.warn('\n[electron] Automatic install did not complete.');
  console.warn('[electron] Run this once from the project folder, then retry:');
  console.warn('  node node_modules/electron/install.js\n');
  process.exit(0);
}

console.log('[electron] Runtime binary installed.');
