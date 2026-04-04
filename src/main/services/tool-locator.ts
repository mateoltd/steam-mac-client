import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import type { ToolStatus } from '../../shared/types';
import { getDepotDownloaderDir, getWineStagingBinary, getWineCrossoverBinary, getDxvkDir } from '../lib/paths';

const SEARCH_PATHS = ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin'];

export async function locateTools(): Promise<ToolStatus> {
  const steamcmdPath = findTool('steamcmd');
  const depotDownloaderPath = findDepotDownloader();
  const winePath = findWine();
  const gptkPath = findGPTK();
  const wineStagingPath = findWineStaging();
  const wineCrossoverPath = findWineCrossover();
  const dxvkPath = findDxvk();

  return {
    steamcmdPath,
    depotDownloaderPath,
    winePath,
    gptkPath,
    wineStagingPath,
    wineCrossoverPath,
    dxvkPath,
    hasDownloadTool: !!(depotDownloaderPath || steamcmdPath),
    hasWineTool: !!(winePath || gptkPath || wineStagingPath || wineCrossoverPath),
  };
}

function findDepotDownloader(): string | null {
  // Our own install directory
  const appPath = path.join(getDepotDownloaderDir(), 'DepotDownloader');
  if (isExecutable(appPath)) return appPath;

  // dotnet tool
  const home = process.env.HOME || '';
  const dotnetPath = path.join(home, '.dotnet/tools/DepotDownloader');
  if (isExecutable(dotnetPath)) return dotnetPath;

  return findTool('DepotDownloader') || findTool('depotdownloader');
}

function findWine(): string | null {
  const winePaths = [
    '/Applications/Wine Crossover.app/Contents/Resources/wine/bin/wine64',
    '/Applications/Wine Crossover.app/Contents/Resources/wine/bin/wine',
    '/Applications/Wine Stable.app/Contents/Resources/wine/bin/wine64',
    '/Applications/Wine Stable.app/Contents/Resources/wine/bin/wine',
  ];
  for (const p of winePaths) {
    if (isExecutable(p)) return p;
  }
  return findTool('wine64') || findTool('wine');
}

function findGPTK(): string | null {
  // GPTK cask from gcenx installs Game Porting Toolkit.app
  const gptkAppPaths = [
    '/Applications/Game Porting Toolkit.app/Contents/Resources/wine/bin/wine64',
    '/Applications/Game Porting Toolkit.app/Contents/Resources/wine/bin/wine',
  ];
  for (const p of gptkAppPaths) {
    if (isExecutable(p)) return p;
  }

  // Homebrew formula variant
  const gptkBrewPaths = [
    '/opt/homebrew/opt/game-porting-toolkit/bin/wine64',
    '/usr/local/opt/game-porting-toolkit/bin/wine64',
    '/opt/homebrew/opt/game-porting-toolkit/bin/wine',
    '/usr/local/opt/game-porting-toolkit/bin/wine',
  ];
  for (const p of gptkBrewPaths) {
    if (isExecutable(p)) return p;
  }

  return findTool('gameportingtoolkit');
}

function findWineStaging(): string | null {
  // Our own managed install (downloaded from Gcenx GitHub releases)
  const managedPath = getWineStagingBinary();
  if (isExecutable(managedPath)) return managedPath;

  // Homebrew cask or manual install in /Applications
  const stagingPaths = [
    '/Applications/Wine Staging.app/Contents/Resources/wine/bin/wine',
    '/Applications/Wine Staging.app/Contents/Resources/wine/bin/wine64',
  ];
  for (const p of stagingPaths) {
    if (isExecutable(p)) return p;
  }
  return null;
}

function findWineCrossover(): string | null {
  // Our own managed install
  const managedPath = getWineCrossoverBinary();
  if (isExecutable(managedPath)) return managedPath;

  // Homebrew cask or manual install in /Applications
  const crossoverPaths = [
    '/Applications/Wine Crossover.app/Contents/Resources/wine/bin/wine64',
    '/Applications/Wine Crossover.app/Contents/Resources/wine/bin/wine',
  ];
  for (const p of crossoverPaths) {
    if (isExecutable(p)) return p;
  }
  return null;
}

function findDxvk(): string | null {
  const dir = getDxvkDir();
  const x64Dir = path.join(dir, 'x64');
  // Check that at least d3d11.dll exists in the x64 directory
  if (fs.existsSync(path.join(x64Dir, 'd3d11.dll'))) return dir;
  return null;
}

function findTool(name: string): string | null {
  for (const dir of SEARCH_PATHS) {
    const p = path.join(dir, name);
    if (isExecutable(p)) return p;
  }

  // Fallback: which
  try {
    const result = execFileSync('/usr/bin/which', [name], {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    if (result) return result;
  } catch {
    // not found
  }

  return null;
}

function isExecutable(filePath: string): boolean {
  try {
    fs.accessSync(filePath, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}
