const { useState, useEffect } = React;

const API = 'http://localhost:8000'; // From main

const DataEntryLog = () => {
    const [view, setView] = useState('entry');
    const [submitted, setSubmitted] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [logs, setLogs] = useState([]);
    const [loadingLogs, setLoadingLogs] = useState(false);
    const [logsError, setLogsError] = useState(null);

    useEffect(() => {
        if (window.lucide) window.lucide.createIcons();
    }, [view, submitted, logs, loadingLogs, logsError]);

    useEffect(() => {
        // Fetch logs on mount or when switching to log view (optional, mount is fine too)
        if (view === 'log') {
            setLoadingLogs(true);
            setLogsError(null);
            fetch(`${API}/api/logs`)
                .then(r => r.ok ? r.json() : Promise.reject(`HTTP ${r.status}`))
                .then(data => {
                    // Transform raw data to match the UI format
                    const formattedLogs = (data.logs || []).map(r => {
                        const dateObj = r.timestamp ? new Date(r.timestamp) : new Date();
                        const timeStr = dateObj.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
                        // Simple 'Today' logic for hackathon demo
                        return {
                            date: `Today, ${timeStr}`,
                            cow: String(r.cow_id),
                            yield: r.yield_kg != null ? `${r.yield_kg}L` : '—',
                            event: r.health_event === 'none' ? 'None' : (r.health_event || 'None'),
                            user: 'Manual Entry',
                        };
                    });
                    setLogs(formattedLogs);
                })
                .catch(err => setLogsError(String(err)))
                .finally(() => setLoadingLogs(false));
        }
    }, [view]);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setLoading(true);
        setError(null);

        const fd = new FormData(e.target);
        const payload = {
            cow_id: Number(fd.get('cow_id')),
            yield_kg: fd.get('yield_kg') ? Number(fd.get('yield_kg')) : null,
            pen: fd.get('pen'),
            health_event: fd.get('health_event'),
            notes: fd.get('notes') || '',
        };

        try {
            const res = await fetch(`${API}/api/ingest`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });

            if (!res.ok) {
                const errData = await res.json().catch(() => ({ detail: res.statusText }));
                throw new Error(errData.detail || `Error ${res.status}`);
            }

            // Update local log UI immediately
            const now = new Date();
            const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });

            setLogs(prev => [{
                date: `Today, ${timeStr}`,
                cow: String(payload.cow_id),
                yield: payload.yield_kg != null ? `${payload.yield_kg}L` : '—',
                event: payload.health_event === 'none' ? 'None' : payload.health_event,
                user: 'Manual Entry',
            }, ...prev]);

            setSubmitted(true);
            e.target.reset();
            setTimeout(() => setSubmitted(false), 2000);
        } catch (err) {
            setError(err.message || 'Failed to save record');
        } finally {
            setLoading(false);
        }
    };

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
        outline: 'none'
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
                    <button onClick={() => setView('entry')} style={{ padding: '6px 12px', background: view === 'entry' ? 'var(--dark-bg)' : 'transparent', color: view === 'entry' ? 'var(--bg)' : 'var(--mist)', border: 'none', cursor: 'pointer', textTransform: 'uppercase', fontWeight: 'bold' }}>Entry</button>
                    <button onClick={() => setView('log')} style={{ padding: '6px 12px', background: view === 'log' ? 'var(--dark-bg)' : 'transparent', color: view === 'log' ? 'var(--bg)' : 'var(--mist)', border: 'none', cursor: 'pointer', textTransform: 'uppercase', fontWeight: 'bold' }}>Log</button>
                </div>
            </div>

            {view === 'entry' ? (
                <div className="card" style={{ padding: '24px' }}>
                    <h3 style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: '24px', color: 'var(--barn)', marginBottom: '8px' }}>Manual Entry</h3>

                    {submitted ? (
                        <div style={{ background: 'var(--success-bg)', padding: '24px', borderRadius: '8px', textAlign: 'center' }}>
                            <i data-lucide="check-circle" style={{ color: 'var(--sage)', marginBottom: '12px' }}></i>
                            <h4 style={{ color: 'var(--sage)' }}>Record Saved</h4>
                        </div>
                    ) : (
                        <form onSubmit={handleSubmit}>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                                <div>
                                    <label style={labelStyle}>Cow ID</label>
                                    <input name="cow_id" type="number" placeholder="8492" required style={inputStyle} />
                                </div>
                                <div>
                                    <label style={labelStyle}>Yield (Liters)</label>
                                    <input name="yield_kg" type="number" step="0.1" placeholder="0.0" style={inputStyle} />
                                </div>
                            </div>

                            <div>
                                <label style={labelStyle}>Pen / Location</label>
                                <select name="pen" style={{ ...inputStyle, background: 'var(--card)' }}>
                                    <option value="A1">Pen A1</option>
                                    <option value="Hospital">Hospital Pen</option>
                                </select>
                            </div>

                            <div>
                                <label style={labelStyle}>Health Event</label>
                                <select name="health_event" style={{ ...inputStyle, background: 'var(--card)' }}>
                                    <option value="none">None - Healthy</option>
                                    <option value="lame">Lameness</option>
                                    <option value="mastitis">Mastitis</option>
                                </select>
                            </div>

                            <div>
                                <label style={labelStyle}>Notes</label>
                                <textarea name="notes" rows="3" style={{ ...inputStyle, resize: 'none' }}></textarea>
                            </div>

                            {error && <div style={{ color: 'var(--danger)', marginBottom: '16px' }}>{error}</div>}

                            <button type="submit" disabled={loading} style={{ width: '100%', padding: '14px', background: loading ? 'var(--mist)' : 'var(--barn)', color: 'white', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold' }}>
                                {loading ? 'Saving…' : 'Save Record'}
                            </button>
                        </form>
                    )}
                </div>
            ) : (
                <div style={{ flex: 1, overflowY: 'auto' }}>
                    {loadingLogs ? (
                        <div style={{ padding: '24px', textAlign: 'center', color: 'var(--mist)' }}>Loading logs…</div>
                    ) : logsError ? (
                        <div style={{ padding: '16px', background: 'var(--danger-bg)', border: '1px solid rgba(224,112,80,0.3)', borderRadius: '8px', color: 'var(--danger)' }}>
                            Error loading logs: {logsError}
                        </div>
                    ) : logs.length === 0 ? (
                        <div style={{ padding: '24px', textAlign: 'center', color: 'var(--mist)' }}>No entries yet today.</div>
                    ) : (
                        logs.map((log, i) => (
                            <div key={i} className="card" style={{ padding: '16px', marginBottom: '12px' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                    <strong>COW {log.cow}</strong>
                                    <span style={{ fontSize: '12px', color: 'var(--mist)' }}>{log.user}</span>
                                </div>
                                <div style={{ fontSize: '13px', color: 'var(--mist)' }}>{log.date}</div>
                                <div style={{ marginTop: '8px', display: 'flex', gap: '20px' }}>
                                    <div><small>YIELD</small> <div>{log.yield}</div></div>
                                    <div><small>EVENT</small> <div style={{ color: log.event === 'None' ? 'var(--sage)' : 'var(--danger)' }}>{log.event}</div></div>
                                </div>
                            </div>
                        ))
                    )}
                </div>
            )}
        </div>
    );
};