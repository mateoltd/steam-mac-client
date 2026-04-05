import { app, BrowserWindow, ipcMain, shell, dialog } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { getLogger } from './lib/logger';
import { getArchitecture } from './lib/platform';
import { getDefaultDownloadDir } from './lib/paths';
import { searchGames } from './services/steam-store-api';
import { getDepots } from './services/depot-info';
import { locateTools } from './services/tool-locator';
import { bootstrap, installSingleTool, reinstallAll } from './services/tool-installer';
import { startDownload, cancelDownload, submitAuthCode } from './services/download-service';
import { launchGame, findExecutables, isSteamInstalledInPrefix, installSteamInPrefix, launchSteamInPrefix, repairSteamInPrefix, shutdownSteamInPrefix, isSteamRunningInPrefix } from './services/wine-launcher';
import { saveCredentials, loadCredentials, clearCredentials } from './services/credential-store';
import { IPC } from '../shared/ipc-channels';
import type { AppSettings, WineConfig, WineBackend } from '../shared/types';

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
declare const MAIN_WINDOW_VITE_NAME: string;

let mainWindow: BrowserWindow | null = null;

// In-memory settings (persisted via electron-store when available)
let appSettings: AppSettings = {
  steamUsername: '',
  downloadDirectory: '',
  wineBackend: 'gptk',
};

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 680,
    minWidth: 800,
    minHeight: 500,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
    vibrancy: 'sidebar',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function sendToRenderer(channel: string, ...args: unknown[]) {
  mainWindow?.webContents.send(channel, ...args);
}

// --- IPC Handlers ---

