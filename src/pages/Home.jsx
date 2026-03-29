import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Send, Bot, User, LogOut, TerminalSquare, Settings, Plus, MessageSquare, Trash2, X, Globe, Brain, Wifi, WifiOff, Eye, EyeOff, Zap, BookOpen, Key, ChevronDown, ChevronUp, Plug } from 'lucide-react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import '../index.css';
import { sendMessage } from '../services/llm';
import { addToRAG, queryRAG, getRAGStats, checkRAGHealth, webSearch } from '../services/rag';

import { checkMcpStatus } from '../services/mcp';
import CodeStudio from '../components/CodeStudio';


const CODER_MODES = [
    { value: 'General',    label: 'General / No Filter', promptFile: null },
    { value: 'Terraform',  label: 'Terraform',           promptFile: '/prompts/terraform.md' },
    { value: 'Ansible',   label: 'Ansible',             promptFile: '/prompts/ansible.md' },
    { value: 'Docker',    label: 'Docker',              promptFile: '/prompts/docker.md' },
    { value: 'Kubernetes',label: 'Kubernetes',          promptFile: '/prompts/kubernetes.md' },
];

export default function Home() {
    const navigate = useNavigate();

    // -- App State --
    // Load Agents
    const [agents, setAgents] = useState(() => {
        const saved = localStorage.getItem('bedrock_ui_agents');
        return saved ? JSON.parse(saved) : [{ id: 'default', name: 'Demo Agent (Mock)', provider: 'mock' }];
    });
    const [selectedAgentId, setSelectedAgentId] = useState(() => localStorage.getItem('bedrock_ui_active_agent') || agents[0]?.id);
    const [selectedDomain, setSelectedDomain] = useState(() => localStorage.getItem('bedrock_ui_active_domain') || 'General');

    // Load Chats
    const [chats, setChats] = useState(() => {
        const saved = localStorage.getItem('bedrock_ui_chats');
        return saved ? JSON.parse(saved) : [{ id: 'chat-1', title: 'New Conversation', messages: [] }];
    });
    const [activeChatId, setActiveChatId] = useState(() => localStorage.getItem('bedrock_ui_active_chat') || chats[0]?.id);

    // Current State
    const [prompt, setPrompt] = useState('');
    const [generatingChats, setGeneratingChats] = useState({});
    const [searchingChats, setSearchingChats] = useState({});
    const [showSettings, setShowSettings] = useState(false);
    const [showMcpSettings, setShowMcpSettings] = useState(false);
    const [domainInstruction, setDomainInstruction] = useState('');
    const abortControllers = useRef({});

    const loading = generatingChats[activeChatId] || false;
    const searching = searchingChats[activeChatId] || false;

    // RAG + Web Search
    const [ragEnabled, setRagEnabled] = useState(() => localStorage.getItem('bedrock_ui_rag') !== 'false');
    const [webSearchEnabled, setWebSearchEnabled] = useState(() => localStorage.getItem('bedrock_ui_websearch') === 'true');
    const [scrapeLength, setScrapeLength] = useState(() => parseInt(localStorage.getItem('bedrock_ui_scrape_len')) || 4000);
    const [showWebData, setShowWebData] = useState(() => localStorage.getItem('bedrock_ui_show_webdata') === 'true');
    const [ragStats, setRagStats] = useState({ total: 0, domains: {} });
    const [ragOnline, setRagOnline] = useState(false);
    const [pluginsEnabled, setPluginsEnabled] = useState(() => localStorage.getItem('bedrock_ui_plugins_enabled') === 'true');
    const [studioOpen, setStudioOpen] = useState(false);
    const [activeMcpServers, setActiveMcpServers] = useState([]);
    // Search Engine Options (fully UI-driven, no code changes needed)
    const [tavilyKey, setTavilyKey] = useState(() => localStorage.getItem('bedrock_ui_tavily_key') || '');
    const [tavilyEnabled, setTavilyEnabled] = useState(() => localStorage.getItem('bedrock_ui_tavily_enabled') === 'true');
    const [jinaEnabled, setJinaEnabled] = useState(() => localStorage.getItem('bedrock_ui_jina') === 'true');
    const [showSearchSettings, setShowSearchSettings] = useState(false);

    const messagesEndRef = useRef(null);
    const scrollToBottom = () => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });

    // -- Side Effects --
    useEffect(() => { localStorage.setItem('bedrock_ui_agents', JSON.stringify(agents)); }, [agents]);
    useEffect(() => { localStorage.setItem('bedrock_ui_chats', JSON.stringify(chats)); }, [chats]);
    useEffect(() => { localStorage.setItem('bedrock_ui_active_chat', activeChatId); }, [activeChatId]);
    useEffect(() => { localStorage.setItem('bedrock_ui_active_agent', selectedAgentId); }, [selectedAgentId]);
    useEffect(() => { localStorage.setItem('bedrock_ui_active_domain', selectedDomain); }, [selectedDomain]);
    useEffect(() => { localStorage.setItem('bedrock_ui_rag', ragEnabled); }, [ragEnabled]);
    useEffect(() => { localStorage.setItem('bedrock_ui_websearch', webSearchEnabled); }, [webSearchEnabled]);
    useEffect(() => { localStorage.setItem('bedrock_ui_scrape_len', scrapeLength); }, [scrapeLength]);
    useEffect(() => { localStorage.setItem('bedrock_ui_show_webdata', showWebData); }, [showWebData]);
    useEffect(() => { localStorage.setItem('bedrock_ui_plugins_enabled', pluginsEnabled); }, [pluginsEnabled]);
    useEffect(() => { localStorage.setItem('bedrock_ui_tavily_key', tavilyKey); }, [tavilyKey]);
    useEffect(() => { localStorage.setItem('bedrock_ui_tavily_enabled', tavilyEnabled); }, [tavilyEnabled]);
    useEffect(() => { localStorage.setItem('bedrock_ui_jina', jinaEnabled); }, [jinaEnabled]);
    useEffect(() => { scrollToBottom(); }, [chats, activeChatId, loading]);

    // Poll RAG server health + stats + MCP status every 10 seconds
    useEffect(() => {
        const checkServer = async () => {
            const online = await checkRAGHealth();
            setRagOnline(online);
            if (online) {
                const stats = await getRAGStats();
                setRagStats(stats);
            }
            const plugins = await checkMcpStatus();
            setActiveMcpServers(plugins);
        };
        checkServer();
        const interval = setInterval(checkServer, 10000);
        return () => clearInterval(interval);
    }, []);

    // Fetch domain instruction from file whenever the selected domain changes
    useEffect(() => {
        const mode = CODER_MODES.find(m => m.value === selectedDomain);
        if (mode?.promptFile) {
            fetch(mode.promptFile)
                .then(res => {
                    if (!res.ok) throw new Error(`Failed to load prompt file: ${mode.promptFile}`);
                    return res.text();
                })
                .then(text => setDomainInstruction(text))
                .catch(err => {
                    console.warn('[OmniChat] Could not load domain prompt:', err);
                    setDomainInstruction('');
                });
        } else {
            setDomainInstruction('');
        }
    }, [selectedDomain]);

    // -- Computed --
    const activeChat = chats.find(c => c.id === activeChatId) || chats[0];
    const messages = activeChat?.messages || [];
    const activeAgent = agents.find(a => a.id === selectedAgentId) || agents[0];

    // -- Handlers --
    const handleLogout = () => navigate('/login');

    const handleCreateChat = () => {
        const newChat = { id: `chat-${Date.now()}`, title: 'New Conversation', messages: [] };
        setChats(prev => [newChat, ...prev]);
        setActiveChatId(newChat.id);
    };

    const handleDeleteChat = (id, e) => {
        e.stopPropagation();
        const updated = chats.filter(c => c.id !== id);
        if (updated.length === 0) {
            const newChat = { id: `chat-${Date.now()}`, title: 'New Conversation', messages: [] };
            setChats([newChat]);
            setActiveChatId(newChat.id);
        } else {
            setChats(updated);
            if (activeChatId === id) setActiveChatId(updated[0].id);
        }
    };

    const updateActiveChatArgs = (newMessages, titleUpdate = null, targetChatId = activeChatId) => {
        setChats(prev => prev.map(c => {
            if (c.id === targetChatId) {
                return { ...c, messages: newMessages, title: titleUpdate || c.title };
            }
            return c;
        }));
    };

    const extractAndFetchUrls = async (text) => {
        const urlRegex = /(https?:\/\/[^\s]+)/g;
        const urls = text.match(urlRegex);
        if (!urls) return text;

        let modifiedText = text;
        for (const url of urls) {
            try {
                // Using a public CORS proxy (raw endpoint) to allow client-side scraping
                const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`;
                const response = await fetch(proxyUrl);
                if (!response.ok) throw new Error(`Proxy fetch failed with status: ${response.status}`);

                const htmlStr = await response.text();

                if (htmlStr) {
                    const doc = new DOMParser().parseFromString(htmlStr, 'text/html');

                    // Strip out heavy/unnecessary element types
                    doc.querySelectorAll("script, style, noscript, svg, img, nav, footer").forEach(el => el.remove());

                    const textContent = doc.body?.textContent || "";
                    // Clean and truncate slightly to avoid blowing context ceilings
                    const cleanText = textContent.replace(/\s+/g, ' ').trim().substring(0, 15000);

                    // Add markdown wrapper with a <details> block to collapse it in the UI and not flood the screen
                    modifiedText += `\n\n<details><summary>📄 **Extracted Web Context from: ${url}**</summary>\n\n\`\`\`text\n${cleanText}\n\`\`\`\n</details>`;
                }
            } catch (err) {
                console.error("Failed to fetch URL:", url, err);
                modifiedText += `\n\n*(System Note: Failed to retrieve content from ${url})*`;
            }
        }
        return modifiedText;
    };

    const handleSend = async (e, forcePrompt = null) => {
        e?.preventDefault();
        const finalPrompt = forcePrompt !== null ? forcePrompt : prompt;
        if (!finalPrompt.trim() || !activeAgent || !activeChat) return;

        const targetChatId = activeChat.id;
        const currentAgent = activeAgent; 
        const currentDomain = selectedDomain; 

        const userMessage = { role: 'user', content: finalPrompt };
        let updatedMessages = [...messages, userMessage];

        // Auto-generate title if it's the first message
        const newTitle = messages.length === 0 ? prompt.substring(0, 30) + (prompt.length > 30 ? '...' : '') : null;
        updateActiveChatArgs(updatedMessages, newTitle, targetChatId);
        setPrompt('');
        
        setGeneratingChats(prev => ({ ...prev, [targetChatId]: true }));
        const controller = new AbortController();
        abortControllers.current[targetChatId] = controller;

        try {
            const expandedPrompt = await extractAndFetchUrls(userMessage.content);

            // ── Domain Instruction (from .md file) ──────────────────────
            let systemInstruction = "";
            if (domainInstruction) {
                systemInstruction = `${domainInstruction}\n\n---\n\n`;
            }

            // ── RAG Memory Context ──────────────────────────────────────
            let ragContext = "";
            if (ragEnabled && ragOnline) {
                const ragResults = await queryRAG(finalPrompt, 3);
                if (ragResults.length > 0) {
                    ragContext = `[RELEVANT PAST KNOWLEDGE — use this if helpful for answering]:\n`;
                    ragResults.forEach((r, i) => {
                        ragContext += `\n--- Memory ${i + 1} (relevance: ${(r.score * 100).toFixed(0)}%) ---\nQ: ${r.question}\nA: ${r.answer}\n`;
                    });
                    ragContext += `\n[END OF PAST KNOWLEDGE]\n\n`;
                    console.log(`[RAG] Injected ${ragResults.length} memories into context`);
                }
            }

            // ── Web Search Context ──────────────────────────────────────
            let webContext = "";
            let webContextUiString = ""; // For rendering in the UI if debug is ON
            if (webSearchEnabled && ragOnline) {
                setSearchingChats(prev => ({ ...prev, [targetChatId]: true }));
                try {
                    // Pass all search config from UI at runtime — nothing hardcoded
                    const activeTavilyKey = tavilyEnabled && tavilyKey.trim() ? tavilyKey.trim() : '';
                    const { results: searchResults, meta } = await webSearch(finalPrompt, scrapeLength, activeTavilyKey, jinaEnabled);
                    const engineLabel = meta.engine === 'tavily' ? '🔬 Tavily' : '🦆 DuckDuckGo';
                    const contentLabel = meta.jinaUsed ? ' + Jina Reader' : '';
                    if (searchResults.length > 0) {
                        webContext = `[SYSTEM INSTRUCTION: You are connected to the internet via ${engineLabel}${contentLabel}. I just fetched the following LIVE WEB DATA to answer the user's request.
CRITICAL RULES:
1. DO NOT say you don't have internet access.
2. DO NOT just output a list of links.
3. You MUST read the 'Article Content' or 'Summary' fields below and write a detailed, comprehensive answer based ONLY on this provided data.
4. Always cite the source URLs at the end of your answer.

=== LIVE SEARCH RESULTS (engine: ${engineLabel}${contentLabel}) for: "${finalPrompt.substring(0, 100)}" ===\n`;
                        searchResults.forEach((r, i) => {
                            webContext += `\n[Result ${i + 1}: ${r.title}]\n`;
                            if (r.snippet) webContext += `Summary: ${r.snippet}\n`;
                            if (r.content) webContext += `Article Content: ${r.content}\n`;
                            if (r.url) webContext += `Source: ${r.url}\n`;
                        });
                        webContext += `\n=== END OF LIVE RESULTS ===\n\n`;

                        if (showWebData) {
                            webContextUiString = `\n\n<details><summary>🔎 **View Injected Web Data — ${engineLabel}${contentLabel} (${searchResults.length} results)**</summary>\n\n\`\`\`text\n${webContext.substring(0, 8000).replace(/===/g, '---')}${webContext.length > 8000 ? '\n... (truncated for display)' : ''}\n\`\`\`\n</details>`;
                        }
                    } else {
                        webContext = `[SYSTEM INSTRUCTION: You tried to access the internet to answer this prompt, but the live search engine returned 0 results. 
CRITICAL RULES:
1. You MUST honestly inform the user that you couldn't find any real-time web results for this query.
2. DO NOT pretend to have live data and DO NOT invent fake news links. 
3. After honestly saying the live search failed, answer using your internal knowledge if possible.]\n\n`;
                        if (showWebData) {
                            webContextUiString = `\n\n<details><summary>🔎 **View Injected Web Data (0 results)**</summary>\n\n> *The search scraper returned no links for this query.*\n</details>`;
                        }
                    }
                } finally {
                    setSearchingChats(prev => ({ ...prev, [targetChatId]: false }));
                }
            }

            const promptForApi = systemInstruction + ragContext + webContext + expandedPrompt;
            const apiPayloadMessages = [...messages, { role: 'user', content: promptForApi }];
            let uiPayloadMessages = updatedMessages;

            let finalUserContentForUI = expandedPrompt;
            if (webContextUiString) {
                finalUserContentForUI += webContextUiString;
            }

            if (finalUserContentForUI !== userMessage.content) {
                uiPayloadMessages = [...messages, { role: 'user', content: finalUserContentForUI }];
                updateActiveChatArgs(uiPayloadMessages, newTitle, targetChatId);
            }

            let accumulatedText = "";
            const responseText = await sendMessage(
                apiPayloadMessages, 
                currentAgent, 
                targetChatId, 
                controller.signal,
                (chunk) => {
                    accumulatedText += chunk;
                    updateActiveChatArgs([...uiPayloadMessages, { role: 'assistant', content: accumulatedText, agentName: currentAgent.name }], null, targetChatId);
                },
                pluginsEnabled
            );

            // Final safety update
            updateActiveChatArgs([...uiPayloadMessages, { role: 'assistant', content: responseText, agentName: currentAgent.name }], null, targetChatId);

            if (ragEnabled && ragOnline && responseText) {
                addToRAG(finalPrompt, responseText, currentDomain);
                setRagStats(prev => ({ ...prev, total: (prev?.total || 0) + 1 }));
            }
        } catch (error) {
            if (error.name === 'AbortError' || error.message?.toLowerCase().includes('abort')) {
                updateActiveChatArgs([...updatedMessages, { role: 'assistant', content: `*(Generation stopped by user)*`, agentName: 'System' }], null, targetChatId);
            } else {
                updateActiveChatArgs([...updatedMessages, { role: 'assistant', content: `Error processing request: ${error.message || 'Unknown error'}`, agentName: 'System' }], null, targetChatId);
                console.error(error);
            }
        } finally {
            setGeneratingChats(prev => ({ ...prev, [targetChatId]: false }));
            setSearchingChats(prev => ({ ...prev, [targetChatId]: false }));
            delete abortControllers.current[targetChatId];
        }
    };

    const handleStop = () => {
        if (abortControllers.current[activeChatId]) {
            abortControllers.current[activeChatId].abort();
        }
    };

    const handleKeyDown = (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    };



    const renderMessageContent = (content) => {
        // LLMs frequently wrap code in <script> or <thinking> tags instead of markdown blockticks.
        // DOMPurify aggressively deletes <script> tags and ALL of their inner text content.
        // We must escape these specific structural tags so they render visually as text.
        const safeContent = content
            .replace(/<script\b[^>]*>/gi, '&lt;script&gt;')
            .replace(/<\/script>/gi, '&lt;/script&gt;')
            .replace(/<style\b[^>]*>/gi, '&lt;style&gt;')
            .replace(/<\/style>/gi, '&lt;/style&gt;')
            .replace(/<thinking>/gi, '&lt;thinking&gt;')
            .replace(/<\/thinking>/gi, '&lt;/thinking&gt;')
            .replace(/<output>/gi, '&lt;output&gt;')
            .replace(/<\/output>/gi, '&lt;/output&gt;');

        const rawMarkup = marked(safeContent);
        const cleanMarkup = DOMPurify.sanitize(rawMarkup);
        return { __html: cleanMarkup };
    };

    return (
        <div className="app-container" style={{ height: '100vh', flexDirection: 'row', overflow: 'hidden', position: 'relative' }}>

            {/* Settings Modal (Agent Manager) */}
            {showSettings && (
                <AgentSettingsModal
                    agents={agents}
                    setAgents={setAgents}
                    onClose={() => setShowSettings(false)}
                    selectedAgentId={selectedAgentId}
                    setSelectedAgentId={setSelectedAgentId}
                />
            )}

            {showMcpSettings && (
                <McpSettingsModal onClose={() => setShowMcpSettings(false)} />
            )}

            {/* Sidebar */}
            <div className="glass-panel" style={{ width: '280px', display: 'flex', flexDirection: 'column', borderRight: '1px solid var(--surface-border)', zIndex: 10 }}>
                <div style={{ padding: '24px', display: 'flex', alignItems: 'center', gap: '12px', borderBottom: '1px solid var(--surface-border)' }}>
                    <div style={{
                        width: '40px', height: '40px', borderRadius: '10px',
                        background: 'linear-gradient(135deg, var(--accent-primary), var(--accent-secondary))',
                        display: 'flex', alignItems: 'center', justifyContent: 'center'
                    }}>
                        <TerminalSquare size={20} color="white" />
                    </div>
                    <h2 style={{ fontSize: '1.25rem', margin: 0 }}>OmniChat AI</h2>
                </div>

                <div style={{ padding: '16px', borderBottom: '1px solid var(--surface-border)' }}>
                    <button onClick={handleCreateChat} className="btn btn-primary w-full" style={{ justifyContent: 'center' }}>
                        <Plus size={18} style={{ marginRight: '8px' }} /> New Chat
                    </button>
                </div>

                <div style={{ flex: 1, padding: '16px 8px', display: 'flex', flexDirection: 'column', gap: '4px', overflowY: 'auto' }}>
                    <div style={{ color: 'var(--text-tertiary)', fontSize: '0.875rem', fontWeight: 600, paddingLeft: '8px', marginBottom: '8px' }}>Chats</div>
                    {chats.map(chat => (
                        <div
                            key={chat.id}
                            onClick={() => setActiveChatId(chat.id)}
                            style={{
                                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                                padding: '12px', borderRadius: '8px', cursor: 'pointer',
                                background: chat.id === activeChatId ? 'var(--surface-active)' : 'transparent',
                                color: chat.id === activeChatId ? 'var(--text-primary)' : 'var(--text-secondary)'
                            }}
                            className="chat-list-item hover:bg-surface-active"
                        >
                            <div style={{ display: 'flex', alignItems: 'center', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                <MessageSquare size={16} style={{ marginRight: '12px', flexShrink: 0 }} />
                                <span style={{ textOverflow: 'ellipsis', overflow: 'hidden' }}>{chat.title}</span>
                            </div>
                            <button onClick={(e) => handleDeleteChat(chat.id, e)} className="btn-icon" style={{ background: 'transparent', padding: '4px' }}>
                                <Trash2 size={14} color="var(--text-tertiary)" />
                            </button>
                        </div>
                    ))}
                </div>

                <div style={{ padding: '20px', borderTop: '1px solid var(--surface-border)', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    <button onClick={() => setShowSettings(true)} className="btn btn-secondary w-full" style={{ justifyContent: 'flex-start', background: 'transparent', border: 'none' }}>
                        <Settings size={18} /> Manage Agents
                    </button>
                    <button onClick={() => setShowMcpSettings(true)} className="btn btn-secondary w-full" style={{ justifyContent: 'flex-start', background: 'transparent', border: 'none' }}>
                        <Plug size={18} /> Manage Plugins (MCP)
                    </button>
                    <button
                        className="btn btn-secondary w-full"
                        style={{ justifyContent: 'flex-start', background: 'transparent', border: 'none', color: 'var(--error)' }}
                        onClick={handleLogout}
                    >
                        <LogOut size={18} /> Sign Out
                    </button>
                </div>
            </div>

            {/* Main Chat Area */}
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', position: 'relative' }}>

                {/* Header */}
                <div className="glass-panel" style={{ padding: '16px 32px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--surface-border)', flexWrap: 'wrap', gap: '12px' }}>
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                        <h3 style={{ margin: 0 }}>{activeChat?.title || 'Chat'}</h3>
                        <p style={{ margin: 0, fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
                            {messages.length} messages
                        </p>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>

                        {/* RAG Server Status + Toggles */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 10px', borderRadius: 'var(--radius-md)', background: 'var(--surface-active)', fontSize: '0.75rem' }}>
                            {ragOnline
                                ? <Wifi size={13} color="#4ade80" />
                                : <WifiOff size={13} color="var(--text-tertiary)" />}
                            <span style={{ color: ragOnline ? '#4ade80' : 'var(--text-tertiary)' }}>
                                {ragOnline ? `RAG Online · ${ragStats.total} memories` : 'RAG Offline'}
                            </span>
                        </div>

                        {/* Memory Toggle */}
                        <button
                            onClick={() => setRagEnabled(v => !v)}
                            title={ragEnabled ? 'Memory ON — click to disable' : 'Memory OFF — click to enable'}
                            style={{
                                display: 'flex', alignItems: 'center', gap: '5px',
                                padding: '6px 10px', borderRadius: 'var(--radius-md)',
                                background: ragEnabled && ragOnline ? 'rgba(139,92,246,0.2)' : 'var(--surface-active)',
                                border: ragEnabled && ragOnline ? '1px solid rgba(139,92,246,0.5)' : '1px solid var(--surface-border)',
                                cursor: 'pointer', fontSize: '0.75rem', color: ragEnabled && ragOnline ? '#a78bfa' : 'var(--text-tertiary)'
                            }}
                        >
                            <Brain size={13} />
                            <span>Memory {ragEnabled ? 'ON' : 'OFF'}</span>
                        </button>

                        {/* Web Search Toggle */}
                        <button
                            onClick={() => setWebSearchEnabled(v => !v)}
                            title={webSearchEnabled ? 'Web Search ON — click to disable' : 'Web Search OFF — click to enable'}
                            style={{
                                display: 'flex', alignItems: 'center', gap: '5px',
                                padding: '6px 10px', borderRadius: 'var(--radius-md)',
                                background: webSearchEnabled && ragOnline ? 'rgba(6,182,212,0.2)' : 'var(--surface-active)',
                                border: webSearchEnabled && ragOnline ? '1px solid rgba(6,182,212,0.5)' : '1px solid var(--surface-border)',
                                cursor: 'pointer', fontSize: '0.75rem', color: webSearchEnabled && ragOnline ? '#22d3ee' : 'var(--text-tertiary)'
                            }}
                        >
                            <Globe size={13} />
                            <span>Web {webSearchEnabled ? 'ON' : 'OFF'}</span>
                        </button>

                        {/* Plugins Toggle */}
                        <button 
                            className={`btn btn-icon ${pluginsEnabled ? 'btn-glow-yellow' : ''}`}
                            onClick={() => setPluginsEnabled(!pluginsEnabled)}
                            title={pluginsEnabled ? "Disable Plugins (Speed Mode)" : "Enable Plugins (Agentic Tools)"}
                            style={{ 
                                padding: '8px 12px', 
                                borderRadius: 'var(--radius-md)',
                                background: pluginsEnabled ? 'rgba(234, 179, 8, 0.15)' : 'rgba(255,255,255,0.05)',
                                border: `1px solid ${pluginsEnabled ? 'rgba(234, 179, 8, 0.4)' : 'transparent'}`,
                                color: pluginsEnabled ? '#eab308' : 'var(--text-secondary)',
                                fontSize: '0.75rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '6px'
                            }}
                        >
                            <Zap size={14} fill={pluginsEnabled ? "currentColor" : "none"} />
                            {pluginsEnabled ? 'Plugins ON' : 'Plugins OFF'}
                            {pluginsEnabled && <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: activeMcpServers.length > 0 ? '#4ade80' : 'rgba(255,255,255,0.2)', boxShadow: activeMcpServers.length > 0 ? '0 0 8px #4ade80' : 'none' }} />}
                        </button>

                        <button 
                            className={`btn btn-icon ${studioOpen ? 'btn-glow-purple' : ''}`}
                            onClick={() => setStudioOpen(true)}
                            title="Open Code Studio (Browser Repos)"
                            style={{ 
                                padding: '8px 12px', 
                                borderRadius: 'var(--radius-md)',
                                background: 'rgba(168, 85, 247, 0.1)',
                                border: '1px solid rgba(168, 85, 247, 0.3)',
                                color: '#a855f7',
                                fontSize: '0.75rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '6px'
                            }}
                        >
                            <TerminalSquare size={14} />
                            Studio Mode
                        </button>

                        {/* Web Search Controls — only visible when web search is ON */}
                        {webSearchEnabled && ragOnline && (
                            <>
                                {/* Context Slider */}
                                <div
                                    style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 10px', borderRadius: 'var(--radius-md)', background: 'var(--surface-active)', border: '1px solid var(--surface-border)' }}
                                    title={`Characters of page content extracted per result. Current: ${scrapeLength}. Higher = smarter but slower.`}
                                >
                                    <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>Context: {scrapeLength.toLocaleString()}</span>
                                    <input
                                        type="range"
                                        min="500" max="12000" step="500"
                                        value={scrapeLength}
                                        onChange={e => setScrapeLength(parseInt(e.target.value))}
                                        style={{ width: '70px', accentColor: '#22d3ee', cursor: 'pointer' }}
                                    />
                                </div>

                                {/* Jina Reader Toggle */}
                                <button
                                    onClick={() => setJinaEnabled(v => !v)}
                                    title={jinaEnabled ? 'Jina Reader ON — clean article text extraction (slower)' : 'Jina Reader OFF — raw page fetch (faster)'}
                                    style={{
                                        display: 'flex', alignItems: 'center', gap: '5px',
                                        padding: '6px 10px', borderRadius: 'var(--radius-md)',
                                        background: jinaEnabled ? 'rgba(251,146,60,0.2)' : 'var(--surface-active)',
                                        border: jinaEnabled ? '1px solid rgba(251,146,60,0.5)' : '1px solid var(--surface-border)',
                                        cursor: 'pointer', fontSize: '0.75rem',
                                        color: jinaEnabled ? '#fb923c' : 'var(--text-tertiary)'
                                    }}
                                >
                                    <BookOpen size={13} />
                                    <span>Jina {jinaEnabled ? 'ON' : 'OFF'}</span>
                                </button>

                                {/* Tavily Toggle */}
                                <button
                                    onClick={() => setShowSearchSettings(v => !v)}
                                    title={tavilyEnabled && tavilyKey ? 'Tavily AI Search ON — click to manage' : 'Tavily OFF — using DuckDuckGo. Click to configure Tavily key.'}
                                    style={{
                                        display: 'flex', alignItems: 'center', gap: '5px',
                                        padding: '6px 10px', borderRadius: 'var(--radius-md)',
                                        background: tavilyEnabled && tavilyKey ? 'rgba(99,102,241,0.2)' : 'var(--surface-active)',
                                        border: tavilyEnabled && tavilyKey ? '1px solid rgba(99,102,241,0.5)' : '1px solid var(--surface-border)',
                                        cursor: 'pointer', fontSize: '0.75rem',
                                        color: tavilyEnabled && tavilyKey ? '#818cf8' : 'var(--text-tertiary)'
                                    }}
                                >
                                    <Zap size={13} />
                                    <span>Tavily {tavilyEnabled && tavilyKey ? 'ON' : 'OFF'}</span>
                                    {showSearchSettings ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
                                </button>

                                {/* Inspect Data Toggle */}
                                <button
                                    onClick={() => setShowWebData(v => !v)}
                                    title="Inspect Injected Web Data in the UI"
                                    style={{
                                        display: 'flex', alignItems: 'center', gap: '5px',
                                        padding: '6px 10px', borderRadius: 'var(--radius-md)',
                                        background: showWebData ? 'rgba(236,72,153,0.15)' : 'var(--surface-active)',
                                        border: showWebData ? '1px solid rgba(236,72,153,0.4)' : '1px solid var(--surface-border)',
                                        cursor: 'pointer', fontSize: '0.75rem', color: showWebData ? '#f472b6' : 'var(--text-tertiary)'
                                    }}
                                >
                                    {showWebData ? <Eye size={13} /> : <EyeOff size={13} />}
                                    <span>Inspect</span>
                                </button>
                            </>
                        )}

                        <select
                            className="input-field"
                            style={{ padding: '8px 16px', background: 'var(--surface-active)', border: 'none', width: 'auto' }}
                            value={selectedDomain}
                            onChange={(e) => setSelectedDomain(e.target.value)}
                        >
                            {CODER_MODES.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                        </select>
                        <select
                            className="input-field"
                            style={{ padding: '8px 16px', background: 'var(--surface-active)', border: 'none', minWidth: '200px' }}
                            value={selectedAgentId}
                            onChange={(e) => setSelectedAgentId(e.target.value)}
                        >
                            {agents.map(a => <option key={a.id} value={a.id}>{a.name} ({a.provider})</option>)}
                        </select>
                    </div>

                    {/* Tavily Settings Panel — dropdown below header */}
                    {showSearchSettings && webSearchEnabled && ragOnline && (
                        <div style={{
                            position: 'absolute', top: '100%', right: '32px', zIndex: 50,
                            background: 'var(--surface-color)', border: '1px solid rgba(99,102,241,0.4)',
                            borderRadius: 'var(--radius-md)', padding: '20px',
                            width: '340px', boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
                            display: 'flex', flexDirection: 'column', gap: '12px'
                        }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 700, fontSize: '0.9rem' }}>
                                    <Zap size={16} color="#818cf8" />
                                    <span>Tavily AI Search</span>
                                    <span style={{ fontSize: '0.7rem', padding: '2px 6px', borderRadius: '99px', background: 'rgba(99,102,241,0.2)', color: '#818cf8', fontWeight: 600 }}>PREMIUM</span>
                                </div>
                                <button onClick={() => setShowSearchSettings(false)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-tertiary)' }}>
                                    <X size={16} />
                                </button>
                            </div>

                            <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', margin: 0, lineHeight: 1.5 }}>
                                Tavily gives much richer, LLM-optimised results. Free tier: <strong>1000 searches/month</strong>.
                                Get your key at <a href="https://tavily.com" target="_blank" rel="noreferrer" style={{ color: '#818cf8' }}>tavily.com</a>.
                                When disabled, DuckDuckGo is used automatically.
                            </p>

                            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                <label style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                    <Key size={13} /> Tavily API Key
                                </label>
                                <input
                                    type="password"
                                    placeholder="tvly-xxxxxxxxxxxxxxxxxxxxxxxx"
                                    value={tavilyKey}
                                    onChange={e => setTavilyKey(e.target.value)}
                                    className="input-field"
                                    style={{ fontSize: '0.85rem', padding: '8px 12px', letterSpacing: tavilyKey ? '0.08em' : 'normal' }}
                                />
                                {tavilyKey && (
                                    <div style={{ fontSize: '0.72rem', color: '#4ade80', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                        <span>✓</span> Key saved locally · {tavilyKey.substring(0, 8)}••••••••
                                    </div>
                                )}
                            </div>

                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                                    <span style={{ fontSize: '0.82rem', fontWeight: 600 }}>Enable Tavily</span>
                                    <span style={{ fontSize: '0.72rem', color: 'var(--text-tertiary)' }}>
                                        {tavilyEnabled ? 'Using Tavily (fast, smart)' : 'Using DuckDuckGo (free, default)'}
                                    </span>
                                </div>
                                <button
                                    onClick={() => setTavilyEnabled(v => !v)}
                                    disabled={!tavilyKey.trim()}
                                    style={{
                                        width: '44px', height: '24px', borderRadius: '99px', border: 'none', cursor: tavilyKey ? 'pointer' : 'not-allowed',
                                        background: tavilyEnabled && tavilyKey ? 'linear-gradient(135deg, #6366f1, #818cf8)' : 'var(--surface-active)',
                                        position: 'relative', transition: 'background 0.2s', opacity: tavilyKey ? 1 : 0.5
                                    }}
                                    title={!tavilyKey ? 'Enter a Tavily API key first' : ''}
                                >
                                    <span style={{
                                        position: 'absolute', top: '3px',
                                        left: tavilyEnabled && tavilyKey ? '22px' : '3px',
                                        width: '18px', height: '18px', borderRadius: '50%',
                                        background: 'white', transition: 'left 0.2s',
                                        boxShadow: '0 1px 3px rgba(0,0,0,0.4)'
                                    }} />
                                </button>
                            </div>

                            {!tavilyKey && (
                                <div style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)', padding: '8px', borderRadius: 'var(--radius-sm)', background: 'rgba(255,255,255,0.03)', border: '1px dashed var(--surface-border)' }}>
                                    💡 No key? DuckDuckGo works great as the default — just leave Tavily OFF.
                                </div>
                            )}
                        </div>
                    )}
                </div>

                {/* Chat Feed */}
                <div style={{ flex: 1, overflowY: 'auto', padding: '32px', display: 'flex', flexDirection: 'column', gap: '24px' }}>
                    {messages.length === 0 && (
                        <div style={{ margin: 'auto', display: 'flex', flexDirection: 'column', alignItems: 'center', color: 'var(--text-tertiary)' }}>
                            <Bot size={48} style={{ marginBottom: '16px', opacity: 0.5 }} />
                            <h3>Start a conversation</h3>
                            <p>Select your preferred Response Agent in the top right, then type a message below.</p>
                        </div>
                    )}

                    {messages.map((msg, idx) => (
                        <div key={idx} className="animate-fade-in" style={{ display: 'flex', gap: '16px', maxWidth: '800px', margin: '0 auto', width: '100%' }}>
                            <div style={{
                                width: '36px', height: '36px', borderRadius: '10px', flexShrink: 0,
                                background: msg.role === 'assistant' ? 'var(--accent-primary)' : 'var(--surface-active)',
                                display: 'flex', alignItems: 'center', justifyContent: 'center'
                            }}>
                                {msg.role === 'assistant' ? <Bot size={20} color="white" /> : <User size={20} color="var(--text-primary)" />}
                            </div>
                            <div style={{ flex: 1 }}>
                                <div style={{ fontWeight: 600, marginBottom: '4px', color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
                                    {msg.role === 'assistant' ? (msg.agentName || 'Agent') : 'You'}
                                </div>
                                <div
                                    className="message-content"
                                    style={{
                                        lineHeight: 1.6,
                                        color: 'var(--text-primary)',
                                        background: msg.role === 'assistant' ? 'transparent' : 'var(--surface-color)',
                                        padding: msg.role === 'assistant' ? '0' : '12px 16px',
                                        borderRadius: '8px'
                                    }}
                                >
                                    {msg.role === 'assistant' ? (
                                        <div style={{ position: 'relative' }}>
                                            <div dangerouslySetInnerHTML={renderMessageContent(msg.content)} />
                                        </div>
                                    ) : (
                                        msg.content
                                    )}
                                </div>
                            </div>
                        </div>
                    ))}
                    {searching && (
                        <div className="animate-fade-in" style={{ display: 'flex', gap: '16px', maxWidth: '800px', margin: '0 auto', width: '100%' }}>
                            <div style={{ width: '36px', height: '36px', borderRadius: '10px', background: 'rgba(6,182,212,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                <Globe size={20} color="#22d3ee" />
                            </div>
                            <div style={{ flex: 1, display: 'flex', alignItems: 'center' }}>
                                <div className="animate-pulse-glow" style={{ width: '12px', height: '12px', borderRadius: '50%', background: '#22d3ee' }} />
                                <span style={{ marginLeft: '12px', color: '#22d3ee', fontSize: '0.9rem' }}>🌐 Searching the web for latest information...</span>
                            </div>
                        </div>
                    )}
                    {loading && (
                        <div className="animate-fade-in" style={{ display: 'flex', gap: '16px', maxWidth: '800px', margin: '0 auto', width: '100%' }}>
                            <div style={{ width: '36px', height: '36px', borderRadius: '10px', background: 'var(--accent-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                <Bot size={20} color="white" />
                            </div>
                            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                <div style={{ display: 'flex', alignItems: 'center' }}>
                                    <div className="animate-pulse-glow" style={{ width: '12px', height: '12px', borderRadius: '50%', background: 'var(--accent-secondary)' }} />
                                    <span style={{ marginLeft: '12px', color: 'var(--text-secondary)' }}>{activeAgent?.name || 'Agent'} is thinking...</span>
                                </div>
                                <button 
                                    onClick={handleStop}
                                    style={{
                                        background: 'rgba(239, 68, 68, 0.1)', color: '#ef4444', border: '1px solid rgba(239, 68, 68, 0.3)',
                                        padding: '6px 14px', borderRadius: 'var(--radius-full)', fontSize: '0.8rem', cursor: 'pointer',
                                        display: 'flex', alignItems: 'center', gap: '6px', fontWeight: '500'
                                    }}
                                >
                                    <X size={14} /> Stop Generating
                                </button>
                            </div>
                        </div>
                    )}
                    <div ref={messagesEndRef} />
                </div>

                {/* Input Area */}
                <div className="glass-panel" style={{ padding: '24px 32px', borderTop: '1px solid var(--surface-border)', zIndex: 10 }}>
                    {selectedDomain !== 'General' && (
                        <div style={{
                            maxWidth: '800px', margin: '0 auto 12px auto',
                            padding: '8px 14px', borderRadius: 'var(--radius-md)',
                            background: 'rgba(99,102,241,0.12)', border: '1px solid rgba(99,102,241,0.3)',
                            fontSize: '0.78rem', color: 'var(--accent-primary)',
                            display: 'flex', alignItems: 'center', gap: '8px'
                        }}>
                            <span>🎯</span>
                            <span><strong>{selectedDomain}</strong> mode active — professional instructions loaded from <code>public/prompts/{selectedDomain.toLowerCase()}.md</code></span>
                        </div>
                    )}
                    <div style={{ maxWidth: '800px', margin: '0 auto', position: 'relative' }}>
                        <textarea
                            value={prompt}
                            onChange={(e) => setPrompt(e.target.value)}
                            onKeyDown={handleKeyDown}
                            placeholder={selectedDomain !== 'General' ? `Ask anything about ${selectedDomain}...` : `Message ${activeAgent?.name || 'agent'}...`}
                            className="input-field glass-panel border-none focus:outline-none"
                            style={{
                                width: '100%', minHeight: '60px', maxHeight: '200px', resize: 'none',
                                padding: '18px 64px 18px 20px', borderRadius: 'var(--radius-lg)',
                                boxShadow: '0 4px 20px rgba(0,0,0,0.2)',
                                lineHeight: 1.5,
                                backgroundColor: 'rgba(0,0,0,0.3)'
                            }}
                            rows={1}
                        />
                        <button
                            onClick={(e) => handleSend(e)}
                            disabled={!prompt.trim() || loading || !activeAgent}
                            className="btn btn-primary btn-icon"
                            style={{
                                position: 'absolute', right: '12px', bottom: '12px',
                                width: '40px', height: '40px', borderRadius: 'var(--radius-md)',
                                opacity: (!prompt.trim() || loading || !activeAgent) ? 0.5 : 1
                            }}
                        >
                            <Send size={18} color="white" />
                        </button>
                    </div>
                </div>
            </div>

            <CodeStudio isOpen={studioOpen} onClose={() => setStudioOpen(false)} />

            <style>{`
        .message-content pre {
          background: #1e1e24 !important;
          padding: 16px;
          border-radius: var(--radius-md);
          overflow-x: auto;
          border: 1px solid var(--surface-border);
          margin-top: 12px;
        }
        .message-content code {
          font-family: 'Courier New', Courier, monospace;
          color: #e2e8f0;
          font-size: 0.9rem;
        }
        .message-content p {
          margin-bottom: 12px;
        }
        .message-content p:last-child {
          margin-bottom: 0;
        }
        select option {
          background-color: var(--bg-color, #151921);
          color: var(--text-primary, #ffffff);
        }
        .chat-list-item:hover {
            background-color: rgba(255,255,255,0.05) !important;
        }
      `}</style>
        </div>
    );
}

function AgentSettingsModal({ agents, setAgents, onClose, selectedAgentId, setSelectedAgentId }) {
    const defaultForm = { provider: 'openai', name: '', model: '', apiKey: '', url: '', bedrockRegion: 'us-east-1', bedrockAccessKey: '', bedrockSecretKey: '', bedrockAgentId: '', bedrockAgentAliasId: '' };
    const [form, setForm] = useState(defaultForm);
    const [editingAgentId, setEditingAgentId] = useState(false); // false, 'new', or agentId

    const handleDelete = (id) => {
        const updated = agents.filter(a => a.id !== id);
        setAgents(updated);
        if (selectedAgentId === id) setSelectedAgentId(updated[0]?.id || null);
    };

    const handleEdit = (agent) => {
        setForm({ ...defaultForm, ...agent });
        setEditingAgentId(agent.id);
    };

    const handleSave = () => {
        if (!form.name || !form.provider) return alert('Name and Provider are required');

        if (editingAgentId === 'new') {
            const newAgent = { ...form, id: `agent-${Date.now()}` };
            setAgents([...agents, newAgent]);
        } else {
            setAgents(agents.map(a => a.id === editingAgentId ? { ...form, id: editingAgentId } : a));
        }

        setEditingAgentId(false);
        setForm(defaultForm);
    };

    return (
        <div style={{
            position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
            background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)',
            zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center'
        }}>
            <div className="glass-panel animate-fade-in" style={{
                width: '600px', maxHeight: '80vh', overflowY: 'auto',
                padding: '32px', display: 'flex', flexDirection: 'column', gap: '20px'
            }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--surface-border)', paddingBottom: '16px' }}>
                    <h2 style={{ margin: 0 }}>Agent Manager</h2>
                    <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer' }}><X size={20} /></button>
                </div>

                {!editingAgentId ? (
                    <>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                            {agents.map(a => (
                                <div key={a.id} className="glass-panel" style={{ padding: '12px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <div>
                                        <div style={{ fontWeight: 600 }}>{a.name}</div>
                                        <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{a.provider} • {a.model || 'Default Model'}</div>
                                    </div>
                                    <div style={{ display: 'flex', gap: '4px' }}>
                                        <button onClick={() => handleEdit(a)} className="btn-icon" style={{ background: 'transparent', color: 'var(--text-secondary)' }} title="Edit">
                                            <Settings size={18} />
                                        </button>
                                        <button onClick={() => handleDelete(a.id)} className="btn-icon" style={{ background: 'transparent', color: 'var(--error)' }} title="Delete">
                                            <Trash2 size={18} />
                                        </button>
                                    </div>
                                </div>
                            ))}
                            {agents.length === 0 && <p style={{ color: 'var(--text-secondary)' }}>No agents configured.</p>}
                        </div>
                        <button className="btn btn-primary" onClick={() => { setForm(defaultForm); setEditingAgentId('new'); }}>
                            <Plus size={18} /> Add New Agent
                        </button>
                    </>
                ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                        <h3>{editingAgentId === 'new' ? 'Add New Agent' : 'Edit Agent'}</h3>
                        <div className="input-group">
                            <label className="input-label">Provider</label>
                            <select className="input-field" value={form.provider} onChange={(e) => setForm({ ...form, provider: e.target.value })}>
                                <option value="openai">OpenAI</option>
                                <option value="ollama">Ollama (Local)</option>
                                <option value="gemini">Google Gemini</option>
                                <option value="bedrock">AWS Bedrock (Standard)</option>
                                <option value="bedrock-agent">AWS Bedrock Agent</option>
                            </select>
                        </div>

                        <div className="input-group">
                            <label className="input-label">Display Name</label>
                            <input type="text" placeholder="e.g. My Llama 3 Helper" className="input-field" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
                        </div>

                        {form.provider !== 'bedrock-agent' && (
                            <div className="input-group">
                                <label className="input-label">Model Name</label>
                                <input type="text" placeholder="e.g. gpt-4o, llama3..." className="input-field" value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} />
                            </div>
                        )}

                        {(form.provider === 'openai' || form.provider === 'gemini') && (
                            <div className="input-group">
                                <label className="input-label">API Key</label>
                                <input type="password" placeholder="sk-..." className="input-field" value={form.apiKey} onChange={(e) => setForm({ ...form, apiKey: e.target.value })} />
                            </div>
                        )}

                        {form.provider === 'ollama' && (
                            <div className="input-group">
                                <label className="input-label">Ollama Base URL</label>
                                <input type="text" placeholder="http://localhost:11434" className="input-field" value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} />
                            </div>
                        )}

                        {(form.provider === 'bedrock' || form.provider === 'bedrock-agent') && (
                            <>
                                <div className="input-group">
                                    <label className="input-label">AWS Region</label>
                                    <input type="text" placeholder="us-east-1" className="input-field" value={form.bedrockRegion} onChange={(e) => setForm({ ...form, bedrockRegion: e.target.value })} />
                                </div>
                                <div className="input-group">
                                    <label className="input-label">AWS Access Key ID</label>
                                    <input type="text" className="input-field" value={form.bedrockAccessKey} onChange={(e) => setForm({ ...form, bedrockAccessKey: e.target.value })} />
                                </div>
                                <div className="input-group">
                                    <label className="input-label">AWS Secret Access Key</label>
                                    <input type="password" className="input-field" value={form.bedrockSecretKey} onChange={(e) => setForm({ ...form, bedrockSecretKey: e.target.value })} />
                                </div>
                            </>
                        )}

                        {form.provider === 'bedrock-agent' && (
                            <>
                                <div className="input-group">
                                    <label className="input-label">Agent ID</label>
                                    <input type="text" className="input-field" value={form.bedrockAgentId} onChange={(e) => setForm({ ...form, bedrockAgentId: e.target.value })} />
                                </div>
                                <div className="input-group">
                                    <label className="input-label">Agent Alias ID</label>
                                    <input type="text" className="input-field" value={form.bedrockAgentAliasId} onChange={(e) => setForm({ ...form, bedrockAgentAliasId: e.target.value })} />
                                </div>
                            </>
                        )}

                        <div style={{ display: 'flex', gap: '12px', marginTop: '12px' }}>
                            <button className="btn btn-primary" style={{ flex: 1 }} onClick={handleSave}>Save Agent</button>
                            <button className="btn btn-secondary" style={{ flex: 1, backgroundColor: 'transparent', border: '1px solid var(--surface-border)' }} onClick={() => setEditingAgentId(false)}>Cancel</button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

function McpSettingsModal({ onClose }) {
    const defaultForm = { name: 'github', command: 'npx', args: '-y @modelcontextprotocol/server-github', gitToken: '', gitUser: '' };
    const [form, setForm] = useState(() => {
        const saved = localStorage.getItem('bedrock_ui_mcp_form');
        return saved ? JSON.parse(saved) : defaultForm;
    });
    const [status, setStatus] = useState('');

    const handleConnect = async () => {
        if (!form.gitToken || !form.gitUser) return alert('Both GitHub Token and Username are required');
        
        setStatus('Connecting...');
        localStorage.setItem('bedrock_ui_mcp_form', JSON.stringify(form));
        
        try {
            const res = await fetch('http://localhost:3002/mcp/connect', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: form.name,
                    command: form.command,
                    args: form.args.split(' '), 
                    envVars: { 
                        GITHUB_PERSONAL_ACCESS_TOKEN: form.gitToken.trim(),
                        GITHUB_USERNAME: form.gitUser.trim() 
                    }
                })
            });
            const data = await res.json();
            if (data.success) {
                setStatus('✅ GitHub Connected! Verification successful.');
                setTimeout(onClose, 2000);
            } else {
                setStatus(`❌ Error: ${data.error}`);
            }
        } catch (e) {
            setStatus('❌ Network error: Is the MCP backend running on :3002?');
        }
    };

    return (
        <div style={{
            position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
            background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)',
            zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center'
        }}>
            <div className="glass-panel animate-fade-in" style={{
                width: '600px', maxHeight: '80vh', overflowY: 'auto',
                padding: '32px', display: 'flex', flexDirection: 'column', gap: '20px'
            }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--surface-border)', paddingBottom: '16px' }}>
                     <h2 style={{ margin: 0, display: 'flex', alignItems: 'center' }}><Plug size={20} style={{ marginRight: '8px' }}/> Connect GitHub Plugin</h2>
                     <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer' }}><X size={20} /></button>
                </div>
                
                <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', lineHeight: 1.5, margin: 0 }}>
                    Enable GitHub repository management, code search, and file creation directly in your chat.
                </p>

                <div className="input-group">
                    <label className="input-label">GitHub Username</label>
                    <input type="text" placeholder="e.g. mahe31337" className="input-field" value={form.gitUser} onChange={(e) => setForm({ ...form, gitUser: e.target.value })} />
                </div>

                <div className="input-group">
                    <label className="input-label">GitHub Personal Access Token</label>
                    <input type="password" placeholder="ghp_xxxxxxxxxxxxxxxxxxxxx" className="input-field" value={form.gitToken} onChange={(e) => setForm({ ...form, gitToken: e.target.value })} />
                </div>
                
                <div style={{ padding: '12px', background: 'rgba(99,102,241,0.05)', border: '1px solid rgba(99,102,241,0.2)', borderRadius: '8px', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                    <p style={{ margin: '0 0 4px 0', color: 'var(--accent-primary)' }}><strong>🛡️ Verification Mode Active</strong></p>
                    The backend will automatically verify this token against your account before displaying the 🟢 active status.
                </div>

                {status && (
                    <div style={{ 
                        padding: '10px 14px', borderRadius: '8px', fontSize: '0.9rem', fontWeight: 500,
                        background: status.includes('✅') ? 'rgba(74, 222, 128, 0.1)' : 'rgba(239, 68, 68, 0.1)',
                        color: status.includes('✅') ? '#4ade80' : 'var(--error)',
                        border: `1px solid ${status.includes('✅') ? 'rgba(74, 222, 128, 0.3)' : 'rgba(239, 68, 68, 0.3)'}`
                    }}>
                        {status}
                    </div>
                )}
                
                <div style={{ display: 'flex', gap: '12px', marginTop: '12px' }}>
                     <button className="btn btn-primary" style={{ flex: 1 }} onClick={handleConnect} disabled={status === 'Connecting...'}>
                         {status === 'Connecting...' ? 'Verifying & Connecting...' : 'Connect to GitHub'}
                     </button>
                </div>
            </div>
        </div>
    );
}

