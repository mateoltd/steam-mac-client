import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { runProcess, spawnInteractive } from './process-runner';
import { locateTools } from './tool-locator';
import { stripQuarantine } from './quarantine';
import { getPrefixDir, getAppDataDir } from '../lib/paths';
import { isAppleSilicon } from '../lib/platform';
import { getLogger } from '../lib/logger';
import type { WineConfig, WineBackend } from '../../shared/types';

const STEAM_SETUP_URL = 'https://cdn.akamai.steamstatic.com/client/installer/SteamSetup.exe';

export interface LaunchResult {
  success: boolean;
  message: string;
}

/**
 * Find .exe files inside a game directory.
 */
export function findExecutables(gameDir: string): string[] {
  const exes: string[] = [];
  walkDir(gameDir, (filePath) => {
    if (filePath.toLowerCase().endsWith('.exe')) {
      exes.push(filePath);
    }
  });
  return exes.sort();
}

/**
 * Check if Steam is installed in a Wine prefix.
 */
export function isSteamInstalledInPrefix(prefixDir: string): boolean {
  const steamExe = getSteamExePath(prefixDir);
  return steamExe !== null;
}

/**
 * Install the Windows Steam client into a Wine prefix.
 */
export async function installSteamInPrefix(
  appId: number,
  backend: WineBackend,
  onLog?: (line: string) => void,
): Promise<{ success: boolean; message: string }> {
  const log = getLogger();
  const logLine = onLog || (() => {});

  const tools = await locateTools();
  const wineBinary = resolveWineBinary(backend, tools.gptkPath, tools.winePath);
  if (!wineBinary) {
    return { success: false, message: 'No Wine/GPTK found.' };
  }

  const prefixDir = getPrefixDir(appId);
  fs.mkdirSync(prefixDir, { recursive: true });

  const env = buildEnvironment(wineBinary, prefixDir, backend, {
    dllOverrides: {},
    environmentVariables: {},
    windowsVersion: 'win10',
  });

  // Initialize prefix if needed
  if (!fs.existsSync(path.join(prefixDir, 'system.reg'))) {
    logLine('Initializing Wine prefix...');
    await runProcess(wineBinary, ['wineboot', '--init'], { env });
  }

  // Download SteamSetup.exe (always re-download to avoid corrupt cached copies)
  const setupPath = path.join(os.tmpdir(), 'SteamSetup.exe');
  logLine('Downloading Steam installer...');
  try {
    const res = await fetch(STEAM_SETUP_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(setupPath, buf);
    logLine('Downloaded SteamSetup.exe');
  } catch (err) {
    return { success: false, message: `Failed to download Steam installer: ${err}` };
  }

  // Suppress Wine debug output to prevent Terminal.app from appearing on macOS
  const installEnv = {
    ...env,
    WINEDEBUG: '-all',
    STEAM_DISABLE_BROWSER_SANDBOX: '1',
  };

  // Run the installer (silent install)
  logLine('Installing Steam in Wine prefix...');
  const result = await runProcess(wineBinary, [setupPath, '/S'], {
    env: installEnv,
    onStdoutLine: (line) => { logLine(line); log.debug({ stream: 'stdout' }, line); },
    onStderrLine: (line) => log.debug({ stream: 'stderr' }, line),
  });

  if (result.exitCode !== 0 && result.exitCode !== 1) {
    log.warn({ exitCode: result.exitCode }, 'Steam installer exited with non-zero');
  }

  // Verify installation
  const steamExe = getSteamExePath(prefixDir);
  if (!steamExe) {
    return { success: false, message: 'Steam installation could not be verified.' };
  }

  // Write steam_dev.cfg to persistently disable CEF sandbox.
  // This survives Steam self-restarts (env vars don't).
  writeSteamDevConfig(path.dirname(steamExe));

  logLine('Steam installed. It will self-update on first launch.');
  return { success: true, message: 'Steam installed successfully.' };
}

/**
 * Nuke Steam from the prefix and reinstall from scratch.
 * This is the self-healing path for corrupt installations.
 */
export async function repairSteamInPrefix(
  appId: number,
  backend: WineBackend,
  onLog?: (line: string) => void,
): Promise<{ success: boolean; message: string }> {
  const log = getLogger();
  const logLine = onLog || (() => {});
  const prefixDir = getPrefixDir(appId);

  logLine('Repairing Steam installation...');
  log.info({ appId, prefixDir }, 'Repairing Steam in prefix — nuking and reinstalling');

  // Delete the entire Steam directory inside the prefix
  const steamDirs = [
    path.join(prefixDir, 'drive_c', 'Program Files (x86)', 'Steam'),
    path.join(prefixDir, 'drive_c', 'Program Files', 'Steam'),
  ];
  for (const dir of steamDirs) {
    if (fs.existsSync(dir)) {
      logLine(`Removing ${dir}...`);
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  // Also delete cached SteamSetup.exe in case it's corrupt
  const setupPath = path.join(os.tmpdir(), 'SteamSetup.exe');
  if (fs.existsSync(setupPath)) {
    fs.unlinkSync(setupPath);
  }

  // Reinstall
  return installSteamInPrefix(appId, backend, onLog);
}

/**
 * Launch Steam in the Wine prefix.
 *
 * Before spawning, runs a health check on the prefix. If Steam's directory
 * is missing critical files it auto-repairs (nuke + reinstall).
 *
 * After spawning, monitors the process for 8 seconds. If it dies immediately
 * it auto-repairs and retries once.
 */
export async function launchSteamInPrefix(
  appId: number,
  backend: WineBackend,
  onLog?: (line: string) => void,
): Promise<LaunchResult> {
  const log = getLogger();
  const logLine = onLog || (() => {});

  const prefixDir = getPrefixDir(appId);

  // --- Health check: auto-repair if Steam is missing or corrupt ---
  let steamExe = getSteamExePath(prefixDir);
  if (steamExe && !verifySteamHealth(prefixDir)) {
    logLine('Steam installation looks corrupt. Auto-repairing...');
    log.warn({ prefixDir }, 'Steam health check failed — auto-repairing');
    const repairResult = await repairSteamInPrefix(appId, backend, onLog);
    if (!repairResult.success) return repairResult;
    steamExe = getSteamExePath(prefixDir);
  }

  if (!steamExe) {
    return { success: false, message: 'Steam not installed in prefix. Install it first.' };
  }

  // Ensure steam_dev.cfg is always in place (self-healing)
  writeSteamDevConfig(path.dirname(steamExe));

  const tools = await locateTools();
  const wineBinary = resolveWineBinary(backend, tools.gptkPath, tools.winePath);
  if (!wineBinary) {
    return { success: false, message: 'No Wine/GPTK found.' };
  }

  const env = buildEnvironment(wineBinary, prefixDir, backend, {
    dllOverrides: {},
    environmentVariables: {},
    windowsVersion: 'win10',
  });

  log.info({ steamExe, prefixDir }, 'Launching Steam in Wine prefix');

  const mergedEnv = {
    ...process.env,
    ...env,
    STEAM_DISABLE_BROWSER_SANDBOX: '1',
    WINEDEBUG: '-all',
  };

  // Spawn Steam with CEF workaround flags.
  // -cef-disable-sandbox: Chromium sandbox fails under Wine
  // -cef-disable-gpu: GPU accel in CEF crashes under Wine/GPTK
  // -noreactlogin: use older, more Wine-compatible login UI
  // These are also written to steam_dev.cfg for when Steam self-restarts.
  const result = await spawnSteamMonitored(wineBinary, steamExe, mergedEnv, log);

  if (!result.alive) {
    // Steam died within seconds — try auto-repair once
    logLine('Steam exited immediately. Repairing and retrying...');
    log.warn('Steam process died within monitor window — auto-repairing');
    const repairResult = await repairSteamInPrefix(appId, backend, onLog);
    if (!repairResult.success) return repairResult;

    steamExe = getSteamExePath(prefixDir)!;
    writeSteamDevConfig(path.dirname(steamExe));

    const retry = await spawnSteamMonitored(wineBinary, steamExe, mergedEnv, log);
    if (!retry.alive) {
      return { success: false, message: `Steam keeps crashing (exit code ${retry.exitCode}). The Wine prefix may be incompatible.` };
    }
  }

  return { success: true, message: 'Steam is starting. Log in, then launch the game.' };
}

// --- Steam health & config helpers ---

/**
 * Verify that a Steam installation in a prefix has the critical files needed to run.
 * Returns false if Steam looks corrupt or incomplete.
 */
function verifySteamHealth(prefixDir: string): boolean {
  const steamExe = getSteamExePath(prefixDir);
  if (!steamExe) return false;

  const steamDir = path.dirname(steamExe);

  // Check that steam.exe isn't a 0-byte stub
  try {
    const stat = fs.statSync(steamExe);
    if (stat.size < 100_000) return false; // steam.exe should be > 100KB
  } catch {
    return false;
  }

  // Check for critical Steam runtime files
  const criticalFiles = [
    'tier0_s64.dll',
    'vstdlib_s64.dll',
  ];
  for (const file of criticalFiles) {
    if (!fs.existsSync(path.join(steamDir, file))) {
      return false;
    }
  }

  return true;
}

/**
 * Write steam_dev.cfg next to steam.exe.
 * This persists CEF sandbox/GPU settings across Steam self-restarts
 * (environment variables are lost when Steam re-launches itself during updates).
 */
function writeSteamDevConfig(steamDir: string): void {
  const cfgPath = path.join(steamDir, 'steam_dev.cfg');
  const content = [
    '@nRendererCefSandbox 0',
    '@nRendererCefDisableGpu 1',
    '@fSteamAutoUpdateTimerFrequencySeconds 0',
  ].join('\n') + '\n';
  fs.writeFileSync(cfgPath, content, 'utf-8');
}

/**
 * Spawn Steam and monitor it for a short window to detect immediate crashes.
 * Returns { alive: true } if Steam is still running after the monitor period,
 * or { alive: false, exitCode } if it died.
 */
function spawnSteamMonitored(
  wineBinary: string,
  steamExe: string,
  env: Record<string, string>,
  log: ReturnType<typeof getLogger>,
): Promise<{ alive: boolean; exitCode?: number }> {
  return new Promise((resolve) => {
    const proc = spawn(wineBinary, [
      steamExe,
      '-cef-disable-sandbox',
      '-cef-disable-gpu',
      '-noreactlogin',
    ], {
      env,
      stdio: 'ignore',
      detached: true,
    });

    let exited = false;
    let exitCode: number | undefined;

    proc.on('exit', (code) => {
      exited = true;
      exitCode = code ?? undefined;
      log.warn({ exitCode: code }, 'Steam process exited during monitor window');
    });

    proc.on('error', (err) => {
      exited = true;
      log.error({ err }, 'Steam process error');
    });

    // Monitor for 8 seconds, then detach if still alive
    setTimeout(() => {
      if (exited) {
        resolve({ alive: false, exitCode });
      } else {
        proc.unref();
        resolve({ alive: true });
      }
    }, 8000);
  });
}

/**
 * Launch a Windows game through Wine or GPTK.
 * Expects Steam to already be running in the prefix for online games.
 */
export async function launchGame(
  exePath: string,
  appId: number,
  wineConfig: WineConfig,
  backend: WineBackend,
): Promise<LaunchResult> {
  const log = getLogger();

  if (!fs.existsSync(exePath)) {
    return { success: false, message: `Executable not found: ${exePath}` };
  }

  const tools = await locateTools();
  const wineBinary = resolveWineBinary(backend, tools.gptkPath, tools.winePath);
  if (!wineBinary) {
    return { success: false, message: 'No Wine or GPTK installation found. Install from Settings.' };
  }

  const prefixDir = getPrefixDir(appId);
  fs.mkdirSync(prefixDir, { recursive: true });

  const env = buildEnvironment(wineBinary, prefixDir, backend, wineConfig);

  log.info({ exePath, wineBinary, backend, prefixDir }, 'Launching game');

  // Strip macOS quarantine from game directory
  const gameDir = path.dirname(exePath);
  await stripQuarantine(gameDir);

  // Restore original steam_api DLLs if Goldberg was previously applied
  restoreOriginalSteamDlls(gameDir);

  // Write steam_appid.txt so the game knows its app ID
  const appIdFile = path.join(gameDir, 'steam_appid.txt');
  fs.writeFileSync(appIdFile, String(appId), 'utf-8');

  // Initialize prefix if it doesn't exist
  if (!fs.existsSync(path.join(prefixDir, 'system.reg'))) {
    log.info({ prefixDir }, 'Initializing Wine prefix');
    await runProcess(wineBinary, ['wineboot', '--init'], { env });
  }

  // Set Windows version via registry if needed
  if (wineConfig.windowsVersion !== 'win10') {
    await setWindowsVersion(wineBinary, prefixDir, wineConfig.windowsVersion, env);
  }

  // Launch the game
  try {
    log.info({ env: { WINEPREFIX: env.WINEPREFIX, DYLD_FALLBACK_LIBRARY_PATH: env.DYLD_FALLBACK_LIBRARY_PATH, WINEESYNC: env.WINEESYNC } }, 'Wine environment');
    const result = await runProcess(wineBinary, [exePath], {
      env,
      onStdoutLine: (line) => log.debug({ stream: 'stdout' }, line),
      onStderrLine: (line) => log.debug({ stream: 'stderr' }, line),
    });
    log.info({ exitCode: result.exitCode, stdoutLen: result.stdout.length, stderrLen: result.stderr.length }, 'Game process exited');
    if (result.stderr) {
      log.warn({ stderr: result.stderr.slice(0, 2000) }, 'Game stderr output');
    }
    if (result.exitCode !== 0) {
      return { success: false, message: `Game exited with code ${result.exitCode}\n${result.stderr.slice(0, 500)}` };
    }
    return { success: true, message: 'Game launched successfully.' };
  } catch (err) {
    log.error({ err }, 'Failed to launch game');
    return { success: false, message: `Launch failed: ${err}` };
  }
}

// --- Internals ---

function getSteamExePath(prefixDir: string): string | null {
  const candidates = [
    path.join(prefixDir, 'drive_c', 'Program Files (x86)', 'Steam', 'steam.exe'),
    path.join(prefixDir, 'drive_c', 'Program Files', 'Steam', 'steam.exe'),
  ];
  return candidates.find(p => fs.existsSync(p)) || null;
}

/**
 * Restore original steam_api DLLs if Goldberg backups exist.
 */
function restoreOriginalSteamDlls(gameDir: string): void {
  const log = getLogger();
  walkDir(gameDir, (filePath) => {
    if (filePath.endsWith('.dll.original')) {
      const originalPath = filePath.replace('.original', '');
      fs.copyFileSync(filePath, originalPath);
      fs.unlinkSync(filePath);
      log.info({ restored: originalPath }, 'Restored original Steam API DLL');
    }
  });
  // Also clean up steam_settings directories created by Goldberg
  walkDir(gameDir, (filePath) => {
    const dir = path.dirname(filePath);
    if (path.basename(dir) === 'steam_settings') {
      try { fs.rmSync(dir, { recursive: true }); } catch {}
    }
  });
}

function resolveWineBinary(
  backend: WineBackend,
  gptkPath: string | null,
  winePath: string | null,
): string | null {
  if (backend === 'gptk' && gptkPath) return gptkPath;
  if (backend === 'crossover' && winePath) return winePath;
  if (isAppleSilicon() && gptkPath) return gptkPath;
  return winePath || gptkPath;
}

function buildEnvironment(
  wineBinary: string,
  prefixDir: string,
  backend: WineBackend,
  config: WineConfig,
): Record<string, string> {
  const env: Record<string, string> = {
    WINEPREFIX: prefixDir,
    WINEARCH: 'win64',
  };

  const overrides = Object.entries(config.dllOverrides)
    .filter(([, order]) => order !== '')
    .map(([dll, order]) => `${dll}=${order}`)
    .join(';');
  if (overrides) {
    env.WINEDLLOVERRIDES = overrides;
  }

  const wineDir = resolveWineDir(wineBinary);
  if (backend === 'gptk' || isGPTKBinary(wineBinary)) {
    const libPaths = buildDyldPaths(wineDir);
    if (libPaths.length > 0) {
      env.DYLD_FALLBACK_LIBRARY_PATH = libPaths.join(':');
    }
    env.MTL_HUD_ENABLED = '0';
    env.WINEESYNC = '1';
  }

  Object.assign(env, config.environmentVariables);
  return env;
}

function resolveWineDir(wineBinary: string): string {
  const binDir = path.dirname(wineBinary);
  if (path.basename(binDir) === 'bin') {
    return path.dirname(binDir);
  }
  return binDir;
}

function isGPTKBinary(wineBinary: string): boolean {
  const lower = wineBinary.toLowerCase();
  return lower.includes('game porting toolkit') || lower.includes('game-porting-toolkit');
}

function buildDyldPaths(wineDir: string): string[] {
  const candidates = [
    path.join(wineDir, 'lib'),
    path.join(wineDir, 'lib', 'external'),
    path.join(wineDir, 'lib64'),
    '/usr/lib',
  ];
  return candidates.filter(p => {
    try { return fs.statSync(p).isDirectory(); } catch { return false; }
  });
}

async function setWindowsVersion(
  wineBinary: string,
  prefixDir: string,
  version: string,
  env: Record<string, string>,
): Promise<void> {
  const versionMap: Record<string, string> = { win10: 'win10', win81: 'win81', win8: 'win8', win7: 'win7' };
  const winVer = versionMap[version] || 'win10';
  await runProcess(wineBinary, [
    'reg', 'add', 'HKEY_CURRENT_USER\\Software\\Wine', '/v', 'Version', '/d', winVer, '/f',
  ], { env });
}

function walkDir(dir: string, callback: (filePath: string) => void, depth = 0): void {
  if (depth > 5) return;
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walkDir(full, callback, depth + 1);
      } else if (entry.isFile()) {
        callback(full);
      }
    }
  } catch {}
}