function registerIpcHandlers() {
  const log = getLogger();

  // --- Search ---
  ipcMain.handle(IPC.SEARCH_GAMES, async (_event, query: string) => {
    log.info({ query }, 'Searching games');
    return searchGames(query);
  });

  // --- Depots ---
  ipcMain.handle(IPC.GET_DEPOTS, async (_event, appId: number) => {
    log.info({ appId }, 'Getting depots');
    const tools = await locateTools();
    return getDepots(appId, tools.steamcmdPath);
  });

  // --- Tools ---
  ipcMain.handle(IPC.LOCATE_TOOLS, async () => {
    log.info('Locating tools');
    return locateTools();
  });

  ipcMain.handle(IPC.INSTALL_TOOLS, async () => {
    log.info('Installing all tools');
    const currentStatus = await locateTools();
    try {
      const newStatus = await bootstrap(
        currentStatus,
        (step, percent) => sendToRenderer(IPC.INSTALL_PROGRESS, { step, percent }),
        (line) => sendToRenderer(IPC.INSTALL_LOG, { line }),
      );
      return { success: true, status: newStatus };
    } catch (err) {
      log.error({ err }, 'Tool installation failed');
      return { success: false, message: String(err) };
    }
  });

  ipcMain.handle(IPC.INSTALL_SINGLE_TOOL, async (_event, identifier: string) => {
    log.info({ identifier }, 'Installing single tool');
    try {
      const ok = await installSingleTool(
        identifier,
        (step, percent) => sendToRenderer(IPC.INSTALL_PROGRESS, { step, percent }),
        (line) => sendToRenderer(IPC.INSTALL_LOG, { line }),
      );
      const status = await locateTools();
      return { success: ok, status };
    } catch (err) {
      log.error({ err }, 'Single tool install failed');
      return { success: false, message: String(err) };
    }
  });

  ipcMain.handle(IPC.REINSTALL_ALL, async () => {
    log.info('Reinstalling all tools');
    try {
      const status = await reinstallAll(
        (step, percent) => sendToRenderer(IPC.INSTALL_PROGRESS, { step, percent }),
        (line) => sendToRenderer(IPC.INSTALL_LOG, { line }),
      );
      return { success: true, status };
    } catch (err) {
      log.error({ err }, 'Reinstall failed');
      return { success: false, message: String(err) };
    }
  });

  // --- Downloads ---
  ipcMain.handle(IPC.START_DOWNLOAD, async (_event, params: {
    taskId: string;
    appId: number;
    appName: string;
    depotId: string;
    username: string;
    password: string;
  }) => {
    const tools = await locateTools();
    if (!tools.depotDownloaderPath) {
      return { success: false, message: 'DepotDownloader not found. Install from Settings.' };
    }

    const outputDir = appSettings.downloadDirectory || getDefaultDownloadDir();
    log.info({ taskId: params.taskId, appId: params.appId }, 'Starting download');

    startDownload(
      params.taskId,
      params.appId,
      params.depotId,
      params.username,
      params.password,
      tools.depotDownloaderPath,
      outputDir,
      params.appName || `App_${params.appId}`,
      {
        onProgress: (percent) => sendToRenderer(IPC.DOWNLOAD_PROGRESS, { taskId: params.taskId, percent }),
        onLog: (line) => sendToRenderer(IPC.DOWNLOAD_LOG, { taskId: params.taskId, line }),
        onStatus: (status) => sendToRenderer(IPC.DOWNLOAD_STATUS, { taskId: params.taskId, status }),
        onAuthPrompt: (type) => sendToRenderer(IPC.DOWNLOAD_AUTH_PROMPT, { taskId: params.taskId, type }),
      },
    );

    return { success: true };
  });

  ipcMain.on(IPC.CANCEL_DOWNLOAD, (_event, taskId: string) => {
    cancelDownload(taskId);
  });

  ipcMain.handle(IPC.SUBMIT_AUTH_CODE, async (_event, params: { taskId: string; code: string }) => {
    submitAuthCode(params.taskId, params.code);
  });

  // --- Launch ---
  ipcMain.handle(IPC.LAUNCH_GAME, async (_event, params: {
    exePath: string;
    appId: number;
    wineConfig: WineConfig;
    onlineMode: boolean;
  }) => {
    log.info({ exePath: params.exePath, appId: params.appId, onlineMode: params.onlineMode }, 'Launching game');
    return launchGame(
      params.exePath,
      params.appId,
      params.wineConfig,
      appSettings.wineBackend,
      params.onlineMode,
    );
  });

  ipcMain.handle(IPC.FIND_EXECUTABLES, async (_event, gameDir: string) => {
    return findExecutables(gameDir);
  });

  ipcMain.handle(IPC.CHECK_STEAM_IN_PREFIX, async (_event, appId: number) => {
    const { getPrefixDir } = await import('./lib/paths');
    return isSteamInstalledInPrefix(getPrefixDir(appId));
  });

  ipcMain.handle(IPC.INSTALL_STEAM_IN_PREFIX, async (_event, appId: number) => {
    return installSteamInPrefix(appId, appSettings.wineBackend, (line) => {
      sendToRenderer(IPC.INSTALL_LOG, { line });
    });
  });

  ipcMain.handle(IPC.LAUNCH_STEAM_IN_PREFIX, async (_event, appId: number) => {
    return launchSteamInPrefix(appId, appSettings.wineBackend, (line) => {
      sendToRenderer(IPC.STEAM_LOG, { line });
    });
  });

  ipcMain.handle(IPC.REPAIR_STEAM_IN_PREFIX, async (_event, appId: number) => {
    return repairSteamInPrefix(appId, appSettings.wineBackend, (line) => {
      sendToRenderer(IPC.STEAM_LOG, { line });
    });
  });

  ipcMain.handle(IPC.SHUTDOWN_STEAM_IN_PREFIX, async (_event, appId: number) => {
    return shutdownSteamInPrefix(appId, appSettings.wineBackend);
  });

  ipcMain.handle(IPC.IS_STEAM_RUNNING, async (_event, appId: number) => {
    return isSteamRunningInPrefix(appId, appSettings.wineBackend);
  });

  // --- Settings ---
  ipcMain.handle(IPC.GET_ARCHITECTURE, () => {
    return getArchitecture();
  });

  ipcMain.handle(IPC.GET_SETTINGS, () => {
    if (!appSettings.downloadDirectory) {
      appSettings.downloadDirectory = getDefaultDownloadDir();
    }
    return appSettings;
  });

  ipcMain.handle(IPC.SET_SETTINGS, (_event, settings: AppSettings) => {
    appSettings = settings;
    log.info({ settings: { ...settings, steamPassword: undefined } }, 'Settings updated');
  });

  ipcMain.handle(IPC.PICK_DIRECTORY, async () => {
    if (!mainWindow) return null;
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory', 'createDirectory'],
    });
    return result.canceled ? null : result.filePaths[0];
  });

  ipcMain.handle(IPC.SCAN_DOWNLOADS, async () => {
    const dir = appSettings.downloadDirectory || getDefaultDownloadDir();
    if (!fs.existsSync(dir)) return [];
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const results: { appId: number; appName: string; directory: string }[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      // Match pattern: AppName_12345
      const match = entry.name.match(/^(.+)_(\d+)$/);
      if (!match) continue;
      results.push({
        appName: match[1],
        appId: parseInt(match[2], 10),
        directory: path.join(dir, entry.name),
      });
    }
    return results;
  });

  ipcMain.handle(IPC.REVEAL_IN_FINDER, async (_event, filePath: string) => {
    shell.showItemInFolder(filePath);
  });

  // --- Credentials ---
  ipcMain.handle(IPC.SAVE_CREDENTIALS, async (_event, params: { username: string; password: string }) => {
    saveCredentials(params.username, params.password);
  });

  ipcMain.handle(IPC.LOAD_CREDENTIALS, async () => {
    return loadCredentials();
  });

  ipcMain.handle(IPC.CLEAR_CREDENTIALS, async () => {
    clearCredentials();
  });

  // --- Debug mode (SMC_DEBUG=1) ---
  const debugEnabled = process.env.SMC_DEBUG === '1';

  ipcMain.handle(IPC.DEBUG_IS_ENABLED, () => debugEnabled);

  ipcMain.handle(IPC.DEBUG_EXEC, async (_event, command: string) => {
    if (!debugEnabled) return { error: 'Debug mode not enabled' };
    const { execSync } = require('node:child_process');
    try {
      const output = execSync(command, {
        encoding: 'utf-8',
        timeout: 30000,
        maxBuffer: 1024 * 1024 * 5,
        env: process.env,
      });
      return { output };
    } catch (err: any) {
      return { error: err.stderr || err.message || String(err), output: err.stdout || '' };
    }
  });

  ipcMain.handle(IPC.DEBUG_EVAL, async (_event, code: string) => {
    if (!debugEnabled) return { error: 'Debug mode not enabled' };
    try {
      const result = await eval(code);
      return { output: typeof result === 'string' ? result : JSON.stringify(result, null, 2) };
    } catch (err: any) {
      return { error: err.message || String(err) };
    }
  });
}

