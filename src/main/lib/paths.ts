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

export function getDefaultDownloadDir(): string {
  return path.join(app.getPath('downloads'), 'SteamDepots');
}
