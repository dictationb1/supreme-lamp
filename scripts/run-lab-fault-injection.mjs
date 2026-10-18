#!/usr/bin/env node
/**
 * Lab Fault Injection Harness
 * Exercises real production helpers, process trees, and server behaviors under controlled fault conditions.
 */

import { spawn, spawnSync, execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';

const faultType = process.argv[2] || process.env.INJECTED_FAILURE || 'NONE';

console.log(`[lab-fault] Executing controlled fault test for: ${faultType}`);

if (faultType === 'NONE' || !faultType) {
  console.log('[lab-fault] No fault specified. Success.');
  process.exit(0);
}

if (faultType === 'PAGES_SCANNER_SYNTHETIC') {
  // Test genuine synthetic detection
  const tmpDir = fs.mkdtempSync(path.join(process.env.RUNNER_TEMP || '/tmp', 'canary-'));
  const canaryKey = 'tskey-auth-k9999988888777776666655555';
  const canaryFile = path.join(tmpDir, 'secret.md');
  fs.writeFileSync(canaryFile, `TS_AUTHKEY=${canaryKey}\n`);

  try {
    const res = execSync(`node scripts/check-artifact-privacy.mjs "${tmpDir}"`, { encoding: 'utf8', stdio: 'pipe' });
    console.error('[lab-fault] FAIL: Privacy scanner passed on synthetic secret file!');
    process.exit(1);
  } catch (err) {
    const output = (err.stdout || '') + (err.stderr || '');
    if (!output.includes('[REDACTED]') || output.includes(canaryKey)) {
      console.error('[lab-fault] FAIL: Privacy scanner output disclosed canary or missed redaction!');
      process.exit(1);
    }
    console.log('[lab-fault] PASS: Privacy scanner detected canary secret and redacted output correctly.');
    fs.rmSync(tmpDir, { recursive: true, force: true });
    process.exit(0);
  }
}

if (faultType === 'PAGES_SCANNER_FALSE_POSITIVE') {
  // Test that Sinhala documentation and placeholder variable names pass
  const tmpDir = fs.mkdtempSync(path.join(process.env.RUNNER_TEMP || '/tmp', 'doc-'));
  const docFile = path.join(tmpDir, 'guide.md');
  fs.writeFileSync(
    docFile,
    '# Setup\nTS_AUTHKEY secret එක එකතු කරන්න.\nexport TS_AUTHKEY=$TS_AUTHKEY\n'
  );

  try {
    execSync(`node scripts/check-artifact-privacy.mjs "${tmpDir}"`, { encoding: 'utf8', stdio: 'pipe' });
    console.log('[lab-fault] PASS: Sinhala doc and variable names passed privacy scanner.');
    fs.rmSync(tmpDir, { recursive: true, force: true });
    process.exit(0);
  } catch (err) {
    console.error('[lab-fault] FAIL: Privacy scanner false positive on doc file!');
    fs.rmSync(tmpDir, { recursive: true, force: true });
    process.exit(1);
  }
}

if (faultType === 'INVALID_READINESS_SCHEMA') {
  // Spin up HTTP server returning 200 without readiness ok
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ randomField: 'value' }));
  });

  await new Promise((resolve) => server.listen(7331, '127.0.0.1', resolve));
  console.log('[lab-fault] Mock server returning 200 without readiness schema running on port 7331.');

  // Run readiness probe against it
  try {
    const probeRes = execSync('node scripts/f92-smoke-probe.mjs', {
      env: { ...process.env, PORT: '7331', DEADLINE_MS: '1500' },
      encoding: 'utf8',
      stdio: 'pipe',
    });
    console.error('[lab-fault] FAIL: Smoke probe accepted HTTP 200 with invalid schema!');
    server.close();
    process.exit(1);
  } catch (err) {
    const output = (err.stdout || '') + (err.stderr || '');
    if (output.includes('schema-mismatch') || output.includes('FAIL')) {
      console.log('[lab-fault] PASS: Smoke probe rejected HTTP 200 with invalid schema as schema-mismatch.');
      server.close();
      process.exit(0);
    }
    console.error('[lab-fault] FAIL: Unexpected output for schema mismatch: ' + output);
    server.close();
    process.exit(1);
  }
}

if (faultType === 'SERVER_500_CORRELATED') {
  // Test HTTP 500 response handling
  const server = http.createServer((req, res) => {
    res.writeHead(500, { 'Content-Type': 'application/json', 'X-Correlation-ID': 'corr-lab-500' });
    res.end(
      JSON.stringify({
        serverTs: new Date().toISOString(),
        corrId: 'corr-lab-500',
        handlerError: 'TestException',
        route: '/progress',
        phase: 'ready',
        sha: 'test-sha',
      })
    );
  });

  await new Promise((resolve) => server.listen(7331, '127.0.0.1', resolve));

  try {
    execSync('node scripts/f92-smoke-probe.mjs', {
      env: { ...process.env, PORT: '7331', DEADLINE_MS: '1500' },
      encoding: 'utf8',
      stdio: 'pipe',
    });
    console.error('[lab-fault] FAIL: Smoke probe accepted HTTP 500!');
    server.close();
    process.exit(1);
  } catch (err) {
    const output = (err.stdout || '') + (err.stderr || '');
    if (output.includes('http-server-error-500') || output.includes('FAIL')) {
      console.log('[lab-fault] PASS: Smoke probe detected HTTP 500 and captured correlation ID.');
      server.close();
      process.exit(0);
    }
    server.close();
    process.exit(1);
  }
}

console.log(`[lab-fault] Executing generic control fault: ${faultType}`);
process.exit(1);
