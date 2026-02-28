const { useState, useEffect } = React;

const Homepage = ({ onNavigate }) => {
    const [animateIn, setAnimateIn] = useState(false);
    const [herdStats, setHerdStats] = useState(null);
    const [currentTime, setCurrentTime] = useState(new Date());

    useEffect(() => {
        setTimeout(() => setAnimateIn(true), 100);
        const timer = setInterval(() => setCurrentTime(new Date()), 60000);
        return () => clearInterval(timer);
    }, []);

    useEffect(() => {
        if (window.lucide) window.lucide.createIcons();
    });

    // Fetch live herd stats for the hero section
    useEffect(() => {
        fetch('http://localhost:8000/herd')
            .then(r => r.ok ? r.json() : null)
            .then(data => {
                if (data) {
                    const alert = data.cows.filter(c => c.status === 'alert').length;
                    const watch = data.cows.filter(c => c.status === 'watch').length;
                    const ok = data.cows.filter(c => c.status === 'ok').length;
                    setHerdStats({ total: data.cows.length, alert, watch, ok });
                }
            })
            .catch(() => { });
    }, []);

    const greeting = (() => {
        const h = currentTime.getHours();
        if (h < 12) return 'Good Morning';
        if (h < 17) return 'Good Afternoon';
        return 'Good Evening';
    })();

    const timeStr = currentTime.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    const dateStr = currentTime.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

    const features = [
        {
            id: 'feed',
            icon: 'bell',
            title: 'Morning Alerts',
            desc: 'Daily risk alerts ranked by urgency, each with a plain-English sentence and recommended action.',
            color: 'var(--danger)',
            bgColor: 'var(--danger-bg)',
            stat: herdStats ? `${herdStats.alert} act now` : '…',
        },
        {
            id: 'map',
            icon: 'map',
            title: 'Herd Map',
            desc: 'Interactive contact graph — see which cows share space and how disease risk spreads through the herd.',
            color: 'var(--sage)',
            bgColor: 'var(--success-bg)',
            stat: herdStats ? `${herdStats.total} tracked` : '…',
        },
        {
            id: 'log',
            icon: 'clipboard-list',
            title: 'Data & Records',
            desc: 'Enter observations, upload CSVs, and review prediction history — Tauron learns your herd over time.',
            color: 'var(--straw)',
            bgColor: 'var(--warning-bg)',
            stat: 'Manual + CSV',
        },
        {
            id: 'impact',
            icon: 'leaf',
            title: 'Impact',
            desc: 'Track antibiotics avoided, milk saved, and detection lead time — proof that early warning works.',
            color: 'var(--green)',
            bgColor: 'rgba(46, 94, 30, 0.1)',
            stat: 'Live metrics',
        },
    ];

    return (
        <div style={{
            minHeight: '100vh',
            background: 'var(--bg)',
            overflow: 'auto',
        }}>
            {/* ── Hero Section ── */}
            <div style={{
                background: 'var(--dark-bg)',
                padding: '0',
                position: 'relative',
                overflow: 'hidden',
            }}>
                {/* Decorative circles */}
                <div style={{
                    position: 'absolute', top: '-120px', right: '-80px',
                    width: '300px', height: '300px', borderRadius: '50%',
                    background: 'rgba(106, 158, 72, 0.06)', pointerEvents: 'none'
                }}></div>
                <div style={{
                    position: 'absolute', bottom: '-60px', left: '-40px',
                    width: '200px', height: '200px', borderRadius: '50%',
                    background: 'rgba(201, 152, 58, 0.04)', pointerEvents: 'none'
                }}></div>

                <div style={{
                    maxWidth: '900px', margin: '0 auto',
                    padding: '60px 32px 48px',
                    position: 'relative',
                    opacity: animateIn ? 1 : 0,
                    transform: animateIn ? 'translateY(0)' : 'translateY(20px)',
                    transition: 'all 0.8s cubic-bezier(0.16, 1, 0.3, 1)',
                }}>
                    <div style={{
                        fontFamily: 'JetBrains Mono, monospace',
                        fontSize: '11px',
                        letterSpacing: '0.2em',
                        color: 'var(--sage)',
                        textTransform: 'uppercase',
                        marginBottom: '16px',
                    }}>
                        {dateStr} · {timeStr}
                    </div>

                    <h1 style={{
                        fontFamily: 'Cormorant Garamond, serif',
                        fontSize: 'clamp(36px, 5vw, 56px)',
                        fontWeight: 700,
                        color: 'var(--bg)',
                        lineHeight: 1.1,
                        marginBottom: '12px',
                        letterSpacing: '-1px',
                    }}>
                        {greeting}<span style={{ color: 'var(--sage)' }}>.</span>
                    </h1>

                    <p style={{
                        fontFamily: 'Cormorant Garamond, serif',
                        fontSize: '22px',
                        color: 'rgba(242,237,228,0.6)',
                        lineHeight: 1.5,
                        maxWidth: '600px',
                        marginBottom: '32px',
                    }}>
                        Tauron watches your herd so you don't have to guess.
                        GNN-powered disease prediction — 48 hours before symptoms appear.
                    </p>

                    {/* Quick herd status strip */}
                    {herdStats && (
                        <div style={{
                            display: 'flex', gap: '24px', flexWrap: 'wrap',
                            opacity: animateIn ? 1 : 0,
                            transform: animateIn ? 'translateY(0)' : 'translateY(10px)',
                            transition: 'all 0.8s cubic-bezier(0.16, 1, 0.3, 1) 0.3s',
                        }}>
                            {[
                                { label: 'Healthy', value: herdStats.ok, color: 'var(--sage)' },
                                { label: 'Monitor', value: herdStats.watch, color: 'var(--straw)' },
                                { label: 'Act Now', value: herdStats.alert, color: 'var(--danger)' },
                            ].map(s => (
                                <div key={s.label} style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
                                    <span style={{
                                        fontFamily: 'Cormorant Garamond, serif',
                                        fontSize: '36px', fontWeight: 700, color: s.color,
                                    }}>{s.value}</span>
                                    <span style={{
                                        fontFamily: 'JetBrains Mono, monospace',
                                        fontSize: '10px', letterSpacing: '0.15em',
                                        color: 'rgba(242,237,228,0.4)',
                                        textTransform: 'uppercase',
                                    }}>{s.label}</span>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>

            {/* ── Feature Cards ── */}
            <div style={{
                maxWidth: '900px', margin: '0 auto',
                padding: '40px 32px 20px',
            }}>
                <div style={{
                    fontFamily: 'JetBrains Mono, monospace',
                    fontSize: '10px', letterSpacing: '0.22em',
                    textTransform: 'uppercase', color: 'var(--sage)',
                    marginBottom: '24px',
                }}>
                    Your Tools
                </div>

                <div style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
                    gap: '16px',
                }}>
                    {features.map((f, i) => (
                        <div
                            key={f.id}
                            onClick={() => onNavigate(f.id)}
                            className="hover-lift"
                            style={{
                                background: 'var(--card)',
                                border: '1px solid var(--line)',
                                borderRadius: '12px',
                                padding: '24px',
                                cursor: 'pointer',
                                transition: 'all 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
                                opacity: animateIn ? 1 : 0,
                                transform: animateIn ? 'translateY(0)' : 'translateY(20px)',
                                transitionDelay: `${0.15 + i * 0.08}s`,
                                position: 'relative',
                                overflow: 'hidden',
                            }}
                        >
                            {/* Subtle accent line at top */}
                            <div style={{
                                position: 'absolute', top: 0, left: 0, right: 0,
                                height: '3px', background: f.color, opacity: 0.6,
                            }}></div>

                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px' }}>
                                <div style={{
                                    width: '40px', height: '40px', borderRadius: '10px',
                                    background: f.bgColor,
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    color: f.color,
                                }}>
                                    <i data-lucide={f.icon} style={{ width: '20px', height: '20px' }}></i>
                                </div>
                                <div style={{
                                    fontFamily: 'JetBrains Mono, monospace',
                                    fontSize: '10px', letterSpacing: '0.1em',
                                    color: f.color, textTransform: 'uppercase',
                                    background: f.bgColor,
                                    padding: '4px 8px', borderRadius: '4px',
                                }}>
                                    {f.stat}
                                </div>
                            </div>

                            <h3 style={{
                                fontFamily: 'Cormorant Garamond, serif',
                                fontSize: '22px', fontWeight: 700,
                                color: 'var(--barn)', marginBottom: '8px',
                            }}>
                                {f.title}
                            </h3>

                            <p style={{
                                fontFamily: 'Cormorant Garamond, serif',
                                fontSize: '15px', color: 'var(--mist)',
                                lineHeight: 1.5,
                                marginBottom: '16px',
                            }}>
                                {f.desc}
                            </p>

                            <div style={{
                                display: 'flex', alignItems: 'center', gap: '6px',
                                fontFamily: 'JetBrains Mono, monospace',
                                fontSize: '10px', letterSpacing: '0.1em',
                                color: f.color, textTransform: 'uppercase',
                            }}>
                                Open <i data-lucide="arrow-right" style={{ width: '12px', height: '12px' }}></i>
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            {/* ── How It Works ── */}
            <div style={{
                maxWidth: '900px', margin: '0 auto',
                padding: '40px 32px 20px',
                opacity: animateIn ? 1 : 0,
                transform: animateIn ? 'translateY(0)' : 'translateY(20px)',
                transition: 'all 0.8s cubic-bezier(0.16, 1, 0.3, 1) 0.6s',
            }}>
                <div style={{
                    fontFamily: 'JetBrains Mono, monospace',
                    fontSize: '10px', letterSpacing: '0.22em',
                    textTransform: 'uppercase', color: 'var(--sage)',
                    marginBottom: '24px',
                }}>
                    How Tauron Works
                </div>

                <div style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                    gap: '20px',
                }}>
                    {[
                        { step: '01', title: 'Ingest', desc: 'Upload parlor CSVs or enter records manually — Tauron handles any format.', icon: 'upload' },
                        { step: '02', title: 'Graph', desc: 'Builds a contact network from pen and feeding data — who shares space with whom.', icon: 'share-2' },
                        { step: '03', title: 'Predict', desc: 'GraphSAGE + GRU model scores mastitis, BRD, and lameness risk for every cow.', icon: 'brain' },
                        { step: '04', title: 'Alert', desc: 'Plain-English alerts with XAI explanations — name the cow, the risk, the action.', icon: 'bell-ring' },
                    ].map((s, i) => (
                        <div key={s.step} style={{
                            padding: '20px',
                            borderLeft: '2px solid var(--line)',
                            paddingLeft: '20px',
                        }}>
                            <div style={{
                                fontFamily: 'JetBrains Mono, monospace',
                                fontSize: '24px', fontWeight: 700,
                                color: 'var(--sage)', opacity: 0.3,
                                marginBottom: '8px',
                            }}>{s.step}</div>
                            <h4 style={{
                                fontFamily: 'Cormorant Garamond, serif',
                                fontSize: '20px', fontWeight: 700,
                                color: 'var(--barn)', marginBottom: '6px',
                            }}>{s.title}</h4>
                            <p style={{
                                fontFamily: 'Cormorant Garamond, serif',
                                fontSize: '14px', color: 'var(--mist)',
                                lineHeight: 1.5,
                            }}>{s.desc}</p>
                        </div>
                    ))}
                </div>
            </div>

            {/* ── CTA Banner ── */}
            <div style={{
                maxWidth: '900px', margin: '0 auto',
                padding: '20px 32px 48px',
                opacity: animateIn ? 1 : 0,
                transition: 'all 0.8s cubic-bezier(0.16, 1, 0.3, 1) 0.8s',
            }}>
                <div style={{
                    background: 'var(--green)',
                    borderRadius: '16px',
                    padding: '32px',
                    color: 'var(--bg)',
                    position: 'relative',
                    overflow: 'hidden',
                    boxShadow: '0 12px 32px rgba(46, 94, 30, 0.2)',
                }}>
                    <div style={{
                        position: 'absolute', top: '-60px', right: '-40px',
                        width: '200px', height: '200px', borderRadius: '50%',
                        background: 'rgba(255,255,255,0.06)', pointerEvents: 'none'
                    }}></div>
                    <div style={{
                        position: 'absolute', bottom: '-40px', left: '40%',
                        width: '120px', height: '120px', borderRadius: '50%',
                        background: 'rgba(255,255,255,0.04)', pointerEvents: 'none'
                    }}></div>

                    <div style={{ position: 'relative' }}>
                        <div style={{
                            fontFamily: 'JetBrains Mono, monospace',
                            fontSize: '10px', letterSpacing: '0.2em',
                            textTransform: 'uppercase', opacity: 0.7,
                            marginBottom: '12px',
                        }}>
                            Built for 6am in a barn
                        </div>
                        <h3 style={{
                            fontFamily: 'Cormorant Garamond, serif',
                            fontSize: '28px', fontWeight: 700,
                            lineHeight: 1.2, marginBottom: '12px',
                        }}>
                            Works with whatever data you already have.
                        </h3>
                        <p style={{
                            fontSize: '16px', lineHeight: 1.5,
                            opacity: 0.85, marginBottom: '24px',
                            maxWidth: '500px',
                        }}>
                            No new hardware. No new habits. Upload your existing parlor records
                            and get your first alert within minutes.
                        </p>
                        <button
                            onClick={() => onNavigate('feed')}
                            className="hover-lift"
                            style={{
                                background: 'var(--bg)',
                                color: 'var(--green)',
                                border: 'none',
                                padding: '14px 28px',
                                borderRadius: '8px',
                                fontFamily: 'Cormorant Garamond, serif',
                                fontSize: '15px', fontWeight: 700,
                                letterSpacing: '0.1em',
                                textTransform: 'uppercase',
                                cursor: 'pointer',
                                display: 'inline-flex',
                                alignItems: 'center', gap: '8px',
                                transition: 'transform 0.2s',
                            }}
                        >
                            <i data-lucide="arrow-right" style={{ width: '16px', height: '16px' }}></i>
                            View Today's Alerts
                        </button>
                    </div>
                </div>
            </div>

            {/* ── Footer ── */}
            <div style={{
                maxWidth: '900px', margin: '0 auto',
                padding: '0 32px 32px',
                textAlign: 'center',
            }}>
                <p style={{
                    fontFamily: 'JetBrains Mono, monospace',
                    fontSize: '10px', letterSpacing: '0.15em',
                    color: 'var(--mist)', textTransform: 'uppercase',
                }}>
                    Tauron · Graph Neural Network Early Warning · 2026
                </p>
            </div>
        </div>
    );
};
