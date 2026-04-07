import { BedrockAgentRuntimeClient, InvokeAgentCommand } from "@aws-sdk/client-bedrock-agent-runtime";
import { BedrockRuntimeClient, InvokeModelCommand, InvokeModelWithResponseStreamCommand } from "@aws-sdk/client-bedrock-runtime";
import { GoogleGenerativeAI } from "@google/generative-ai";
import OpenAI from "openai";
import { fetchMcpTools, executeMcpTool, formatToolsForOpenAI, formatToolsForGemini } from "./mcp.js";

// A wrapper to handle recursive tool calls for OpenAI and Ollama
export async function sendMessage(messages, agentConfig, sessionId = "default-sess-1", signal = null, onChunk = null, enabledPluginIds = []) {
    let currentMessages = [...messages];
    let maxRounds = 4; // Limit tool chaining to prevent infinite loops
    let round = 0;
    const { provider } = agentConfig;

    // Fetch available MCP tools dynamically if enabled - then filter by user selection
    const allToolsRaw = (enabledPluginIds && enabledPluginIds.length > 0) ? await fetchMcpTools() : [];
    const toolsRaw = allToolsRaw.filter(t => enabledPluginIds.includes(t._serverName));

    // --- Dynamic Multi-Plugin Context Injection ---
    if (enabledPluginIds.length > 0) {
        let mcpContexts = [];
        
        if (enabledPluginIds.includes('github')) {
            try {
                const githubData = JSON.parse(localStorage.getItem('bedrock_ui_mcp_form') || '{}');
                let ghContext = `- GitHub (namespace: 'github__'): Active User is '${githubData.gitUser || 'Unknown'}'.\n`;
                ghContext += `      * CRITICAL GITHUB FILE RULE: When asked to edit or update an existing file (like README.md), you MUST FIRST use 'github__get_file_contents' to fetch its current content and SHA. You must preserve the existing contents, make the user's requested modifications, and then use 'github__create_or_update_file' with the new combined content and the fetched SHA. NEVER overwrite a file blindly.\n`;
                ghContext += `      * CRITICAL SCHEMA RULE: Ensure all tool arguments strictly adhere to their JSON schema types. If a tool expects a number (e.g., 'issue_number'), pass a Number (e.g., 123) and not a String (e.g., "123").`;
                mcpContexts.push(ghContext);
            } catch {}
        }
        if (enabledPluginIds.includes('prometheus')) {
            try {
                const promData = JSON.parse(localStorage.getItem('bedrock_ui_mcp_prometheus_form') || '{}');
                if (promData.prometheusUrl) {
                    const now = Math.floor(Date.now() / 1000);
                    mcpContexts.push(`- Prometheus (namespace: 'prometheus__'): Server is at '${promData.prometheusUrl}'. CURRENT UNIX: ${now}.`);
                }
            } catch {}
        }
        if (enabledPluginIds.includes('grafana')) {
            try {
                const grafanaData = JSON.parse(localStorage.getItem('bedrock_ui_mcp_grafana_form') || '{}');
                if (grafanaData.grafanaUrl) mcpContexts.push(`- Grafana (namespace: 'grafana__'): Active! Instance at '${grafanaData.grafanaUrl}'. 
                    * ALERT: If you think you don't have access, you DO. Use 'grafana__search_dashboards' with query: '' to see all dashboards.`);
            } catch {}
        }

        if (mcpContexts.length > 0) {
            const fullContext = `\n\n[MCP PLUGIN DIRECTORY]\nNamespace prefix is required (e.g. grafana__search_dashboards):\n${mcpContexts.join('\n')}\n`;
            
            // Non-mutating update of system message
            const systemMsg = currentMessages.find(m => m.role === 'system');
            if (systemMsg) {
                // Return a NEW array with a CLONED system message to prevent accumulating context
                currentMessages = currentMessages.map(m => m.role === 'system' ? { ...m, content: m.content + fullContext } : m);
            } else {
                currentMessages = [{ role: 'system', content: `You are a helpful AI assistant.${fullContext}` }, ...currentMessages];
            }
        }
    }

    console.log(`[LLM] Tools available for ${provider}:`, toolsRaw.map(t => t.name));

    let finalAccumulatedText = "";

    while (round < maxRounds) {
        round++;

        let toolCallDetected = false;
        let toolCalls = []; // Accumulate tool calls here
        let roundResponse = "";

        // Send the actual API request
        let responseData;
        try {
            responseData = await executeProviderCall(
                currentMessages,
                agentConfig,
                sessionId,
                signal,
                toolsRaw,
                // Custom onChunk to intercept tool notifications without breaking UI
                (chunkText) => {
                    roundResponse += chunkText;
                    finalAccumulatedText += chunkText;
                    if (onChunk && !toolCallDetected) {
                        onChunk(chunkText);
                    }
                },
                // Callback when a tool call is fully parsed
                (tCalls) => {
                    toolCallDetected = true;
                    toolCalls = tCalls;
                }
            );
        } catch (err) {
            console.warn('[LLM] executeProviderCall error:', err.message || err);
            // Grafana fallback for systematic function call fails
            if (typeof err.message === 'string' && err.message.includes('Failed to call a function')) {
                const lastContent = (currentMessages[currentMessages.length - 1] || {}).content || '';
                const isGrafana = lastContent.toLowerCase().includes('grafana') || lastContent.toLowerCase().includes('dashboard');
                if (isGrafana && enabledPluginIds.includes('grafana')) {
                    const queryMatch = lastContent.match(/(?:mention|contains?|with|for)\s+(['"]?)([^'"\n]+?)\1/i);
                    const query = (queryMatch && queryMatch[2]) ? queryMatch[2].trim() : '';
                    try {
                        const fallbackResult = await executeMcpTool('grafana__search_dashboards', { query });
                        const fallbackBlock = `\n\n*(⚙️ Grafana fallback executed)*\n\n🛠️ **Result of grafana__search_dashboards**\n\n\`\`\`text\n${fallbackResult}\n\`\`\`\n\n`;
                        if (onChunk) onChunk(fallbackBlock);
                        return finalAccumulatedText + fallbackBlock;
                    } catch (fallbackErr) {
                        console.warn('[LLM] Grafana fallback failed:', fallbackErr);
                    }
                }
            }
            throw err;
        }

        // If no tools were formally detected by the provider, try a heuristic check for raw JSON in the text
        if (!toolCallDetected && responseData.trim()) {
            const jsonRegex = /{[\s\S]*}/;
            const match = responseData.match(jsonRegex);
            if (match) {
                try {
                    const candidate = JSON.parse(match[0].trim());
                    if (candidate && typeof candidate.name === 'string' && candidate.name.includes('__')) {
                        console.warn('[OmniChat] Intercepted raw JSON in AI response as a tool call:', candidate.name);
                        toolCallDetected = true;
                        toolCalls = [{
                            id: 'call_fallback_' + Date.now(),
                            name: candidate.name,
                            arguments: candidate.arguments || {}
                        }];
                    }
                } catch (e) {
                    // Not valid JSON or doesn't look like our tools
                }
            }
        }

        if (toolCallDetected && toolCalls.length > 0) {
            // Let the UI know we are pausing to run a tool
            const indicator = `\n\n*(⚙️ Executing tool: ${toolCalls[0].name}...)*\n\n`;
            if (onChunk) onChunk(indicator);
            finalAccumulatedText += indicator;

            // Append assistant's tool call request to history
            const generatedIds = toolCalls.map(tc => tc.id || `call_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`);

            if (agentConfig.provider === 'openai' || agentConfig.provider === 'groq') {
                currentMessages.push({ role: 'assistant', content: null, tool_calls: toolCalls.map((tc, i) => ({ id: generatedIds[i], type: 'function', function: { name: tc.name, arguments: JSON.stringify(tc.arguments) } })) });
            } else if (agentConfig.provider === 'ollama' || agentConfig.provider === 'bedrock' || agentConfig.provider === 'gemini') {
                currentMessages.push({ role: 'assistant', content: "", tool_calls: toolCalls.map((tc, i) => ({ function: { name: tc.name, arguments: tc.arguments } })) });
            }

            // Execute the tools
            for (let i = 0; i < toolCalls.length; i++) {
                const tc = toolCalls[i];
                const actionResult = await executeMcpTool(tc.name, tc.arguments);

                // Render the tool output immediately in the UI
                const resultSnippet = String(actionResult);
                const isJson = resultSnippet.startsWith('{') || resultSnippet.startsWith('[');
                const toolUiBlock = `\n\n🛠️ **Result of \`${tc.name}\`**\n\n\`\`\`${isJson ? 'json' : 'text'}\n${resultSnippet.substring(0, 12000)}${resultSnippet.length > 12000 ? '\n... (truncated)' : ''}\n\`\`\`\n\n`;


                if (onChunk) onChunk(toolUiBlock);
                finalAccumulatedText += toolUiBlock;

                // Append result back to history
                if (agentConfig.provider === 'openai' || agentConfig.provider === 'groq') {
                    currentMessages.push({ role: 'tool', tool_call_id: generatedIds[i], name: tc.name, content: String(actionResult) });
                } else if (agentConfig.provider === 'ollama') {
                    currentMessages.push({ role: 'tool', content: String(actionResult) });
                }
            }

            continue;
        }

        // If no tools were called, we may still be answering Grafana dashboard queries directly.
        if (!toolCallDetected) {
            const lastMsg = (currentMessages[currentMessages.length - 1] || {}).content || "";
            const isGrafana = lastMsg.toLowerCase().includes('grafana') || lastMsg.toLowerCase().includes('dashboard') || lastMsg.toLowerCase().includes('alert');
            const grafanaTool = toolsRaw.find(t => t.name === 'grafana__search_dashboards' || t.name === 'grafana_search_dashboards');

            if (isGrafana && grafanaTool) {
                // If the model failed to call the tool, run fallback tool directly.
                let fallbackQuery = '';
                const mentionMatch = lastMsg.match(/(?:mention|includes?)\s+(['"]?)([^'"\n]+?)\1/i);
                if (mentionMatch && mentionMatch[2]) {
                    fallbackQuery = mentionMatch[2].trim();
                } else {
                    const byKeyword = lastMsg.replace(/list all dashboards in grafana/i, '').replace(/dashboards?/i, '').trim();
                    if (byKeyword.length > 0) {
                        fallbackQuery = byKeyword;
                    }
                }

                try {
                    const toolResult = await executeMcpTool('grafana__search_dashboards', { query: fallbackQuery });
                    const toolUiBlock = `\n\n*(⚙️ Fallback executing tool: grafana__search_dashboards...)*\n\n🛠️ **Result of grafana__search_dashboards**\n\n\`\`\`text\n${toolResult}\n\`\`\`\n\n`;
                    if (onChunk) onChunk(toolUiBlock);
                    return (finalAccumulatedText || '') + toolUiBlock;
                } catch (err) {
                    // Give original response if fallback fails.
                    console.warn('[LLM] Grafana fallback tool invocation failed', err);
                }
            }

            return finalAccumulatedText || responseData;
        }
    }

    return finalAccumulatedText || "Error: Exceeded maximum tool execution rounds.";
}


// The underlying single-turn executor
async function executeProviderCall(messages, agentConfig, sessionId, signal, toolsRaw, onChunk, onToolCallsObj) {
    const { provider, model, apiKey, url, bedrockRegion, bedrockAccessKey, bedrockSecretKey, bedrockAgentId, bedrockAgentAliasId } = agentConfig;
    const shouldStream = import.meta.env.VITE_STREAM_RESPONSE === 'true' && typeof onChunk === 'function';

    if (provider === 'openai' || provider === 'groq') {
        const clientConfig = { apiKey: apiKey, dangerouslyAllowBrowser: true };
        if (provider === 'groq') clientConfig.baseURL = "https://api.groq.com/openai/v1";

        const client = new OpenAI(clientConfig);

        // Remove any non-standard properties (like agentName used in UI)
        const sanitizedMessages = messages.map(m => {
            const sanitized = { role: m.role, content: m.content || "" };
            if (m.tool_calls) sanitized.tool_calls = m.tool_calls;
            if (m.tool_call_id) sanitized.tool_call_id = m.tool_call_id;
            if (m.name) sanitized.name = m.name;
            return sanitized;
        });

        const payload = { model: model || (provider === 'groq' ? 'llama-3.3-70b-versatile' : 'gpt-4o'), messages: sanitizedMessages, stream: shouldStream };

        // --- Groq-specific Tool Handlings ---
        // Groq uses a strict tool-calling spec on Llama-3. 
        // 1. It often hates double underscores in tool names.
        // 2. It requires very clean JSON schemas for parameters.
        const fRawMappedTotal = formatToolsForOpenAI(toolsRaw) || [];
        const groqToolNameMap = new Map();

        const fRawMappedTotalSanitized = fRawMappedTotal.map(t => {
            if (provider === 'groq' && t.function && typeof t.function.name === 'string') {
                const sanitizedName = t.function.name.replace(/__+/g, '_').replace(/[^a-zA-Z0-9_-]/g, '_').replace(/^([^a-zA-Z_])/, '_$1');
                groqToolNameMap.set(sanitizedName, t.function.name);
                return {
                    ...t,
                    function: {
                        ...t.function,
                        name: sanitizedName
                    }
                };
            }
            return t;
        });

        // --- Semantic Tool Prioritization for Groq ---
        // Groq/Llama-3 can fail if the tool set is too large (>20). 
        // We reorder tools based on keywords in the message to ensure relevance.
        let fRawMapped = fRawMappedTotalSanitized;
        if (provider === 'groq' && fRawMappedTotalSanitized.length > 15) {
            const lastMsg = messages[messages.length - 1]?.content?.toLowerCase() || "";
            const isPrometheus = lastMsg.includes('prometheus') || lastMsg.includes('metrics') || lastMsg.includes('health') || lastMsg.includes('node');
            const isGithub = lastMsg.includes('github') || lastMsg.includes('repo') || lastMsg.includes('pr') || lastMsg.includes('issue');
            const isGrafana = lastMsg.includes('grafana') || lastMsg.includes('dashboard') || lastMsg.includes('alert') || lastMsg.includes('visual');

            // 1. Separate relevant namespace tools from Others
            const relevant = [];
            const common = [];
            const remainder = [];

            fRawMappedTotal.forEach(t => {
                const name = t.function.name.toLowerCase();
                if (isPrometheus && name.startsWith('prometheus')) relevant.push(t);
                else if (isGithub && name.startsWith('github')) relevant.push(t);
                else if (isGrafana && name.startsWith('grafana')) relevant.push(t);
                else if (name.includes('query') || name.includes('list') || name.includes('get')) common.push(t); // Keep helpful exploration tools
                else remainder.push(t);
            });

            // 2. Build prioritized list (Namespace first, then Common, then rest)
            fRawMapped = [...relevant, ...common, ...remainder].slice(0, 20); // Cap at 20 most relevant tools
        }

        const fTools = fRawMapped.length > 0 ? fRawMapped.map(t => {
            if (provider === 'groq') {
                return {
                    ...t,
                    function: {
                        ...t.function,
                        name: t.function.name,
                        description: (t.function.description || 'No description').substring(0, 300),
                        parameters: {
                            type: 'object',
                            properties: t.function.parameters.properties || {},
                            required: t.function.parameters.required || []
                        }
                    }
                };
            }
            return t;
        }) : undefined;

        if (fTools && fTools.length > 0) {
            payload.tools = fTools;
            if (provider === 'groq') {
                payload.tool_choice = 'auto';
                payload.parallel_tool_calls = false; // Groq is more stable with parallel tools OFF
            }
        }

        const response = await client.chat.completions.create(payload, { signal });

        if (shouldStream) {
            let fullText = "";
            let tCallsBuffer = {};

            for await (const chunk of response) {
                const delta = chunk.choices[0]?.delta;

                if (delta?.tool_calls) {
                    delta.tool_calls.forEach(tc => {
                        if (!tCallsBuffer[tc.index]) tCallsBuffer[tc.index] = { id: tc.id, name: tc.function.name, arguments: "" };
                        if (tc.function?.arguments) tCallsBuffer[tc.index].arguments += tc.function.arguments;
                    });
                } else if (delta?.content) {
                    fullText += delta.content;
                    onChunk(delta.content);
                }
            }

            const finalTools = Object.values(tCallsBuffer);
            if (finalTools.length > 0) {
                const parsedTools = finalTools.map(tc => {
                    let toolName = tc.name;
                    let args = JSON.parse(tc.arguments || '{}');
                    // If we sanitized the name for Groq, restore it now
                    const restoredName = groqToolNameMap.get(tc.name) || tc.name;
                    const original = toolsRaw.find(rt => rt.name === restoredName);
                    if (original) {
                        toolName = original.name;
                        // Groq/Llama-3 often pass numbers and booleans as strings — cast them back based on schema
                        if (original.inputSchema?.properties) {
                            Object.keys(original.inputSchema.properties).forEach(key => {
                                const prop = original.inputSchema.properties[key];
                                if (args[key] !== undefined) {
                                    if ((prop.type === 'number' || prop.type === 'integer') && typeof args[key] === 'string') args[key] = Number(args[key]);
                                    if (prop.type === 'boolean' && typeof args[key] === 'string') args[key] = (args[key].toLowerCase() === 'true');
                                }
                            });
                        }
                    }
                    return { id: tc.id, name: toolName, arguments: args };
                });
                onToolCallsObj(parsedTools);
            }
            return fullText;
        } else {
            const msg = response.choices[0].message;
            if (msg.tool_calls && msg.tool_calls.length > 0) {
                const parsedTools = msg.tool_calls.map(tc => {
                    let toolName = tc.function.name;
                    let args = JSON.parse(tc.function.arguments || '{}');
                    const restoredName = groqToolNameMap.get(tc.function.name) || tc.function.name;
                    const original = toolsRaw.find(rt => rt.name === restoredName);
                    if (original) {
                        toolName = original.name;
                        // Cast types for Groq
                        if (original.inputSchema?.properties) {
                            Object.keys(original.inputSchema.properties).forEach(key => {
                                const prop = original.inputSchema.properties[key];
                                if (args[key] !== undefined) {
                                    if ((prop.type === 'number' || prop.type === 'integer') && typeof args[key] === 'string') args[key] = Number(args[key]);
                                    if (prop.type === 'boolean' && typeof args[key] === 'string') args[key] = (args[key].toLowerCase() === 'true');
                                }
                            });
                        }
                    }
                    return { id: tc.id, name: toolName, arguments: args };
                });
                onToolCallsObj(parsedTools);
                return "";
            }
            return msg.content;
        }
    }

    else if (provider === 'ollama') {
        let baseUrl = url || 'http://localhost:11434';
        baseUrl = baseUrl.replace(/\/+$/, '');

        const payload = {
            model: model || 'llama3',
            messages: messages.map(m => {
                const sanitized = { role: m.role, content: m.content || "" };
                if (m.tool_calls) sanitized.tool_calls = m.tool_calls;
                if (m.tool_call_id) sanitized.tool_call_id = m.tool_call_id;
                if (m.name) sanitized.name = m.name;
                return sanitized;
            }),
            stream: shouldStream,
            options: { num_ctx: 24576 } // Crucial for MCP: 26+ tools take up tremendous context
        };

        const fTools = formatToolsForOpenAI(toolsRaw);
        if (fTools && fTools.length > 0) payload.tools = fTools;

        const response = await fetch(`${baseUrl}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            signal: signal
        });

        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`Ollama fetch failed (${response.status}): ${errText}`);
        }

        if (!shouldStream) {
            const data = await response.json();
            const toolCalls = data.message?.tool_calls || [];

            if (toolCalls && toolCalls.length > 0) {
                const parsedTools = toolCalls.map(tc => ({ id: tc.id || tc.function?.id || 'call_' + Math.random().toString(36).substr(2, 9), name: tc.function?.name || tc.name, arguments: tc.function?.arguments || tc.arguments || {} }));
                onToolCallsObj(parsedTools);
                return "";
            }
            return data.message.content;
        } else {
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let fullText = "";
            let toolCallsAcc = [];

            let buffer = ""; // Required to merge partial bytes across stream chunks

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                const chunkData = decoder.decode(value, { stream: true });
                buffer += chunkData;
                const lines = buffer.split('\n');

                // The last element is inherently incomplete (or empty string if it ended perfectly on \n)
                buffer = lines.pop();

                for (const line of lines) {
                    if (!line.trim()) continue;
                    try {
                        const parsed = JSON.parse(line);
                        if (parsed.message?.tool_calls) {
                            toolCallsAcc.push(...parsed.message.tool_calls);
                        } else if (parsed.message?.content) {
                            fullText += parsed.message.content;
                            onChunk(parsed.message.content);
                        }
                    } catch (e) {
                        console.warn('Ollama stream parsing error on line:', e);
                    }
                }
            }

            if (buffer.trim()) {
                try {
                    const parsed = JSON.parse(buffer);
                    if (parsed.message?.tool_calls) {
                        toolCallsAcc.push(...parsed.message.tool_calls);
                    } else if (parsed.message?.content) {
                        fullText += parsed.message.content;
                        onChunk(parsed.message.content);
                    }
                } catch (e) {
                    console.warn('Ollama stream parsing error on final buffer:', e);
                }
            }

            if (toolCallsAcc.length > 0) {
                const parsedTools = toolCallsAcc.map(tc => ({ id: tc.id || tc.function?.id || 'call_' + Math.random().toString(36).substr(2, 9), name: tc.function?.name || tc.name, arguments: tc.function?.arguments || tc.arguments || {} }));
                onToolCallsObj(parsedTools);
                return fullText;
            }

            return fullText;
        }
    }

    // -- For Gemini & Bedrock, we'll keep their existing logic unmodified for now to guarantee stability. 
    // They will just return text strings as usual if you switch to them. --

    else if (provider === 'gemini') {
        const geminiTools = formatToolsForGemini(toolsRaw);
        const genAI = new GoogleGenerativeAI(apiKey);
        const genModel = genAI.getGenerativeModel({ model: model || 'gemini-1.5-pro-latest', tools: geminiTools });
        const systemInstruction = messages.find(m => m.role === 'system')?.content;
        let filteredMessages = messages.filter(m => m.role !== 'system');
        while (filteredMessages.length > 0 && filteredMessages[0].role === 'assistant') filteredMessages.shift();

        const chatHistory = filteredMessages.slice(0, -1).map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }));
        const lastMessage = messages[messages.length - 1].content;

        const chatObj = { history: chatHistory, tools: geminiTools };
        if (systemInstruction) chatObj.systemInstruction = { parts: [{ text: systemInstruction }] };
        const chat = genModel.startChat(chatObj);

        const extractToolCallsFromGemini = (resp) => {
            const candidates = resp?.response?.candidates || [];
            const toolCalls = [];
            for (const candidate of candidates) {
                const parts = candidate?.content?.parts || [];
                for (const part of parts) {
                    if (part.functionCall && part.functionCall.name) {
                        toolCalls.push({
                            id: `gemini_tool_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
                            name: part.functionCall.name,
                            arguments: part.functionCall.arguments || {}
                        });
                    }
                }
            }
            return toolCalls;
        };

        if (shouldStream) {
            const result = await chat.sendMessageStream(lastMessage);
            let fullText = "";
            let toolCalls = [];
            for await (const chunk of result.stream) {
                const chunkText = chunk.text ? chunk.text() : (chunk?.content || '');
                fullText += chunkText;
                onChunk(chunkText);

                if (chunk?.functionCall) {
                    toolCalls.push({
                        id: `gemini_tool_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
                        name: chunk.functionCall.name,
                        arguments: chunk.functionCall.arguments || {}
                    });
                }
            }

            if (toolCalls.length > 0 && onToolCallsObj) {
                onToolCallsObj(toolCalls);
                return fullText;
            }
            return fullText;
        } else {
            const result = await chat.sendMessage(lastMessage);
            const toolCalls = extractToolCallsFromGemini(result);
            if (toolCalls.length > 0 && onToolCallsObj) {
                onToolCallsObj(toolCalls);
                return "";
            }

            if (result?.response?.text) {
                return typeof result.response.text === 'function' ? result.response.text() : result.response.text;
            }
            if (result?.response?.candidates?.[0]?.content?.parts) {
                const parts = result.response.candidates[0].content.parts;
                const textPart = parts.find(p => p.text);
                return textPart?.text || '';
            }

            return String(result?.response || result || '');
        }
    }

    else if (provider === 'bedrock-agent') {
        const client = new BedrockAgentRuntimeClient({
            region: bedrockRegion || 'us-east-1',
            credentials: { accessKeyId: bedrockAccessKey, secretAccessKey: bedrockSecretKey }
        });
        const lastMessage = messages[messages.length - 1].content;
        const command = new InvokeAgentCommand({
            agentId: bedrockAgentId, agentAliasId: bedrockAgentAliasId,
            sessionId: sessionId.substring(0, 100), inputText: lastMessage, enableTrace: true
        });

        const response = await client.send(command, { abortSignal: signal });
        let completion = "";
        let traces = [];

        if (response.completion !== undefined) {
            const decoder = new TextDecoder("utf-8");
            for await (const event of response.completion) {
                if (event.chunk && event.chunk.bytes) {
                    const chunkStr = decoder.decode(event.chunk.bytes, { stream: true });
                    completion += chunkStr;
                    if (shouldStream) onChunk(chunkStr);
                } else if (event.trace) traces.push(event.trace);
            }
            completion += decoder.decode();
        }

        if (traces.length > 0) {
            let traceOutputs = '\n\n---\n### 🤖 Agent Thought Process\n';
            traces.forEach(t => {
                const orch = t.trace?.orchestrationTrace;
                if (!orch) return;
                if (orch.rationale?.text) traceOutputs += `> **Thinking:** *${orch.rationale.text.trim().replace(/\n/g, ' ')}*\n\n`;
                if (orch.invocationInput?.actionGroupInvocationInput) traceOutputs += `> **Tool Call:** \`${orch.invocationInput.actionGroupInvocationInput.actionGroupName}\`\n\n`;
                if (orch.observation?.actionGroupInvocationOutput) traceOutputs += `> **Tool Result:** *Success*\n\n`;
                if (orch.observation?.finalResponse?.text) traceOutputs += `\n\n${orch.observation.finalResponse.text}\n`;
            });
            completion += traceOutputs;
            completion += `\n\n<details><summary>🔍 *View Raw Agent Traces*</summary>\n\n\`\`\`json\n${JSON.stringify(traces, null, 2)}\n\`\`\`\n</details>`;
        }
        return completion || "Empty response from Bedrock Agent.";
    }

    else if (provider === 'bedrock') {
        const client = new BedrockRuntimeClient({
            region: bedrockRegion || 'us-east-1',
            credentials: { accessKeyId: bedrockAccessKey, secretAccessKey: bedrockSecretKey }
        });
        const systemMessage = messages.find(m => m.role === 'system')?.content;
        const chatMessages = messages.filter(m => m.role !== 'system').map(m => ({ role: m.role, content: [{ type: 'text', text: m.content }] }));
        const payload = { anthropic_version: "bedrock-2023-05-31", max_tokens: 4096, messages: chatMessages };
        if (systemMessage) payload.system = systemMessage;

        if (shouldStream) {
            const command = new InvokeModelWithResponseStreamCommand({ modelId: model, contentType: "application/json", accept: "application/json", body: JSON.stringify(payload) });
            const response = await client.send(command, { abortSignal: signal });
            let fullText = "";
            for await (const event of response.body) {
                if (event.chunk && event.chunk.bytes) {
                    const chunkData = JSON.parse(new TextDecoder().decode(event.chunk.bytes));
                    if (chunkData.type === 'content_block_delta' && chunkData.delta?.text) {
                        fullText += chunkData.delta.text;
                        onChunk(chunkData.delta.text);
                    }
                }
            }
            return fullText;
        } else {
            const command = new InvokeModelCommand({ modelId: model, contentType: "application/json", accept: "application/json", body: JSON.stringify(payload) });
            const response = await client.send(command, { abortSignal: signal });
            const result = JSON.parse(new TextDecoder().decode(response.body));
            return result.content[0].text;
        }
    }

    throw new Error(`Unknown provider: ${provider}`);
}
