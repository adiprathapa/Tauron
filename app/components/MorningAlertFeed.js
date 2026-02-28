const { useState, useEffect } = React;

const API = 'http://localhost:8000';
const PEN_LABELS = ['A', 'B', 'C', 'D', 'E', 'F'];

const derivePen = (id) => PEN_LABELS[Math.min(Math.floor(id / 10), PEN_LABELS.length - 1)] || 'X';
const statusToLevel = (s) => s === 'alert' ? 'high' : (s === 'watch' ? 'warn' : 'ok');
const fmtTime = () => new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const fmtFeature = (f) => f ? f.replace(/_/g, ' ') : '—';

const AlertCard = ({ alert }) => {
    const [expanded, setExpanded] = useState(false);
    const [explain, setExplain] = useState(null);
    const [loadingExplain, setLoadingExplain] = useState(false);

    useEffect(() => {
        if (window.lucide) window.lucide.createIcons();
    });

    const handleExpand = () => {
        const next = !expanded;
        setExpanded(next);
        if (next && !explain && !loadingExplain) {
            setLoadingExplain(true);
            fetch(`${API}/explain/${alert.cowId}`)
                .then(r => r.ok ? r.json() : Promise.reject(r.status))
                .then(setExplain)
                .catch(() => setExplain({ alert_text: 'Explanation unavailable — check backend.', top_edge: null }))
                .finally(() => setLoadingExplain(false));
        }
    };

    const getColors = (level) => {
        switch (level) {
            case 'high': return { bg: 'var(--danger-bg)', border: 'rgba(224, 112, 80, 0.3)', dot: 'var(--danger)' };
            case 'warn': return { bg: 'var(--warning-bg)', border: 'rgba(201, 152, 58, 0.3)', dot: 'var(--straw)' };
            default: return { bg: 'var(--success-bg)', border: 'rgba(106, 158, 72, 0.3)', dot: 'var(--sage)' };
        }
    };

    const colors = getColors(alert.level);

    return (
        <div style={{
            background: colors.bg,
            border: `1px solid ${colors.border}`,
            borderRadius: '8px',
            padding: '16px',
            marginBottom: '12px',
            transition: 'all 0.3s ease',
            cursor: 'pointer'
        }} onClick={handleExpand} className="hover-lift">

            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <div className={alert.level === 'high' ? 'animate-pulse-ring' : ''} style={{
                        width: '8px', height: '8px', borderRadius: '50%', background: colors.dot
                    }}></div>
                    <span style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: '15px', fontWeight: '700', color: 'rgba(24, 20, 16, 0.9)' }}>
                        COW {alert.cowId}
                    </span>
                    <span style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: '14px', color: 'var(--mist)', marginLeft: '4px' }}>
                        Pen {alert.pen}
                    </span>
                </div>
                <div style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: '12px', fontWeight: '600', color: colors.dot }}>
                    {alert.time}
                </div>
            </div>

            <div style={{ marginTop: '8px', fontSize: '18px', fontWeight: '600', color: 'var(--barn)', lineHeight: '1.2' }}>
                {alert.message}
            </div>

            <div style={{ marginTop: '8px', fontSize: '16px', color: '#444' }}>
                <strong style={{ color: 'var(--ink)' }}>Signal:</strong> {fmtFeature(alert.top_feature)}
            </div>

            <div style={{
                marginTop: '12px',
                borderTop: expanded ? `1px solid ${colors.border}` : 'none',
                paddingTop: expanded ? '12px' : '0',
                display: expanded ? 'block' : 'none',
                animation: expanded ? 'fadeIn 0.3s ease' : 'none'
            }}>
                <div style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: '12px', fontWeight: 'bold', textTransform: 'uppercase', color: 'var(--mist)', letterSpacing: '0.1em', marginBottom: '10px' }}>
                    XAI Trace
                </div>

                {loadingExplain ? (
                    <div style={{ fontSize: '14px', color: 'var(--mist)' }}>Loading explanation…</div>
                ) : explain ? (
                    <>
                        {/* ── Label / Value grid ── */}
                        <div className="xai-grid">
                            <span className="xai-label">Top Feature</span>
                            <span className="xai-value">{fmtFeature(explain.top_feature || explain.xai?.top_feature)}</span>

                            <span className="xai-label">Feature Δ</span>
                            <span className={`xai-value ${(explain.feature_delta ?? explain.xai?.feature_delta ?? 0) < 0 ? 'xai-delta-neg' : 'xai-delta-pos'}`}>
                                {((explain.feature_delta ?? explain.xai?.feature_delta) != null)
                                    ? `${(explain.feature_delta ?? explain.xai?.feature_delta) > 0 ? '+' : ''}${Math.round((explain.feature_delta ?? explain.xai?.feature_delta) * 100)}%`
                                    : '—'}
                            </span>

                            {explain.top_edge && (explain.top_edge.from != null || explain.top_edge.to != null || explain.top_edge.neighbour_cow != null) && (
                                <>
                                    <span className="xai-label">Top Edge</span>
                                    <span className="xai-value">
                                        {explain.top_edge.from != null ? `#${explain.top_edge.from}` : `#${alert.cowId}`}
                                        {' → '}
                                        #{explain.top_edge.to ?? explain.top_edge.neighbour_cow}
                                        <span style={{ color: 'var(--mist)', marginLeft: '6px', fontSize: '13px' }}>
                                            wt {(explain.top_edge.weight ?? explain.top_edge.edge_weight ?? 0).toFixed(2)}
                                        </span>
                                    </span>
                                </>
                            )}
                        </div>

                        {/* ── Disease Breakdown ── */}
                        {(explain.all_risks || explain.xai?.all_risks) && (
                            <div style={{ marginTop: '12px' }}>
                                <div className="xai-label" style={{ marginBottom: '6px' }}>Disease Breakdown</div>
                                {Object.entries(explain.all_risks || explain.xai?.all_risks).map(([disease, score]) => {
                                    const pct = Math.round(score * 100);
                                    const dominant = disease === (explain.dominant_disease || explain.xai?.dominant_disease);
                                    return (
                                        <div key={disease} style={{ marginBottom: '5px' }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', marginBottom: '2px' }}>
                                                <span style={{ color: dominant ? 'var(--ink)' : 'var(--mist)', fontWeight: dominant ? '700' : '400', textTransform: 'capitalize' }}>
                                                    {disease === 'brd' ? 'BRD' : disease}
                                                </span>
                                                <span style={{ color: dominant ? 'var(--ink)' : 'var(--mist)', fontWeight: dominant ? '700' : '400' }}>
                                                    {pct}%
                                                </span>
                                            </div>
                                            <div className="xai-bar">
                                                <div className="xai-bar-fill" style={{
                                                    width: `${pct}%`,
                                                    background: dominant ? colors.dot : 'var(--line)',
                                                    opacity: dominant ? 1 : 0.6
                                                }}></div>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}

                        {/* ── Alert Text ── */}
                        <div style={{ fontSize: '15px', color: '#444', lineHeight: '1.5', marginTop: '12px', borderTop: `1px dashed ${colors.border}`, paddingTop: '10px' }}>
                            <i data-lucide="message-circle" style={{ width: '13px', height: '13px', verticalAlign: '-2px', marginRight: '4px' }}></i>
                            {explain.alert_text || explain.alert || explain.xai?.alert_text || 'No alert text available.'}
                        </div>

                        {/* ── Confidence ── */}
                        <div style={{ marginTop: '8px', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '14px', color: 'var(--sage)', fontWeight: '600' }}>
                            <i data-lucide="check-circle" style={{ width: '12px', height: '12px' }}></i>
                            Model Confidence: {alert.confidence}%
                        </div>
                    </>
                ) : null}
            </div>

            <div style={{
                marginTop: '12px',
                fontSize: '13px',
                color: 'var(--mist)',
                display: expanded ? 'none' : 'flex',
                alignItems: 'center',
                gap: '4px'
            }}>
                <i data-lucide="chevron-down" style={{ width: '14px', height: '14px' }}></i> View explanation
            </div>

            <style>{`
                @keyframes fadeIn { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: translateY(0); } }
            `}</style>
        </div>
    );
};

const MorningAlertFeed = () => {
    const [herd, setHerd] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    useEffect(() => {
        if (window.lucide) window.lucide.createIcons();
    });

    useEffect(() => {
        fetch(`${API}/herd`)
            .then(r => r.ok ? r.json() : Promise.reject(`HTTP ${r.status}`))
            .then(setHerd)
            .catch(e => setError(String(e)))
            .finally(() => setLoading(false));
    }, []);

    if (loading) return (
        <div style={{ padding: '24px 20px', textAlign: 'center', color: 'var(--mist)', fontFamily: 'Cormorant Garamond, serif', fontSize: '18px', paddingTop: '80px' }}>
            Loading herd data…
        </div>
    );

    if (error) return (
        <div style={{ padding: '24px 20px' }}>
            <div className="kicker" style={{ marginBottom: '16px', fontFamily: 'Cormorant Garamond, serif', fontSize: '16px', fontWeight: '700' }}>Morning Alert Feed</div>
            <div style={{ background: 'var(--danger-bg)', border: '1px solid rgba(224,112,80,0.3)', borderRadius: '8px', padding: '16px', color: 'var(--danger)', fontFamily: 'Cormorant Garamond, serif', fontSize: '15px', lineHeight: '1.5' }}>
                <strong>Backend unavailable.</strong> Start the server:<br />
                <code style={{ fontSize: '13px' }}>uvicorn backend.main:app --reload</code>
                <div style={{ fontSize: '12px', marginTop: '4px', opacity: 0.6 }}>{error}</div>
            </div>
        </div>
    );

    const cows = herd.cows || [];
    const alertCount = cows.filter(c => c.status === 'alert').length;
    const watchCount = cows.filter(c => c.status === 'watch').length;
    const okCount = cows.filter(c => c.status === 'ok').length;

    const nonOkCows = cows
        .filter(c => c.status !== 'ok')
        .sort((a, b) => (a.status === 'alert' ? -1 : 1) - (b.status === 'alert' ? -1 : 1) || b.risk_score - a.risk_score);

    const now = fmtTime();
    const alerts = nonOkCows.map(c => ({
        cowId: c.id,
        pen: derivePen(c.id),
        level: statusToLevel(c.status),
        time: now,
        message: `${c.dominant_disease ? c.dominant_disease.charAt(0).toUpperCase() + c.dominant_disease.slice(1) : 'Risk'} — ${Math.round(c.risk_score * 100)}% within 48h`,
        top_feature: c.top_feature,
        confidence: c.all_risks && c.dominant_disease
            ? Math.round(c.all_risks[c.dominant_disease] * 100)
            : Math.round(c.risk_score * 100),
    }));

    return (
        <div style={{ padding: '24px 20px', minHeight: '100%' }}>

            <div className="kicker" style={{ marginBottom: '16px', fontFamily: 'Cormorant Garamond, serif', fontSize: '16px', fontWeight: '700' }}>Morning Alert Feed</div>

            <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(3, 1fr)',
                gap: '8px',
                marginBottom: '32px'
            }}>
                <div className="card" style={{ padding: '12px 16px', textAlign: 'center', borderColor: 'rgba(106, 158, 72, 0.3)' }}>
                    <div style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: '32px', fontWeight: '700', color: 'var(--sage-lt)', lineHeight: '1' }}>{okCount}</div>
                    <div style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: '12px', fontWeight: '700', color: 'var(--mist)', letterSpacing: '0.1em', marginTop: '4px' }}>HEALTHY</div>
                </div>
                <div className="card" style={{ padding: '12px 16px', textAlign: 'center', borderColor: 'rgba(201, 152, 58, 0.3)' }}>
                    <div style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: '32px', fontWeight: '700', color: 'var(--straw)', lineHeight: '1' }}>{watchCount}</div>
                    <div style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: '12px', fontWeight: '700', color: 'var(--mist)', letterSpacing: '0.1em', marginTop: '4px' }}>MONITOR</div>
                </div>
                <div className="card" style={{ padding: '12px 16px', textAlign: 'center', borderColor: 'rgba(224, 112, 80, 0.3)' }}>
                    <div style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: '32px', fontWeight: '700', color: 'var(--danger)', lineHeight: '1' }}>{alertCount}</div>
                    <div style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: '12px', fontWeight: '700', color: 'var(--mist)', letterSpacing: '0.1em', marginTop: '4px' }}>ACT NOW</div>
                </div>
            </div>

            <div style={{
                fontFamily: 'Cormorant Garamond, serif',
                fontSize: '14px',
                fontWeight: '700',
                letterSpacing: '0.05em',
                textTransform: 'uppercase',
                color: 'var(--mist)',
                marginBottom: '12px',
                display: 'flex',
                alignItems: 'center',
                gap: '8px'
            }}>
                <i data-lucide="list-filter" style={{ width: '12px', height: '12px' }}></i> Action Items
            </div>

            {alerts.length === 0 ? (
                <div style={{ textAlign: 'center', color: 'var(--mist)', fontFamily: 'Cormorant Garamond, serif', fontSize: '18px', padding: '32px 0' }}>
                    All cows healthy — no action needed today.
                </div>
            ) : (
                <div>
                    {alerts.map(alert => <AlertCard key={alert.cowId} alert={alert} />)}
                </div>
            )}

        </div>
    );
};
