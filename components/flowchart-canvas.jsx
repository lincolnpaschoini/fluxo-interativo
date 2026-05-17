// flowchart-canvas.jsx
// Canvas com zoom + pan, sele\u00e7\u00e3o, mover e redimensionar n\u00f3s.

const CANVAS_W = 2050;
const CANVAS_H = 1200;

const NODE_COLORS = {
  blue:           { fill: '#dbeaff', stroke: '#1f5dbb', text: '#0b2a59' },
  green:          { fill: '#c7e7c4', stroke: '#3d8c4d', text: '#1f4a26' },
  orange:         { fill: '#fde0c7', stroke: '#c97639', text: '#5e3416' },
  yellow:         { fill: '#fff2a8', stroke: '#caa628', text: '#4a3b08' },
  black:          { fill: '#1a1a1a', stroke: '#1a1a1a', text: '#ffffff' },
  'legend-blue':  { fill: '#cfe1f7', stroke: '#3973bd', text: '#0b2a59' },
  'legend-green': { fill: '#a9d6a3', stroke: '#3d8c4d', text: '#1f4a26' },
  'legend-orange':{ fill: '#f8bf94', stroke: '#c97639', text: '#5e3416' },
};

// offset em [-1, 1]: -1 = topo/esquerda da lateral, 0 = centro, 1 = base/direita
function sidePoint(node, side, offset = 0) {
  const cx = node.x + node.w / 2;
  const cy = node.y + node.h / 2;
  switch (side) {
    case 'l': return { x: node.x,           y: cy + offset * (node.h / 2) };
    case 'r': return { x: node.x + node.w,  y: cy + offset * (node.h / 2) };
    case 't': return { x: cx + offset * (node.w / 2), y: node.y };
    case 'b': return { x: cx + offset * (node.w / 2), y: node.y + node.h };
  }
}

function edgeDragAxis(fromSide, toSide) {
  const horiz = (s) => s === 'l' || s === 'r';
  const vert  = (s) => s === 't' || s === 'b';
  if (horiz(fromSide) && horiz(toSide)) return 'x'; // cotovelo move esq/dir
  if (vert(fromSide)  && vert(toSide))  return 'y'; // cotovelo move cima/baixo
  if (horiz(fromSide) && vert(toSide))  return 'x'; // L → Z, move esq/dir
  if (vert(fromSide)  && horiz(toSide)) return 'y'; // L → Z, move cima/baixo
  return 'y';
}

function routeEdge(from, to, fromSide, toSide, mid, fromOffset = 0, toOffset = 0) {
  const a = sidePoint(from, fromSide, fromOffset);
  const b = sidePoint(to, toSide, toOffset);
  const horiz = (s) => s === 'l' || s === 'r';
  const vert  = (s) => s === 't' || s === 'b';
  if (horiz(fromSide) && horiz(toSide)) {
    const m = mid ?? (a.x + b.x) / 2;
    return [a, { x: m, y: a.y }, { x: m, y: b.y }, b];
  }
  if (vert(fromSide) && vert(toSide)) {
    const m = mid ?? (a.y + b.y) / 2;
    return [a, { x: a.x, y: m }, { x: b.x, y: m }, b];
  }
  // Setas em L: quando mid está definido, cria cotovelo extra (L → Z)
  if (horiz(fromSide) && vert(toSide)) {
    if (mid != null) return [a, { x: mid, y: a.y }, { x: mid, y: b.y }, b];
    return [a, { x: b.x, y: a.y }, b];
  }
  if (vert(fromSide) && horiz(toSide)) {
    if (mid != null) return [a, { x: a.x, y: mid }, { x: b.x, y: mid }, b];
    return [a, { x: a.x, y: b.y }, b];
  }
  return [a, b];
}

