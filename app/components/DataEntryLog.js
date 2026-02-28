const { useState, useEffect } = React;

const DataEntryLog = () => {
    const [view, setView] = useState('entry'); // 'entry' or 'log'
    const [submitted, setSubmitted] = useState(false);

    useEffect(() => {
        if (window.lucide) window.lucide.createIcons();
    });

    const handleSubmit = (e) => {
        e.preventDefault();
        setSubmitted(true);
        setTimeout(() => {
            setSubmitted(false);
            e.target.reset();
        }, 2000);
    };

    const mockLogs = [
        { date: 'Today, 06:12 AM', cow: '8492', yield: '31L', event: 'Mastitis suspected', user: 'Farm Hand JS' },
        { date: 'Yesterday, 17:45 PM', cow: '9104', yield: '40L', event: 'None', user: 'Automated Parlor' },
        { date: 'Yesterday, 05:30 AM', cow: '6021', yield: '44L', event: 'Lame off right hind', user: 'Farm Hand JS' },
        { date: 'Oct 12, 18:00 PM', cow: '8492', yield: '36L', event: 'None', user: 'Automated Parlor' },
    ];

    const inputStyle = {
        width: '100%',
        background: 'rgba(255,255,255,0.02)',
        border: '1px solid rgba(0,0,0,0.1)',
        padding: '12px 16px',
        borderRadius: '8px',
        fontFamily: 'Cormorant Garamond, serif',
        fontSize: '18px',
        color: 'var(--ink)',
        marginBottom: '16px',
        outline: 'none',
        transition: 'border-color 0.2s'
    };

    const labelStyle = {
        display: 'block',
        fontFamily: 'Cormorant Garamond, serif',
        fontSize: '13px',
        fontWeight: 'bold',
        color: 'var(--mist)',
        textTransform: 'uppercase',
        letterSpacing: '0.1em',
        marginBottom: '6px'
    };

    return (
        <div style={{ padding: '24px 20px', minHeight: '100%', display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
                <div className="kicker" style={{ margin: 0, fontFamily: 'Cormorant Garamond, serif', fontSize: '16px', fontWeight: '700' }}>Data & Records</div>

                <div style={{ display: 'flex', background: 'var(--card)', borderRadius: '6px', border: '1px solid var(--line)', overflow: 'hidden' }}>
                    <button
                        onClick={() => setView('entry')}
                        style={{
                            padding: '6px 12px',
                            background: view === 'entry' ? 'var(--dark-bg)' : 'transparent',
                            color: view === 'entry' ? 'var(--bg)' : 'var(--mist)',
                            border: 'none',
                            fontFamily: 'Cormorant Garamond, serif',
                            fontSize: '14px',
                            fontWeight: 'bold',
                            cursor: 'pointer',
                            textTransform: 'uppercase',
                            letterSpacing: '0.05em',
                            transition: 'all 0.2s'
                        }}
                    >
                        Entry
                    </button>
                    <button
                        onClick={() => setView('log')}
                        style={{
                            padding: '6px 12px',
                            background: view === 'log' ? 'var(--dark-bg)' : 'transparent',
                            color: view === 'log' ? 'var(--bg)' : 'var(--mist)',
                            border: 'none',
                            fontFamily: 'Cormorant Garamond, serif',
                            fontSize: '14px',
                            fontWeight: 'bold',
                            cursor: 'pointer',
                            textTransform: 'uppercase',
                            letterSpacing: '0.05em',
                            transition: 'all 0.2s'
                        }}
                    >
                        Log
                    </button>
                </div>
            </div>

            {view === 'entry' ? (
                <div className="card" style={{ padding: '24px' }}>
                    <h3 style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: '24px', fontWeight: 'bold', color: 'var(--barn)', marginBottom: '8px' }}>Manual Entry</h3>
                    <p style={{ color: '#444', fontSize: '16px', marginBottom: '24px', lineHeight: '1.5' }}>
                        Designed to take under 2 minutes. Tauron uses this to learn individual baselines.
                    </p>

                    {submitted ? (
                        <div style={{ background: 'var(--success-bg)', border: '1px solid rgba(106, 158, 72, 0.3)', padding: '24px', borderRadius: '8px', textAlign: 'center', animation: 'fadeIn 0.3s' }}>
                            <i data-lucide="check-circle" style={{ width: '32px', height: '32px', color: 'var(--sage)', marginBottom: '12px' }}></i>
                            <h4 style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: '20px', fontWeight: 'bold', color: 'var(--sage)', marginBottom: '4px' }}>Record Saved</h4>
                            <p style={{ fontSize: '16px', color: 'var(--sage)' }}>Model baseline updated successfully.</p>
                        </div>
                    ) : (
                        <form onSubmit={handleSubmit} style={{ animation: 'fadeIn 0.3s' }}>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                                <div>
                                    <label style={labelStyle}>Cow ID</label>
                                    <input type="number" placeholder="e.g. 8492" required style={inputStyle} />
                                </div>
                                <div>
                                    <label style={labelStyle}>Yield (Liters)</label>
                                    <input type="number" step="0.1" placeholder="0.0" style={inputStyle} />
                                </div>
                            </div>

                            <div>
                                <label style={labelStyle}>Pen / Location</label>
                                <select style={{ ...inputStyle, background: 'var(--card)' }}>
                                    <option value="A1">Pen A1</option>
                                    <option value="A2">Pen A2</option>
                                    <option value="B1">Pen B1</option>
                                    <option value="Hospital">Hospital Pen</option>
                                </select>
                            </div>

                            <div>
                                <label style={labelStyle}>Health Event (If Any)</label>
                                <select style={{ ...inputStyle, background: 'var(--card)' }}>
                                    <option value="none">None - Healthy</option>
                                    <option value="lame">Lameness observed</option>
                                    <option value="mastitis">Mastitis symptoms</option>
                                    <option value="calving">Calving</option>
                                    <option value="other">Other</option>
                                </select>
                            </div>

                            <div>
                                <label style={labelStyle}>Observation Notes</label>
                                <textarea rows="3" placeholder="Any behavioral changes..." style={{ ...inputStyle, resize: 'none' }}></textarea>
                            </div>

                            <button type="submit" style={{
                                width: '100%',
                                padding: '14px',
                                background: 'var(--barn)',
                                color: 'var(--bg)',
                                border: 'none',
                                borderRadius: '8px',
                                fontFamily: 'Cormorant Garamond, serif',
                                fontSize: '15px',
                                fontWeight: 'bold',
                                letterSpacing: '0.1em',
                                textTransform: 'uppercase',
                                cursor: 'pointer',
                                transition: 'background 0.2s',
                                display: 'flex',
                                justifyContent: 'center',
                                alignItems: 'center',
                                gap: '8px'
                            }} className="hover-lift">
                                <i data-lucide="save" style={{ width: '16px', height: '16px' }}></i>
                                Save Record
                            </button>
                        </form>
                    )}
                </div>
            ) : (
                <div style={{ flex: 1, overflowY: 'auto' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', animation: 'fadeIn 0.3s' }}>
                        {mockLogs.map((log, i) => (
                            <div key={i} className="card" style={{ padding: '16px' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
                                    <div>
                                        <div style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: '14px', fontWeight: 'bold', color: 'var(--ink)' }}>
                                            COW {log.cow}
                                        </div>
                                        <div style={{ fontSize: '13px', color: 'var(--mist)', marginTop: '2px' }}>
                                            {log.date}
                                        </div>
                                    </div>
                                    <div style={{ background: 'rgba(0,0,0,0.04)', padding: '4px 8px', borderRadius: '4px', fontSize: '12px', color: 'var(--mist)' }}>
                                        {log.user}
                                    </div>
                                </div>

                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', background: 'rgba(255,255,255,0.4)', padding: '12px', borderRadius: '6px' }}>
                                    <div>
                                        <div style={{ fontSize: '12px', color: 'var(--mist)', textTransform: 'uppercase', fontWeight: 'bold' }}>Yield</div>
                                        <div style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: '24px', fontWeight: 'bold', color: 'var(--barn)' }}>{log.yield}</div>
                                    </div>
                                    <div>
                                        <div style={{ fontSize: '12px', color: 'var(--mist)', textTransform: 'uppercase', fontWeight: 'bold', marginBottom: '4px' }}>Event</div>
                                        <div style={{ fontSize: '16px', fontWeight: 'bold', color: log.event === 'None' ? 'var(--sage)' : 'var(--danger)', marginTop: '2px' }}>{log.event}</div>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}
            <style>{`
                @keyframes fadeIn {
                    from { opacity: 0; transform: translateY(5px); }
                    to { opacity: 1; transform: translateY(0); }
                }
            `}</style>
        </div>
    );
};
