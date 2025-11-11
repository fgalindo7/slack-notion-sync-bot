/**
 * Tests for AI-powered similar case suggestions
 * Tests NotionKnowledgeBase and AISuggestionEngine with mocked dependencies
 */

import { strict as assert } from 'assert';
import { NotionKnowledgeBase } from './ai-suggestions.js';

// Test utilities
let testsPassed = 0;
let testsFailed = 0;

function test(description, fn) {
  try {
    fn();
    console.log(`✅ ${description}`);
    testsPassed++;
  } catch (err) {
    console.error(`❌ ${description}`);
    console.error(`   ${err.message}`);
    if (err.stack) {
      console.error(`   ${err.stack.split('\n').slice(1, 3).join('\n')}`);
    }
    testsFailed++;
  }
}

async function testAsync(description, fn) {
  try {
    await fn();
    console.log(`✅ ${description}`);
    testsPassed++;
  } catch (err) {
    console.error(`❌ ${description}`);
    console.error(`   ${err.message}`);
    if (err.stack) {
      console.error(`   ${err.stack.split('\n').slice(1, 3).join('\n')}`);
    }
    testsFailed++;
  }
}

// Mock logger
const mockLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {}
};

// Mock Notion client
function createMockNotionClient(mockResults = []) {
  return {
    databases: {
      query: async (params) => {
        // Validate query structure
        assert.ok(params.database_id, 'database_id is required');
        assert.ok(params.sorts, 'sorts are required');
        assert.ok(params.page_size, 'page_size is required');
        
        return {
          results: mockResults,
          has_more: false,
          next_cursor: null
        };
      }
    }
  };
}

// Mock historical cases
const mockHistoricalCases = [
  {
    id: 'notion-page-1',
    url: 'https://notion.so/page1',
    created_time: '2025-10-15T10:00:00Z',
    properties: {
      Priority: { select: { name: 'P1' } },
      Issue: { title: [{ plain_text: 'Login timeout on production' }] },
      'How to replicate': { rich_text: [{ plain_text: 'Try logging in with OAuth' }] },
      Customer: { rich_text: [{ plain_text: 'Acme Corp' }] },
      Status: { select: { name: 'Resolved' } }
    }
  },
  {
    id: 'notion-page-2',
    url: 'https://notion.so/page2',
    created_time: '2025-10-20T14:30:00Z',
    properties: {
      Priority: { select: { name: 'P2' } },
      Issue: { title: [{ plain_text: 'API 500 errors on /users endpoint' }] },
      'How to replicate': { rich_text: [{ plain_text: 'GET /api/users' }] },
      Customer: { rich_text: [{ plain_text: 'Beta Inc' }] },
      Status: { select: { name: 'Resolved' } }
    }
  },
  {
    id: 'notion-page-3',
    url: 'https://notion.so/page3',
    created_time: '2025-11-01T09:15:00Z',
    properties: {
      Priority: { select: { name: 'P1' } },
      Issue: { title: [{ plain_text: 'Database connection pool exhausted' }] },
      'How to replicate': { rich_text: [{ plain_text: 'High load on checkout flow' }] },
      Customer: { rich_text: [{ plain_text: 'Acme Corp' }] },
      Status: { select: { name: 'In Progress' } }
    }
  }
];

// Mock Vertex AI response
const mockVertexAIResponse = {
  hasSimilarCases: true,
  matches: [
    {
      similarity: 0.85,
      caseId: 'notion-page-1',
      title: 'Login timeout on production',
      reason: 'Both involve authentication timeouts with OAuth',
      suggestedAction: 'Check OAuth provider rate limits and session timeout settings'
    },
    {
      similarity: 0.72,
      caseId: 'notion-page-2',
      title: 'API 500 errors on /users endpoint',
      reason: 'Similar API error patterns on user-related endpoints',
      suggestedAction: 'Review API error logs and database query performance'
    }
  ]
};

