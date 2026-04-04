import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { runProcess } from './process-runner';
import { stripQuarantine } from './quarantine';
import { getDepotDownloaderDir, getAppDataDir } from '../lib/paths';
import { installGoldberg, isGoldbergInstalled, getGoldbergDir } from './steam-emu';
import { isAppleSilicon, getArchitecture } from '../lib/platform';
import { getLogger } from '../lib/logger';
import type { ToolStatus } from '../../shared/types';
import { locateTools } from './tool-locator';

export type ProgressCallback = (step: string, percent: number) => void;
export type LogCallback = (line: string) => void;

const BREW_INSTALL_SCRIPT = 'https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh';

const QUARANTINE_TARGETS: Record<string, string[]> = {
  steamcmd: ['/opt/homebrew/Caskroom/steamcmd', '/usr/local/Caskroom/steamcmd'],
  'gcenx/wine/wine-crossover': ['/opt/homebrew/Caskroom/wine-crossover', '/usr/local/Caskroom/wine-crossover'],
  'gcenx/wine/game-porting-toolkit': [
    '/opt/homebrew/Caskroom/game-porting-toolkit',
    '/usr/local/Caskroom/game-porting-toolkit',
    '/Applications/Game Porting Toolkit.app',
  ],
};

// --- Public API ---

export async function bootstrap(
  toolStatus: ToolStatus,
  onProgress: ProgressCallback,
  onLog: LogCallback,
): Promise<ToolStatus> {
  const log = getLogger();

  // Step 1: Homebrew
  await onProgress('Checking Homebrew...', 0.05);
  let brewPath = findBrew();
  if (!brewPath) {
    await onProgress('Installing Homebrew...', 0.1);
    const ok = await installHomebrew(onLog);
    if (!ok) throw new Error('Homebrew installation failed.');
    brewPath = findBrew();
  }
  if (!brewPath) throw new Error('Could not locate Homebrew.');

  // Step 2: DepotDownloader
  if (!toolStatus.depotDownloaderPath) {
    await onProgress('Downloading DepotDownloader...', 0.15);
    await installDepotDownloader(onLog);
  }

  // Step 3: steamcmd
  if (!toolStatus.steamcmdPath) {
    await onProgress('Installing steamcmd...', 0.35);
    await brewInstall(brewPath, 'steamcmd', true, onLog);
    await stripQuarantineForFormula('steamcmd', onLog);
  }

  // Step 4: Wine / GPTK
  if (!toolStatus.winePath && !toolStatus.gptkPath) {
    if (isAppleSilicon()) {
      await onProgress('Installing Game Porting Toolkit...', 0.5);
      const gptkOk = await installGPTK(brewPath, onLog);
      if (!gptkOk) {
        onLog('GPTK failed, falling back to CrossOver Wine...');
        await onProgress('Installing Wine (CrossOver)...', 0.6);
        await brewTap(brewPath, 'gcenx/wine', onLog);
        await brewInstall(brewPath, 'gcenx/wine/wine-crossover', true, onLog);
        await stripQuarantineForFormula('gcenx/wine/wine-crossover', onLog);
      }
    } else {
      await onProgress('Installing Wine (CrossOver)...', 0.5);
      await brewTap(brewPath, 'gcenx/wine', onLog);
      await brewInstall(brewPath, 'gcenx/wine/wine-crossover', true, onLog);
      await stripQuarantineForFormula('gcenx/wine/wine-crossover', onLog);
    }
  }

  // Step 5: Goldberg Steam Emulator
  if (!isGoldbergInstalled()) {
    await onProgress('Downloading Steam emulator...', 0.8);
    await installGoldberg(onLog);
  }

  // Step 6: Verify
  await onProgress('Verifying installations...', 0.9);
  const newStatus = await locateTools();
  await onProgress('Setup complete.', 1.0);
  log.info({ newStatus }, 'Bootstrap complete');
  return newStatus;
}

