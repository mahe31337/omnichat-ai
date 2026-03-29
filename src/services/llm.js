import { BedrockAgentRuntimeClient, InvokeAgentCommand } from "@aws-sdk/client-bedrock-agent-runtime";
import { BedrockRuntimeClient, InvokeModelCommand, InvokeModelWithResponseStreamCommand } from "@aws-sdk/client-bedrock-runtime";
import { GoogleGenerativeAI } from "@google/generative-ai";
import OpenAI from "openai";

export async function sendMessage(messages, agentConfig, sessionId = "default-sess-1", signal = null, onChunk = null) {
    if (!agentConfig) {
        throw new Error("No agent selected. Please select or add an agent.");
    }

    const { provider, model, apiKey, url, bedrockRegion, bedrockAccessKey, bedrockSecretKey, bedrockAgentId, bedrockAgentAliasId } = agentConfig;
    const shouldStream = import.meta.env.VITE_STREAM_RESPONSE === 'true' && typeof onChunk === 'function';

    try {
        if (provider === 'openai') {
            const openai = new OpenAI({
                apiKey: apiKey,
                dangerouslyAllowBrowser: true
            });
            const response = await openai.chat.completions.create({
                model: model || 'gpt-4o',
                messages: messages,
                stream: shouldStream
            }, { signal });

            if (shouldStream) {
                let fullText = "";
                for await (const chunk of response) {
                    const content = chunk.choices[0]?.delta?.content || "";
                    if (content) {
                        fullText += content;
                        onChunk(content);
                    }
                }
                return fullText;
            } else {
                return response.choices[0].message.content;
            }
        }
        else if (provider === 'gemini') {
            const genAI = new GoogleGenerativeAI(apiKey);
            const genModel = genAI.getGenerativeModel({ model: model || 'gemini-1.5-pro-latest' });

            const systemInstruction = messages.find(m => m.role === 'system')?.content;
            let filteredMessages = messages.filter(m => m.role !== 'system');

            while (filteredMessages.length > 0 && filteredMessages[0].role === 'assistant') {
                filteredMessages.shift();
            }

            const chatHistory = filteredMessages
                .slice(0, -1)
                .map(m => ({
                    role: m.role === 'assistant' ? 'model' : 'user',
                    parts: [{ text: m.content }]
                }));

            const lastMessage = messages[messages.length - 1].content;
            const chatObj = { history: chatHistory };
            if (systemInstruction) {
                chatObj.systemInstruction = { parts: [{ text: systemInstruction }] };
            }
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
                credentials: {
                    accessKeyId: bedrockAccessKey,
                    secretAccessKey: bedrockSecretKey,
                }
            });

            const lastMessage = messages[messages.length - 1].content;
            const command = new InvokeAgentCommand({
                agentId: bedrockAgentId,
                agentAliasId: bedrockAgentAliasId,
                sessionId: sessionId.substring(0, 100), // Ensure max length compliance for Bedrock
                inputText: lastMessage,
                enableTrace: true
            });

            const response = await client.send(command, { abortSignal: signal });
            let completion = "";
            let returnControlData = null;
            let traces = [];
            let unknownEvents = [];

            if (response.completion !== undefined) {
                const decoder = new TextDecoder("utf-8");
                for await (const event of response.completion) {
                    if (event.chunk && event.chunk.bytes) {
                        const chunkStr = decoder.decode(event.chunk.bytes, { stream: true });
                        completion += chunkStr;
                        if (shouldStream) onChunk(chunkStr);
                    } else if (event.returnControl) {
                        returnControlData = event.returnControl;
                    } else if (event.trace) {
                        traces.push(event.trace);
                    } else if (event.files) {
                        unknownEvents.push({ filesEvent: "Files were returned", files: event.files });
                    } else {
                        const safeEvent = { ...event };
                        unknownEvents.push(safeEvent);
                    }
                }
                completion += decoder.decode(); // flush
            }

            if (returnControlData) {
                completion += `\n\n*(Agent triggered an Action Group. It requires the following input or execution:)*\n\`\`\`json\n${JSON.stringify(returnControlData, null, 2)}\n\`\`\``;
            }



            if (unknownEvents.length > 0) {
                completion += `\n\n*(Agent emitted a non-text block:)*\n\`\`\`json\n${JSON.stringify(unknownEvents, (key, val) => {
                    // Filter out oversized buffer logs to avoid huge JSON strings
                    if (val !== null && typeof val === 'object' && val.type === 'Buffer') return '[Buffer Data]';
                    if (val instanceof Uint8Array) return '[Uint8Array Data]';
                    return val;
                }, 2)}\n\`\`\``;
            }

            if (traces.length > 0) {
                let traceOutputs = '\n\n---\n### 🤖 Agent Thought Process\n';

                traces.forEach(t => {
                    const orch = t.trace?.orchestrationTrace;
                    if (!orch) return;

                    if (orch.rationale?.text) {
                        traceOutputs += `> **Thinking:** *${orch.rationale.text.trim().replace(/\n/g, ' ')}*\n\n`;
                    }
                    if (orch.invocationInput?.actionGroupInvocationInput) {
                        const action = orch.invocationInput.actionGroupInvocationInput;
                        traceOutputs += `> **Tool Call:** \`${action.actionGroupName}\` -> \`${action.apiPath || action.function}\`\n\n`;
                    }
                    if (orch.observation?.actionGroupInvocationOutput) {
                        const out = orch.observation.actionGroupInvocationOutput;
                        traceOutputs += `> **Tool Result:** *${(out.text || 'Success').substring(0, 100)}...*\n\n`;
                    }
                    if (orch.observation?.finalResponse?.text) {
                        traceOutputs += `\n\n${orch.observation.finalResponse.text}\n`;
                    }
                });

                completion += traceOutputs;
                completion += `\n\n<details><summary>🔍 *View Raw Agent Traces*</summary>\n\n\`\`\`json\n${JSON.stringify(traces, null, 2)}\n\`\`\`\n</details>`;
            }

            return completion || "Empty response from Bedrock Agent.";
        }
        else if (provider === 'bedrock') {
            const client = new BedrockRuntimeClient({
                region: bedrockRegion || 'us-east-1',
                credentials: {
                    accessKeyId: bedrockAccessKey,
                    secretAccessKey: bedrockSecretKey,
                }
            });

            const systemMessage = messages.find(m => m.role === 'system')?.content;
            const chatMessages = messages
                .filter(m => m.role !== 'system')
                .map(m => ({
                    role: m.role,
                    content: [{ type: 'text', text: m.content }]
                }));

            const payload = {
                anthropic_version: "bedrock-2023-05-31",
                max_tokens: 4096,
                messages: chatMessages
            };

            if (systemMessage) {
                payload.system = systemMessage;
            }

            if (shouldStream) {
                const command = new InvokeModelWithResponseStreamCommand({
                    modelId: model,
                    contentType: "application/json",
                    accept: "application/json",
                    body: JSON.stringify(payload)
                });
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
                const command = new InvokeModelCommand({
                    modelId: model,
                    contentType: "application/json",
                    accept: "application/json",
                    body: JSON.stringify(payload)
                });

                const response = await client.send(command, { abortSignal: signal });
                const result = JSON.parse(new TextDecoder().decode(response.body));
                return result.content[0].text;
            }
        }
        else if (provider === 'ollama') {
            let baseUrl = url || 'http://localhost:11434';
            baseUrl = baseUrl.replace(/\/+$/, '');
            const response = await fetch(`${baseUrl}/api/chat`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: model || 'llama3',
                    messages: messages.map(m => ({ role: m.role, content: m.content })),
                    stream: shouldStream
                }),
                signal: signal
            });

            if (!response.ok) {
                const errText = await response.text();
                throw new Error(`Ollama fetch failed (${response.status}): ${errText}`);
            }

            if (!shouldStream) {
                const data = await response.json();
                return data.message.content;
            } else {
                const reader = response.body.getReader();
                const decoder = new TextDecoder();
                let fullText = "";
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    const chunkData = decoder.decode(value, { stream: true });
                    const lines = chunkData.split('\n');
                    for (const line of lines) {
                        if (!line.trim()) continue;
                        try {
                            const parsed = JSON.parse(line);
                            if (parsed.message?.content) {
                                fullText += parsed.message.content;
                                onChunk(parsed.message.content);
                            }
                        } catch (e) { }
                    }
                }
                return fullText;
            }
        }
        else {
            throw new Error(`Unknown provider: ${provider}`);
        }
    } catch (error) {
        console.error("LLM Service Error:", error);
        throw error;
    }
}
