const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync, spawn } = require('node:child_process');
const http = require('node:http');

const read = (p) => fs.readFileSync(p, 'utf8').replace(/\r\n?/g, '\n');
const srv = read('payloads/ghrdp-server.ps1');

test('ghrdp-server.ps1: /progress and /api/progress handle missing mirror module without throwing', () => {
  // Verify Get-F49OptInVal guards against undefined Get-F49RuntimeOptIn
  assert.match(srv, /function Get-F49OptInVal/, 'server must define Get-F49OptInVal wrapper');
  assert.match(srv, /Get-Command Get-F49RuntimeOptIn/, 'Get-F49OptInVal must check Get-Command before calling Get-F49RuntimeOptIn');

  // Verify /progress route handler in Invoke-ClientRequest contains ok = $true
  const progIdx = srv.lastIndexOf("if ($path -eq '/progress'");
  assert.ok(progIdx >= 0, '/progress route must exist');
  const progBlock = srv.slice(progIdx, progIdx + 6000);

  assert.match(progBlock, /ok\s*=\s*\$true/, '/progress must emit ok = true');
  assert.match(progBlock, /status\s*=\s*'ok'/, '/progress must emit status = ok');
  assert.match(progBlock, /Get-F49OptInVal/, '/progress must use Get-F49OptInVal instead of raw Get-F49RuntimeOptIn');
});

test('ghrdp-server.ps1: /progress guards null/missing $cfg properties', () => {
  const progIdx = srv.lastIndexOf("if ($path -eq '/progress'");
  assert.ok(progIdx >= 0, '/progress route must exist');
  const progBlock = srv.slice(progIdx, progIdx + 6000);

  // Property access on $cfg must be inside if ($cfg)
  assert.ok(!/mirrorPlaintextElection\s*=\s*\(\[bool\]\$cfg\.mirrorPlaintextElection/.test(progBlock),
    '/progress must not access $cfg.mirrorPlaintextElection unguarded');
});

test('ghrdp-server.ps1: exception handler records correlationId, errorType, route, phase, and sha', () => {
  const catchIdx = srv.indexOf('server-exceptions.jsonl');
  assert.ok(catchIdx >= 0, 'exception catch block writing to server-exceptions.jsonl must exist');
  const catchBlock = srv.slice(catchIdx - 1000, catchIdx + 1000);

  assert.match(catchBlock, /server-exceptions\.jsonl/, 'exceptions must be written to server-exceptions.jsonl');
  assert.match(catchBlock, /corrId/, 'exception record must contain correlationId');
  assert.match(catchBlock, /errorType/, 'exception record must contain errorType');
  assert.match(catchBlock, /route/, 'exception record must contain route');
  assert.match(catchBlock, /phase/, 'exception record must contain phase');
  assert.match(catchBlock, /sha/, 'exception record must contain sha');
});

function findPwsh() {
  const tmpPwsh = '/tmp/bin/pwsh';
  if (fs.existsSync(tmpPwsh)) return tmpPwsh;
  const sysWhich = spawnSync('which', ['pwsh'], { encoding: 'utf8' });
  if (sysWhich.status === 0 && sysWhich.stdout.trim()) return sysWhich.stdout.trim();
  const sysPsWhich = spawnSync('which', ['powershell'], { encoding: 'utf8' });
  if (sysPsWhich.status === 0 && sysPsWhich.stdout.trim()) return sysPsWhich.stdout.trim();
  return null;
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(body) });
        } catch (e) {
          resolve({ status: res.statusCode, body });
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(5000, () => {
      req.destroy();
      reject(new Error('HTTP request timeout'));
    });
  });
}

test('ghrdp-server.ps1: Runtime execution test for /api/readiness and /progress under pwsh', async () => {
  const pwshPath = findPwsh();
  if (!pwshPath) {
    console.log('[ghrdp-server-500.test.js] pwsh unavailable; skipping live runtime server test');
    return;
  }

  const port = 17331;
  const testRootDir = path.join('/tmp', `ghrdp_srv_test_${Math.random().toString(36).slice(2)}`);
  fs.mkdirSync(testRootDir, { recursive: true });

  // Stage minimal config.json
  const configContent = {
    rdpUser: 'testuser',
    rdpIp: '127.0.0.1',
    dnsName: 'test.ts.net'
  };
  fs.writeFileSync(path.join(testRootDir, 'config.json'), JSON.stringify(configContent), 'utf8');

  // Spawn ghrdp-server.ps1 using pwsh
  const serverProc = spawn(pwshPath, [
    '-NoProfile',
    '-ExecutionPolicy', 'Bypass',
    '-File', path.resolve(__dirname, '../payloads/ghrdp-server.ps1'),
    '-Port', String(port),
    '-Bind', '127.0.0.1',
    '-Root', testRootDir,
    '-LimitMinutes', '1'
  ], {
    stdio: ['ignore', 'pipe', 'pipe']
  });

  let serverOutput = '';
  serverProc.stdout.on('data', (data) => { serverOutput += data.toString(); });
  serverProc.stderr.on('data', (data) => { serverOutput += data.toString(); });

  try {
    // Poll for server listener readiness
    let ready = false;
    for (let attempt = 0; attempt < 30; attempt++) {
      await new Promise(r => setTimeout(r, 200));
      try {
        const res = await fetchJson(`http://127.0.0.1:${port}/api/readiness`);
        if (res.status === 200 && res.data.ok === true) {
          ready = true;
          assert.equal(res.data.phase, 'ready');
          assert.equal(res.data.dependencyHealth.explorerFx, false); // Modules not staged in this test dir
          assert.equal(res.data.dependencyHealth.mirrorHost, false);
          break;
        }
      } catch (e) {}
    }

    assert.equal(ready, true, `Server failed to report ready at http://127.0.0.1:${port}/api/readiness. Logs:\n${serverOutput}`);

    // Verify /progress endpoint responds with ok: true
    const progRes = await fetchJson(`http://127.0.0.1:${port}/progress`);
    assert.equal(progRes.status, 200);
    assert.equal(progRes.data.ok, true);
    assert.equal(progRes.data.status, 'ok');
    assert.equal(progRes.data.phase, 'ready');

  } finally {
    serverProc.kill('SIGKILL');
    try { fs.rmSync(testRootDir, { recursive: true, force: true }); } catch {}
  }
});
