import pino from 'pino';
import path from 'node:path';
import fs from 'node:fs';
import { app } from 'electron';

function getLogDir(): string {
  const logDir = path.join(app.getPath('home'), 'Library', 'Logs', 'SteamMacClient');
  fs.mkdirSync(logDir, { recursive: true });
  return logDir;
}

let logger: pino.Logger;

export function getLogger(): pino.Logger {
  if (!logger) {
    const logDir = getLogDir();
    const logFile = path.join(logDir, 'app.log');

    // Write to both stdout and log file using multistream (no worker threads)
    const fileStream = fs.createWriteStream(logFile, { flags: 'a' });
    const streams: pino.StreamEntry[] = [
      { level: 'debug', stream: process.stdout },
      { level: 'debug', stream: fileStream },
    ];

    logger = pino({ level: 'debug' }, pino.multistream(streams));
  }
  return logger;
}
