#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const failures = [];
let checkCount = 0;

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function check({ file, expected, why, passes }) {
  checkCount += 1;
  let passed = false;
  try {
    passed = passes();
  } catch (error) {
    failures.push({ file, expected, why, error: error.message });
    return;
  }
  if (!passed) failures.push({ file, expected, why });
}

function readJSON(relativePath) {
  return JSON.parse(read(relativePath));
}

const appPackagePath = 'app/package.json';
check({
  file: appPackagePath,
  expected: 'name is "nuncio" and productName is "Nuncio"',
  why: 'The package identity and profile directory must remain Nuncio-branded.',
  passes: () => {
    const pkg = readJSON(appPackagePath);
    return pkg.name === 'nuncio' && pkg.productName === 'Nuncio';
  },
});

const updaterPath = 'app/src/browser/autoupdate-manager.ts';
check({
  file: updaterPath,
  expected: 'AUTO_UPDATE_DISABLED = true',
  why: 'Otherwise the vendor updater can replace this fork with the official binary.',
  passes: () => /\bAUTO_UPDATE_DISABLED\s*=\s*true\s*;/.test(read(updaterPath)),
});

const identityStorePath = 'app/src/flux/stores/identity-store.ts';
check({
  file: identityStorePath,
  expected: 'hasProFeatures() returns true',
  why: 'This build has no billing server; locally implemented pro features must stay available.',
  passes: () =>
    /hasProFeatures\s*\(\s*\)\s*\{[^}]*\breturn\s+true\s*;/s.test(read(identityStorePath)),
});

const identityFreePackages = [
  'open-tracking',
  'link-tracking',
  'thread-snooze',
  'send-later',
  'send-reminders',
  'activity',
];
for (const name of identityFreePackages) {
  const file = `app/internal_packages/${name}/package.json`;
  check({
    file,
    expected: 'isIdentityRequired is absent or false',
    why: `${name} is usable without a Mailspring account in Nuncio.`,
    passes: () => readJSON(file).isIdentityRequired !== true,
  });
}

for (const name of ['open-tracking', 'link-tracking']) {
  const file = `app/internal_packages/${name}/package.json`;
  check({
    file,
    expected: 'development, staging, and production serverUrl values are non-vendor URLs',
    why: `${name} must send tracking events to the Nuncio tracking service, not Mailspring.`,
    passes: () => {
      const urls = readJSON(file).serverUrl;
      return (
        ['development', 'staging', 'production'].every(
          (env) => typeof urls[env] === 'string' && /^https?:\/\//.test(urls[env])
        ) && !Object.values(urls).some((url) => /getmailspring\.com/i.test(url))
      );
    },
  });
}

check({
  file: '.gitmodules',
  expected: 'mailsync submodule URL points to Bojanni050/Mailspring-Sync',
  why: 'Nuncio requires the engine fork with the Mailspring executable-path gate removed.',
  passes: () =>
    /url\s*=\s*https:\/\/github\.com\/Bojanni050\/Mailspring-Sync\.git/.test(read('.gitmodules')),
});

const postinstallPath = 'scripts/postinstall.js';
check({
  file: postinstallPath,
  expected: 'does not download from mailspring-builds.s3.amazonaws.com',
  why: 'The upstream binary contains a path gate that prevents the Nuncio engine from starting.',
  passes: () => !/mailspring-builds\.s3\.amazonaws\.com/i.test(read(postinstallPath)),
});
check({
  file: postinstallPath,
  expected: 'prints instructions to run npm run fetch-mailsync when the binary is missing',
  why: 'Contributors need an actionable path to the fork engine, not a silent startup failure.',
  passes: () => /npm run fetch-mailsync/.test(read(postinstallPath)),
});

if (failures.length > 0) {
  for (const failure of failures) {
    console.error(`FAIL  fork invariant broken: ${failure.file}`);
    console.error(`      expected: ${failure.expected}`);
    console.error(`      why: ${failure.why}`);
    if (failure.error) console.error(`      error: ${failure.error}`);
    console.error('      see: NUNCIO.md');
  }
  console.error(`\n${failures.length} of ${checkCount} fork invariants failed.`);
  process.exitCode = 1;
} else {
  console.log(`PASS  all ${checkCount} Nuncio fork invariants hold.`);
}
