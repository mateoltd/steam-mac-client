import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { runProcess, spawnInteractive } from './process-runner';
import { locateTools } from './tool-locator';
import { stripQuarantine } from './quarantine';
import { getPrefixDir, getGamePrefixDir, getAppDataDir, getDxvkDir } from '../lib/paths';
import { isAppleSilicon } from '../lib/platform';
import { getLogger } from '../lib/logger';
import { applyGoldberg } from './steam-emu';
import { loadCredentials } from './credential-store';
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
 * Uses Wine Staging (11.x) instead of GPTK because Steam's steamwebhelper
 * requires Wine 11.0+ for WSALookupServiceBegin to work.
 */
export async function installSteamInPrefix(
  appId: number,
  backend: WineBackend,
  onLog?: (line: string) => void,
): Promise<{ success: boolean; message: string }> {
  const log = getLogger();
  const logLine = onLog || (() => {});

  const tools = await locateTools();
  // Use Wine Staging for prefix creation — Steam login requires steamwebhelper
  // which only works on Wine 11.0+ (WSALookupServiceBegin).
  const wineBinary = tools.wineStagingPath || resolveSteamWineBinary(tools);
  if (!wineBinary) {
    return { success: false, message: 'Wine Staging not found. Install from Settings (required for Steam).' };
  }
  logLine(`Using Wine: ${wineBinary}`);

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
    await enableClipboardSharing(wineBinary, env);
    await disableCrashDialog(wineBinary, env);
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

  const tools = await locateTools();
  // Use Wine Staging for Steam login — it's the only Wine version where
  // steamwebhelper (CEF) works (requires WSALookupServiceBegin, Wine 11.0+).
  // After login, the game launch flow switches to wine-crossover.
  const wineBinary = tools.wineStagingPath || resolveSteamWineBinary(tools);
  if (!wineBinary) {
    return { success: false, message: 'Wine Staging not found. Install from Settings (required for Steam login).' };
  }

  logLine(`Using Wine: ${wineBinary}`);

  const env = buildEnvironment(wineBinary, prefixDir, backend, {
    dllOverrides: {},
    environmentVariables: {},
    windowsVersion: 'win10',
  });

  log.info({ steamExe, prefixDir, wineBinary }, 'Launching Steam in Wine prefix');

  const mergedEnv = {
    ...process.env,
    ...env,
    WINEDEBUG: '-all',
  };

  // No special args for login — let Steam show its full UI so the user can
  // authenticate (including Steam Guard 2FA). The game launch flow will later
  // restart Steam headlessly under wine-crossover.
  const steamArgs: string[] = [];

  // Start tailing Steam's bootstrap log for update progress
  const steamDir = path.dirname(steamExe);
  const bootstrapLogPath = path.join(steamDir, 'logs', 'bootstrap_log.txt');
  const logWatcher = tailSteamLog(bootstrapLogPath, logLine);

  // Launch Steam with auto-restart support.
  // Exit code 42 = Steam self-update restart signal (NOT a crash).
  const MAX_RESTARTS = 5;
  let restarts = 0;
  let currentSteamExe = steamExe;

  while (restarts <= MAX_RESTARTS) {
    const result = await spawnSteamMonitored(wineBinary, currentSteamExe, steamArgs, mergedEnv, log, logLine);

    if (result.alive) {
      // Steam is running — success
      return { success: true, message: 'Steam is running. You can now launch the game.' };
    }

    // Exit code 42 = Steam updated itself and wants a restart
    if (result.exitCode === 42) {
      restarts++;
      logLine(`Steam is updating (restart ${restarts}/${MAX_RESTARTS})...`);
      log.info({ restarts, exitCode: 42 }, 'Steam self-update restart');
      currentSteamExe = getSteamExePath(prefixDir) || currentSteamExe;
      continue;
    }

    // Actual crash — try repair once
    logWatcher.stop();
    logLine(`Steam exited unexpectedly (code ${result.exitCode}). Repairing...`);
    log.warn({ exitCode: result.exitCode }, 'Steam process died — auto-repairing');
    const repairResult = await repairSteamInPrefix(appId, backend, onLog);
    if (!repairResult.success) return repairResult;

    currentSteamExe = getSteamExePath(prefixDir)!;
    const retryResult = await spawnSteamMonitored(wineBinary, currentSteamExe, steamArgs, mergedEnv, log, logLine);
    if (retryResult.alive) {
      return { success: true, message: 'Steam is running. You can now launch the game.' };
    }
    if (retryResult.exitCode === 42) {
      restarts++;
      logLine('Steam is updating after repair...');
      continue;
    }
    return { success: false, message: `Steam keeps crashing (exit code ${retryResult.exitCode}). The Wine prefix may be incompatible.` };
  }

  return { success: false, message: 'Steam is stuck in an update loop. Try restarting the app.' };
}

