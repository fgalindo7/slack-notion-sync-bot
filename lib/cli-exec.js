// Unified exec wrapper with DRY_RUN support
import { exec } from 'child_process';
import { promisify } from 'util';
import { logger } from './cli-logger.js';

const execAsync = promisify(exec);

export async function run(cmd, { _capture = true, dryRun = false } = {}) {
  if (dryRun) {
    logger.info(`[dry-run] ${cmd}`);
    return { stdout: '', stderr: '', exitCode: 0, dryRun: true, command: cmd };
  }
  try {
    const { stdout, stderr } = await execAsync(cmd, { env: process.env });
    return { stdout, stderr, exitCode: 0, command: cmd };
  } catch (err) {
    return { stdout: err.stdout || '', stderr: err.stderr || err.message, exitCode: err.code || 1, command: cmd, error: err };
  }
}

export async function runRequired(cmd, opts = {}) {
  const res = await run(cmd, opts);
  if (res.exitCode !== 0) {
    throw new Error(`Command failed (${res.exitCode}): ${cmd}\n${res.stderr}`);
  }
  return res;
}
