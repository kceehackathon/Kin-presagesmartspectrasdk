#!/usr/bin/env node
'use strict';

// Copies the Microsoft Visual C++ runtime DLLs that the SmartSpectra native
// runtime links against into the SDK's per-platform package. Windows does not
// ship the desktop VC++ runtime by default, and the SDK closure assumes it is
// available. Keeping the DLLs beside smartspectra_capi.dll makes the app
// self-contained for judges and for anyone who has never installed Visual
// Studio.
//
// The DLLs in vendor/vc-runtime were extracted from Microsoft's official
// vc_redist.x64.exe (14.42.34430). See vendor/vc-runtime/README.md.

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const platformPkg = path.join(
  root,
  'node_modules',
  '@smartspectra',
  `node-sdk-${process.platform}-${process.arch}`,
);
const vendor = path.join(root, 'vendor', 'vc-runtime');

function copyRuntime() {
  if (!fs.existsSync(platformPkg)) {
    console.log('[native] SDK platform package not installed yet; skipping runtime copy.');
    return;
  }
  if (process.platform !== 'win32') {
    console.log('[native] Not Windows; the platform package carries its own runtime closure.');
    return;
  }
  if (!fs.existsSync(vendor)) {
    console.warn('[native] vendor/vc-runtime is missing; relying on a system VC++ runtime.');
    return;
  }

  const dlls = fs.readdirSync(vendor).filter((name) => name.toLowerCase().endsWith('.dll'));
  let copied = 0;
  let skipped = 0;
  for (const dll of dlls) {
    const source = path.join(vendor, dll);
    const destination = path.join(platformPkg, dll);
    try {
      if (fs.existsSync(destination) && fs.statSync(destination).size === fs.statSync(source).size) {
        skipped += 1;
        continue;
      }
      fs.copyFileSync(source, destination);
      copied += 1;
    } catch (error) {
      // A running Electron instance can hold the DLLs open. The existing copy
      // is already the same runtime, so keep building rather than failing the
      // whole app for a dev-time Windows file lock.
      if (error && (error.code === 'EBUSY' || error.code === 'EPERM') && fs.existsSync(destination)) {
        console.warn(`[native] ${dll} is in use; keeping the installed copy.`);
        skipped += 1;
        continue;
      }
      throw error;
    }
  }
  console.log(`[native] VC++ runtime ready (${copied} copied, ${skipped} already in place).`);

  const capi = path.join(platformPkg, 'smartspectra_capi.dll');
  if (!fs.existsSync(capi)) {
    console.warn('[native] smartspectra_capi.dll is missing from the platform package.');
  }
}

copyRuntime();
