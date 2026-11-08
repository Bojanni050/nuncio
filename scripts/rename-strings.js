#!/usr/bin/env node
/* eslint global-require: 0 */
/**
 * Renames the product in user-visible strings only.
 *
 * A plain text replace also hits comments (which describe upstream behaviour and should keep
 * saying so) and can trip over apostrophes inside single-quoted strings. Parsing with the
 * TypeScript compiler gives the exact ranges of string literals, template chunks and JSX text,
 * so the rename stays inside what a user can actually read.
 *
 * Usage: node scripts/rename-strings.js [--dry-run]
 */

const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const FROM = 'Mailspring';
const TO = 'Nuncio';
const ROOTS = ['app/src', 'app/internal_packages', 'app/menus'];
const DRY = process.argv.includes('--dry-run');

// URLs and package/protocol names must survive: they are identifiers, not copy.
const SKIP = [
  'getmailspring.com',
  'mailspring://',
  'mailspring-exports',
  'Mailspring-Sync',
  'mailspring-component-kit',
  'mailspring-store',
  'mailspring-observables',
  'mailspring-migrations',
  // Upstream's starter repos are real, still useful, and not ours to rename.
  'Mailspring-Plugin-Starter',
  'Mailspring-Theme-Starter',
];

// Literals that are identifiers or are compared against stored/server data, never shown as copy.
// Renaming one of these silently breaks a lookup: `MailspringAPIRequest` is registered under that
// exact name in the global shim, and the folder prefixes below are matched against IMAP paths.
const PROTECTED = {
  'app/src/global/mailspring-exports.js': ['MailspringAPIRequest', 'MailspringTestUtils'],
  'app/internal_packages/views/runtime/loader.js': ['MailspringView'],
  'app/internal_packages/account-sidebar/lib/sidebar-item.ts': ['[Mailspring]', 'Mailspring'],
  'app/internal_packages/onboarding/lib/onboarding-helpers.ts': ['Mailspring'],
};

// A bare identifier has no space in it, so it is a key or a module name — never prose.
const BARE_IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

const STRING_KINDS = new Set([
  ts.SyntaxKind.StringLiteral,
  ts.SyntaxKind.NoSubstitutionTemplateLiteral,
  ts.SyntaxKind.TemplateHead,
  ts.SyntaxKind.TemplateMiddle,
  ts.SyntaxKind.TemplateTail,
  ts.SyntaxKind.JsxText,
]);

function scriptKind(file) {
  if (file.endsWith('.tsx')) return ts.ScriptKind.TSX;
  if (file.endsWith('.ts')) return ts.ScriptKind.TS;
  if (file.endsWith('.jsx')) return ts.ScriptKind.JSX;
  return ts.ScriptKind.JS;
}

function editsFor(file) {
  const text = fs.readFileSync(file, 'utf8');
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, scriptKind(file));
  const edits = [];

  // Iterative: a few generated view bundles nest deeply enough to blow the JS stack when the
  // walk recurses per AST node.
  const stack = [sf];
  while (stack.length) {
    const node = stack.pop();
    if (STRING_KINDS.has(node.kind)) {
      const start = node.getStart(sf);
      const end = node.getEnd();
      const raw = text.slice(start, end);
      const value = raw.replace(/^[`'"]|[`'"]$/g, '');
      const protectedHere = PROTECTED[path.relative(process.cwd(), file)] || [];
      const skip =
        !raw.includes(FROM) ||
        SKIP.some((marker) => raw.includes(marker)) ||
        BARE_IDENTIFIER.test(value) ||
        protectedHere.includes(value);
      if (!skip) {
        edits.push({ start, end, next: raw.split(FROM).join(TO) });
      }
      continue;
    }
    ts.forEachChild(node, (child) => {
      stack.push(child);
    });
  }

  return { text, edits };
}

let files = 0;
let strings = 0;
for (const root of ROOTS) {
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== 'node_modules') walk(p);
        continue;
      }
      if (!/\.(ts|tsx|js|jsx)$/.test(entry.name) || entry.name.endsWith('.d.ts')) continue;

      const { text, edits } = editsFor(p);
      if (!edits.length) continue;

      files += 1;
      strings += edits.length;
      let out = text;
      for (const edit of edits.sort((a, b) => b.start - a.start)) {
        out = out.slice(0, edit.start) + edit.next + out.slice(edit.end);
      }
      console.log(`  ${edits.length}\t${p}`);
      if (!DRY) fs.writeFileSync(p, out);
    }
  };
  walk(root);
}

console.log(`\n${DRY ? 'Would rename' : 'Renamed'} ${strings} strings in ${files} files.`);
