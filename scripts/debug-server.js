#!/usr/bin/env node
/**
 * Debug relay server — run this on YOUR machine.
 *
 * Usage:
 *   node scripts/debug-server.js [port]
 *
 * For remote debugging (different network):
 *   1. node scripts/debug-server.js
 *   2. ngrok http 9999
 *   3. Build with: SMC_DEBUG_URL=wss://<ngrok-url> npx electron-forge make --arch=x64
 *
 * You'll get an interactive shell on their machine.
 * Type commands, see output. Type "exit" to disconnect.
 * Prefix with "js:" to eval JS in the Electron main process.
 */

const http = require('http');
const { WebSocketServer } = require('ws');
const readline = require('readline');

const port = parseInt(process.argv[2] || '9999', 10);

const server = http.createServer((_req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('debug-server ok');
});

const wss = new WebSocketServer({ server });

server.listen(port, () => {
  console.log(`\x1b[33m[debug-server]\x1b[0m Listening on port ${port}`);
  console.log(`\x1b[33m[debug-server]\x1b[0m Waiting for connection...\n`);
});

let activeSocket = null;
let rl = null;

function startPrompt(ws) {
  activeSocket = ws;
  rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  const prompt = () => {
    rl.question('\x1b[32mremote$\x1b[0m ', (line) => {
      if (!line.trim()) return prompt();
      if (line.trim() === 'exit') {
        console.log('\x1b[33m[debug-server]\x1b[0m Disconnecting.');
        ws.close();
        return;
      }

      const msg = line.startsWith('js:')
        ? { type: 'eval', code: line.slice(3).trim() }
        : { type: 'exec', command: line };

      ws.send(JSON.stringify(msg));
    });
  };

  prompt();
}

wss.on('connection', (ws, req) => {
  const ip = req.socket.remoteAddress;
  console.log(`\x1b[32m[debug-server]\x1b[0m Connected: ${ip}`);
  console.log(`\x1b[32m[debug-server]\x1b[0m Shell ready. Type commands. Prefix "js:" for JS eval. "exit" to quit.\n`);

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());
      if (msg.output) {
        process.stdout.write(msg.output);
        if (!msg.output.endsWith('\n')) process.stdout.write('\n');
      }
      if (msg.error) {
        process.stderr.write(`\x1b[31m${msg.error}\x1b[0m\n`);
      }
    } catch {
      process.stdout.write(data.toString());
    }
  });

  ws.on('close', () => {
    console.log(`\n\x1b[33m[debug-server]\x1b[0m Disconnected.`);
    if (rl) rl.close();
    activeSocket = null;
    console.log(`\x1b[33m[debug-server]\x1b[0m Waiting for new connection...\n`);
  });

  ws.on('error', (err) => {
    console.error(`\x1b[31m[debug-server]\x1b[0m Error: ${err.message}\x1b[0m`);
  });

  startPrompt(ws);
});
