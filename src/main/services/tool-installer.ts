import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { runProcess } from './process-runner';
import { stripQuarantine } from './quarantine';
import { getDepotDownloaderDir, getAppDataDir, getWineStagingDir, getWineCrossoverDir, getDxvkDir } from '../lib/paths';
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

  // Step 5: Wine Crossover (preferred — has macOS VA patches + Steam support)
  if (!toolStatus.wineCrossoverPath) {
    await onProgress('Installing Wine Crossover...', 0.65);
    const wcOk = await installWineCrossover(onLog);
    if (!wcOk) onLog('Wine Crossover install failed — will try Wine Staging as fallback.');
  }

  // Step 5b: Wine Staging 11.x (fallback for Steam if Crossover doesn't work)
  if (!toolStatus.wineStagingPath) {
    await onProgress('Installing Wine Staging (fallback)...', 0.7);
    const wsOk = await installWineStaging(onLog);
    if (!wsOk) onLog('Wine Staging install failed — Steam-in-prefix online mode may not work.');
  }

  // Step 6: DXVK-macOS (D3D10/D3D11 → Vulkan translation for games)
  if (!toolStatus.dxvkPath) {
    await onProgress('Installing DXVK (D3D to Vulkan)...', 0.8);
    const dxvkOk = await installDxvk(onLog);
    if (!dxvkOk) onLog('DXVK install failed — some games may not render correctly.');
  }

  // Step 7: Goldberg Steam Emulator
  if (!isGoldbergInstalled()) {
    await onProgress('Downloading Steam emulator...', 0.88);
    await installGoldberg(onLog);
  }

  // Step 8: Verify
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

  if (identifier === 'wine-crossover') {
    await onProgress('Installing Wine Crossover...', 0.3);
    const ok = await installWineCrossover(onLog);
    await onProgress(ok ? 'Done.' : 'Failed.', 1.0);
    return ok;
  }

  if (identifier === 'wine-staging' || identifier === 'wine@staging') {
    await onProgress('Installing Wine Staging...', 0.3);
    const ok = await installWineStaging(onLog);
    await onProgress(ok ? 'Done.' : 'Failed.', 1.0);
    return ok;
  }

  if (identifier === 'dxvk') {
    await onProgress('Installing DXVK...', 0.3);
    const ok = await installDxvk(onLog);
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

  // Remove our managed Wine installs
  const wsDir = getWineStagingDir();
  if (fs.existsSync(wsDir)) await runProcess('/bin/rm', ['-rf', wsDir]);
  const wcDir = getWineCrossoverDir();
  if (fs.existsSync(wcDir)) await runProcess('/bin/rm', ['-rf', wcDir]);

  // Remove DXVK
  const dxDir = getDxvkDir();
  if (fs.existsSync(dxDir)) fs.rmSync(dxDir, { recursive: true, force: true });

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

  // Reinstall Wine Crossover + Staging
  await onProgress('Installing Wine Crossover...', 0.65);
  await installWineCrossover(onLog);
  await onProgress('Installing Wine Staging...', 0.7);
  await installWineStaging(onLog);

  // Reinstall DXVK
  await onProgress('Installing DXVK...', 0.8);
  await installDxvk(onLog);

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

// --- Wine Staging (direct download from Gcenx GitHub releases) ---

const WINE_STAGING_VERSION = '11.5';
const WINE_STAGING_URL = `https://github.com/Gcenx/macOS_Wine_builds/releases/download/${WINE_STAGING_VERSION}/wine-staging-${WINE_STAGING_VERSION}-osx64.tar.xz`;
const GSTREAMER_PKG_URL = 'https://gstreamer.freedesktop.org/data/pkg/osx/1.28.1/gstreamer-1.0-1.28.1-universal.pkg';

// DXVK-macOS from Gcenx — translates D3D10/D3D11 to Vulkan (then MoltenVK → Metal).
// Upstream DXVK v2.x does NOT work on macOS — requires Vulkan features MoltenVK can't provide.
// Wine Crossover from Gcenx — has CodeWeavers' macOS VA patches (fixes mmap crashes
// under Rosetta 2) and Steam compatibility patches. Wine 8.0.1 base.
const WINE_CROSSOVER_VERSION = 'crossover-wine-23.7.1-1';
const WINE_CROSSOVER_URL = `https://github.com/Gcenx/winecx/releases/download/${WINE_CROSSOVER_VERSION}/wine-crossover-23.7.1-1-osx64.tar.xz`;

const DXVK_MACOS_VERSION = 'v1.10.3-20230507-repack';
const DXVK_MACOS_URL = `https://github.com/Gcenx/DXVK-macOS/releases/download/${DXVK_MACOS_VERSION}/dxvk-macOS-async-${DXVK_MACOS_VERSION}.tar.gz`;

async function installWineStaging(onLog: LogCallback): Promise<boolean> {
  const log = getLogger();
  const installDir = getWineStagingDir();

  try {
    // Step 1: Ensure GStreamer runtime is installed (Wine Staging depends on it)
    if (!fs.existsSync('/Library/Frameworks/GStreamer.framework')) {
      onLog('Installing GStreamer runtime (required by Wine)...');
      const gstOk = await installGStreamer(onLog);
      if (!gstOk) {
        onLog('GStreamer install skipped or failed — Wine Staging may have limited functionality.');
      }
    }

    // Step 2: Ensure Rosetta 2 is available (Wine Staging is x86_64)
    if (isAppleSilicon()) {
      onLog('Ensuring Rosetta 2 is available...');
      await runProcess('/usr/sbin/softwareupdate', ['--install-rosetta', '--agree-to-license']);
    }

    // Step 3: Download Wine Staging tarball
    onLog(`Downloading Wine Staging ${WINE_STAGING_VERSION}...`);
    const tmpDir = path.join(os.tmpdir(), `wine-staging-${Date.now()}`);
    fs.mkdirSync(tmpDir, { recursive: true });
    const tarPath = path.join(tmpDir, 'wine-staging.tar.xz');

    const res = await fetch(WINE_STAGING_URL);
    if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`);

    const buf = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(tarPath, buf);
    onLog(`Downloaded (${Math.round(buf.length / 1024 / 1024)} MB). Extracting...`);

    // Step 4: Extract to install directory
    if (fs.existsSync(installDir)) {
      // Use rm -rf via shell — Node's fs.rmSync fails on deeply nested Wine directories
      await runProcess('/bin/rm', ['-rf', installDir]);
    }
    fs.mkdirSync(installDir, { recursive: true });

    const extract = await runProcess('/usr/bin/tar', ['-xf', tarPath, '-C', installDir], {
      onStdoutLine: (line) => onLog(line),
      onStderrLine: (line) => log.debug(line),
    });

    // Clean up temp
    fs.rmSync(tmpDir, { recursive: true, force: true });

    if (extract.exitCode !== 0) {
      onLog('Failed to extract Wine Staging archive.');
      return false;
    }

    // Step 5: Strip quarantine
    await stripQuarantine(installDir);

    // Step 6: Verify the binary exists
    const { getWineStagingBinary } = await import('../lib/paths');
    const binary = getWineStagingBinary();
    if (!fs.existsSync(binary)) {
      onLog(`Wine binary not found at expected path: ${binary}`);
      // List what was actually extracted for debugging
      const contents = fs.readdirSync(installDir);
      onLog(`Install dir contents: ${contents.join(', ')}`);
      return false;
    }

    // Make executable
    await runProcess('/bin/chmod', ['+x', binary]);

    onLog(`Wine Staging ${WINE_STAGING_VERSION} installed successfully.`);
    return true;
  } catch (err) {
    onLog(`Wine Staging install error: ${err}`);
    log.error({ err }, 'Wine Staging install failed');
    return false;
  }
}

// --- Wine Crossover (direct download from Gcenx GitHub releases) ---

async function installWineCrossover(onLog: LogCallback): Promise<boolean> {
  const log = getLogger();
  const installDir = getWineCrossoverDir();

  try {
    // Step 1: Ensure Rosetta 2 is available (wine-crossover is x86_64)
    if (isAppleSilicon()) {
      onLog('Ensuring Rosetta 2 is available...');
      await runProcess('/usr/sbin/softwareupdate', ['--install-rosetta', '--agree-to-license']);
    }

    // Step 2: Download Wine Crossover tarball
    onLog(`Downloading Wine Crossover (${WINE_CROSSOVER_VERSION})...`);
    const tmpDir = path.join(os.tmpdir(), `wine-crossover-${Date.now()}`);
    fs.mkdirSync(tmpDir, { recursive: true });
    const tarPath = path.join(tmpDir, 'wine-crossover.tar.xz');

    const res = await fetch(WINE_CROSSOVER_URL);
    if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`);

    const buf = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(tarPath, buf);
    onLog(`Downloaded (${Math.round(buf.length / 1024 / 1024)} MB). Extracting...`);

    // Step 3: Extract
    if (fs.existsSync(installDir)) {
      await runProcess('/bin/rm', ['-rf', installDir]);
    }
    fs.mkdirSync(installDir, { recursive: true });

    const extract = await runProcess('/usr/bin/tar', ['-xf', tarPath, '-C', installDir], {
      onStdoutLine: (line) => onLog(line),
      onStderrLine: (line) => log.debug(line),
    });

    fs.rmSync(tmpDir, { recursive: true, force: true });

    if (extract.exitCode !== 0) {
      onLog('Failed to extract Wine Crossover archive.');
      return false;
    }

    // Step 4: Strip quarantine
    await stripQuarantine(installDir);

    // Step 5: Verify the binary exists
    const { getWineCrossoverBinary } = await import('../lib/paths');
    const binary = getWineCrossoverBinary();
    if (!fs.existsSync(binary)) {
      // Try alternate binary name (wine vs wine64)
      const altBinary = binary.replace('wine64', 'wine');
      if (fs.existsSync(altBinary)) {
        onLog(`Wine Crossover uses 'wine' binary (not wine64).`);
      } else {
        onLog(`Wine binary not found at expected path: ${binary}`);
        const contents = fs.readdirSync(installDir);
        onLog(`Install dir contents: ${contents.join(', ')}`);
        return false;
      }
    }

    await runProcess('/bin/chmod', ['+x', binary]);

    onLog(`Wine Crossover ${WINE_CROSSOVER_VERSION} installed successfully.`);
    return true;
  } catch (err) {
    onLog(`Wine Crossover install error: ${err}`);
    log.error({ err }, 'Wine Crossover install failed');
    return false;
  }
}