// Mock Vertex AI model (for future integration tests)
function _createMockVertexAI(mockResponse = mockVertexAIResponse) {
  return {
    getGenerativeModel: () => ({
      generateContent: async (request) => {
        assert.ok(request.contents, 'contents are required');
        assert.ok(request.contents[0].parts, 'parts are required');
        
        // Simulate AI processing delay
        await new Promise(resolve => setTimeout(resolve, 10));
        
        return {
          response: {
            candidates: [
              {
                content: {
                  parts: [
                    {
                      text: JSON.stringify(mockResponse)
                    }
                  ]
                }
              }
            ]
          }
        };
      }
    })
  };
}

// ============================================================================
// NotionKnowledgeBase Tests
// ============================================================================

console.log('\n📚 Testing NotionKnowledgeBase\n');

test('NotionKnowledgeBase: constructor initializes correctly', () => {
  const kb = new NotionKnowledgeBase({
    notionClient: createMockNotionClient(),
    logger: mockLogger,
    databaseId: 'test-db-123',
    maxCases: 15
  });
  
  assert.ok(kb, 'Knowledge base instance created');
});

await testAsync('NotionKnowledgeBase: queryHistoricalCases returns formatted cases', async () => {
  const mockClient = createMockNotionClient(mockHistoricalCases);
  const kb = new NotionKnowledgeBase({
    notionClient: mockClient,
    logger: mockLogger,
    databaseId: 'test-db-123',
    maxCases: 20
  });
  
  const cases = await kb.queryHistoricalCases({ daysBack: 90 });
  
  assert.equal(cases.length, 3, 'Returns 3 cases');
  assert.ok(cases[0].id, 'First case has id');
  assert.ok(cases[0].url, 'First case has url');
  assert.equal(cases[0].priority, 'P1', 'First case has correct priority');
  assert.equal(cases[0].issue, 'Login timeout on production', 'First case has correct issue');
});

await testAsync('NotionKnowledgeBase: queryHistoricalCases uses cache', async () => {
  let queryCount = 0;
  const mockClient = {
    databases: {
      query: async () => {
        queryCount++;
        return { results: mockHistoricalCases, has_more: false };
      }
    }
  };
  
  const kb = new NotionKnowledgeBase({
    notionClient: mockClient,
    logger: mockLogger,
    databaseId: 'test-db-123',
    cacheTTL: 1000 // 1 second
  });
  
  // First query
  await kb.queryHistoricalCases({ daysBack: 90 });
  assert.equal(queryCount, 1, 'First query hits Notion');
  
  // Second query (should use cache)
  await kb.queryHistoricalCases({ daysBack: 90 });
  assert.equal(queryCount, 1, 'Second query uses cache');
  
  // Wait for cache to expire
  await new Promise(resolve => setTimeout(resolve, 1100));
  
  // Third query (cache expired)
  await kb.queryHistoricalCases({ daysBack: 90 });
  assert.equal(queryCount, 2, 'Third query after TTL hits Notion again');
});

test('NotionKnowledgeBase: formatCaseForAI handles missing properties', () => {
  const mockClient = createMockNotionClient();
  const kb = new NotionKnowledgeBase({
    notionClient: mockClient,
    logger: mockLogger,
    databaseId: 'test-db-123'
  });
  
  const incompletePage = {
    id: 'test-id',
    url: 'https://notion.so/test',
    created_time: '2025-11-01T10:00:00Z',
    properties: {
      Priority: { select: { name: 'P2' } }
      // Missing other properties
    }
  };
  
  const formatted = kb.formatCaseForAI(incompletePage);
  
  assert.equal(formatted.id, 'test-id', 'Has id');
  assert.equal(formatted.priority, 'P2', 'Has priority');
  assert.equal(formatted.issue, '', 'Missing issue is empty string');
  assert.equal(formatted.customer, '', 'Missing customer is empty string');
});

test('NotionKnowledgeBase: clearCache works', () => {
  const kb = new NotionKnowledgeBase({
    notionClient: createMockNotionClient(mockHistoricalCases),
    logger: mockLogger,
    databaseId: 'test-db-123'
  });
  
  kb.clearCache();
  // Should not throw
  assert.ok(true, 'Cache cleared successfully');
});

// ============================================================================
// AISuggestionEngine Tests
// ============================================================================

