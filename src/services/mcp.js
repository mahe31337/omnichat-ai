const MCP_SERVER_URL = typeof process !== 'undefined' && process.env ? (process.env.VITE_MCP_URL || 'http://localhost:3002') : (import.meta.env?.VITE_MCP_URL || 'http://localhost:3002');

export async function fetchMcpTools() {
    try {
        const res = await fetch(`${MCP_SERVER_URL}/mcp/tools`, { signal: AbortSignal.timeout(15000) });
        if (!res.ok) return [];
        const data = await res.json();
        return data.tools || [];
    } catch {
        return [];
    }
}

export async function checkMcpStatus() {
    try {
        const res = await fetch(`${MCP_SERVER_URL}/mcp/status`, { signal: AbortSignal.timeout(15000) });
        if (!res.ok) return [];
        const data = await res.json();
        return data.activeServers || [];
    } catch {
        return [];
    }
}

function parseMcpToolResult(data) {
    if (!data || !data.result) return null;
    if (data.result.content && Array.isArray(data.result.content)) {
        const text = data.result.content.map(c => c?.text || '').join('\n');
        try {
            const json = JSON.parse(text);
            return json;
        } catch {
            return text;
        }
    }
    return data.result;
}

function formatMcpResultText(payload) {
    if (payload === undefined || payload === null) return 'No result returned';
    if (typeof payload === 'string') return payload;
    try {
        return JSON.stringify(payload, null, 2);
    } catch {
        return String(payload);
    }
}

function mergeGrafanaResults(primary, fallback) {
    if (!Array.isArray(primary)) return Array.isArray(fallback) ? fallback : [];
    if (!Array.isArray(fallback)) return primary;
    const seen = new Map();
    const push = (item) => {
        const key = item.uid || item.url || JSON.stringify(item);
        if (!seen.has(key)) seen.set(key, item);
    };
    primary.forEach(push);
    fallback.forEach(push);
    return Array.from(seen.values());
}

export async function executeMcpTool(toolName, args) {
    console.log(`[MCP] Executing tool: ${toolName}`, args);

    const runTool = async (queryArg = null) => {
        const bodyArgs = queryArg !== null ? { ...args, query: queryArg } : args;
        const res = await fetch(`${MCP_SERVER_URL}/mcp/call`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ toolName, args: bodyArgs }),
        });
        const data = await res.json();
        if (!data.success) {
            throw new Error(data.error || 'Unknown MCP tool error');
        }
        return data;
    };

    try {
        if (toolName === 'grafana__search_dashboards') {
            const originalData = await runTool();
            const originalParsed = parseMcpToolResult(originalData);
            let dashboards = Array.isArray(originalParsed) ? originalParsed : [];

            if ((!dashboards || dashboards.length === 0) && typeof args?.query === 'string') {
                // Support `A or B` style Grafana search queries by trying each term.
                const orTokens = args.query.split(/\s+or\s+|\s*\|\|\s*/i).map(t => t.trim()).filter(Boolean);
                if (orTokens.length > 1) {
                    for (const token of orTokens) {
                        const fallbackData = await runTool(token);
                        const parsed = parseMcpToolResult(fallbackData);
                        if (Array.isArray(parsed)) {
                            dashboards = mergeGrafanaResults(dashboards, parsed);
                        }
                    }
                }
            }

            if ((!dashboards || dashboards.length === 0) && args?.query) {
                // No results yet: try empty query to list all dashboards and filter locally.
                const fallbackData = await runTool('');
                const allDashboards = parseMcpToolResult(fallbackData);
                if (Array.isArray(allDashboards)) {
                    const terms = args.query.split(/\s+or\s+|\s*,\s+|\s+/i).map(t => t.trim().toLowerCase()).filter(Boolean);
                    dashboards = allDashboards.filter(dashboard => {
                        const haystack = `${dashboard.title || ''} ${dashboard.tags?.join(' ') || ''} ${dashboard.folderTitle || ''}`.toLowerCase();
                        return terms.some(term => haystack.includes(term));
                    });
                }
            }

            return formatMcpResultText(dashboards);
        }

        const data = await runTool();
        const parsed = parseMcpToolResult(data);
        return formatMcpResultText(parsed);
    } catch (err) {
        return `Execution error: ${err.message}`;
    }
}


// Formatters for different LLMs
export function formatToolsForOpenAI(tools) {
    if (!tools || tools.length === 0) return undefined;
    return tools.map(t => ({
        type: 'function',
        function: {
            name: t.name,
            description: t.description || 'No description',
            parameters: t.inputSchema || { type: 'object', properties: {} }
        }
    }));
}

export function formatToolsForGemini(tools) {
    if (!tools || tools.length === 0) return undefined;
    return [{
        functionDeclarations: tools.map(t => ({
            name: t.name,
            description: t.description || 'No description',
            parameters: t.inputSchema || { type: 'object', properties: {} }
        }))
    }];
}

export function formatToolsForAnthropic(tools) {
    if (!tools || tools.length === 0) return undefined;
    return tools.map(t => ({
        name: t.name,
        description: t.description || 'No description',
        input_schema: t.inputSchema || { type: 'object', properties: {} }
    }));
}

export function formatToolsForOllama(tools) {
    // Ollama uses OpenAI format
    return formatToolsForOpenAI(tools);
}
