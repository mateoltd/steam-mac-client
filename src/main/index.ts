import { app, BrowserWindow, ipcMain, shell, dialog, safeStorage } from 'electron';
import path from 'node:path';
import { getLogger } from './lib/logger';
import { getArchitecture } from './lib/platform';
import { getDefaultDownloadDir } from './lib/paths';
import { searchGames } from './services/steam-store-api';
import { getDepots } from './services/depot-info';
import { locateTools } from './services/tool-locator';
import { bootstrap, installSingleTool, reinstallAll } from './services/tool-installer';
import { startDownload, cancelDownload, submitAuthCode } from './services/download-service';
import { launchGame, findExecutables, isSteamInstalledInPrefix, installSteamInPrefix, launchSteamInPrefix, repairSteamInPrefix } from './services/wine-launcher';
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
  }) => {
    log.info({ exePath: params.exePath, appId: params.appId }, 'Launching game');
    return launchGame(
      params.exePath,
      params.appId,
      params.wineConfig,
      appSettings.wineBackend,
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
      sendToRenderer(IPC.INSTALL_LOG, { line });
    });
  });

  ipcMain.handle(IPC.REPAIR_STEAM_IN_PREFIX, async (_event, appId: number) => {
    return repairSteamInPrefix(appId, appSettings.wineBackend, (line) => {
      sendToRenderer(IPC.INSTALL_LOG, { line });
    });
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

  ipcMain.handle(IPC.REVEAL_IN_FINDER, async (_event, filePath: string) => {
    shell.showItemInFolder(filePath);
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
