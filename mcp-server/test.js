import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

async function test() {
    console.log("Connecting to GH");
    const transport = new StdioClientTransport({
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-github"],
        env: { ...process.env, GITHUB_PERSONAL_ACCESS_TOKEN: 'fake_token' }
    });
    const client = new Client({ name: "test", version: "1" }, { capabilities: { tools: {} } });
    await client.connect(transport);
    const result = await client.listTools();
    const tools = result.tools.map(t => ({
        type: 'function',
        function: {
            name: `github__${t.name}`,
            description: t.description || 'no',
            parameters: t.inputSchema || { type: 'object', properties: {} }
        }
    }));
    
    console.log("Sending " + tools.length + " tools to Ollama...");
    const res = await fetch('http://localhost:11434/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            model: 'qwen2.5-coder:7b',
            messages: [{role: 'user', content: 'Can you list my github repos?'}],
            stream: false,
            tools: tools
        })
    });
    
    if (!res.ok) console.log("ERROR:", await res.text());
    else {
        const body = await res.json();
        console.log("Ollama tool_calls:", JSON.stringify(body.message?.tool_calls, null, 2));
        console.log("Ollama content:", body.message?.content);
    }
    process.exit(0);
}
test().catch(e => console.log(e));
