import path from 'node:path';
import fs from 'node:fs';
import { spawnInteractive, type InteractiveProcess } from './process-runner';
import { getLogger } from '../lib/logger';
import type { DownloadStatus, SteamPromptType } from '../../shared/types';

export interface DownloadCallbacks {
  onProgress: (percent: number) => void;
  onLog: (line: string) => void;
  onStatus: (status: DownloadStatus) => void;
  onAuthPrompt: (type: SteamPromptType) => void;
}

interface ActiveDownload {
  handle: InteractiveProcess;
  callbacks: DownloadCallbacks;
}

const activeDownloads = new Map<string, ActiveDownload>();

export function submitAuthCode(taskId: string, code: string): void {
  const dl = activeDownloads.get(taskId);
  if (dl) {
    dl.handle.writeLine(code);
    getLogger().info({ taskId }, 'Auth code submitted');
  }
}

export function cancelDownload(taskId: string): void {
  const dl = activeDownloads.get(taskId);
  if (dl) {
    dl.handle.terminate();
    dl.callbacks.onStatus({ type: 'cancelled' });
    activeDownloads.delete(taskId);
    getLogger().info({ taskId }, 'Download cancelled');
  }
}

export async function startDownload(
  taskId: string,
  appId: number,
  depotId: string,
  username: string,
  password: string,
  depotDownloaderPath: string,
  outputDir: string,
  appName: string,
  callbacks: DownloadCallbacks,
): Promise<void> {
  const log = getLogger();

  if (!username) { callbacks.onStatus({ type: 'failed', message: 'Steam username is required.' }); return; }
  if (!password) { callbacks.onStatus({ type: 'failed', message: 'Steam password is required.' }); return; }

  callbacks.onStatus({ type: 'authenticating' });

  const gameDir = path.join(outputDir, `${appName}_${appId}`);
  fs.mkdirSync(gameDir, { recursive: true });

  const args = [
    '-app', String(appId),
    '-depot', depotId,
    '-os', 'windows',
    '-username', username,
    '-password', password,
    '-remember-password',
    '-dir', gameDir,
  ];

  log.info({ taskId, appId, depotId }, 'Starting download');

  let authError: string | null = null;
  let authSuccess = false;
  let activePromptType: SteamPromptType | null = null;

  const { handle, done } = spawnInteractive(depotDownloaderPath, args, {
    onStdoutLine: (line) => {
      callbacks.onLog(line);
      handleOutputLine(line, taskId, callbacks, {
        setAuthError: (msg) => { authError = msg; },
        setAuthSuccess: () => { authSuccess = true; },
        setActivePrompt: (type) => { activePromptType = type; },
      });
    },
    onStderrLine: (line) => {
      callbacks.onLog(`[stderr] ${line}`);
      handleOutputLine(line, taskId, callbacks, {
        setAuthError: (msg) => { authError = msg; },
        setAuthSuccess: () => { authSuccess = true; },
        setActivePrompt: (type) => { activePromptType = type; },
      });
    },
  });

  activeDownloads.set(taskId, { handle, callbacks });

  const exitCode = await done;
  activeDownloads.delete(taskId);

  log.info({ taskId, exitCode, authError, authSuccess }, 'Download process exited');

  if (authError) {
    callbacks.onStatus({ type: 'failed', message: authError });
  } else if (exitCode === 0) {
    callbacks.onStatus({ type: 'completed', outputDirectory: gameDir });
    callbacks.onProgress(100);
  } else {
    const msg = parseExitError(authError, exitCode);
    callbacks.onStatus({ type: 'failed', message: msg });
  }
}

// --- stdout parsing state machine ---

interface ParseState {
  setAuthError: (msg: string) => void;
  setAuthSuccess: () => void;
  setActivePrompt: (type: SteamPromptType) => void;
}

function handleOutputLine(
  line: string,
  taskId: string,
  callbacks: DownloadCallbacks,
  state: ParseState,
): void {
  const lower = line.toLowerCase();

  // Auth success
  if (lower.includes('logged in') || lower.includes('got session token')) {
    state.setAuthSuccess();
  }

  // Auth failures
  if (lower.includes('invalidpassword') || lower.includes('invalid password')) {
    state.setAuthError('Invalid username or password. Check your credentials in Settings.');
    callbacks.onStatus({ type: 'failed', message: 'Invalid username or password.' });
  }
  if (lower.includes('ratelimitexceeded') || lower.includes('rate limit')) {
    state.setAuthError('Too many login attempts. Wait a few minutes and try again.');
    callbacks.onStatus({ type: 'failed', message: 'Rate limited. Wait a few minutes.' });
  }
  if (lower.includes('invalidloginauthtickettwofa') || lower.includes('account not found')) {
    state.setAuthError('Steam account not found.');
  }
  if (lower.includes('failed to authenticate') || lower.includes('unable to get steam3 credentials')) {
    const reasonMatch = line.match(/result\s+(.*)/i);
    const reason = reasonMatch ? reasonMatch[1].trim() : 'Check your credentials.';
    state.setAuthError(`Authentication failed: ${reason}`);
  }

  // 2FA / Email / SMS prompt detection
  if (lower.includes('steam guard') && !lower.includes('auth code') && !lower.includes('email')) {
    state.setActivePrompt('twoFactorAuth');
    callbacks.onAuthPrompt('twoFactorAuth');
  }
  if (lower.includes('2 factor auth') || lower.includes('two factor') || lower.includes('twofactor')) {
    state.setActivePrompt('twoFactorAuth');
    callbacks.onAuthPrompt('twoFactorAuth');
  }
  if (lower.includes('sms code')) {
    state.setActivePrompt('smsCode');
    callbacks.onAuthPrompt('smsCode');
  }
  if (lower.includes('check your email') || (lower.includes('auth code') && lower.includes('email'))) {
    state.setActivePrompt('emailCode');
    callbacks.onAuthPrompt('emailCode');
  }
  // Generic fallback
  if (lower.includes('please enter') && lower.includes('code')) {
    state.setActivePrompt('twoFactorAuth');
    callbacks.onAuthPrompt('twoFactorAuth');
  }

  // Download progress
  if (lower.includes('downloading depot') || lower.includes('downloading chunk')) {
    callbacks.onStatus({ type: 'downloading' });
  }

  // Progress percentage
  const pctMatch = line.match(/(\d+\.?\d*)%/);
  if (pctMatch) {
    const pct = parseFloat(pctMatch[1]);
    if (!isNaN(pct)) callbacks.onProgress(pct);
  }

  // Download complete
  if (lower.includes('total downloaded') || lower.includes('depot downloaded')) {
    callbacks.onProgress(100);
  }

  // Steam init error
  if (lower.includes('error') && lower.includes('initializesteam')) {
    state.setAuthError('Steam initialization failed. Check credentials and try again.');
  }
}

function parseExitError(authError: string | null, exitCode: number): string {
  if (authError) return authError;
  return `Download failed (exit code ${exitCode}). Check the log for details.`;
}
