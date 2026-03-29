import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const clients = new Map();

/**
 * Initialize an MCP Server connection (e.g. GitHub or GitLab)
 */
export async function registerMcpServer(serverName, command, args, envVars = {}) {
    console.log(`[MCP] Registering server: ${serverName}...`);
    try {
        const transport = new StdioClientTransport({
            command,
            args,
            env: { ...process.env, ...envVars }
        });

        const client = new Client(
            { name: "omnichat-client", version: "1.0.0" },
            { capabilities: { tools: {} } }
        );

        await client.connect(transport);
        clients.set(serverName, client);
        console.log(`[MCP] Successfully connected to ${serverName}`);
        return true;
    } catch (error) {
        console.error(`[MCP] Failed to connect to ${serverName}:`, error);
        return false;
    }
}

/**
 * Remove an MCP server
 */
export function removeMcpServer(serverName) {
    if (clients.has(serverName)) {
        // The transport doesn't have a direct close, but the client might.
        // We'll just remove it from our map so no more calls are made.
        clients.delete(serverName);
        console.log(`[MCP] Removed server: ${serverName}`);
    }
}

/**
 * Fetch all available tools from all connected MCP servers
 */
export async function getAllTools() {
    const allTools = [];
    
    for (const [serverName, client] of clients.entries()) {
        try {
            const result = await client.listTools();
            // Attach the serverName to each tool so we know where to route it later
            const toolsWithServer = result.tools.map(tool => ({
                ...tool,
                _serverName: serverName, // internal tracking prefix
                // Function calling requires names to match ^[a-zA-Z0-9_-]{1,64}$
                // Some MCP tools might use other chars, but usually they are fine.
                // We'll rewrite the name to include the server namespace to prevent collisions
                name: `${serverName}__${tool.name}`
            }));
            allTools.push(...toolsWithServer);
        } catch (error) {
            console.error(`[MCP] Failed to list tools for ${serverName}:`, error);
        }
    }
    
    return allTools;
}

/**
 * Execute a specific tool on its corresponding MCP server
 */
export async function callTool(toolNameWithPrefix, args) {
    // Determine which server this tool belongs to based on the prefix
    const parts = toolNameWithPrefix.split('__');
    if (parts.length < 2) {
        throw new Error(`Tool name does not contain server prefix: ${toolNameWithPrefix}`);
    }
    
    const serverName = parts[0];
    const actualToolName = parts.slice(1).join('__'); // in case tool name has '__'
    
    const client = clients.get(serverName);
    if (!client) {
        throw new Error(`MCP Server not found or not connected: ${serverName}`);
    }

    console.log(`[MCP] Calling ${actualToolName} on ${serverName} with args:`, args);
    const result = await client.callTool({
        name: actualToolName,
        arguments: args
    });

    return result;
}

/**
 * Return info about active connections
 */
export function getActiveServers() {
    return Array.from(clients.keys());
}
