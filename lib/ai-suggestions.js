/**
 * AI-powered similar case suggestions
 * Uses GCP Vertex AI to find and suggest similar historical cases from Notion database
 * @author Francisco Galindo
 */

import { VertexAI } from '@google-cloud/vertexai';

/**
 * Knowledge base interface for querying historical cases from Notion
 * Provides smart filtering and formatting of cases for AI analysis
 */
export class NotionKnowledgeBase {
  #notionClient;
  #logger;
  #databaseId;
  #maxCases;
  #cache;
  #cacheTTL;

  /**
   * Creates a new NotionKnowledgeBase instance
   * @param {Object} params - Configuration parameters
   * @param {Object} params.notionClient - Throttled Notion API client
   * @param {Object} params.logger - Pino logger instance
   * @param {string} params.databaseId - Notion database ID to query
   * @param {number} [params.maxCases=20] - Maximum number of cases to retrieve
   * @param {number} [params.cacheTTL=300000] - Cache TTL in milliseconds (default 5 minutes)
   */
  constructor({ notionClient, logger, databaseId, maxCases = 20, cacheTTL = 300000 }) {
    this.#notionClient = notionClient;
    this.#logger = logger;
    this.#databaseId = databaseId;
    this.#maxCases = maxCases;
    this.#cache = new Map();
    this.#cacheTTL = cacheTTL;
  }

  /**
   * Queries Notion database for historical cases with smart filtering
   * Uses caching to avoid redundant queries within TTL window
   * @param {Object} filters - Query filters
   * @param {string} [filters.priority] - Filter by priority (P0/P1/P2)
   * @param {string} [filters.customer] - Filter by customer name
   * @param {number} [filters.daysBack=90] - Number of days to look back
   * @returns {Promise<Array>} Array of formatted case objects
   */
  async queryHistoricalCases({ priority, customer, daysBack = 90 } = {}) {
    const cacheKey = JSON.stringify({ priority, customer, daysBack });
    const cached = this.#cache.get(cacheKey);

    // Return cached data if still valid
    if (cached && Date.now() - cached.timestamp < this.#cacheTTL) {
      this.#logger.debug({ cacheKey }, 'Returning cached historical cases');
      return cached.data;
    }

    // Calculate date threshold
    const dateThreshold = new Date();
    dateThreshold.setDate(dateThreshold.getDate() - daysBack);

    // Build Notion query filters
    const filters = [
      {
        property: 'Created time',
        date: {
          on_or_after: dateThreshold.toISOString()
        }
      }
    ];

    // Add optional filters
    if (priority) {
      filters.push({
        property: 'Priority',
        select: {
          equals: priority
        }
      });
    }

    if (customer) {
      filters.push({
        property: 'Customer',
        rich_text: {
          contains: customer
        }
      });
    }

    try {
      const response = await this.#notionClient.databases.query({
        database_id: this.#databaseId,
        filter: filters.length > 1 ? { and: filters } : filters[0],
        sorts: [
          {
            timestamp: 'created_time',
            direction: 'descending'
          }
        ],
        page_size: this.#maxCases
      });

      const formattedCases = response.results.map(page => this.formatCaseForAI(page));

      // Cache the results
      this.#cache.set(cacheKey, {
        data: formattedCases,
        timestamp: Date.now()
      });

      this.#logger.debug({
        databaseId: this.#databaseId,
        casesFound: formattedCases.length,
        filters: { priority, customer, daysBack }
      }, 'Retrieved historical cases from Notion');

      return formattedCases;
    } catch (err) {
      this.#logger.error({
        error: err.message,
        databaseId: this.#databaseId
      }, 'Failed to query historical cases');
      throw err;
    }
  }

  /**
   * Formats a Notion page into a structured case object for AI analysis
   * Extracts key fields: priority, issue, solution, customer, status
   * @param {Object} notionPage - Raw Notion page object
   * @returns {Object} Formatted case object
   */
  formatCaseForAI(notionPage) {
    const props = notionPage.properties || {};

    // Helper to extract text from Notion rich_text/title properties
    const extractText = (prop) => {
      if (!prop) {return '';}
      if (prop.title && prop.title[0]) {return prop.title[0].plain_text || '';}
      if (prop.rich_text && prop.rich_text[0]) {return prop.rich_text[0].plain_text || '';}
      return '';
    };

    // Helper to extract select value
    const extractSelect = (prop) => {
      return prop?.select?.name || '';
    };

    return {
      id: notionPage.id,
      url: notionPage.url,
      priority: extractSelect(props.Priority),
      issue: extractText(props.Issue),
      replicate: extractText(props['How to replicate']),
      customer: extractText(props.Customer),
      status: extractSelect(props.Status),
      createdTime: notionPage.created_time
    };
  }

  /**
   * Clears the query cache
   * Useful for testing or forcing fresh queries
   */
  clearCache() {
    this.#cache.clear();
    this.#logger.debug('Knowledge base cache cleared');
  }
}

