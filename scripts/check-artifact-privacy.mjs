import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

const targetDir = process.argv[2] ? path.resolve(ROOT_DIR, process.argv[2]) : path.join(ROOT_DIR, 'docs');

const SECRET_PATTERNS = [
  { name: 'Tailscale Auth Key', regex: /tskey-auth-[a-zA-Z0-9]{15,}/g },
  { name: 'GitHub Personal Access Token', regex: /ghp_[a-zA-Z0-9]{36}/g },
  { name: 'Private Key', regex: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g },
];

const ALLOWED_PLACEHOLDERS = [
  'tskey-auth-xxxx',
  'tskey-auth-placeholder',
  'tskey-auth-your-key-here',
  'YOUR_TS_AUTHKEY',
  '<TS_AUTHKEY>',
  '[TS_AUTHKEY]',
];

function redact(match) {
  if (match.length <= 12) return match.slice(0, 4) + '***';
  return match.slice(0, 10) + '...' + match.slice(-4);
}

export function scanDirectory(dir) {
  const violations = [];
  if (!fs.existsSync(dir)) {
    return violations;
  }

  function walk(currentDir) {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile()) {
        const relativePath = path.relative(ROOT_DIR, fullPath);
        let content;
        try {
          content = fs.readFileSync(fullPath, 'utf8');
        } catch {
          continue;
        }

        for (const { name, regex } of SECRET_PATTERNS) {
          const matches = content.match(regex) || [];
          for (const match of matches) {
            const lowerMatch = match.toLowerCase();
            if (ALLOWED_PLACEHOLDERS.some(p => lowerMatch.includes(p.toLowerCase()))) {
              continue;
            }
            violations.push({
              file: relativePath,
              type: name,
              redactedMatch: redact(match),
            });
          }
        }
      }
    }
  }

  walk(dir);
  return violations;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  console.log(`Scanning directory '${path.relative(ROOT_DIR, targetDir)}' for secret literals...`);
  const violations = scanDirectory(targetDir);
  if (violations.length > 0) {
    console.error('❌ Privacy scanner found potential secret literal(s):');
    for (const v of violations) {
      console.error(`  - ${v.file}: ${v.type} (${v.redactedMatch})`);
    }
    process.exit(1);
  } else {
    console.log('✅ Artifact privacy preflight passed! No secret literals found.');
    process.exit(0);
  }
}
