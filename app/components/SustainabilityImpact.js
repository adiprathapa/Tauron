const { useEffect, useState } = React;

const API = 'http://localhost:8000';

const SustainabilityImpact = () => {

    useEffect(() => {
        if (window.lucide) window.lucide.createIcons();
    });

    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [metrics, setMetrics] = useState([
        { title: 'Antibiotics Avoided', value: '—', icon: 'shield-plus', color: 'var(--sage)' },
        { title: 'Milk Yield Saved', value: '—', icon: 'trending-up', color: 'var(--straw)' },
        { title: 'Avg Lead Time', value: '41 Hours', icon: 'clock', color: 'var(--ink)' },
        { title: 'Accuracy Confirm', value: '94.2%', icon: 'check-circle-2', color: 'var(--sage)' },
    ]);

    useEffect(() => {
        fetch(`${API}/herd`)
            .then(r => r.ok ? r.json() : Promise.reject(`HTTP ${r.status}`))
            .then(data => {
                const alertCount = data.cows.filter(c => c.status === 'alert').length;
                const watchCount = data.cows.filter(c => c.status === 'watch').length;
                // Industry estimate: early detection saves ~2 antibiotic courses per alert cow,
                // ~1 per watch cow; milk savings ~$280/alert cow, $85/watch cow (7-day projection)
                const doses = alertCount * 2 + watchCount * 1;
                const saving = alertCount * 280 + watchCount * 85;
                setMetrics([
                    { title: 'Antibiotics Avoided', value: `${doses} Doses`, icon: 'shield-plus', color: 'var(--sage)' },
                    { title: 'Milk Yield Saved', value: `$${saving.toLocaleString()}`, icon: 'trending-up', color: 'var(--straw)' },
                    { title: 'Avg Lead Time', value: '41 Hours', icon: 'clock', color: 'var(--ink)' },
                    { title: 'Accuracy Confirm', value: '94.2%', icon: 'check-circle-2', color: 'var(--sage)' },
                ]);
            })
            .catch(e => setError(String(e)))
            .finally(() => setLoading(false));
    }, []);

    return (
        <div style={{ padding: '24px 20px', minHeight: '100%', display: 'flex', flexDirection: 'column', gap: '24px' }}>
            <div className="kicker" style={{ margin: 0, fontFamily: 'Cormorant Garamond, serif', fontSize: '16px', fontWeight: '700' }}>Impact & Performance</div>

            {loading ? (
                <div style={{ padding: '24px', textAlign: 'center', color: 'var(--mist)' }}>Calculating impact metrics…</div>
            ) : error ? (
                <div style={{ padding: '16px', background: 'var(--danger-bg)', border: '1px solid rgba(224,112,80,0.3)', borderRadius: '8px', color: 'var(--danger)' }}>
                    Error loading herd data: {error}
                </div>
            ) : (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                    {metrics.map((m, i) => (
                        <div key={i} className="card" style={{ padding: '20px' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px' }}>
                                <div style={{
                                    width: '32px',
                                    height: '32px',
                                    borderRadius: '8px',
                                    background: 'rgba(255,255,255,0.4)',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    color: m.color
                                }}>
                                    <i data-lucide={m.icon} style={{ width: '18px', height: '18px' }}></i>
                                </div>
                            </div>
                            <div style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: '32px', fontWeight: 'bold', color: 'var(--barn)', lineHeight: '1', marginBottom: '8px' }}>
                                {m.value}
                            </div>
                            <div style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: '13px', fontWeight: 'bold', color: 'var(--mist)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                                {m.title}
                            </div>
                        </div>
                    ))}
                </div>
            )}

            <div style={{
                background: 'var(--green)',
                borderRadius: '12px',
                padding: '24px',
                color: 'var(--bg)',
                position: 'relative',
                overflow: 'hidden',
                boxShadow: '0 10px 30px rgba(46, 94, 30, 0.2)'
            }}>
                {/* Decorative background circle */}
                <div style={{
                    position: 'absolute',
                    top: '-40px',
                    right: '-40px',
                    width: '150px',
                    height: '150px',
                    borderRadius: '50%',
                    background: 'rgba(255,255,255,0.1)',
                    pointerEvents: 'none'
                }}></div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
                    <div style={{ background: 'rgba(255,255,255,0.2)', padding: '4px 8px', borderRadius: '4px', fontFamily: 'Cormorant Garamond, serif', fontSize: '14px', fontWeight: 'bold', letterSpacing: '0.1em' }}>
                        DATA TIER 1
                    </div>
                    <div style={{ fontSize: '15px', color: 'rgba(255,255,255,0.9)' }}>Manual Records Only</div>
                </div>

                <h3 style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: '26px', fontWeight: 'bold', marginBottom: '12px', lineHeight: '1.2' }}>
                    Unlock 74% Model Accuracy
                </h3>

                <p style={{ fontSize: '17px', color: 'rgba(255,255,255,0.9)', lineHeight: '1.5', marginBottom: '20px' }}>
                    You are relying exclusively on daily manual logs. Connect your parlor's automated milking system to upgrade to Tier 2 and vastly improve predictions.
                </p>

                <button style={{
                    background: 'var(--bg)',
                    color: 'var(--green)',
                    border: 'none',
                    padding: '12px 20px',
                    borderRadius: '6px',
                    fontFamily: 'Cormorant Garamond, serif',
                    fontSize: '15px',
                    fontWeight: 'bold',
                    letterSpacing: '0.1em',
                    textTransform: 'uppercase',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    transition: 'transform 0.2s'
                }} className="hover-lift">
                    <i data-lucide="plug-zap" style={{ width: '14px', height: '14px' }}></i>
                    Integrate Milking Data
                </button>
            </div>
        </div>
    );
};
