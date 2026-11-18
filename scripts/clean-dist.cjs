#!/usr/bin/env node
'use strict';

// A clean bundle prevents stale files from an earlier architecture (for
// example a retired web worker) from being packaged into a release.
const fs = require('node:fs');
const path = require('node:path');

const dist = path.resolve(__dirname, '..', 'dist');
fs.rmSync(dist, { recursive: true, force: true });
