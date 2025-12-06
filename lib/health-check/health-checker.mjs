/**
 * @fileoverview Base class for all health checkers
 * @author Francisco Galindo
 */

/**
 * Base class for health checkers
 * All concrete checkers should extend this class
 */
export class HealthChecker {
  /**
   * @param {string} name - Display name for this checker
   * @param {object} config - Configuration object
   */
  constructor(name, config = {}) {
    this.name = name;
    this.config = config;
  }

  /**
   * Perform the health check
   * @returns {Promise<CheckResult>} Result object
   * @typedef {Object} CheckResult
   * @property {'ok'|'warn'|'error'} status - Check status
   * @property {object} data - Check-specific data
   * @property {string|null} error - Error message if failed
   */
  async check() {
    throw new Error(`${this.name}: Must implement check() method`);
  }

  /**
   * Determine if this check applies to the given target
   * @param {string} target - Target environment (local, gcp, staging, prod)
   * @returns {boolean} True if check should run
   */
  isApplicable(_target) {
    return true; // By default, run for all targets
  }

  /**
   * Get section icon for display
   * @returns {string} Icon string
   */
  getIcon() {
    return '[?]';
  }
}

export default HealthChecker;