/**
 * Gracefully shut down Steam running in a Wine prefix.
 * Sends `steam.exe -shutdown` which lets Steam run its normal exit sequence
 * (saving state, closing connections) instead of killing the process.
 */
export async function shutdownSteamInPrefix(
  appId: number,
  backend: WineBackend,
): Promise<LaunchResult> {
  const log = getLogger();
  const prefixDir = getPrefixDir(appId);
  const steamExe = getSteamExePath(prefixDir);
  if (!steamExe) {
    return { success: false, message: 'Steam not found in prefix.' };
  }

  const tools = await locateTools();
  const wineBinary = resolveSteamWineBinary(tools);
  if (!wineBinary) {
    return { success: false, message: 'Wine not found.' };
  }

  const env = buildEnvironment(wineBinary, prefixDir, backend, {
    dllOverrides: {},
    environmentVariables: {},
    windowsVersion: 'win10',
  });

  log.info({ prefixDir }, 'Sending Steam graceful shutdown');

  const mergedEnv = { ...process.env, ...env, WINEDEBUG: '-all' };

  try {
    // steam.exe -shutdown tells the running Steam instance to exit gracefully
    await runProcess(wineBinary, [steamExe, '-shutdown'], {
      env: mergedEnv,
    });
    return { success: true, message: 'Steam is shutting down.' };
  } catch (err) {
    log.error({ err }, 'Steam shutdown failed');
    return { success: false, message: `Shutdown failed: ${err}` };
  }
}

// --- Steam-specific Wine resolution ---

/**
 * Resolve the Wine binary for Steam client operations and online game launches.
 *
 * Priority:
 *   1. Wine Crossover (CodeWeavers patches: macOS VA fixes + Steam support)
 *   2. Wine Staging 11.x (Steam works but games may crash from mmap errors)
 *   3. Fallback to any available Wine
 */
function resolveSteamWineBinary(tools: import('../../shared/types').ToolStatus): string | null {
  if (tools.wineCrossoverPath) return tools.wineCrossoverPath;
  if (tools.wineStagingPath) return tools.wineStagingPath;
  return tools.winePath || tools.gptkPath;
}

// --- Steam health & config helpers ---

function verifySteamHealth(prefixDir: string): boolean {
  const steamExe = getSteamExePath(prefixDir);
  if (!steamExe) return false;

  const steamDir = path.dirname(steamExe);

  try {
    const stat = fs.statSync(steamExe);
    if (stat.size < 100_000) return false;
  } catch {
    return false;
  }

  const criticalFiles = ['tier0_s64.dll', 'vstdlib_s64.dll'];
  for (const file of criticalFiles) {
    if (!fs.existsSync(path.join(steamDir, file))) return false;
  }

  return true;
}

/**
 * Spawn Steam and monitor it for a short window to detect immediate crashes.
 * After the initial window, keeps a background watcher that auto-restarts
 * Steam on exit code 42 (self-update restart signal).
 */
