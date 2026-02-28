const { useState, useEffect, useRef } = React;

const API = 'http://localhost:8000';

const HEALTH_EVENTS = [
    { value: 'none',     label: 'None — Healthy' },
    { value: 'off_feed', label: 'Off Feed' },
    { value: 'lame',     label: 'Lame' },
    { value: 'mastitis', label: 'Mastitis' },
    { value: 'calving',  label: 'Calving' },
    { value: 'other',    label: 'Other' },
];

const PENS = ['A1', 'A2', 'B1', 'Hospital'];

const EMPTY_COW = { cow_id: '', yield_kg: '', pen: 'A1', health_event: 'none', notes: '' };

const DataEntryLog = () => {
    const [view, setView] = useState('entry');

    // Free-text note
    const [noteText, setNoteText]     = useState('');
    const [parsing, setParsing]       = useState(false);
    const [parseError, setParseError] = useState('');

    // Confirmation — array of cow rows
    const [parsed, setParsed]         = useState(null);      // raw API response
    const [cows, setCows]             = useState([]);         // editable rows

    // Save
    const [saving, setSaving]         = useState(false);
    const [saved, setSaved]           = useState(false);
    const [saveError, setSaveError]   = useState('');

    // Log view
    const [logs, setLogs]             = useState([]);
    const [loadingLogs, setLoadingLogs] = useState(false);
    const [logsError, setLogsError]   = useState(null);

    // CSV
    const [uploading, setUploading]   = useState(false);
    const [uploadMsg, setUploadMsg]   = useState({ text: '', ok: true });
    const fileInputRef = useRef(null);

    // Voice
    const [listening, setListening]   = useState(false);
    const recognitionRef = useRef(null);

    useEffect(() => { if (window.lucide) window.lucide.createIcons(); });

    useEffect(() => {
        if (view !== 'log') return;
        setLoadingLogs(true);
        setLogsError(null);
        fetch(`${API}/api/logs`)
            .then(r => r.ok ? r.json() : Promise.reject(`HTTP ${r.status}`))
            .then(data => {
                setLogs((data.logs || []).map(r => {
                    const dateObj = r.timestamp ? new Date(r.timestamp) : new Date();
                    const timeStr = dateObj.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
                    return {
                        date:  `Today, ${timeStr}`,
                        cow:   String(r.cow_id),
                        yield: r.yield_kg != null ? `${r.yield_kg}L` : '—',
                        event: r.health_event === 'none' ? 'None' : (r.health_event || 'None'),
                        voice: !!r.via_voice,
                    };
                }));
            })
            .catch(err => setLogsError(String(err)))
            .finally(() => setLoadingLogs(false));
    }, [view]);

    // ── Parse note → array of cows ────────────────────────────────────────

    const handleParse = async () => {
        if (!noteText.trim()) return;
        setParsing(true);
        setParseError('');
        setParsed(null);
        setCows([]);

        try {
            const res = await fetch(`${API}/api/voice`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ transcript: noteText.trim() }),
            });
            if (!res.ok) {
                const err = await res.json().catch(() => ({ detail: res.statusText }));
                throw new Error(err.detail || `Error ${res.status}`);
            }
            const data = await res.json();
            setParsed(data);
            setCows((data.cows || []).map(c => ({
                cow_id:       c.cow_id    != null ? String(c.cow_id)   : '',
                yield_kg:     c.yield_kg  != null ? String(c.yield_kg) : '',
                pen:          c.pen       || 'A1',
                health_event: c.health_event || 'none',
                notes:        c.notes     || '',
            })));
        } catch (err) {
            setParseError(err.message || 'Failed to parse observation');
        } finally {
            setParsing(false);
        }
    };

    // ── Cow row helpers ───────────────────────────────────────────────────

    const updateCow = (idx, key, val) =>
        setCows(prev => prev.map((c, i) => i === idx ? { ...c, [key]: val } : c));

    const removeCow = (idx) =>
        setCows(prev => prev.filter((_, i) => i !== idx));

    const addCow = () =>
        setCows(prev => [...prev, { ...EMPTY_COW }]);

    const reset = () => {
        setParsed(null);
        setCows([]);
        setParseError('');
        setSaveError('');
    };

    // ── Save all rows ─────────────────────────────────────────────────────

    const handleSave = async () => {
        setSaving(true);
        setSaveError('');

        try {
            for (const cow of cows) {
                if (!cow.cow_id) continue;
                const payload = {
                    cow_id:       cow.cow_id,
                    yield_kg:     cow.yield_kg !== '' ? Number(cow.yield_kg) : null,
                    pen:          cow.pen,
                    health_event: cow.health_event,
                    notes:        cow.notes || '',
                    via_voice:    true,
                };
                const res = await fetch(`${API}/api/ingest`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload),
                });
                if (!res.ok) {
                    const err = await res.json().catch(() => ({ detail: res.statusText }));
                    throw new Error(`Cow ${cow.cow_id}: ${err.detail || res.statusText}`);
                }
            }
            setSaved(true);
            setTimeout(() => {
                setSaved(false);
                setNoteText('');
                reset();
            }, 2000);
        } catch (err) {
            setSaveError(err.message || 'Failed to save records');
        } finally {
            setSaving(false);
        }
    };

    // ── Voice mic ─────────────────────────────────────────────────────────

    const handleVoice = () => {
        const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SR) { setParseError('Voice not supported in this browser. Try Chrome.'); return; }
        if (listening) { recognitionRef.current?.stop(); return; }

        const rec = new SR();
        rec.lang = 'en-US';
        rec.interimResults = false;
        recognitionRef.current = rec;
        rec.onstart  = () => setListening(true);
        rec.onend    = () => setListening(false);
        rec.onerror  = (e) => { setListening(false); setParseError(`Mic error: ${e.error}`); };
        rec.onresult = (e) => {
            setNoteText(e.results[0][0].transcript);
            reset();
        };
        rec.start();
    };

    // ── CSV upload ────────────────────────────────────────────────────────

    const handleFileUpload = (e) => {
        const file = e.target.files[0];
        if (!file) return;
        setUploading(true);
        setUploadMsg({ text: '', ok: true });

        const reader = new FileReader();
        reader.onload = async (ev) => {
            try {
                const lines = ev.target.result.split('\n').filter(l => l.trim());
                if (lines.length < 2) throw new Error('CSV has no data rows.');
                const headers = lines[0].split(',').map(h => h.trim());
                const data = lines.slice(1).map(line => {
                    const vals = line.split(',');
                    return headers.reduce((obj, h, i) => { obj[h] = vals[i]?.trim(); return obj; }, {});
                });
                const res = await fetch(`${API}/api/ingest`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ records: data }),
                });
                if (!res.ok) throw new Error(`Server error ${res.status}`);
                setUploadMsg({ text: `Uploaded ${data.length} records.`, ok: true });
                if (fileInputRef.current) fileInputRef.current.value = '';
                setTimeout(() => setUploadMsg({ text: '', ok: true }), 4000);
            } catch (err) {
                setUploadMsg({ text: err.message || 'Upload failed.', ok: false });
            } finally {
                setUploading(false);
            }
        };
        reader.onerror = () => { setUploadMsg({ text: 'File read error.', ok: false }); setUploading(false); };
        reader.readAsText(file);
    };

    // ── Styles ────────────────────────────────────────────────────────────

    const cellInput = (style = {}) => ({
        background: 'rgba(255,255,255,0.6)',
        border: '1px solid rgba(0,0,0,0.1)',
        padding: '7px 10px',
        borderRadius: '6px',
        fontFamily: 'Cormorant Garamond, serif',
        fontSize: '16px',
        color: 'var(--ink)',
        outline: 'none',
        width: '100%',
        boxSizing: 'border-box',
        ...style,
    });

    const labelStyle = {
        display: 'block', marginBottom: '4px',
        fontFamily: 'Cormorant Garamond, serif', fontSize: '11px',
        fontWeight: 'bold', color: 'var(--mist)',
        textTransform: 'uppercase', letterSpacing: '0.1em',
    };

    const validCows = cows.filter(c => c.cow_id);

    // ── Render ────────────────────────────────────────────────────────────

    return (
        <div style={{ padding: '24px 20px', minHeight: '100%', display: 'flex', flexDirection: 'column', gap: '16px' }}>

            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div className="kicker" style={{ margin: 0, fontFamily: 'Cormorant Garamond, serif', fontSize: '16px', fontWeight: '700' }}>Data & Records</div>
                <div style={{ display: 'flex', background: 'var(--card)', borderRadius: '6px', border: '1px solid var(--line)', overflow: 'hidden' }}>
                    {['entry', 'log'].map(v => (
                        <button key={v} onClick={() => setView(v)} style={{
                            padding: '6px 14px', border: 'none', cursor: 'pointer',
                            background: view === v ? 'var(--dark-bg)' : 'transparent',
                            color: view === v ? 'var(--bg)' : 'var(--mist)',
                            fontFamily: 'Cormorant Garamond, serif', fontWeight: 'bold',
                            textTransform: 'uppercase', fontSize: '13px',
                        }}>{v === 'entry' ? 'Entry' : 'Log'}</button>
                    ))}
                </div>
            </div>

            {view === 'entry' ? (
                <>
                    <div className="card" style={{ padding: '24px' }}>

                        {saved ? (
                            <div style={{ padding: '24px', textAlign: 'center', animation: 'fadeIn 0.3s' }}>
                                <i data-lucide="check-circle" style={{ width: '36px', height: '36px', color: 'var(--sage)', marginBottom: '12px' }}></i>
                                <h4 style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: '22px', fontWeight: 'bold', color: 'var(--sage)', marginBottom: '4px' }}>
                                    {cows.length > 1 ? `${validCows.length} Records Saved` : 'Record Saved'}
                                </h4>
                                <p style={{ color: 'var(--sage)', fontSize: '15px' }}>Model baseline updated.</p>
                            </div>
                        ) : (
                            <>
                                {/* Title + mic */}
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                                    <h3 style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: '22px', fontWeight: 'bold', color: 'var(--barn)', margin: 0 }}>
                                        Quick Observation
                                    </h3>
                                    <button type="button" onClick={handleVoice}
                                        title={listening ? 'Tap to stop' : 'Speak your rounds note'}
                                        style={{
                                            display: 'flex', alignItems: 'center', gap: '5px',
                                            padding: '7px 13px', borderRadius: '20px', border: 'none', cursor: 'pointer',
                                            background: listening ? 'var(--danger)' : 'var(--dark-bg)',
                                            color: 'var(--bg)',
                                            fontFamily: 'Cormorant Garamond, serif', fontSize: '13px', fontWeight: 'bold',
                                            animation: listening ? 'pulse 1.5s infinite' : 'none',
                                            transition: 'background 0.2s',
                                        }}>
                                        <i data-lucide={listening ? 'mic-off' : 'mic'} style={{ width: '13px', height: '13px' }}></i>
                                        {listening ? 'Listening…' : 'Speak'}
                                    </button>
                                </div>

                                <p style={{ color: 'var(--mist)', fontSize: '14px', marginBottom: '12px' }}>
                                    Describe one or more cows in plain English. Tauron extracts each one automatically.
                                </p>

                                {/* Free-text area */}
                                <textarea
                                    rows={3}
                                    value={noteText}
                                    onChange={e => { setNoteText(e.target.value); reset(); }}
                                    placeholder={"e.g. \"Cow A wasn't eating, milk was low. B gave 24 litres, all fine. C is limping on the rear left.\""}
                                    style={{
                                        width: '100%', boxSizing: 'border-box',
                                        resize: 'none', marginBottom: '12px',
                                        background: 'rgba(255,255,255,0.6)',
                                        border: `1px solid ${listening ? 'var(--danger)' : 'rgba(0,0,0,0.12)'}`,
                                        padding: '12px 14px', borderRadius: '8px',
                                        fontFamily: 'Cormorant Garamond, serif', fontSize: '16px',
                                        color: 'var(--ink)', outline: 'none', lineHeight: '1.6',
                                    }}
                                />

                                {parseError && (
                                    <div style={{ color: 'var(--danger)', fontSize: '14px', marginBottom: '10px' }}>{parseError}</div>
                                )}

                                {/* Parse button */}
                                {!parsed && (
                                    <button type="button" onClick={handleParse}
                                        disabled={parsing || !noteText.trim()}
                                        className={noteText.trim() && !parsing ? 'hover-lift' : ''}
                                        style={{
                                            width: '100%', padding: '13px', border: 'none', borderRadius: '8px',
                                            background: (!noteText.trim() || parsing) ? 'var(--mist)' : 'var(--barn)',
                                            color: 'var(--bg)',
                                            cursor: (!noteText.trim() || parsing) ? 'default' : 'pointer',
                                            fontFamily: 'Cormorant Garamond, serif', fontSize: '15px',
                                            fontWeight: 'bold', letterSpacing: '0.08em', textTransform: 'uppercase',
                                            display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '8px',
                                            transition: 'background 0.2s',
                                        }}>
                                        <i data-lucide={parsing ? 'loader' : 'sparkles'}
                                            style={{ width: '15px', height: '15px', animation: parsing ? 'spin 1s linear infinite' : 'none' }}></i>
                                        {parsing ? 'Extracting cows…' : 'Parse Observation'}
                                    </button>
                                )}

                                {/* ── Multi-cow confirmation panel ── */}
                                {parsed && cows.length > 0 && (
                                    <div style={{ animation: 'fadeIn 0.3s' }}>

                                        {/* Header row */}
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                                            <span style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: '13px', fontWeight: 'bold', color: 'var(--mist)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                                                Review &amp; Confirm
                                            </span>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                <span style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: '13px', color: 'var(--mist)' }}>
                                                    {cows.length} cow{cows.length !== 1 ? 's' : ''} found
                                                </span>
                                                <span style={{
                                                    background: parsed.confidence >= 0.85 ? 'rgba(106,158,72,0.12)' : 'rgba(224,177,50,0.15)',
                                                    color:      parsed.confidence >= 0.85 ? 'var(--sage)'            : 'var(--straw)',
                                                    border:     `1px solid ${parsed.confidence >= 0.85 ? 'rgba(106,158,72,0.3)' : 'rgba(224,177,50,0.3)'}`,
                                                    borderRadius: '12px', padding: '2px 10px',
                                                    fontFamily: 'Cormorant Garamond, serif', fontSize: '12px', fontWeight: 'bold',
                                                }}>
                                                    {Math.round(parsed.confidence * 100)}% confident
                                                </span>
                                            </div>
                                        </div>

                                        {/* One row per cow */}
                                        {cows.map((cow, idx) => (
                                            <div key={idx} style={{
                                                background: 'rgba(255,255,255,0.5)',
                                                border: '1px solid rgba(0,0,0,0.08)',
                                                borderRadius: '10px',
                                                padding: '14px',
                                                marginBottom: '10px',
                                                position: 'relative',
                                            }}>
                                                {/* Remove button */}
                                                <button type="button" onClick={() => removeCow(idx)}
                                                    title="Remove this cow"
                                                    style={{
                                                        position: 'absolute', top: '10px', right: '10px',
                                                        width: '22px', height: '22px', borderRadius: '50%',
                                                        border: '1px solid rgba(0,0,0,0.1)', background: 'transparent',
                                                        color: 'var(--mist)', cursor: 'pointer', fontSize: '12px',
                                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                        lineHeight: 1,
                                                    }}>✕</button>

                                                <div style={{ display: 'grid', gridTemplateColumns: '80px 80px 1fr 1fr', gap: '10px', marginBottom: cow.notes ? '8px' : 0 }}>
                                                    <div>
                                                        <label style={labelStyle}>Cow</label>
                                                        <input type="text" placeholder="ID / tag"
                                                            value={cow.cow_id}
                                                            onChange={e => updateCow(idx, 'cow_id', e.target.value)}
                                                            style={cellInput()} />
                                                    </div>
                                                    <div>
                                                        <label style={labelStyle}>Yield (L)</label>
                                                        <input type="number" step="0.1" placeholder="—"
                                                            value={cow.yield_kg}
                                                            onChange={e => updateCow(idx, 'yield_kg', e.target.value)}
                                                            style={cellInput()} />
                                                    </div>
                                                    <div>
                                                        <label style={labelStyle}>Pen</label>
                                                        <select value={cow.pen}
                                                            onChange={e => updateCow(idx, 'pen', e.target.value)}
                                                            style={cellInput({ background: 'var(--card)' })}>
                                                            {PENS.map(p => <option key={p} value={p}>{p}</option>)}
                                                        </select>
                                                    </div>
                                                    <div>
                                                        <label style={labelStyle}>Health</label>
                                                        <select value={cow.health_event}
                                                            onChange={e => updateCow(idx, 'health_event', e.target.value)}
                                                            style={cellInput({
                                                                background: 'var(--card)',
                                                                color: cow.health_event !== 'none' ? 'var(--danger)' : 'var(--ink)',
                                                            })}>
                                                            {HEALTH_EVENTS.map(ev => <option key={ev.value} value={ev.value}>{ev.label}</option>)}
                                                        </select>
                                                    </div>
                                                </div>

                                                {/* Notes */}
                                                {cow.notes && (
                                                    <div style={{ fontSize: '13px', color: 'var(--mist)', fontStyle: 'italic', paddingLeft: '2px' }}>
                                                        {cow.notes}
                                                    </div>
                                                )}
                                            </div>
                                        ))}

                                        {/* Add cow + action buttons */}
                                        <div style={{ display: 'flex', gap: '10px', marginTop: '4px' }}>
                                            <button type="button" onClick={reset}
                                                style={{
                                                    padding: '11px 14px', borderRadius: '8px',
                                                    border: '1px solid var(--line)', background: 'transparent',
                                                    color: 'var(--mist)', cursor: 'pointer',
                                                    fontFamily: 'Cormorant Garamond, serif', fontSize: '14px',
                                                }}>
                                                <i data-lucide="rotate-ccw" style={{ width: '13px', height: '13px' }}></i>
                                            </button>

                                            <button type="button" onClick={addCow}
                                                style={{
                                                    padding: '11px 16px', borderRadius: '8px',
                                                    border: '1px solid var(--line)', background: 'transparent',
                                                    color: 'var(--ink)', cursor: 'pointer',
                                                    fontFamily: 'Cormorant Garamond, serif', fontSize: '14px', fontWeight: 'bold',
                                                    display: 'flex', alignItems: 'center', gap: '6px',
                                                }}>
                                                <i data-lucide="plus" style={{ width: '13px', height: '13px' }}></i>
                                                Add
                                            </button>

                                            <button type="button" onClick={handleSave}
                                                disabled={saving || validCows.length === 0}
                                                className={!saving && validCows.length > 0 ? 'hover-lift' : ''}
                                                style={{
                                                    flex: 1, padding: '11px', borderRadius: '8px', border: 'none',
                                                    background: saving || validCows.length === 0 ? 'var(--mist)' : 'var(--green)',
                                                    color: 'var(--bg)',
                                                    cursor: saving || validCows.length === 0 ? 'default' : 'pointer',
                                                    fontFamily: 'Cormorant Garamond, serif', fontSize: '15px', fontWeight: 'bold',
                                                    letterSpacing: '0.06em', textTransform: 'uppercase',
                                                    display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '8px',
                                                    transition: 'background 0.2s',
                                                }}>
                                                <i data-lucide={saving ? 'loader' : 'save'}
                                                    style={{ width: '15px', height: '15px', animation: saving ? 'spin 1s linear infinite' : 'none' }}></i>
                                                {saving ? 'Saving…' : `Save ${validCows.length} Record${validCows.length !== 1 ? 's' : ''}`}
                                            </button>
                                        </div>

                                        {saveError && (
                                            <div style={{ color: 'var(--danger)', fontSize: '14px', marginTop: '10px' }}>{saveError}</div>
                                        )}
                                    </div>
                                )}
                            </>
                        )}
                    </div>

                    {/* Batch CSV */}
                    <div className="card" style={{ padding: '20px' }}>
                        <h3 style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: '18px', fontWeight: 'bold', color: 'var(--barn)', marginBottom: '6px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <i data-lucide="upload-cloud" style={{ width: '18px', height: '18px' }}></i>
                            Batch Upload CSV
                        </h3>
                        <p style={{ color: 'var(--mist)', fontSize: '14px', marginBottom: '14px' }}>
                            Historical logs or parlor mass-exports.
                        </p>
                        {uploadMsg.text && (
                            <div style={{ color: uploadMsg.ok ? 'var(--sage)' : 'var(--danger)', fontSize: '14px', marginBottom: '10px' }}>
                                {uploadMsg.text}
                            </div>
                        )}
                        <input type="file" accept=".csv" style={{ display: 'none' }} ref={fileInputRef} onChange={handleFileUpload} />
                        <button type="button" onClick={() => fileInputRef.current?.click()}
                            disabled={uploading} className="hover-lift"
                            style={{
                                padding: '10px 18px', background: 'transparent',
                                border: '1px solid var(--line)', color: 'var(--ink)', borderRadius: '8px',
                                fontFamily: 'Cormorant Garamond, serif', fontSize: '14px', fontWeight: 'bold',
                                cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px',
                            }}>
                            <i data-lucide={uploading ? 'loader' : 'file-text'}
                                style={{ width: '15px', height: '15px', animation: uploading ? 'spin 1s linear infinite' : 'none' }}></i>
                            {uploading ? 'Uploading…' : 'Select CSV File'}
                        </button>
                    </div>
                </>
            ) : (
                /* Log view */
                <div style={{ flex: 1, overflowY: 'auto' }}>
                    {loadingLogs ? (
                        <div style={{ padding: '24px', textAlign: 'center', color: 'var(--mist)' }}>Loading logs…</div>
                    ) : logsError ? (
                        <div style={{ padding: '16px', background: 'var(--danger-bg)', border: '1px solid rgba(224,112,80,0.3)', borderRadius: '8px', color: 'var(--danger)' }}>
                            Error loading logs: {logsError}
                        </div>
                    ) : logs.length === 0 ? (
                        <div style={{ padding: '24px', textAlign: 'center', color: 'var(--mist)' }}>No entries yet.</div>
                    ) : (
                        logs.map((log, i) => (
                            <div key={i} className="card" style={{ padding: '16px', marginBottom: '10px' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                                    <strong style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: '17px' }}>COW {log.cow}</strong>
                                    <span style={{ display: 'flex', alignItems: 'center', gap: '3px', fontSize: '12px', color: log.voice ? 'var(--green)' : 'var(--mist)' }}>
                                        <i data-lucide={log.voice ? 'mic' : 'pen-line'} style={{ width: '11px', height: '11px' }}></i>
                                        {log.voice ? 'Voice' : 'Text'}
                                    </span>
                                </div>
                                <div style={{ fontSize: '12px', color: 'var(--mist)', marginBottom: '8px' }}>{log.date}</div>
                                <div style={{ display: 'flex', gap: '20px' }}>
                                    <div><small style={{ color: 'var(--mist)' }}>YIELD</small><div style={{ fontFamily: 'Cormorant Garamond, serif' }}>{log.yield}</div></div>
                                    <div><small style={{ color: 'var(--mist)' }}>EVENT</small><div style={{ color: log.event === 'None' ? 'var(--sage)' : 'var(--danger)', fontFamily: 'Cormorant Garamond, serif' }}>{log.event}</div></div>
                                </div>
                            </div>
                        ))
                    )}
                </div>
            )}

            <style>{`
                @keyframes fadeIn { from { opacity:0; transform:translateY(4px); } to { opacity:1; transform:translateY(0); } }
                @keyframes spin   { from { transform:rotate(0deg); } to { transform:rotate(360deg); } }
                @keyframes pulse  { 0%,100% { opacity:1; } 50% { opacity:0.65; } }
            `}</style>
        </div>
    );
};
