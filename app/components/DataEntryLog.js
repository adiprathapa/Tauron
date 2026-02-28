const { useState, useEffect, useRef } = React;

const API = 'http://localhost:8000';

const DataEntryLog = () => {
    const [view, setView] = useState('entry'); // 'entry' or 'log'
    const [submitted, setSubmitted] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [logs, setLogs] = useState([]);
    const [loadingLogs, setLoadingLogs] = useState(false);
    const [logsError, setLogsError] = useState(null);
    const [uploading, setUploading] = useState(false);
    const [uploadError, setUploadError] = useState('');
    const [uploadSuccess, setUploadSuccess] = useState('');
    const fileInputRef = useRef(null);

    useEffect(() => {
        if (window.lucide) window.lucide.createIcons();
    }, [view, submitted, logs, loadingLogs, logsError]);

    useEffect(() => {
        if (view === 'log') {
            setLoadingLogs(true);
            setLogsError(null);
            fetch(`${API}/api/history`)
                .then(r => r.ok ? r.json() : Promise.reject(`HTTP ${r.status}`))
                .then(data => setLogs(data.predictions || []))
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
            window.dispatchEvent(new CustomEvent('herd-refresh'));
            e.target.reset();
            setTimeout(() => setSubmitted(false), 2000);
        } catch (err) {
            setError(err.message || 'Failed to save record');
        } finally {
            setLoading(false);
        }
    };

    const handleFileUpload = (e) => {
        const file = e.target.files[0];
        if (!file) return;

        setUploading(true);
        setUploadError('');
        setUploadSuccess('');

        const reader = new FileReader();
        reader.onload = async (event) => {
            try {
                const text = event.target.result;
                const lines = text.split('\n').filter(line => line.trim() !== '');
                if (lines.length < 2) throw new Error("CSV is empty or missing data rows.");

                const headers = lines[0].split(',').map(h => h.trim());
                const data = lines.slice(1).map(line => {
                    const values = line.split(',');
                    return headers.reduce((obj, header, index) => {
                        obj[header] = values[index]?.trim();
                        return obj;
                    }, {});
                });

                const response = await fetch(`${API}/api/ingest/csv`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ records: data })
                });

                if (!response.ok) {
                    throw new Error(`Server returned status: ${response.status}`);
                }

                const result = await response.json();
                setUploadSuccess(`Uploaded ${result.rows} rows — ${result.cows_updated} cow(s) updated. Herd map refreshing…`);
                window.dispatchEvent(new CustomEvent('herd-refresh'));
                if (fileInputRef.current) fileInputRef.current.value = '';
            } catch (err) {
                setUploadError(err.message || "Failed to parse or upload CSV.");
            } finally {
                setUploading(false);
                setTimeout(() => { setUploadSuccess(''); }, 4000);
            }
        };
        reader.onerror = () => {
            setUploadError("Error reading file.");
            setUploading(false);
        };
        reader.readAsText(file);
    };

    const handleOutcome = async (predId, outcome) => {
        try {
            const res = await fetch(`${API}/api/history/${predId}/outcome`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ outcome }),
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            setLogs(prev => prev.map(p => p.id === predId ? { ...p, outcome } : p));
        } catch (err) {
            console.error('Failed to update outcome:', err);
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
        outline: 'none',
    };

    const labelStyle = {
        display: 'block',
        fontFamily: 'Cormorant Garamond, serif',
        fontSize: '13px',
        fontWeight: 'bold',
        color: 'var(--mist)',
        textTransform: 'uppercase',
        letterSpacing: '0.1em',
        marginBottom: '6px',
    };

    const withOutcome = logs.filter(p => p.outcome !== null && p.outcome !== undefined);
    const confirmedCount = withOutcome.filter(p => p.outcome === 'confirmed').length;
    const accuracy = withOutcome.length > 0 ? Math.round(confirmedCount / withOutcome.length * 100) : null;

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
                <>
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
                                        <input name="cow_id" type="number" placeholder="e.g. 8492" required style={inputStyle} />
                                    </div>
                                    <div>
                                        <label style={labelStyle}>Yield (Liters)</label>
                                        <input name="yield_kg" type="number" step="0.1" placeholder="0.0" style={inputStyle} />
                                    </div>
                                </div>

                                <div>
                                    <label style={labelStyle}>Pen / Location</label>
                                    <select name="pen" style={{ ...inputStyle, background: 'var(--card)' }}>
                                        <option value="A">Pen A</option>
                                        <option value="B">Pen B</option>
                                        <option value="C">Pen C</option>
                                        <option value="D">Pen D</option>
                                        <option value="E">Pen E</option>
                                        <option value="F">Pen F</option>
                                        <option value="Hospital">Hospital Pen</option>
                                    </select>
                                </div>

                                <div>
                                    <label style={labelStyle}>Health Event (If Any)</label>
                                    <select name="health_event" style={{ ...inputStyle, background: 'var(--card)' }}>
                                        <option value="none">None - Healthy</option>
                                        <option value="lame">Lameness observed</option>
                                        <option value="mastitis">Mastitis symptoms</option>
                                        <option value="brd">Bovine Respiratory Disease</option>
                                        <option value="calving">Calving</option>
                                        <option value="other">Other</option>
                                    </select>
                                </div>

                                <div>
                                    <label style={labelStyle}>Observation Notes</label>
                                    <textarea name="notes" rows="3" placeholder="Any behavioral changes..." style={{ ...inputStyle, resize: 'none' }}></textarea>
                                </div>

                                {error && <div style={{ color: 'var(--danger)', marginBottom: '16px' }}>{error}</div>}

                                <button type="submit" disabled={loading} style={{
                                    width: '100%',
                                    padding: '14px',
                                    background: loading ? 'var(--mist)' : 'var(--barn)',
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
                                    {loading ? 'Saving…' : 'Save Record'}
                                </button>
                            </form>
                        )}
                    </div>

                    <div className="card" style={{ padding: '24px', marginTop: '16px', animation: 'fadeIn 0.3s' }}>
                        <h3 style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: '20px', fontWeight: 'bold', color: 'var(--barn)', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <i data-lucide="upload-cloud" style={{ width: '20px', height: '20px' }}></i>
                            Batch Upload CSV
                        </h3>
                        <p style={{ color: '#444', fontSize: '15px', marginBottom: '16px', lineHeight: '1.5' }}>
                            Upload historical logs or parlor mass-export files (.csv).
                        </p>

                        {uploadError && <div style={{ color: 'var(--danger)', fontSize: '14px', marginBottom: '12px' }}>{uploadError}</div>}
                        {uploadSuccess && <div style={{ color: 'var(--sage)', fontSize: '14px', marginBottom: '12px' }}>{uploadSuccess}</div>}

                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                            <input
                                type="file"
                                accept=".csv"
                                style={{ display: 'none' }}
                                ref={fileInputRef}
                                onChange={handleFileUpload}
                            />
                            <button
                                type="button"
                                onClick={() => fileInputRef.current?.click()}
                                disabled={uploading}
                                style={{
                                    padding: '12px 20px',
                                    background: 'transparent',
                                    border: '1px solid var(--line)',
                                    color: 'var(--ink)',
                                    borderRadius: '8px',
                                    fontFamily: 'Cormorant Garamond, serif',
                                    fontSize: '15px',
                                    fontWeight: 'bold',
                                    cursor: 'pointer',
                                    transition: 'all 0.2s',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '8px',
                                    position: 'relative'
                                }}
                                className="hover-lift"
                            >
                                <i data-lucide={uploading ? "loader" : "file-text"} style={{ width: '16px', height: '16px', animation: uploading ? 'spin 1s linear infinite' : 'none' }}></i>
                                {uploading ? 'Uploading...' : 'Select CSV File'}
                            </button>
                        </div>
                    </div>
                </>
            ) : (
                <div style={{ flex: 1, overflowY: 'auto' }}>
                    {logs.length > 0 && (
                        <div style={{ background: 'var(--card)', border: '1px solid var(--line)', borderRadius: '8px', padding: '16px', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '16px' }}>
                            <div style={{ fontSize: '36px', fontFamily: 'Cormorant Garamond, serif', fontWeight: 'bold', lineHeight: 1, color: accuracy === null ? 'var(--mist)' : accuracy >= 70 ? 'var(--sage)' : accuracy >= 50 ? 'var(--barn)' : 'var(--danger)' }}>
                                {accuracy !== null ? `${accuracy}%` : '—'}
                            </div>
                            <div>
                                <div style={{ fontWeight: 'bold', fontSize: '14px', fontFamily: 'Cormorant Garamond, serif' }}>Prediction Accuracy</div>
                                <div style={{ fontSize: '12px', color: 'var(--mist)', marginTop: '2px' }}>
                                    {confirmedCount} confirmed · {logs.filter(p => p.outcome === 'unconfirmed').length} false alarms · {logs.filter(p => !p.outcome).length} pending review
                                </div>
                            </div>
                        </div>
                    )}
                    {loadingLogs ? (
                        <div style={{ padding: '24px', textAlign: 'center', color: 'var(--mist)' }}>Loading predictions…</div>
                    ) : logsError ? (
                        <div style={{ padding: '16px', background: 'var(--danger-bg)', border: '1px solid rgba(224,112,80,0.3)', borderRadius: '8px', color: 'var(--danger)' }}>
                            Error: {logsError}
                        </div>
                    ) : logs.length === 0 ? (
                        <div style={{ padding: '24px', textAlign: 'center', color: 'var(--mist)' }}>
                            <div style={{ marginBottom: '8px' }}>No predictions yet.</div>
                            <div style={{ fontSize: '14px' }}>Submit a record to generate your first alert prediction.</div>
                        </div>
                    ) : (
                        logs.map(pred => {
                            const ts = pred.timestamp ? new Date(pred.timestamp) : new Date();
                            const timeStr = ts.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
                            const disease = pred.dominant_disease
                                ? pred.dominant_disease.charAt(0).toUpperCase() + pred.dominant_disease.slice(1)
                                : 'Unknown';
                            const riskPct = Math.round((pred.risk_score || 0) * 100);
                            const isAlert = pred.status === 'alert';
                            return (
                                <div key={pred.id} className="card" style={{ padding: '16px', marginBottom: '12px' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                                        <strong style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: '18px' }}>COW {pred.cow_id}</strong>
                                        <span style={{ fontSize: '11px', color: 'var(--mist)' }}>Today, {timeStr}</span>
                                    </div>
                                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '12px', flexWrap: 'wrap' }}>
                                        <span style={{ fontSize: '13px', fontWeight: 'bold', color: isAlert ? 'var(--danger)' : 'var(--barn)' }}>
                                            {disease}
                                        </span>
                                        <span style={{ padding: '2px 8px', borderRadius: '99px', background: isAlert ? 'rgba(224,112,80,0.15)' : 'rgba(230,165,0,0.15)', color: isAlert ? 'var(--danger)' : 'var(--barn)', fontSize: '12px', fontWeight: 'bold' }}>
                                            {riskPct}% risk
                                        </span>
                                        <span style={{ padding: '2px 8px', borderRadius: '99px', background: isAlert ? 'rgba(224,112,80,0.1)' : 'rgba(230,165,0,0.1)', color: isAlert ? 'var(--danger)' : 'var(--barn)', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                                            {pred.status}
                                        </span>
                                    </div>
                                    {pred.outcome ? (
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', color: pred.outcome === 'confirmed' ? 'var(--sage)' : 'var(--mist)' }}>
                                            <i data-lucide={pred.outcome === 'confirmed' ? 'check-circle' : 'x-circle'} style={{ width: '14px', height: '14px' }}></i>
                                            {pred.outcome === 'confirmed' ? 'Confirmed accurate' : 'Marked false alarm'}
                                        </div>
                                    ) : (
                                        <div style={{ display: 'flex', gap: '8px' }}>
                                            <button onClick={() => handleOutcome(pred.id, 'confirmed')} style={{ flex: 1, padding: '8px', background: 'rgba(106,158,72,0.1)', border: '1px solid rgba(106,158,72,0.3)', borderRadius: '6px', color: 'var(--sage)', cursor: 'pointer', fontSize: '13px', fontWeight: 'bold', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px' }}>
                                                <i data-lucide="check" style={{ width: '14px', height: '14px' }}></i> Confirmed
                                            </button>
                                            <button onClick={() => handleOutcome(pred.id, 'unconfirmed')} style={{ flex: 1, padding: '8px', background: 'rgba(180,180,180,0.1)', border: '1px solid rgba(180,180,180,0.3)', borderRadius: '6px', color: 'var(--mist)', cursor: 'pointer', fontSize: '13px', fontWeight: 'bold', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px' }}>
                                                <i data-lucide="x" style={{ width: '14px', height: '14px' }}></i> False Alarm
                                            </button>
                                        </div>
                                    )}
                                </div>
                            );
                        })
                    )}
                </div>
            )}

            <style>{`
                @keyframes fadeIn {
                    from { opacity: 0; transform: translateY(5px); }
                    to   { opacity: 1; transform: translateY(0); }
                }
                @keyframes spin {
                    from { transform: rotate(0deg); }
                    to   { transform: rotate(360deg); }
                }
            `}</style>
        </div>
    );
};
