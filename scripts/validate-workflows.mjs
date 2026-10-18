#!/usr/bin/env node
/**
 * Workflow and Script Validator
 *
 * Independent preflight validation command for GitHub Actions workflows
 * and standalone repository scripts.
 *
 * Supported OS / Architecture: linux-x64 (macOS / Windows host fallback to system binaries if present)
 * Pinned Tool Versions:
 *   - actionlint: 1.7.7
 *   - shellcheck: 0.10.0
 *   - pwsh: 7.x
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');

export const PINNED_VERSIONS = {
  actionlint: '1.7.7',
  shellcheck: '0.10.0',
};

const ACTIONLINT_URL = `https://github.com/rhysd/actionlint/releases/download/v${PINNED_VERSIONS.actionlint}/actionlint_${PINNED_VERSIONS.actionlint}_linux_amd64.tar.gz`;
const SHELLCHECK_URL = `https://github.com/koalaman/shellcheck/releases/download/v${PINNED_VERSIONS.shellcheck}/shellcheck-v${PINNED_VERSIONS.shellcheck}.linux.x86_64.tar.xz`;
const PWSH_URL = `https://github.com/PowerShell/PowerShell/releases/download/v7.4.2/powershell-7.4.2-linux-x64.tar.gz`;

/** Utility to find executable in PATH or isolated bin cache directory */
function findTool(binName, versionArg = '--version') {
  const tmpBinDir = '/tmp/bin';
  const cachedPath = path.join(tmpBinDir, binName);
  if (fs.existsSync(cachedPath)) {
    const verRes = spawnSync(cachedPath, [versionArg], { encoding: 'utf8' });
    if (verRes.status === 0) {
      return { path: cachedPath, version: verRes.stdout.trim().split('\n')[0] };
    }
  }

  const systemWhich = spawnSync('which', [binName], { encoding: 'utf8' });
  if (systemWhich.status === 0 && systemWhich.stdout.trim()) {
    const sysPath = systemWhich.stdout.trim();
    const verRes = spawnSync(sysPath, [versionArg], { encoding: 'utf8' });
    if (verRes.status === 0) {
      return { path: sysPath, version: verRes.stdout.trim().split('\n')[0] };
    }
  }

  return null;
}

/** Ensure actionlint binary is available and verified. */
export function ensureActionlint(strict = false) {
  const found = findTool('actionlint');
  if (found) return found;

  if (os.platform() === 'linux' && os.arch() === 'x64') {
    const tmpBinDir = '/tmp/bin';
    fs.mkdirSync(tmpBinDir, { recursive: true });
    const archivePath = '/tmp/actionlint.tar.gz';

    const curlRes = spawnSync('curl', ['-sSL', '--max-time', '30', '-o', archivePath, ACTIONLINT_URL]);
    if (curlRes.status === 0) {
      const tarRes = spawnSync('tar', ['-xzf', archivePath, '-C', tmpBinDir]);
      if (tarRes.status === 0) {
        const check = findTool('actionlint');
        if (check) return check;
      }
    }
  }

  if (strict || process.env.CI) {
    throw new Error(`[INFRASTRUCTURE_FAILURE] Required tool 'actionlint' v${PINNED_VERSIONS.actionlint} is unavailable.`);
  }
  return null;
}

/** Ensure shellcheck binary is available and verified. */
export function ensureShellcheck(strict = false) {
  const found = findTool('shellcheck');
  if (found) return found;

  if (os.platform() === 'linux' && os.arch() === 'x64') {
    const tmpBinDir = '/tmp/bin';
    fs.mkdirSync(tmpBinDir, { recursive: true });
    const archivePath = '/tmp/shellcheck.tar.xz';

    const curlRes = spawnSync('curl', ['-sSL', '--max-time', '30', '-o', archivePath, SHELLCHECK_URL]);
    if (curlRes.status === 0) {
      const tarRes = spawnSync('tar', ['-xJf', archivePath, '-C', tmpBinDir, '--strip-components=1']);
      if (tarRes.status === 0) {
        const check = findTool('shellcheck');
        if (check) return check;
      }
    }
  }

  if (strict || process.env.CI) {
    throw new Error(`[INFRASTRUCTURE_FAILURE] Required tool 'shellcheck' v${PINNED_VERSIONS.shellcheck} is unavailable.`);
  }
  return null;
}

