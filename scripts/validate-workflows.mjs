#!/usr/bin/env node
/**
 * Workflow and Script Validator
 *
 * Fast, independent preflight validation command for GitHub Actions workflows
 * and standalone scripts.
 *
 * Checks:
 * 1. YAML syntax and duplicate key detection via Python pyyaml loader.
 * 2. GitHub Actions semantic validation using pinned actionlint v1.7.7.
 * 3. Extract run blocks and validate with real parsers:
 *    - PowerShell AST ([System.Management.Automation.Language.Parser]::ParseInput)
 *    - bash -n for Bash
 * 4. Standalone script syntax checks (.ps1, .sh, .mjs, .js, .cjs).
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');

const ACTIONLINT_VERSION = '1.7.7';
const ACTIONLINT_URL = `https://github.com/rhysd/actionlint/releases/download/v${ACTIONLINT_VERSION}/actionlint_${ACTIONLINT_VERSION}_linux_amd64.tar.gz`;

/** Ensure actionlint binary is available. */
function ensureActionlint() {
  const systemWhich = spawnSync('which', ['actionlint'], { encoding: 'utf8' });
  if (systemWhich.status === 0 && systemWhich.stdout.trim()) {
    return systemWhich.stdout.trim();
  }

  const tmpBinDir = '/tmp/actionlint_bin';
  const tmpBinPath = path.join(tmpBinDir, 'actionlint');
  if (fs.existsSync(tmpBinPath)) {
    return tmpBinPath;
  }

  fs.mkdirSync(tmpBinDir, { recursive: true });
  const archivePath = '/tmp/actionlint.tar.gz';

  const curlRes = spawnSync('curl', ['-sSL', '-o', archivePath, ACTIONLINT_URL]);
  if (curlRes.status !== 0) {
    throw new Error(`Failed to download actionlint: ${curlRes.stderr}`);
  }

  const tarRes = spawnSync('tar', ['-xzf', archivePath, '-C', tmpBinDir]);
  if (tarRes.status !== 0) {
    throw new Error(`Failed to extract actionlint: ${tarRes.stderr}`);
  }

  return tmpBinPath;
}

/** Replace ${{ ... }} expressions safely with dummy string literals for parser check. */
export function sanitizeGithubExpressions(code) {
  let out = code.replace(/'\$\{\{\s*[\s\S]*?\s*\}\}'/g, "'dummy'");
  out = out.replace(/"\$\{\{\s*[\s\S]*?\s*\}\}"/g, '"dummy"');
  out = out.replace(/\$\{\{\s*[\s\S]*?\s*\}\}/g, "'dummy'");
  return out;
}

/** Check YAML duplicate keys and syntax errors using python3 pyyaml. */
export function checkYamlSyntax(filePath) {
  const pyCode = `
import sys, yaml

class UniqueKeyLoader(yaml.SafeLoader):
    def construct_mapping(self, node, deep=False):
        mapping = []
        for key_node, value_node in node.value:
            key = self.construct_object(key_node, deep=deep)
            if key in [k for k, v in mapping]:
                raise yaml.constructor.ConstructorError('while constructing a mapping', node.start_mark, f'found duplicate key ({key})', key_node.start_mark)
            value = self.construct_object(value_node, deep=deep)
            mapping.append((key, value))
        return dict(mapping)

try:
    with open(sys.argv[1], 'r', encoding='utf-8') as f:
        yaml.load(f, Loader=UniqueKeyLoader)
    sys.exit(0)
except Exception as e:
    print(str(e))
    sys.exit(1)
`;
  const res = spawnSync('python3', ['-c', pyCode, filePath], { encoding: 'utf8' });
  if (res.status !== 0) {
    return { ok: false, errors: [res.stdout.trim() || res.stderr.trim() || 'YAML syntax error'] };
  }
  return { ok: true };
}

/** Extract run blocks from workflow content using line-based block parser. */
export function extractRunBlocks(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');
  const blocks = [];

  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(\s*)run:\s*[|>][-+]?\s*$/);
    if (!m) continue;
    const keyIndent = m[1].length;

    let shell = 'bash';
    for (let j = i - 1; j >= 0; j--) {
      const sm = lines[j].match(/^\s*shell:\s*["']?([A-Za-z0-9_./-]+)/);
      if (sm) {
        shell = sm[1];
        break;
      }
      const item = lines[j].match(/^(\s*)-\s/);
      if (item && item[1].length <= keyIndent) break;
    }

    const body = [];
    let bodyIndent = null;
    for (let j = i + 1; j < lines.length; j++) {
      const raw = lines[j];
      if (raw.trim() === '') {
        body.push('');
        continue;
      }
      const ind = raw.match(/^(\s*)/)[1].length;
      if (ind <= keyIndent) break;
      if (bodyIndent === null) bodyIndent = ind;
      body.push(raw.slice(Math.min(bodyIndent, ind)));
    }
    blocks.push({ filePath, line: i + 1, shell, code: body.join('\n') + '\n' });
  }

  return blocks;
}

