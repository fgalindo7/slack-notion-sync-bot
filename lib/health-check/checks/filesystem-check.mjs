/**
 * @fileoverview Filesystem checker (required files)
 * @author Francisco Galindo
 */

import { existsSync } from 'fs';
import { join } from 'path';
import { HealthChecker } from '../health-checker.mjs';
import icons from '../../ascii-icons.js';

/**
 * Filesystem health checker
 * Checks for required files
 */
export class FilesystemCheck extends HealthChecker {
  constructor(config = {}) {
    super('Filesystem', config);
  }

  async check() {
    try {
      const files = ['channel-mappings.json', '.env'];
      const results = {};
      let allOk = true;

      for (const f of files) {
        const exists = existsSync(join(process.cwd(), f));
        results[f] = exists;
        if (!exists) {
          allOk = false;
        }
      }

      return {
        status: allOk ? 'ok' : 'warn',
        data: {
          files: results,
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
    return target === 'local'; // Filesystem check only for local
  }

  getIcon() {
    return icons.filesystem;
  }
}

export default FilesystemCheck;
