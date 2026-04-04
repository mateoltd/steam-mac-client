export interface SteamApp {
  id: number;
  name: string;
  tinyImage: string | null;
  platforms: {
    windows: boolean;
    mac: boolean;
    linux: boolean;
  };
}

export interface Depot {
  id: string;
  name: string;
  oslist: string[];
  maxSize: number | null;
  manifests: Record<string, string>;
}

export interface DownloadTask {
  id: string;
  appId: number;
  appName: string;
  depotId: string;
  status: DownloadStatus;
  progressPercent: number;
  outputLog: string;
  outputDirectory: string | null;
  onlineMode: boolean;
}

export type DownloadStatus =
  | { type: 'queued' }
  | { type: 'authenticating' }
  | { type: 'downloading' }
  | { type: 'completed'; outputDirectory?: string }
  | { type: 'failed'; message: string }
  | { type: 'cancelled' };

export type SteamPromptType = 'twoFactorAuth' | 'emailCode' | 'smsCode' | 'password';

export interface ToolStatus {
  steamcmdPath: string | null;
  depotDownloaderPath: string | null;
  winePath: string | null;
  gptkPath: string | null;
  hasDownloadTool: boolean;
  hasWineTool: boolean;
}

export interface WineConfig {
  dllOverrides: Record<string, DLLLoadOrder>;
  environmentVariables: Record<string, string>;
  windowsVersion: WindowsVersion;
}

export type DLLLoadOrder = 'n' | 'b' | 'n,b' | 'b,n' | '';
export type WindowsVersion = 'win10' | 'win81' | 'win8' | 'win7';
export type WineBackend = 'gptk' | 'crossover' | 'custom';

export interface AppSettings {
  steamUsername: string;
  downloadDirectory: string;
  wineBackend: WineBackend;
}

export interface InstallProgress {
  step: string;
  percent: number;
}
