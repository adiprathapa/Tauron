const { useState, useEffect } = React;

const AlertCard = ({ alert }) => {
    const [expanded, setExpanded] = useState(false);

    useEffect(() => {
        if (window.lucide) {
            window.lucide.createIcons();
        }
    });

    const getColors = (level) => {
        switch (level) {
            case 'high': return { bg: 'var(--danger-bg)', border: 'rgba(224, 112, 80, 0.3)', dot: 'var(--danger)' };
            case 'warn': return { bg: 'var(--warning-bg)', border: 'rgba(201, 152, 58, 0.3)', dot: 'var(--straw)' };
            case 'ok': return { bg: 'var(--success-bg)', border: 'rgba(106, 158, 72, 0.3)', dot: 'var(--sage)' };
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
        }} onClick={() => setExpanded(!expanded)} className="hover-lift">

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
                <strong style={{ color: 'var(--ink)' }}>Action:</strong> {alert.action}
            </div>

            <div style={{
                marginTop: '12px',
                borderTop: expanded ? `1px solid ${colors.border}` : 'none',
                paddingTop: expanded ? '12px' : '0',
                display: expanded ? 'block' : 'none',
                animation: expanded ? 'fadeIn 0.3s ease' : 'none'
            }}>
                <div style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: '12px', fontWeight: 'bold', textTransform: 'uppercase', color: 'var(--mist)', letterSpacing: '0.1em', marginBottom: '6px' }}>
                    XAI Trace
                </div>
                <div style={{ fontSize: '16px', color: '#444', lineHeight: '1.4' }}>
                    {alert.xai}
                </div>
                <div style={{ marginTop: '8px', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '15px', color: 'var(--sage)', fontWeight: '600' }}>
                    <i data-lucide="check-circle" style={{ width: '12px', height: '12px' }}></i>
                    Model Confidence: {alert.confidence}%
                </div>
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

    // Using Lucide icons by creating elements
    useEffect(() => {
        if (window.lucide) {
            window.lucide.createIcons();
        }
    });

    const mockAlerts = [
        { id: 1, cowId: '8492', pen: 'A2', level: 'high', time: '05:22 AM', message: 'High risk of mastitis onset within 48h.', action: 'Examine udder and isolate if inflamed.', xai: 'Cow 8492 spent 4h adjacent to confirmed mastitis case (Cow 7118). Milk yield dropped 14% at PM milking.', confidence: 89 },
        { id: 2, cowId: '9104', pen: 'B1', level: 'warn', time: '06:15 AM', message: 'Elevated somatic cell count pattern detected.', action: 'Schedule for CMT paddle test.', xai: 'Gradual increase in conductivity sensor readings over past 3 days, combined with restless behavior in stall.', confidence: 72 },
        { id: 3, cowId: '6021', pen: 'C4', level: 'warn', time: 'YESTERDAY', message: 'Minor lameness early indicator.', action: 'Observe gait during next parlor transfer.', xai: 'Step count dropped 22% compared to historical baseline. Lying time increased by 3.5 hours.', confidence: 68 },
    ];

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
                    <div style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: '32px', fontWeight: '700', color: 'var(--sage-lt)', lineHeight: '1' }}>832</div>
                    <div style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: '12px', fontWeight: '700', color: 'var(--mist)', letterSpacing: '0.1em', marginTop: '4px' }}>HEALTHY</div>
                </div>
                <div className="card" style={{ padding: '12px 16px', textAlign: 'center', borderColor: 'rgba(201, 152, 58, 0.3)' }}>
                    <div style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: '32px', fontWeight: '700', color: 'var(--straw)', lineHeight: '1' }}>7</div>
                    <div style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: '12px', fontWeight: '700', color: 'var(--mist)', letterSpacing: '0.1em', marginTop: '4px' }}>MONITOR</div>
                </div>
                <div className="card" style={{ padding: '12px 16px', textAlign: 'center', borderColor: 'rgba(224, 112, 80, 0.3)' }}>
                    <div style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: '32px', fontWeight: '700', color: 'var(--danger)', lineHeight: '1' }}>1</div>
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

            <div>
                {mockAlerts.map(alert => <AlertCard key={alert.id} alert={alert} />)}
            </div>

        </div>
    );
};
