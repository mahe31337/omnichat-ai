# OmniChat AI

A powerful, modern, and fully self-hosted AI chat UI with **multi-provider LLM support**, **local RAG memory**, **intelligent web search**, **Model Context Protocol (MCP) tool integration**, and **domain-specific expert filters** — all running from your own machine with no mandatory cloud dependency.

---

## 🌟 Features

### 🤖 Multi-Provider LLM Support
Connect to any of these AI backends using your own credentials:

| Provider | Type |
|---|---|
| **OpenAI** (GPT-4o, GPT-4, etc.) | Cloud API |
| **Google Gemini** | Cloud API |
| **AWS Bedrock** (Claude, Titan, etc.) | Cloud API |
| **AWS Bedrock Agents** | Cloud Agent (with trace support) |
| **Ollama** | 100% Local / Offline |

Switch between any number of configured agents from the header dropdown — no restart required.

---

### 🧠 Local RAG Memory (Grows Smarter Over Time)
A local **Retrieval-Augmented Generation** server runs on your machine and makes the AI remember everything you've discussed:

- **Every Q&A is saved** as a vector embedding to a local file (`rag-server/rag-store/store.json`)
- **Before every message**, the system finds semantically similar past conversations and injects them as context
- The AI becomes **more personalized and accurate over time**
- Uses `Xenova/all-MiniLM-L6-v2` — a ~22MB model that runs **100% locally** (downloads once, no API key needed ever)
- Toggle **Memory ON/OFF** anytime from the header

---

### 🔌 Model Context Protocol (MCP) Plugins
OmniChat natively supports the standard **Model Context Protocol (MCP)**, allowing your AI agents to seamlessly interact with external world tools like GitHub, GitLab, local file systems, and more.

- **Dynamic Tool Execution:** Connect to official MCP servers via the "🔌 Manage Plugins (MCP)" sidebar button.
- **Agentic Loop:** The AI acts autonomously. It determines when to call a tool, waits for the result, reads the live output, and writes a final response based on the execution.
- **Live Tool Streaming:** Watch the literal raw JSON outputs from backend tools stream into the chat UI in real-time within collapsible `<details>` blocks.
- **Safety Toggle:** Use the **Plugins ON/OFF** button in the header to easily detach all tools during casual chatting to prevent hallucination (especially useful for smaller local models).
- **Supports OpenAI & Ollama:** Tool calling schemas are automatically translated for both massive cloud models (GPT-4o) and local models (Qwen2.5, Llama3). Note: for 20+ tools, local models require 8B+ parameters for reliable tool calling.

---

### 🌐 Live Web Search — Multi-Engine with Runtime Control

The AI can search the internet in real time. The entire search stack is **configured from the UI at runtime** — no code changes, no server restarts needed.

#### Search Engines

| Engine | Key Required | Quality | When Used |
|---|---|---|---|
| **DuckDuckGo** | ❌ No key | ⭐⭐⭐ Good | **Always ON by default** |
| **Tavily AI Search** | ✅ Free key (1000/mo) | ⭐⭐⭐⭐⭐ Excellent | When Tavily is enabled in UI |

- **DuckDuckGo** is the default — no setup needed, always works as a free fallback
- **Tavily** gives richer, LLM-optimised results with a synthesised AI answer + structured sources. Enable it from the **Tavily settings panel** (⚡ Tavily button) whenever you want higher quality — disable it when your monthly free tier runs out
- If Tavily fails for any reason, the system **automatically falls back to DuckDuckGo**

#### Content Extraction Methods

| Method | Cost | Quality | When Used |
|---|---|---|---|
| **Raw HTML fetch** | Free | ⭐⭐⭐ Standard | Default |
| **Jina Reader** | ❌ 100% Free, no key | ⭐⭐⭐⭐⭐ Clean markdown | When Jina is enabled in UI |

