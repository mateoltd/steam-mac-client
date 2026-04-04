import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { runProcess } from './process-runner';
import { getAppDataDir } from '../lib/paths';
import { getLogger } from '../lib/logger';

const GOLDBERG_REPO = 'https://api.github.com/repos/Detanup01/gbe_fork/releases/latest';

/**
 * Get the directory where Goldberg emulator DLLs are stored.
 */
export function getGoldbergDir(): string {
  return path.join(getAppDataDir(), 'GoldbergEmu');
}

/**
 * Check if Goldberg emulator is installed locally.
 */
export function isGoldbergInstalled(): boolean {
  const dir = getGoldbergDir();
  return fs.existsSync(path.join(dir, 'steam_api64.dll'));
}

/**
 * Download and install Goldberg Steam Emulator from GitHub.
 */
export async function installGoldberg(onLog?: (line: string) => void): Promise<boolean> {
  const log = getLogger();
  const logLine = onLog || (() => {});

  try {
    logLine('Fetching latest Goldberg emulator release...');
    const res = await fetch(GOLDBERG_REPO);
    const json = (await res.json()) as { assets: { name: string; browser_download_url: string }[] };

    // Assets are .7z — look for win release (contains DLLs we need for Wine)
    const asset = json.assets.find(a =>
      a.name.includes('win') && a.name.includes('release') && !a.name.includes('debug')
    );
    if (!asset) {
      logLine('Could not find Goldberg release asset.');
      log.warn({ assets: json.assets.map(a => a.name) }, 'No matching Goldberg asset found');
      return false;
    }

    logLine(`Downloading ${asset.name}...`);
    const archiveRes = await fetch(asset.browser_download_url);
    const archiveBuf = Buffer.from(await archiveRes.arrayBuffer());

    const tmpDir = path.join(os.tmpdir(), `goldberg-${Date.now()}`);
    fs.mkdirSync(tmpDir, { recursive: true });
    const archivePath = path.join(tmpDir, asset.name);
    fs.writeFileSync(archivePath, archiveBuf);

    const extractDir = path.join(tmpDir, 'extracted');
    fs.mkdirSync(extractDir, { recursive: true });

    // Try 7z first (brew install p7zip), fall back to unar (often preinstalled or brew install unar)
    let extractOk = false;
    for (const cmd of [
      { bin: '/opt/homebrew/bin/7z', args: ['x', archivePath, `-o${extractDir}`, '-y'] },
      { bin: '/usr/local/bin/7z', args: ['x', archivePath, `-o${extractDir}`, '-y'] },
      { bin: '/opt/homebrew/bin/unar', args: ['-o', extractDir, '-f', archivePath] },
      { bin: '/usr/local/bin/unar', args: ['-o', extractDir, '-f', archivePath] },
      { bin: '/usr/bin/unar', args: ['-o', extractDir, '-f', archivePath] },
    ]) {
      if (!fs.existsSync(cmd.bin)) continue;
      const result = await runProcess(cmd.bin, cmd.args);
      if (result.exitCode === 0) { extractOk = true; break; }
    }

    // If no extractor found, try installing p7zip via brew
    if (!extractOk) {
      logLine('No 7z extractor found, installing via Homebrew...');
      const brewPath = ['/opt/homebrew/bin/brew', '/usr/local/bin/brew'].find(p => fs.existsSync(p));
      if (brewPath) {
        await runProcess(brewPath, ['install', 'p7zip']);
        const sevenz = '/opt/homebrew/bin/7z';
        if (fs.existsSync(sevenz)) {
          const result = await runProcess(sevenz, ['x', archivePath, `-o${extractDir}`, '-y']);
          extractOk = result.exitCode === 0;
        }
      }
    }

    if (!extractOk) {
      logLine('Failed to extract Goldberg archive (no 7z/unar available).');
      fs.rmSync(tmpDir, { recursive: true, force: true });
      return false;
    }

    // Find steam_api64.dll in the extracted files
    const installDir = getGoldbergDir();
    fs.mkdirSync(installDir, { recursive: true });

    const found = findAndCopyDlls(extractDir, installDir);
    fs.rmSync(tmpDir, { recursive: true, force: true });

    if (found) {
      logLine(`Goldberg emulator installed at ${installDir}`);
      log.info({ installDir }, 'Goldberg emulator installed');
      return true;
    }

    logLine('Could not find steam_api DLLs in Goldberg release.');
    return false;
  } catch (err) {
    logLine(`Goldberg install error: ${err}`);
    log.error({ err }, 'Goldberg install failed');
    return false;
  }
}

