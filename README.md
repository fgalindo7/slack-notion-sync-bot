<p align="center">
  <img src="logo/on-call-bot.png" alt="On-Call Bot Logo" width="180" height="180" />
</p>

<h1 align="center">⚡️ On-Call Bot</h1>

<p align="center">
  <b>Automate incident tracking, Slack triage, and Notion updates — effortlessly.</b><br>
  A lightweight <code>@slack/bolt</code> and <code>@notionhq/client</code> powered assistant for modern teams.
</p>

---

## 🧭 Overview

**On-Call Bot** streamlines the process of handling on-call incidents in Slack by automatically parsing specially formatted messages (using the `@auto` syntax), validating key fields, and syncing updates directly into Notion.

No more manual copy-pasting — just type `@auto` in Slack and let the bot take care of the rest.

---

## 🧩 Features

- 🧵 **Smart message parsing:** Extracts structured data like priority, issue, customer, replication steps, etc.
- 🪄 **Notion integration:** Automatically creates or updates corresponding pages in your Notion database.
- 🧠 **Thread awareness:** Responds only to top-level messages (or optionally to threads).
- 🐞 **Validation feedback:** Instantly replies if required fields are missing.
- 🕵️ **Schema detection:** Dynamically matches your Notion DB schema without hardcoding.
- ⚙️ **Socket Mode ready:** Runs seamlessly via Slack Socket Mode for instant responsiveness.

---

## 🧱 Architecture

Slack → @auto message → Bolt App → Notion API → Notion Page

1. **Slack** users post messages starting with `@auto`.
2. **Bolt App** listens and parses structured fields.
3. **Validation** ensures required attributes are present.
4. **Notion API** creates or updates the corresponding entry.

---

## ⚙️ Configuration

### Required Environment Variables

| Variable | Description |
|-----------|-------------|
| SLACK_BOT_TOKEN | Bot token from your Slack App |
| SLACK_APP_LEVEL_TOKEN | App-level token for Socket Mode |
| SLACK_SIGNING_SECRET | Slack signing secret (optional if using Socket Mode only) |
| NOTION_TOKEN | Notion API integration token |
| NOTION_DATABASE_ID | Target Notion database ID |
| WATCH_CHANNEL_ID | Slack channel ID to monitor |
| ALLOW_THREADS | Optional, allow parsing inside threads (true/false) |

Store these in `.env` or a secret manager (Doppler, Vault, etc).

---

## 🚀 Running Locally

### Step 1: Install dependencies

npm install

### Step 2: Create `.env`

SLACK_BOT_TOKEN=xoxb-...
SLACK_APP_LEVEL_TOKEN=xapp-...
NOTION_TOKEN=secret_...
NOTION_DATABASE_ID=abc123def456
WATCH_CHANNEL_ID=C123456789
ALLOW_THREADS=false

### Step 3: Start the app

npm start

✅ You should see:
⚡️ On-call auto ingestor running (Socket Mode)

---

## 🧪 Example Slack Message

@auto  
Priority: P1  
Issue: Production API timeout on checkout  
How to replicate: Attempt to purchase via /checkout  
Customer: Acme Corp  
1Password: acme-prod-api  
Needed by: 2025-11-07 17:00 PT  
Relevant Links: https://status.acme.io, https://notion.so/acme-api

---

## 🧠 How It Works

| Component | Responsibility |
|------------|----------------|
| parseAutoBlock() | Extracts key-value pairs from the Slack message |
| missingFields() | Validates that all required data is present |
| createOrUpdateNotionPage() | Creates or updates Notion page dynamically |
| findPageForMessage() | Ensures idempotent writes (updates instead of duplicates) |
| loadSchema() | Discovers Notion DB properties and caches schema |

---

## 🧰 Tech Stack

- Slack Bolt JS  
- Notion SDK  
- Node.js  
- ES Modules

---

## 🧑‍💻 Development

Run with hot reload:
npm run dev

Run linter:
npm run lint

---

## 🐳 Deployment

You can deploy easily using Docker:

docker build -t on-call-bot .  
docker run -d --env-file .env on-call-bot

Or via Cloud Run / Fly.io / Railway.app.

---

## 🧩 Folder Structure

on-call-bot/  
├── app.js  
├── package.json  
├── logo/  
│   └── on-call-bot.png  
└── README.md

---

## ❤️ Contributing

1. Fork  
2. Create a branch (git checkout -b feature/awesome)  
3. Commit (git commit -am "Add awesome feature")  
4. Push and open a PR  

---

## 🛡️ License

MIT © 2025 — Francisco

---

<p align="center">
  <sub>Built with 💙 by humans (and cats) who hate manual Notion updates.</sub><br>
  <img src="logo/on-call-bot-2.png" width="100" alt="On-Call Bot logo small">
</p>