- **Jina Reader** (`r.jina.ai`) converts any URL to clean, readable markdown — strips ads, nav bars, footers, JavaScript noise — giving the AI much better article text to reason over
- Requires **no API key, no signup** — completely free for normal personal use
- Toggle it ON for deep research, OFF for faster responses

#### UI Controls (all runtime, zero code changes)

When Web Search is ON, the header shows these live controls:

| Control | What it does |
|---|---|
| **Web ON/OFF** | Enable/disable web search entirely |
| **Context: N [slider]** | Set chars extracted per page (500–12,000). Higher = smarter, slower |
| **Jina ON/OFF** | Toggle Jina Reader for cleaner content vs. faster raw fetch |
| **⚡ Tavily ON/OFF ▼** | Opens settings panel to paste your API key and enable/disable Tavily |
| **Inspect** | Show the raw injected web data in the chat for debugging |

> **Context Slider is the key knob for performance vs intelligence:** At `500` the AI gets a snippet. At `6,000+` it gets full article text. Default is `4,000`.

---

### 🔍 Domain Expert Filters
Select a domain from the dropdown to activate a **professional system instruction** for that area:

| Filter | Instruction File | Behavior |
|---|---|---|
| **General** | *(none)* | Default chat mode |
| **Terraform** | `public/prompts/terraform.md` | Senior IaC engineer persona |
| **Ansible** | `public/prompts/ansible.md` | DevOps automation expert |
| **Docker** | `public/prompts/docker.md` | Containerization specialist |
| **Kubernetes** | `public/prompts/kubernetes.md` | K8s platform engineer |

**Fully customizable** — just open any `.md` file in `public/prompts/` and edit the instructions. No code changes needed. Add new filters by editing the `CODER_MODES` array in `Home.jsx` and creating a corresponding `.md` file.

---

### 🌐 Built-in URL Content Fetcher
Paste any public URL in your message and the app automatically:
1. Fetches the page content via a CORS proxy
2. Strips HTML boilerplate
3. Injects the readable text into your prompt

This gives **any offline model** (e.g., Ollama/Llama3) live web browsing capabilities.

---

### 💬 Chat Management
- **Concurrent Generations:** Run multiple prompts simultaneously across different chats without blocking the UI
- **Stop Generating:** Instantly abort any running prompt generation with the 'Stop Generating' button
- Persistent storage in browser `localStorage`
- Auto-generated titles from the first message
- Create / delete chats from the sidebar

---

### ⚙️ UI-Driven Agent Manager
Add, edit, and delete AI agents entirely from the UI — no `.env` file required:
- Set provider, model, API keys, regions, agent IDs all from the "Manage Agents" modal
- Your agents persist in `localStorage` across sessions

---

## 🚀 Getting Started

### Prerequisites

- **Node.js** v18 or higher
- **npm**

---

### 1. Install Frontend Dependencies

```bash
cd /data/bedrock-ui
npm install
```

---

### 2. Configure (Optional — `.env` file)

You can skip this entirely and configure agents from the UI instead.

```bash
cp .env.example .env
```

Edit `.env` with your preferred provider defaults:

```env
# Default provider
VITE_LLM_PROVIDER=ollama

# OpenAI
VITE_OPENAI_API_KEY=sk-your-key
VITE_OPENAI_MODEL=gpt-4o

# OR AWS Bedrock
VITE_BEDROCK_REGION=us-east-1
VITE_BEDROCK_ACCESS_KEY=...
VITE_BEDROCK_SECRET_KEY=...

# Ollama (local)
VITE_OLLAMA_URL=http://localhost:11434
VITE_OLLAMA_MODEL=qwen2.5:7b   # Recommended for 16GB RAM

# -- Performance --
VITE_STREAM_RESPONSE=true

# Server-side fallback for scrape char limit.
# The UI slider always overrides this at runtime — this is rarely used.
SCRAPE_CHAR_LIMIT=4000
```

> **Note:** You can skip `.env` entirely and add agents using the "Manage Agents" button in the app sidebar.

