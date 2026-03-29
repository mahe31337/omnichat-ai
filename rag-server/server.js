/**
 * OmniChat AI — Local RAG + Web Search Server
 *
 * Runs on http://localhost:3001
 * Vector store is saved to ./rag-store/store.json on this machine.
 *
 * Endpoints:
 *   POST /rag/add      — Store a Q&A pair as a memory
 *   POST /rag/query    — Find semantically similar past memories
 *   GET  /rag/stats    — Get total stored memories
 *   DELETE /rag/clear  — Wipe the entire memory store
 *   POST /search       — Web search:
 *                          Strategy A: Tavily AI Search (if tavilyKey provided)
 *                          Strategy B: DuckDuckGo HTML scrape (always available as fallback/default)
 *                        Content:
 *                          Jina Reader (if useJina=true) for clean article text
 *                          Raw page fetch (fallback)
 */

import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '..', '.env') });

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// ─── Vector Store ──────────────────────────────────────────────────────────────
const STORE_PATH = path.join(__dirname, 'rag-store', 'store.json');

function ensureStore() {
    const dir = path.dirname(STORE_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    if (!fs.existsSync(STORE_PATH)) fs.writeFileSync(STORE_PATH, JSON.stringify([], null, 2));
}

function loadStore() {
    ensureStore();
    try {
        return JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'));
    } catch {
        return [];
    }
}

function saveStore(store) {
    fs.writeFileSync(STORE_PATH, JSON.stringify(store, null, 2));
}

// ─── Embeddings ────────────────────────────────────────────────────────────────
let embedder = null;

async function getEmbedder() {
    if (!embedder) {
        console.log('⏳ Loading embedding model (first run may download ~22MB)...');
        const { pipeline } = await import('@xenova/transformers');
        embedder = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
        console.log('✅ Embedding model loaded.');
    }
    return embedder;
}

async function embed(text) {
    const pipe = await getEmbedder();
    const truncated = text.substring(0, 512);
    const output = await pipe(truncated, { pooling: 'mean', normalize: true });
    return Array.from(output.data);
}

// ─── Cosine Similarity ─────────────────────────────────────────────────────────
function cosineSimilarity(a, b) {
    let dot = 0, magA = 0, magB = 0;
    for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i];
        magA += a[i] * a[i];
        magB += b[i] * b[i];
    }
    if (magA === 0 || magB === 0) return 0;
    return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Strip HTML tags and normalise whitespace from raw HTML.
 * Removes script/style blocks first.
 */
function extractTextFromHtml(html, charLimit) {
    return html
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<nav[\s\S]*?<\/nav>/gi, '')
        .replace(/<footer[\s\S]*?<\/footer>/gi, '')
        .replace(/<header[\s\S]*?<\/header>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .substring(0, charLimit);
}

/**
 * Fetch a URL via Jina Reader (r.jina.ai) which returns clean markdown text.
 * Falls back to raw fetch+strip on any error.
 */
async function fetchContentViaJina(url, charLimit) {
    try {
        const jinaUrl = `https://r.jina.ai/${url}`;
        const res = await fetch(jinaUrl, {
            headers: {
                'User-Agent': 'OmniChatAI/2.0',
                'Accept': 'text/plain, text/markdown'
            },
            signal: AbortSignal.timeout(8000)
        });
        if (!res.ok) throw new Error(`Jina returned ${res.status}`);
        const text = await res.text();
        return text.replace(/\s+/g, ' ').trim().substring(0, charLimit);
    } catch (e) {
        console.warn(`[Jina] Failed for ${url}: ${e.message} — falling back to raw fetch`);
        return fetchContentRaw(url, charLimit);
    }
}

/**
 * Fetch a URL directly and strip HTML tags.
 */
async function fetchContentRaw(url, charLimit) {
    try {
        const res = await fetch(url, {
            headers: { 'User-Agent': 'Mozilla/5.0 Chrome/120 Safari/537.36', 'Accept': 'text/html' },
            signal: AbortSignal.timeout(6000)
        });
        if (!res.ok) return null;
        const html = await res.text();
        return extractTextFromHtml(html, charLimit);
    } catch {
        return null;
    }
}

// ─── Routes ────────────────────────────────────────────────────────────────────

// Health check
app.get('/health', (req, res) => {
    const store = loadStore();
    res.json({ status: 'ok', memories: store.length });
});