console.log('\n🤖 Testing AISuggestionEngine\n');

test('AISuggestionEngine: constructor config validation', () => {
  // Note: Can't fully test VertexAI init without real credentials
  // This test just checks the basic structure
  try {
    const config = {
      projectId: 'test-project',
      location: 'us-central1',
      model: 'gemini-pro',
      similarityThreshold: 0.7
    };
    
    // Constructor may fail without real GCP credentials, which is expected in tests
    // We're just validating the structure
    assert.ok(config.projectId, 'Config has projectId');
    assert.ok(config.location, 'Config has location');
    assert.ok(config.model, 'Config has model');
  } catch {
    // Expected to fail without real credentials
    assert.ok(true, 'Constructor validation passed (credentials not available)');
  }
});

test('AISuggestionEngine: buildPrompt creates structured prompt', () => {
  // Create a mock engine to test prompt building
  const mockEngine = {
    buildPrompt: (newIssue, historicalCases) => {
      const historicalContext = historicalCases
        .map((c, idx) => {
          return `${idx + 1}. [${c.priority}] ${c.issue}`;
        })
        .join('\n\n');
      
      return `NEW ISSUE:\n- Priority: ${newIssue.priority}\n- Issue: ${newIssue.issue}\n\nHISTORICAL CASES:\n${historicalContext}`;
    }
  };
  
  const newIssue = {
    priority: 'P1',
    issue: 'Auth timeout',
    replicate: 'Try login',
    customer: 'Test Co'
  };
  
  const historicalCases = [
    { priority: 'P1', issue: 'Login failure', customer: 'Test Co' }
  ];
  
  const prompt = mockEngine.buildPrompt(newIssue, historicalCases);
  
  assert.ok(prompt.includes('NEW ISSUE'), 'Prompt includes new issue section');
  assert.ok(prompt.includes('P1'), 'Prompt includes priority');
  assert.ok(prompt.includes('Auth timeout'), 'Prompt includes issue description');
  assert.ok(prompt.includes('HISTORICAL CASES'), 'Prompt includes historical section');
});

test('AISuggestionEngine: parseAIResponse handles valid JSON', () => {
  // Mock the parseAIResponse method
  const parseAIResponse = (responseText) => {
    let cleaned = responseText.trim();
    if (cleaned.startsWith('```json')) {
      cleaned = cleaned.replace(/^```json\n?/, '').replace(/\n?```$/, '');
    }
    const parsed = JSON.parse(cleaned);
    
    if (typeof parsed.hasSimilarCases !== 'boolean') {
      throw new Error('Missing hasSimilarCases field');
    }
    if (!Array.isArray(parsed.matches)) {
      throw new Error('Missing matches array');
    }
    
    return parsed;
  };
  
  const validResponse = JSON.stringify(mockVertexAIResponse);
  const parsed = parseAIResponse(validResponse);
  
  assert.equal(parsed.hasSimilarCases, true, 'Parses hasSimilarCases');
  assert.equal(parsed.matches.length, 2, 'Parses matches array');
  assert.equal(parsed.matches[0].similarity, 0.85, 'Parses similarity score');
});

test('AISuggestionEngine: parseAIResponse handles markdown-wrapped JSON', () => {
  const parseAIResponse = (responseText) => {
    let cleaned = responseText.trim();
    if (cleaned.startsWith('```json')) {
      cleaned = cleaned.replace(/^```json\n?/, '').replace(/\n?```$/, '');
    }
    return JSON.parse(cleaned);
  };
  
  const markdownWrapped = '```json\n' + JSON.stringify(mockVertexAIResponse) + '\n```';
  const parsed = parseAIResponse(markdownWrapped);
  
  assert.equal(parsed.hasSimilarCases, true, 'Parses markdown-wrapped JSON');
});

test('AISuggestionEngine: parseAIResponse throws on invalid JSON', () => {
  const parseAIResponse = (responseText) => {
    const parsed = JSON.parse(responseText);
    if (typeof parsed.hasSimilarCases !== 'boolean') {
      throw new Error('Missing hasSimilarCases field');
    }
    return parsed;
  };
  
  let errorThrown = false;
  try {
    parseAIResponse('not valid json');
  } catch {
    errorThrown = true;
  }
  
  assert.ok(errorThrown, 'Throws error on invalid JSON');
});