// --- App Lifecycle ---

app.whenReady().then(() => {
  const log = getLogger();
  log.info('App starting');

  registerIpcHandlers();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  app.quit();
});

// Shut down wineservers for our managed prefixes on exit
app.on('will-quit', () => {
  const { execFileSync } = require('node:child_process');
  const prefixesDir = path.join(app.getPath('appData'), 'SteamMacClient', 'Prefixes');
  if (!fs.existsSync(prefixesDir)) return;

  // Find all Wine binaries we might have used
  const wineBinaries = [
    path.join(app.getPath('appData'), 'SteamMacClient', 'WineCrossover', 'Wine Crossover.app', 'Contents', 'Resources', 'wine', 'bin', 'wineserver'),
    path.join(app.getPath('appData'), 'SteamMacClient', 'WineStaging', 'Wine Staging.app', 'Contents', 'Resources', 'wine', 'bin', 'wineserver'),
  ];

  for (const wineserver of wineBinaries) {
    if (!fs.existsSync(wineserver)) continue;
    // List prefix directories and shut down each wineserver
    try {
      const entries = fs.readdirSync(prefixesDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const prefix = path.join(prefixesDir, entry.name);
        try {
          execFileSync(wineserver, ['-k'], {
            stdio: 'ignore',
            env: { ...process.env, WINEPREFIX: prefix },
            timeout: 5000,
          });
        } catch {}
      }
    } catch {}
  }
});