// Add a Q&A memory to the vector store
app.post('/rag/add', async (req, res) => {
    try {
        const { question, answer, domain = 'General', timestamp } = req.body;
        if (!question || !answer) return res.status(400).json({ error: 'question and answer are required' });

        const text = `Q: ${question}\nA: ${answer}`;
        const vector = await embed(text);

        const store = loadStore();
        store.push({
            id: Date.now(),
            vector,
            question,
            // Store up to RAG_ANSWER_LIMIT chars (set in .env). Short answers stored in full.
            // Very long answers are trimmed at the last sentence boundary within the limit.
            answer: (() => {
                const limit = parseInt(process.env.RAG_ANSWER_LIMIT) || 4000;
                if (answer.length <= limit) return answer;
                const trimmed = answer.substring(0, limit);
                const lastPeriod = Math.max(trimmed.lastIndexOf('. '), trimmed.lastIndexOf('.\n'));
                return lastPeriod > limit * 0.6 ? trimmed.substring(0, lastPeriod + 1) : trimmed;
            })(),
            domain,
            timestamp: timestamp || Date.now()
        });
        saveStore(store);

        console.log(`[RAG] Added memory #${store.length} (domain: ${domain})`);
        res.json({ success: true, total: store.length });
    } catch (err) {
        console.error('[RAG] Error adding:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// Query the vector store for similar past memories
app.post('/rag/query', async (req, res) => {
    try {
        const { query, topK = 3, threshold = 0.4 } = req.body;
        if (!query) return res.status(400).json({ error: 'query is required' });

        const store = loadStore();
        if (store.length === 0) return res.json({ results: [] });

        const queryVector = await embed(query);

        const scored = store
            .map(item => ({ ...item, score: cosineSimilarity(queryVector, item.vector) }))
            .filter(item => item.score >= threshold)
            .sort((a, b) => b.score - a.score)
            .slice(0, topK)
            .map(({ vector, ...rest }) => rest);

        console.log(`[RAG] Query: "${query.substring(0, 60)}" → ${scored.length} results`);
        res.json({ results: scored });
    } catch (err) {
        console.error('[RAG] Error querying:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// Get store stats
app.get('/rag/stats', (req, res) => {
    const store = loadStore();
    const domains = store.reduce((acc, item) => {
        acc[item.domain] = (acc[item.domain] || 0) + 1;
        return acc;
    }, {});
    res.json({ total: store.length, domains });
});

// Clear the entire store
app.delete('/rag/clear', (req, res) => {
    saveStore([]);
    console.log('[RAG] Store cleared.');
    res.json({ success: true });
});

// ─── Web Search ────────────────────────────────────────────────────────────────
/**
 * POST /search
 * Body:
 *   query      {string}  — Search query (required)
 *   maxChars   {number}  — Max chars of content to extract per page (client-controlled)
 *   tavilyKey  {string}  — Tavily API key. If provided AND non-empty, use Tavily as primary source.
 *   useJina    {boolean} — If true, use Jina Reader for cleaner article text.
 *
 * Strategy priority:
 *   1. Tavily (if tavilyKey provided) — rich, structured, LLM-optimised results
 *   2. DuckDuckGo HTML scrape (always available, no key needed)
 *   Content enrichment:
 *   A. Jina Reader (useJina=true) — clean markdown from URLs
 *   B. Raw fetch + HTML strip (fallback)
 */
app.post('/search', async (req, res) => {
    try {
        const { query, maxChars, tavilyKey, useJina } = req.body;
        if (!query) return res.status(400).json({ error: 'query is required' });

        // charLimit: from request body (client slider), then env fallback, then safe default
        const charLimit = maxChars ? parseInt(maxChars) : (parseInt(process.env.SCRAPE_CHAR_LIMIT) || 4000);
        const useTavily = typeof tavilyKey === 'string' && tavilyKey.trim().length > 0;
        const jinaEnabled = useJina === true;

        console.log(`[Search] Query: "${query}" | chars: ${charLimit} | Tavily: ${useTavily} | Jina: ${jinaEnabled}`);

        let results = [];

        // ─── Strategy A: Tavily AI Search ──────────────────────────────────
        if (useTavily) {
            try {
                console.log('[Search] Trying Tavily AI Search...');
                const tavilyRes = await fetch('https://api.tavily.com/search', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${tavilyKey.trim()}`
                    },
                    body: JSON.stringify({
                        api_key: tavilyKey.trim(),    // Tavily docs prefer key in body
                        query,
                        search_depth: 'basic',        // 'advanced' costs more credits and can fail on free tier
                        max_results: 6,
                        include_answer: true,          // Tavily synthesised answer
                        include_raw_content: false,    // We'll fetch content ourselves if needed
                        include_images: false
                    }),
                    signal: AbortSignal.timeout(15000)
                });

                if (!tavilyRes.ok) {
                    const errBody = await tavilyRes.text();
                    throw new Error(`Tavily status ${tavilyRes.status}: ${errBody}`);
                }

                const tavilyData = await tavilyRes.json();
                console.log(`[Search] Tavily: ${tavilyData.results?.length || 0} results`);

                // Prepend Tavily's synthesised answer as a special top result
                if (tavilyData.answer) {
                    results.push({
                        url: '',
                        title: '🤖 Tavily AI Answer',
                        snippet: tavilyData.answer,
                        content: tavilyData.answer,
                        source: 'tavily-answer'
                    });
                }

                (tavilyData.results || []).forEach(r => {
                    results.push({
                        url: r.url || '',
                        title: r.title || r.url,
                        snippet: r.content ? r.content.substring(0, 300) : '',
                        content: r.content || '',   // Tavily already returns page content
                        score: r.score,
                        source: 'tavily'
                    });
                });
            } catch (e) {
                console.warn('[Search] Tavily failed:', e.message, '— falling back to DDG');
            }
        }

        // ─── Strategy B: DuckDuckGo HTML Scrape (default / fallback) ──────
        if (results.length === 0) {
            try {
                console.log('[Search] Using DuckDuckGo HTML search...');
                const ddgUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
                const ddgRes = await fetch(ddgUrl, {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
                        'Accept': 'text/html,application/xhtml+xml',
                        'Accept-Language': 'en-US,en;q=0.9'
                    },
                    signal: AbortSignal.timeout(10000)
                });

                if (ddgRes.ok) {
                    const html = await ddgRes.text();
                    const titleMatches = [...html.matchAll(/<a[^>]+class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)];
                    const snippetMatches = [...html.matchAll(/<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g)];

                    for (let i = 0; i < Math.min(titleMatches.length, 7); i++) {
                        let href = titleMatches[i][1];
                        if (href.includes('uddg=')) {
                            try { href = decodeURIComponent(href.split('uddg=')[1].split('&')[0]); } catch {}
                        }
                        const title = titleMatches[i][2].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
                        const snippet = snippetMatches[i]
                            ? snippetMatches[i][1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
                            : '';
                        if (title && href.startsWith('http')) {
                            results.push({ url: href, title, snippet, source: 'ddg' });
                        }
                    }
                    console.log(`[Search] DDG HTML: ${results.length} results parsed`);
                }
            } catch (e) {
                console.warn('[Search] DDG HTML failed:', e.message);
            }
        }

        // ─── DDG Instant Answer API (last resort) ──────────────────────────
        if (results.length === 0) {
            try {
                console.log('[Search] Trying DDG Instant Answer API...');
                const apiUrl = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
                const apiRes = await fetch(apiUrl, {
                    headers: { 'User-Agent': 'OmniChatAI/2.0' },
                    signal: AbortSignal.timeout(8000)
                });
                const data = await apiRes.json();

                if (data.AbstractText) {
                    results.push({ url: data.AbstractURL || '', title: data.Heading || query, snippet: data.AbstractText, source: 'ddg-instant' });
                }
                (data.RelatedTopics || []).slice(0, 5).forEach(t => {
                    if (t.Text && t.FirstURL) {
                        results.push({ url: t.FirstURL, title: t.Text.substring(0, 100), snippet: t.Text, source: 'ddg-instant' });
                    }
                });
                console.log(`[Search] DDG Instant: ${results.length} results`);
            } catch (e) {
                console.warn('[Search] DDG Instant API failed:', e.message);
            }
        }

        // ─── Content Enrichment ────────────────────────────────────────────
        // For results that don't already have content (DDG), enrich top 4 via Jina or raw fetch
        const enrichedResults = await Promise.all(
            results.slice(0, 7).map(async (result) => {
                // Skip if already has rich content (Tavily) or no URL
                if (result.content && result.content.length > 200) return result;
                if (!result.url || !result.url.startsWith('http')) return result;

                const content = jinaEnabled
                    ? await fetchContentViaJina(result.url, charLimit)
                    : await fetchContentRaw(result.url, charLimit);

                return content ? { ...result, content } : result;
            })
        );

        // Merge: enriched top results + any remaining results without enrichment
        const finalResults = [...enrichedResults, ...results.slice(7)];
        const withContent = finalResults.filter(r => r.content && r.content.length > 50).length;

        const actualEngine = finalResults.length > 0 && finalResults[0].source && finalResults[0].source.includes('tavily') 
            ? 'tavily' 
            : 'ddg';

        console.log(`[Search] Done: ${finalResults.length} results (${withContent} with full content) | engine used: ${actualEngine}${jinaEnabled ? ' + Jina' : ''}`);

        res.json({
            results: finalResults,
            meta: {
                engine: actualEngine,
                jinaUsed: jinaEnabled,
                charLimit
            }
        });
    } catch (err) {
        console.error('[Search] Error:', err.message);
        res.status(500).json({ error: err.message, results: [] });
    }
});


// ─── Start ─────────────────────────────────────────────────────────────────────
const PORT = process.env.RAG_PORT || 3001;
app.listen(PORT, () => {
    console.log('');
    console.log('🧠 OmniChat RAG Server v2 started');
    console.log(`   URL:          http://localhost:${PORT}`);
    console.log(`   Vector store: ${STORE_PATH}`);
    console.log(`   Web search:   DuckDuckGo (default) + Tavily (when key provided by client)`);
    console.log(`   Content:      Raw fetch (default) + Jina Reader (when enabled by client)`);
    console.log('');
    console.log('   NOTE: All search config (charLimit, tavilyKey, useJina) is');
    console.log('         sent per-request from the UI — nothing hardcoded here.');
    console.log('');
});
