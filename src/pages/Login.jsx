import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Lock, Mail, ArrowRight, Layers } from 'lucide-react';
import '../index.css';

export default function Login() {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const navigate = useNavigate();

    const handleLogin = (e) => {
        e.preventDefault();
        setLoading(true);
        // Simulate login
        setTimeout(() => {
            setLoading(false);
            navigate('/');
        }, 1500);
    };

    return (
        <div className="app-container items-center justify-center">
            <div className="glass-card p-10 animate-fade-in" style={{ padding: '40px', maxWidth: '440px', width: '100%', margin: '20px' }}>

                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: '32px' }}>
                    <div style={{
                        width: '64px', height: '64px', borderRadius: '16px',
                        background: 'linear-gradient(135deg, var(--accent-primary), var(--accent-secondary))',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '16px'
                    }}>
                        <Layers size={32} color="white" />
                    </div>
                    <h1 className="text-gradient" style={{ fontSize: '2rem', marginBottom: '8px' }}>OmniChat AI</h1>
                    <p style={{ color: 'var(--text-secondary)', textAlign: 'center' }}>Sign in to access your Terraform Code Generation agent.</p>
                </div>

                <form onSubmit={handleLogin} className="flex-col gap-6">
                    <div className="input-group">
                        <label className="input-label">Email Address</label>
                        <div style={{ position: 'relative' }}>
                            <Mail size={20} style={{ position: 'absolute', left: '16px', top: '14px', color: 'var(--text-tertiary)' }} />
                            <input
                                type="email"
                                className="input-field"
                                placeholder="developer@company.com"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                style={{ paddingLeft: '48px' }}
                                required
                            />
                        </div>
                    </div>

                    <div className="input-group" style={{ marginBottom: '8px' }}>
                        <label className="input-label">Password</label>
                        <div style={{ position: 'relative' }}>
                            <Lock size={20} style={{ position: 'absolute', left: '16px', top: '14px', color: 'var(--text-tertiary)' }} />
                            <input
                                type="password"
                                className="input-field"
                                placeholder="••••••••"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                style={{ paddingLeft: '48px' }}
                                required
                            />
                        </div>
                    </div>

                    <button type="submit" className={`btn btn-primary w-full ${loading ? 'animate-pulse-glow' : ''}`} disabled={loading}>
                        {loading ? 'Authenticating...' : 'Sign In'}
                        {!loading && <ArrowRight size={20} />}
                    </button>
                </form>

                <div style={{ marginTop: '24px', textAlign: 'center', fontSize: '0.875rem', color: 'var(--text-tertiary)' }}>
                    Powered by Amazon Bedrock
                </div>
            </div>
        </div>
    );
}