function spawnSteamMonitored(
  wineBinary: string,
  steamExe: string,
  steamArgs: string[],
  env: Record<string, string>,
  log: ReturnType<typeof getLogger>,
  onLog?: (line: string) => void,
): Promise<{ alive: boolean; exitCode?: number }> {
  return new Promise((resolve) => {
    let resolved = false;

    const launchSteam = () => {
      const proc = spawn(wineBinary, [steamExe, ...steamArgs], {
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: true,
      });

      let exited = false;
      let exitCode: number | undefined;

      // Stream Wine output to the log callback
      if (proc.stderr) {
        const { createInterface } = require('node:readline');
        const rl = createInterface({ input: proc.stderr });
        rl.on('line', (line: string) => {
          log.debug({ stream: 'steam-stderr' }, line);
          if (onLog && !line.includes('fixme:') && !line.includes('trace:')) {
            onLog(line);
          }
        });
      }
      if (proc.stdout) {
        const { createInterface } = require('node:readline');
        const rl = createInterface({ input: proc.stdout });
        rl.on('line', (line: string) => {
          log.debug({ stream: 'steam-stdout' }, line);
          onLog?.(line);
        });
      }

      proc.on('exit', (code) => {
        exited = true;
        exitCode = code ?? undefined;
        log.info({ exitCode: code }, 'Steam process exited');

        if (!resolved) {
          // Still in the initial monitor window — report to caller
          return;
        }

        // Background: handle exit code 42 (self-update restart)
        if (code === 42) {
          log.info('Steam requested restart after update (exit code 42)');
          onLog?.('Steam is restarting after update...');
          // Small delay to let file writes settle
          setTimeout(() => launchSteam(), 2000);
        } else if (code !== 0) {
          log.warn({ exitCode: code }, 'Steam exited unexpectedly in background');
          onLog?.(`Steam exited (code ${code}).`);
        }
      });

      proc.on('error', (err) => {
        exited = true;
        log.error({ err }, 'Steam process error');
      });

      // Monitor for 10 seconds, then report to caller
      setTimeout(() => {
        if (resolved) return; // already resolved by a previous launch
        resolved = true;

        if (exited) {
          resolve({ alive: false, exitCode });
        } else {
          // Steam survived the monitor window — keep pipes open for
          // background log streaming and exit code 42 handling
          proc.unref();
          resolve({ alive: true });
        }
      }, 10_000);
    };

    launchSteam();
  });
}

/**
 * Tail Steam's bootstrap_log.txt to stream update progress to the renderer.
 * Returns a handle to stop tailing.
 */
function tailSteamLog(
  logPath: string,
  onLog: (line: string) => void,
): { stop: () => void } {
  let watching = true;
  let lastSize = 0;
  let interval: ReturnType<typeof setInterval> | null = null;

  // Auto-stop after 5 minutes
  const timeout = setTimeout(() => { watching = false; }, 5 * 60 * 1000);

  const read = () => {
    if (!watching) {
      if (interval) clearInterval(interval);
      return;
    }
    try {
      if (!fs.existsSync(logPath)) return;
      const stat = fs.statSync(logPath);
      if (stat.size <= lastSize) return;

      const fd = fs.openSync(logPath, 'r');
      const buf = Buffer.alloc(stat.size - lastSize);
      fs.readSync(fd, buf, 0, buf.length, lastSize);
      fs.closeSync(fd);
      lastSize = stat.size;

      const lines = buf.toString('utf-8').split('\n').filter(l => l.trim());
      for (const line of lines) {
        onLog(`[Steam] ${line}`);
      }
    } catch {
      // File might be locked by Steam — ignore
    }
  };

  interval = setInterval(read, 2000);

  return {
    stop: () => {
      watching = false;
      clearTimeout(timeout);
      if (interval) clearInterval(interval);
    },
  };
}

/**
 * Check if Steam is currently running in a Wine prefix.
 * Works by checking if there's an active wineserver for the prefix.
 */