function pointsToPath(pts, radius = 8) {
  if (pts.length < 2) return '';
  if (pts.length === 2) return `M ${pts[0].x} ${pts[0].y} L ${pts[1].x} ${pts[1].y}`;
  let d = `M ${pts[0].x} ${pts[0].y}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const prev = pts[i - 1], cur = pts[i], next = pts[i + 1];
    const dx1 = Math.sign(cur.x - prev.x), dy1 = Math.sign(cur.y - prev.y);
    const dx2 = Math.sign(next.x - cur.x), dy2 = Math.sign(next.y - cur.y);
    const r = Math.min(
      radius,
      Math.max(0, Math.hypot(cur.x - prev.x, cur.y - prev.y) / 2),
      Math.max(0, Math.hypot(next.x - cur.x, next.y - cur.y) / 2),
    );
    d += ` L ${cur.x - dx1 * r} ${cur.y - dy1 * r}`;
    d += ` Q ${cur.x} ${cur.y} ${cur.x + dx2 * r} ${cur.y + dy2 * r}`;
  }
  d += ` L ${pts[pts.length - 1].x} ${pts[pts.length - 1].y}`;
  return d;
}

function midpointOnPath(pts) {
  let total = 0;
  const segs = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const len = Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y);
    segs.push(len);
    total += len;
  }
  let half = total / 2;
  for (let i = 0; i < segs.length; i++) {
    if (half <= segs[i]) {
      const t = half / segs[i];
      return {
        x: pts[i].x + (pts[i + 1].x - pts[i].x) * t,
        y: pts[i].y + (pts[i + 1].y - pts[i].y) * t,
      };
    }
    half -= segs[i];
  }
  return pts[Math.floor(pts.length / 2)];
}

// Handle arrastável para reposicionar o cotovelo de uma seta selecionada
function EdgeMidHandle({ edge, nodes, onDragStart, onReset }) {
  const from = nodes[edge.from];
  const to   = nodes[edge.to];
  if (!from || !to) return null;

  const fromSide = edge.fromSide || 'r';
  const toSide   = edge.toSide   || 'l';
  const pts = routeEdge(from, to, fromSide, toSide, edge.mid, edge.fromOffset || 0, edge.toOffset || 0);
  const mp  = midpointOnPath(pts);
  const axis = edgeDragAxis(fromSide, toSide);
  const cursor = axis === 'x' ? 'ew-resize' : 'ns-resize';

  return (
    <g style={{ cursor }}>
      <circle cx={mp.x} cy={mp.y} r="11"
              fill="rgba(255,255,255,0.92)" stroke="#1f5dbb" strokeWidth="2"
              onMouseDown={(e) => { e.stopPropagation(); onDragStart(e, axis); }}
              onDoubleClick={(e) => { e.stopPropagation(); onReset(); }} />
      {/* ícone de setas indicando direção de arraste */}
      {axis === 'x' ? (
        <text x={mp.x} y={mp.y} textAnchor="middle" dominantBaseline="middle"
              fontSize="11" fontWeight="700" fill="#1f5dbb"
              style={{ pointerEvents: 'none', userSelect: 'none' }}>↔</text>
      ) : (
        <text x={mp.x} y={mp.y} textAnchor="middle" dominantBaseline="middle"
              fontSize="11" fontWeight="700" fill="#1f5dbb"
              style={{ pointerEvents: 'none', userSelect: 'none' }}>↕</text>
      )}
    </g>
  );
}

// Retorna os anchors de um nó: diamantes têm 4 pontas, outros têm 3 por lateral
function getAnchors(node) {
  if (node.shape === 'diamond') {
    return [
      { side: 't', offset: 0 },
      { side: 'r', offset: 0 },
      { side: 'b', offset: 0 },
      { side: 'l', offset: 0 },
    ];
  }
  return [
    { side: 't', offset: -0.6 }, { side: 't', offset: 0 }, { side: 't', offset: 0.6 },
    { side: 'b', offset: -0.6 }, { side: 'b', offset: 0 }, { side: 'b', offset: 0.6 },
    { side: 'l', offset: -0.6 }, { side: 'l', offset: 0 }, { side: 'l', offset: 0.6 },
    { side: 'r', offset: -0.6 }, { side: 'r', offset: 0 }, { side: 'r', offset: 0.6 },
  ];
}

// Fase 1: anchors do nó de origem — sempre visíveis, aguardando clique do usuário
function SourceAnchors({ node, onAnchorClick }) {
  const [hovIdx, setHovIdx] = React.useState(null);
  const anchors = getAnchors(node);
  return (
    <g>
      {anchors.map(({ side, offset }, i) => {
        const pt = sidePoint(node, side, offset);
        const hov = hovIdx === i;
        return (
          <circle key={i} cx={pt.x} cy={pt.y} r={hov ? 7 : 5.5}
                  fill={hov ? '#1f5dbb' : '#fff'}
                  stroke="#1f5dbb" strokeWidth="2"
                  style={{ cursor: 'crosshair' }}
                  onMouseEnter={() => setHovIdx(i)}
                  onMouseLeave={() => setHovIdx(null)}
                  onClick={(e) => { e.stopPropagation(); onAnchorClick(side, offset); }} />
        );
      })}
    </g>
  );
}

// Fase 2: anchors do nó destino — aparecem ao passar o mouse.
// Eventos ficam no <g> pai para que mover do rect para um circle não dispare mouseLeave.
function TargetAnchors({ node, onAnchorClick }) {
  const [hovIdx, setHovIdx] = React.useState(null);
  const [over, setOver] = React.useState(false);
  const anchors = getAnchors(node);
  const { x, y, w, h } = node;
  return (
    <g onMouseEnter={() => setOver(true)}
       onMouseLeave={() => { setOver(false); setHovIdx(null); }}>
      {/* área de hit generosa — fill transparente captura eventos mesmo fora do shape */}
      <rect x={x - 12} y={y - 12} width={w + 24} height={h + 24} fill="transparent" />
      {over && (
        <rect x={x - 3} y={y - 3} width={w + 6} height={h + 6}
              rx="8" fill="rgba(31,93,187,0.06)"
              stroke="#1f5dbb" strokeWidth="1.5" strokeDasharray="4 3"
              style={{ pointerEvents: 'none' }} />
      )}
      {over && anchors.map(({ side, offset }, i) => {
        const pt = sidePoint(node, side, offset);
        const hov = hovIdx === i;
        return (
          <circle key={i} cx={pt.x} cy={pt.y} r={hov ? 8 : 6}
                  fill={hov ? '#1f5dbb' : '#fff'}
                  stroke="#1f5dbb" strokeWidth="2"
                  style={{ cursor: 'crosshair' }}
                  onMouseEnter={() => setHovIdx(i)}
                  onMouseLeave={() => setHovIdx(null)}
                  onClick={(e) => { e.stopPropagation(); onAnchorClick(side, offset); }} />
        );
      })}
    </g>
  );
}

function NodeShape({ node, selected, editorMode, editable = true, onMouseDown, onClick }) {
  const [hovered, setHovered] = React.useState(false);
  const c = NODE_COLORS[node.color] || NODE_COLORS.blue;
  const { x, y, w, h, shape, label, isLegend } = node;
  const cx = x + w / 2;
  const cy = y + h / 2;
  const lines = (label || '').split('\n');

  let shapeEl, textEl;
  if (shape === 'text') {
    shapeEl = (
      <rect x={x} y={y} width={w} height={h} rx={4}
            fill="transparent"
            stroke={editorMode ? 'rgba(0,0,0,0.13)' : 'none'}
            strokeWidth="1" strokeDasharray="4 3" />
    );
    const tfs = node.fontSize || 14;
    textEl = (
      <text x={cx} y={cy} textAnchor="middle" dominantBaseline="middle"
            fontFamily="ui-sans-serif, system-ui, sans-serif"
            fontSize={tfs} fontWeight={600} fill={c.stroke}
            style={{ pointerEvents: 'none', userSelect: 'none' }}>
        {lines.map((line, i) => (
          <tspan key={i} x={cx} dy={i === 0 ? -((lines.length - 1) * (tfs * 1.15)) : tfs * 1.15}>{line}</tspan>
        ))}
      </text>
    );
  } else if (shape === 'zone') {
    const zfs = node.fontSize || 12;
    const zAlign = node.textAlign || 'left';
    const ztx = zAlign === 'center' ? cx : (zAlign === 'right' ? x + w - 14 : x + 14);
    const zAnchor = zAlign === 'center' ? 'middle' : (zAlign === 'right' ? 'end' : 'start');
    shapeEl = (
      <rect x={x} y={y} width={w} height={h} rx={10}
            fill="rgba(0,0,0,0.025)"
            stroke={c.stroke} strokeWidth="2.5" strokeDasharray="10 6" />
    );
    textEl = (
      <text x={ztx} y={y + 20} textAnchor={zAnchor} dominantBaseline="middle"
            fontFamily="ui-sans-serif, system-ui, sans-serif"
            fontSize={zfs} fontWeight={700} fill={c.stroke}
            style={{ pointerEvents: 'none', userSelect: 'none', letterSpacing: '0.06em' }}>
        {lines.map((line, i) => (
          <tspan key={i} x={ztx} dy={i === 0 ? 0 : zfs * 1.3}>{line.toUpperCase()}</tspan>
        ))}
      </text>
    );
  } else {
    textEl = (
      <text x={cx} y={cy} textAnchor="middle" dominantBaseline="middle"
            fontFamily="ui-sans-serif, system-ui, sans-serif"
            fontSize={isLegend ? 16 : 13}
            fontWeight={isLegend ? 700 : 600}
            fill={c.text}
            style={{ pointerEvents: 'none', userSelect: 'none', letterSpacing: '0.01em' }}>
        {lines.map((line, i) => (
          <tspan key={i} x={cx} dy={i === 0 ? -((lines.length - 1) * 7) : 14}>{line}</tspan>
        ))}
      </text>
    );
    if (shape === 'diamond') {
      const points = `${cx},${y} ${x + w},${cy} ${cx},${y + h} ${x},${cy}`;
      shapeEl = <polygon points={points} fill={c.fill} stroke={c.stroke} strokeWidth="1.6" />;
    } else {
      const rx = shape === 'pill' ? h / 2 : 6;
      shapeEl = <rect x={x} y={y} width={w} height={h} rx={rx} ry={rx}
                      fill={c.fill} stroke={c.stroke} strokeWidth="1.6" />;
    }
  }

  const hasSub = !isLegend && node.hasSubflow !== false && shape !== 'text' && shape !== 'zone';
  const viewCursor = isLegend ? 'default' : (hasSub ? 'pointer' : 'default');

  const showTooltip = hovered && editorMode && Array.isArray(node.allowedUsers) && node.allowedUsers.length > 0;
  const tooltipText = showTooltip ? node.allowedUsers.join(' · ') : '';
  const tooltipW = Math.max(w, tooltipText.length * 6.5 + 20);
  const tooltipX = x + w / 2 - tooltipW / 2;
  const cx2 = x + w / 2;

  return (
    <g className={'fc-node' + (editorMode ? ' fc-editable' : (hasSub ? ' fc-hoverable' : ''))}
       onMouseDown={onMouseDown} onClick={onClick}
       onMouseEnter={() => setHovered(true)}
       onMouseLeave={() => setHovered(false)}
       style={{ cursor: editorMode ? 'move' : viewCursor, filter: !editable ? 'grayscale(1) opacity(0.45)' : undefined }}>
      {shapeEl}
      {textEl}
      {hasSub && !editorMode && (
        <circle cx={x + w - 9} cy={y + 9} r="4"
                fill={c.stroke} stroke="#fff" strokeWidth="1.5"
                style={{ pointerEvents: 'none' }} />
      )}
      {editorMode && !isLegend && hasSub && (
        <circle cx={x + w - 9} cy={y + 9} r="3.5"
                fill="#fff" stroke={c.stroke} strokeWidth="1.4"
                style={{ pointerEvents: 'none' }} />
      )}
      {node.period && shape !== 'text' && shape !== 'zone' && (
        <text x={x + w - 6} y={y + h - 6}
              textAnchor="end" dominantBaseline="auto"
              fontFamily="ui-sans-serif, system-ui, sans-serif"
              fontSize={node.periodFontSize || 9} fontWeight="600" fill={c.stroke} opacity="0.75"
              style={{ pointerEvents: 'none', userSelect: 'none', letterSpacing: '0.02em' }}>
          {node.period}
        </text>
      )}
      {selected && (
        <rect x={x - 4} y={y - 4} width={w + 8} height={h + 8}
              rx="8" ry="8" fill="none"
              stroke="#1f5dbb" strokeWidth="1.5" strokeDasharray="5 4"
              style={{ pointerEvents: 'none' }} />
      )}
      {showTooltip && (
        <g style={{ pointerEvents: 'none' }}>
          <rect x={tooltipX} y={y - 36} width={tooltipW} height={26}
                rx="5" fill="#1a1a1a" opacity="0.88" />
          <polygon points={`${cx2 - 5},${y - 10} ${cx2 + 5},${y - 10} ${cx2},${y - 4}`}
                   fill="#1a1a1a" opacity="0.88" />
          <text x={cx2} y={y - 23}
                textAnchor="middle" dominantBaseline="middle"
                fontFamily="ui-sans-serif, system-ui, sans-serif"
                fontSize="11" fontWeight="500" fill="#fff"
                style={{ userSelect: 'none' }}>
            {tooltipText}
          </text>
        </g>
      )}
    </g>
  );
}

function ResizeHandles({ node, onResize }) {
  const { x, y, w, h } = node;
  const handles = [
    { id: 'tl', cx: x,       cy: y,       cur: 'nwse-resize' },
    { id: 'tr', cx: x + w,   cy: y,       cur: 'nesw-resize' },
    { id: 'bl', cx: x,       cy: y + h,   cur: 'nesw-resize' },
    { id: 'br', cx: x + w,   cy: y + h,   cur: 'nwse-resize' },
    { id: 't',  cx: x + w/2, cy: y,       cur: 'ns-resize' },
    { id: 'b',  cx: x + w/2, cy: y + h,   cur: 'ns-resize' },
    { id: 'l',  cx: x,       cy: y + h/2, cur: 'ew-resize' },
    { id: 'r',  cx: x + w,   cy: y + h/2, cur: 'ew-resize' },
  ];
  return (
    <g className="fc-resize-handles">
      {handles.map((h) => (
        <rect key={h.id} x={h.cx - 4} y={h.cy - 4} width={8} height={8}
              fill="#fff" stroke="#1f5dbb" strokeWidth="1.5"
              style={{ cursor: h.cur }}
              onMouseDown={(e) => { e.stopPropagation(); onResize(e, h.id); }} />
      ))}
    </g>
  );
}

function Edge({ edge, nodes, editorMode, selected, onClick, connectMode }) {
  const from = nodes[edge.from];
  const to = nodes[edge.to];
  if (!from || !to) return null;
  const fromOffset = edge.fromOffset || 0;
  const toOffset = edge.toOffset || 0;
  const pts = routeEdge(from, to, edge.fromSide || 'r', edge.toSide || 'l', edge.mid, fromOffset, toOffset);
  const d = pointsToPath(pts);
  const mp = edge.label ? midpointOnPath(pts) : null;
  const lines = edge.label ? edge.label.split('\n') : [];
  const stroke = selected ? '#1f5dbb' : '#3a3a3a';
  const fs = edge.labelFontSize || 10;
  const lh = fs * 1.2;
  const cw = fs * 0.64;
  const maxLen = lines.length > 0 ? Math.max(...lines.map(l => l.length)) : 0;
  const pStart = pts[0];
  const pEnd = pts[pts.length - 1];
  return (
    <g className="fc-edge">
      {editorMode && !connectMode && (
        <path d={d} fill="none" stroke="transparent" strokeWidth="14"
              style={{ cursor: 'pointer' }}
              onClick={(e) => { e.stopPropagation(); onClick && onClick(); }} />
      )}
      <path d={d} fill="none" stroke={stroke}
            strokeWidth={selected ? 2.2 : 1.4}
            markerEnd={`url(#fc-arrow${selected ? '-sel' : ''})`}
            style={{ pointerEvents: 'none' }} />
      {/* pontos de ancoragem visíveis quando selecionada */}
      {selected && editorMode && (
        <>
          <circle cx={pStart.x} cy={pStart.y} r="5"
                  fill="#fff" stroke="#1f5dbb" strokeWidth="1.8"
                  style={{ pointerEvents: 'none' }} />
          <circle cx={pEnd.x} cy={pEnd.y} r="5"
                  fill="#1f5dbb" stroke="#fff" strokeWidth="1.5"
                  style={{ pointerEvents: 'none' }} />
        </>
      )}
      {edge.label && (
        <g transform={`translate(${mp.x}, ${mp.y})`} style={{ pointerEvents: 'none' }}>
          <rect x={-maxLen * cw / 2 - 4}
                y={-lines.length * lh / 2 - 2}
                width={maxLen * cw + 8}
                height={lines.length * lh + 4}
                fill="#fafaf7" rx="2" />
          <text textAnchor="middle" dominantBaseline="middle"
                fontFamily="ui-sans-serif, system-ui, sans-serif"
                fontSize={fs} fontWeight="600" fill="#3a3a3a">
            {lines.map((line, i) => (
              <tspan key={i} x={0} dy={i === 0 ? -((lines.length - 1) * lh / 2) : lh}>{line}</tspan>
            ))}
          </text>
        </g>
      )}
    </g>
  );
}

