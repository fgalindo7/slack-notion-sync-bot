/**
 * @fileoverview Node.js environment checker
 * @author Francisco Galindo
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { HealthChecker } from '../health-checker.mjs';
import icons from '../../ascii-icons.js';

const execAsync = promisify(exec);

/**
 * Node.js environment health checker
 */
export class NodeCheck extends HealthChecker {
  constructor(config = {}) {
    super('Node.js', config);
  }

  async check() {
    try {
      const { stdout: nodev } = await execAsync('node -v');
      const { stdout: npmv } = await execAsync('npm -v');

      const { stdout: ls } = await execAsync('npm ls --depth=0 --json');
      const deps = JSON.parse(ls);
      const depsOk = deps && !deps.errors;

      return {
        status: depsOk ? 'ok' : 'warn',
        data: {
          nodeVersion: nodev.trim(),
          npmVersion: npmv.trim(),
          depsOk,
        },
        error: null,
      };
    } catch (err) {
      return {
        status: 'error',
        data: null,
        error: err.message,
      };
    }
  }

  isApplicable(target) {
    return target === 'local'; // Node check only for local
  }

  getIcon() {
    return icons.emojiNode;
  }
}

export default NodeCheck;
