import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { runF92SmokeProbe } from '../scripts/f92-smoke-probe.mjs';

test('F92 Smoke Probe: succeeds when server returns >2KB JSON with pass status', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'f92-test-'));
  const outFile = path.join(tmpDir, 'sr.json');

  const largeData = {
    status: 'pass',
    checks: {
      subsystem1: Array.from({ length: 50 }, (_, i) => ({ id: i, status: 'pass', output: 'ok ' + 'x'.repeat(50) }))
    }
  };
  const jsonString = JSON.stringify(largeData);
  assert.ok(jsonString.length > 2500, 'Test payload must be > 2.5KB');

  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json', 'X-Correlation-ID': 'test-f92-corr' });
    res.end(jsonString);
  });

  await new Promise((res) => server.listen(0, '127.0.0.1', res));
  const port = server.address().port;

  try {
    const result = await runF92SmokeProbe({
      endpoint: `http://127.0.0.1:${port}/api/f92-selftest`,
      sha: 'test-sha',
      deadlineMs: 3000,
      outputFile: outFile,
      legacyOutputFile: path.join(tmpDir, 'sr-legacy.json'),
    });

    assert.equal(result.ok, true);
    assert.equal(result.status, 'pass');
    assert.ok(fs.existsSync(outFile));
    const saved = JSON.parse(fs.readFileSync(outFile, 'utf8'));
    assert.equal(saved.status, 'pass');
  } finally {
    server.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('F92 Smoke Probe: classifies malformed JSON response as invalid-json-response', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'f92-test-'));
  const outFile = path.join(tmpDir, 'sr.json');

  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{ invalid json response ...');
  });

  await new Promise((res) => server.listen(0, '127.0.0.1', res));
  const port = server.address().port;

  try {
    const result = await runF92SmokeProbe({
      endpoint: `http://127.0.0.1:${port}/api/f92-selftest`,
      sha: 'test-sha',
      deadlineMs: 1500,
      outputFile: outFile,
      legacyOutputFile: path.join(tmpDir, 'sr-legacy.json'),
    });

    assert.equal(result.ok, false);
    assert.equal(result.classification, 'invalid-json-response');
    assert.ok(fs.existsSync(outFile));
    const saved = JSON.parse(fs.readFileSync(outFile, 'utf8'));
    assert.equal(saved.status, 'fail');
    assert.equal(saved.classification, 'invalid-json-response');
  } finally {
    server.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('F92 Smoke Probe: classifies HTTP 500 server error', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'f92-test-'));
  const outFile = path.join(tmpDir, 'sr.json');

  const server = http.createServer((req, res) => {
    res.writeHead(500, { 'Content-Type': 'application/json', 'X-Correlation-ID': 'err-500' });
    res.end(JSON.stringify({ error: 'Internal Server Error', corrId: 'err-500' }));
  });

  await new Promise((res) => server.listen(0, '127.0.0.1', res));
  const port = server.address().port;

  try {
    const result = await runF92SmokeProbe({
      endpoint: `http://127.0.0.1:${port}/api/f92-selftest`,
      sha: 'test-sha',
      deadlineMs: 1500,
      outputFile: outFile,
      legacyOutputFile: path.join(tmpDir, 'sr-legacy.json'),
    });

    assert.equal(result.ok, false);
    assert.equal(result.classification, 'http-server-error-500');
    assert.equal(result.lastStatus, 500);
  } finally {
    server.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
