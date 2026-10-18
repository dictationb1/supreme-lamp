import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const WORKFLOWS_DIR = path.join(ROOT_DIR, '.github', 'workflows');

let hasPwsh = false;
try {
  execFileSync('which', ['pwsh'], { stdio: 'ignore' });
  hasPwsh = true;
} catch {
  try {
    execFileSync('which', ['powershell'], { stdio: 'ignore' });
    hasPwsh = true;
  } catch {
    hasPwsh = false;
  }
}

/** Pure JS YAML Duplicate Key and Structural Validator */
export function checkYamlDuplicateKeys(content, filename = 'workflow.yml') {
  const errors = [];
  const lines = content.split('\n');
  const scopeStack = [{ indent: -1, keys: new Set() }];

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const lineNum = i + 1;
    if (!raw.trim() || raw.trim().startsWith('#')) continue;

    const indentMatch = raw.match(/^(\s*)/);
    const indent = indentMatch ? indentMatch[1].length : 0;

    const keyMatch = raw.match(/^(\s*)(?:-\s+)?([a-zA-Z0-9_-]+)\s*:/);
    if (keyMatch) {
      const key = keyMatch[2];

      while (scopeStack.length > 1 && scopeStack[scopeStack.length - 1].indent >= indent) {
        scopeStack.pop();
      }

      const currentScope = scopeStack[scopeStack.length - 1];
      if (currentScope.indent === indent) {
        if (currentScope.keys.has(key)) {
          errors.push(`Duplicated mapping key '${key}' at ${filename}:${lineNum}`);
        } else {
          currentScope.keys.add(key);
        }
      } else {
        const newScope = { indent, keys: new Set([key]) };
        scopeStack.push(newScope);
      }
    }
  }
  return errors;
}

