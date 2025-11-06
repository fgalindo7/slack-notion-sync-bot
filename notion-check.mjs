import { Client } from '@notionhq/client';

const notion = new Client({ auth: process.env.NOTION_TOKEN });

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