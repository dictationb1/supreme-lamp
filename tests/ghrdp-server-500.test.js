const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

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