/** Ensure pwsh binary is available and verified. */
export function ensurePwsh(strict = false) {
  const found = findTool('pwsh') || findTool('powershell');
  if (found) return found;

  if (os.platform() === 'linux' && os.arch() === 'x64') {
    const tmpBinDir = '/tmp/bin';
    fs.mkdirSync(tmpBinDir, { recursive: true });
    const archivePath = '/tmp/pwsh.tar.gz';

    const curlRes = spawnSync('curl', ['-sSL', '--max-time', '30', '-o', archivePath, PWSH_URL]);
    if (curlRes.status === 0) {
      const tarRes = spawnSync('tar', ['-xzf', archivePath, '-C', tmpBinDir]);
      if (tarRes.status === 0) {
        const check = findTool('pwsh');
        if (check) return check;
      }
    }
  }

  if (strict || process.env.CI) {
    throw new Error(`[INFRASTRUCTURE_FAILURE] Required tool 'pwsh' is unavailable.`);
  }
  return null;
}

/** Replace ${{ ... }} expressions safely with dummy string literals for parser check. */
export function sanitizeGithubExpressions(code) {
  let out = code;
  out = out.replace(/'\$\{\{\s*[\s\S]*?\s*\}\}'/g, "'dummy'");
  out = out.replace(/"\$\{\{\s*[\s\S]*?\s*\}\}"/g, '"dummy"');
  out = out.replace(/\$\{\{\s*[\s\S]*?\s*\}\}/g, "'dummy'");
  return out;
}

/** Check YAML duplicate keys and extract run blocks using structured python pyyaml. */
export function parseYamlAndExtractRunBlocks(filePath) {
  const pyCode = `
import sys, json, yaml

def extract(path):
    with open(path, 'r', encoding='utf-8') as f:
        node = yaml.compose(f)
    if not node:
        return {"ok": True, "blocks": []}

    blocks = []

    def check_mapping_duplicates(map_node):
        seen = set()
        for k_node, v_node in map_node.value:
            k_val = k_node.value
            if k_val in seen:
                raise Exception(f"Duplicate key ({k_val}) at line {k_node.start_mark.line + 1}")
            seen.add(k_val)

    def walk_workflow(wf_node):
        if not isinstance(wf_node, yaml.MappingNode):
            return
        check_mapping_duplicates(wf_node)

        top_defaults = {"shell": None}
        jobs_node = None
        for k_node, v_node in wf_node.value:
            if k_node.value == 'defaults' and isinstance(v_node, yaml.MappingNode):
                check_mapping_duplicates(v_node)
                for dk_node, dv_node in v_node.value:
                    if dk_node.value == 'run' and isinstance(dv_node, yaml.MappingNode):
                        check_mapping_duplicates(dv_node)
                        for rk_node, rv_node in dv_node.value:
                            if rk_node.value == 'shell':
                                top_defaults['shell'] = rv_node.value
            elif k_node.value == 'jobs' and isinstance(v_node, yaml.MappingNode):
                jobs_node = v_node

        if not jobs_node:
            return

        check_mapping_duplicates(jobs_node)
        for job_k, job_v in jobs_node.value:
            if not isinstance(job_v, yaml.MappingNode):
                continue
            check_mapping_duplicates(job_v)

            job_defaults = dict(top_defaults)
            steps_node = None
            runs_on_val = ""

            for jk, jv in job_v.value:
                if jk.value == 'runs-on':
                    if isinstance(jv, yaml.ScalarNode):
                        runs_on_val = jv.value
                elif jk.value == 'defaults' and isinstance(jv, yaml.MappingNode):
                    check_mapping_duplicates(jv)
                    for dk_node, dv_node in jv.value:
                        if dk_node.value == 'run' and isinstance(dv_node, yaml.MappingNode):
                            check_mapping_duplicates(dv_node)
                            for rk_node, rv_node in dv_node.value:
                                if rk_node.value == 'shell':
                                    job_defaults['shell'] = rv_node.value
                elif jk.value == 'steps' and isinstance(jv, yaml.SequenceNode):
                    steps_node = jv

            is_windows = "windows" in runs_on_val.lower()

            if steps_node:
                for step_item in steps_node.value:
                    if not isinstance(step_item, yaml.MappingNode):
                        continue
                    check_mapping_duplicates(step_item)

                    step_shell = None
                    run_node = None
                    for sk, sv in step_item.value:
                        if sk.value == 'shell':
                            step_shell = sv.value
                        elif sk.value == 'run':
                            run_node = sv

                    if run_node is not None:
                        eff_shell = step_shell or job_defaults['shell']
                        if not eff_shell:
                            eff_shell = 'pwsh' if is_windows else 'bash'

                        blocks.append({
                            'filePath': path,
                            'line': run_node.start_mark.line + 1,
                            'shell': eff_shell,
                            'code': run_node.value
                        })

    try:
        walk_workflow(node)
        return {"ok": True, "blocks": blocks}
    except Exception as e:
        return {"ok": False, "error": str(e)}

if __name__ == '__main__':
    res = extract(sys.argv[1])
    print(json.dumps(res))
`;

  const res = spawnSync('python3', ['-c', pyCode, filePath], { encoding: 'utf8' });
  if (res.status !== 0 || !res.stdout.trim()) {
    const err = res.stderr.trim() || res.stdout.trim() || 'YAML syntax error';
    return { ok: false, error: err, blocks: [] };
  }

  try {
    const data = JSON.parse(res.stdout);
    return data;
  } catch (e) {
    return { ok: false, error: `YAML parse result JSON invalid: ${e.message}`, blocks: [] };
  }
}

