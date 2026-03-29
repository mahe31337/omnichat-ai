import React, { useState, useEffect } from 'react';
import { Folder, File, ChevronRight, ChevronDown, Code, Github, RefreshCw, X, FileCode, FileText, Database, Shield } from 'lucide-react';

export default function CodeStudio({ isOpen, onClose }) {
    const [repos, setRepos] = useState([]);
    const [selectedRepo, setSelectedRepo] = useState(null);
    const [fileTree, setFileTree] = useState([]);
    const [activeFile, setActiveFile] = useState(null);
    const [fileContent, setFileContent] = useState('');
    const [loading, setLoading] = useState(false);
    const [expandedFolders, setExpandedFolders] = useState({});

    // Fetch repositories on mount or when opened
    useEffect(() => {
        if (isOpen) fetchRepositories();
    }, [isOpen]);

    const fetchRepositories = async () => {
        setLoading(true);
        try {
            const savedMcpForm = localStorage.getItem('bedrock_ui_mcp_form');
            if (!savedMcpForm) throw new Error('GitHub MCP not configured');
            const { gitUser } = JSON.parse(savedMcpForm);

            const res = await fetch('http://localhost:3002/mcp/call', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    toolName: 'github__search_repositories',
                    args: { query: `user:${gitUser}`, per_page: 50 }
                })
            });
            const data = await res.json();
            if (data.success && data.result.content?.[0]) {
                const parsed = JSON.parse(data.result.content[0].text);
                setRepos(parsed.items || []);
            }
        } catch (e) {
            console.error('[Studio] Fetch repos failed:', e);
        } finally {
            setLoading(false);
        }
    };

    const fetchFiles = async (repoFullName, path = '') => {
        setLoading(true);
        const [owner, repo] = repoFullName.split('/');
        try {
            const res = await fetch('http://localhost:3002/mcp/call', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    toolName: 'github__get_file_contents',
                    args: { owner, repo, path }
                })
            });
            const data = await res.json();
            if (data.success && data.result.content?.[0]) {
                const parsed = JSON.parse(data.result.content[0].text);
                if (Array.isArray(parsed)) {
                    setFileTree(parsed);
                }
            }
        } catch (e) {
            console.error('[Studio] Fetch files failed:', e);
        } finally {
            setLoading(false);
        }
    };

    const handleFileClick = async (file) => {
        if (file.type === 'dir') {
            const isExpanded = expandedFolders[file.path];
            setExpandedFolders({ ...expandedFolders, [file.path]: !isExpanded });
            
            // If expanding, fetch the nested files for this path
            if (!isExpanded) {
                setLoading(true);
                const [owner, repo] = selectedRepo.full_name.split('/');
                try {
                    const res = await fetch('http://localhost:3002/mcp/call', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            toolName: 'github__get_file_contents',
                            args: { owner, repo, path: file.path }
                        })
                    });
                    const data = await res.json();
                    if (data.success && data.result.content?.[0]) {
                        const parsed = JSON.parse(data.result.content[0].text);
                        if (Array.isArray(parsed)) {
                            // Splice the new files into the tree after the current index
                            const currentIndex = fileTree.findIndex(item => item.path === file.path);
                            const updatedTree = [...fileTree];
                            // Add a visual 'level' or just prepend to names for now
                            const nested = parsed.map(n => ({ ...n, name: `  └─ ${n.name}`, _parentPath: file.path }));
                            updatedTree.splice(currentIndex + 1, 0, ...nested);
                            setFileTree(updatedTree);
                        }
                    }
                } catch (e) {
                    console.error('[Studio] Fetch nested files failed:', e);
                } finally {
                    setLoading(false);
                }
            } else {
                // If collapsing, remove items whose parent is this path
                setFileTree(fileTree.filter(item => item._parentPath !== file.path));
            }
            return;
        }

        setLoading(true);
        setActiveFile(file);
        const [owner, repo] = selectedRepo.full_name.split('/');
        try {
            const res = await fetch('http://localhost:3002/mcp/call', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    toolName: 'github__get_file_contents',
                    args: { owner, repo, path: file.path.replace('  └─ ', '') }
                })
            });
            const data = await res.json();
            if (data.success && data.result.content?.[0]) {
                const parsed = JSON.parse(data.result.content[0].text);
                
                // GitHub/MCP Content Handling
                if (parsed.content) {
                    // Check if it's base64 or plain
                    const isBase64 = parsed.encoding === 'base64';
                    try {
                        if (isBase64) {
                            // Remove clean/newlines before decoding
                            const cleanB64 = parsed.content.replace(/[\r\n\s]/g, '');
                            setFileContent(decodeURIComponent(escape(atob(cleanB64))));
                        } else {
                            setFileContent(parsed.content);
                        }
                    } catch (e) {
                        // Fallback if atob fails
                        setFileContent(parsed.content);
                    }
                } else if (typeof parsed === 'string') {
                    setFileContent(parsed);
                } else {
                   setFileContent('// No content available or file is empty.');
                }
            }
        } catch (e) {
            setFileContent(`// Error loading file: ${e.message}`);
        } finally {
            setLoading(false);
        }
    };

    const selectRepo = (repo) => {
        setSelectedRepo(repo);
        fetchFiles(repo.full_name);
    };

    if (!isOpen) return null;

    return (
        <div className="animate-fade-in" style={{
            position: 'fixed', top: 0, right: 0, bottom: 0, left: 0,
            background: 'var(--bg-color)', zIndex: 2000, display: 'flex', flexDirection: 'column'
        }}>
            {/* Header */}
            <header className="glass-panel" style={{
                padding: '12px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                borderBottom: '1px solid var(--surface-border)'
            }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                    <div style={{ 
                        width: '32px', height: '32px', borderRadius: '8px', 
                        background: 'linear-gradient(135deg, #6366f1, #a855f7)', 
                        display: 'flex', alignItems: 'center', justifyContent: 'center' 
                    }}>
                        <Code size={18} color="white" />
                    </div>
                    <div>
                        <h2 style={{ margin: 0, fontSize: '1.1rem' }}>Omni Studio</h2>
                        <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                            {selectedRepo ? `Editing ${selectedRepo.full_name}` : 'Select a repository to begin'}
                        </p>
                    </div>
                </div>

                <div style={{ display: 'flex', gap: '12px' }}>
                    <button className="btn-icon" onClick={fetchRepositories} title="Refresh Repositories">
                        <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
                    </button>
                    <button className="btn-icon" onClick={onClose} style={{ color: 'var(--error)' }}>
                        <X size={20} />
                    </button>
                </div>
            </header>

            <main style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
                {/* Repo Selection Sidebar */}
                {!selectedRepo ? (
                    <div style={{ flex: 1, overflowY: 'auto', padding: '40px' }}>
                        <div style={{ maxWidth: '800px', margin: '0 auto' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '24px' }}>
                                <Github size={24} />
                                <h3 style={{ margin: 0 }}>Select a GitHub Repository</h3>
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: '16px' }}>
                                {repos.map(repo => (
                                    <div 
                                        key={repo.id} 
                                        className="glass-panel hover-glow clickable" 
                                        onClick={() => selectRepo(repo)}
                                        style={{ padding: '20px', transition: 'transform 0.2s' }}
                                    >
                                        <div style={{ fontWeight: 600, marginBottom: '6px' }}>{repo.name}</div>
                                        <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '12px', height: '32px', overflow: 'hidden' }}>
                                            {repo.description || 'No description provided.'}
                                        </div>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.7rem' }}>
                                            <span style={{ color: 'var(--accent-primary)' }}>{repo.language || 'Plain Text'}</span>
                                            <span>{repo.stargazers_count} ⭐</span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                ) : (
                    <>
                        {/* File Explorer Sidebar */}
                        <div className="glass-panel" style={{ width: '280px', borderRight: '1px solid var(--surface-border)', display: 'flex', flexDirection: 'column' }}>
                            <div style={{ padding: '16px', borderBottom: '1px solid var(--surface-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <span style={{ fontWeight: 600, fontSize: '0.85rem' }}>EXPLORER</span>
                                <button onClick={() => setSelectedRepo(null)} style={{ background: 'transparent', border: 'none', color: 'var(--accent-primary)', fontSize: '0.75rem', cursor: 'pointer' }}>Change Repo</button>
                            </div>
                            <div style={{ flex: 1, overflowY: 'auto', padding: '8px' }}>
                                {fileTree.map(item => (
                                    <div 
                                        key={item.sha} 
                                        className="clickable"
                                        onClick={() => handleFileClick(item)}
                                        style={{ 
                                            display: 'flex', alignItems: 'center', gap: '8px', 
                                            padding: '8px 12px', borderRadius: '6px',
                                            fontSize: '0.85rem',
                                            background: activeFile?.path === item.path ? 'rgba(99, 102, 241, 0.15)' : 'transparent',
                                            color: item.type === 'dir' ? 'var(--text-primary)' : 'var(--text-secondary)'
                                        }}
                                    >
                                        {item.type === 'dir' ? <Folder size={16} color="#fbbf24" fill="#fbbf24" style={{opacity: 0.7}} /> : <FileCode size={16} />}
                                        <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.name}</span>
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* Editor View */}
                        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: '#0f1115' }}>
                            {activeFile ? (
                                <>
                                    <div style={{ padding: '4px 16px', background: '#1a1d23', display: 'flex', alignItems: 'center', borderBottom: '1px solid #2d333b' }}>
                                        <div style={{ 
                                            padding: '8px 16px', borderTop: '2px solid var(--accent-primary)', 
                                            background: '#0f1115', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '8px' 
                                        }}>
                                            <FileCode size={14} color="var(--accent-primary)" />
                                            {activeFile.name}
                                        </div>
                                    </div>
                                    <div style={{ flex: 1, position: 'relative' }}>
                                        <textarea
                                            readOnly={true}
                                            value={fileContent}
                                            style={{
                                                width: '100%', height: '100%',
                                                background: 'transparent', color: '#d1d5db',
                                                fontFamily: '"JetBrains Mono", "Fira Code", monospace',
                                                fontSize: '0.9rem', padding: '24px', border: 'none', resize: 'none',
                                                lineHeight: 1.6, outline: 'none'
                                            }}
                                        />
                                        {loading && (
                                            <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                                <RefreshCw className="animate-spin" size={32} />
                                            </div>
                                        )}
                                    </div>
                                </>
                            ) : (
                                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', opacity: 0.5 }}>
                                    <Code size={48} />
                                    <p>Select a file to view content</p>
                                </div>
                            )}
                        </div>
                    </>
                )}
            </main>
        </div>
    );
}