function FlowchartCanvas({
  nodes, edges,
  onNodeClick,
  editorMode = false,
  selectedNodeId, selectedEdgeIdx,
  onSelectNode, onSelectEdge,
  onMoveNode, onResizeNode,
  connectingFromId,
  connectingFromAnchor,
  onFromAnchorPick,
  onToAnchorPick,
  onCancelConnect,
  onUpdateEdgeMid,
  onCanvasMouseDown,
  onDropNode,
  canEditNode,
  initialZoom,
}) {
  const containerRef = React.useRef(null);
  const [view, setView] = React.useState({ x: 0, y: 0, k: initialZoom !== undefined ? initialZoom : 1 });
  const [fitted, setFitted] = React.useState(initialZoom !== undefined);
  const dragRef = React.useRef(null);
  const touchRef = React.useRef(null);
  const nodeMap = React.useMemo(
    () => Object.fromEntries(nodes.map((n) => [n.id, n])),
    [nodes],
  );

  React.useEffect(() => {
    if (initialZoom === undefined) return;
    const applyZoom = () => {
      if (!containerRef.current) return;
      const r = containerRef.current.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return;
      const k = initialZoom;
      const x = (r.width - CANVAS_W * k) / 2;
      const y = (r.height - CANVAS_H * k) / 2;
      setView({ x: Math.round(x), y: Math.round(y), k });
      setFitted(true);
    };
    setTimeout(applyZoom, 200);
    setTimeout(applyZoom, 500);
  }, [initialZoom]);

  React.useEffect(() => {
    if (fitted || !containerRef.current || initialZoom !== undefined) return;
    const r = containerRef.current.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return;
    const margin = 40;
    const k = Math.min((r.width - margin * 2) / CANVAS_W, (r.height - margin * 2) / CANVAS_H);
    const x = (r.width - CANVAS_W * k) / 2;
    const y = (r.height - CANVAS_H * k) / 2;
    setView({ x, y, k });
    setFitted(true);
  }, [fitted, initialZoom]);

  const toWorld = (clientX, clientY) => {
    const r = containerRef.current.getBoundingClientRect();
    return {
      x: (clientX - r.left - view.x) / view.k,
      y: (clientY - r.top  - view.y) / view.k,
    };
  };

  const onWheel = (e) => {
    e.preventDefault();
    const r = containerRef.current.getBoundingClientRect();
    const px = e.clientX - r.left;
    const py = e.clientY - r.top;
    const factor = Math.exp(-e.deltaY * 0.0015);
    const newK = Math.min(4, Math.max(0.15, view.k * factor));
    const wx = (px - view.x) / view.k;
    const wy = (py - view.y) / view.k;
    setView({ k: newK, x: px - wx * newK, y: py - wy * newK });
  };

  const startPan = (e) => {
    if (e.button !== 0) return;
    if (e.target.closest('.fc-node, .fc-resize-handles, .fc-edge')) return;
    if (onCanvasMouseDown) onCanvasMouseDown();
    dragRef.current = { kind: 'pan', sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y };
    document.body.style.cursor = 'grabbing';
  };

  const startNodeDrag = (e, node) => {
    if (e.button !== 0) return;
    if (!editorMode) return;
    if (connectingFromId) return; // em modo conectar, não arrastar
    e.stopPropagation();
    onSelectNode && onSelectNode(node.id);
    const w0 = toWorld(e.clientX, e.clientY);
    dragRef.current = {
      kind: 'move', id: node.id,
      ox: node.x - w0.x, oy: node.y - w0.y,
      startX: e.clientX, startY: e.clientY,
      committed: false,
      moved: false,
    };
  };

  const startResize = (e, node, handle) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const w0 = toWorld(e.clientX, e.clientY);
    dragRef.current = {
      kind: 'resize', id: node.id, handle,
      sx: w0.x, sy: w0.y,
      ox: node.x, oy: node.y, ow: node.w, oh: node.h,
    };
  };

  const onMouseMove = (e) => {
    const d = dragRef.current;
    if (!d) return;
    if (d.kind === 'pan') {
      setView((v) => ({ ...v, x: d.vx + (e.clientX - d.sx), y: d.vy + (e.clientY - d.sy) }));
      return;
    }
    const w = toWorld(e.clientX, e.clientY);
    if (d.kind === 'move') {
      if (!d.committed) {
        const dist = Math.hypot(e.clientX - d.startX, e.clientY - d.startY);
        if (dist < 5) return;
        d.committed = true;
      }
      d.moved = true;
      onMoveNode && onMoveNode(d.id, { x: Math.round(w.x + d.ox), y: Math.round(w.y + d.oy) });
    } else if (d.kind === 'resize') {
      const dx = w.x - d.sx, dy = w.y - d.sy;
      let { ox, oy, ow, oh } = d;
      let nx = ox, ny = oy, nw = ow, nh = oh;
      const minW = 60, minH = 40;
      if (d.handle.includes('l')) { nx = Math.min(ox + ow - minW, ox + dx); nw = ow - (nx - ox); }
      if (d.handle.includes('r')) { nw = Math.max(minW, ow + dx); }
      if (d.handle.includes('t')) { ny = Math.min(oy + oh - minH, oy + dy); nh = oh - (ny - oy); }
      if (d.handle.includes('b')) { nh = Math.max(minH, oh + dy); }
      onResizeNode && onResizeNode(d.id, {
        x: Math.round(nx), y: Math.round(ny),
        w: Math.round(nw), h: Math.round(nh),
      });
    } else if (d.kind === 'edgemid') {
      const val = d.axis === 'x' ? Math.round(w.x) : Math.round(w.y);
      onUpdateEdgeMid && onUpdateEdgeMid(d.edgeIdx, val);
    }
  };
  const onMouseUp = () => {
    dragRef.current = null;
    document.body.style.cursor = '';
  };

  const onTouchStart = (e) => {
    if (e.touches.length === 1) {
      const touch = e.touches[0];
      if (touch.target.closest('.fc-node, .fc-edge')) return;
      if (onCanvasMouseDown) onCanvasMouseDown();
      touchRef.current = {
        kind: 'pan',
        sx: touch.clientX, sy: touch.clientY,
        vx: view.x, vy: view.y,
      };
    } else if (e.touches.length === 2) {
      const dx = e.touches[1].clientX - e.touches[0].clientX;
      const dy = e.touches[1].clientY - e.touches[0].clientY;
      touchRef.current = {
        kind: 'pinch',
        dist: Math.hypot(dx, dy),
        mx: (e.touches[0].clientX + e.touches[1].clientX) / 2,
        my: (e.touches[0].clientY + e.touches[1].clientY) / 2,
        k0: view.k, vx0: view.x, vy0: view.y,
      };
    }
  };
  const onTouchEnd = () => { touchRef.current = null; };

  React.useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const handleTouchMove = (e) => {
      const t = touchRef.current;
      if (!t) return;
      e.preventDefault();
      if (t.kind === 'pan' && e.touches.length === 1) {
        const touch = e.touches[0];
        setView(v => ({ ...v, x: t.vx + (touch.clientX - t.sx), y: t.vy + (touch.clientY - t.sy) }));
      } else if (t.kind === 'pinch' && e.touches.length === 2) {
        const dx = e.touches[1].clientX - e.touches[0].clientX;
        const dy = e.touches[1].clientY - e.touches[0].clientY;
        const dist = Math.hypot(dx, dy);
        const newK = Math.min(4, Math.max(0.15, t.k0 * (dist / t.dist)));
        const r = el.getBoundingClientRect();
        const px = t.mx - r.left, py = t.my - r.top;
        const wx = (px - t.vx0) / t.k0, wy = (py - t.vy0) / t.k0;
        setView({ k: newK, x: px - wx * newK, y: py - wy * newK });
      }
    };
    el.addEventListener('touchmove', handleTouchMove, { passive: false });
    return () => el.removeEventListener('touchmove', handleTouchMove);
  }, []);

  const fit = () => setFitted(false);
  const zoomBy = (f) => {
    const r = containerRef.current.getBoundingClientRect();
    const px = r.width / 2, py = r.height / 2;
    const newK = Math.min(4, Math.max(0.15, view.k * f));
    const wx = (px - view.x) / view.k;
    const wy = (py - view.y) / view.k;
    setView({ k: newK, x: px - wx * newK, y: py - wy * newK });
  };

  const handleNodeClick = (node, e) => {
    const wasMoved = dragRef.current && dragRef.current.moved;
    if (wasMoved) return;
    if (connectingFromId) return; // cliques são tratados pelos anchors
    if (editorMode) {
      onSelectNode && onSelectNode(node.id);
      return;
    }
    onNodeClick && onNodeClick(node);
  };

  const selectedNode = nodes.find((n) => n.id === selectedNodeId);

  const onDragOver = (e) => {
    if (!editorMode) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  };
  const onDrop = (e) => {
    if (!editorMode) return;
    e.preventDefault();
    const shape = e.dataTransfer.getData('fc-shape');
    const color = e.dataTransfer.getData('fc-color');
    if (!shape) return;
    const w = toWorld(e.clientX, e.clientY);
    onDropNode && onDropNode(shape, color, w.x, w.y);
  };

  return (
    <div ref={containerRef}
         className={'fc-container' + (connectingFromId ? ' fc-connect' : '')}
         onWheel={onWheel}
         onMouseDown={startPan}
         onMouseMove={onMouseMove}
         onMouseUp={onMouseUp}
         onMouseLeave={onMouseUp}
         onTouchStart={onTouchStart}
         onTouchEnd={onTouchEnd}
         onDragOver={onDragOver}
         onDrop={onDrop}>
      <svg width="100%" height="100%" style={{ display: 'block' }}>
        <defs>
          <marker id="fc-arrow" viewBox="0 0 10 10" refX="9" refY="5"
                  markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#3a3a3a" />
          </marker>
          <marker id="fc-arrow-sel" viewBox="0 0 10 10" refX="9" refY="5"
                  markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#1f5dbb" />
          </marker>
          <pattern id="fc-grid" width="40" height="40" patternUnits="userSpaceOnUse">
            <circle cx="1" cy="1" r="1" fill="rgba(0,0,0,0.05)" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#fc-grid)" />
        <g transform={`translate(${view.x}, ${view.y}) scale(${view.k})`}>
          <rect x={-20} y={-20} width={CANVAS_W + 40} height={CANVAS_H + 40}
                fill="rgba(255,255,255,0.5)" stroke="rgba(0,0,0,0.06)" strokeWidth="1" rx="12" />
          {/* Zones first — behind edges and nodes */}
          {nodes.filter((n) => n.shape === 'zone').map((n) => (
            <NodeShape key={n.id} node={n}
                       selected={selectedNodeId === n.id || connectingFromId === n.id}
                       editorMode={editorMode}
                       onMouseDown={(e) => startNodeDrag(e, n)}
                       onClick={(e) => handleNodeClick(n, e)} />
          ))}
          {edges.map((e, i) => (
            <Edge key={i} edge={e} nodes={nodeMap}
                  editorMode={editorMode}
                  connectMode={!!connectingFromId}
                  selected={selectedEdgeIdx === i}
                  onClick={() => onSelectEdge && onSelectEdge(i)} />
          ))}
          {nodes.filter((n) => n.shape !== 'zone').map((n) => {
            const hasSub = !n.isLegend && n.hasSubflow !== false && n.shape !== 'text';
            const editable = !hasSub || !canEditNode || canEditNode(n);
            return (
              <NodeShape key={n.id} node={n}
                         selected={selectedNodeId === n.id || connectingFromId === n.id}
                         editorMode={editorMode}
                         editable={editable}
                         onMouseDown={(e) => startNodeDrag(e, n)}
                         onClick={(e) => handleNodeClick(n, e)} />
            );
          })}
          {editorMode && selectedNode && !connectingFromId && (
            <ResizeHandles node={selectedNode}
                           onResize={(e, h) => startResize(e, selectedNode, h)} />
          )}

          {/* Handle de cotovelo para seta selecionada */}
          {editorMode && selectedEdgeIdx != null && !connectingFromId && edges[selectedEdgeIdx] && (
            <EdgeMidHandle
              edge={edges[selectedEdgeIdx]}
              nodes={nodeMap}
              onDragStart={(e, axis) => {
                e.stopPropagation();
                dragRef.current = { kind: 'edgemid', edgeIdx: selectedEdgeIdx, axis };
              }}
              onReset={() => onUpdateEdgeMid && onUpdateEdgeMid(selectedEdgeIdx, undefined)}
            />
          )}

          {/* Fase 1: anchors no nó origem */}
          {connectingFromId && !connectingFromAnchor && nodeMap[connectingFromId] && (
            <SourceAnchors node={nodeMap[connectingFromId]}
                           onAnchorClick={(side, offset) => onFromAnchorPick && onFromAnchorPick(side, offset)} />
          )}

          {/* Fase 2: anchors nos nós destino (aparecem no hover) */}
          {connectingFromId && connectingFromAnchor && nodes
            .filter((n) => n.id !== connectingFromId && !n.isLegend && n.shape !== 'zone')
            .map((n) => (
              <TargetAnchors key={n.id} node={n}
                             onAnchorClick={(side, offset) => onToAnchorPick && onToAnchorPick(n.id, side, offset)} />
            ))
          }
        </g>
      </svg>

      <div className="fc-controls">
        <button onClick={() => zoomBy(1.2)} title="Zoom in">+</button>
        <button onClick={() => zoomBy(1 / 1.2)} title="Zoom out">−</button>
        <button onClick={fit} title="Enquadrar">⤢</button>
        <div className="fc-zoom-label">{Math.round(view.k * 100)}%</div>
      </div>
      {connectingFromId && (
        <div className="fc-connect-banner">
          {!connectingFromAnchor
            ? <>Clique em qual ponto a seta deve <b style={{ margin: '0 3px' }}>sair</b> desta caixa</>
            : <>Passe o mouse sobre a caixa destino e clique onde a seta deve <b style={{ margin: '0 3px' }}>chegar</b></>
          }
          {' · '}
          <button onClick={() => onCancelConnect && onCancelConnect()}>Cancelar</button>
        </div>
      )}
    </div>
  );
}

window.FlowchartCanvas = FlowchartCanvas;
window.NodeShape = NodeShape;
window.NODE_COLORS = NODE_COLORS;
