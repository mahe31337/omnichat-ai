const MCP_SERVER_URL = typeof process !== 'undefined' && process.env ? (process.env.VITE_MCP_URL || 'http://localhost:3002') : (import.meta.env?.VITE_MCP_URL || 'http://localhost:3002');

export async function fetchMcpTools() {
    try {
        const res = await fetch(`${MCP_SERVER_URL}/mcp/tools`, { signal: AbortSignal.timeout(3000) });
        if (!res.ok) return [];
        const data = await res.json();
        return data.tools || [];
    } catch {
        return [];
    }
}

export async function checkMcpStatus() {
    try {
        const res = await fetch(`${MCP_SERVER_URL}/mcp/status`, { signal: AbortSignal.timeout(3000) });
        if (!res.ok) return [];
        const data = await res.json();
        return data.activeServers || [];
    } catch {
        return [];
    }
}

export async function executeMcpTool(toolName, args) {
    console.log(`[MCP] Executing tool: ${toolName}`, args);
    try {
        const res = await fetch(`${MCP_SERVER_URL}/mcp/call`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ toolName, args })
        });
        const data = await res.json();
        if (data.success) {
            // MCP returns lists of content blocks, we'll extract text for simplicity
            let resultText = "Success";
            if (data.result && data.result.content) {
                resultText = data.result.content.map(c => c.text).join('\n');
            }
            return resultText || JSON.stringify(data.result);
        } else {
            return `Tool error: ${data.error}`;
        }
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
