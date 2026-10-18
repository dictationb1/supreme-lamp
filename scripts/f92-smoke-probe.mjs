import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

export async function runF92SmokeProbe({
  endpoint = 'http://localhost:7331/api/f92-selftest',
  sha = 'dev',
  deadlineMs = 120000,
  outputFile = process.env.RUNNER_TEMP ? path.join(process.env.RUNNER_TEMP, 'sr.json') : '/tmp/sr.json',
  legacyOutputFile = '/tmp/sr.json',
} = {}) {
  const startTime = Date.now();
  const url = `${endpoint}?frontendSha=${sha}`;
  const maxDeadlineTime = startTime + deadlineMs;

  let attempt = 0;
  let lastClassification = 'unknown';
  let lastStatus = 0;
  let lastBody = '';
  let lastCorrId = '';

  while (Date.now() < maxDeadlineTime) {
    attempt++;
    const remainingMs = maxDeadlineTime - Date.now();
    const reqTimeoutMs = Math.min(5000, Math.max(1000, remainingMs));

    try {
      const res = await new Promise((resolve, reject) => {
        const req = http.get(url, { timeout: reqTimeoutMs }, (r) => {
          let data = '';
          r.on('data', (chunk) => {
            if (data.length < 5242880) data += chunk;
          });
          r.on('end', () => resolve({ statusCode: r.statusCode, headers: r.headers, body: data }));
        });
        req.on('error', reject);
        req.on('timeout', () => {
          req.destroy();
          reject(new Error('ETIMEDOUT'));
        });
      });

      lastStatus = res.statusCode;
      lastBody = res.body;
      lastCorrId = res.headers['x-correlation-id'] || '';

      if (res.statusCode === 200) {
        try {
          const parsed = JSON.parse(res.body);
          if (parsed.status === 'pass' || parsed.status === 'warn') {
            fs.writeFileSync(outputFile, res.body, 'utf8');
            if (outputFile !== legacyOutputFile) {
              try { fs.writeFileSync(legacyOutputFile, res.body, 'utf8'); } catch {}
            }
            console.log(`[f92 smoke] PASS attempt ${attempt}: HTTP 200 (${parsed.status})`);
            return { ok: true, status: parsed.status, attempts: attempt, body: res.body };
          } else {
            lastClassification = 'failed-selftest';
          }
        } catch {
          lastClassification = 'invalid-json-response';
        }
      } else if (res.statusCode >= 500) {
        lastClassification = 'http-server-error-500';
      } else if (res.statusCode >= 400) {
        lastClassification = 'http-client-error-' + res.statusCode;
      }
    } catch (err) {
      if (err.message === 'ETIMEDOUT') {
        lastClassification = 'request-timeout';
      } else if (err.code === 'ECONNREFUSED') {
        lastClassification = 'connection-refused';
      } else {
        lastClassification = 'transport-error: ' + err.message;
      }
    }

    const sleepMs = Math.min(2000, Math.max(200, maxDeadlineTime - Date.now()));
    if (sleepMs > 0 && Date.now() + sleepMs < maxDeadlineTime) {
      await new Promise((r) => setTimeout(r, sleepMs));
    } else {
      break;
    }
  }

  const diagPayload = JSON.stringify(
    {
      status: 'fail',
      attemptedEndpoint: url,
      classification: lastClassification,
      lastHttpStatus: lastStatus,
      elapsedMs: Date.now() - startTime,
      attempts: attempt,
      correlationId: lastCorrId,
      responseExcerpt: lastBody.slice(0, 500),
    },
    null,
    2
  );

  fs.writeFileSync(outputFile, diagPayload, 'utf8');
  if (outputFile !== legacyOutputFile) {
    try { fs.writeFileSync(legacyOutputFile, diagPayload, 'utf8'); } catch {}
  }
  console.error(`[f92 smoke] FAIL after ${attempt} attempts. Classification: ${lastClassification}, status: ${lastStatus}`);
  return { ok: false, classification: lastClassification, lastStatus, attempts: attempt, diagPayload };
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const sha = process.argv[2] || 'dev';
  runF92SmokeProbe({ sha }).then((res) => {
    if (!res.ok) process.exit(1);
  });
}