/**
 * Apply Goldberg emulator to a game directory.
 * Finds steam_api.dll and steam_api64.dll, backs them up, and replaces with Goldberg versions.
 * Also creates steam_settings/steam_appid.txt.
 */
export function applyGoldberg(gameDir: string, appId: number): { applied: boolean; message: string } {
  const log = getLogger();
  const goldbergDir = getGoldbergDir();

  if (!isGoldbergInstalled()) {
    return { applied: false, message: 'Goldberg emulator not installed.' };
  }

  // Find all steam_api DLLs in the game directory
  const dllTargets = findSteamApiDlls(gameDir);
  if (dllTargets.length === 0) {
    log.info({ gameDir }, 'No steam_api DLLs found in game directory, skipping Goldberg');
    return { applied: false, message: 'No Steam API DLLs found.' };
  }

  let appliedCount = 0;

  for (const target of dllTargets) {
    const dllName = path.basename(target).toLowerCase();
    const goldbergDll = path.join(goldbergDir, dllName);

    if (!fs.existsSync(goldbergDll)) {
      log.warn({ dllName }, 'Goldberg DLL not found for replacement');
      continue;
    }

    // Check if already replaced (backup exists)
    const backupPath = target + '.original';
    if (fs.existsSync(backupPath)) {
      log.info({ target }, 'Goldberg already applied (backup exists)');
      appliedCount++;
      continue;
    }

    // Back up original and replace
    fs.copyFileSync(target, backupPath);
    fs.copyFileSync(goldbergDll, target);
    log.info({ target, backupPath }, 'Replaced steam_api DLL with Goldberg');
    appliedCount++;
  }

  // Create steam_settings directory with app ID
  const targetDir = path.dirname(dllTargets[0]);
  const settingsDir = path.join(targetDir, 'steam_settings');
  fs.mkdirSync(settingsDir, { recursive: true });
  fs.writeFileSync(path.join(settingsDir, 'steam_appid.txt'), String(appId), 'utf-8');

  if (appliedCount > 0) {
    return { applied: true, message: `Replaced ${appliedCount} Steam API DLL(s) with Goldberg emulator.` };
  }
  return { applied: false, message: 'No DLLs were replaced.' };
}

// --- Internals ---

/**
 * Find steam_api.dll and steam_api64.dll recursively in a game directory.
 */
function findSteamApiDlls(dir: string): string[] {
  const results: string[] = [];
  walkDir(dir, (filePath) => {
    const name = path.basename(filePath).toLowerCase();
    if (name === 'steam_api.dll' || name === 'steam_api64.dll') {
      // Skip if it's in a steam_settings or backup directory
      if (!filePath.includes('steam_settings') && !filePath.endsWith('.original')) {
        results.push(filePath);
      }
    }
  });
  return results;
}

/**
 * Find and copy Goldberg DLLs from extracted archive to install directory.
 */
function findAndCopyDlls(extractDir: string, installDir: string): boolean {
  let found = false;

  walkDir(extractDir, (filePath) => {
    const name = path.basename(filePath).toLowerCase();
    if (name === 'steam_api.dll' || name === 'steam_api64.dll') {
      // Prefer 64-bit directory if available
      const relDir = path.relative(extractDir, path.dirname(filePath)).toLowerCase();
      // Skip experimental/debug variants
      if (relDir.includes('debug') || relDir.includes('experimental')) return;

      const destPath = path.join(installDir, name);
      // Prefer files from x64/release paths, but take any if we haven't found one yet
      if (!fs.existsSync(destPath) || relDir.includes('release') || relDir.includes('x64')) {
        fs.copyFileSync(filePath, destPath);
        found = true;
      }
    }
  });

  return found;
}

function walkDir(dir: string, callback: (filePath: string) => void, depth = 0): void {
  if (depth > 8) return;
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
  } catch {
    // permission denied, etc.
  }
}