/**
 * Install GStreamer runtime using a native macOS auth dialog (via osascript).
 * No Terminal interaction — shows the standard "wants to make changes" dialog.
 */
async function installGStreamer(onLog: LogCallback): Promise<boolean> {
  const log = getLogger();

  try {
    // Download the pkg
    const pkgPath = path.join(os.tmpdir(), 'gstreamer-runtime.pkg');
    onLog('Downloading GStreamer runtime...');
    const res = await fetch(GSTREAMER_PKG_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(pkgPath, buf);
    onLog(`Downloaded GStreamer (${Math.round(buf.length / 1024 / 1024)} MB). Installing...`);

    // Install via osascript — shows native macOS password dialog
    const script = `do shell script "installer -pkg '${pkgPath}' -target /" with administrator privileges`;
    const result = await runProcess('/usr/bin/osascript', ['-e', script], {
      onStdoutLine: (line) => onLog(line),
      onStderrLine: (line) => log.debug(line),
    });

    // Clean up
    try { fs.unlinkSync(pkgPath); } catch {}

    if (result.exitCode !== 0) {
      onLog('GStreamer install was cancelled or failed.');
      return false;
    }

    onLog('GStreamer runtime installed.');
    return true;
  } catch (err) {
    onLog(`GStreamer install error: ${err}`);
    log.error({ err }, 'GStreamer install failed');
    return false;
  }
}

// --- DXVK-macOS (D3D → Vulkan translation) ---

async function installDxvk(onLog: LogCallback): Promise<boolean> {
  const log = getLogger();
  const installDir = getDxvkDir();

  try {
    onLog(`Downloading DXVK-macOS ${DXVK_MACOS_VERSION}...`);
    const tmpDir = path.join(os.tmpdir(), `dxvk-${Date.now()}`);
    fs.mkdirSync(tmpDir, { recursive: true });
    const tarPath = path.join(tmpDir, 'dxvk-macOS.tar.gz');

    const res = await fetch(DXVK_MACOS_URL);
    if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`);

    const buf = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(tarPath, buf);
    onLog(`Downloaded (${Math.round(buf.length / 1024 / 1024)} MB). Extracting...`);

    // Extract to temp directory first to find the inner folder name
    const extractDir = path.join(tmpDir, 'extracted');
    fs.mkdirSync(extractDir, { recursive: true });
    const extract = await runProcess('/usr/bin/tar', ['-xzf', tarPath, '-C', extractDir]);
    if (extract.exitCode !== 0) {
      onLog('Failed to extract DXVK archive.');
      fs.rmSync(tmpDir, { recursive: true, force: true });
      return false;
    }

    // Find the extracted directory (name varies by release)
    const entries = fs.readdirSync(extractDir);
    const innerDir = entries.find(e => fs.statSync(path.join(extractDir, e)).isDirectory());
    if (!innerDir) {
      onLog('DXVK archive has unexpected structure.');
      fs.rmSync(tmpDir, { recursive: true, force: true });
      return false;
    }

    const srcDir = path.join(extractDir, innerDir);

    // Set up our install directory with x64 and x32 subdirs
    if (fs.existsSync(installDir)) fs.rmSync(installDir, { recursive: true, force: true });
    fs.mkdirSync(installDir, { recursive: true });

    // Copy DLL directories
    for (const sub of ['x64', 'x32']) {
      const src = path.join(srcDir, sub);
      if (fs.existsSync(src)) {
        const dst = path.join(installDir, sub);
        fs.mkdirSync(dst, { recursive: true });
        for (const file of fs.readdirSync(src)) {
          fs.copyFileSync(path.join(src, file), path.join(dst, file));
        }
      }
    }

    // Copy dxvk.conf if present
    const confSrc = path.join(srcDir, 'dxvk.conf');
    if (fs.existsSync(confSrc)) {
      fs.copyFileSync(confSrc, path.join(installDir, 'dxvk.conf'));
    }

    // Clean up temp
    fs.rmSync(tmpDir, { recursive: true, force: true });

    // Verify
    if (!fs.existsSync(path.join(installDir, 'x64', 'd3d11.dll'))) {
      onLog('DXVK install verification failed — d3d11.dll not found.');
      return false;
    }

    onLog('DXVK-macOS installed successfully.');
    return true;
  } catch (err) {
    onLog(`DXVK install error: ${err}`);
    log.error({ err }, 'DXVK install failed');
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