export async function isSteamRunningInPrefix(appId: number, backend: WineBackend): Promise<boolean> {
  const prefixDir = getPrefixDir(appId);
  const tools = await locateTools();
  const wineBinary = resolveSteamWineBinary(tools);
  if (!wineBinary) return false;

  const wineDir = path.dirname(wineBinary);
  const wineserver = path.join(wineDir, 'wineserver');

  try {
    // wineserver -k 0 pings the server without killing it; exits 0 if running
    const result = await runProcess(wineserver, ['-k', '0'], {
      env: { ...process.env, WINEPREFIX: prefixDir, WINEDEBUG: '-all' },
    });
    return result.exitCode === 0;
  } catch {
    return false;
  }
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
  onlineMode: boolean,
): Promise<LaunchResult> {
  const log = getLogger();

  if (!fs.existsSync(exePath)) {
    return { success: false, message: `Executable not found: ${exePath}` };
  }

  const tools = await locateTools();

  // Wine binary + prefix selection depends on mode and architecture:
  //
  // ONLINE MODE (Intel x64):
  //   Wine Staging 11.5 runs natively — no Rosetta 2, no mmap crashes.
  //   Same Wine version for Steam and game, single prefix.
  //
  // ONLINE MODE (Apple Silicon):
  //   Not yet supported — no Wine version can run both Steam (needs 9.0+
  //   for steamwebhelper) and games (mmap crash under Rosetta 2) in one prefix.
  //
  // OFFLINE MODE: GPTK with separate prefix + Goldberg emulator.
  let wineBinary: string | null;
  let prefixDir: string;

  if (onlineMode) {
    if (isAppleSilicon()) {
      return {
        success: false,
        message: 'Online mode is not yet supported on Apple Silicon Macs. An Intel Mac is required for online play. You can use offline mode with this game instead.',
      };
    }

    // Intel: Wine Staging handles everything — same prefix as Steam
    wineBinary = tools.wineStagingPath || resolveSteamWineBinary(tools);
    prefixDir = getPrefixDir(appId);
  } else {
    // Prefer GPTK (D3DMetal, stable), then crossover, then staging
    wineBinary = resolveWineBinary(backend, tools.gptkPath, tools.winePath)
      || resolveSteamWineBinary(tools);
    // Use separate game prefix if Wine version differs from Steam's
    const steamWine = resolveSteamWineBinary(tools);
    prefixDir = (steamWine && steamWine !== wineBinary)
      ? getGamePrefixDir(appId)
      : getPrefixDir(appId);
  }

  if (!wineBinary) {
    return { success: false, message: 'No Wine installation found. Install from Settings.' };
  }
  fs.mkdirSync(prefixDir, { recursive: true });

  const env = buildEnvironment(wineBinary, prefixDir, backend, wineConfig);

  // On Apple Silicon (Rosetta 2), disable esync/fsync to reduce virtual address
  // space pressure that causes mmap "Cannot allocate memory" errors.
  // On Intel, these can stay enabled — no Rosetta 2 VA conflicts.
  if (isAppleSilicon()) {
    env.WINEESYNC = '0';
    env.WINEFSYNC = '0';
  }

  log.info({ exePath, wineBinary, backend, prefixDir }, 'Launching game');

  // Strip macOS quarantine from game directory
  const gameDir = path.dirname(exePath);
  await stripQuarantine(gameDir);

  if (onlineMode) {
    // Online: restore original DLLs so the game uses real Steam
    restoreOriginalSteamDlls(gameDir);
  } else {
    // Offline: apply Goldberg emulator — fakes Steamworks API, no Steam needed
    restoreOriginalSteamDlls(gameDir); // undo any previous Goldberg first
    const emu = applyGoldberg(gameDir, appId);
    log.info({ applied: emu.applied, message: emu.message }, 'Goldberg emulator');
  }

  // Write steam_appid.txt so the game knows its app ID
  const appIdFile = path.join(gameDir, 'steam_appid.txt');
  fs.writeFileSync(appIdFile, String(appId), 'utf-8');

  // Initialize prefix if it doesn't exist
  if (!fs.existsSync(path.join(prefixDir, 'system.reg'))) {
    log.info({ prefixDir }, 'Initializing Wine prefix');
    await runProcess(wineBinary, ['wineboot', '--init'], { env });
    await enableClipboardSharing(wineBinary, env);
    await disableCrashDialog(wineBinary, env);
  }

  // Set Windows version via registry if needed
  if (wineConfig.windowsVersion !== 'win10') {
    await setWindowsVersion(wineBinary, prefixDir, wineConfig.windowsVersion, env);
  }

  // Install DXVK DLLs in the prefix (D3D10/D3D11 → Vulkan → MoltenVK → Metal).
  // Skip DXVK when using GPTK — it has Apple's D3DMetal which translates D3D→Metal
  // directly and is faster/more compatible than the DXVK→Vulkan→MoltenVK→Metal chain.
  if (!isGPTKBinary(wineBinary)) {
    const dxvkApplied = installDxvkInPrefix(prefixDir);
    if (dxvkApplied) {
      const dxvkOverrides = DXVK_DLLS.map(d => `${d.replace('.dll', '')}=n`).join(';');
      env.WINEDLLOVERRIDES = env.WINEDLLOVERRIDES
        ? `${env.WINEDLLOVERRIDES};${dxvkOverrides}`
        : dxvkOverrides;
      log.info('DXVK enabled — D3D10/D3D11 will use Vulkan via MoltenVK');
    }
  } else {
    log.info('Using GPTK D3DMetal — skipping DXVK');
  }

  // Launch the game
  try {
    log.info({ env: { WINEPREFIX: env.WINEPREFIX, DYLD_FALLBACK_LIBRARY_PATH: env.DYLD_FALLBACK_LIBRARY_PATH, WINEESYNC: env.WINEESYNC, WINEFSYNC: env.WINEFSYNC, WINEDLLOVERRIDES: env.WINEDLLOVERRIDES } }, 'Wine environment');
    const launchTime = Date.now();
    const result = await runProcess(wineBinary, [exePath], {
      env,
      onStdoutLine: (line) => log.debug({ stream: 'stdout' }, line),
      onStderrLine: (line) => log.debug({ stream: 'stderr' }, line),
    });
    const elapsed = Date.now() - launchTime;
    log.info({ exitCode: result.exitCode, stdoutLen: result.stdout.length, stderrLen: result.stderr.length, elapsedMs: elapsed }, 'Game process exited');
    if (result.stdout) {
      log.info({ stdout: result.stdout.slice(0, 2000) }, 'Game stdout output');
    }
    if (result.stderr) {
      log.warn({ stderr: result.stderr.slice(0, 2000) }, 'Game stderr output');
    }

    // Build a combined output for error display (stdout often has the real error)
    const combinedOutput = [
      result.stdout ? result.stdout.slice(0, 500) : '',
      result.stderr ? result.stderr.slice(0, 500) : '',
    ].filter(Boolean).join('\n');

    if (result.exitCode !== 0) {
      return { success: false, message: `Game exited with code ${result.exitCode}\n${combinedOutput}` };
    }

    // A game that exits with code 0 in under 5 seconds almost certainly didn't
    // actually run — it hit an init error (Steam not found, DRM check, etc.)
    if (elapsed < 5000) {
      return { success: false, message: `Game exited immediately (${Math.round(elapsed / 1000)}s).\n${combinedOutput || 'No output — check the log file for details.'}` };
    }

    return { success: true, message: 'Game exited.' };
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

  // Ensure Wine Staging's lib directory is in the library path so MoltenVK
  // (bundled as libMoltenVK.dylib) is discoverable for DXVK's Vulkan calls
  const wineLibDir = path.join(wineDir, 'lib');
  if (fs.existsSync(path.join(wineLibDir, 'libMoltenVK.dylib'))) {
    const existing = env.DYLD_FALLBACK_LIBRARY_PATH || '';
    env.DYLD_FALLBACK_LIBRARY_PATH = existing
      ? `${wineLibDir}:${existing}`
      : `${wineLibDir}:/usr/lib`;
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

async function enableClipboardSharing(
  wineBinary: string,
  env: Record<string, string>,
): Promise<void> {
  await runProcess(wineBinary, [
    'reg', 'add', 'HKEY_CURRENT_USER\\Software\\Wine\\X11 Driver', '/v', 'Clipboard', '/d', 'true', '/f',
  ], { env });
}

async function disableCrashDialog(
  wineBinary: string,
  env: Record<string, string>,
): Promise<void> {
  // Disable Wine's crash/debug dialog (WineDbg) — suppresses the scary
  // "Program Error" popup when Steam or its subprocesses exit uncleanly
  await runProcess(wineBinary, [
    'reg', 'add', 'HKEY_CURRENT_USER\\Software\\Wine\\WineDbg', '/v', 'ShowCrashDialog', '/t', 'REG_DWORD', '/d', '0', '/f',
  ], { env });
}

/**
 * Kill any running wineserver for a given prefix.
 * Needed when switching between Wine versions on the same prefix.
 */
async function killWineserver(wineBinary: string, prefixDir?: string): Promise<void> {
  const wineDir = path.dirname(wineBinary);
  const wineserver = path.join(wineDir, 'wineserver');
  try {
    if (fs.existsSync(wineserver)) {
      const killEnv: Record<string, string> = { ...process.env as Record<string, string>, WINEDEBUG: '-all' };
      if (prefixDir) killEnv.WINEPREFIX = prefixDir;
      await runProcess(wineserver, ['-k'], { env: killEnv });
    }
  } catch {
    // Ignore — wineserver may not be running
  }
}

// --- DXVK ---

/**
 * DXVK DLLs that get copied into the Wine prefix.
 * On macOS (Gcenx/DXVK-macOS), only d3d10core and d3d11 are shipped —
 * d3d9 and dxgi are deliberately excluded (not compatible with MoltenVK).
 */
const DXVK_DLLS = ['d3d10core.dll', 'd3d11.dll'];

/**
 * Install DXVK DLLs into a Wine prefix's system32/syswow64 directories.
 * Returns true if DXVK was applied.
 */
function installDxvkInPrefix(prefixDir: string): boolean {
  const log = getLogger();
  const dxvkDir = getDxvkDir();

  if (!fs.existsSync(path.join(dxvkDir, 'x64', 'd3d11.dll'))) {
    log.debug('DXVK not installed — skipping prefix setup');
    return false;
  }

  const sys32 = path.join(prefixDir, 'drive_c', 'windows', 'system32');
  const sysWow64 = path.join(prefixDir, 'drive_c', 'windows', 'syswow64');

  // Copy x64 DLLs to system32
  const x64Dir = path.join(dxvkDir, 'x64');
  if (fs.existsSync(x64Dir) && fs.existsSync(sys32)) {
    for (const dll of DXVK_DLLS) {
      const src = path.join(x64Dir, dll);
      if (fs.existsSync(src)) {
        fs.copyFileSync(src, path.join(sys32, dll));
        log.debug({ dll, target: 'system32' }, 'Installed DXVK DLL');
      }
    }
  }

  // Copy x32 DLLs to syswow64
  const x32Dir = path.join(dxvkDir, 'x32');
  if (fs.existsSync(x32Dir) && fs.existsSync(sysWow64)) {
    for (const dll of DXVK_DLLS) {
      const src = path.join(x32Dir, dll);
      if (fs.existsSync(src)) {
        fs.copyFileSync(src, path.join(sysWow64, dll));
        log.debug({ dll, target: 'syswow64' }, 'Installed DXVK DLL');
      }
    }
  }

  log.info({ prefixDir }, 'DXVK DLLs installed in prefix');
  return true;
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
