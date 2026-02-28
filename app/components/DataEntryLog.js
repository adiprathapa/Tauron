const { useState, useEffect, useRef } = React;

const DataEntryLog = () => {
    const [view, setView] = useState('entry'); // 'entry' or 'log'
    const [submitted, setSubmitted] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [uploadError, setUploadError] = useState('');
    const [uploadSuccess, setUploadSuccess] = useState('');
    const fileInputRef = useRef(null);

    useEffect(() => {
        if (window.lucide) window.lucide.createIcons();
    }, [view, submitted]);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setLoading(true);
        setError(null);

        const fd = new FormData(e.target);
        const payload = {
            cow_id:       Number(fd.get('cow_id')),
            yield_kg:     fd.get('yield_kg') ? Number(fd.get('yield_kg')) : null,
            pen:          fd.get('pen'),
            health_event: fd.get('health_event'),
            notes:        fd.get('notes') || '',
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

                const response = await fetch('/api/ingest', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ records: data })
                });

                if (!response.ok) {
                    throw new Error(`Server returned status: ${response.status}`);
                }

                setUploadSuccess(`Successfully uploaded ${data.length} records.`);
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
                                style={{ display: 'none' }}ib
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
                    {logs.map((log, i) => (
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
                    ))}
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
                @keyframes spin {
                    from { transform: rotate(0deg); }
                    to { transform: rotate(360deg); }
                }
            `}</style>
        </div>
    );
};