export async function installSingleTool(
  identifier: string,
  onProgress: ProgressCallback,
  onLog: LogCallback,
): Promise<boolean> {
  if (identifier === 'depotdownloader') {
    await onProgress('Downloading DepotDownloader...', 0.3);
    const ok = await installDepotDownloader(onLog);
    await onProgress(ok ? 'Done.' : 'Failed.', 1.0);
    return ok;
  }

  if (identifier === 'gptk' || identifier === 'game-porting-toolkit') {
    const brewPath = findBrew();
    if (!brewPath) throw new Error('Homebrew not found.');
    await onProgress('Installing Game Porting Toolkit...', 0.3);
    const ok = await installGPTK(brewPath, onLog);
    await onProgress(ok ? 'Done.' : 'Failed.', 1.0);
    return ok;
  }

  const brewPath = findBrew();
  if (!brewPath) throw new Error('Homebrew not found.');

  const isCask = identifier.includes('wine') || identifier === 'steamcmd';

  if (identifier.includes('gcenx') || identifier.includes('wine')) {
    await brewTap(brewPath, 'gcenx/wine', onLog);
  }

  await onProgress(`Installing ${identifier}...`, 0.3);
  const ok = await brewInstall(brewPath, identifier, isCask, onLog);
  if (ok && isCask) await stripQuarantineForFormula(identifier, onLog);
  await onProgress(ok ? 'Done.' : 'Failed.', 1.0);
  return ok;
}

export async function reinstallAll(
  onProgress: ProgressCallback,
  onLog: LogCallback,
): Promise<ToolStatus> {
  const brewPath = findBrew();
  if (!brewPath) throw new Error('Homebrew not found.');

  // Remove DepotDownloader
  await onProgress('Removing DepotDownloader...', 0.05);
  const ddDir = getDepotDownloaderDir();
  if (fs.existsSync(ddDir)) fs.rmSync(ddDir, { recursive: true });

  // Remove Goldberg
  const gbDir = getGoldbergDir();
  if (fs.existsSync(gbDir)) fs.rmSync(gbDir, { recursive: true });

  // Remove brew tools
  const tools = [
    { formula: 'steamcmd', cask: true },
    { formula: 'gcenx/wine/wine-crossover', cask: true },
  ];
  if (isAppleSilicon()) {
    tools.push({ formula: 'gcenx/wine/game-porting-toolkit', cask: true });
  }

  for (let i = 0; i < tools.length; i++) {
    const t = tools[i];
    await onProgress(`Removing ${t.formula}...`, 0.1 + i * 0.1);
    await brewUninstall(brewPath, t.formula, t.cask, onLog);
  }

  // Reinstall DepotDownloader
  await onProgress('Downloading DepotDownloader...', 0.4);
  await installDepotDownloader(onLog);

  // Reinstall steamcmd
  await onProgress('Installing steamcmd...', 0.5);
  await brewInstall(brewPath, 'steamcmd', true, onLog);
  await stripQuarantineForFormula('steamcmd', onLog);

  // Reinstall Wine/GPTK
  if (isAppleSilicon()) {
    await onProgress('Installing Game Porting Toolkit...', 0.6);
    const gptkOk = await installGPTK(brewPath, onLog);
    if (!gptkOk) {
      await onProgress('Installing Wine (CrossOver)...', 0.65);
      await brewTap(brewPath, 'gcenx/wine', onLog);
      await brewInstall(brewPath, 'gcenx/wine/wine-crossover', true, onLog);
      await stripQuarantineForFormula('gcenx/wine/wine-crossover', onLog);
    }
  } else {
    await onProgress('Installing Wine (CrossOver)...', 0.6);
    await brewTap(brewPath, 'gcenx/wine', onLog);
    await brewInstall(brewPath, 'gcenx/wine/wine-crossover', true, onLog);
    await stripQuarantineForFormula('gcenx/wine/wine-crossover', onLog);
  }

  await onProgress('Verifying installations...', 0.9);
  const status = await locateTools();
  await onProgress('Reinstall complete.', 1.0);
  return status;
}

// --- GPTK ---

async function installGPTK(brewPath: string, onLog: LogCallback): Promise<boolean> {
  onLog('Tapping gcenx/wine...');
  await brewTap(brewPath, 'gcenx/wine', onLog);
  onLog('Installing game-porting-toolkit cask...');
  const ok = await brewInstall(brewPath, 'gcenx/wine/game-porting-toolkit', true, onLog);
  if (ok) {
    await stripQuarantineForFormula('gcenx/wine/game-porting-toolkit', onLog);
    onLog('Game Porting Toolkit installed.');
  }
  return ok;
}

