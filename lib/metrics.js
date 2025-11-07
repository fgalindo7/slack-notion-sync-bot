/**
 * Bot metrics tracking and reporting
 * Encapsulates all metrics state and calculations
 */

export class BotMetrics {
  #data = {
    messagesProcessed: 0,
    messagesCreated: 0,
    messagesUpdated: 0,
    messagesFailed: 0,
    validationErrors: 0,
    apiTimeouts: 0,
    startTime: Date.now()
  };

  /**
   * Increments a specific metric counter
   * @param {string} metric - The metric name to increment
   */
  increment(metric) {
    if (metric in this.#data && typeof this.#data[metric] === 'number') {
      this.#data[metric]++;
    }
  }

  /**
   * Gets the current value of a specific metric
   * @param {string} metric - The metric name
   * @returns {number} The metric value
   */
  get(metric) {
    return this.#data[metric];
  }

  /**
   * Calculates the success rate as a percentage
   * @returns {string} Success rate as percentage string (e.g., "95.50%")
   */
  getSuccessRate() {
    if (this.#data.messagesProcessed === 0) {
      return '0';
    }
    const rate = ((this.#data.messagesProcessed - this.#data.messagesFailed) 
      / this.#data.messagesProcessed * 100).toFixed(2);
    return rate;
  }

  /**
   * Gets uptime in seconds
   * @returns {number} Seconds since metrics started
   */
  getUptimeSeconds() {
    return Math.floor((Date.now() - this.#data.startTime) / 1000);
  }

  /**
   * Returns a JSON-serializable object of all metrics
   * @returns {Object} All metrics data
   */
  toJSON() {
    return {
      ...this.#data,
      uptimeSeconds: this.getUptimeSeconds(),
      successRate: `${this.getSuccessRate()}%`
    };
  }

  /**
   * Returns metrics data without computed fields
   * @returns {Object} Raw metrics data
   */
  getRawData() {
    return { ...this.#data };
  }
}
