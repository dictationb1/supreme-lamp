import { execSync } from 'node:child_process';
try {
  execSync('node scripts/jules-repair-bridge.mjs', { stdio: 'inherit' });
} catch (e) {
  console.error(e);
}
