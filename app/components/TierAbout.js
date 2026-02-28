const { useState, useEffect } = React;

const TierAbout = () => {
    const [animateIn, setAnimateIn] = useState(false);

    useEffect(() => {
        setTimeout(() => setAnimateIn(true), 100);
    }, []);

    useEffect(() => {
        if (window.lucide) window.lucide.createIcons();
    });

    const tiers = [
        {
            badge: 'Tier 1 · Every Farm',
            title: 'Manual Records Only',
            desc: 'CSV upload or 5-field form. Data every farm already has — no hardware, no upfront capital.',
            items: ['Milk yield per cow', 'Vet treatment log', 'Pen & stall assignments', 'Calving dates'],
            accuracy: 55,
            color: 'var(--sage)',
            bgColor: 'var(--success-bg)',
            icon: 'clipboard-list',
        },
        {
            badge: 'Tier 2 · Mid-size Farms',
            title: 'Automated Milking Data',
            desc: 'DeLaval, Lely, GEA — connects via export API. No extra hardware needed.',
            items: ['All Tier 1, plus:', 'Milk conductivity (mastitis proxy)', 'Milking frequency & duration', 'Body weight from platforms'],
            accuracy: 74,
            color: 'var(--straw)',
            bgColor: 'var(--warning-bg)',
            icon: 'cpu',
        },
        {
            badge: 'Tier 3 · Sensor-equipped',
            title: 'Full Wearable Integration',
            desc: 'SCR/Allflex, Nedap, CowManager — real-time proximity + activity data.',
            items: ['All Tier 1 & 2, plus:', 'Rumination time (hourly)', 'Activity / step count', 'Proximity events between cows'],
            accuracy: 89,
            color: 'var(--danger)',
            bgColor: 'var(--danger-bg)',
            icon: 'radio',
        },
    ];

    return (
        <div style={{ padding: '32px 24px', minHeight: '100%' }}>

            {/* Header */}
            <div style={{
                opacity: animateIn ? 1 : 0,
                transform: animateIn ? 'translateY(0)' : 'translateY(16px)',
                transition: 'all 0.6s cubic-bezier(0.16, 1, 0.3, 1)',
            }}>
                <div className="kicker" style={{ marginBottom: '8px' }}>About Tauron</div>
                <h2 style={{
                    fontFamily: 'Cormorant Garamond, serif',
                    fontSize: 'clamp(28px, 4vw, 40px)',
                    fontWeight: 700,
                    color: 'var(--barn)',
                    lineHeight: 1.15,
                    marginBottom: '12px',
                }}>
                    Meets farmers where they are.
                </h2>
                <p style={{
                    fontFamily: 'Cormorant Garamond, serif',
                    fontSize: '17px',
                    color: 'var(--mist)',
                    lineHeight: 1.6,
                    maxWidth: '640px',
                    marginBottom: '32px',
                }}>
                    Tiered from paper records to full wearables — useful on day one, smarter
                    with more data. The graph structure comes from pen assignments every farm
                    already records.
                </p>
            </div>

            {/* Tier Cards */}
            <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
                gap: '16px',
                marginBottom: '32px',
            }}>
                {tiers.map((t, i) => (
                    <div
                        key={t.badge}
                        className="card hover-lift"
                        style={{
                            padding: '0',
                            opacity: animateIn ? 1 : 0,
                            transform: animateIn ? 'translateY(0)' : 'translateY(20px)',
                            transition: `all 0.6s cubic-bezier(0.16, 1, 0.3, 1) ${0.15 + i * 0.1}s`,
                            position: 'relative',
                            overflow: 'hidden',
                        }}
                    >
                        {/* Accent bar */}
                        <div style={{
                            height: '4px',
                            background: t.color,
                            opacity: 0.7,
                        }}></div>

                        <div style={{ padding: '24px' }}>
                            {/* Badge */}
                            <div style={{
                                fontFamily: 'JetBrains Mono, monospace',
                                fontSize: '10px',
                                letterSpacing: '0.12em',
                                textTransform: 'uppercase',
                                color: t.color,
                                background: t.bgColor,
                                display: 'inline-block',
                                padding: '4px 10px',
                                borderRadius: '4px',
                                marginBottom: '14px',
                            }}>
                                {t.badge}
                            </div>

                            {/* Icon + Title */}
                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
                                <div style={{
                                    width: '36px', height: '36px', borderRadius: '8px',
                                    background: t.bgColor,
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    color: t.color, flexShrink: 0,
                                }}>
                                    <i data-lucide={t.icon} style={{ width: '18px', height: '18px' }}></i>
                                </div>
                                <h3 style={{
                                    fontFamily: 'Cormorant Garamond, serif',
                                    fontSize: '22px', fontWeight: 700,
                                    color: 'var(--barn)',
                                }}>
                                    {t.title}
                                </h3>
                            </div>

                            <p style={{
                                fontFamily: 'Cormorant Garamond, serif',
                                fontSize: '14px', color: 'var(--mist)',
                                lineHeight: 1.55, marginBottom: '14px',
                            }}>
                                {t.desc}
                            </p>

                            {/* Data list */}
                            <ul style={{
                                listStyle: 'none', padding: 0, margin: '0 0 18px 0',
                            }}>
                                {t.items.map(item => (
                                    <li key={item} style={{
                                        fontFamily: 'Cormorant Garamond, serif',
                                        fontSize: '14px',
                                        color: 'var(--ink)',
                                        lineHeight: 1.8,
                                        paddingLeft: '16px',
                                        position: 'relative',
                                    }}>
                                        <span style={{
                                            position: 'absolute', left: 0, top: '9px',
                                            width: '5px', height: '5px', borderRadius: '50%',
                                            background: t.color, opacity: 0.6,
                                        }}></span>
                                        {item}
                                    </li>
                                ))}
                            </ul>

                            {/* Accuracy bar */}
                            <div>
                                <div style={{
                                    display: 'flex', justifyContent: 'space-between',
                                    fontSize: '12px', marginBottom: '4px',
                                }}>
                                    <span style={{
                                        fontFamily: 'JetBrains Mono, monospace',
                                        letterSpacing: '0.08em',
                                        textTransform: 'uppercase',
                                        color: 'var(--mist)',
                                    }}>Accuracy</span>
                                    <span style={{
                                        fontFamily: 'Cormorant Garamond, serif',
                                        fontWeight: 700,
                                        color: t.color,
                                    }}>~{t.accuracy}%</span>
                                </div>
                                <div className="xai-bar" style={{ height: '8px' }}>
                                    <div className="xai-bar-fill" style={{
                                        width: animateIn ? `${t.accuracy}%` : '0%',
                                        background: t.color,
                                        transitionDelay: `${0.4 + i * 0.15}s`,
                                    }}></div>
                                </div>
                            </div>
                        </div>
                    </div>
                ))}
            </div>

            {/* Key Insight Box */}
            <div style={{
                background: 'var(--dark-bg)',
                borderRadius: '12px',
                padding: '28px 24px',
                marginBottom: '24px',
                position: 'relative',
                overflow: 'hidden',
                opacity: animateIn ? 1 : 0,
                transition: 'all 0.6s cubic-bezier(0.16, 1, 0.3, 1) 0.5s',
            }}>
                <div style={{
                    position: 'absolute', top: '-60px', right: '-40px',
                    width: '180px', height: '180px', borderRadius: '50%',
                    background: 'rgba(106, 158, 72, 0.08)', pointerEvents: 'none',
                }}></div>

                <div style={{ position: 'relative' }}>
                    <div className="kicker" style={{ marginBottom: '10px', color: 'var(--sage)' }}>
                        Why It Works at Tier 1
                    </div>
                    <p style={{
                        fontFamily: 'Cormorant Garamond, serif',
                        fontSize: '17px',
                        color: 'rgba(242,237,228,0.75)',
                        lineHeight: 1.65,
                    }}>
                        The <strong style={{ color: 'var(--sage-lt)' }}>graph structure</strong> — the
                        insight that pen assignments alone define a contact network — is why Tauron works
                        at Tier 1 when every competitor requires hardware.{' '}
                        <strong style={{ color: 'var(--sage-lt)' }}>Two cows in the same pen = an edge.
                            Same feeding station = a weighted edge.</strong>{' '}
                        Tauron doesn't need GPS to know who was near whom. It just needs to know where
                        they sleep and eat.
                    </p>
                </div>
            </div>

            {/* How Tauron Uses Your Data */}
            <div style={{
                marginBottom: '24px',
                opacity: animateIn ? 1 : 0,
                transition: 'all 0.6s cubic-bezier(0.16, 1, 0.3, 1) 0.6s',
            }}>
                <div className="kicker" style={{ marginBottom: '16px' }}>Pipeline</div>
                <div style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                    gap: '12px',
                }}>
                    {[
                        { n: '01', label: 'Ingest', desc: 'Upload CSV or enter records', icon: 'upload' },
                        { n: '02', label: 'Graph', desc: 'Build contact network from pens', icon: 'share-2' },
                        { n: '03', label: 'Predict', desc: 'GraphSAGE + GRU inference', icon: 'brain' },
                        { n: '04', label: 'Explain', desc: 'XAI traces top features & edges', icon: 'search' },
                        { n: '05', label: 'Alert', desc: 'Plain-English action', icon: 'bell-ring' },
                    ].map(s => (
                        <div key={s.n} className="card" style={{ padding: '16px', textAlign: 'center' }}>
                            <div style={{
                                fontFamily: 'JetBrains Mono, monospace',
                                fontSize: '20px', fontWeight: 700,
                                color: 'var(--sage)', opacity: 0.25,
                                marginBottom: '4px',
                            }}>{s.n}</div>
                            <div style={{
                                fontFamily: 'Cormorant Garamond, serif',
                                fontSize: '17px', fontWeight: 700,
                                color: 'var(--barn)', marginBottom: '4px',
                            }}>{s.label}</div>
                            <div style={{
                                fontFamily: 'Cormorant Garamond, serif',
                                fontSize: '13px', color: 'var(--mist)', lineHeight: 1.4,
                            }}>{s.desc}</div>
                        </div>
                    ))}
                </div>
            </div>

            {/* Footer */}
            <div style={{
                textAlign: 'center', padding: '16px 0 8px',
                opacity: animateIn ? 1 : 0,
                transition: 'all 0.6s cubic-bezier(0.16, 1, 0.3, 1) 0.7s',
            }}>
                <p style={{
                    fontFamily: 'JetBrains Mono, monospace',
                    fontSize: '10px', letterSpacing: '0.15em',
                    color: 'var(--mist)', textTransform: 'uppercase',
                }}>
                    Tauron · Cornell Digital Ag Hackathon · 2026
                </p>
            </div>
        </div>
    );
};
