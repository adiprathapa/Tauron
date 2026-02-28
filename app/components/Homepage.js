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

            {/* ── Meets Farmers Where They Are (Tiers) ── */}
            <div style={{
                maxWidth: '900px', margin: '0 auto',
                padding: '40px 32px 20px',
                opacity: animateIn ? 1 : 0,
                transform: animateIn ? 'translateY(0)' : 'translateY(20px)',
                transition: 'all 0.8s cubic-bezier(0.16, 1, 0.3, 1) 0.5s',
            }}>
                <div style={{
                    fontFamily: 'JetBrains Mono, monospace',
                    fontSize: '10px', letterSpacing: '0.22em',
                    textTransform: 'uppercase', color: 'var(--sage)',
                    marginBottom: '16px',
                }}>
                    Meets farmers where they are
                </div>

                <h3 style={{
                    fontFamily: 'Cormorant Garamond, serif',
                    fontSize: '32px', fontWeight: 700,
                    color: 'var(--barn)', marginBottom: '16px', lineHeight: 1.2
                }}>
                    Tiered from paper records to full wearables.<br />Useful on day one.
                </h3>

                <p style={{
                    fontFamily: 'Cormorant Garamond, serif',
                    fontSize: '17px', color: 'var(--mist)',
                    lineHeight: 1.6, maxWidth: '700px', marginBottom: '32px',
                }}>
                    Tauron is designed to work with the data you already have. No upfront capital or new hardware required. As you add automation, Tauron's predictions get more accurate.
                </p>

                <div style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
                    gap: '16px',
                    marginBottom: '40px',
                }}>
                    {[
                        {
                            badge: 'Tier 1 · Every Farm',
                            title: 'Manual Records',
                            desc: 'Data every farm already has — no hardware, no upfront capital.',
                            items: ['Milk yield per cow', 'Vet treatment log', 'Pen assignments'],
                            accuracy: 55, color: 'var(--sage)', bgColor: 'var(--success-bg)', icon: 'clipboard-list',
                        },
                        {
                            badge: 'Tier 2 · Automated',
                            title: 'Milking Systems',
                            desc: 'Connects via export API. No extra hardware needed.',
                            items: ['Tier 1 + conductivity', 'Milking duration', 'Body weight'],
                            accuracy: 74, color: 'var(--straw)', bgColor: 'var(--warning-bg)', icon: 'cpu',
                        },
                        {
                            badge: 'Tier 3 · Sensors',
                            title: 'Full Wearables',
                            desc: 'Real-time proximity + activity data for maximum precision.',
                            items: ['Tier 2 + rumination', 'Activity / steps', 'Cow proximity'],
                            accuracy: 89, color: 'var(--danger)', bgColor: 'var(--danger-bg)', icon: 'radio',
                        },
                    ].map((t, i) => (
                        <div key={t.badge} className="card hover-lift" style={{
                            padding: '0', position: 'relative', overflow: 'hidden',
                        }}>
                            <div style={{ height: '4px', background: t.color, opacity: 0.7 }}></div>
                            <div style={{ padding: '24px' }}>
                                <div style={{
                                    fontFamily: 'JetBrains Mono, monospace', fontSize: '10px',
                                    letterSpacing: '0.12em', textTransform: 'uppercase',
                                    color: t.color, background: t.bgColor,
                                    display: 'inline-block', padding: '4px 10px',
                                    borderRadius: '4px', marginBottom: '14px',
                                }}>{t.badge}</div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
                                    <div style={{
                                        width: '36px', height: '36px', borderRadius: '8px',
                                        background: t.bgColor, display: 'flex', alignItems: 'center', justifyContent: 'center',
                                        color: t.color, flexShrink: 0,
                                    }}>
                                        <i data-lucide={t.icon} style={{ width: '18px', height: '18px' }}></i>
                                    </div>
                                    <h4 style={{
                                        fontFamily: 'Cormorant Garamond, serif', fontSize: '20px', fontWeight: 700,
                                        color: 'var(--barn)', margin: 0
                                    }}>{t.title}</h4>
                                </div>
                                <p style={{
                                    fontFamily: 'Cormorant Garamond, serif', fontSize: '14px', color: 'var(--mist)',
                                    lineHeight: 1.55, marginBottom: '14px',
                                }}>{t.desc}</p>
                                <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 18px 0' }}>
                                    {t.items.map(item => (
                                        <li key={item} style={{
                                            fontFamily: 'Cormorant Garamond, serif', fontSize: '14px',
                                            color: 'var(--ink)', lineHeight: 1.8, paddingLeft: '16px', position: 'relative',
                                        }}>
                                            <span style={{
                                                position: 'absolute', left: 0, top: '9px', width: '5px', height: '5px', borderRadius: '50%',
                                                background: t.color, opacity: 0.6,
                                            }}></span>
                                            {item}
                                        </li>
                                    ))}
                                </ul>
                                <div>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', marginBottom: '4px' }}>
                                        <span style={{ fontFamily: 'JetBrains Mono, monospace', letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--mist)' }}>Accuracy</span>
                                        <span style={{ fontFamily: 'Cormorant Garamond, serif', fontWeight: 700, color: t.color }}>~{t.accuracy}%</span>
                                    </div>
                                    <div className="xai-bar" style={{ height: '6px' }}>
                                        <div className="xai-bar-fill" style={{ width: animateIn ? `${t.accuracy}%` : '0%', background: t.color, transitionDelay: `${0.6 + i * 0.15}s` }}></div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>

                {/* Key Insight Box */}
                <div style={{
                    background: 'var(--dark-bg)', borderRadius: '12px', padding: '28px 24px',
                    marginBottom: '40px', position: 'relative', overflow: 'hidden',
                }}>
                    <div style={{ position: 'absolute', top: '-60px', right: '-40px', width: '180px', height: '180px', borderRadius: '50%', background: 'rgba(106, 158, 72, 0.08)', pointerEvents: 'none' }}></div>
                    <div style={{ position: 'relative' }}>
                        <div className="kicker" style={{ marginBottom: '10px', color: 'var(--sage)' }}>Why It Works at Tier 1</div>
                        <p style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: '16px', color: 'rgba(242,237,228,0.75)', lineHeight: 1.65, margin: 0 }}>
                            The <strong style={{ color: 'var(--sage-lt)' }}>graph structure</strong> — the insight that pen assignments alone define a contact network — is why Tauron works at Tier 1 when every competitor requires hardware.{' '}
                            <strong style={{ color: 'var(--sage-lt)' }}>Two cows in the same pen = an edge. Same feeding station = a weighted edge.</strong>{' '}
                            Tauron doesn't need GPS to know who was near whom. It just needs to know where they sleep and eat.
                        </p>
                    </div>
                </div>

                {/* Pipeline */}
                <div>
                    <div className="kicker" style={{ marginBottom: '16px' }}>Pipeline</div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '12px' }}>
                        {[
                            { n: '01', label: 'Ingest', desc: 'Upload CSV or enter records', icon: 'upload' },
                            { n: '02', label: 'Graph', desc: 'Build contact network from pens', icon: 'share-2' },
                            { n: '03', label: 'Predict', desc: 'GraphSAGE + GRU inference', icon: 'brain' },
                            { n: '04', label: 'Explain', desc: 'XAI traces top features & edges', icon: 'search' },
                            { n: '05', label: 'Alert', desc: 'Claude → plain-English action', icon: 'bell-ring' },
                        ].map(s => (
                            <div key={s.n} className="card" style={{ padding: '16px', textAlign: 'center' }}>
                                <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '18px', fontWeight: 700, color: 'var(--sage)', opacity: 0.25, marginBottom: '4px' }}>{s.n}</div>
                                <div style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: '16px', fontWeight: 700, color: 'var(--barn)', marginBottom: '4px' }}>{s.label}</div>
                                <div style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: '12px', color: 'var(--mist)', lineHeight: 1.4 }}>{s.desc}</div>
                            </div>
                        ))}
                    </div>
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
