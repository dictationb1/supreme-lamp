#!/usr/bin/env node
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

const port = process.env.PORT || '7331';
const host = process.env.HOST || 'localhost';
const sha = process.env.GITHUB_SHA || 'unknown-sha';
const totalTimeoutMs = parseInt(process.env.DEADLINE_MS || '120000', 10);
const maxBodyBytes = parseInt(process.env.MAX_BODY_BYTES || String(5 * 1024 * 1024), 10);

const runnerTemp = process.env.RUNNER_TEMP || '/tmp';
const srPath = path.join(runnerTemp, 'sr.json');
const legacySrPath = '/tmp/sr.json';

function ensureParentDir(filePath) {
  try {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  } catch {}
}

function writeEvidence(content) {
  ensureParentDir(srPath);
  let primaryWritten = false;
  try {
    fs.writeFileSync(srPath, content);
    primaryWritten = true;
  } catch (e) {
    console.error(`Error writing srPath (${srPath}): ${e.message}`);
  }
  if (srPath !== legacySrPath) {
    ensureParentDir(legacySrPath);
    try {
      fs.writeFileSync(legacySrPath, content);
    } catch {}
  }
  return primaryWritten;
}

export async function runProbe(options = {}) {
  const pHost = options.host || host;
  const pPort = options.port || port;
  const pSha = options.sha || sha;
  const totalDeadlineMs = options.totalTimeoutMs !== undefined ? options.totalTimeoutMs : totalTimeoutMs;

  if (!Number.isFinite(totalDeadlineMs) || totalDeadlineMs <= 0) {
    throw new Error(`[INVALID_TIMEOUT] totalTimeoutMs must be a positive finite number, got: ${totalDeadlineMs}`);
  }

  const pMaxBytes = options.maxBodyBytes || maxBodyBytes;
  const startTimeMonotonic = performance.now();
  const elapsedMs = () => Math.round(performance.now() - startTimeMonotonic);

  let attempt = 0;
  let lastClassification = 'unknown';
  let lastStatus = 0;
  let lastBody = '';
  let lastCorrId = '';

  while (elapsedMs() < totalDeadlineMs) {
    attempt++;
    const currentElapsed = elapsedMs();
    const remainingMs = totalDeadlineMs - currentElapsed;
    if (remainingMs <= 10) break;

    const reqTimeoutMs = Math.min(5000, remainingMs);

    try {
      const res = await new Promise((resolve, reject) => {
        let timerId = null;
        let settled = false;

        const cleanup = () => {
          if (timerId) {
            clearTimeout(timerId);
            timerId = null;
          }
        };

        const req = http.get(
          `http://${pHost}:${pPort}/api/f92-selftest?frontendSha=${pSha}`,
          { timeout: reqTimeoutMs },
          (r) => {
            const chunks = [];
            let totalBytes = 0;
            let aborted = false;

            r.on('data', (chunk) => {
              if (aborted || settled) return;
              totalBytes += chunk.length;
              if (totalBytes > pMaxBytes) {
                aborted = true;
                settled = true;
                cleanup();
                req.destroy();
                reject(new Error('OVERSIZED_RESPONSE'));
                return;
              }
              chunks.push(chunk);
            });

            r.on('end', () => {
              if (aborted || settled) return;
              settled = true;
              cleanup();
              const fullBuffer = Buffer.concat(chunks);
              resolve({
                statusCode: r.statusCode,
                headers: r.headers,
                body: fullBuffer.toString('utf8'),
              });
            });

            r.on('error', (err) => {
              if (!settled) {
                settled = true;
                cleanup();
                reject(err);
              }
            });
          }
        );

        timerId = setTimeout(() => {
          if (!settled) {
            settled = true;
            req.destroy();
            reject(new Error('ETIMEDOUT'));
          }
        }, reqTimeoutMs);

        req.on('error', (err) => {
          if (!settled) {
            settled = true;
            cleanup();
            reject(err);
          }
        });
      });

      lastStatus = res.statusCode;
      lastBody = res.body;
      lastCorrId = res.headers['x-correlation-id'] || '';

      if (res.statusCode === 200) {
        let parsed = null;
        try {
          parsed = JSON.parse(res.body);
        } catch {
          lastClassification = 'malformed-json';
        }

        if (parsed) {
          if (
            !parsed ||
            typeof parsed !== 'object' ||
            !parsed.status ||
            !parsed.checks ||
            typeof parsed.checks !== 'object' ||
            Object.keys(parsed.checks).length === 0
          ) {
            lastClassification = 'schema-mismatch';
          } else if (parsed.status === 'fail') {
            lastClassification = 'failed-selftest';
          } else if (parsed.status === 'pass' || parsed.status === 'warn') {
            let hasNestedFail = false;
            for (const arr of Object.values(parsed.checks)) {
              for (const c of Array.isArray(arr) ? arr : [arr]) {
                if (c && c.status === 'fail') {
                  hasNestedFail = true;
                  break;
                }
              }
              if (hasNestedFail) break;
            }

            if (hasNestedFail) {
              lastClassification = 'failed-nested-check';
            } else {
              // Success! Must write evidence
              const written = writeEvidence(res.body);
              if (!written) {
                lastClassification = 'evidence-write-failure';
                console.error('[f92 smoke] FAIL: Could not write evidence artifact.');
                return { ok: false, attempt, classification: 'evidence-write-failure', status: 200, body: res.body };
              }
              console.log(
                `[f92 smoke] PASS attempt ${attempt}: HTTP 200 (${parsed.status}) in ${elapsedMs()}ms`
              );
              return { ok: true, attempt, classification: 'ready', status: 200, body: res.body, elapsedMs: elapsedMs() };
            }
          } else {
            lastClassification = `invalid-status-${parsed.status}`;
          }
        }
      } else if (res.statusCode >= 500) {
        lastClassification = 'http-server-error-500';
      } else if (res.statusCode >= 400) {
        lastClassification = `http-client-error-${res.statusCode}`;
      }
    } catch (err) {
      if (err.message === 'ETIMEDOUT') {
        lastClassification = 'request-timeout';
      } else if (err.code === 'ECONNREFUSED') {
        lastClassification = 'connection-refused';
      } else if (err.code === 'ECONNRESET') {
        lastClassification = 'connection-reset';
      } else if (err.message === 'OVERSIZED_RESPONSE') {
        lastClassification = 'oversized-response';
      } else {
        lastClassification = `transport-error: ${err.message}`;
      }
    }

    const remaining = totalDeadlineMs - elapsedMs();
    if (remaining <= 0) break;
    const sleepMs = Math.min(2000, Math.max(100, remaining));
    await new Promise((r) => setTimeout(r, sleepMs));
  }

  const totalElapsed = elapsedMs();
  const diagPayload = JSON.stringify(
    {
      status: 'fail',
      attemptedEndpoint: `http://${pHost}:${pPort}/api/f92-selftest`,
      classification: lastClassification,
      lastHttpStatus: lastStatus,
      elapsedMs: totalElapsed,
      attempts: attempt,
      correlationId: lastCorrId,
      responseExcerpt: lastBody ? lastBody.slice(0, 500) : '',
    },
    null,
    2
  );

  writeEvidence(diagPayload);
  console.error(
    `[f92 smoke] FAIL after ${attempt} attempts in ${totalElapsed}ms. Classification: ${lastClassification}, status: ${lastStatus}`
  );
  return { ok: false, attempt, classification: lastClassification, status: lastStatus, elapsedMs: totalElapsed };
}

// CLI execution
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename || '')) {
  runProbe().then((res) => {
    process.exit(res.ok ? 0 : 1);
  });
}
