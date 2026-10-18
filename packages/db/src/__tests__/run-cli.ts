import { spawn } from 'node:child_process';

export interface CliResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

/**
 * Run a CLI without blocking the event loop. spawnSync froze the worker for the whole run,
 * so back-to-back CLI tests starved vitest's worker RPC ("Timeout calling onTaskUpdate").
 */
export function runCli(command: string, args: string[], cwd: string): Promise<CliResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', (status) => {
      resolve({ status, stdout, stderr });
    });
  });
}
