/**
 * Notion schema caching with automatic TTL-based refresh
 * Reduces API calls by caching schema with time-to-live
 */

export class NotionSchemaCache {
  #schema = null;
  #lastLoaded = 0;
  #ttl;
  #logger;

  /**
   * Creates a new schema cache
   * @param {Object} options - Configuration options
   * @param {number} [options.ttl=3600000] - Time to live in milliseconds (default: 1 hour)
   * @param {Object} [options.logger] - Logger instance with debug/info methods
   */
  constructor({ ttl = 3600000, logger = console } = {}) {
    this.#ttl = ttl;
    this.#logger = logger;
  }

  /**
   * Checks if the cached schema has expired
   * @returns {boolean} True if cache is expired or empty
   */
  isExpired() {
    if (!this.#schema) {
      return true;
    }
    return (Date.now() - this.#lastLoaded) > this.#ttl;
  }

  /**
   * Gets the cached schema, refreshing if expired
   * @param {Function} fetchFn - Async function to fetch fresh schema
   * @param {boolean} [force=false] - Force refresh even if not expired
   * @returns {Promise<Object>} The schema object
   */
  async get(fetchFn, force = false) {
    if (force || this.isExpired()) {
      await this.refresh(fetchFn, force);
    }
    return this.#schema;
  }

  /**
   * Refreshes the schema cache
   * @param {Function} fetchFn - Async function to fetch fresh schema
   * @param {boolean} [forced=false] - Whether this is a forced refresh
   */
  async refresh(fetchFn, forced = false) {
    const startTime = Date.now();
    this.#schema = await fetchFn();
    this.#lastLoaded = Date.now();
    
    const loadTime = Date.now() - startTime;
    this.#logger.info?.({
      propertyCount: Object.keys(this.#schema || {}).length,
      cacheTtl: this.#ttl,
      loadTime,
      forced
    }, 'Schema loaded and cached');
  }

  /**
   * Gets the current schema without refreshing
   * @returns {Object|null} Cached schema or null if not loaded
   */
  getCurrent() {
    return this.#schema;
  }

  /**
   * Clears the cached schema
   */
  clear() {
    this.#schema = null;
    this.#lastLoaded = 0;
  }

  /**
   * Gets cache statistics
   * @returns {Object} Cache stats including age and TTL
   */
  getStats() {
    return {
      hasSchema: !!this.#schema,
      age: this.#schema ? Date.now() - this.#lastLoaded : null,
      ttl: this.#ttl,
      isExpired: this.isExpired()
    };
  }
}