// --- DepotDownloader (GitHub Release) ---

async function installDepotDownloader(onLog: LogCallback): Promise<boolean> {
  const arch = getArchitecture() === 'arm64' ? 'arm64' : 'x64';
  const apiURL = 'https://api.github.com/repos/SteamRE/DepotDownloader/releases/latest';

  try {
    const res = await fetch(apiURL);
    const json = (await res.json()) as { assets: { name: string; browser_download_url: string }[] };
    const targetName = `DepotDownloader-macos-${arch}.zip`;
    const asset = json.assets.find(a => a.name === targetName);
    if (!asset) { onLog(`Could not find ${targetName}`); return false; }

    onLog(`Downloading ${targetName}...`);
    const zipRes = await fetch(asset.browser_download_url);
    const zipBuf = Buffer.from(await zipRes.arrayBuffer());

    const tmpDir = path.join(os.tmpdir(), `dd-${Date.now()}`);
    fs.mkdirSync(tmpDir, { recursive: true });
    const zipPath = path.join(tmpDir, targetName);
    fs.writeFileSync(zipPath, zipBuf);

    const installDir = getDepotDownloaderDir();
    fs.mkdirSync(installDir, { recursive: true });

    const unzip = await runProcess('/usr/bin/unzip', ['-o', zipPath, '-d', installDir]);
    fs.rmSync(tmpDir, { recursive: true, force: true });

    if (unzip.exitCode !== 0) { onLog('Failed to unzip'); return false; }

    // chmod +x everything and strip quarantine
    const files = fs.readdirSync(installDir);
    for (const f of files) {
      const fp = path.join(installDir, f);
      if (fs.statSync(fp).isFile()) {
        await runProcess('/bin/chmod', ['+x', fp]);
      }
    }
    await stripQuarantine(installDir);
    onLog(`DepotDownloader installed at ${installDir}`);
    return true;
  } catch (err) {
    onLog(`DepotDownloader install error: ${err}`);
    return false;
  }
}

// --- Homebrew helpers ---

function findBrew(): string | null {
  for (const p of ['/opt/homebrew/bin/brew', '/usr/local/bin/brew']) {
    try { fs.accessSync(p, fs.constants.X_OK); return p; } catch {}
  }
  return null;
}

async function installHomebrew(onLog: LogCallback): Promise<boolean> {
  const result = await runProcess('/bin/bash', [
    '-c', `NONINTERACTIVE=1 /bin/bash -c "$(curl -fsSL ${BREW_INSTALL_SCRIPT})"`,
  ], {
    onStdoutLine: onLog,
    onStderrLine: onLog,
  });
  return result.exitCode === 0;
}

async function brewTap(brew: string, tap: string, onLog: LogCallback): Promise<void> {
  await runProcess(brew, ['tap', tap], { onStdoutLine: onLog, onStderrLine: onLog });
}

async function brewInstall(brew: string, formula: string, cask: boolean, onLog: LogCallback): Promise<boolean> {
  const args = ['install'];
  if (cask) args.push('--cask');
  args.push(formula);
  const result = await runProcess(brew, args, { onStdoutLine: onLog, onStderrLine: onLog });
  return result.exitCode === 0;
}

async function brewUninstall(brew: string, formula: string, cask: boolean, onLog: LogCallback): Promise<void> {
  const args = ['uninstall', '--force'];
  if (cask) args.splice(1, 0, '--cask');
  args.push(formula);
  await runProcess(brew, args, { onStdoutLine: onLog, onStderrLine: onLog });
}

async function stripQuarantineForFormula(formula: string, onLog: LogCallback): Promise<void> {
  const paths = QUARANTINE_TARGETS[formula];
  if (!paths) return;
  for (const p of paths) {
    if (fs.existsSync(p)) {
      onLog(`Stripping quarantine from ${p}...`);
      await stripQuarantine(p);
    }
  }
}
