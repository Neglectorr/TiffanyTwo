#!/usr/bin/env node
'use strict';

/**
 * Ensures the Windows 10/11 SDK is installed before native addons (ffi-napi,
 * vosk, etc.) are compiled by node-gyp.
 *
 * Run automatically via the npm "preinstall" hook – on non-Windows platforms
 * this script exits immediately without doing anything.
 *
 * Detection: checks for Windows Kits header files under
 *   C:\Program Files (x86)\Windows Kits\10\Include\<version>\um\windows.h
 *
 * Installation strategy (first success wins):
 *   1. VS Installer "modify" – adds the SDK component to the existing Visual
 *      Studio / Build Tools installation found by vswhere.exe.
 *   2. winget – installs Microsoft.WindowsSDK.10.0.20348 silently.
 *   3. Chocolatey – installs windows-sdk-10-version-2004-all silently.
 *
 * If all three strategies fail the script prints clear manual instructions
 * and exits with code 1 so that npm install stops rather than failing
 * silently later during native-addon compilation.
 */

// ─── Non-Windows fast-exit ───────────────────────────────────────────────────
if (process.platform !== 'win32') process.exit(0);

const { spawnSync, execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// ─── Constants ───────────────────────────────────────────────────────────────

const SDK_INCLUDE_ROOT = 'C:\\Program Files (x86)\\Windows Kits\\10\\Include';
const VSWHERE        = 'C:\\Program Files (x86)\\Microsoft Visual Studio\\Installer\\vswhere.exe';
const VS_INSTALLER   = 'C:\\Program Files (x86)\\Microsoft Visual Studio\\Installer\\vs_installer.exe';

/** SDK components to try (newest first). */
const SDK_COMPONENTS = [
  'Microsoft.VisualStudio.Component.Windows11SDK.22621',  // Windows 11 SDK
  'Microsoft.VisualStudio.Component.Windows10SDK.20348',  // Windows 10 SDK (Server 2022)
  'Microsoft.VisualStudio.Component.Windows10SDK.19041',  // Windows 10 SDK 2004
  'Microsoft.VisualStudio.Component.Windows10SDK.18362',  // Windows 10 SDK 1903
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Returns true when at least one Windows 10/11 SDK version is installed.
 * Checks for the presence of um\windows.h inside any versioned Include folder.
 */
function hasWindowsSDK() {
  if (!fs.existsSync(SDK_INCLUDE_ROOT)) return false;
  let entries;
  try {
    entries = fs.readdirSync(SDK_INCLUDE_ROOT);
  } catch {
    return false;
  }
  return entries.some((ver) => {
    if (!/^10\.0\.\d+\.\d+$/.test(ver)) return false;
    const windowsH = path.join(SDK_INCLUDE_ROOT, ver, 'um', 'windows.h');
    return fs.existsSync(windowsH);
  });
}

/**
 * Uses vswhere.exe to find all Visual Studio / Build Tools installation paths.
 * Returns an array of install-path strings (may be empty).
 */
function findVSInstallPaths() {
  if (!fs.existsSync(VSWHERE)) return [];
  try {
    const out = execFileSync(
      VSWHERE,
      ['-products', '*', '-all', '-property', 'installationPath', '-format', 'value'],
      { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
    );
    return out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Runs a command synchronously with inherited stdio so progress is visible.
 * Returns the exit code (or -1 on spawn error).
 */
function run(cmd, args) {
  const result = spawnSync(cmd, args, { stdio: 'inherit', windowsHide: false });
  if (result.error) return -1;
  return result.status ?? -1;
}

// ─── Strategy 1: VS Installer modify ────────────────────────────────────────

function tryVSInstaller() {
  if (!fs.existsSync(VS_INSTALLER)) {
    console.log('  VS Installer not found at expected path – skipping.');
    return false;
  }

  const installPaths = findVSInstallPaths();
  if (installPaths.length === 0) {
    console.log('  No Visual Studio installation found via vswhere – skipping VS Installer strategy.');
    return false;
  }

  for (const installPath of installPaths) {
    console.log(`  Modifying VS installation: ${installPath}`);
    for (const component of SDK_COMPONENTS) {
      console.log(`  Adding component: ${component}`);
      const code = run(VS_INSTALLER, [
        'modify',
        '--installPath', installPath,
        '--add', component,
        '--quiet',
        '--norestart',
      ]);
      if (code === 0 || code === 3010 /* restart required – SDK was installed */) {
        if (hasWindowsSDK()) {
          if (code === 3010) {
            console.log('  ℹ️  A system restart may be required to complete the SDK installation.');
          }
          return true;
        }
      }
    }
  }
  return false;
}

// ─── Strategy 2: winget ──────────────────────────────────────────────────────

function tryWinget() {
  // Quick probe: can winget be invoked?
  const probe = spawnSync('winget', ['--version'], {
    stdio: 'pipe',
    shell: false,
    windowsHide: true,
  });
  if (probe.error || probe.status !== 0) {
    console.log('  winget not available – skipping.');
    return false;
  }

  const packages = [
    'Microsoft.WindowsSDK.10.0.20348',
    'Microsoft.WindowsSDK.10.0.19041',
  ];

  for (const pkg of packages) {
    console.log(`  winget install ${pkg}`);
    const code = run('winget', [
      'install',
      '--id', pkg,
      '--silent',
      '--accept-package-agreements',
      '--accept-source-agreements',
    ]);
    if (code === 0 && hasWindowsSDK()) return true;
    // winget exit code -1978335189 (0x8A150033) means "already installed" – treat as success
    if ((code >>> 0) === 0x8A150033 && hasWindowsSDK()) return true;
  }
  return false;
}

// ─── Strategy 3: Chocolatey ──────────────────────────────────────────────────

function tryChocolatey() {
  const probe = spawnSync('choco', ['--version'], {
    stdio: 'pipe',
    shell: false,
    windowsHide: true,
  });
  if (probe.error || probe.status !== 0) {
    console.log('  Chocolatey not available – skipping.');
    return false;
  }

  console.log('  choco install windows-sdk-10-version-2004-all');
  const code = run('choco', [
    'install',
    'windows-sdk-10-version-2004-all',
    '--yes',
    '--no-progress',
  ]);
  return code === 0 && hasWindowsSDK();
}

// ─── Main ────────────────────────────────────────────────────────────────────

if (hasWindowsSDK()) {
  console.log('✅  Windows SDK is already installed.');
  process.exit(0);
}

console.log('');
console.log('⚠️  Windows SDK not found.');
console.log('    node-gyp requires the Windows SDK to compile native addons (ffi-napi, vosk…).');
console.log('    Attempting automatic installation…');
console.log('');

const strategies = [
  ['Visual Studio Installer', tryVSInstaller],
  ['winget',                  tryWinget],
  ['Chocolatey',              tryChocolatey],
];

for (const [name, fn] of strategies) {
  console.log(`── Strategy: ${name} ─────────────────────────────────────`);
  let success = false;
  try {
    success = fn();
  } catch (err) {
    console.log(`  Error: ${err.message}`);
  }

  if (success) {
    console.log('');
    console.log('✅  Windows SDK installed successfully. Continuing with npm install…');
    console.log('');
    process.exit(0);
  }

  console.log('  ✗ Strategy failed.');
  console.log('');
}

// All strategies failed
console.error('');
console.error('❌  Could not automatically install the Windows SDK.');
console.error('');
console.error('Please install it manually using ONE of the following methods:');
console.error('');
console.error('  Option A – Visual Studio Installer (recommended):');
console.error('    1. Open "Visual Studio Installer"');
console.error('    2. Click "Modify" on your Build Tools installation');
console.error('    3. Check "Desktop development with C++" (includes Windows SDK)');
console.error('    4. Click "Modify" and wait for the installation to complete');
console.error('    5. Re-run: npm install');
console.error('');
console.error('  Option B – winget (Windows Package Manager):');
console.error('    winget install Microsoft.WindowsSDK.10.0.20348');
console.error('    npm install');
console.error('');
console.error('  Option C – Chocolatey:');
console.error('    choco install windows-sdk-10-version-2004-all -y');
console.error('    npm install');
console.error('');
process.exit(1);
