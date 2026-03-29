/**
 * RAG + Web Search client service
 * Talks to the local RAG server running on http://localhost:3001
 */

const RAG_SERVER = 'http://localhost:3001';
const RAG_TIMEOUT_MS = 8000;
const SEARCH_TIMEOUT_MS = 30000; // Tavily + Jina may need more time

async function fetchWithTimeout(url, options = {}, timeoutMs = RAG_TIMEOUT_MS) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const res = await fetch(url, { ...options, signal: controller.signal });
        clearTimeout(timer);
        return res;
    } catch (err) {
        clearTimeout(timer);
        throw err;
    }
}

/**
 * Add a Q&A pair to the local vector store.
 * Called automatically after every AI response.
 */
export async function addToRAG(question, answer, domain = 'General') {
    try {
        await fetchWithTimeout(`${RAG_SERVER}/rag/add`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ question, answer, domain, timestamp: Date.now() })
        });
    } catch (err) {
        console.warn('[RAG] Could not store memory (is rag-server running?):', err.message);
    }
}

/**
 * Find past memories similar to the current query.
 * Returns an array of { question, answer, domain, score } objects.
 */
export async function queryRAG(query, topK = 3) {
    try {
        const res = await fetchWithTimeout(`${RAG_SERVER}/rag/query`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query, topK, threshold: 0.45 })
        });
        const data = await res.json();
        return data.results || [];
    } catch (err) {
        console.warn('[RAG] Query failed (is rag-server running?):', err.message);
        return [];
    }
}

/**
 * Get total number of memories stored.
 */
export async function getRAGStats() {
    try {
        const res = await fetchWithTimeout(`${RAG_SERVER}/rag/stats`);
        return await res.json();
    } catch {
        return { total: 0, domains: {} };
    }
}

/**
 * Check if the RAG server is reachable.
 */
export async function checkRAGHealth() {
    try {
        const res = await fetchWithTimeout(`${RAG_SERVER}/health`);
        const data = await res.json();
        return data.status === 'ok';
    } catch {
        return false;
    }
}

/**
 * Search the web via the RAG server.
 *
 * @param {string} query        - Search query
 * @param {number} maxChars     - Max chars of page content to extract (from UI slider)
 * @param {string} tavilyKey    - Tavily API key (empty string = disabled, use DDG)
 * @param {boolean} useJina     - If true, use Jina Reader for clean content extraction
 * @returns {Promise<{results: Array, meta: Object}>}
 *   results — array of { title, url, snippet, content, source }
 *   meta    — { engine: 'tavily'|'ddg', jinaUsed: bool, charLimit: number }
 */
export async function webSearch(query, maxChars = 4000, tavilyKey = '', useJina = false) {
    try {
        const res = await fetchWithTimeout(`${RAG_SERVER}/search`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query, maxChars, tavilyKey, useJina })
        }, SEARCH_TIMEOUT_MS);
        const data = await res.json();
        return {
            results: data.results || [],
            // meta reflects what the server ACTUALLY used (may differ from request if Tavily failed)
            meta: data.meta || { engine: tavilyKey ? 'tavily' : 'ddg', jinaUsed: useJina }
        };
    } catch (err) {
        console.warn('[Search] Web search failed:', err.message);
        return { results: [], meta: { engine: 'ddg', jinaUsed: false } };
    }
}
