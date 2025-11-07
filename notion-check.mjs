/**
 * @fileoverview Notion database connectivity test script
 * Verifies that the Notion API token and database ID are correctly configured
 * @author Francisco Galindo
 */

import { Client } from '@notionhq/client';

const notion = new Client({ auth: process.env.NOTION_TOKEN });

/**
 * Tests the Notion database connection and displays database information
 * Retrieves and logs the database name and available properties
 * @returns {Promise<void>}
 * @throws {Error} Exits with code 1 if connection fails
 */
async function main() {
  try {
    const db = await notion.databases.retrieve({ database_id: process.env.NOTION_DATABASE_ID });
    console.log('Database name:', db.title?.[0]?.plain_text || '(unnamed)');
    console.log('Properties:', Object.keys(db.properties));
    process.exit(0);
  } catch (e) {
    console.error('Notion check failed:', e.message);
    process.exit(1);
  }
}
main();