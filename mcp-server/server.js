import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { registerMcpServer, removeMcpServer, getAllTools, callTool, getActiveServers } from './mcp-manager.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

app.post('/mcp/connect', async (req, res) => {
    const { name, command, args, envVars } = req.body;
    if (!name || !command || !args) return res.status(400).json({ error: 'name, command, and args are required' });
    
    // GitHub Specific Verification
    if (name === 'github' && envVars.GITHUB_PERSONAL_ACCESS_TOKEN) {
        try {
            console.log(`[MCP] Verifying GitHub token for user: ${envVars.GITHUB_USERNAME}...`);
            const verifyRes = await fetch('https://api.github.com/user', {
                headers: { 
                    'Authorization': `token ${envVars.GITHUB_PERSONAL_ACCESS_TOKEN}`,
                    'Accept': 'application/vnd.github.v3+json',
                    'User-Agent': 'OmniChat-AI-Server'
                }
            });
            
            if (!verifyRes.ok) {
                const errData = await verifyRes.json();
                return res.status(401).json({ error: `GitHub Verification Failed: ${errData.message || 'Invalid token'}` });
            }
            
            const userData = await verifyRes.json();
            if (envVars.GITHUB_USERNAME && userData.login.toLowerCase() !== envVars.GITHUB_USERNAME.toLowerCase()) {
                console.warn(`[MCP] Warning: Token belongs to '${userData.login}', but UI provided '${envVars.GITHUB_USERNAME}'`);
            }
            console.log(`[MCP] GitHub Token Verified. Logged in as: ${userData.login}`);
        } catch (err) {
            console.error('[MCP] GitHub Verification Error:', err);
            return res.status(500).json({ error: 'Failed to reach GitHub API for token verification.' });
        }
    }

    const success = await registerMcpServer(name, command, args, envVars || {});
    if (success) {
        res.json({ success: true, activeServers: getActiveServers() });
    } else {
        res.status(500).json({ error: `Failed to connect to MCP server: ${name}` });
    }
});

app.post('/mcp/disconnect', (req, res) => {
    const { name } = req.body;
    removeMcpServer(name);
    res.json({ success: true, activeServers: getActiveServers() });
});

app.get('/mcp/status', (req, res) => {
    res.json({ activeServers: getActiveServers() });
});

app.get('/mcp/tools', async (req, res) => {
    const tools = await getAllTools();
    res.json({ tools, activeServers: getActiveServers() });
});

app.post('/mcp/call', async (req, res) => {
    const { toolName, args } = req.body;
    if (!toolName) return res.status(400).json({ error: 'toolName is required' });
    
    try {
        const result = await callTool(toolName, args || {});
        res.json({ success: true, result });
    } catch (err) {
        console.error(`[MCP] Tool Execution Error (${toolName}):`, err);
        res.status(500).json({ error: err.message || String(err) });
    }
});

const PORT = 3002;
app.listen(PORT, () => {
    console.log('');
    console.log('🔌 OmniChat MCP Server v1 started');
    console.log(`   URL:          http://localhost:${PORT}`);
    console.log('   Provides external tool access (GitHub, GitLab, etc.) via MCP');
    console.log('');
});