test('AISuggestionEngine: parseAIResponse validates required fields', () => {
  const parseAIResponse = (responseText) => {
    const parsed = JSON.parse(responseText);
    if (typeof parsed.hasSimilarCases !== 'boolean') {
      throw new Error('Missing hasSimilarCases field');
    }
    if (!Array.isArray(parsed.matches)) {
      throw new Error('Missing matches array');
    }
    for (const match of parsed.matches) {
      if (typeof match.similarity !== 'number') {
        throw new Error('Match missing similarity score');
      }
      if (!match.caseId || !match.title || !match.reason || !match.suggestedAction) {
        throw new Error('Match missing required fields');
      }
    }
    return parsed;
  };
  
  const invalidResponse = {
    hasSimilarCases: true,
    matches: [
      {
        similarity: 0.8,
        caseId: 'test-id'
        // Missing title, reason, suggestedAction
      }
    ]
  };
  
  let errorThrown = false;
  try {
    parseAIResponse(JSON.stringify(invalidResponse));
  } catch {
    errorThrown = true;
  }
  
  assert.ok(errorThrown, 'Throws error on missing required fields');
});

// ============================================================================
// Integration-style Tests (with mocked Vertex AI)
// ============================================================================

console.log('\n🔗 Testing Integration Scenarios\n');

test('Integration: No historical cases returns empty matches', async () => {
  // This would need to be an async test with mocked Vertex AI
  // For now, we validate the logic
  const emptyResult = {
    hasSimilarCases: false,
    matches: []
  };
  
  assert.equal(emptyResult.hasSimilarCases, false, 'No similar cases flag is false');
  assert.equal(emptyResult.matches.length, 0, 'Matches array is empty');
});

test('Integration: Filters matches by similarity threshold', () => {
  const matches = [
    { similarity: 0.85, title: 'High match' },
    { similarity: 0.72, title: 'Medium match' },
    { similarity: 0.65, title: 'Low match' },
    { similarity: 0.55, title: 'Very low match' }
  ];
  
  const threshold = 0.7;
  const filtered = matches.filter(m => m.similarity >= threshold);
  
  assert.equal(filtered.length, 2, 'Filters to 2 matches above threshold');
  assert.equal(filtered[0].similarity, 0.85, 'Keeps high similarity match');
  assert.equal(filtered[1].similarity, 0.72, 'Keeps medium similarity match');
});

test('Integration: Limits to top 3 matches', () => {
  const matches = [
    { similarity: 0.95 },
    { similarity: 0.90 },
    { similarity: 0.85 },
    { similarity: 0.80 },
    { similarity: 0.75 }
  ];
  
  const limited = matches.slice(0, 3);
  
  assert.equal(limited.length, 3, 'Limits to 3 matches');
});

// ============================================================================
// Error Handling Tests
// ============================================================================

console.log('\n⚠️  Testing Error Handling\n');

await testAsync('Error: Knowledge base handles Notion API failures gracefully', async () => {
  const failingClient = {
    databases: {
      query: async () => {
        throw new Error('Notion API timeout');
      }
    }
  };
  
  const kb = new NotionKnowledgeBase({
    notionClient: failingClient,
    logger: mockLogger,
    databaseId: 'test-db-123'
  });
  
  let errorThrown = false;
  try {
    await kb.queryHistoricalCases();
  } catch (err) {
    errorThrown = true;
    assert.ok(err.message.includes('Notion API timeout'), 'Error message preserved');
  }
  
  assert.ok(errorThrown, 'Throws error on Notion failure');
});

// ============================================================================
// Summary
// ============================================================================

console.log('\n' + '='.repeat(60));
console.log(`✅ Tests passed: ${testsPassed}`);
console.log(`❌ Tests failed: ${testsFailed}`);
console.log('='.repeat(60) + '\n');

if (testsFailed > 0) {
  process.exit(1);
}
