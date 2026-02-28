const { useEffect, useRef, useState } = React;

const HerdMap = () => {
    const svgRef = useRef();
    const [selectedNode, setSelectedNode] = useState(null);
    const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
    const graphData = useRef(null);

    // Generate mock graph data once
    if (!graphData.current) {
        const nodes = Array.from({ length: 40 }, (_, i) => ({
            id: `Cow ${2000 + i}`,
            group: Math.floor(Math.random() * 4) + 1,
            risk: Math.random() > 0.8 ? 'high' : (Math.random() > 0.5 ? 'warn' : 'ok'),
            pen: `Pen ${String.fromCharCode(65 + Math.floor(i / 10))}`
        }));

        const links = [];
        for (let i = 0; i < 60; i++) {
            let source = Math.floor(Math.random() * 40);
            let target = Math.floor(Math.random() * 40);
            if (source !== target) {
                links.push({
                    source: `Cow ${2000 + source}`,
                    target: `Cow ${2000 + target}`,
                    value: Math.random()
                });
            }
        }
        graphData.current = { nodes, links };
    }

    useEffect(() => {
        const handleResize = () => setIsMobile(window.innerWidth < 768);
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, []);

    useEffect(() => {
        if (isMobile) return;
        if (!svgRef.current) return;

        // Ensure D3 is loaded
        if (typeof d3 === 'undefined') return;

        const width = svgRef.current.clientWidth;
        const height = svgRef.current.clientHeight || 400;

        const svg = d3.select(svgRef.current);
        svg.selectAll('*').remove();

        // Create a deep copy for simulation because D3 mutates properties
        const nodes = graphData.current.nodes.map(d => ({ ...d }));
        const links = graphData.current.links.map(d => ({ ...d }));

        const simulation = d3.forceSimulation(nodes)
            .force("link", d3.forceLink(links).id(d => d.id).distance(60))
            .force("charge", d3.forceManyBody().strength(-150))
            .force("center", d3.forceCenter(width / 2, height / 2))
            .force("collide", d3.forceCollide().radius(20));

        // Colors based on CSS variables
        const getColor = (risk) => {
            if (risk === 'high') return '#E07050';    // --danger
            if (risk === 'warn') return '#C9983A';    // --straw
            return '#6A9E48';                         // --sage
        };

        const link = svg.append("g")
            .attr("stroke", "rgba(216, 208, 196, 0.4)") // --line
            .attr("stroke-opacity", 0.6)
            .selectAll("line")
            .data(links)
            .join("line")
            .attr("stroke-width", d => Math.max(0.5, Math.sqrt(d.value) * 2));

        const node = svg.append("g")
            .attr("stroke", "#FAF7F2") // --card
            .attr("stroke-width", 1.5)
            .selectAll("circle")
            .data(nodes)
            .join("circle")
            .attr("r", d => d.risk === 'high' ? 12 : 8)
            .attr("fill", d => getColor(d.risk))
            .style("cursor", "pointer")
            .on("click", (event, d) => {
                setSelectedNode(d);
            });

        node.call(d3.drag()
            .on("start", (event, d) => {
                if (!event.active) simulation.alphaTarget(0.3).restart();
                d.fx = d.x;
                d.fy = d.y;
            })
            .on("drag", (event, d) => {
                d.fx = event.x;
                d.fy = event.y;
            })
            .on("end", (event, d) => {
                if (!event.active) simulation.alphaTarget(0);
                d.fx = null;
                d.fy = null;
            }));

        // Pulse high risk
        function pulse() {
            svg.selectAll("circle").filter(d => d.risk === 'high')
                .transition()
                .duration(1000)
                .attr("r", 15)
                .attr("stroke-width", 3)
                .attr("stroke", "rgba(224, 112, 80, 0.4)")
                .transition()
                .duration(1000)
                .attr("r", 12)
                .attr("stroke-width", 1.5)
                .attr("stroke", "#FAF7F2")
                .on("end", pulse);
        }
        pulse();

        node.append("title")
            .text(d => d.id);

        simulation.on("tick", () => {
            link
                .attr("x1", d => d.source.x)
                .attr("y1", d => d.source.y)
                .attr("x2", d => d.target.x)
                .attr("y2", d => d.target.y);

            node
                .attr("cx", d => d.x = Math.max(15, Math.min(width - 15, d.x)))
                .attr("cy", d => d.y = Math.max(15, Math.min(height - 15, d.y)));
        });

        return () => simulation.stop();
    }, [isMobile]);

    useEffect(() => {
        if (window.lucide) window.lucide.createIcons();
    });

    const renderMobileGrid = () => {
        const pens = graphData.current.nodes.reduce((acc, node) => {
            if (!acc[node.pen]) acc[node.pen] = [];
            acc[node.pen].push(node);
            return acc;
        }, {});

        const getColor = (risk) => {
            if (risk === 'high') return 'var(--danger)';
            if (risk === 'warn') return 'var(--straw)';
            return 'var(--sage)';
        };

        return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                {Object.keys(pens).sort().map(pen => (
                    <div key={pen} className="card" style={{ padding: '20px' }}>
                        <h3 style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: '20px', fontWeight: 'bold', marginBottom: '16px', color: 'var(--barn)' }}>{pen}</h3>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '10px' }}>
                            {pens[pen].map(cow => (
                                <div
                                    key={cow.id}
                                    onClick={() => setSelectedNode(cow)}
                                    style={{
                                        width: '100%',
                                        aspectRatio: '1',
                                        background: getColor(cow.risk),
                                        borderRadius: '8px',
                                        cursor: 'pointer',
                                        boxShadow: cow.risk === 'high' ? '0 0 12px rgba(224, 112, 80, 0.5)' : 'none',
                                        opacity: cow.risk === 'ok' ? 0.4 : 1,
                                        transition: 'all 0.2s',
                                        animation: cow.risk === 'high' ? 'pulse-ring 2s infinite' : 'none'
                                    }}
                                    title={cow.id}
                                />
                            ))}
                        </div>
                    </div>
                ))}
            </div>
        );
    };

    return (
        <div style={{ padding: '24px 20px', height: '100%', display: 'flex', flexDirection: 'column', position: 'relative' }}>
            <div className="kicker" style={{ marginBottom: '16px', flexShrink: 0, fontFamily: 'Cormorant Garamond, serif', fontSize: '16px', fontWeight: '700' }}>Herd Map & Contacts</div>

            <div style={{ flex: 1, minHeight: '400px', width: '100%', background: 'var(--card)', borderRadius: '12px', border: '1px solid var(--line)', overflow: 'hidden', position: 'relative' }}>
                {isMobile ? (
                    <div style={{ padding: '16px', height: '100%', overflowY: 'auto' }}>
                        {renderMobileGrid()}
                    </div>
                ) : (
                    <svg ref={svgRef} style={{ width: '100%', height: '100%', display: 'block' }}></svg>
                )}
            </div>

            {selectedNode && (
                <div style={{
                    position: 'absolute',
                    bottom: '40px',
                    left: '20px',
                    right: '20px',
                    background: 'var(--dark-bg)',
                    borderRadius: '12px',
                    padding: '20px',
                    color: 'var(--bg)',
                    boxShadow: '0 20px 40px rgba(0,0,0,0.3)',
                    border: '1px solid #333',
                    zIndex: 10
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
                            onClick={() => setSelectedNode(null)}
                            style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.4)', cursor: 'pointer' }}
                        >
                            <i data-lucide="x" style={{ width: '20px', height: '20px' }}></i>
                        </button>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '16px' }}>
                        <div style={{ background: 'rgba(255,255,255,0.05)', padding: '12px', borderRadius: '6px' }}>
                            <div style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: '13px', fontWeight: 'bold', color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', marginBottom: '6px' }}>Avg Yield</div>
                            <div style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: '24px', fontWeight: 'bold', color: 'var(--straw-lt)' }}>42.1 kg</div>
                        </div>
                        <div style={{ background: 'rgba(255,255,255,0.05)', padding: '12px', borderRadius: '6px' }}>
                            <div style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: '13px', fontWeight: 'bold', color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', marginBottom: '6px' }}>Activity</div>
                            <div style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: '24px', fontWeight: 'bold', color: 'var(--sage-lt)' }}>Normal</div>
                        </div>
                    </div>

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
