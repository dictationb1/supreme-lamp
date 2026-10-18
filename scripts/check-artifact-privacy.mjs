#!/usr/bin/env node
/**
 * Artifact Privacy Scanner
 * Inspects tracked files / publication directories (e.g., docs/) for leaked
 * actual credential values, private keys, or literal secret assignments while
 * allowing variable names, environment references, GitHub expressions, and
 * documented placeholder examples.
 */

import fs from 'node:fs';
import path from 'node:path';

// Known rules for credential detection
const PRIVACY_RULES = [
  {
    id: 'TAILSCALE_AUTHKEY_LITERAL',
    description: 'Actual Tailscale auth key literal detected',
    pattern: /\btskey-(?:auth-)?[a-zA-Z0-9_-]{20,}\b/g,
    isAllowed: (match) => {
      const m = match.toLowerCase();
      return (
        m.includes('example') ||
        m.includes('placeholder') ||
        m.includes('xxxx') ||
        m.includes('dummy')
      );
    },
  },
  {
    id: 'PEM_PRIVATE_KEY',
    description: 'PEM private key block detected',
    pattern: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |)PRIVATE KEY-----/g,
    isAllowed: (match) => match.includes('SAMPLE') || match.includes('EXAMPLE'),
  },
  {
    id: 'LITERAL_SECRET_ASSIGNMENT',
    description: 'Literal secret assigned to secret variable',
    pattern: /\b(TS_AUTHKEY|VNC_PASS|RENTRY_EDIT_PASSWORD|TAILSCALE_AUTHKEY|AWS_SECRET_ACCESS_KEY)\s*[:=]\s*["']?([^\s"';$<>{}\n]+)["']?/gi,
    isAllowed: (match, varName, value) => {
      if (!value) return true;
      const val = value.trim();
      if (!val) return true;
      const lower = val.toLowerCase();

      // Allowed variable references, expressions, placeholders, commands
      if (
        val.startsWith('$') ||
        val.startsWith('process.env') ||
        val.startsWith('env.') ||
        val.startsWith('secrets.') ||
        val.startsWith('{{') ||
        val.startsWith('<') ||
        val.startsWith('[') ||
        val.startsWith('*') ||
        lower.startsWith('read-host') ||
        lower.startsWith('get-content') ||
        lower.startsWith('get-item')
      ) {
        return true;
      }

      // Allowed placeholder strings
      const allowedPlaceholders = [
        'xxx',
        'xxxx',
        'placeholder',
        'your-key',
        'your_key',
        'your-password',
        'your_password',
        'your_pass',
        'example',
        'sample',
        'dummy',
        'redacted',
        'none',
        'null',
        'undefined',
        'true',
        'false',
        '1',
        '0',
        'auto',
        'default',
        'read-host',
      ];

      for (const ph of allowedPlaceholders) {
        if (lower.includes(ph)) return true;
      }

      return false;
    },
  },
];

export function redactContext(lineText, matchText) {
  if (!matchText || !lineText) return lineText;
  return lineText.replace(matchText, '[REDACTED]');
}

export function scanContent(filePath, content) {
  const findings = [];
  const lines = content.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const lineNum = i + 1;
    const line = lines[i];

    for (const rule of PRIVACY_RULES) {
      rule.pattern.lastIndex = 0;
      let match;
      while ((match = rule.pattern.exec(line)) !== null) {
        const fullMatch = match[0];
        const group1 = match[1];
        const group2 = match[2];

        if (rule.isAllowed && rule.isAllowed(fullMatch, group1, group2)) {
          continue;
        }

        const redacted = redactContext(line, fullMatch);
        findings.push({
          file: filePath,
          line: lineNum,
          rule: rule.id,
          description: rule.description,
          redactedContext: redacted,
        });
      }
    }
  }

  return findings;
}

export function scanDirectory(dirPath, extensions = ['.md', '.html', '.js', '.json', '.txt', '.yml', '.yaml', '.mjs', '.cjs', '.ts', '.css']) {
  const allFindings = [];

  function walk(currentPath) {
    let entries;
    try {
      entries = fs.readdirSync(currentPath, { withFileTypes: true });
    } catch (err) {
      throw new Error(`Execution error reading directory "${currentPath}": ${err.message}`);
    }

    for (const entry of entries) {
      const fullPath = path.join(currentPath, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === '.git' || entry.name === 'node_modules') continue;
        walk(fullPath);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (extensions.length === 0 || extensions.includes(ext)) {
          let content;
          try {
            content = fs.readFileSync(fullPath, 'utf8');
          } catch (err) {
            throw new Error(`Execution error reading file "${fullPath}": ${err.message}`);
          }
          const findings = scanContent(fullPath, content);
          allFindings.push(...findings);
        }
      }
    }
  }

  walk(dirPath);
  return allFindings;
}

// CLI entry point
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename || '')) {
  const targetDir = process.argv[2] || 'docs';
  console.log(`[artifact-privacy-check] Scanning directory: ${targetDir}`);

  try {
    const findings = scanDirectory(targetDir);

    if (findings.length > 0) {
      console.error(`[artifact-privacy-check] FAIL: Detected ${findings.length} secret finding(s):`);
      for (const f of findings) {
        console.error(`  ${f.file}:${f.line} [${f.rule}] ${f.description}`);
        console.error(`    Context: ${f.redactedContext}`);
      }
      process.exit(1);
    } else {
      console.log(`[artifact-privacy-check] PASS: No secrets detected in ${targetDir}`);
      process.exit(0);
    }
  } catch (err) {
    console.error(`[artifact-privacy-check] SCANNER EXECUTION ERROR: ${err.message}`);
    process.exit(2); // Execution error vs detection error
  }
}
