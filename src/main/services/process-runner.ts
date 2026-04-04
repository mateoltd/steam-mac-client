import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import { createInterface } from 'node:readline';

export interface ProcessResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface InteractiveProcess {
  process: ChildProcess;
  writeLine: (text: string) => void;
  terminate: () => void;
}

/**
 * Run a process and collect output. Optionally stream lines via callbacks.
 */
export async function runProcess(
  executable: string,
  args: string[],
  options?: {
    env?: Record<string, string>;
    onStdoutLine?: (line: string) => void;
    onStderrLine?: (line: string) => void;
  }
): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const env = options?.env
      ? { ...process.env, ...options.env }
      : process.env;

    const proc = spawn(executable, args, {
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    if (proc.stdout) {
      const rl = createInterface({ input: proc.stdout });
      rl.on('line', (line) => {
        stdout += line + '\n';
        options?.onStdoutLine?.(line);
      });
    }

    if (proc.stderr) {
      const rl = createInterface({ input: proc.stderr });
      rl.on('line', (line) => {
        stderr += line + '\n';
        options?.onStderrLine?.(line);
      });
    }

    proc.on('error', reject);
    proc.on('close', (code) => {
      resolve({ exitCode: code ?? 1, stdout, stderr });
    });
  });
}

/**
 * Spawn an interactive process with stdin access for 2FA prompts etc.
 * Returns a handle to write to stdin and listen to output.
 */
export function spawnInteractive(
  executable: string,
  args: string[],
  options?: {
    env?: Record<string, string>;
    onStdoutLine?: (line: string) => void;
    onStderrLine?: (line: string) => void;
  }
): { handle: InteractiveProcess; done: Promise<number> } {
  const env = options?.env
    ? { ...process.env, ...options.env }
    : process.env;

  const proc = spawn(executable, args, {
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  if (proc.stdout) {
    const rl = createInterface({ input: proc.stdout });
    rl.on('line', (line) => options?.onStdoutLine?.(line));
  }

  if (proc.stderr) {
    const rl = createInterface({ input: proc.stderr });
    rl.on('line', (line) => options?.onStderrLine?.(line));
  }

  const handle: InteractiveProcess = {
    process: proc,
    writeLine: (text: string) => {
      proc.stdin?.write(text + '\n');
    },
    terminate: () => {
      if (!proc.killed) proc.kill();
    },
  };

  const done = new Promise<number>((resolve) => {
    proc.on('close', (code) => resolve(code ?? 1));
    proc.on('error', () => resolve(1));
  });

  return { handle, done };
}