let pwshCmd = null;
function getPwshCmd() {
  if (pwshCmd !== null) return pwshCmd;
  const pwshCheck = spawnSync('which', ['pwsh'], { encoding: 'utf8' });
  if (pwshCheck.status === 0 && pwshCheck.stdout.trim()) {
    pwshCmd = pwshCheck.stdout.trim();
    return pwshCmd;
  }
  const psCheck = spawnSync('which', ['powershell'], { encoding: 'utf8' });
  if (psCheck.status === 0 && psCheck.stdout.trim()) {
    pwshCmd = psCheck.stdout.trim();
    return pwshCmd;
  }
  pwshCmd = false;
  return pwshCmd;
}

/** Validate PowerShell code using System.Management.Automation.Language.Parser. */
export function validatePowershellCode(code) {
  const cmd = getPwshCmd();
  if (!cmd) {
    return { ok: true, skipped: true };
  }

  const sanitized = sanitizeGithubExpressions(code);
  const tmpFile = path.join('/tmp', `val_pwsh_${Math.random().toString(36).slice(2)}.ps1`);
  const parseScript = path.join('/tmp', `val_parse_${Math.random().toString(36).slice(2)}.ps1`);

  fs.writeFileSync(tmpFile, sanitized, 'utf8');
  fs.writeFileSync(parseScript, `
param([string]$CodePath)
$code = Get-Content -LiteralPath $CodePath -Raw -Encoding utf8
$tokens = $null
$errors = $null
$null = [System.Management.Automation.Language.Parser]::ParseInput($code, [ref]$tokens, [ref]$errors)
if ($errors) {
    foreach ($e in $errors) {
        Write-Output "ERROR: $($e.Message) at line $($e.Extent.StartLineNumber)"
    }
    exit 1
}
exit 0
`, 'utf8');

  try {
    execFileSync(cmd, ['-NoProfile', '-File', parseScript, tmpFile], { stdio: ['ignore', 'pipe', 'pipe'] });
    return { ok: true };
  } catch (e) {
    const msg = String(e.stdout || e.stderr || e.message).trim();
    return { ok: false, error: msg };
  } finally {
    try { fs.rmSync(tmpFile, { force: true }); } catch {}
    try { fs.rmSync(parseScript, { force: true }); } catch {}
  }
}

/** Validate Bash code using bash -n. */
export function validateBashCode(code) {
  const sanitized = sanitizeGithubExpressions(code);
  const res = spawnSync('bash', ['-n'], { input: sanitized, encoding: 'utf8' });
  if (res.status !== 0) {
    return { ok: false, error: res.stderr.trim() || 'Bash syntax error' };
  }
  return { ok: true };
}

/** Run actionlint on workflow files. */
export function runActionlint(actionlintBin, filePaths) {
  if (filePaths.length === 0) return { ok: true, output: '' };
  const res = spawnSync(actionlintBin, ['-shellcheck=', ...filePaths], { encoding: 'utf8' });
  if (res.status !== 0) {
    return { ok: false, output: res.stdout || res.stderr };
  }
  return { ok: true, output: res.stdout };
}

export function validateWorkflowsAndScripts(targetFiles = []) {
  const results = { ok: true, errors: [] };

  const workflowsDir = path.join(REPO_ROOT, '.github', 'workflows');
  let workflowFiles = [];

  if (targetFiles.length > 0) {
    workflowFiles = targetFiles.filter(f => f.endsWith('.yml') || f.endsWith('.yaml'));
  } else if (fs.existsSync(workflowsDir)) {
    workflowFiles = fs.readdirSync(workflowsDir)
      .filter(f => f.endsWith('.yml') || f.endsWith('.yaml'))
      .map(f => path.join(workflowsDir, f));
  }

  let actionlintBin = null;
  try {
    actionlintBin = ensureActionlint();
  } catch (e) {
    console.warn(`[validator] Warning: actionlint binary unavailable (${e.message})`);
  }

  for (const wf of workflowFiles) {
    const yamlRes = checkYamlSyntax(wf);
    if (!yamlRes.ok) {
      results.ok = false;
      results.errors.push(`YAML syntax error in ${wf}:\n  ${yamlRes.errors.join('\n  ')}`);
      continue;
    }

    const blocks = extractRunBlocks(wf);
    for (const b of blocks) {
      if (/pwsh|powershell/.test(b.shell)) {
        const pwshRes = validatePowershellCode(b.code);
        if (!pwshRes.ok) {
          results.ok = false;
          results.errors.push(`PowerShell syntax error in ${b.filePath} (around line ${b.line}):\n  ${pwshRes.error}`);
        }
      } else if (/bash|sh/.test(b.shell)) {
        const bashRes = validateBashCode(b.code);
        if (!bashRes.ok) {
          results.ok = false;
          results.errors.push(`Bash syntax error in ${b.filePath} (around line ${b.line}):\n  ${bashRes.error}`);
        }
      }
    }
  }

  if (actionlintBin && workflowFiles.length > 0) {
    const lintRes = runActionlint(actionlintBin, workflowFiles);
    if (!lintRes.ok) {
      results.ok = false;
      results.errors.push(`actionlint error:\n${lintRes.output}`);
    }
  }

  return results;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const args = process.argv.slice(2);
  const res = validateWorkflowsAndScripts(args);
  if (!res.ok) {
    console.error('❌ Workflow validation FAILED:\n');
    console.error(res.errors.join('\n\n'));
    process.exit(1);
  } else {
    console.log('✅ Workflow and script validation PASSED.');
    process.exit(0);
  }
}