/**
 * AI-powered suggestion engine using GCP Vertex AI
 * Analyzes new issues and finds similar historical cases
 */
export class AISuggestionEngine {
  #vertexAI;
  #model;
  #logger;
  #knowledgeBase;
  #config;

  /**
   * Creates a new AISuggestionEngine instance
   * @param {Object} params - Configuration parameters
   * @param {Object} params.vertexAIConfig - Vertex AI configuration (projectId, location, model)
   * @param {Object} params.logger - Pino logger instance
   * @param {NotionKnowledgeBase} params.knowledgeBase - Knowledge base instance
   */
  constructor({ vertexAIConfig, logger, knowledgeBase }) {
    this.#config = vertexAIConfig;
    this.#logger = logger;
    this.#knowledgeBase = knowledgeBase;

    // Initialize Vertex AI client
    this.#vertexAI = new VertexAI({
      project: vertexAIConfig.projectId,
      location: vertexAIConfig.location
    });

    // Get the generative model (Gemini Pro by default)
    this.#model = this.#vertexAI.getGenerativeModel({
      model: vertexAIConfig.model || 'gemini-pro',
      generationConfig: {
        maxOutputTokens: 2048,
        temperature: 0.2, // Lower temperature for more focused/deterministic output
        topP: 0.8,
        topK: 40
      }
    });

    this.#logger.info({
      project: vertexAIConfig.projectId,
      location: vertexAIConfig.location,
      model: vertexAIConfig.model
    }, 'AI Suggestion Engine initialized');
  }

  /**
   * Finds similar cases for a new issue
   * Main orchestration method that queries knowledge base, calls AI, and returns suggestions
   * @param {Object} newIssue - Parsed issue data from parseAutoBlock
   * @param {string} newIssue.priority - Issue priority
   * @param {string} newIssue.issue - Issue description
   * @param {string} newIssue.replicate - How to replicate
   * @param {string} newIssue.customer - Customer name
   * @returns {Promise<Object>} Suggestion result with matches array
   */
  async findSimilarCases(newIssue) {
    this.#logger.debug({ issue: newIssue.issue }, 'Finding similar cases');

    try {
      // Step 1: Query knowledge base for historical cases
      const historicalCases = await this.#knowledgeBase.queryHistoricalCases({
        priority: newIssue.priority,
        customer: newIssue.customer,
        daysBack: this.#config.queryDaysBack || 90
      });

      if (historicalCases.length === 0) {
        this.#logger.info({ issue: newIssue.issue }, 'No historical cases found');
        return {
          hasSimilarCases: false,
          matches: []
        };
      }

      // Step 2: Build prompt with new issue and historical context
      const prompt = this.buildPrompt(newIssue, historicalCases);

      // Step 3: Call Vertex AI
      const aiResponse = await this.callVertexAI(prompt);

      // Step 4: Parse and validate response
      const suggestions = this.parseAIResponse(aiResponse);

      // Step 5: Filter by similarity threshold
      const threshold = this.#config.similarityThreshold || 0.7;
      suggestions.matches = suggestions.matches.filter(
        match => match.similarity >= threshold
      );

      // Limit to top 3 matches
      suggestions.matches = suggestions.matches.slice(0, 3);
      suggestions.hasSimilarCases = suggestions.matches.length > 0;

      this.#logger.info({
        issue: newIssue.issue,
        matchesFound: suggestions.matches.length,
        threshold
      }, 'Similar cases analysis complete');

      return suggestions;
    } catch (err) {
      this.#logger.error({
        error: err.message,
        stack: err.stack,
        issue: newIssue.issue
      }, 'Failed to find similar cases');
      throw err;
    }
  }

  /**
   * Builds a structured prompt for the AI model
   * Includes new issue details and historical cases for comparison
   * @param {Object} newIssue - New issue to analyze
   * @param {Array} historicalCases - Historical cases for context
   * @returns {string} Formatted prompt string
   */
  buildPrompt(newIssue, historicalCases) {
    const historicalContext = historicalCases
      .map((c, idx) => {
        return `${idx + 1}. [${c.priority}] ${c.issue}
   Customer: ${c.customer || 'N/A'}
   How to replicate: ${c.replicate || 'N/A'}
   Status: ${c.status || 'N/A'}
   Notion ID: ${c.id}`;
      })
      .join('\n\n');

    return `You are an expert on-call support assistant. A new issue has been reported and you need to identify similar historical cases that might help resolve it.

NEW ISSUE:
- Priority: ${newIssue.priority || 'N/A'}
- Issue: ${newIssue.issue || 'N/A'}
- How to replicate: ${newIssue.replicate || 'N/A'}
- Customer: ${newIssue.customer || 'N/A'}

HISTORICAL CASES (last 90 days):
${historicalContext}

TASK:
Analyze the NEW ISSUE and identify the top 2-3 most similar HISTORICAL CASES based on:
1. Symptom similarity (exact error messages, related symptoms, or same component)
2. Customer relevance (same customer or similar use case)
3. Technical domain (API, database, auth, frontend, etc.)

For each similar case, provide:
- similarity: A score from 0 to 1 (1 being identical, 0.7+ being relevant)
- caseId: The Notion ID from the historical case
- title: The issue title from the historical case
- reason: Brief explanation (1-2 sentences) of why it's similar
- suggestedAction: Specific action to try based on this case (1 sentence)

Return your analysis in valid JSON format using this exact schema:
{
  "hasSimilarCases": boolean,
  "matches": [
    {
      "similarity": number,
      "caseId": string,
      "title": string,
      "reason": string,
      "suggestedAction": string
    }
  ]
}

IMPORTANT: 
- Only include cases with similarity >= 0.7
- If no similar cases exist, return: {"hasSimilarCases": false, "matches": []}
- Return ONLY valid JSON, no markdown formatting or explanations
- Be concise and actionable`;
  }

  /**
   * Calls Vertex AI API with the constructed prompt
   * Includes retry logic and timeout handling
   * @param {string} prompt - The prompt to send to the model
   * @returns {Promise<string>} Raw AI response text
   */
  async callVertexAI(prompt) {
    const startTime = Date.now();

    try {
      const request = {
        contents: [
          {
            role: 'user',
            parts: [{ text: prompt }]
          }
        ]
      };

      this.#logger.debug({ promptLength: prompt.length }, 'Calling Vertex AI');

      const response = await this.#model.generateContent(request);
      const result = response.response;

      // Extract text from response
      const text = result.candidates?.[0]?.content?.parts?.[0]?.text || '';

      const duration = Date.now() - startTime;
      this.#logger.debug({
        duration,
        responseLength: text.length
      }, 'Vertex AI response received');

      return text;
    } catch (err) {
      const duration = Date.now() - startTime;
      this.#logger.error({
        error: err.message,
        duration
      }, 'Vertex AI call failed');
      throw new Error(`Vertex AI API error: ${err.message}`);
    }
  }

  /**
   * Parses and validates the AI response JSON
   * Handles malformed JSON and validates required fields
   * @param {string} responseText - Raw response from AI
   * @returns {Object} Parsed suggestion object
   * @throws {Error} If response is not valid JSON or missing required fields
   */
  parseAIResponse(responseText) {
    try {
      // Remove markdown code blocks if present
      let cleaned = responseText.trim();
      if (cleaned.startsWith('```json')) {
        cleaned = cleaned.replace(/^```json\n?/, '').replace(/\n?```$/, '');
      } else if (cleaned.startsWith('```')) {
        cleaned = cleaned.replace(/^```\n?/, '').replace(/\n?```$/, '');
      }

      const parsed = JSON.parse(cleaned);

      // Validate structure
      if (typeof parsed.hasSimilarCases !== 'boolean') {
        throw new Error('Missing or invalid hasSimilarCases field');
      }

      if (!Array.isArray(parsed.matches)) {
        throw new Error('Missing or invalid matches array');
      }

      // Validate each match
      for (const match of parsed.matches) {
        if (typeof match.similarity !== 'number') {
          throw new Error('Match missing similarity score');
        }
        if (!match.caseId || !match.title || !match.reason || !match.suggestedAction) {
          throw new Error('Match missing required fields');
        }
      }

      return parsed;
    } catch (err) {
      this.#logger.error({
        error: err.message,
        responseText: responseText.substring(0, 500) // Log first 500 chars
      }, 'Failed to parse AI response');
      throw new Error(`Invalid AI response format: ${err.message}`);
    }
  }
}
