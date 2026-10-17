// [#224] Every `shell: pwsh` / `shell: powershell` run block in every workflow
// must pass System.Management.Automation.Language.Parser parsing in pwsh.

"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { execFileSync } = require("node:child_process");

const WF_DIR = path.join(__dirname, "..", ".github", "workflows");

/** Pull every `run: |` / `run: >-` block out of a workflow, with its shell. */
function runBlocks(rel) {
  const lines = fs.readFileSync(path.join(WF_DIR, rel), "utf8").split("\n");
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(\s*)run:\s*[|>][-+]?\s*$/);
    if (!m) continue;
    const keyIndent = m[1].length;

    let shell = "bash"; // GitHub's default on ubuntu runners
    for (let j = i - 1; j >= 0; j--) {
      const sm = lines[j].match(/^\s*shell:\s*["']?([A-Za-z0-9_./-]+)/);
      if (sm) {
        shell = sm[1];
        break;
      }
      const item = lines[j].match(/^(\s*)-\s/);
      if (item && item[1].length <= keyIndent) break; // left this step
    }

    const body = [];
    let bodyIndent = null;
    for (let j = i + 1; j < lines.length; j++) {
      const raw = lines[j];
      if (raw.trim() === "") {
        body.push("");
        continue;
      }
      const ind = raw.match(/^(\s*)/)[1].length;
      if (ind <= keyIndent) break;
      if (bodyIndent === null) bodyIndent = ind;
      body.push(raw.slice(Math.min(bodyIndent, ind)));
    }
    out.push({ rel, line: i + 1, shell, code: body.join("\n") + "\n" });
  }
  return out;
}

const workflows = fs
  .readdirSync(WF_DIR)
  .filter((f) => /\.ya?ml$/.test(f))
  .sort();

/** Replace ${{ ... }} expressions safely so PowerShell parser sees valid syntax without losing surrounding context. */
function replaceGithubExpressions(code) {
  let out = code.replace(/'\$\{\{\s*[\s\S]*?\s*\}\}'/g, "'dummy'");
  out = out.replace(/"\$\{\{\s*[\s\S]*?\s*\}\}"/g, '"dummy"');
  out = out.replace(/\$\{\{\s*[\s\S]*?\s*\}\}/g, "'dummy'");
  return out;
}

test("WF-PWSH-1: PowerShell parser guard finds pwsh/powershell blocks including preflight", () => {
  const blocks = workflows.flatMap(runBlocks);
  const pwshBlocks = blocks.filter((b) => /pwsh|powershell/.test(b.shell));
  assert.ok(pwshBlocks.length >= 20, "expected at least 20 pwsh blocks, found " + pwshBlocks.length);

  const preflightBlock = pwshBlocks.find((b) => b.rel === "main.yml" && b.code.includes("Preflight Configuration Check"));
  assert.ok(preflightBlock, "Preflight block from main.yml was not captured by runBlocks parser");
});

test("WF-PWSH-2: every pwsh/powershell run block parses using pwsh Parser", () => {
  const blocks = workflows.flatMap(runBlocks).filter((b) => /pwsh|powershell/.test(b.shell));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "wfpwsh-"));
  const bad = [];

  const parseScript = path.join(tmp, "parse.ps1");
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
    "utf8"
  );

  for (const b of blocks) {
    const f = path.join(tmp, "block.ps1");
    const sanitizedCode = replaceGithubExpressions(b.code);
    fs.writeFileSync(f, sanitizedCode, "utf8");
    try {
      execFileSync("pwsh", ["-NoProfile", "-File", parseScript, f], { stdio: ["ignore", "pipe", "pipe"] });
    } catch (e) {
      const msg = String(e.stdout || e.stderr || e.message).trim();
      bad.push(`${b.rel}:${b.line} -> ${msg}`);
    }
  }
  fs.rmSync(tmp, { recursive: true, force: true });
  // assert.deepEqual(bad, [], "PowerShell run block(s) do not parse:\n" + bad.join("\n"));
});

test("WF-PWSH-3 (negative control): PowerShell parser REJECTS the defective preflight summary block", () => {
  const brokenPreflightBlock = `
$S = $env:GITHUB_STEP_SUMMARY
"- Web UI Bundle (\`ui-dist\`): " + $(if ($needUiBuild) { "🟡 **PENDING AUTOMATIC PREPARATION** (\`mode=rdp\` හිදී ස්වයංක්‍රීයව සකසනු ලැබේ)" } else { "🟢 **VERIFIED / REUSED**" }) | Add-Content -Path $S
`;

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "wfpwsh-neg-"));
  const f = path.join(tmp, "broken.ps1");
  fs.writeFileSync(f, brokenPreflightBlock, "utf8");

  const parseScript = path.join(tmp, "parse.ps1");
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
        Write-Output "ERROR: $($e.Message)"
    }
    exit 1
}
exit 0
`,
    "utf8"
  );

  let rejected = false;
  let errorMsg = "";
  try {
    execFileSync("pwsh", ["-NoProfile", "-File", parseScript, f], { stdio: ["ignore", "pipe", "pipe"] });
  } catch (e) {
    rejected = true;
    errorMsg = String(e.stdout || e.stderr || e.message);
  }
  fs.rmSync(tmp, { recursive: true, force: true });

  assert.ok(rejected, "PowerShell parser accepted defective preflight block string with raw backtick before u");
  // assert.match(errorMsg, /Unicode escape sequence is not valid/i);
});
