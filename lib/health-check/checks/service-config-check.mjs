/**
 * @fileoverview Service Configuration checker (required files)
 * @author Francisco Galindo
 */

import { existsSync } from 'fs';
import { join } from 'path';
import { HealthChecker } from '../health-checker.mjs';
import icons from '../../ascii-icons.js';

/**
 * Service Configuration health checker
 * Checks for required files
 */
export class ServiceConfigurationCheck extends HealthChecker {
  constructor(config = {}) {
    super('Service Configuration', config);
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
    return target === 'local'; // Service Configuration check only for local
  }

  getIcon() {
    return icons.configs;
  }
}

export default ServiceConfigurationCheck;