---

### 3. Install RAG Server Dependencies

The RAG server is a separate Node.js process that runs locally:

```bash
cd /data/bedrock-ui/rag-server
npm install
```

> **First run only:** The embedding model (~22MB) will be downloaded from HuggingFace and cached. This only happens once.

---

### 4. Running the App

You only need **one terminal**. The RAG backend, MCP Manager backend, and the React frontend all start together concurrently:

```bash
cd /data/bedrock-ui
npm run dev
```

You'll see color-coded logs for all three processes. Open `http://localhost:5173` in your browser.

> **Note:** The app works without the RAG server too. If it fails to start, the Memory and Web Search toggles show as "Offline" and gracefully disable themselves.

---

### 5. Setting Up Web Search (Optional Upgrades)

#### Tavily AI Search (Free tier — recommended)
1. Go to [tavily.com](https://tavily.com) and create a free account (1000 searches/month)
2. Copy your API key (starts with `tvly-`)
3. In the UI: turn **Web ON** → click **⚡ Tavily** → paste the key → flip the toggle ON
4. Done. The app will use Tavily for all searches. When you want to switch back to DDG, just flip the toggle OFF — no code change needed.

#### Jina Reader (Free, no key needed)
1. In the UI: turn **Web ON** → click **📖 Jina ON**
2. That's it. Jina Reader is public and requires no account or API key.

> **Best combo for deep research:** Tavily ON + Jina ON + Context slider at 6000+

---

### 6. Special Note for Ollama

When using Ollama, your Ollama instance must allow CORS from your browser:

```bash
# macOS / Linux
OLLAMA_ORIGINS="*" ollama serve

# Windows (PowerShell)
$env:OLLAMA_ORIGINS="*"; ollama serve
```

**Recommended models for 16GB RAM (CPU-only):**

| Model | RAM | Speed | Intelligence |
|---|---|---|---|
| `qwen2.5:7b-instruct-q4_K_M` | ~4.5 GB | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ Best overall |
| `llama3.1:8b-instruct-q4_K_M` | ~5 GB | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ |
| `mistral:7b-instruct-q4_K_M` | ~4 GB | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ |
| `phi3.5:3.8b-mini-instruct` | ~2.5 GB | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ Fastest |

```bash
ollama pull qwen2.5:7b-instruct-q4_K_M
```

---

## 📁 Project Structure

```
bedrock-ui/
├── public/
│    └── prompts/              ← Domain expert instruction files (edit freely!)
        ├── terraform.md
        ├── kubernetes.md
        ├── ansible.md
        └── docker.md

├── mcp-server/               ← Local Model Context Protocol plugin manager (port 3002)
│   ├── server.js             ← Express server routing tool calls
│   ├── mcp-manager.js        ← Lifecycle manager for npx @modelcontextprotocol SDK sub-processes
│   └── package.json
│
├── rag-server/               ← Local RAG + Web Search backend (port 3001)
│   ├── server.js             ← Express server: RAG store + multi-engine web search
│   ├── package.json
│   └── rag-store/
│       └── store.json        ← Your growing vector memory (auto-created)
│
├── src/
│   ├── pages/
│   │   ├── Home.jsx          ← Main chat UI (all search config managed here)
│   │   └── Login.jsx         ← Login screen
│   └── services/
│       ├── llm.js            ← LLM provider abstraction (OpenAI, Bedrock, Ollama...)
│       └── rag.js            ← RAG + web search client service
│
├── .env                      ← Optional config (server-side fallbacks only)
├── index.html
├── package.json
└── vite.config.js
```

---

## 🔄 How the Full Pipeline Works

```
You send a message
       ↓
[1] RAG query    → top-3 similar past conversations injected as memory context
       ↓
[2] Web search   → (if Web toggle ON)
                   → Tavily AI Search  (if key + enabled)
                   → OR DuckDuckGo    (default, no key)
                   → Content extraction:
                     → Jina Reader    (if Jina ON — clean markdown)
                     → OR raw fetch   (default — fast)
       ↓
[3] LLM call     → domain prompt + memories + web results + your message
       ↓
[4] AI responds  → streamed word-by-word to the chat
       ↓
[5] Auto-save    → Q&A pair embedded and stored to store.json
```

---

## 🧠 Managing RAG Memory

The memory vector store is completely local. Manage it in a few ways:

**1. Direct File Access**
```
bedrock-ui/rag-server/rag-store/store.json
```
Open, edit, or delete entries manually in any text editor.

**2. Check Total Memory Size (API)**
```bash
curl http://localhost:3001/rag/stats
```

**3. Wipe Entire Memory Clean (API)**
```bash
curl -X DELETE http://localhost:3001/rag/clear
```

---

## 🛠️ Built With

| Technology | Purpose |
|---|---|
| [React](https://react.dev/) | Frontend UI framework |
| [Vite](https://vitejs.dev/) | Build tool and dev server |
| [AWS SDK for JavaScript](https://aws.amazon.com/sdk-for-javascript/) | Bedrock / Bedrock Agent integration |
| [OpenAI Node SDK](https://github.com/openai/openai-node) | OpenAI / GPT integration |
| [Google Generative AI SDK](https://github.com/google/generative-ai-js) | Gemini integration |
| [Express](https://expressjs.com/) | RAG server backend |
| [@xenova/transformers](https://github.com/xenova/transformers.js) | Local embedding model (all-MiniLM-L6-v2) |
| [concurrently](https://github.com/open-cli-tools/concurrently) | Single-command multi-process execution |
| [marked](https://marked.js.org/) + [DOMPurify](https://github.com/cure53/DOMPurify) | Safe markdown rendering |
| [Tavily API](https://tavily.com) | AI-optimised web search (optional, free tier) |
| [Jina Reader](https://jina.ai/reader/) | Clean article text extraction (free, no key) |

---

---

## 🛠️ Monitoring & Debugging

You can manually inspect and test the backend systems using standard terminal commands:

### **1. Check MCP Plugin Status (Port 3002)**
Verify which plugins are connected and list all available tools the AI can see:
```bash
# See active servers (e.g., github)
curl http://localhost:3002/mcp/status

# List every available tool and its JSON schema
curl http://localhost:3002/mcp/tools
```

### **2. Manually Test a Plugin Tool**
Bypass the AI and test a specific tool function manually:
```bash
curl -X POST http://localhost:3002/mcp/call \
  -H "Content-Type: application/json" \
  -d '{
    "toolName": "github__search_repositories",
    "args": { "query": "user:YOUR_GITHUB_USERNAME" }
  }'
```

### **3. Monitor Local LLM Output (Ollama)**
See which models are loaded in memory and watch streaming logs:
```bash
# Check loaded models
ollama ps

# Watch raw Ollama server logs
journalctl -u ollama --no-pager -f
```

---

## 🔐 Security Notes

- **API keys are stored in your browser's `localStorage`** — use on trusted machines only
- **Tavily API key** is stored in `localStorage` and sent only to `api.tavily.com` — never to any other server
- The RAG store (`rag-store/store.json`) is a plain JSON file on your local disk — back it up if you want to preserve it
- Web search goes through the RAG server (server-side), avoiding browser CORS issues
- All LLM calls go directly from your browser to the provider — no intermediary server

---

## ➕ Adding a New Domain Filter

1. Create a new instruction file:
   ```
   public/prompts/yourfilter.md
   ```
   Write detailed expert instructions in markdown.

2. Register it in `src/pages/Home.jsx` at the top:
   ```js
   const CODER_MODES = [
       ...
       { value: 'YourFilter', label: 'Your Filter Label', promptFile: '/prompts/yourfilter.md' },
   ];
   ```

That's it — no other code changes needed.
