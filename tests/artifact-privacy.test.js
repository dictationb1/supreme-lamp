import test from 'node:test';
import assert from 'node:assert/strict';
import { scanContent, scanDirectory } from '../scripts/check-artifact-privacy.mjs';

test('Artifact Privacy Scanner - Existing Sinhala documentation passes', () => {
  const findings = scanDirectory('docs');
  assert.equal(findings.length, 0, 'Existing documentation in docs/ must pass scanner cleanly');
});

test('Artifact Privacy Scanner - Secret variable names and placeholder examples pass', () => {
  const content = `
  # Setup Guide
  Set TS_AUTHKEY and VNC_PASS in GitHub Secrets.
  export TS_AUTHKEY=$TS_AUTHKEY
  TS_AUTHKEY=\${{ secrets.TS_AUTHKEY }}
  VNC_PASS="<your_password_here>"
  TS_AUTHKEY=tskey-auth-EXAMPLE12345678901234
  `;

  const findings = scanContent('dummy.md', content);
  assert.equal(findings.length, 0, 'Variable names and placeholders must be allowed');
});

test('Artifact Privacy Scanner - Representative secret-shaped literal values fail', () => {
  const canaryKey = 'tskey-auth-k98765432101234567890abcdef';
  const content = `
  # Leaked File
  TS_AUTHKEY=${canaryKey}
  VNC_PASS=SuperSecretP@ssw0rd!123
  `;

  const findings = scanContent('leaked.md', content);
  assert.ok(findings.length >= 1, 'Secret-shaped literal values must be flagged');

  // Verify failure output does not disclose the raw canary value
  for (const f of findings) {
    assert.ok(
      !f.redactedContext.includes(canaryKey),
      'Redacted context must not disclose raw canary secret value'
    );
    assert.ok(
      f.redactedContext.includes('[REDACTED]'),
      'Redacted context must contain [REDACTED]'
    );
  }
});

test('Artifact Privacy Scanner - Broken scanner cannot produce false pass', () => {
  // Test invalid input or broken rule handling
  assert.throws(() => {
    scanDirectory('/nonexistent_directory_path_12345');
  }, /Execution error/);
});
