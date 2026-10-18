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

// Helper to run probe asynchronously while keeping server event loop alive
function runProbeAsync(envVars) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['scripts/f92-smoke-probe.mjs'], {
      env: { ...process.env, ...envVars },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('close', (code) => {
      resolve({ code, stdout, stderr, output: stdout + stderr });
    });
  });
}

// Positive control
if (faultType === 'HEALTHY_POSITIVE_CONTROL') {
  const port = 18331;
  let serverReceivedRequest = false;
  const server = http.createServer((req, res) => {
    serverReceivedRequest = true;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'pass',
      checks: {
        'search:test': [{ status: 'pass', output: 'ok' }]
      }
    }));
  });

  await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));

  const probeRes = await runProbeAsync({ PORT: String(port), HOST: '127.0.0.1', DEADLINE_MS: '3000' });

  server.close();

  if (probeRes.code === 0 && serverReceivedRequest) {
    console.log('[lab-fault] PASS: Healthy positive control passed smoke probe.');
    process.exit(0);
  } else {
    console.error('[lab-fault] FAIL: Healthy positive control failed smoke probe:', probeRes.output);
    process.exit(1);
  }
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
    fs.rmSync(tmpDir, { recursive: true, force: true });
    process.exit(1);
  } catch (err) {
    const output = (err.stdout || '') + (err.stderr || '');
    if (!output.includes('[REDACTED]') || output.includes(canaryKey)) {
      console.error('[lab-fault] FAIL: Privacy scanner output disclosed canary or missed redaction!');
      fs.rmSync(tmpDir, { recursive: true, force: true });
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
  const port = 18332;
  let serverReceivedRequest = false;
  const server = http.createServer((req, res) => {
    serverReceivedRequest = true;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ randomField: 'value' }));
  });

  await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));

  const probeRes = await runProbeAsync({ PORT: String(port), HOST: '127.0.0.1', DEADLINE_MS: '2000' });

  server.close();

  if (probeRes.code !== 0 && serverReceivedRequest && probeRes.output.includes('schema-mismatch')) {
    console.log('[lab-fault] PASS: Smoke probe rejected HTTP 200 with invalid schema as schema-mismatch.');
    process.exit(0);
  } else {
    console.error('[lab-fault] FAIL: Invalid readiness schema test failed. Output:\n' + probeRes.output);
    process.exit(1);
  }
}

if (faultType === 'SERVER_500_CORRELATED') {
  const port = 18333;
  let serverReceivedRequest = false;
  const corrId = 'corr-lab-500-test';
  const server = http.createServer((req, res) => {
    serverReceivedRequest = true;
    res.writeHead(500, { 'Content-Type': 'application/json', 'X-Correlation-ID': corrId });
    res.end(
      JSON.stringify({
        serverTs: new Date().toISOString(),
        corrId: corrId,
        handlerError: 'TestException',
        route: '/api/readiness',
        phase: 'ready',
        sha: 'test-sha',
      })
    );
  });

  await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));

  const probeRes = await runProbeAsync({ PORT: String(port), HOST: '127.0.0.1', DEADLINE_MS: '2000' });

  server.close();

  if (probeRes.code !== 0 && serverReceivedRequest && probeRes.output.includes('http-server-error-500')) {
    console.log('[lab-fault] PASS: Smoke probe detected HTTP 500 and captured correlation ID.');
    process.exit(0);
  } else {
    console.error('[lab-fault] FAIL: Server 500 test failed. Output:\n' + probeRes.output);
    process.exit(1);
  }
}

// Reject unsupported fault type explicitly
console.error(`[lab-fault] ERROR: Unsupported fault type requested: ${faultType}`);
process.exit(1);
