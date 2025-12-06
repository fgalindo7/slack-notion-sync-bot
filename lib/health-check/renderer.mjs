/**
 * @fileoverview Base class for health check renderers
 * @author Francisco Galindo
 */

/**
 * Base class for renderers
 * All concrete renderers should extend this class
 */
export class Renderer {
  /**
   * @param {object} config - Configuration object
   * @param {object} flags - CLI flags
   */
  constructor(config = {}, flags = {}) {
    this.config = config;
    this.flags = flags;
  }

  /**
   * Render the health check results
   * @param {Array<CheckResult>} results - Array of check results
   * @returns {Promise<void>}
   * @typedef {Object} CheckResult
   * @property {string} checker - Checker name
   * @property {'ok'|'warn'|'error'} status - Check status
   * @property {object} data - Check-specific data
   * @property {string|null} error - Error message if failed
   * @property {string} icon - Display icon
   */
  async render(_results) {
    throw new Error('Must implement render() method');
  }

  /**
   * Clear the display (if applicable)
   */
  clear() {
    // No-op by default
  }
}

export default Renderer;
