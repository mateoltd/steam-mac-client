import path from 'node:path';
import { app } from 'electron';

export function getAppDataDir(): string {
  return path.join(app.getPath('appData'), 'SteamMacClient');
}

export function getDepotDownloaderDir(): string {
  return path.join(getAppDataDir(), 'DepotDownloader');
}

export function getPrefixDir(appId: number): string {
  return path.join(getAppDataDir(), 'Prefixes', String(appId));
}

/**
 * Separate game prefix for when the game Wine binary differs from Steam's.
 * Wine prefixes are version-locked — a prefix created by Wine Staging 11.x
 * can't be used by GPTK (Wine 7.7) and vice versa.
 */
export function getGamePrefixDir(appId: number): string {
  return path.join(getAppDataDir(), 'Prefixes', String(appId), 'game');
}

export function getDefaultDownloadDir(): string {
  return path.join(app.getPath('downloads'), 'SteamDepots');
}

export function getWineStagingDir(): string {
  return path.join(getAppDataDir(), 'WineStaging');
}

export function getWineStagingBinary(): string {
  return path.join(getWineStagingDir(), 'Wine Staging.app', 'Contents', 'Resources', 'wine', 'bin', 'wine');
}

export function getWineCrossoverDir(): string {
  return path.join(getAppDataDir(), 'WineCrossover');
}

export function getWineCrossoverBinary(): string {
  return path.join(getWineCrossoverDir(), 'Wine Crossover.app', 'Contents', 'Resources', 'wine', 'bin', 'wine64');
}

export function getDxvkDir(): string {
  return path.join(getAppDataDir(), 'DXVK');
}