/** Validate PowerShell code using System.Management.Automation.Language.Parser. */
export function validatePowershellCode(code, pwshInfo = null, strict = false) {
  const tool = pwshInfo || ensurePwsh(strict);
  if (!tool) {
    if (strict || process.env.CI) {
      return { ok: false, error: '[INFRASTRUCTURE_FAILURE] PowerShell runtime unavailable for validation' };
    }
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
    execFileSync(tool.path, ['-NoProfile', '-File', parseScript, tmpFile], { stdio: ['ignore', 'pipe', 'pipe'] });
    return { ok: true, toolVersion: tool.version };
  } catch (e) {
    const msg = String(e.stdout || e.stderr || e.message).trim();
    return { ok: false, error: msg, toolVersion: tool.version };
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

/** Validate standalone scripts (.ps1, .sh, .mjs, .js, .cjs) */
export function validateStandaloneScript(filePath, pwshInfo = null, strict = false) {
  if (filePath.endsWith('.ps1')) {
    const content = fs.readFileSync(filePath, 'utf8');
    const res = validatePowershellCode(content, pwshInfo, strict);
    if (!res.ok) {
      return { ok: false, error: `${filePath} (pwsh AST): ${res.error}` };
    }
  } else if (filePath.endsWith('.sh') || filePath.endsWith('.bash')) {
    const content = fs.readFileSync(filePath, 'utf8');
    const res = validateBashCode(content);
    if (!res.ok) {
      return { ok: false, error: `${filePath} (bash -n): ${res.error}` };
    }
  } else if (filePath.endsWith('.js') || filePath.endsWith('.mjs') || filePath.endsWith('.cjs')) {
    const res = spawnSync(process.execPath, ['--check', filePath], { encoding: 'utf8' });
    if (res.status !== 0) {
      return { ok: false, error: `${filePath} (node --check): ${res.stderr.trim() || res.stdout.trim()}` };
    }
  }
  return { ok: true };
}

/** Run actionlint on workflow files. */
export function runActionlint(actionlintInfo, filePaths) {
  if (filePaths.length === 0) return { ok: true, output: '' };
  const res = spawnSync(actionlintInfo.path, filePaths, { encoding: 'utf8' });
  if (res.status !== 0) {
    return { ok: false, output: res.stdout || res.stderr, toolVersion: actionlintInfo.version };
  }
  return { ok: true, output: res.stdout, toolVersion: actionlintInfo.version };
}

export function validateWorkflowsAndScripts(targetFiles = [], options = {}) {
  const strict = options.strict !== undefined ? options.strict : false;
  const results = { ok: true, errors: [] };

  let actionlintInfo = null;
  let pwshInfo = null;
  let shellcheckInfo = null;

  try {
    actionlintInfo = ensureActionlint(strict);
    pwshInfo = ensurePwsh(strict);
    shellcheckInfo = ensureShellcheck(strict);
  } catch (infraErr) {
    return { ok: false, errors: [infraErr.message] };
  }

  const workflowsDir = path.join(REPO_ROOT, '.github', 'workflows');
  let workflowFiles = [];
  let scriptFiles = [];

  if (targetFiles.length > 0) {
    workflowFiles = targetFiles.filter(f => f.endsWith('.yml') || f.endsWith('.yaml'));
    scriptFiles = targetFiles.filter(f => f.endsWith('.ps1') || f.endsWith('.sh') || f.endsWith('.mjs') || f.endsWith('.js') || f.endsWith('.cjs'));
  } else {
    if (fs.existsSync(workflowsDir)) {
      workflowFiles = fs.readdirSync(workflowsDir)
        .filter(f => f.endsWith('.yml') || f.endsWith('.yaml'))
        .map(f => path.join(workflowsDir, f));
    }
    const scriptsDir = path.join(REPO_ROOT, 'scripts');
    if (fs.existsSync(scriptsDir)) {
      scriptFiles = fs.readdirSync(scriptsDir)
        .filter(f => f.endsWith('.ps1') || f.endsWith('.sh') || f.endsWith('.mjs') || f.endsWith('.js') || f.endsWith('.cjs'))
        .map(f => path.join(scriptsDir, f));
    }
  }

  for (const wf of workflowFiles) {
    const yamlRes = parseYamlAndExtractRunBlocks(wf);
    if (!yamlRes.ok) {
      results.ok = false;
      results.errors.push(`${wf}:1 [yaml-parser] (syntax): ${yamlRes.error}`);
      continue;
    }

    for (const b of yamlRes.blocks) {
      if (/pwsh|powershell/.test(b.shell)) {
        const pwshRes = validatePowershellCode(b.code, pwshInfo, strict);
        if (!pwshRes.ok) {
          results.ok = false;
          results.errors.push(`${b.filePath}:${b.line} [powershell-ast] (syntax) [${pwshRes.toolVersion || 'pwsh'}]: ${pwshRes.error}`);
        }
      } else if (/bash|sh/.test(b.shell)) {
        const bashRes = validateBashCode(b.code);
        if (!bashRes.ok) {
          results.ok = false;
          results.errors.push(`${b.filePath}:${b.line} [bash-n] (syntax): ${bashRes.error}`);
        }
      }
    }
  }

  if (actionlintInfo && workflowFiles.length > 0) {
    const lintRes = runActionlint(actionlintInfo, workflowFiles);
    if (!lintRes.ok) {
      results.ok = false;
      results.errors.push(`[actionlint] (semantic) [${lintRes.toolVersion}]:\n${lintRes.output}`);
    }
  }

  for (const sf of scriptFiles) {
    const scRes = validateStandaloneScript(sf, pwshInfo, strict);
    if (!scRes.ok) {
      results.ok = false;
      results.errors.push(`[script-validator] (standalone): ${scRes.error}`);
    }
  }

  return results;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const args = process.argv.slice(2);
  const res = validateWorkflowsAndScripts(args, { strict: false });
  if (!res.ok) {
    console.error('❌ Workflow and script validation FAILED:\n');
    console.error(res.errors.join('\n\n'));
    process.exit(1);
  } else {
    console.log('✅ Workflow and script validation PASSED.');
    process.exit(0);
  }
}
