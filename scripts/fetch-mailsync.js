#!/usr/bin/env node
/* eslint global-require: 0 */
/**
 * Downloads the prebuilt mailsync binary for the current platform into app/.
 *
 * The root postinstall prints a reminder when the engine is missing but does not download
 * upstream binaries: those contain a path gate that prevents Nuncio from starting.
 * Run this script to fetch this fork's release, or build the engine from the submodule.
 *
 *   node scripts/fetch-mailsync.js            # download if app/mailsync is missing
 *   node scripts/fetch-mailsync.js --force    # always re-download
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const { execSync } = require('child_process');
const targz = require('targz');

const repoRoot = path.resolve(__dirname, '..');
const appDir = path.join(repoRoot, 'app');
const binaryPath = path.join(appDir, 'mailsync');
const force = process.argv.includes('--force');

// Same mapping as scripts/postinstall.js: the S3 layout is per-platform, not per-arch,
// except for Linux arm64 which has its own build.
const distDir = {
  'darwin-x64': 'osx',
  'darwin-arm64': 'osx',
  'win32-x64': 'win-ia32', // mailsync is still a 32-bit build on Windows
  'win32-ia32': 'win-ia32',
  'linux-x64': 'linux',
  'linux-arm64': 'linux-arm64',
}[`${process.platform}-${process.arch}`];

if (!distDir) {
  console.error(`No prebuilt mailsync for ${process.platform}-${process.arch}. Build it from the submodule instead.`);
  process.exit(1);
}

// Windows ships mailsync.exe (plus its DLLs), macOS/Linux ship an extensionless wrapper next to
// mailsync.bin — so "is it installed" cannot be a single path check.
const candidates = ['mailsync', 'mailsync.exe', 'mailsync.bin'].map((name) => path.join(appDir, name));
const present = candidates.find((file) => fs.existsSync(file));
if (present && !force) {
  console.log(`${path.relative(repoRoot, present)} already present (${fs.statSync(present).size} bytes) — nothing to do.`);
  process.exit(0);
}

// Where to get the engine, in order of preference:
//  1. an explicit override, for a hand-built binary
//  2. this fork's own release artifact for this platform. Upstream's prebuilt for the pinned
//     commit is deliberately not a fallback: it still carries the "mailspring" path gate, which
//     a renamed build cannot satisfy, and it would be built from the wrong submodule anyway.
const releasePlatform = {
  'darwin-x64': 'macos',
  'darwin-arm64': 'macos',
  'win32-x64': 'win-ia32',
  'win32-ia32': 'win-ia32',
  'linux-x64': 'linux',
  'linux-arm64': 'linux-arm64',
}[`${process.platform}-${process.arch}`];

const sources = [
  process.env.MAILSPRING_MAILSYNC_URL,
  `https://github.com/Bojanni050/Mailspring-Sync/releases/latest/download/mailsync-${releasePlatform}.tar.gz`,
].filter(Boolean);

const tarball = path.join(appDir, 'mailsync.tar.gz');

function unpack() {
  targz.decompress({ src: tarball, dest: `${appDir}/` }, (err) => {
    if (err) {
      console.error(`\nUnpacking failed: ${err.message}`);
      process.exit(1);
    }
    fs.rmSync(tarball, { force: true });
    if (process.platform !== 'win32') {
      candidates.forEach((file) => {
        if (fs.existsSync(file)) fs.chmodSync(file, 0o755);
      });
    }
    const installed = candidates.find((file) => fs.existsSync(file));
    if (!installed) {
      console.error('\nUnpacked, but no mailsync binary showed up in app/ — check the tarball contents.');
      process.exit(1);
    }
    console.log(`\nUnpacked ${path.relative(repoRoot, installed)} into app/. Start the app with: npm start`);
  });
}

function trySource(index, target = sources[index], redirects = 0) {
  if (!target) {
    console.error(`\nNo engine artifact for ${process.platform}-${process.arch} (${releasePlatform}).`);
    console.error('Either build it from the mailsync/ submodule, or point MAILSPRING_MAILSYNC_URL at a tarball.');
    console.error('  https://github.com/Bojanni050/Mailspring-Sync/releases');
    process.exit(1);
  }
  if (redirects === 0) console.log(`Trying ${target}`);

  https
    // GitHub's release CDN answers 403 to requests without a User-Agent.
    .get(target, { headers: { 'User-Agent': 'nuncio-fetch-mailsync' } }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && redirects < 6) {
        // GitHub answers /releases/latest/download/<asset> with a 302 to its CDN, so the
        // Location header is the whole point — re-requesting the same URL just loops.
        res.resume();
        return trySource(index, new URL(res.headers.location, target).toString(), redirects + 1);
      }
      if (res.statusCode !== 200) {
        res.resume();
        console.log(`  HTTP ${res.statusCode} — next source`);
        return trySource(index + 1);
      }
      const file = fs.createWriteStream(tarball);
      res.pipe(file);
      file.on('finish', () => {
        file.close(unpack);
      });
    })
    .on('error', (err) => {
      console.log(`  ${err.message} — next source`);
      trySource(index + 1);
    });
}

trySource(0);

