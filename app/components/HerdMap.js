const { useEffect, useRef, useState } = React;

const API = 'http://localhost:8000';
const PEN_LABELS = ['A', 'B', 'C', 'D', 'E', 'F'];

const derivePen = (id) => 'Pen ' + (PEN_LABELS[Math.min(Math.floor(id / 10), PEN_LABELS.length - 1)] || 'X');
const statusToRisk = (s) => s === 'alert' ? 'high' : (s === 'watch' ? 'warn' : 'ok');

const HerdMap = () => {
    const svgRef = useRef();
    const [selectedNode, setSelectedNode] = useState(null);
    const [selectedExplain, setSelectedExplain] = useState(null);
    const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
    const [herdData, setHerdData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    // Fetch /herd — used on mount and after ingest
    const fetchHerd = () => {
        setLoading(true);
        setError(null);
        fetch(`${API}/herd`)
            .then(r => r.ok ? r.json() : Promise.reject(`HTTP ${r.status}`))
            .then(data => {
                const nodes = data.cows.map(c => ({
                    id: `Cow ${c.id}`,
                    cowId: c.id,
                    group: Math.floor(c.id / 10) + 1,
                    risk: statusToRisk(c.status),
                    pen: derivePen(c.id),
                    riskScore: c.risk_score,
                    dominantDisease: c.dominant_disease,
                    allRisks: c.all_risks,
                }));

                // Adjacency matrix → undirected link list (i < j dedup)
                // Tag each link with samePen so D3 can hide cross-pen clutter
                const links = [];
                const adj = data.adjacency || [];
                for (let i = 0; i < adj.length; i++) {
                    for (let j = i + 1; j < (adj[i] || []).length; j++) {
                        if (adj[i][j]) {
                            const samePen = nodes[i].group === nodes[j].group;
                            const eitherAlert = nodes[i].risk !== 'ok' || nodes[j].risk !== 'ok';
                            links.push({
                                source: nodes[i].id, target: nodes[j].id,
                                value: 1, samePen, eitherAlert,
                            });
                        }
                    }
                }
                setHerdData({ nodes, links });
            })
            .catch(e => setError(String(e)))
            .finally(() => setLoading(false));
    };

    // Fetch on mount
    useEffect(() => { fetchHerd(); }, []);

    // Re-fetch whenever DataEntryLog signals new data was ingested
    useEffect(() => {
        window.addEventListener('herd-refresh', fetchHerd);
        return () => window.removeEventListener('herd-refresh', fetchHerd);
    }, []);

    // Fetch /explain when a node is selected
    useEffect(() => {
        if (!selectedNode) return;
        setSelectedExplain(null);
        fetch(`${API}/explain/${selectedNode.cowId}`)
            .then(r => r.ok ? r.json() : Promise.reject(r.status))
            .then(setSelectedExplain)
            .catch(() => { });
    }, [selectedNode]);

    useEffect(() => {
        const handleResize = () => setIsMobile(window.innerWidth < 768);
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, []);

    // D3 force graph — re-runs when herdData changes
    useEffect(() => {
        if (isMobile || !svgRef.current || !herdData) return;
        if (typeof d3 === 'undefined') return;

        const width  = svgRef.current.clientWidth;
        const height = svgRef.current.clientHeight || 400;
        const n      = herdData.nodes.length;

        const svg = d3.select(svgRef.current);
        svg.selectAll('*').remove();

        // ── SVG filter defs (glow effects) ──────────────────────────────────
        const defs = svg.append("defs");
        defs.append("filter").attr("id", "node-glow").call(f => {
            f.append("feGaussianBlur").attr("in", "SourceGraphic").attr("stdDeviation", "4").attr("result", "blur");
            f.append("feMerge").call(m => {
                m.append("feMergeNode").attr("in", "blur");
                m.append("feMergeNode").attr("in", "SourceGraphic");
            });
        });
        defs.append("filter").attr("id", "edge-glow").call(f => {
            f.append("feGaussianBlur").attr("in", "SourceGraphic").attr("stdDeviation", "2").attr("result", "blur");
            f.append("feMerge").call(m => {
                m.append("feMergeNode").attr("in", "blur");
                m.append("feMergeNode").attr("in", "SourceGraphic");
            });
        });

        // Deep copy so D3 mutation doesn't touch React state
        const nodes = herdData.nodes.map(d => ({ ...d }));
        // At 60 cows the full adjacency has 600+ edges — only render
        // within-pen edges (structural) + cross-pen edges touching alert cows
        const links = herdData.links
            .filter(d => d.samePen || d.eitherAlert)
            .map(d => ({ ...d }));

        // ── Pen cluster centres (6 pens, 2 rows × 3 cols) ─────────────────
        // group is 1-indexed (Math.floor(cowId/10)+1), map to grid position.
        const PEN_COLS = 3, PEN_ROWS = 2;
        const padX = width * 0.18, padY = height * 0.20;
        const colStep = PEN_COLS > 1 ? (width  - padX * 2) / (PEN_COLS - 1) : 0;
        const rowStep = PEN_ROWS > 1 ? (height - padY * 2) / (PEN_ROWS - 1) : 0;
        const penCentre = (group) => {
            const g = Math.max(1, Math.min(6, group)) - 1;
            return { x: padX + (g % PEN_COLS) * colStep, y: padY + Math.floor(g / PEN_COLS) * rowStep };
        };

        // ── Node radii — smaller at 60-cow scale ──────────────────────────
        const R_ALERT  = 11;   // was 14 — still prominent, less overlap
        const R_NORMAL = 6;    // was 8  — readable dot without crowding

        // ── Force simulation — tuned for 60 nodes ─────────────────────────
        // charge: stronger repulsion keeps pens from collapsing
        // penX/penY: soft spring to pen centre groups cows by location
        // link: shorter distance + lower strength avoids rigidity inside pens
        // collide: generous radius prevents label overlap
        const simulation = d3.forceSimulation(nodes)
            .force("link",   d3.forceLink(links).id(d => d.id).distance(n > 20 ? 28 : 50).strength(0.20))
            .force("charge", d3.forceManyBody().strength(n > 20 ? -80 : -150).distanceMax(120))
            .force("center", d3.forceCenter(width / 2, height / 2).strength(0.03))
            .force("collide",d3.forceCollide().radius(d => (d.riskScore > 0.70 ? R_ALERT : R_NORMAL) + 6).strength(0.9))
            .force("penX",   d3.forceX(d => penCentre(d.group).x).strength(0.35))
            .force("penY",   d3.forceY(d => penCentre(d.group).y).strength(0.35))
            .alphaDecay(0.02);

        const getColor = (risk) => {
            if (risk === 'high') return '#E07050';
            if (risk === 'warn') return '#C9983A';
            return '#6A9E48';
        };

        // ── Pen label backgrounds (rendered before links/nodes) ──────────
        const penGroups = [...new Set(nodes.map(d => d.group))];
        const penLabelG = svg.append("g").attr("class", "pen-labels");
        penGroups.forEach(g => {
            const c = penCentre(g);
            penLabelG.append("text")
                .attr("x", c.x).attr("y", c.y - (n > 20 ? 50 : 35))
                .attr("text-anchor", "middle")
                .text('Pen ' + PEN_LABELS[g - 1])
                .style("font-family", "Cormorant Garamond, serif")
                .style("font-size", "13px")
                .style("font-weight", "700")
                .style("fill", "rgba(44, 26, 14, 0.25)")
                .style("letter-spacing", "0.08em")
                .style("pointer-events", "none");
        });

        // ── Links — thinner/more transparent at high density ─────────────
        const link = svg.append("g")
            .selectAll("line")
            .data(links)
            .join("line")
            .attr("stroke", d => {
                if (d.eitherAlert && !d.samePen) return "rgba(224, 112, 80, 0.25)";
                if (d.eitherAlert) return "rgba(224, 112, 80, 0.35)";
                return "rgba(216, 208, 196, 0.20)";
            })
            .attr("stroke-opacity", d => d.eitherAlert ? 0.8 : (n > 20 ? 0.25 : 0.6))
            .attr("stroke-width", d => d.eitherAlert ? 1.5 : (n > 20 ? 0.5 : 1.2))
            .style("filter", d => (d.eitherAlert && !d.samePen) ? "url(#edge-glow)" : "none");

        const node = svg.append("g")
            .selectAll("g")
            .data(nodes)
            .join("g")
            .style("cursor", "pointer")
            .on("click", (event, d) => setSelectedNode(d));

        node.append("circle")
            .attr("stroke", "#FAF7F2")
            .attr("stroke-width", d => d.riskScore > 0.70 ? 1.5 : 1)
            .attr("r", d => d.riskScore > 0.70 ? R_ALERT : R_NORMAL)
            .attr("fill", d => getColor(d.risk))
            .style("filter", d => d.riskScore > 0.70 ? "url(#node-glow)" : "none");

        // Labels only on alert cows — avoids crowding at 60 nodes
        node.filter(d => d.riskScore > 0.70)
            .append("text")
            .text(d => d.id.replace('Cow ', ''))
            .attr("text-anchor", "middle")
            .attr("dy", "0.3em")
            .attr("fill", "#FAF7F2")
            .style("font-size", "8px")
            .style("font-family", "JetBrains Mono, monospace")
            .style("font-weight", "bold")
            .style("pointer-events", "none");

        node.call(d3.drag()
            .on("start", (event, d) => {
                if (!event.active) simulation.alphaTarget(0.3).restart();
                d.fx = d.x; d.fy = d.y;
            })
            .on("drag", (event, d) => { d.fx = event.x; d.fy = event.y; })
            .on("end", (event, d) => {
                if (!event.active) simulation.alphaTarget(0);
                d.fx = null; d.fy = null;
            }));

        // Pulse — cycles R_ALERT → R_ALERT+4 → R_ALERT (consistent every cycle)
        function pulse() {
            svg.selectAll("circle").filter(d => d.risk === 'high')
                .transition().duration(1000)
                .attr("r", R_ALERT + 4).attr("stroke-width", 3).attr("stroke", "rgba(224, 112, 80, 0.4)")
                .transition().duration(1000)
                .attr("r", R_ALERT).attr("stroke-width", 1.5).attr("stroke", "#FAF7F2")
                .on("end", pulse);
        }
        pulse();

        node.append("title").text(d => `${d.id} · ${d.pen} · ${d.risk.toUpperCase()}`);

        simulation.on("tick", () => {
            const margin = R_ALERT + 2;
            link
                .attr("x1", d => d.source.x)
                .attr("y1", d => d.source.y)
                .attr("x2", d => d.target.x)
                .attr("y2", d => d.target.y);
            node
                .attr("transform", d => {
                    d.x = Math.max(margin, Math.min(width  - margin, d.x));
                    d.y = Math.max(margin, Math.min(height - margin, d.y));
                    return `translate(${d.x},${d.y})`;
                });
        });

        return () => simulation.stop();
    }, [isMobile, herdData]);

    useEffect(() => {
        if (window.lucide) window.lucide.createIcons();
    });

    const renderMobileGrid = () => {
        if (!herdData) return null;

        // Group cows by pen
        const pens = herdData.nodes.reduce((acc, node) => {
            if (!acc[node.pen]) acc[node.pen] = [];
            acc[node.pen].push(node);
            return acc;
        }, {});

        // Find max stalls per pen so all rows share the same column count
        const maxStalls = Math.max(...Object.values(pens).map(p => p.length));

        const getColor = (risk) => {
            if (risk === 'high') return 'var(--danger)';
            if (risk === 'warn') return 'var(--straw)';
            return 'var(--sage)';
        };

        const getRiskLabel = (risk) => {
            if (risk === 'high') return '● Alert';
            if (risk === 'warn') return '◐ Watch';
            return '';
        };

        return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0' }}>
                {/* Column header row */}
                <div style={{
                    display: 'grid',
                    gridTemplateColumns: `48px repeat(${maxStalls}, 1fr)`,
                    gap: '3px',
                    padding: '0 0 6px 0',
                    alignItems: 'end'
                }}>
                    <div style={{
                        fontFamily: 'JetBrains Mono, monospace',
                        fontSize: '8px',
                        color: 'var(--mist)',
                        textTransform: 'uppercase',
                        letterSpacing: '0.1em',
                        textAlign: 'center',
                        paddingBottom: '2px'
                    }}>Pen</div>
                    {Array.from({ length: maxStalls }, (_, i) => (
                        <div key={i} style={{
                            fontFamily: 'JetBrains Mono, monospace',
                            fontSize: '8px',
                            color: 'var(--mist)',
                            textAlign: 'center',
                            letterSpacing: '0.05em'
                        }}>
                            {i + 1}
                        </div>
                    ))}
                </div>

                {/* Pen rows */}
                {Object.keys(pens).sort().map(pen => (
                    <div key={pen} style={{
                        display: 'grid',
                        gridTemplateColumns: `48px repeat(${maxStalls}, 1fr)`,
                        gap: '3px',
                        padding: '3px 0',
                        borderTop: '1px solid var(--line)'
                    }}>
                        {/* Pen label cell */}
                        <div style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontFamily: 'Cormorant Garamond, serif',
                            fontSize: '14px',
                            fontWeight: '700',
                            color: 'var(--barn)',
                            background: 'rgba(44, 26, 14, 0.04)',
                            borderRadius: '6px',
                            minHeight: '36px'
                        }}>
                            {pen.replace('Pen ', '')}
                        </div>

                        {/* Stall cells */}
                        {pens[pen].map(cow => (
                            <div
                                key={cow.id}
                                onClick={() => setSelectedNode(cow)}
                                style={{
                                    aspectRatio: '1',
                                    background: getColor(cow.risk),
                                    borderRadius: '6px',
                                    cursor: 'pointer',
                                    boxShadow: cow.risk === 'high' ? '0 0 8px rgba(224, 112, 80, 0.5)' : 'none',
                                    opacity: cow.risk === 'ok' ? 0.35 : 1,
                                    transition: 'all 0.2s ease',
                                    animation: cow.risk === 'high' ? 'pulse-ring 2s infinite' : 'none',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    position: 'relative',
                                    minHeight: '36px'
                                }}
                                title={`${cow.id} — ${cow.risk.toUpperCase()}`}
                            >
                                <span style={{
                                    fontFamily: 'JetBrains Mono, monospace',
                                    fontSize: '8px',
                                    fontWeight: '700',
                                    color: cow.risk === 'ok' ? 'rgba(255,255,255,0.8)' : '#fff',
                                    textShadow: '0 1px 2px rgba(0,0,0,0.3)'
                                }}>
                                    {cow.cowId}
                                </span>
                            </div>
                        ))}

                        {/* Empty stall placeholders */}
                        {Array.from({ length: maxStalls - pens[pen].length }, (_, i) => (
                            <div key={`empty-${i}`} style={{
                                aspectRatio: '1',
                                background: 'rgba(216, 208, 196, 0.15)',
                                borderRadius: '6px',
                                border: '1px dashed var(--line)',
                                minHeight: '36px'
                            }} />
                        ))}
                    </div>
                ))}

                {/* Legend */}
                <div style={{
                    display: 'flex',
                    gap: '16px',
                    padding: '12px 0 4px 0',
                    borderTop: '1px solid var(--line)',
                    marginTop: '4px'
                }}>
                    {[
                        { color: 'var(--danger)', label: 'Alert' },
                        { color: 'var(--straw)', label: 'Watch' },
                        { color: 'var(--sage)', label: 'OK' }
                    ].map(item => (
                        <div key={item.label} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <div style={{
                                width: '10px',
                                height: '10px',
                                borderRadius: '3px',
                                background: item.color,
                                opacity: item.label === 'OK' ? 0.35 : 1
                            }} />
                            <span style={{
                                fontFamily: 'JetBrains Mono, monospace',
                                fontSize: '9px',
                                color: 'var(--mist)',
                                textTransform: 'uppercase',
                                letterSpacing: '0.1em'
                            }}>{item.label}</span>
                        </div>
                    ))}
                </div>
            </div>
        );
    };

    return (
        <div style={{ padding: '24px 20px', height: '100%', display: 'flex', flexDirection: 'column', position: 'relative' }}>
            <div className="kicker" style={{ marginBottom: '16px', flexShrink: 0, fontFamily: 'Cormorant Garamond, serif', fontSize: '16px', fontWeight: '700' }}>Herd Map & Contacts</div>

            {error && (
                <div style={{ background: 'var(--danger-bg)', border: '1px solid rgba(224,112,80,0.3)', borderRadius: '8px', padding: '12px 16px', color: 'var(--danger)', fontFamily: 'Cormorant Garamond, serif', fontSize: '14px', marginBottom: '12px' }}>
                    Cannot reach backend — run: <code>uvicorn backend.main:app --reload</code>
                </div>
            )}

            <div style={{ flex: 1, minHeight: '400px', width: '100%', background: 'var(--card)', borderRadius: '12px', border: '1px solid var(--line)', overflow: 'hidden', position: 'relative' }}>
                {loading ? (
                    <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--mist)', fontFamily: 'Cormorant Garamond, serif', fontSize: '18px' }}>
                        Building herd graph…
                    </div>
                ) : isMobile ? (
                    <div style={{ padding: '16px', height: '100%', overflowY: 'auto' }}>
                        {renderMobileGrid()}
                    </div>
                ) : (
                    <svg ref={svgRef} style={{ width: '100%', height: '100%', display: 'block' }}></svg>
                )}
            </div>

            {selectedNode && (
                <div className="panel-enter-active" style={{
                    position: 'absolute',
                    bottom: '40px',
                    left: '20px',
                    right: '20px',
                    background: 'var(--dark-bg)',
                    borderRadius: '12px',
                    padding: '24px',
                    color: 'var(--bg)',
                    boxShadow: selectedNode.riskScore > 0.70 ? '0 0 30px rgba(224, 112, 80, 0.3)' : '0 20px 40px rgba(0,0,0,0.3)',
                    border: selectedNode.riskScore > 0.70 ? '1px solid var(--danger)' : '1px solid #333',
                    zIndex: 10,
                    transformOrigin: 'bottom center'
                }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px' }}>
                        <div>
                            <div className="kicker" style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: '14px', fontWeight: 'bold', color: selectedNode.risk === 'high' ? 'var(--danger)' : (selectedNode.risk === 'warn' ? 'var(--straw)' : 'var(--sage)') }}>
                                STATUS: {selectedNode.risk.toUpperCase()}
                            </div>
                            <div style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: '32px', fontWeight: 'bold' }}>
                                {selectedNode.id}
                            </div>
                            <div style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: '16px', color: 'rgba(255,255,255,0.6)', marginTop: '4px' }}>
                                {selectedNode.pen}
                            </div>
                        </div>
                        <button
                            onClick={() => { setSelectedNode(null); setSelectedExplain(null); }}
                            style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.4)', cursor: 'pointer' }}
                        >
                            <i data-lucide="x" style={{ width: '20px', height: '20px' }}></i>
                        </button>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: selectedExplain ? '12px' : '16px' }}>
                        <div style={{ background: 'rgba(255,255,255,0.05)', padding: '12px', borderRadius: '6px' }}>
                            <div style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: '13px', fontWeight: 'bold', color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', marginBottom: '6px' }}>Risk Score</div>
                            <div style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: '24px', fontWeight: 'bold', color: 'var(--straw-lt)' }}>
                                {Math.round(selectedNode.riskScore * 100)}%
                            </div>
                        </div>
                        <div style={{ background: 'rgba(255,255,255,0.05)', padding: '12px', borderRadius: '6px' }}>
                            <div style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: '13px', fontWeight: 'bold', color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', marginBottom: '6px' }}>Disease</div>
                            <div style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: '24px', fontWeight: 'bold', color: 'var(--sage-lt)' }}>
                                {selectedNode.dominantDisease
                                    ? selectedNode.dominantDisease.charAt(0).toUpperCase() + selectedNode.dominantDisease.slice(1)
                                    : 'OK'}
                            </div>
                        </div>
                    </div>

                    {selectedExplain && (
                        <div style={{ background: 'rgba(255,255,255,0.05)', padding: '12px', borderRadius: '6px', marginBottom: '16px' }}>
                            <div style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: '13px', fontWeight: 'bold', color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', marginBottom: '6px' }}>Alert</div>
                            <div style={{ fontSize: '15px', color: 'rgba(255,255,255,0.85)', lineHeight: '1.4' }}>
                                {selectedExplain.alert_text}
                            </div>
                            <div style={{ marginTop: '8px', fontSize: '11px', color: 'rgba(255,255,255,0.30)', fontFamily: 'JetBrains Mono, monospace', lineHeight: '1.5' }}>
                                XAI: gradient attribution (∂risk/∂sensor) · single backward pass · {'<'}5 ms
                            </div>
                        </div>
                    )}

                    <button style={{
                        width: '100%',
                        padding: '14px',
                        background: 'var(--sage)',
                        color: 'var(--bg)',
                        border: 'none',
                        borderRadius: '6px',
                        fontFamily: 'Cormorant Garamond, serif',
                        fontSize: '15px',
                        fontWeight: 'bold',
                        letterSpacing: '0.05em',
                        textTransform: 'uppercase',
                        cursor: 'pointer',
                        transition: 'background 0.2s'
                    }}>
                        View Full History
                    </button>
                </div>
            )}
        </div>
    );
};
