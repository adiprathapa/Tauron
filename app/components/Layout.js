const { useState, useEffect, useRef } = React;

const Layout = ({ currentTab, onTabChange, children }) => {
    const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
    const [farmInfo, setFarmInfo] = useState({ name: 'GLENWOOD DAIRY', location: '840 HEAD' });
    const [isEditingFarm, setIsEditingFarm] = useState(false);
    const nameRef = useRef(null);
    const locRef = useRef(null);

    // TTL constant: 10 hours in milliseconds
    const TTL_MS = 36000 * 1000;

    useEffect(() => {
        // Load farm config from LocalStorage if valid
        try {
            const storedConfig = localStorage.getItem('tauron_farm_config');
            if (storedConfig) {
                const parsed = JSON.parse(storedConfig);
                const now = new Date().getTime();
                if (parsed.timestamp && now - parsed.timestamp < TTL_MS) {
                    setFarmInfo({ name: parsed.name, location: parsed.location });
                } else {
                    localStorage.removeItem('tauron_farm_config'); // Expired
                }
            }
        } catch (e) {
            console.error("Failed to parse LocalStorage farm config", e);
        }

        const handleResize = () => setIsMobile(window.innerWidth < 768);
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, []);

    // Using Lucide icons by creating elements
    useEffect(() => {
        if (window.lucide) {
            window.lucide.createIcons();
        }
    });

    const tabs = [
        { id: 'home', icon: 'home', label: 'Home' },
        { id: 'feed', icon: 'bell', label: 'Alerts' },
        { id: 'map', icon: 'map', label: 'Herd Map' },
        { id: 'log', icon: 'clipboard-list', label: 'Data Log' },
        { id: 'impact', icon: 'leaf', label: 'Impact' },
    ];

    const saveFarmInfo = () => {
        const newInfo = {
            name: nameRef.current?.value || farmInfo.name,
            location: locRef.current?.value || farmInfo.location
        };
        setFarmInfo(newInfo);
        setIsEditingFarm(false);
        try {
            localStorage.setItem('tauron_farm_config', JSON.stringify({
                ...newInfo,
                timestamp: new Date().getTime()
            }));
        } catch (e) {
            console.error("Failed to save LocalStorage farm config", e);
        }
    };

    return (
        <div style={{
            display: 'flex',
            flexDirection: isMobile ? 'column' : 'row',
            height: '100vh',
            width: '100vw',
            margin: '0 auto',
            background: 'var(--bg)',
            position: 'relative',
            overflow: 'hidden'
        }}>

            {/* Navigation / Header Area */}
            {isMobile ? (
                // Mobile Top Bar
                <div style={{
                    background: 'var(--dark-bg)',
                    padding: '16px 20px',
                    borderBottom: '1px solid rgba(255,255,255,0.06)',
                    flexShrink: 0
                }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div>
                            <div className="logo">Tau<span className="accent">ron.</span></div>
                            {isEditingFarm ? (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginTop: '4px' }}>
                                    <input
                                        ref={nameRef}
                                        defaultValue={farmInfo.name}
                                        style={{ background: 'transparent', border: '1px solid var(--line)', color: '#fff', fontSize: '10px', padding: '2px 4px', fontFamily: 'Cormorant Garamond, serif' }}
                                    />
                                    <input
                                        ref={locRef}
                                        defaultValue={farmInfo.location}
                                        style={{ background: 'transparent', border: '1px solid var(--line)', color: '#fff', fontSize: '10px', padding: '2px 4px', fontFamily: 'Cormorant Garamond, serif' }}
                                    />
                                    <button onClick={saveFarmInfo} style={{ background: 'var(--sage)', color: 'var(--bg)', border: 'none', padding: '2px 8px', fontSize: '10px', marginTop: '4px', cursor: 'pointer' }}>SAVE</button>
                                </div>
                            ) : (
                                <div
                                    onClick={() => setIsEditingFarm(true)}
                                    title="Click to edit farm details"
                                    style={{
                                        fontSize: '10px',
                                        color: 'rgba(242,237,228,0.35)',
                                        fontFamily: 'Cormorant Garamond, serif',
                                        marginTop: '2px',
                                        cursor: 'pointer',
                                        borderBottom: '1px dotted rgba(255,255,255,0.2)',
                                        display: 'inline-block'
                                    }}>
                                    {farmInfo.name} — {farmInfo.location}
                                </div>
                            )}
                        </div>
                        <div style={{ color: 'var(--sage)' }}>
                            <i data-lucide="wifi"></i>
                        </div>
                    </div>
                </div>
            ) : (
                // Desktop Side Navigation
                <div style={{
                    width: '240px',
                    background: 'var(--dark-bg)',
                    borderRight: '1px solid rgba(255,255,255,0.06)',
                    display: 'flex',
                    flexDirection: 'column',
                    flexShrink: 0
                }}>
                    <div style={{ padding: '32px 24px' }}>
                        <div className="logo" style={{ fontSize: '36px' }}>Tauron<span className="accent">.</span></div>
                        {isEditingFarm ? (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '8px' }}>
                                <input
                                    ref={nameRef}
                                    defaultValue={farmInfo.name}
                                    style={{ background: 'transparent', border: '1px solid var(--line)', color: '#fff', fontSize: '11px', padding: '4px 6px', fontFamily: 'JetBrains Mono, monospace' }}
                                />
                                <input
                                    ref={locRef}
                                    defaultValue={farmInfo.location}
                                    style={{ background: 'transparent', border: '1px solid var(--line)', color: '#fff', fontSize: '11px', padding: '4px 6px', fontFamily: 'JetBrains Mono, monospace' }}
                                />
                                <button onClick={saveFarmInfo} style={{ background: 'var(--sage)', color: 'var(--bg)', border: 'none', padding: '4px 12px', fontSize: '11px', fontWeight: 'bold', marginTop: '4px', cursor: 'pointer', fontFamily: 'JetBrains Mono, monospace' }}>SAVE</button>
                            </div>
                        ) : (
                            <div
                                onClick={() => setIsEditingFarm(true)}
                                title="Click to edit farm details"
                                style={{
                                    fontSize: '11px',
                                    color: 'rgba(242,237,228,0.35)',
                                    fontFamily: 'JetBrains Mono, monospace',
                                    marginTop: '8px',
                                    cursor: 'pointer',
                                    borderBottom: '1px dotted rgba(255,255,255,0.2)',
                                    display: 'inline-block'
                                }}>
                                {farmInfo.name}<br />{farmInfo.location}
                            </div>
                        )}
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', padding: '0 12px', flex: 1, marginTop: '24px' }}>
                        {tabs.map(tab => (
                            <div
                                key={tab.id}
                                onClick={() => onTabChange(tab.id)}
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '12px',
                                    padding: '14px 16px',
                                    marginBottom: '8px',
                                    borderRadius: '8px',
                                    background: currentTab === tab.id ? 'rgba(106, 158, 72, 0.15)' : 'transparent',
                                    color: currentTab === tab.id ? 'var(--sage)' : 'var(--mist)',
                                    cursor: 'pointer',
                                    transition: 'all 0.2s',
                                    border: currentTab === tab.id ? '1px solid rgba(106, 158, 72, 0.3)' : '1px solid transparent'
                                }}
                                className="hover-lift"
                            >
                                <i data-lucide={tab.icon} style={{ width: '20px', height: '20px' }}></i>
                                <span style={{
                                    fontFamily: 'Cormorant Garamond, serif',
                                    fontSize: '15px',
                                    letterSpacing: '0.02em',
                                    fontWeight: currentTab === tab.id ? '700' : '600'
                                }}>
                                    {tab.label}
                                </span>
                            </div>
                        ))}
                    </div>

                    <div style={{ padding: '24px', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', color: 'var(--sage)', fontSize: '14px', fontFamily: 'Cormorant Garamond, serif', fontWeight: 'bold' }}>
                            <i data-lucide="wifi"></i>
                            Sensors Active
                        </div>
                    </div>
                </div>
            )}

            {/* Main Content Area */}
            <div style={{
                flex: 1,
                overflowY: 'auto',
                padding: '0',
                maxWidth: isMobile ? '1024px' : 'none',
                margin: isMobile ? '0 auto' : '0'
            }}>
                {/* Max width container for readable desktop apps */}
                <div style={{ maxWidth: '1024px', margin: '0 auto', height: '100%' }}>
                    {children}
                </div>
            </div>

            {/* Mobile Bottom Navigation */}
            {isMobile && (
                <div style={{
                    display: 'flex',
                    background: 'var(--card)',
                    borderTop: '1px solid var(--line)',
                    paddingBottom: 'env(safe-area-inset-bottom, 16px)',
                    flexShrink: 0
                }}>
                    {tabs.map(tab => (
                        <div
                            key={tab.id}
                            onClick={() => onTabChange(tab.id)}
                            style={{
                                flex: 1,
                                padding: '12px 0',
                                textAlign: 'center',
                                cursor: 'pointer',
                                color: currentTab === tab.id ? 'var(--sage)' : 'var(--mist)',
                                transition: 'all 0.2s',
                            }}
                            className="hover-lift"
                        >
                            <i data-lucide={tab.icon} style={{ width: '20px', height: '20px', margin: '0 auto' }}></i>
                            <span style={{
                                display: 'block',
                                fontFamily: 'Cormorant Garamond, serif',
                                fontSize: '11px',
                                marginTop: '4px',
                                letterSpacing: '0.05em',
                                fontWeight: currentTab === tab.id ? '700' : '600'
                            }}>
                                {tab.label.toUpperCase()}
                            </span>
                        </div>
                    ))}
                </div>
            )}

        </div>
    );
};