export function validateYamlContent(content, filename = 'workflow.yml') {
  const errors = [];

  // Check duplicate keys
  const dupErrors = checkYamlDuplicateKeys(content, filename);
  errors.push(...dupErrors);

  // Check unclosed ${{ expressions across the entire document
  let openIndex = 0;
  while ((openIndex = content.indexOf('${{', openIndex)) !== -1) {
    const closeIndex = content.indexOf('}}', openIndex);
    if (closeIndex === -1) {
      const lineNum = content.slice(0, openIndex).split('\n').length;
      errors.push(`Unclosed '\${{' expression in ${filename}:${lineNum}`);
      break;
    }
    openIndex = closeIndex + 2;
  }

  // Parse basic job IDs and needs dependencies
  const jobIds = new Set();
  const jobNeeds = [];
  const lines = content.split('\n');
  let inJobs = false;
  let currentJob = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;
    if (line.trim().startsWith('#')) continue;

    if (/^jobs\s*:/.test(line)) {
      inJobs = true;
      continue;
    }

    if (inJobs) {
      if (/^[a-zA-Z0-9_-]+\s*:/.test(line) && !line.startsWith(' ') && !line.startsWith('\t')) {
        inJobs = false; // Left jobs section
        currentJob = null;
        continue;
      }

      const jobMatch = line.match(/^  ([a-zA-Z0-9_-]+)\s*:/);
      if (jobMatch) {
        currentJob = jobMatch[1];
        jobIds.add(currentJob);
      }

      if (currentJob) {
        const needsMatch = line.match(/^\s+needs\s*:\s*\[?([^\]]+)\]?/);
        if (needsMatch) {
          const rawNeeds = needsMatch[1].split(',').map(s => s.trim().replace(/^['"]|['"]$/g, ''));
          for (const need of rawNeeds) {
            if (need) jobNeeds.push({ jobId: currentJob, need, lineNum });
          }
        }

        const usesMatch = line.match(/^\s+uses\s*:\s*\.\/\.github\/workflows\/([a-zA-Z0-9_.-]+)/);
        if (usesMatch) {
          const relPath = `.github/workflows/${usesMatch[1]}`;
          if (!fs.existsSync(path.join(ROOT_DIR, relPath))) {
            errors.push(`Job '${currentJob}' in ${filename}:${lineNum} references missing local reusable workflow '${relPath}'`);
          }
        }
      }
    }

    // Expression defect check (missing operator after function call)
    const fnDefectMatch = line.match(/(?:^|[^a-zA-Z0-9_.-])(!?(?:cancelled|success|failure|always))\(\s*\)\s+([a-zA-Z0-9_.]+|'[^']*'|"[^"]*")/);
    if (fnDefectMatch) {
      errors.push(`Invalid expression syntax (missing operator between '${fnDefectMatch[1]}()' and '${fnDefectMatch[2]}') in ${filename}:${lineNum}`);
    }
  }

  for (const { jobId, need, lineNum } of jobNeeds) {
    if (!jobIds.has(need)) {
      errors.push(`Job '${jobId}' in ${filename}:${lineNum} references non-existent need '${need}'`);
    }
  }

  return { valid: errors.length === 0, errors, doc: null };
}

export function extractRunBlocks(workflowPath) {
  const content = fs.readFileSync(workflowPath, 'utf8');
  const lines = content.split('\n');
  const out = [];

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
    out.push({ file: path.basename(workflowPath), line: i + 1, shell, code: body.join('\n') + '\n' });
  }
  return out;
}

export function validateRunBlock(block) {
  const errors = [];
  if (/bash/.test(block.shell)) {
    const tmpFile = path.join(ROOT_DIR, '.tmp_val_bash.sh');
    fs.writeFileSync(tmpFile, block.code, 'utf8');
    try {
      execFileSync('bash', ['-n', tmpFile], { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
      const msg = String(e.stderr || e.message).trim();
      errors.push(`Bash syntax error in ${block.file}:${block.line}: ${msg}`);
    } finally {
      if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
    }
  } else if (/pwsh|powershell/.test(block.shell) && hasPwsh) {
    let sanitizedCode = block.code.replace(/'\$\{\{\s*[\s\S]*?\s*\}\}'/g, "'dummy'");
    sanitizedCode = sanitizedCode.replace(/"\$\{\{\s*[\s\S]*?\s*\}\}"/g, '"dummy"');
    sanitizedCode = sanitizedCode.replace(/\$\{\{\s*[\s\S]*?\s*\}\}/g, "'dummy'");

    const tmpFile = path.join(ROOT_DIR, '.tmp_val_pwsh.ps1');
    const parseScript = path.join(ROOT_DIR, '.tmp_val_parse.ps1');
    fs.writeFileSync(tmpFile, sanitizedCode, 'utf8');
    fs.writeFileSync(
      parseScript,
      `
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
`,
      'utf8'
    );

    try {
      const pwshCmd = hasPwsh ? 'pwsh' : 'powershell';
      execFileSync(pwshCmd, ['-NoProfile', '-File', parseScript, tmpFile], { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
      const msg = String(e.stdout || e.stderr || e.message).trim();
      errors.push(`PowerShell syntax error in ${block.file}:${block.line}: ${msg}`);
    } finally {
      if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
      if (fs.existsSync(parseScript)) fs.unlinkSync(parseScript);
    }
  }
  return errors;
}

export function validateAllWorkflows(dir = WORKFLOWS_DIR) {
  const allErrors = [];
  const files = fs.readdirSync(dir).filter(f => /\.ya?ml$/.test(f)).sort();

  for (const file of files) {
    const fullPath = path.join(dir, file);
    const content = fs.readFileSync(fullPath, 'utf8');
    const res = validateYamlContent(content, file);
    if (!res.valid) {
      allErrors.push(...res.errors);
    }

    const blocks = extractRunBlocks(fullPath);
    for (const block of blocks) {
      const blockErrors = validateRunBlock(block);
      if (blockErrors.length > 0) {
        allErrors.push(...blockErrors);
      }
    }
  }

  const scriptsDir = path.join(ROOT_DIR, 'scripts');
  if (fs.existsSync(scriptsDir)) {
    const scriptFiles = fs.readdirSync(scriptsDir).filter(f => /\.m?js$/.test(f));
    for (const sf of scriptFiles) {
      const scriptPath = path.join(scriptsDir, sf);
      try {
        execFileSync('node', ['--check', scriptPath], { stdio: ['ignore', 'pipe', 'pipe'] });
      } catch (e) {
        allErrors.push(`Node syntax error in scripts/${sf}: ${e.message}`);
      }
    }
  }

  return allErrors;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  console.log('Running workflow & script validation...');
  const errors = validateAllWorkflows();
  if (errors.length > 0) {
    console.error('Validation failed with errors:');
    for (const err of errors) {
      console.error(' - ' + err);
    }
    process.exit(1);
  } else {
    console.log('✅ All workflows and scripts validated successfully!');
    process.exit(0);
  }
}
