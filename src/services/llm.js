import { BedrockAgentRuntimeClient, InvokeAgentCommand } from "@aws-sdk/client-bedrock-agent-runtime";
import { BedrockRuntimeClient, InvokeModelCommand, InvokeModelWithResponseStreamCommand } from "@aws-sdk/client-bedrock-runtime";
import { GoogleGenerativeAI } from "@google/generative-ai";
import OpenAI from "openai";
import { fetchMcpTools, executeMcpTool, formatToolsForOpenAI, formatToolsForGemini } from "./mcp.js";

// A wrapper to handle recursive tool calls for OpenAI and Ollama
export async function sendMessage(messages, agentConfig, sessionId = "default-sess-1", signal = null, onChunk = null, pluginsEnabled = true) {
    let currentMessages = [...messages];
    let maxRounds = 4; // Limit tool chaining to prevent infinite loops
    let round = 0;
    
    // Fetch available MCP tools dynamically if enabled
    const toolsRaw = pluginsEnabled ? await fetchMcpTools() : [];
    
    // Inject MCP identity (e.g., GitHub username) into the system prompt if plugins are enabled
    if (pluginsEnabled) {
        try {
            const savedMcpForm = localStorage.getItem('bedrock_ui_mcp_form');
            if (savedMcpForm) {
                const { gitUser } = JSON.parse(savedMcpForm);
                if (gitUser) {
                    const identityContext = `\n\n[MCP PLUGIN CONTEXT]\n- GitHub Active User: ${gitUser}\n- Always use this username for tool parameters like 'owner' or in queries (e.g., "user:${gitUser}").`;
                    
                    // If there's a system message, append it. Otherwise, create one.
                    const systemIdx = currentMessages.findIndex(m => m.role === 'system');
                    if (systemIdx !== -1) {
                        currentMessages[systemIdx].content += identityContext;
                    } else {
                        currentMessages.unshift({ role: 'system', content: `You are a helpful AI assistant.${identityContext}` });
                    }
                }
            }
        } catch (e) {
            console.warn('[MCP] Failed to inject identity context:', e);
        }
    }

    let finalAccumulatedText = "";

    while (round < maxRounds) {
        round++;
        
        let toolCallDetected = false;
        let toolCalls = []; // Accumulate tool calls here
        let roundResponse = "";

        // Send the actual API request
        const responseData = await executeProviderCall(
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
            const generatedIds = toolCalls.map(tc => tc.id || `call_${Date.now()}_${Math.random().toString(36).substr(2,4)}`);
            
            if (agentConfig.provider === 'openai') {
                 currentMessages.push({ role: 'assistant', content: null, tool_calls: toolCalls.map((tc, i) => ({ id: generatedIds[i], type: 'function', function: { name: tc.name, arguments: JSON.stringify(tc.arguments) } })) });
            } else if (agentConfig.provider === 'ollama') {
                 currentMessages.push({ role: 'assistant', content: "", tool_calls: toolCalls.map((tc, i) => ({ function: { name: tc.name, arguments: tc.arguments } })) }); 
            }

            // Execute the tools
            for (let i = 0; i < toolCalls.length; i++) {
                const tc = toolCalls[i];
                const actionResult = await executeMcpTool(tc.name, tc.arguments);
                
                // Render the tool output immediately in the UI
                const resultSnippet = String(actionResult);
                const isJson = resultSnippet.startsWith('{') || resultSnippet.startsWith('[');
                const toolUiBlock = `\n\n<details><summary>🛠️ **Result of \`${tc.name}\`**</summary>\n\n\`\`\`${isJson ? 'json' : 'text'}\n${resultSnippet.substring(0, 12000)}${resultSnippet.length > 12000 ? '\n... (truncated)' : ''}\n\`\`\`\n</details>\n\n`;
                
                if (onChunk) onChunk(toolUiBlock);
                finalAccumulatedText += toolUiBlock;

                // Append result back to history
                if (agentConfig.provider === 'openai') {
                     currentMessages.push({ role: 'tool', tool_call_id: generatedIds[i], name: tc.name, content: String(actionResult) });
                } else if (agentConfig.provider === 'ollama') {
                     currentMessages.push({ role: 'tool', content: String(actionResult) });
                }
            }
            
            continue; 
        }

        // If no tools were called, return the final text
        if (!toolCallDetected) {
            return finalAccumulatedText || responseData;
        }
    }

    return finalAccumulatedText || "Error: Exceeded maximum tool execution rounds.";
}


// The underlying single-turn executor
async function executeProviderCall(messages, agentConfig, sessionId, signal, toolsRaw, onChunk, onToolCallsObj) {
    const { provider, model, apiKey, url, bedrockRegion, bedrockAccessKey, bedrockSecretKey, bedrockAgentId, bedrockAgentAliasId } = agentConfig;
    const shouldStream = import.meta.env.VITE_STREAM_RESPONSE === 'true' && typeof onChunk === 'function';

    if (provider === 'openai') {
        const openai = new OpenAI({ apiKey: apiKey, dangerouslyAllowBrowser: true });
        const payload = { model: model || 'gpt-4o', messages: messages, stream: shouldStream };
        
        const fTools = formatToolsForOpenAI(toolsRaw);
        if (fTools && fTools.length > 0) payload.tools = fTools;

        const response = await openai.chat.completions.create(payload, { signal });

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
                const parsedTools = finalTools.map(tc => ({ id: tc.id, name: tc.name, arguments: JSON.parse(tc.arguments || '{}') }));
                onToolCallsObj(parsedTools);
            }
            return fullText;
        } else {
            const msg = response.choices[0].message;
            if (msg.tool_calls && msg.tool_calls.length > 0) {
                const parsedTools = msg.tool_calls.map(tc => ({ id: tc.id, name: tc.function.name, arguments: JSON.parse(tc.function.arguments || '{}') }));
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
            messages: messages.map(m => ({ role: m.role, content: m.content || "", ...(m.tool_calls ? { tool_calls: m.tool_calls } : {}) })),
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
        const genAI = new GoogleGenerativeAI(apiKey);
        const genModel = genAI.getGenerativeModel({ model: model || 'gemini-1.5-pro-latest' });
        const systemInstruction = messages.find(m => m.role === 'system')?.content;
        let filteredMessages = messages.filter(m => m.role !== 'system');
        while (filteredMessages.length > 0 && filteredMessages[0].role === 'assistant') filteredMessages.shift();
        
        const chatHistory = filteredMessages.slice(0, -1).map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }));
        const lastMessage = messages[messages.length - 1].content;
        
        const chatObj = { history: chatHistory };
        if (systemInstruction) chatObj.systemInstruction = { parts: [{ text: systemInstruction }] };
        const chat = genModel.startChat(chatObj);

        if (shouldStream) {
            const result = await chat.sendMessageStream(lastMessage);
            let fullText = "";
            for await (const chunk of result.stream) {
                const chunkText = chunk.text();
                fullText += chunkText;
                onChunk(chunkText);
            }
            return fullText;
        } else {
            const result = await chat.sendMessage(lastMessage);
            return result.response.text();
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
