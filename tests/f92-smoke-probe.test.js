import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { runProbe } from '../scripts/f92-smoke-probe.mjs';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

function createMockServer(handler) {
  const server = http.createServer(handler);
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      resolve({
        port,
        close: () => new Promise((res) => server.close(res)),
      });
    });
  });
}

test('f92-smoke-probe: Handles healthy responses > 2 KB without truncation', async () => {
  // Generate a large valid response > 2KB
  const largeChecks = {};
  for (let i = 0; i < 50; i++) {
    largeChecks[`search:site${i}`] = {
      status: 'pass',
      observedValue: i * 10,
      output: 'A'.repeat(100),
    };
  }
  const body = JSON.stringify({ status: 'pass', checks: largeChecks });
  assert.ok(body.length > 2000, `Body size (${body.length}) must exceed 2000 bytes`);

  const mock = await createMockServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json', 'X-Correlation-ID': 'corr-123' });
    res.end(body);
  });

  try {
    const res = await runProbe({ host: '127.0.0.1', port: mock.port, totalTimeoutMs: 3000 });
    assert.equal(res.ok, true);
    assert.equal(res.classification, 'ready');
  } finally {
    await mock.close();
  }
});

test('f92-smoke-probe: Handles chunked streaming responses correctly', async () => {
  const mock = await createMockServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.write('{"status": "pass", ');
    setTimeout(() => {
      res.write('"checks": {"system": {"status": "pass"}}}');
      res.end();
    }, 50);
  });

  try {
    const res = await runProbe({ host: '127.0.0.1', port: mock.port, totalTimeoutMs: 3000 });
    assert.equal(res.ok, true);
    assert.equal(res.classification, 'ready');
  } finally {
    await mock.close();
  }
});

test('f92-smoke-probe: Handles HTTP 500 error from server', async () => {
  const mock = await createMockServer((req, res) => {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'internal error' }));
  });

  try {
    const res = await runProbe({ host: '127.0.0.1', port: mock.port, totalTimeoutMs: 1000 });
    assert.equal(res.ok, false);
    assert.equal(res.classification, 'http-server-error-500');
  } finally {
    await mock.close();
  }
});

test('f92-smoke-probe: Handles invalid JSON response', async () => {
  const mock = await createMockServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('NOT_VALID_JSON{{{');
  });

  try {
    const res = await runProbe({ host: '127.0.0.1', port: mock.port, totalTimeoutMs: 1000 });
    assert.equal(res.ok, false);
    assert.equal(res.classification, 'malformed-json');
  } finally {
    await mock.close();
  }
});

test('f92-smoke-probe: Handles status: fail without checks', async () => {
  const mock = await createMockServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'fail' }));
  });

  try {
    const res = await runProbe({ host: '127.0.0.1', port: mock.port, totalTimeoutMs: 1000 });
    assert.equal(res.ok, false);
    assert.equal(res.classification, 'schema-mismatch');
  } finally {
    await mock.close();
  }
});

test('assert-selftest.js: Rejects overall failure envelope with no checks', () => {
  const tmpFile = path.join(process.env.RUNNER_TEMP || '/tmp', 'test-sr-fail.json');
  fs.writeFileSync(tmpFile, JSON.stringify({ status: 'fail', classification: 'connection-refused' }));

  assert.throws(() => {
    execSync(`node scripts/assert-selftest.js "${tmpFile}"`, { stdio: 'pipe' });
  });
});
