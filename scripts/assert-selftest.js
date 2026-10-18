#!/usr/bin/env node
// [F92 §7.2] Smoke gate for main.yml: read the /api/f92-selftest
// application/health+json body and turn every `fail` check into a
// ::error:: annotation + non-zero exit. `warn` (JS-rendered sites, fixture
// drift) never blocks - the F92 contract is "red cell names the fix", and
// nightly drift must not fail a deploy.
// [F62 lesson] runs with the repo as cwd; reads ONLY the file passed to it.

const fs = require('fs');

const filePath = process.argv[2];
if (!filePath || !fs.existsSync(filePath)) {
  console.error(`::error title=Selftest File Missing::File not found: ${filePath}`);
  process.exit(1);
}

let d;
try {
  d = JSON.parse(fs.readFileSync(filePath, 'utf8'));
} catch (err) {
  console.error(`::error title=Invalid Selftest JSON::Failed to parse ${filePath}: ${err.message}`);
  process.exit(1);
}

if (!d || typeof d !== 'object') {
  console.error(`::error title=Invalid Selftest Envelope::File ${filePath} contains non-object JSON`);
  process.exit(1);
}

if (d.status === 'fail') {
  console.error(`::error title=Selftest Failed::Overall selftest status is "fail" (classification: ${d.classification || 'failed-selftest'})`);
  process.exit(1);
}

const checks = d.checks && typeof d.checks === 'object' ? d.checks : null;
if (!checks || Object.keys(checks).length === 0) {
  console.error(`::error title=Missing Selftest Checks::File ${filePath} has no checks object or 0 checks defined`);
  process.exit(1);
}

let bad = 0;
for (const [k, arr] of Object.entries(checks)) {
  for (const c of Array.isArray(arr) ? arr : [arr]) {
    if (c && c.status === 'fail') {
      console.error(`::error title=${k}::${c.output || 'no detail'}`);
      bad++;
    }
  }
}

if (bad) {
  console.error(`F92 self-test: ${bad} failing check(s); overall=${d.status}`);
  process.exit(1);
}

console.log(`All ${Object.keys(checks).length} subsystems not failing (overall=${d.status}).`);
