// flowchart-app.jsx
// App principal: header, editor, canvas, inspector, modal e publish.

const { FlowchartCanvas, NodeModal, NODE_COLORS } = window;
const LIVE_DOC = window.__LIVE_DOC__ || null;
const { NODES: SEED_NODES, EDGES: SEED_EDGES } = window.FLOWCHART;

const PUBLISHED_SLUG = window.__PUBLISHED_SLUG__ || null;

const TITLE_FONTS = [
  { value: '',        label: 'Sans-serif (padrão)',  css: 'ui-sans-serif, system-ui, sans-serif' },
  { value: 'serif',   label: 'Serif',                css: 'ui-serif, Georgia, serif' },
  { value: 'georgia', label: 'Georgia',              css: 'Georgia, serif' },
  { value: 'mono',    label: 'Monospace',            css: 'ui-monospace, monospace' },
  { value: 'impact',  label: 'Impact',               css: "Impact, 'Arial Black', sans-serif" },
];
function titleFontCss(fontKey) {
  return TITLE_FONTS.find(f => f.value === fontKey)?.css || 'ui-sans-serif, system-ui, sans-serif';
}

const DEFAULT_LEGEND = [
  { id: 'leg1', label: 'Captação',     color: '#dbeaff', stroke: '#1f5dbb', shape: 'rect' },
  { id: 'leg2', label: 'Pós-reunião',  color: '#c7e7c4', stroke: '#3d8c4d', shape: 'rect' },
  { id: 'leg3', label: 'Pós-contrato', color: '#fde0c7', stroke: '#c97639', shape: 'rect' },
  { id: 'leg4', label: 'Decisão',      color: '#fff2a8', stroke: '#caa628', shape: 'diamond' },
];
const DEFAULT_LEGEND_CONFIG = { style: 'chip', fontSize: 13, fontFamily: '', align: 'center', gap: 20, opacity: 100, coverOpacity: 100 };
const CURRENT_USER   = window.__CURRENT_USER__   || null;
const IS_ADMIN       = CURRENT_USER?.isAdmin      || false;
const SIMULATE_AS    = window.__SIMULATE_AS__    || null;

function canEditNode(node) {
  if (IS_ADMIN) return true;
  if (!node) return false;
  if (node.allowedUsers === null) return true;          // explicitamente aberto
  if (!node.allowedUsers || node.allowedUsers.length === 0) return false; // padrão: só admins
  return CURRENT_USER && node.allowedUsers.includes(CURRENT_USER.email);
}

function toSlug(str) {
  return (str || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 60);
}

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "popupStyle": "modal",
  "showLabels": true
}/*EDITMODE-END*/;

const DOC_KEY = 'fluxograma:doc:v2';

function loadDoc() {
  try {
    const raw = localStorage.getItem(DOC_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (e) { return null; }
}
function saveDoc(doc) {
  try { localStorage.setItem(DOC_KEY, JSON.stringify(doc)); } catch (e) {}
}

function uid(prefix = 'n') {
  return prefix + '_' + Math.random().toString(36).slice(2, 8);
}

// ─── Painel de simulação de usuário (admin)
function SimulatePanel({ onClose }) {
  const [users, setUsers] = React.useState([]);
  const [admins, setAdmins] = React.useState([]);
  const [selected, setSelected] = React.useState(null);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    fetch('/api/users')
      .then(r => r.json())
      .then(d => {
        if (d.ok) { setUsers(d.data.users); setAdmins(d.data.admins); }
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const simulate = () => {
    if (!selected) return;
    window.open('/?simulate_as=' + encodeURIComponent(selected), '_blank');
    onClose();
  };

  return (
    <div className="sf-modal-overlay" onClick={onClose}>
      <div className="sf-modal" style={{ maxWidth: 400 }} onClick={e => e.stopPropagation()}>
        <button className="sf-close" onClick={onClose}>×</button>
        <div className="sf-header">
          <div className="sf-eyebrow" style={{ color: '#c97639' }}>ADMINISTRAÇÃO</div>
          <h2 className="sf-title" style={{ fontSize: 20, marginBottom: 4 }}>Simular usuário</h2>
          <p className="sf-sub">Abre uma nova janela com a visão do usuário selecionado, sem afetar sua sessão atual.</p>
        </div>

        {loading && <div style={{ padding: '20px 32px', color: '#6b6b66' }}>Carregando…</div>}

        {!loading && (
          <div style={{ padding: '0 32px 28px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 20, maxHeight: 260, overflowY: 'auto' }}>
              {users.map(u => (
                <label key={u.email} style={{
                  display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px',
                  borderRadius: 7, cursor: 'pointer',
                  background: selected === u.email ? '#dbeaff' : '#fafaf9',
                  border: '1.5px solid ' + (selected === u.email ? '#1f5dbb' : 'rgba(0,0,0,0.08)'),
                  transition: 'border-color 0.12s, background 0.12s',
                }}>
                  <input type="radio" name="sim-user" value={u.email}
                         checked={selected === u.email}
                         onChange={() => setSelected(u.email)}
                         style={{ accentColor: '#1f5dbb', flexShrink: 0 }} />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{u.name}</div>
                    <div style={{ fontSize: 11, color: '#6b6b66', display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
                      {u.email}
                      {admins.includes(u.email) && (
                        <span style={{ fontSize: 10, background: '#1f5dbb', color: '#fff', borderRadius: 3, padding: '1px 5px' }}>ADMIN</span>
                      )}
                    </div>
                  </div>
                </label>
              ))}
              {users.length === 0 && (
                <p style={{ fontSize: 13, color: '#6b6b66', margin: 0 }}>Nenhum usuário cadastrado.</p>
              )}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, borderTop: '1px solid rgba(0,0,0,0.08)', paddingTop: 16 }}>
              <button className="btn-ghost" onClick={onClose}>Cancelar</button>
              <button className="btn-primary" onClick={simulate} disabled={!selected}>
                Simular →
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Painel de gerenciamento de usuários (admin)
function UserPanel({ onClose, onSaved }) {
  const [data, setData] = React.useState({ admins: [], users: [] });
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState(null);
  const [newAdminEmail, setNewAdminEmail] = React.useState('');
  const [newUserEmail, setNewUserEmail] = React.useState('');
  const [newUserName, setNewUserName] = React.useState('');

  React.useEffect(() => {
    fetch('/api/users')
      .then(r => r.json())
      .then(d => { if (d.ok) setData(d.data); setLoading(false); })
      .catch(() => { setError('Erro ao carregar usuários.'); setLoading(false); });
  }, []);

  const save = () => {
    setSaving(true); setError(null);
    fetch('/api/users/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
      .then(r => r.json())
      .then(d => {
        setSaving(false);
        if (d.ok) { onSaved && onSaved(data); onClose(); }
        else setError(d.error || 'Erro ao salvar.');
      })
      .catch(() => { setSaving(false); setError('Erro de conexão.'); });
  };

  const addAdmin = () => {
    const email = newAdminEmail.trim().toLowerCase();
    if (!email || !email.includes('@')) return;
    if (data.admins.includes(email)) return;
    setData(d => ({
      ...d,
      admins: [...d.admins, email],
      users: d.users.some(u => u.email === email) ? d.users : [...d.users, { email, name: email.split('@')[0] }],
    }));
    setNewAdminEmail('');
  };

  const removeAdmin = (email) => setData(d => ({ ...d, admins: d.admins.filter(a => a !== email) }));

  const addUser = () => {
    const email = newUserEmail.trim().toLowerCase();
    if (!email || !email.includes('@')) return;
    if (data.users.some(u => u.email === email)) return;
    const name = newUserName.trim() || email.split('@')[0];
    setData(d => ({ ...d, users: [...d.users, { email, name }] }));
    setNewUserEmail(''); setNewUserName('');
  };

  const removeUser = (email) => setData(d => ({ ...d, users: d.users.filter(u => u.email !== email) }));

  const inp = { border: '1px solid rgba(0,0,0,0.15)', borderRadius: 6, padding: '7px 10px', font: '13px/1.4 inherit', outline: 0, flex: 1, minWidth: 0 };

  return (
    <div className="sf-modal-overlay" onClick={onClose}>
      <div className="sf-modal" style={{ maxWidth: 540 }} onClick={e => e.stopPropagation()}>
        <button className="sf-close" onClick={onClose}>×</button>
        <div className="sf-header">
          <div className="sf-eyebrow" style={{ color: '#1f5dbb' }}>ADMINISTRAÇÃO</div>
          <h2 className="sf-title" style={{ fontSize: 20, marginBottom: 4 }}>Gerenciar Usuários</h2>
          <p className="sf-sub">Administradores têm acesso total. Usuários editam sub-fluxos apenas das caixas autorizadas.</p>
        </div>

        {loading && <div style={{ padding: '20px 32px', color: '#6b6b66' }}>Carregando…</div>}
        {error && <div style={{ padding: '0 32px 12px', color: '#a52828', fontSize: 13 }}>{error}</div>}

        {!loading && (
          <div style={{ padding: '0 32px 28px' }}>
            <div style={{ marginBottom: 24 }}>
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#1f5dbb', marginBottom: 10 }}>
                Administradores
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 10 }}>
                {data.admins.map(email => (
                  <div key={email} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 10px', background: '#eef3ff', borderRadius: 6 }}>
                    <span style={{ fontSize: 13 }}>{email}</span>
                    <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#a52828', fontSize: 18, padding: '0 4px', lineHeight: 1 }}
                            onClick={() => removeAdmin(email)} title="Remover">×</button>
                  </div>
                ))}
                {data.admins.length === 0 && <p style={{ fontSize: 12, color: '#a52828', margin: 0 }}>Sem administradores — próximo login vira admin automaticamente.</p>}
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <input type="email" value={newAdminEmail} onChange={e => setNewAdminEmail(e.target.value)}
                       placeholder="email@empresa.com" style={inp}
                       onKeyDown={e => { if (e.key === 'Enter') addAdmin(); }} />
                <button className="btn-primary" style={{ height: 34, padding: '0 14px', fontSize: 13, flexShrink: 0 }} onClick={addAdmin}>+ Adicionar</button>
              </div>
            </div>

            <div>
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#3d8c4d', marginBottom: 10 }}>
                Usuários
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 10, maxHeight: 200, overflowY: 'auto' }}>
                {data.users.map(u => (
                  <div key={u.email} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 10px', background: '#f4faf4', borderRadius: 6 }}>
                    <span style={{ fontSize: 13, minWidth: 0 }}>
                      <b>{u.name}</b>
                      <span style={{ color: '#6b6b66', marginLeft: 5 }}>({u.email})</span>
                      {data.admins.includes(u.email) && (
                        <span style={{ fontSize: 10, background: '#1f5dbb', color: '#fff', borderRadius: 3, padding: '1px 5px', marginLeft: 6 }}>ADMIN</span>
                      )}
                    </span>
                    <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#a52828', fontSize: 18, padding: '0 4px', lineHeight: 1, flexShrink: 0 }}
                            onClick={() => removeUser(u.email)} title="Remover">×</button>
                  </div>
                ))}
                {data.users.length === 0 && <p style={{ fontSize: 12, color: '#6b6b66', margin: 0 }}>Nenhum usuário cadastrado.</p>}
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <input type="email" value={newUserEmail} onChange={e => setNewUserEmail(e.target.value)}
                       placeholder="email@empresa.com" style={inp}
                       onKeyDown={e => { if (e.key === 'Enter') document.getElementById('up-name').focus(); }} />
                <input id="up-name" type="text" value={newUserName} onChange={e => setNewUserName(e.target.value)}
                       placeholder="Nome (opcional)" style={{ ...inp, maxWidth: 150 }}
                       onKeyDown={e => { if (e.key === 'Enter') addUser(); }} />
                <button className="btn-primary" style={{ height: 34, padding: '0 14px', fontSize: 13, flexShrink: 0 }} onClick={addUser}>+ Adicionar</button>
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 24, borderTop: '1px solid rgba(0,0,0,0.08)', paddingTop: 16 }}>
              <button className="btn-ghost" onClick={onClose}>Cancelar</button>
              <button className="btn-primary" onClick={save} disabled={saving}>
                {saving ? 'Salvando…' : 'Salvar alterações'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Tela "Publicar"
function PublishDialog({ onClose, nodes, edges, docTitle, flowTitle, flowLogo, flowTitleFont, flowTitleSize, legend, legendConfig, lastSlug, onPublished }) {
  const [name, setName] = React.useState(lastSlug || '');
  const [step, setStep] = React.useState('confirm');
  const [pubLink, setPubLink] = React.useState('');
  const [copied, setCopied] = React.useState(false);
  const [error, setError] = React.useState(null);

  const slug = toSlug(name);
  const previewUrl = slug ? `${window.location.origin}/${slug}` : '';
  const isUpdate = lastSlug && lastSlug === slug;

  const publish = () => {
    if (!slug) return;
    setStep('publishing');
    setError(null);
    let subflows = {};
    try { subflows = JSON.parse(localStorage.getItem('fluxograma:subflows:v1') || '{}'); } catch (e) {}
    fetch('/api/publish/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug, data: { nodes, edges, title: docTitle, flowTitle, flowLogo, flowTitleFont, flowTitleSize, legend, legendConfig, subflows } }),
    })
      .then((r) => r.json())
      .then((d) => {
        if (d.ok) {
          setPubLink(`${window.location.origin}/${slug}`);
          setStep('done');
          onPublished && onPublished(slug);
        } else {
          setError(d.error || 'Erro ao publicar.');
          setStep('confirm');
        }
      })
      .catch(() => { setError('Erro de conexão com o servidor.'); setStep('confirm'); });
  };

  const copy = () => {
    navigator.clipboard?.writeText(pubLink);
    setCopied(true); setTimeout(() => setCopied(false), 2000);
  };

  const inputStyle = { border: '1px solid rgba(0,0,0,0.15)', borderRadius: 6, padding: '8px 10px', font: '14px/1.4 inherit', outline: 0, width: '100%', boxSizing: 'border-box' };

  return (
    <div className="sf-modal-overlay" onClick={onClose}>
      <div className="sf-modal pub-modal" onClick={(e) => e.stopPropagation()}>
        <button className="sf-close" onClick={onClose} aria-label="Fechar">×</button>

        {step === 'confirm' && (
          <>
            <div className="sf-eyebrow" style={{ color: '#1f5dbb' }}>PUBLICAR FLUXOGRAMA</div>
            <h2 className="sf-title">Publicar como link compartilhável</h2>
            <p className="sf-sub">
              Quem acessar o link pode visualizar o fluxo e sub-fluxos, mas não editar.
              Publicar com o mesmo nome <b>atualiza</b> o link existente.
            </p>

            <div style={{ margin: '18px 0' }}>
              <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#6b6b66', marginBottom: 6 }}>
                Nome do fluxo (define a URL)
              </div>
              <input type="text" value={name} onChange={(e) => setName(e.target.value)}
                     placeholder="Ex: Fluxo Cliente, Jornada Comercial"
                     style={inputStyle} autoFocus />
              <div style={{ marginTop: 8, minHeight: 22, fontSize: 12, color: slug ? '#3a3a3a' : '#aaa' }}>
                {slug
                  ? <>URL: <code style={{ background: '#eef3ff', padding: '2px 6px', borderRadius: 3 }}>{window.location.origin}/<b>{slug}</b></code></>
                  : 'Digite um nome para gerar a URL'}
              </div>
            </div>

            <div className="pub-meta">
              <div><span>Etapas</span><b>{nodes.filter((n) => !n.isLegend).length}</b></div>
              <div><span>Conexões</span><b>{edges.length}</b></div>
              <div><span>Sub-fluxos</span><b>{Object.keys(JSON.parse(localStorage.getItem('fluxograma:subflows:v1') || '{}')).length}</b></div>
            </div>

            {error && <p style={{ color: '#a52828', fontSize: 13, margin: '8px 0 0' }}>{error}</p>}

            <div className="pub-actions">
              <button className="btn-ghost" onClick={onClose}>Cancelar</button>
              <button className="btn-primary" onClick={publish} disabled={!slug}>
                {isUpdate ? '↺ Atualizar publicação' : 'Publicar fluxograma'}
              </button>
            </div>
          </>
        )}

        {step === 'publishing' && (
          <div className="pub-loading">
            <div className="pub-spinner" />
            <h2 className="sf-title">Publicando…</h2>
            <p className="sf-sub">Salvando fluxo e gerando link.</p>
          </div>
        )}

        {step === 'done' && (
          <>
            <div className="sf-eyebrow" style={{ color: '#3d8c4d' }}>✓ {isUpdate ? 'ATUALIZADO' : 'PUBLICADO'}</div>
            <h2 className="sf-title">Fluxo {isUpdate ? 'atualizado' : 'publicado'} com sucesso</h2>
            <p className="sf-sub">Compartilhe o link abaixo. Para atualizar o conteúdo, publique novamente com o mesmo nome.</p>
            <div className="pub-link">
              <input readOnly value={pubLink} onFocus={(e) => e.target.select()} />
              <button className="btn-primary" onClick={copy}>{copied ? 'Copiado!' : 'Copiar link'}</button>
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 14 }}>
              <a href={pubLink} target="_blank" rel="noreferrer"
                 style={{ textDecoration: 'none' }} className="btn-ghost">Abrir link ↗</a>
              <button className="btn-ghost" onClick={onClose}>Fechar</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Inspector lateral (modo editor, nó selecionado)
function NodeInspector({ node, onChange, onDelete, onConnect, onEditSubflow, onDuplicate, onClose, userList }) {
  if (!node) return null;
  const SHAPES = [
    { v: 'rect', l: 'Retângulo' },
    { v: 'pill', l: 'Pílula' },
    { v: 'diamond', l: 'Diamante' },
    { v: 'text', l: 'Texto' },
    { v: 'zone', l: 'Área' },
  ];
  const COLORS = ['blue', 'green', 'orange', 'yellow', 'black'];
  const isDecorative = node.shape === 'text' || node.shape === 'zone';
  // isLegend nodes default to no-subflow (they're decorative labels)
  const hasSub = !node.isLegend && node.hasSubflow !== false && !isDecorative;
  const tfs = node.fontSize || (node.shape === 'zone' ? 12 : 14);
  return (
    <div className="inspector">
      <div className="inspector-hd">
        <b>Editar caixa</b>
        <button onClick={onClose} aria-label="Fechar">×</button>
      </div>
      <div className="inspector-body">
        <label className="ins-row">
          <span>Texto</span>
          <textarea value={node.label} rows="4"
                    onChange={(e) => onChange({ label: e.target.value })}
                    placeholder="Nome da etapa (use Enter para quebrar linha)" />
        </label>

        {!isDecorative && (
          <div className="ins-row">
            <span>Período</span>
            <input value={node.period || ''} onChange={(e) => onChange({ period: e.target.value })}
                   placeholder="Ex: 2 dias, 1 semana..." style={{ marginBottom: 6 }} />
            {node.period && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 11, color: 'var(--ink-mute)' }}>Tamanho</span>
                <button className="btn-ghost"
                        style={{ width: 30, padding: 0, fontSize: 13, fontWeight: 700 }}
                        onClick={() => onChange({ periodFontSize: Math.max(7, (node.periodFontSize || 9) - 1) })}>A−</button>
                <span style={{ minWidth: 30, textAlign: 'center', fontSize: 12, fontVariantNumeric: 'tabular-nums' }}>
                  {node.periodFontSize || 9}px
                </span>
                <button className="btn-ghost"
                        style={{ width: 30, padding: 0, fontSize: 13, fontWeight: 700 }}
                        onClick={() => onChange({ periodFontSize: Math.min(20, (node.periodFontSize || 9) + 1) })}>A+</button>
              </div>
            )}
          </div>
        )}

        {(node.shape === 'text' || node.shape === 'zone') && (
          <div className="ins-row">
            <span>Tamanho da fonte</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
              <button className="btn-ghost"
                      style={{ width: 38, padding: 0, fontSize: 14, fontWeight: 700 }}
                      onClick={() => onChange({ fontSize: Math.max(8, tfs - 1) })}>A−</button>
              <span style={{ minWidth: 36, textAlign: 'center', fontSize: 13, fontVariantNumeric: 'tabular-nums' }}>{tfs}px</span>
              <button className="btn-ghost"
                      style={{ width: 38, padding: 0, fontSize: 14, fontWeight: 700 }}
                      onClick={() => onChange({ fontSize: Math.min(72, tfs + 1) })}>A+</button>
            </div>
          </div>
        )}

        {node.shape === 'zone' && (
          <div className="ins-row">
            <span>Alinhamento do texto</span>
            <div className="ins-segments" style={{ marginTop: 4 }}>
              {[{ v: 'left', l: '⬛ Esq.' }, { v: 'center', l: '≡ Centro' }, { v: 'right', l: 'Dir. ⬛' }].map((a) => (
                <button key={a.v}
                        className={(node.textAlign || 'left') === a.v ? 'on' : ''}
                        onClick={() => onChange({ textAlign: a.v })}>{a.l}</button>
              ))}
            </div>
          </div>
        )}

        <label className="ins-row">
          <span>Forma</span>
          <div className="ins-segments">
            {SHAPES.map((s) => (
              <button key={s.v}
                      className={node.shape === s.v ? 'on' : ''}
                      onClick={() => onChange({ shape: s.v })}>{s.l}</button>
            ))}
          </div>
        </label>

        <label className="ins-row">
          <span>Cor</span>
          <div className="ins-colors">
            {COLORS.map((c) => {
              const col = NODE_COLORS[c];
              return (
                <button key={c} title={c}
                        className={'ins-color' + (node.color === c ? ' on' : '')}
                        style={{ background: col.fill, borderColor: col.stroke }}
                        onClick={() => onChange({ color: c })} />
              );
            })}
          </div>
        </label>

        <div className="ins-row ins-2col">
          <label><span>Largura</span>
            <input type="number" value={node.w} min="60" step="10"
                   onChange={(e) => onChange({ w: Number(e.target.value) })} />
          </label>
          <label><span>Altura</span>
            <input type="number" value={node.h} min="40" step="10"
                   onChange={(e) => onChange({ h: Number(e.target.value) })} />
          </label>
        </div>
        <div className="ins-row ins-2col">
          <label><span>X</span>
            <input type="number" value={node.x} step="10"
                   onChange={(e) => onChange({ x: Number(e.target.value) })} />
          </label>
          <label><span>Y</span>
            <input type="number" value={node.y} step="10"
                   onChange={(e) => onChange({ y: Number(e.target.value) })} />
          </label>
        </div>

        {!isDecorative && !node.isLegend && (
          <div className="ins-subflow">
            <label className="ins-check">
              <input type="checkbox" checked={hasSub}
                     onChange={(e) => onChange({ hasSubflow: e.target.checked })} />
              <span><b>Esta caixa abre um sub-fluxo</b><br/>
                <em>Ao clicar (modo visualização) abrirá o popup com o sub-fluxograma.</em></span>
            </label>
            {hasSub && (
              <button className="btn-primary ins-subflow-btn" onClick={onEditSubflow}>
                ✎ Editar sub-fluxo
              </button>
            )}
          </div>
        )}

        {IS_ADMIN && !isDecorative && (
          <div className="ins-row">
            <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: '#6b6b66', marginBottom: 8 }}>
              Permissões de edição
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer',
                            padding: '7px 10px', borderRadius: 7, marginBottom: 4,
                            background: node.allowedUsers === null ? '#dbeaff' : '#f5f5f3',
                            border: `1.5px solid ${node.allowedUsers === null ? '#1f5dbb' : 'rgba(0,0,0,0.08)'}` }}>
              <input type="checkbox"
                     checked={node.allowedUsers === null}
                     onChange={(e) => onChange({ allowedUsers: e.target.checked ? null : [] })} />
              <span style={{ fontSize: 12.5, fontWeight: 600, color: node.allowedUsers === null ? '#1f5dbb' : '#3a3a3a' }}>
                Todos os usuários podem editar
              </span>
            </label>
            {Array.isArray(node.allowedUsers) && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginTop: 2 }}>
                {(userList?.users || []).filter(u => !userList.admins?.includes(u.email)).map(u => {
                  const checked = node.allowedUsers.includes(u.email);
                  return (
                    <label key={u.email} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer',
                                                  padding: '6px 10px', borderRadius: 7,
                                                  background: checked ? '#f0fff4' : '#f5f5f3',
                                                  border: `1.5px solid ${checked ? '#3d8c4d' : 'rgba(0,0,0,0.08)'}` }}>
                      <input type="checkbox" checked={checked}
                             onChange={(e) => {
                               const next = e.target.checked
                                 ? [...node.allowedUsers, u.email]
                                 : node.allowedUsers.filter(em => em !== u.email);
                               onChange({ allowedUsers: next });
                             }} />
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 12.5, fontWeight: 600, color: checked ? '#2d6e3d' : '#3a3a3a',
                                      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {u.name || u.email}
                        </div>
                        <div style={{ fontSize: 11, color: '#8a8a8a', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {u.email}
                        </div>
                      </div>
                    </label>
                  );
                })}
                {(userList?.users || []).filter(u => !userList.admins?.includes(u.email)).length === 0 && (
                  <p style={{ fontSize: 12, color: '#6b6b66', margin: 0, padding: '4px 2px' }}>Nenhum usuário além dos admins.</p>
                )}
              </div>
            )}
          </div>
        )}

        <div className="ins-actions">
          <button className="btn-ghost" onClick={() => onConnect(node.id)}>↳ Conectar a outra caixa</button>
          <button className="btn-ghost" onClick={onDuplicate}>⧉ Duplicar caixa &nbsp;<span style={{ fontSize: 11, opacity: 0.6 }}>Ctrl+D</span></button>
          <button className="btn-danger" onClick={() => onDelete(node.id)}>🗑  Excluir caixa</button>
        </div>
      </div>
    </div>
  );
}

// ─── Inspector de seta selecionada
function EdgeInspector({ edge, idx, onChange, onDelete, onClose }) {
  if (!edge) return null;
  const SIDES = [
    { v: 't', l: 'Topo' }, { v: 'r', l: 'Direita' },
    { v: 'b', l: 'Base' }, { v: 'l', l: 'Esquerda' },
  ];
  const fs = edge.labelFontSize || 10;
  return (
    <div className="inspector">
      <div className="inspector-hd">
        <b>Editar conexão</b>
        <button onClick={onClose} aria-label="Fechar">×</button>
      </div>
      <div className="inspector-body">
        <label className="ins-row">
          <span>Label da seta</span>
          <textarea value={edge.label || ''} rows="3"
                    onChange={(e) => onChange({ label: e.target.value || undefined })}
                    placeholder="Ex: SIM, NÃO, prazo..." />
        </label>
        <div className="ins-row">
          <span>Tamanho da fonte</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
            <button className="btn-ghost"
                    style={{ width: 38, padding: 0, fontSize: 14, fontWeight: 700 }}
                    onClick={() => onChange({ labelFontSize: Math.max(7, fs - 1) })}>A−</button>
            <span style={{ minWidth: 36, textAlign: 'center', fontSize: 13, fontVariantNumeric: 'tabular-nums' }}>{fs}px</span>
            <button className="btn-ghost"
                    style={{ width: 38, padding: 0, fontSize: 14, fontWeight: 700 }}
                    onClick={() => onChange({ labelFontSize: Math.min(30, fs + 1) })}>A+</button>
          </div>
        </div>
        <div className="ins-row ins-2col">
          <label><span>Sai por</span>
            <select value={edge.fromSide || 'r'} onChange={(e) => onChange({ fromSide: e.target.value })}>
              {SIDES.map(s => <option key={s.v} value={s.v}>{s.l}</option>)}
            </select>
          </label>
          <label><span>Entra por</span>
            <select value={edge.toSide || 'l'} onChange={(e) => onChange({ toSide: e.target.value })}>
              {SIDES.map(s => <option key={s.v} value={s.v}>{s.l}</option>)}
            </select>
          </label>
        </div>
        <div className="ins-row">
          <span>Ponto de saída &nbsp;
            <span style={{ fontWeight: 400, color: 'var(--primary)' }}>
              {edge.fromOffset ? `${edge.fromOffset > 0 ? '+' : ''}${Math.round(edge.fromOffset * 100)}%` : 'centro'}
            </span>
          </span>
          <input type="range" min="-100" max="100" step="5"
                 value={Math.round((edge.fromOffset || 0) * 100)}
                 onChange={(e) => onChange({ fromOffset: Number(e.target.value) / 100 || undefined })}
                 style={{ width: '100%', accentColor: 'var(--primary)', marginTop: 4 }} />
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--ink-mute)', marginTop: 2 }}>
            <span>topo / esq.</span><span>centro</span><span>base / dir.</span>
          </div>
        </div>
        <div className="ins-row">
          <span>Ponto de entrada &nbsp;
            <span style={{ fontWeight: 400, color: 'var(--primary)' }}>
              {edge.toOffset ? `${edge.toOffset > 0 ? '+' : ''}${Math.round(edge.toOffset * 100)}%` : 'centro'}
            </span>
          </span>
          <input type="range" min="-100" max="100" step="5"
                 value={Math.round((edge.toOffset || 0) * 100)}
                 onChange={(e) => onChange({ toOffset: Number(e.target.value) / 100 || undefined })}
                 style={{ width: '100%', accentColor: 'var(--primary)', marginTop: 4 }} />
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--ink-mute)', marginTop: 2 }}>
            <span>topo / esq.</span><span>centro</span><span>base / dir.</span>
          </div>
        </div>
        <div className="ins-actions">
          {edge.mid != null && (
            <button className="btn-ghost" onClick={() => onChange({ mid: undefined })}>
              ↺ Resetar caminho (automático)
            </button>
          )}
          <button className="btn-danger" onClick={() => onDelete(idx)}>🗑  Excluir conexão</button>
        </div>
      </div>
    </div>
  );
}

// ─── Painel de Solicitações de Acesso (admin)
function RequestsPanel({ onClose, onResolve }) {
  const [requests, setRequests] = React.useState([]);
  const [loading, setLoading]   = React.useState(true);
  const [resolving, setResolving] = React.useState(null);

  const load = () => {
    setLoading(true);
    fetch('/api/access-requests')
      .then(r => r.json())
      .then(d => { setRequests(d.requests || []); setLoading(false); })
      .catch(() => setLoading(false));
  };

  React.useEffect(() => { load(); }, []);

  const resolve = async (id, status) => {
    setResolving(id);
    await fetch('/api/access-request/resolve', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, status }),
    });
    setRequests(prev => prev.filter(r => r.id !== id));
    setResolving(null);
    onResolve();
  };

  return (
    <div className="sf-modal-overlay" onClick={onClose}>
      <div className="sf-modal" style={{ maxWidth: 520 }} onClick={e => e.stopPropagation()}>
        <button className="sf-close" onClick={onClose} aria-label="Fechar">×</button>
        <div className="sf-header">
          <div className="sf-eyebrow" style={{ color: '#c97639' }}>ADMINISTRAÇÃO</div>
          <h2 className="sf-title" style={{ fontSize: 20, marginBottom: 4 }}>Solicitações de Acesso</h2>
          <p className="sf-sub">Aprove ou reprove pedidos de edição de caixas do fluxo.</p>
        </div>
        <div style={{ padding: '16px 32px 28px' }}>
          {loading && <p style={{ color: '#6b6b66' }}>Carregando…</p>}
          {!loading && requests.length === 0 && (
            <p style={{ color: '#6b6b66', textAlign: 'center', padding: '24px 0' }}>
              ✓ Nenhuma solicitação pendente.
            </p>
          )}
          {!loading && requests.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxHeight: 380, overflowY: 'auto' }}>
              {requests.map(r => (
                <div key={r.id} style={{ border: '1px solid rgba(0,0,0,0.10)', borderRadius: 10,
                                         padding: '12px 14px', background: '#fafaf9' }}>
                  <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 2 }}>
                    {r.requester_name || r.requester_email}
                  </div>
                  <div style={{ fontSize: 12, color: '#6b6b66', marginBottom: 10 }}>
                    {r.requester_email} · solicita edição de:
                    <b style={{ color: '#1a1a1a' }}> {r.node_title || r.node_id}</b>
                    <span style={{ marginLeft: 8, color: '#aaa' }}>
                      {new Date(r.created_at).toLocaleString('pt-BR')}
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button className="btn-primary"
                            style={{ height: 28, padding: '0 14px', fontSize: 12, background: '#3d8c4d', borderColor: '#3d8c4d' }}
                            disabled={resolving === r.id}
                            onClick={() => resolve(r.id, 'approved')}>
                      ✓ Aprovar
                    </button>
                    <button className="btn-ghost"
                            style={{ height: 28, padding: '0 14px', fontSize: 12, color: '#a52828' }}
                            disabled={resolving === r.id}
                            onClick={() => resolve(r.id, 'denied')}>
                      ✗ Reprovar
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Modal de Backup (salvar / importar)
function BackupModal({ nodes, edges, docTitle, flowTitle, flowLogo, flowTitleFont, flowTitleSize, legend, legendConfig, onClose, onImport }) {
  const [tab, setTab] = React.useState('save');
  const [name, setName] = React.useState('');
  const [status, setStatus] = React.useState(null); // null | 'saving' | 'saved' | 'error'
  const [backups, setBackups] = React.useState([]);
  const [loading, setLoading] = React.useState(false);
  const [loadErr, setLoadErr] = React.useState(null);
  const [overwriteMode, setOverwriteMode] = React.useState(false);
  const [overwriteFile, setOverwriteFile] = React.useState(null);

  const loadList = () => {
    setLoading(true);
    setLoadErr(null);
    fetch('/api/backup/list')
      .then((r) => r.json())
      .then((d) => { setBackups(d.files || []); setLoading(false); })
      .catch(() => { setLoadErr('Erro ao listar backups. Verifique o servidor.'); setLoading(false); });
  };

  React.useEffect(() => { loadList(); }, []);
  React.useEffect(() => {
    if (tab === 'import') loadList();
  }, [tab]);

  const save = () => {
    setStatus('saving');
    let subflows = {};
    try { subflows = JSON.parse(localStorage.getItem('fluxograma:subflows:v1') || '{}'); } catch (e) {}
    const body = { name: name || 'backup', data: { nodes, edges, title: docTitle, flowTitle, flowLogo, flowTitleFont, flowTitleSize, legend, legendConfig, subflows } };
    if (overwriteMode && overwriteFile) body.overwriteFile = overwriteFile;
    fetch('/api/backup/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
      .then((r) => r.json())
      .then((d) => setStatus(d.ok ? 'saved' : 'error'))
      .catch(() => setStatus('error'));
  };

  const importFile = (filename) => {
    fetch(`/api/backup/load?file=${encodeURIComponent(filename)}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.ok && d.data) { onImport(d.data); onClose(); }
        else setLoadErr('Falha ao carregar backup.');
      })
      .catch(() => setLoadErr('Erro ao carregar backup.'));
  };

  const downloadToComputer = () => {
    let subflows = {};
    try { subflows = JSON.parse(localStorage.getItem('fluxograma:subflows:v1') || '{}'); } catch (e) {}
    const data = { nodes, edges, title: docTitle, flowTitle, flowLogo, flowTitleFont, flowTitleSize, legend, legendConfig, subflows };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const importFromComputer = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target.result);
        if (!data || (!data.nodes && !data.edges)) throw new Error('Formato inválido');
        onImport(data);
        onClose();
      } catch (err) {
        setLoadErr('Arquivo inválido ou corrompido. Certifique-se de selecionar um backup gerado por este sistema.');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const inputStyle = {
    border: '1px solid rgba(0,0,0,0.1)', borderRadius: 6,
    padding: '8px 10px', font: '13px/1.4 inherit', outline: 0, width: '100%',
  };

  return (
    <div className="sf-modal-overlay" onClick={onClose}>
      <div className="sf-modal" style={{ maxWidth: 520 }} onClick={(e) => e.stopPropagation()}>
        <button className="sf-close" onClick={onClose} aria-label="Fechar">×</button>
        <div className="sf-header">
          <div className="sf-eyebrow" style={{ color: '#1f5dbb' }}>BACKUP LOCAL</div>
          <h2 className="sf-title" style={{ fontSize: 20, marginBottom: 12 }}>Salvar e Importar</h2>
          <div style={{ display: 'flex', gap: 6 }}>
            <button className={tab === 'save' ? 'btn-primary' : 'btn-ghost'} style={{ height: 30, fontSize: 13 }}
                    onClick={() => { setTab('save'); setStatus(null); }}>Salvar backup</button>
            <button className={tab === 'import' ? 'btn-primary' : 'btn-ghost'} style={{ height: 30, fontSize: 13 }}
                    onClick={() => setTab('import')}>Importar backup</button>
          </div>
        </div>

        {tab === 'save' && (
          <div style={{ padding: '20px 32px 28px' }}>
            {status === 'saved' && (
              <div style={{ textAlign: 'center', padding: '16px 0' }}>
                <div style={{ fontSize: 36, marginBottom: 8 }}>✓</div>
                <p style={{ color: '#3d8c4d', fontWeight: 600, margin: '0 0 16px' }}>Backup salvo com sucesso!</p>
                <button className="btn-ghost" onClick={onClose}>Fechar</button>
              </div>
            )}
            {status === 'error' && (
              <div style={{ textAlign: 'center', padding: '16px 0' }}>
                <p style={{ color: '#a52828', margin: '0 0 12px' }}>Erro ao salvar. Verifique se o servidor está rodando.</p>
                <button className="btn-ghost" onClick={() => setStatus(null)}>Tentar novamente</button>
              </div>
            )}
            {(status === null || status === 'saving') && (
              <>
                <div style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#6b6b66', marginBottom: 8 }}>
                    Modo de salvamento
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13 }}>
                      <input type="radio" name="saveMode" checked={!overwriteMode}
                             onChange={() => { setOverwriteMode(false); setOverwriteFile(null); }} />
                      Criar novo arquivo
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: backups.length === 0 ? 'default' : 'pointer', fontSize: 13, color: backups.length === 0 ? '#aaa' : 'inherit' }}>
                      <input type="radio" name="saveMode" checked={overwriteMode}
                             onChange={() => setOverwriteMode(true)}
                             disabled={backups.length === 0} />
                      Sobrescrever arquivo existente{backups.length === 0 ? ' (nenhum backup encontrado)' : ''}
                    </label>
                  </div>
                </div>

                {!overwriteMode && (
                  <div style={{ marginBottom: 14 }}>
                    <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#6b6b66', marginBottom: 6 }}>
                      Nome do backup (opcional)
                    </div>
                    <input type="text" value={name} onChange={(e) => setName(e.target.value)}
                           placeholder="Ex: versao-final, reuniao-05-2026"
                           style={inputStyle} />
                  </div>
                )}

                {overwriteMode && (
                  <div style={{ marginBottom: 14 }}>
                    <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#6b6b66', marginBottom: 6 }}>
                      Selecionar arquivo para sobrescrever
                    </div>
                    {loading && <p style={{ fontSize: 12, color: '#6b6b66', margin: '4px 0' }}>Carregando…</p>}
                    {!loading && backups.length > 0 && (
                      <div style={{ maxHeight: 180, overflowY: 'auto', border: '1px solid rgba(0,0,0,0.10)', borderRadius: 6 }}>
                        {backups.map((b) => (
                          <div key={b.filename}
                               onClick={() => setOverwriteFile(b.filename)}
                               style={{
                                 padding: '8px 12px', cursor: 'pointer',
                                 background: overwriteFile === b.filename ? '#dbeaff' : 'transparent',
                                 borderBottom: '1px solid rgba(0,0,0,0.06)',
                               }}>
                            <div style={{ fontSize: 12.5, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {b.filename.replace(/\.json$/, '')}
                            </div>
                            <div style={{ fontSize: 11, color: '#6b6b66', marginTop: 2 }}>
                              {new Date(b.mtime).toLocaleString('pt-BR')}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {!overwriteMode && (
                  <p style={{ fontSize: 12, color: '#6b6b66', marginBottom: 18, lineHeight: 1.5 }}>
                    Salva o estado completo — caixas, setas e sub-fluxos — como arquivo JSON na pasta <code>backup/</code> do projeto.
                  </p>
                )}
                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                  <button className="btn-ghost" onClick={onClose}>Cancelar</button>
                  <button className="btn-primary" onClick={save}
                          disabled={status === 'saving' || (overwriteMode && !overwriteFile)}>
                    {status === 'saving' ? 'Salvando…' : 'Salvar backup'}
                  </button>
                </div>

                <div style={{ borderTop: '1px solid rgba(0,0,0,0.08)', marginTop: 20, paddingTop: 16 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#6b6b66', marginBottom: 8 }}>
                    Salvar no computador
                  </div>
                  <p style={{ fontSize: 12, color: '#6b6b66', marginBottom: 10, lineHeight: 1.5 }}>
                    Baixa um arquivo JSON do estado atual diretamente para o seu computador, sem salvar no servidor.
                  </p>
                  <button className="btn-ghost" style={{ width: '100%' }} onClick={downloadToComputer}>
                    ⬇ Baixar arquivo no computador
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {tab === 'import' && (
          <div style={{ padding: '20px 32px 28px' }}>
            {/* Importar do computador */}
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#6b6b66', marginBottom: 8 }}>
                Importar do computador
              </div>
              <p style={{ fontSize: 12, color: '#6b6b66', marginBottom: 10, lineHeight: 1.5 }}>
                Selecione um arquivo JSON de backup salvo anteriormente no seu computador.
              </p>
              <label style={{ display: 'block', cursor: 'pointer' }}>
                <div className="btn-ghost" style={{ width: '100%', textAlign: 'center', boxSizing: 'border-box' }}>
                  📂 Selecionar arquivo do computador
                </div>
                <input type="file" accept=".json,application/json" onChange={importFromComputer}
                       style={{ display: 'none' }} />
              </label>
            </div>

            <div style={{ borderTop: '1px solid rgba(0,0,0,0.08)', marginBottom: 16 }}>
              <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#6b6b66', marginTop: 16, marginBottom: 8 }}>
                Backups salvos no servidor
              </div>
            </div>

            {loadErr && <p style={{ color: '#a52828', marginBottom: 10 }}>{loadErr}</p>}
            {loading && <p style={{ color: '#6b6b66' }}>Carregando lista de backups…</p>}
            {!loading && !loadErr && backups.length === 0 && (
              <p style={{ color: '#6b6b66', textAlign: 'center', padding: '8px 0' }}>
                Nenhum backup encontrado no servidor.
              </p>
            )}
            {!loading && backups.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 280, overflowY: 'auto' }}>
                {backups.map((b) => (
                  <div key={b.filename}
                       style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                                padding: '10px 12px', border: '1px solid rgba(0,0,0,0.10)',
                                borderRadius: 8, background: 'rgba(0,0,0,0.02)', gap: 12 }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 12.5, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {b.filename.replace(/\.json$/, '')}
                      </div>
                      <div style={{ fontSize: 11, color: '#6b6b66', marginTop: 2 }}>
                        {new Date(b.mtime).toLocaleString('pt-BR')}
                      </div>
                    </div>
                    <button className="btn-primary"
                            style={{ height: 28, padding: '0 12px', fontSize: 12, flexShrink: 0 }}
                            onClick={() => importFile(b.filename)}>Carregar</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Toolbar do editor
function EditorToolbar({ onAdd, onReset, onExit, isAdmin }) {
  return (
    <div className="editor-toolbar">
      <div className="et-group">
        <span className="et-label">Adicionar</span>
        {[
          { shape: 'rect',    color: 'blue',   label: 'Retângulo', icon: <span className="et-shape rect"    style={{ background: '#dbeaff', borderColor: '#1f5dbb' }} /> },
          { shape: 'pill',    color: 'blue',   label: 'Pílula',    icon: <span className="et-shape pill"    style={{ background: '#dbeaff', borderColor: '#1f5dbb' }} /> },
          { shape: 'diamond', color: 'yellow', label: 'Decisão',   icon: <span className="et-shape diamond" style={{ background: '#fff2a8', borderColor: '#caa628' }} /> },
          { shape: 'text',    color: 'blue',   label: 'Texto',     icon: <span style={{ fontSize: 13, fontWeight: 800, color: '#1f5dbb', lineHeight: 1, display: 'inline-block', width: 18 }}>Aa</span> },
          { shape: 'zone',    color: 'blue',   label: 'Área',      icon: <span className="et-shape rect"    style={{ background: 'none', borderColor: '#1f5dbb', borderStyle: 'dashed', borderWidth: 2 }} /> },
        ].map(({ shape, color, label, icon }) => (
          <button key={shape}
                  className="et-add"
                  draggable
                  onClick={() => onAdd(shape, color)}
                  onDragStart={(e) => {
                    e.dataTransfer.setData('fc-shape', shape);
                    e.dataTransfer.setData('fc-color', color);
                    e.dataTransfer.effectAllowed = 'copy';
                  }}>
            {icon}{label}
          </button>
        ))}
      </div>
      <div className="et-group">
        {isAdmin && <button className="btn-ghost" onClick={onReset} title="Voltar ao fluxograma original">↺ Resetar</button>}
        <button className="btn-ghost" onClick={onExit}>✓ Concluir edição</button>
      </div>
    </div>
  );
}

// ─── Rodapé de Legenda
function LegendFooter({ legend, legendConfig, editorMode, isAdmin, onChange, onConfigChange, collapsed, onToggleCollapse }) {
  const [editing, setEditing] = React.useState(false);

  const cfg = { ...DEFAULT_LEGEND_CONFIG, ...legendConfig };
  const fontCss = titleFontCss(cfg.fontFamily);

  const addItem = () => {
    const id = 'leg' + (Date.now() % 1e8);
    onChange([...legend, { id, label: 'Novo item', color: '#e5e7eb', stroke: '#6b7280', shape: 'rect' }]);
  };
  const updateItem = (id, patch) => onChange(legend.map(l => l.id === id ? { ...l, ...patch } : l));
  const removeItem = (id) => onChange(legend.filter(l => l.id !== id));

  const justifyMap = { left: 'flex-start', center: 'center', right: 'flex-end' };

  const renderIndicator = (item) => {
    const sz = cfg.fontSize;
    if (cfg.style === 'chip') return null;
    if (item.shape === 'diamond') {
      return <span style={{ color: item.stroke, fontSize: sz, lineHeight: 1, flexShrink: 0 }}>◆</span>;
    }
    return (
      <span style={{
        width: cfg.style === 'block' ? sz * 1.7 : sz * 0.85,
        height: sz * 0.85,
        background: item.color,
        border: `1.5px solid ${item.stroke}`,
        borderRadius: item.shape === 'circle' ? '50%' : 4,
        flexShrink: 0, display: 'inline-block',
      }} />
    );
  };

  const renderItemDisplay = (item) => {
    const sz = cfg.fontSize;
    const psz = item.periodFontSize || 9;
    const isChip = cfg.style === 'chip';
    const labelEl = editing
      ? <input value={item.label} onChange={(e) => updateItem(item.id, { label: e.target.value })}
               className="lf-label-input"
               style={{ fontSize: sz, fontFamily: fontCss,
                        color: isChip ? item.stroke : 'var(--ink)', fontWeight: isChip ? 700 : 600 }} />
      : <span style={{ fontSize: sz, fontFamily: fontCss, whiteSpace: 'nowrap',
                       fontWeight: isChip ? 700 : 600, color: isChip ? item.stroke : 'var(--ink)' }}>
          {item.label}
        </span>;

    const periodEl = item.period
      ? <span style={{ fontSize: psz, fontFamily: fontCss, whiteSpace: 'nowrap',
                       fontWeight: 600, color: item.stroke, opacity: 0.75, letterSpacing: '0.02em' }}>
          {item.period}
        </span>
      : null;

    if (isChip) {
      return (
        <span className="lf-chip"
              style={{ background: item.color, border: `1.5px solid ${item.stroke}`,
                       ...(item.period ? { flexDirection: 'column', alignItems: 'center', gap: 1 } : {}) }}>
          <span style={{ display: 'inline-flex', alignItems: 'center' }}>
            {item.shape === 'diamond' && <span style={{ marginRight: 4, fontSize: sz * 0.8 }}>◆</span>}
            {labelEl}
          </span>
          {periodEl}
        </span>
      );
    }
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: Math.max(5, sz * 0.5) }}>
        {renderIndicator(item)}{labelEl}
        {periodEl}
      </span>
    );
  };

  if (!legend.length && !(editorMode && isAdmin)) return null;

  if (editorMode && isAdmin && collapsed) {
    return (
      <div className="section-strip" onClick={onToggleCollapse}>
        <span className="section-strip-icon">▶</span>
        <span>Legenda</span>
      </div>
    );
  }

  return (
    <div className="legend-footer" style={{ background: `rgba(255,255,255,${(cfg.opacity ?? 100) / 100})` }}>
      {/* Itens */}
      <div className="lf-items"
           style={{ justifyContent: justifyMap[cfg.align] || 'center', gap: cfg.gap }}>
        {legend.map(item => (
          <div key={item.id} className="lf-item-wrap">
            {renderItemDisplay(item)}
            {editing && (
              <div className="lf-item-controls">
                <label title="Cor de fundo" className="lf-color-label">
                  <span>Fill</span>
                  <input type="color" value={item.color}
                         onChange={(e) => updateItem(item.id, { color: e.target.value })}
                         className="lf-color-input" />
                </label>
                <label title="Cor da borda / texto" className="lf-color-label">
                  <span>Borda</span>
                  <input type="color" value={item.stroke}
                         onChange={(e) => updateItem(item.id, { stroke: e.target.value })}
                         className="lf-color-input" />
                </label>
                <select value={item.shape || 'rect'}
                        onChange={(e) => updateItem(item.id, { shape: e.target.value })}
                        className="lf-shape-select">
                  <option value="rect">■ Quadrado</option>
                  <option value="circle">● Círculo</option>
                  <option value="diamond">◆ Diamante</option>
                </select>
                <button onClick={() => removeItem(item.id)} className="lf-remove-btn">×</button>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 4, width: '100%' }}>
                  <span style={{ fontSize: 10, color: 'var(--ink-mute)', whiteSpace: 'nowrap' }}>Período</span>
                  <input value={item.period || ''} placeholder="Ex: 2 dias"
                         onChange={(e) => updateItem(item.id, { period: e.target.value })}
                         style={{ flex: 1, fontSize: 11, padding: '2px 5px', borderRadius: 4,
                                  border: '1px solid var(--border)', minWidth: 0 }} />
                </div>
                {item.period && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 3, marginTop: 2 }}>
                    <span style={{ fontSize: 10, color: 'var(--ink-mute)' }}>Tam.</span>
                    <button className="btn-ghost" style={{ width: 26, padding: 0, fontSize: 11, fontWeight: 700 }}
                            onClick={() => updateItem(item.id, { periodFontSize: Math.max(7, (item.periodFontSize || 9) - 1) })}>A−</button>
                    <span style={{ minWidth: 26, textAlign: 'center', fontSize: 11 }}>{item.periodFontSize || 9}px</span>
                    <button className="btn-ghost" style={{ width: 26, padding: 0, fontSize: 11, fontWeight: 700 }}
                            onClick={() => updateItem(item.id, { periodFontSize: Math.min(20, (item.periodFontSize || 9) + 1) })}>A+</button>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
        {editing && (
          <button onClick={addItem} className="lf-add-btn">+ Item</button>
        )}
      </div>

      {/* Barra de edição (admin) */}
      {editorMode && isAdmin && (
        <div className="lf-toolbar">
          <button className="lf-edit-btn" onClick={() => setEditing(!editing)}>
            {editing ? '✓ Fechar edição' : '✎ Editar legenda'}
          </button>
          {editing && (<>
            <div className="lf-toolbar-sep" />
            <span className="lf-toolbar-label">Estilo</span>
            {[{ v: 'chip', l: 'Chip' }, { v: 'dot', l: 'Ponto' }, { v: 'block', l: 'Bloco' }].map(s => (
              <button key={s.v} className={'lf-seg-btn' + (cfg.style === s.v ? ' on' : '')}
                      onClick={() => onConfigChange({ ...cfg, style: s.v })}>{s.l}</button>
            ))}
            <div className="lf-toolbar-sep" />
            <span className="lf-toolbar-label">Fonte</span>
            <select value={cfg.fontFamily} onChange={(e) => onConfigChange({ ...cfg, fontFamily: e.target.value })}
                    className="lf-select">
              {TITLE_FONTS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
            </select>
            <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
              <button className="btn-ghost" style={{ width: 26, padding: 0, fontSize: 12, fontWeight: 700 }}
                      onClick={() => onConfigChange({ ...cfg, fontSize: Math.max(9, cfg.fontSize - 1) })}>A−</button>
              <span style={{ minWidth: 30, textAlign: 'center', fontSize: 11 }}>{cfg.fontSize}px</span>
              <button className="btn-ghost" style={{ width: 26, padding: 0, fontSize: 12, fontWeight: 700 }}
                      onClick={() => onConfigChange({ ...cfg, fontSize: Math.min(24, cfg.fontSize + 1) })}>A+</button>
            </div>
            <div className="lf-toolbar-sep" />
            <span className="lf-toolbar-label">Alinhar</span>
            {[{ v: 'left', l: '← Esq' }, { v: 'center', l: '≡ Centro' }, { v: 'right', l: 'Dir →' }].map(a => (
              <button key={a.v} className={'lf-seg-btn' + (cfg.align === a.v ? ' on' : '')}
                      onClick={() => onConfigChange({ ...cfg, align: a.v })}>{a.l}</button>
            ))}
            <div className="lf-toolbar-sep" />
            <span className="lf-toolbar-label">Espaço</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
              <button className="btn-ghost" style={{ width: 26, padding: 0, fontSize: 13 }}
                      onClick={() => onConfigChange({ ...cfg, gap: Math.max(6, cfg.gap - 4) })}>−</button>
              <span style={{ minWidth: 30, textAlign: 'center', fontSize: 11 }}>{cfg.gap}px</span>
              <button className="btn-ghost" style={{ width: 26, padding: 0, fontSize: 13 }}
                      onClick={() => onConfigChange({ ...cfg, gap: Math.min(64, cfg.gap + 4) })}>+</button>
            </div>
            <div className="lf-toolbar-sep" />
            <span className="lf-toolbar-label">Opacidade</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <input type="range" min="10" max="100" step="5" value={cfg.opacity ?? 100}
                     onChange={(e) => onConfigChange({ ...cfg, opacity: Number(e.target.value) })}
                     className="lf-opacity-range" />
              <span style={{ minWidth: 34, textAlign: 'center', fontSize: 11, fontVariantNumeric: 'tabular-nums' }}>{cfg.opacity ?? 100}%</span>
            </div>
          </>)}
          <div className="lf-toolbar-sep" />
          <button className="lf-edit-btn" onClick={onToggleCollapse} title="Recolher legenda">▼ Recolher</button>
        </div>
      )}
    </div>
  );
}

// ─── AuditModal
function AuditModal({ onClose }) {
  const [from, setFrom]     = React.useState('');
  const [to, setTo]         = React.useState('');
  const [user, setUser]     = React.useState('');
  const [action, setAction] = React.useState('');
  const [logs, setLogs]     = React.useState([]);
  const [total, setTotal]   = React.useState(0);
  const [loading, setLoading] = React.useState(false);
  const [offset, setOffset] = React.useState(0);
  const [expandedId, setExpandedId] = React.useState(null);
  const [clearing, setClearing] = React.useState(false);
  const LIMIT = 50;

  const fetchLogs = React.useCallback((reset = false) => {
    setLoading(true);
    const off = reset ? 0 : offset;
    const params = new URLSearchParams({ limit: LIMIT, offset: off });
    if (from)   params.set('from', new Date(from).toISOString());
    if (to)     params.set('to', new Date(to + 'T23:59:59').toISOString());
    if (user)   params.set('user', user.trim());
    if (action) params.set('action', action);
    fetch(`/api/audit?${params}`)
      .then(r => r.json())
      .then(d => {
        if (!d.ok) return;
        setLogs(reset ? d.logs : prev => [...prev, ...d.logs]);
        setOffset(reset ? d.logs.length : prev => prev + d.logs.length);
        setTotal(d.total);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [from, to, user, action, offset]);

  const fetchLogsRef = React.useRef(fetchLogs);
  React.useEffect(() => { fetchLogsRef.current = fetchLogs; }, [fetchLogs]);

  // Initial load
  React.useEffect(() => { fetchLogsRef.current(true); }, []);

  // Real-time: listen to SSE audit_new events
  React.useEffect(() => {
    const es = new EventSource('/api/events/__main__');
    es.addEventListener('audit_new', () => fetchLogsRef.current(true));
    return () => es.close();
  }, []);

  const clearHistory = async () => {
    if (!window.confirm('Limpar todo o histórico de auditoria? Esta ação não pode ser desfeita.')) return;
    setClearing(true);
    try {
      await fetch('/api/audit', { method: 'DELETE' });
      setLogs([]); setTotal(0); setOffset(0);
    } finally { setClearing(false); }
  };

  const ACTION_ICONS = {
    node_add: '➕', node_edit: '✏️', node_delete: '🗑️',
    edge_add: '↗️', edge_delete: '✂️',
    subflow_add: '➕', subflow_edit: '✏️', subflow_delete: '🗑️',
    publish: '🌐', backup_save: '💾',
    user_add: '👤', user_remove: '🚫', user_admin_grant: '🔑', user_admin_revoke: '🔑',
    access_request: '🔒', access_approved: '✅', access_denied: '❌',
    login: '🔐',
  };
  const ACTION_COLORS = {
    node_add: '#3d8c4d', node_edit: '#1f5dbb', node_delete: '#a52828',
    edge_add: '#3d8c4d', edge_delete: '#a52828',
    subflow_add: '#3d8c4d', subflow_edit: '#1f5dbb', subflow_delete: '#a52828',
    publish: '#1f5dbb', backup_save: '#6b6b66',
    user_add: '#3d8c4d', user_remove: '#a52828', user_admin_grant: '#c97639', user_admin_revoke: '#c97639',
    access_request: '#caa628', access_approved: '#3d8c4d', access_denied: '#a52828',
    login: '#6b6b66',
  };
  const CATEGORY_LABELS = [
    ['node',    'Nós'],
    ['edge',    'Setas'],
    ['subflow', 'Sub-fluxos'],
    ['publish', 'Publicações'],
    ['user',    'Usuários'],
    ['access',  'Acessos'],
    ['login',   'Logins'],
  ];

  const grouped = React.useMemo(() => {
    const groups = [];
    let currentDay = null;
    for (const log of logs) {
      const d = new Date(log.created_at);
      const dayKey = d.toDateString();
      if (dayKey !== currentDay) {
        currentDay = dayKey;
        const now = new Date();
        const isToday     = d.toDateString() === now.toDateString();
        const isYesterday = d.toDateString() === new Date(now - 86400000).toDateString();
        const label = isToday ? 'Hoje' : isYesterday ? 'Ontem'
          : d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });
        groups.push({ label, items: [] });
      }
      groups[groups.length - 1].items.push(log);
    }
    return groups;
  }, [logs]);

  const S = { // inline styles helpers
    label: { fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#6b6b66' },
    input: { border: '1px solid rgba(0,0,0,0.15)', borderRadius: 6, padding: '6px 10px', font: '13px inherit', outline: 'none', background: '#fff' },
  };

  return (
    <div className="sf-drill" style={{ zIndex: 1100 }}>
      <div className="sf-drill-bar">
        <button className="sf-back" onClick={onClose}>← Fechar</button>
        <span style={{ fontWeight: 700, fontSize: 15 }}>Auditoria</span>
        <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 12 }}>
          {total > 0 && <span style={{ fontSize: 12, color: '#6b6b66' }}>{total.toLocaleString('pt-BR')} registro{total !== 1 ? 's' : ''}</span>}
          <button onClick={clearHistory} disabled={clearing || total === 0}
                  style={{ fontSize: 12, padding: '4px 10px', background: 'transparent', border: '1px solid rgba(165,40,40,0.35)',
                           borderRadius: 6, color: '#a52828', cursor: 'pointer', opacity: (clearing || total === 0) ? 0.5 : 1 }}>
            {clearing ? 'Limpando…' : '🗑 Limpar histórico'}
          </button>
        </span>
      </div>

      {/* Filtros */}
      <div style={{ background: '#fff', borderBottom: '1px solid rgba(0,0,0,0.08)', padding: '12px 20px', display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'flex-end' }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={S.label}>De</span>
          <input type="date" value={from} onChange={e => setFrom(e.target.value)} style={S.input} />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={S.label}>Até</span>
          <input type="date" value={to} onChange={e => setTo(e.target.value)} style={S.input} />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={S.label}>Usuário</span>
          <input type="text" value={user} onChange={e => setUser(e.target.value)}
                 placeholder="parte do e-mail" style={{ ...S.input, width: 180 }} />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={S.label}>Categoria</span>
          <select value={action} onChange={e => setAction(e.target.value)} style={{ ...S.input, cursor: 'pointer' }}>
            <option value="">Todas</option>
            {CATEGORY_LABELS.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <div style={{ display: 'flex', gap: 6 }}>
          <button onClick={() => { setOffset(0); fetchLogs(true); }} disabled={loading}
                  style={{ height: 34, padding: '0 18px', background: '#1f5dbb', color: '#fff', border: 'none', borderRadius: 6, font: '13px/1 inherit', fontWeight: 600, cursor: 'pointer', opacity: loading ? 0.7 : 1 }}>
            {loading ? 'Buscando…' : 'Filtrar'}
          </button>
          {(from || to || user || action) && (
            <button onClick={() => { setFrom(''); setTo(''); setUser(''); setAction(''); setTimeout(() => fetchLogs(true), 0); }}
                    style={{ height: 34, padding: '0 14px', background: 'transparent', border: '1px solid rgba(0,0,0,0.15)', borderRadius: 6, font: '12px inherit', cursor: 'pointer', color: '#6b6b66' }}>
              Limpar
            </button>
          )}
        </div>
      </div>

      {/* Lista */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {logs.length === 0 && !loading && (
          <div style={{ padding: '56px 24px', textAlign: 'center', color: '#6b6b66', fontSize: 14 }}>
            Nenhum registro encontrado.
          </div>
        )}
        {grouped.map(group => (
          <div key={group.label}>
            <div style={{ padding: '14px 20px 6px', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: '#6b6b66', background: '#faf9f5', borderBottom: '1px solid rgba(0,0,0,0.05)' }}>
              {group.label}
            </div>
            {group.items.map(log => {
              const icon     = ACTION_ICONS[log.action]  || '📝';
              const time     = new Date(log.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
              const meta     = log.metadata;
              const isOpen   = expandedId === log.id;
              const hasDetail = meta && (
                (meta.changes  && meta.changes.length  > 0) ||
                (meta.added    && meta.added.length    > 0) ||
                (meta.removed  && meta.removed.length  > 0) ||
                (meta.edited   && meta.edited.length   > 0) ||
                meta.stepCount != null || meta.label || meta.color
              );
              return (
                <div key={log.id} style={{ borderBottom: '1px solid rgba(0,0,0,0.04)' }}>
                  <div
                    style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '10px 20px',
                             transition: 'background 0.1s', cursor: hasDetail ? 'pointer' : 'default' }}
                    onClick={() => hasDetail && setExpandedId(isOpen ? null : log.id)}
                    onMouseEnter={e => { if (hasDetail) e.currentTarget.style.background = '#f5f4f0'; }}
                    onMouseLeave={e => e.currentTarget.style.background = ''}>
                    <span style={{ fontSize: 17, lineHeight: 1.35, flexShrink: 0, width: 24, textAlign: 'center' }}>{icon}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, color: '#1d1d1b', lineHeight: 1.45 }}>{log.description}</div>
                      <div style={{ fontSize: 11.5, color: '#6b6b66', marginTop: 2 }}>{log.actor_email}</div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                      <span style={{ fontSize: 11.5, color: '#9a9a95', fontVariantNumeric: 'tabular-nums' }}>{time}</span>
                      {hasDetail && <span style={{ fontSize: 10, color: '#aaa' }}>{isOpen ? '▲' : '▼'}</span>}
                    </div>
                  </div>
                  {isOpen && hasDetail && (
                    <div style={{ margin: '0 20px 10px 56px', background: '#f7f6f2', borderRadius: 8,
                                  padding: '10px 14px', fontSize: 12.5, color: '#3a3a35', lineHeight: 1.6 }}>
                      {/* node_edit: list changed fields */}
                      {meta.changes && meta.changes.map((ch, i) => (
                        <div key={i} style={{ marginBottom: 4 }}>
                          <span style={{ fontWeight: 600 }}>{ch.label}:</span>{' '}
                          {ch.field === 'color' ? (
                            <>
                              <span style={{ display: 'inline-block', width: 12, height: 12, borderRadius: 3,
                                             background: ch.before, border: '1px solid rgba(0,0,0,0.15)', verticalAlign: 'middle', marginRight: 3 }} />
                              <span style={{ color: '#888' }}>{ch.before}</span>
                              {' → '}
                              <span style={{ display: 'inline-block', width: 12, height: 12, borderRadius: 3,
                                             background: ch.after, border: '1px solid rgba(0,0,0,0.15)', verticalAlign: 'middle', marginRight: 3 }} />
                              <span style={{ color: '#888' }}>{ch.after}</span>
                            </>
                          ) : ch.field === 'allowedUsers' ? (
                            <span style={{ color: '#555' }}>
                              {(ch.before || []).join(', ') || '—'} → {(ch.after || []).join(', ') || '—'}
                            </span>
                          ) : (
                            <span style={{ color: '#555' }}>
                              {String(ch.before ?? '—').slice(0, 80)} → {String(ch.after ?? '—').slice(0, 80)}
                            </span>
                          )}
                        </div>
                      ))}
                      {/* subflow_edit: added/removed/edited steps */}
                      {meta.added   && meta.added.length > 0 && (
                        <div style={{ marginBottom: 4 }}>
                          <span style={{ color: '#3d8c4d', fontWeight: 600 }}>+ Adicionado{meta.added.length > 1 ? 's' : ''}:</span>{' '}
                          {meta.added.join(', ')}
                        </div>
                      )}
                      {meta.removed && meta.removed.length > 0 && (
                        <div style={{ marginBottom: 4 }}>
                          <span style={{ color: '#a52828', fontWeight: 600 }}>− Removido{meta.removed.length > 1 ? 's' : ''}:</span>{' '}
                          {meta.removed.join(', ')}
                        </div>
                      )}
                      {meta.edited  && meta.edited.length > 0 && meta.edited.map((e, i) => (
                        <div key={i} style={{ marginBottom: 6 }}>
                          <div style={{ fontWeight: 600, color: '#1f5dbb' }}>✎ {typeof e === 'string' ? e : e.title}</div>
                          {typeof e !== 'string' && e.changes && e.changes.map((c, j) => (
                            <div key={j} style={{ paddingLeft: 12, color: '#555', fontSize: 12 }}>· {c}</div>
                          ))}
                        </div>
                      ))}
                      {/* node_add/delete or subflow_add/delete: summary props */}
                      {meta.label && !meta.changes && <div><span style={{ fontWeight: 600 }}>Título:</span> {meta.label}</div>}
                      {meta.color && !meta.changes && (
                        <div><span style={{ fontWeight: 600 }}>Cor:</span>{' '}
                          <span style={{ display: 'inline-block', width: 12, height: 12, borderRadius: 3,
                                         background: meta.color, border: '1px solid rgba(0,0,0,0.15)', verticalAlign: 'middle', marginRight: 3 }} />
                          {meta.color}
                        </div>
                      )}
                      {meta.stepCount != null && <div><span style={{ fontWeight: 600 }}>Etapas:</span> {meta.stepCount}</div>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ))}
        {loading && (
          <div style={{ padding: '24px', textAlign: 'center', color: '#6b6b66', fontSize: 13 }}>Carregando…</div>
        )}
        {!loading && logs.length > 0 && logs.length < total && (
          <div style={{ padding: '20px 24px', textAlign: 'center' }}>
            <button onClick={() => fetchLogs(false)}
                    style={{ padding: '9px 28px', background: 'transparent', border: '1px solid rgba(0,0,0,0.18)', borderRadius: 7, font: '13px inherit', cursor: 'pointer', color: '#6b6b66' }}>
              Carregar mais ({(total - logs.length).toLocaleString('pt-BR')} restantes)
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── App
function App() {
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);
  const serverDoc = (!PUBLISHED_SLUG && LIVE_DOC) ? LIVE_DOC : null;
  const localDoc = !PUBLISHED_SLUG ? loadDoc() : null;
  console.log('>>> serverDoc:', serverDoc ? 'sim' : 'nao', '| localDoc:', localDoc ? 'sim' : 'nao');
  const initial = serverDoc || localDoc;
  const [nodes, setNodes] = React.useState(PUBLISHED_SLUG ? [] : (initial?.nodes || SEED_NODES));
  const [edges, setEdges] = React.useState(PUBLISHED_SLUG ? [] : (initial?.edges || SEED_EDGES));
  const [docTitle, setDocTitle] = React.useState(initial?.title || 'Jornada Comercial — Lead até Pós-Contrato');
  const [flowTitle, setFlowTitle]         = React.useState(initial?.flowTitle     || '');
  const [flowLogo, setFlowLogo]           = React.useState(initial?.flowLogo      || '');
  const [flowTitleFont, setFlowTitleFont] = React.useState(initial?.flowTitleFont || '');
  const [flowTitleSize, setFlowTitleSize] = React.useState(initial?.flowTitleSize || 32);
  const [legend, setLegend]             = React.useState(initial?.legend       || DEFAULT_LEGEND);
  const [legendConfig, setLegendConfig] = React.useState(initial?.legendConfig || DEFAULT_LEGEND_CONFIG);
  const [topbarVisible, setTopbarVisible] = React.useState(!PUBLISHED_SLUG);
  const [coverCollapsed, setCoverCollapsed] = React.useState(false);
  const [legendCollapsed, setLegendCollapsed] = React.useState(false);
  const [editorMode, setEditorMode] = React.useState(false);
  const [selectedNodeId, setSelectedNodeId] = React.useState(null);
  const [selectedEdgeIdx, setSelectedEdgeIdx] = React.useState(null);
  const [connectingFromId, setConnectingFromId] = React.useState(null);
  const [connectingFromAnchor, setConnectingFromAnchor] = React.useState(null);
  const [openNodeId, setOpenNodeId] = React.useState(null);
  const [showPublish, setShowPublish] = React.useState(false);
  const [showBackup, setShowBackup] = React.useState(false);
  const [quickSaveStatus, setQuickSaveStatus] = React.useState('idle'); // idle | saving | saved | error
  const [copiedNode, setCopiedNode] = React.useState(null);
  const [lastPublishedSlug, setLastPublishedSlug] = React.useState(() => {
    try { return localStorage.getItem('fluxograma:last-slug') || ''; } catch (e) { return ''; }
  });
  const [showUserPanel, setShowUserPanel] = React.useState(false);
  const [showSimulatePanel, setShowSimulatePanel] = React.useState(false);
  const [userList, setUserList] = React.useState({ admins: [], users: [] });
  const [updateToast, setUpdateToast] = React.useState(false);
  const [pendingRequestsCount, setPendingRequestsCount] = React.useState(0);
  const [showRequestsPanel, setShowRequestsPanel] = React.useState(false);
  const [myRequests, setMyRequests] = React.useState({}); // nodeId → status
  const [accessToast, setAccessToast] = React.useState(null); // { status, nodeTitle }
  const [showAudit, setShowAudit] = React.useState(false);

  // Aplica subflows do serverDoc ao localStorage imediatamente no primeiro carregamento
  // para que as imagens apareçam sem esperar o applyLiveDoc assíncrono
  React.useEffect(() => {
    if (!PUBLISHED_SLUG && (!IS_ADMIN || SIMULATE_AS) && initial?.subflows) {
      try { localStorage.setItem('fluxograma:subflows:v1', JSON.stringify(initial.subflows)); } catch (_) {}
    }
  }, []);

  // Salva diretamente sobre o backup existente e sincroniza o live_doc para todos
  const quickSave = async () => {
    if (quickSaveStatus === 'saving') return;
    setQuickSaveStatus('saving');
    let subflows = {};
    try { subflows = JSON.parse(localStorage.getItem('fluxograma:subflows:v1') || '{}'); } catch (e) {}
    const base = baseDocRef.current;
    const docPayload = {
      nodes, edges, title: docTitle, flowTitle, flowLogo, flowTitleFont, flowTitleSize, legend, legendConfig, subflows,
      _baseNodes: base ? base.nodes : null, _baseEdges: base ? base.edges : null, _baseSubflows: base ? base.subflows : null,
    };
    try {
      // 1. Salva no backup (sobrescreve o existente ou cria novo)
      const listRes = await fetch('/api/backup/list');
      if (listRes.status === 401) { window.location.href = '/login'; return; }
      const listData = await listRes.json();
      const backups = listData.files || [];
      const backupBody = { data: docPayload };
      if (backups.length > 0) { backupBody.overwriteFile = backups[0].filename; } else { backupBody.name = 'fluxo'; }
      const bkRes = await fetch('/api/backup/save', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(backupBody) });
      if (!bkRes.ok) throw new Error('Falha ao salvar backup');

      // 2. Sincroniza o live_doc → notifica todos via SSE em tempo real
      const syncPayload = { ...docPayload };
      if (SIMULATE_AS) syncPayload.simulateAs = SIMULATE_AS;
      const syncRes = await fetch('/api/doc/sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(syncPayload) });
      if (syncRes.status === 401) { window.location.href = '/login'; return; }
      if (!syncRes.ok) throw new Error('Falha ao sincronizar');

      baseDocRef.current = { nodes, edges, subflows };
      setQuickSaveStatus('saved');
    } catch (e) {
      console.error('quickSave erro:', e.message);
      setQuickSaveStatus('error');
    }
    setTimeout(() => setQuickSaveStatus('idle'), 2500);
  };

  // carrega fluxo publicado quando em modo de visualização pública
  const loadPublished = React.useCallback((showToast) => {
    fetch(`/api/publish/load/${PUBLISHED_SLUG}`)
      .then((r) => r.json())
      .then((d) => {
        if (!d.ok || !d.data) return;
        if (d.data.nodes)    setNodes(d.data.nodes);
        if (d.data.edges)    setEdges(d.data.edges);
        if (d.data.title)    setDocTitle(d.data.title);
        if (d.data.flowTitle     != null) setFlowTitle(d.data.flowTitle);
        if (d.data.flowLogo      != null) setFlowLogo(d.data.flowLogo);
        if (d.data.flowTitleFont != null) setFlowTitleFont(d.data.flowTitleFont);
        if (d.data.flowTitleSize != null) setFlowTitleSize(d.data.flowTitleSize);
        if (d.data.legend       != null) setLegend(d.data.legend);
        if (d.data.legendConfig != null) setLegendConfig(d.data.legendConfig);
        if (d.data.subflows) {
          try { localStorage.setItem('fluxograma:subflows:v1', JSON.stringify(d.data.subflows)); } catch (e) {}
          window.dispatchEvent(new CustomEvent('subflows-updated'));
        }
        if (showToast) {
          setUpdateToast(true);
          setTimeout(() => setUpdateToast(false), 4000);
        }
      });
  }, []);

  // Carga inicial do fluxo publicado
  React.useEffect(() => {
    if (!PUBLISHED_SLUG) return;
    loadPublished(false);
  }, []);

  // SSE: ouve atualizações em tempo real enquanto a página está aberta
  React.useEffect(() => {
    if (!PUBLISHED_SLUG) return;
    const es = new EventSource(`/api/events/${PUBLISHED_SLUG}`);
    es.addEventListener('updated', () => loadPublished(true));
    return () => es.close();
  }, []);

  // Refs sempre atualizados — usados em closures estáveis para o sync
  const nodesRef          = React.useRef(nodes);
  const edgesRef          = React.useRef(edges);
  const docTitleRef       = React.useRef(docTitle);
  const flowTitleRef      = React.useRef(flowTitle);
  const flowLogoRef       = React.useRef(flowLogo);
  const flowTitleFontRef  = React.useRef(flowTitleFont);
  const flowTitleSizeRef  = React.useRef(flowTitleSize);
  const legendRef         = React.useRef(legend);
  const legendConfigRef   = React.useRef(legendConfig);
  // Base: último estado confirmado do servidor — usado para merge três-vias no sync
  const baseDocRef = React.useRef(serverDoc ? {
    nodes: serverDoc.nodes || [], edges: serverDoc.edges || [], subflows: serverDoc.subflows || {},
  } : null);
  React.useEffect(() => { nodesRef.current          = nodes;         }, [nodes]);
  React.useEffect(() => { edgesRef.current          = edges;         }, [edges]);
  React.useEffect(() => { docTitleRef.current       = docTitle;      }, [docTitle]);
  React.useEffect(() => { flowTitleRef.current      = flowTitle;     }, [flowTitle]);
  React.useEffect(() => { flowLogoRef.current       = flowLogo;      }, [flowLogo]);
  React.useEffect(() => { flowTitleFontRef.current  = flowTitleFont; }, [flowTitleFont]);
  React.useEffect(() => { flowTitleSizeRef.current  = flowTitleSize; }, [flowTitleSize]);
  React.useEffect(() => { legendRef.current         = legend;        }, [legend]);
  React.useEffect(() => { legendConfigRef.current   = legendConfig;  }, [legendConfig]);

  // Monta o payload completo do doc a partir dos refs
  const buildDocPayload = () => {
    let subflows = {};
    try { subflows = JSON.parse(localStorage.getItem('fluxograma:subflows:v1') || '{}'); } catch(e) {}
    const base = baseDocRef.current;
    return {
      nodes: nodesRef.current, edges: edgesRef.current,
      title: docTitleRef.current,
      subflows,
      flowTitle: flowTitleRef.current, flowLogo: flowLogoRef.current,
      flowTitleFont: flowTitleFontRef.current, flowTitleSize: flowTitleSizeRef.current,
      legend: legendRef.current, legendConfig: legendConfigRef.current,
      // Base para merge três-vias no servidor
      _baseNodes:    base ? base.nodes    : null,
      _baseEdges:    base ? base.edges    : null,
      _baseSubflows: base ? base.subflows : null,
    };
  };

  // Sync de doc live — envia para o banco via fetch (ou sendBeacon no unload)
  const syncTimer = React.useRef(null);
  const flushDocSync = (beacon = false) => {
    clearTimeout(syncTimer.current);
    const payload = JSON.stringify(buildDocPayload());
    if (beacon && navigator.sendBeacon) {
      navigator.sendBeacon('/api/doc/sync', new Blob([payload], { type: 'application/json' }));
    } else {
      fetch('/api/doc/sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload })
        .then(() => {
          let subflows = {};
          try { subflows = JSON.parse(localStorage.getItem('fluxograma:subflows:v1') || '{}'); } catch(_) {}
          baseDocRef.current = { nodes: nodesRef.current, edges: edgesRef.current, subflows };
        })
        .catch(() => {});
    }
  };
  const debouncedDocSync = () => {
    clearTimeout(syncTimer.current);
    syncTimer.current = setTimeout(() => flushDocSync(false), 800);
  };

  // Garante sync antes de fechar/recarregar a página
  React.useEffect(() => {
    if (!IS_ADMIN || SIMULATE_AS || PUBLISHED_SLUG) return;
    const onUnload = () => flushDocSync(true);
    window.addEventListener('beforeunload', onUnload);
    return () => window.removeEventListener('beforeunload', onUnload);
  }, []);

  // Carrega o último slug publicado do banco (para não perder referência entre sessões/dispositivos)
  React.useEffect(() => {
    if (!IS_ADMIN || PUBLISHED_SLUG) return;
    fetch('/api/publish/last-slug')
      .then(r => r.json())
      .then(d => {
        if (d.ok && d.slug) {
          setLastPublishedSlug(d.slug);
          try { localStorage.setItem('fluxograma:last-slug', d.slug); } catch (_) {}
        }
      })
      .catch(() => {});
  }, []);

  // SSE global: recebe atualizações de permissões em tempo real
  React.useEffect(() => {
    if (!CURRENT_USER || PUBLISHED_SLUG) return;

    // Aplica o doc completo do servidor (nodes, edges, title)
    const applyLiveDoc = () => {
      fetch('/api/doc/live')
        .then(r => r.json())
        .then(d => {
          if (!d.ok || !d.data) return;
          if (Array.isArray(d.data.nodes)) setNodes(d.data.nodes);
          if (Array.isArray(d.data.edges)) setEdges(d.data.edges);
          if (d.data.title)            setDocTitle(d.data.title);
          if (d.data.flowTitle     != null) setFlowTitle(d.data.flowTitle);
          if (d.data.flowLogo      != null) setFlowLogo(d.data.flowLogo);
          if (d.data.flowTitleFont != null) setFlowTitleFont(d.data.flowTitleFont);
          if (d.data.flowTitleSize != null) setFlowTitleSize(d.data.flowTitleSize);
          if (d.data.legend        != null) setLegend(d.data.legend);
          if (d.data.legendConfig  != null) setLegendConfig(d.data.legendConfig);
          // Subflows ficam no localStorage — sincronizar junto com o resto
          if (d.data.subflows) {
            try { localStorage.setItem('fluxograma:subflows:v1', JSON.stringify(d.data.subflows)); } catch (_) {}
            window.dispatchEvent(new CustomEvent('subflows-updated'));
          }
          // Atualiza base para o próximo merge três-vias
          let sf = {};
          try { sf = JSON.parse(localStorage.getItem('fluxograma:subflows:v1') || '{}'); } catch (_) {}
          baseDocRef.current = { nodes: d.data.nodes || [], edges: d.data.edges || [], subflows: d.data.subflows || sf };
        })
        .catch(() => {});
    };

    // Em modo simulação ou usuário comum: sincroniza ao abrir
    if (!IS_ADMIN || SIMULATE_AS) applyLiveDoc();

    const es = new EventSource('/api/events/__main__');

    // Alguém salvou → atualiza doc completo; ignora apenas a própria atualização
    es.addEventListener('doc_updated', (e) => {
      try {
        const data = JSON.parse(e.data);
        if (!SIMULATE_AS && data.by === CURRENT_USER?.email) return;
      } catch (_) {}
      applyLiveDoc();
    });

    // Admin alterou lista de usuários → recarrega ou derruba acesso
    es.addEventListener('users_updated', (e) => {
      try {
        const data = JSON.parse(e.data);
        const activeEmails = (data.users || []).map(u => u.email);
        // Usuário foi removido → derruba sessão
        if (activeEmails.length > 0 && !activeEmails.includes(CURRENT_USER.email)) {
          window.location.href = '/login';
          return;
        }
        // Status de admin mudou → recarrega para atualizar permissões
        const isNowAdmin = (data.admins || []).includes(CURRENT_USER.email);
        if (isNowAdmin !== IS_ADMIN) window.location.reload();
      } catch(_) {}
    });

    // Nova solicitação recebida → admin atualiza badge
    es.addEventListener('access_request_new', () => {
      if (IS_ADMIN && !SIMULATE_AS) {
        setPendingRequestsCount(n => n + 1);
      }
    });

    // Solicitação resolvida → usuário recebe toast e atualiza status local
    es.addEventListener('access_request_resolved', (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.status === 'approved') {
          // Atualiza só o allowedUsers do nó específico — sem sobrescrever o doc inteiro
          setNodes(prev => prev.map(n => {
            if (n.id !== data.nodeId) return n;
            const au = Array.isArray(n.allowedUsers) ? n.allowedUsers : [];
            if (au.includes(data.requesterEmail)) return n;
            return { ...n, allowedUsers: [...au, data.requesterEmail] };
          }));
        }
        // Usuário real ou admin simulando: verifica se é para este "ator"
        const actingEmail = SIMULATE_AS || CURRENT_USER?.email;
        if (actingEmail === data.requesterEmail) {
          setMyRequests(prev => ({ ...prev, [data.nodeId]: data.status }));
          setAccessToast({ status: data.status, nodeId: data.nodeId });
          setTimeout(() => setAccessToast(null), 5000);
        }
        if (IS_ADMIN && !SIMULATE_AS) {
          setPendingRequestsCount(n => Math.max(0, n - 1));
        }
      } catch(_) {}
    });

    return () => es.close();
  }, []);

  // persiste qualquer mudança (não no modo publicado)
  React.useEffect(() => {
    if (PUBLISHED_SLUG) return;
    saveDoc({ nodes, edges, title: docTitle, flowTitle, flowLogo, flowTitleFont, flowTitleSize, legend, legendConfig });
    if (IS_ADMIN && !SIMULATE_AS) debouncedDocSync();
  }, [nodes, edges, docTitle, flowTitle, flowLogo, flowTitleFont, flowTitleSize, legend, legendConfig]);

  const visibleEdges = React.useMemo(() => {
    if (t.showLabels) return edges;
    return edges.map((e) => ({ ...e, label: undefined }));
  }, [edges, t.showLabels]);

  const updateNode = (id, patch) => {
    setNodes((ns) => ns.map((n) => n.id === id ? { ...n, ...patch } : n));
  };
  const deleteNode = (id) => {
    setNodes((ns) => ns.filter((n) => n.id !== id));
    setEdges((es) => es.filter((e) => e.from !== id && e.to !== id));
    setSelectedNodeId(null);
  };
  const addNode = (shape, color) => {
    const id = uid(shape);
    let w, h, label;
    if (shape === 'zone')    { w = 340; h = 240; label = 'Área'; }
    else if (shape === 'text')    { w = 180; h = 60;  label = 'Texto livre'; }
    else if (shape === 'diamond') { w = 160; h = 100; label = 'Decisão'; }
    else if (shape === 'pill')    { w = 160; h = 50;  label = 'Nova etapa'; }
    else                          { w = 200; h = 80;  label = 'Nova etapa'; }
    setNodes((ns) => [...ns, {
      id, label, x: 200, y: 200, w, h, shape, color,
      hasSubflow: shape !== 'diamond' && shape !== 'text' && shape !== 'zone',
    }]);
    setSelectedNodeId(id);
    setSelectedEdgeIdx(null);
  };
  const updateEdge = (idx, patch) => {
    setEdges((es) => es.map((e, i) => i === idx ? { ...e, ...patch } : e));
  };
  const handleUpdateEdgeMid = (idx, mid) => updateEdge(idx, { mid });
  const deleteEdge = (idx) => {
    setEdges((es) => es.filter((_, i) => i !== idx));
    setSelectedEdgeIdx(null);
  };

  const duplicateNode = (id) => {
    const node = nodes.find((n) => n.id === id);
    if (!node) return;
    const newId = uid(node.shape || 'rect');
    setNodes((ns) => [...ns, { ...node, id: newId, x: node.x + 20, y: node.y + 20 }]);
    setSelectedNodeId(newId);
    setSelectedEdgeIdx(null);
  };

  const handleDropNode = (shape, color, wx, wy) => {
    const id = uid(shape);
    let w, h, label;
    if (shape === 'zone')         { w = 340; h = 240; label = 'Área'; }
    else if (shape === 'text')    { w = 180; h = 60;  label = 'Texto livre'; }
    else if (shape === 'diamond') { w = 160; h = 100; label = 'Decisão'; }
    else if (shape === 'pill')    { w = 160; h = 50;  label = 'Nova etapa'; }
    else                          { w = 200; h = 80;  label = 'Nova etapa'; }
    setNodes((ns) => [...ns, {
      id, label,
      x: Math.round(wx - w / 2),
      y: Math.round(wy - h / 2),
      w, h, shape, color,
      hasSubflow: shape !== 'diamond' && shape !== 'text' && shape !== 'zone',
    }]);
    setSelectedNodeId(id);
    setSelectedEdgeIdx(null);
  };

  const startConnect = (id) => {
    setConnectingFromId(id);
    setConnectingFromAnchor(null);
    setSelectedNodeId(null);
    setSelectedEdgeIdx(null);
  };

  const handleFromAnchorPick = (side, offset) => {
    setConnectingFromAnchor({ side, offset: offset !== 0 ? offset : undefined });
  };

  const handleToAnchorPick = (targetNodeId, side, offset) => {
    if (!connectingFromAnchor || targetNodeId === connectingFromId) return;
    const newEdge = {
      from: connectingFromId,
      to: targetNodeId,
      fromSide: connectingFromAnchor.side,
      fromOffset: connectingFromAnchor.offset,
      toSide: side,
      toOffset: offset !== 0 ? offset : undefined,
    };
    setEdges((es) => [...es, newEdge]);
    setSelectedEdgeIdx(edges.length);
    setConnectingFromId(null);
    setConnectingFromAnchor(null);
  };

  const cancelConnect = () => {
    setConnectingFromId(null);
    setConnectingFromAnchor(null);
  };

  const handleImport = (data) => {
    if (data.nodes) setNodes(data.nodes);
    if (data.edges) setEdges(data.edges);
    if (data.title) setDocTitle(data.title);
    if (data.flowTitle     != null) setFlowTitle(data.flowTitle);
    if (data.flowLogo      != null) setFlowLogo(data.flowLogo);
    if (data.flowTitleFont != null) setFlowTitleFont(data.flowTitleFont);
    if (data.flowTitleSize != null) setFlowTitleSize(data.flowTitleSize);
    if (data.legend        != null) setLegend(data.legend);
    if (data.legendConfig  != null) setLegendConfig(data.legendConfig);
    if (data.subflows) {
      try { localStorage.setItem('fluxograma:subflows:v1', JSON.stringify(data.subflows)); } catch (e) {}
      window.dispatchEvent(new CustomEvent('subflows-updated'));
    }
  };

  const reset = () => {
    if (!confirm('Restaurar o fluxograma original? Suas edições nas caixas e setas serão perdidas (os sub-fluxos preenchidos serão mantidos).')) return;
    setNodes(SEED_NODES);
    setEdges(SEED_EDGES);
    setSelectedNodeId(null);
    setSelectedEdgeIdx(null);
  };

  // carrega lista de usuários para admins
  React.useEffect(() => {
    if (!IS_ADMIN) return;
    fetch('/api/users')
      .then(r => r.json())
      .then(d => { if (d.ok) setUserList(d.data); });
  }, []);

  // carrega solicitações: admin vê contagem pendente; usuário (ou simulado) vê suas próprias
  React.useEffect(() => {
    if (PUBLISHED_SLUG || !CURRENT_USER) return;
    if (IS_ADMIN && !SIMULATE_AS) {
      fetch('/api/access-requests')
        .then(r => r.json())
        .then(d => { if (d.ok) setPendingRequestsCount(d.requests.length); });
    } else {
      const url = SIMULATE_AS
        ? `/api/access-request/mine?simulate_as=${encodeURIComponent(SIMULATE_AS)}`
        : '/api/access-request/mine';
      fetch(url)
        .then(r => r.json())
        .then(d => { if (d.ok) setMyRequests(d.requests); });
    }
  }, []);

  const requestAccess = async (nodeId, nodeTitle) => {
    const body = { nodeId, nodeTitle };
    if (SIMULATE_AS) body.simulateAs = SIMULATE_AS;
    const res = await fetch('/api/access-request', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (res.ok) {
      setMyRequests(prev => ({ ...prev, [nodeId]: 'pending' }));
    }
  };

  const enterEditor = () => { setEditorMode(true); setOpenNodeId(null); };
  const exitEditor = () => {
    setEditorMode(false);
    setSelectedNodeId(null); setSelectedEdgeIdx(null);
    setConnectingFromId(null); setConnectingFromAnchor(null);
  };

  const handleNodeClickView = (node) => {
    if (editorMode) return;
    if (node.isLegend) return;
    if (node.shape === 'text' || node.shape === 'zone') return;
    if (node.hasSubflow === false) return;
    setOpenNodeId(node.id);
  };
  const handleSelectNode = (id) => { setSelectedNodeId(id); setSelectedEdgeIdx(null); };
  const handleSelectEdge = (idx) => { setSelectedEdgeIdx(idx); setSelectedNodeId(null); };
  const handleCanvasMouseDown = () => {
    if (editorMode && !connectingFromId) {
      setSelectedNodeId(null); setSelectedEdgeIdx(null);
    }
  };

  // teclas de atalho no editor
  React.useEffect(() => {
    if (!editorMode) return;
    const ARROW = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    const onKey = (e) => {
      const inInput = document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA';
      const mod = e.ctrlKey || e.metaKey;

      if ((e.key === 'Delete' || e.key === 'Backspace') && !inInput) {
        if (selectedNodeId) deleteNode(selectedNodeId);
        else if (selectedEdgeIdx != null) deleteEdge(selectedEdgeIdx);
      }
      if (e.key === 'Escape') {
        setConnectingFromId(null);
        setConnectingFromAnchor(null);
        setSelectedNodeId(null); setSelectedEdgeIdx(null);
      }
      if (ARROW[e.key] && selectedNodeId && !inInput) {
        e.preventDefault();
        const fine = e.ctrlKey || e.metaKey;
        const step = e.shiftKey ? 20 : fine ? 0.5 : 2;
        const [dx, dy] = ARROW[e.key];
        setNodes((ns) => ns.map((n) => {
          if (n.id !== selectedNodeId) return n;
          const nx = n.x + dx * step;
          const ny = n.y + dy * step;
          return { ...n, x: fine ? nx : Math.round(nx), y: fine ? ny : Math.round(ny) };
        }));
      }
      // Ctrl+C — copiar nó selecionado
      if (mod && e.key === 'c' && selectedNodeId && !inInput) {
        const node = nodes.find((n) => n.id === selectedNodeId);
        if (node) setCopiedNode({ ...node });
      }
      // Ctrl+V — colar cópia (offset +20px a cada colagem)
      if (mod && e.key === 'v' && copiedNode && !inInput) {
        e.preventDefault();
        const newId = uid(copiedNode.shape || 'rect');
        setNodes((ns) => [...ns, { ...copiedNode, id: newId }]);
        setSelectedNodeId(newId);
        setSelectedEdgeIdx(null);
        setCopiedNode((prev) => prev ? { ...prev, x: prev.x + 20, y: prev.y + 20 } : null);
      }
      // Ctrl+D — duplicar nó selecionado direto
      if (mod && e.key === 'd' && selectedNodeId && !inInput) {
        e.preventDefault();
        const node = nodes.find((n) => n.id === selectedNodeId);
        if (node) {
          const newId = uid(node.shape || 'rect');
          setNodes((ns) => [...ns, { ...node, id: newId, x: node.x + 20, y: node.y + 20 }]);
          setSelectedNodeId(newId);
          setSelectedEdgeIdx(null);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editorMode, selectedNodeId, selectedEdgeIdx, nodes, copiedNode]);

  const filledCount = React.useMemo(() => {
    try { return Object.keys(JSON.parse(localStorage.getItem('fluxograma:subflows:v1') || '{}')).length; }
    catch (e) { return 0; }
  }, [openNodeId, showPublish]);

  const selectedNode = nodes.find((n) => n.id === selectedNodeId);
  const openNode     = openNodeId ? (nodes.find((n) => n.id === openNodeId) || null) : null;
  const selectedEdge = selectedEdgeIdx != null ? edges[selectedEdgeIdx] : null;

  return (
    <div className={'app' + (editorMode ? ' editor-on' : '')}>
      {/* ── Botão flutuante para reabrir o menu (link publicado colapsado) ── */}
      {PUBLISHED_SLUG && !topbarVisible && (
        <button className="topbar-show-btn" onClick={() => setTopbarVisible(true)} title="Mostrar menu">
          ▼
        </button>
      )}

      {SIMULATE_AS && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, zIndex: 10000,
          background: '#f59e0b', color: '#1a1a1a',
          height: 32, padding: '0 16px', display: 'flex', alignItems: 'center', gap: 10,
          fontSize: 12, fontWeight: 600, boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
        }}>
          <span>Simulando como: <b>{SIMULATE_AS}</b></span>
          <button onClick={() => window.close()}
                  style={{ marginLeft: 'auto', background: 'rgba(0,0,0,0.12)', border: 'none',
                           borderRadius: 4, padding: '3px 12px', cursor: 'pointer',
                           fontSize: 12, fontWeight: 600 }}>
            × Fechar janela
          </button>
        </div>
      )}

      {(!PUBLISHED_SLUG || topbarVisible) && (
        <>
        <header className="topbar" style={SIMULATE_AS ? { marginTop: 32 } : undefined}>
          <div className="topbar-left">
            <div className="logo">
              <span className="logo-mark" />
              <span>Fluxos</span>
            </div>
            <div className="divider" />
            <div className="doc-title">
              <input value={docTitle} onChange={(e) => setDocTitle(e.target.value)} />
              <span className="doc-meta">
                {editorMode ? <><span className="dot-rec" /> Editando · alterações salvas automaticamente</> : 'Modo visualização · clique nas caixas'}
              </span>
            </div>
          </div>
          <div className="topbar-right">
            {!editorMode && (
              <div className="legend">
                <span><i style={{ background: '#dbeaff', borderColor: '#1f5dbb' }} />Captação</span>
                <span><i style={{ background: '#c7e7c4', borderColor: '#3d8c4d' }} />Pós-reunião</span>
                <span><i style={{ background: '#fde0c7', borderColor: '#c97639' }} />Pós-contrato</span>
                <span><i className="diamond" style={{ background: '#fff2a8', borderColor: '#caa628' }} />Decisão</span>
              </div>
            )}
            {PUBLISHED_SLUG ? (
              <span style={{ fontSize: 12, color: '#6b6b66' }}>Visualização pública · somente leitura</span>
            ) : !editorMode ? (
              <>
                {IS_ADMIN && <button className="btn-ghost" onClick={enterEditor}>✎ Editar</button>}
                {IS_ADMIN ? (
                  <button className="btn-ghost" onClick={() => setShowBackup(true)}>💾 Backup</button>
                ) : (
                  <button
                    className="btn-ghost"
                    onClick={quickSave}
                    disabled={quickSaveStatus === 'saving'}
                    style={quickSaveStatus === 'saved' ? { color: '#3d8c4d', fontWeight: 600 } : quickSaveStatus === 'error' ? { color: '#a52828' } : {}}
                  >
                    {quickSaveStatus === 'saving' ? '💾 Salvando…' :
                     quickSaveStatus === 'saved'  ? '✓ Salvo!' :
                     quickSaveStatus === 'error'  ? '✗ Erro ao salvar' :
                     '💾 Salvar'}
                  </button>
                )}
                {IS_ADMIN && <button className="btn-primary" onClick={() => setShowPublish(true)}>Publicar</button>}
              </>
            ) : (
              <>
                <button className="btn-ghost" onClick={() => setShowBackup(true)}>💾 Backup</button>
                <button className="btn-primary" onClick={exitEditor}>✓ Concluir</button>
              </>
            )}
            {CURRENT_USER && !PUBLISHED_SLUG && (
              <>
                {IS_ADMIN && (
                  <>
                    <button className="btn-ghost" style={{ fontSize: 12 }} onClick={() => setShowUserPanel(true)}>
                      👥 Usuários
                    </button>
                    <button className="btn-ghost" style={{ fontSize: 12, position: 'relative' }}
                            onClick={() => setShowRequestsPanel(true)}>
                      🔔 Acessos
                      {pendingRequestsCount > 0 && (
                        <span style={{ position: 'absolute', top: -4, right: -4, background: '#c97639',
                                       color: '#fff', borderRadius: '50%', width: 16, height: 16,
                                       fontSize: 10, fontWeight: 700, display: 'flex',
                                       alignItems: 'center', justifyContent: 'center' }}>
                          {pendingRequestsCount}
                        </span>
                      )}
                    </button>
                    {!SIMULATE_AS && (
                      <button className="btn-ghost" style={{ fontSize: 12 }} onClick={() => setShowSimulatePanel(true)}>
                        Simular
                      </button>
                    )}
                    <button className="btn-ghost" style={{ fontSize: 12 }} onClick={() => setShowAudit(true)}>
                      📋 Auditoria
                    </button>
                  </>
                )}
                <span style={{ fontSize: 12, color: '#6b6b66', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={CURRENT_USER.email}>
                  {CURRENT_USER.email}
                </span>
              </>
            )}
            {PUBLISHED_SLUG && (
              <button className="topbar-hide-btn" onClick={() => setTopbarVisible(false)} title="Esconder menu">▲</button>
            )}
          </div>
        </header>

        {editorMode && (
          <EditorToolbar onAdd={addNode} onReset={reset} onExit={exitEditor} isAdmin={IS_ADMIN} />
        )}

        {!editorMode && (
          <div className="hint">
            <span>👆 Clique em qualquer caixa para abrir o sub-fluxo.</span>
            <span className="dot">·</span>
            <span>Arraste para mover · Scroll para zoom</span>
            <span className="dot">·</span>
            <span><b>{filledCount}</b> sub-fluxo{filledCount === 1 ? '' : 's'} preenchido{filledCount === 1 ? '' : 's'}</span>
          </div>
        )}
        {editorMode && !selectedNode && !selectedEdge && !connectingFromId && (
          <div className="hint">
            <span>✏️ Modo edição: clique numa caixa ou seta para editar · arraste pra mover · cantos pra redimensionar · Delete pra excluir</span>
          </div>
        )}
        </>
      )}

      {/* ── Capa do fluxo: logotipo + título principal ── */}
      {(flowLogo || flowTitle || (editorMode && IS_ADMIN)) && (
        editorMode && IS_ADMIN && coverCollapsed ? (
          <div className="section-strip" onClick={() => setCoverCollapsed(false)}>
            <span className="section-strip-icon">▶</span>
            <span>Capa (logo + título)</span>
          </div>
        ) :
        <div className="flow-cover" style={{ background: `rgba(246,245,241,${(legendConfig.coverOpacity ?? 100) / 100})`, position: 'relative' }}>
          {/* Logotipo */}
          <div className="flow-cover-logo-wrap">
            {flowLogo ? (
              <>
                <img src={flowLogo} alt="Logo" className="flow-cover-logo" />
                {editorMode && IS_ADMIN && (
                  <button className="flow-cover-logo-remove" title="Remover logo"
                          onClick={() => setFlowLogo('')}>×</button>
                )}
              </>
            ) : editorMode && IS_ADMIN && (
              <label className="flow-cover-logo-add">
                <input type="file" accept="image/*" style={{ display: 'none' }}
                       onChange={(e) => {
                         const file = e.target.files?.[0];
                         if (!file) return;
                         const reader = new FileReader();
                         reader.onload = (ev) => {
                           fetch('/api/images/upload', {
                             method: 'POST',
                             headers: { 'Content-Type': 'application/json' },
                             body: JSON.stringify({ filename: file.name, data: ev.target.result }),
                           }).then(r => r.json()).then(d => { if (d.ok) setFlowLogo(d.url); });
                         };
                         reader.readAsDataURL(file);
                         e.target.value = '';
                       }} />
                + Adicionar logotipo
              </label>
            )}
          </div>

          {/* Título grande */}
          {editorMode && IS_ADMIN ? (
            <>
              <input
                className="flow-cover-title-input"
                value={flowTitle}
                onChange={(e) => setFlowTitle(e.target.value)}
                placeholder="Título do fluxo (opcional)"
                style={{ fontFamily: titleFontCss(flowTitleFont), fontSize: flowTitleSize }}
              />
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', justifyContent: 'center' }}>
                <select value={flowTitleFont} onChange={(e) => setFlowTitleFont(e.target.value)}
                        style={{ fontSize: 12, padding: '3px 8px', borderRadius: 5, border: '1px solid rgba(0,0,0,0.18)',
                                 background: 'var(--card)', color: 'var(--ink)', fontFamily: 'inherit', cursor: 'pointer' }}>
                  {TITLE_FONTS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
                </select>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <button className="btn-ghost"
                          style={{ width: 30, padding: 0, fontSize: 13, fontWeight: 700 }}
                          onClick={() => setFlowTitleSize(s => Math.max(18, s - 2))}>A−</button>
                  <span style={{ minWidth: 38, textAlign: 'center', fontSize: 12, fontVariantNumeric: 'tabular-nums' }}>{flowTitleSize}px</span>
                  <button className="btn-ghost"
                          style={{ width: 30, padding: 0, fontSize: 13, fontWeight: 700 }}
                          onClick={() => setFlowTitleSize(s => Math.min(80, s + 2))}>A+</button>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                  <span style={{ fontSize: 11, color: 'var(--ink-mute)', whiteSpace: 'nowrap' }}>Opacidade capa</span>
                  <input type="range" min="10" max="100" step="5"
                         value={legendConfig.coverOpacity ?? 100}
                         onChange={(e) => setLegendConfig(c => ({ ...c, coverOpacity: Number(e.target.value) }))}
                         className="lf-opacity-range" />
                  <span style={{ minWidth: 34, textAlign: 'center', fontSize: 11, fontVariantNumeric: 'tabular-nums' }}>{legendConfig.coverOpacity ?? 100}%</span>
                </div>
              </div>
            </>
          ) : flowTitle ? (
            <h1 className="flow-cover-title"
                style={{ fontFamily: titleFontCss(flowTitleFont), fontSize: flowTitleSize }}>{flowTitle}</h1>
          ) : null}
          {editorMode && IS_ADMIN && (
            <button className="section-collapse-btn" title="Recolher capa"
                    onClick={() => setCoverCollapsed(true)}>▲ Recolher</button>
          )}
        </div>
      )}

      <div className="canvas-wrap">
        <FlowchartCanvas
          nodes={nodes} edges={visibleEdges}
          onNodeClick={handleNodeClickView}
          editorMode={editorMode}
          selectedNodeId={selectedNodeId}
          selectedEdgeIdx={selectedEdgeIdx}
          onSelectNode={handleSelectNode}
          onSelectEdge={handleSelectEdge}
          onMoveNode={updateNode}
          onResizeNode={updateNode}
          connectingFromId={connectingFromId}
          connectingFromAnchor={connectingFromAnchor}
          onFromAnchorPick={handleFromAnchorPick}
          onToAnchorPick={handleToAnchorPick}
          onCancelConnect={cancelConnect}
          onUpdateEdgeMid={handleUpdateEdgeMid}
          onCanvasMouseDown={handleCanvasMouseDown}
          onDropNode={editorMode ? handleDropNode : undefined}
          canEditNode={PUBLISHED_SLUG ? undefined : canEditNode}
          initialZoom={!editorMode ? 0.51 : undefined}
        />

        {editorMode && selectedNode && (
          <NodeInspector
            node={selectedNode}
            onChange={(p) => updateNode(selectedNode.id, p)}
            onDelete={deleteNode}
            onConnect={startConnect}
            onEditSubflow={() => setOpenNodeId(selectedNode?.id)}
            onDuplicate={() => duplicateNode(selectedNodeId)}
            onClose={() => setSelectedNodeId(null)}
            userList={userList}
          />
        )}
        {editorMode && selectedEdge && (
          <EdgeInspector
            edge={selectedEdge} idx={selectedEdgeIdx}
            onChange={(p) => updateEdge(selectedEdgeIdx, p)}
            onDelete={deleteEdge}
            onClose={() => setSelectedEdgeIdx(null)}
          />
        )}
      </div>

      {openNode && (
        <NodeModal node={openNode} popupStyle={t.popupStyle}
                   editorMode={editorMode || canEditNode(openNode)}
                   onClose={() => setOpenNodeId(null)}
                   onRequestAccess={!IS_ADMIN && !PUBLISHED_SLUG && !canEditNode(openNode) ? requestAccess : undefined}
                   requestStatus={myRequests[openNode?.id]}
                   onSubflowChange={IS_ADMIN && !SIMULATE_AS ? debouncedDocSync : undefined} />
      )}
      {showPublish && (
        <PublishDialog
          onClose={() => setShowPublish(false)}
          nodes={nodes} edges={edges} docTitle={docTitle} flowTitle={flowTitle} flowLogo={flowLogo} flowTitleFont={flowTitleFont} flowTitleSize={flowTitleSize} legend={legend} legendConfig={legendConfig}
          lastSlug={lastPublishedSlug}
          onPublished={(slug) => {
            setLastPublishedSlug(slug);
            try { localStorage.setItem('fluxograma:last-slug', slug); } catch (e) {}
          }}
        />
      )}
      {showBackup && <BackupModal nodes={nodes} edges={edges} docTitle={docTitle} flowTitle={flowTitle} flowLogo={flowLogo} flowTitleFont={flowTitleFont} flowTitleSize={flowTitleSize} legend={legend} legendConfig={legendConfig}
                                  onClose={() => setShowBackup(false)} onImport={handleImport} />}
      {showUserPanel && (
        <UserPanel
          onClose={() => setShowUserPanel(false)}
          onSaved={(updated) => setUserList(updated)}
        />
      )}
      {showSimulatePanel && (
        <SimulatePanel onClose={() => setShowSimulatePanel(false)} />
      )}
      {showRequestsPanel && (
        <RequestsPanel
          onClose={() => setShowRequestsPanel(false)}
          onResolve={() => setPendingRequestsCount(n => Math.max(0, n - 1))}
        />
      )}
      {showAudit && <AuditModal onClose={() => setShowAudit(false)} />}
      {accessToast && (
        <div style={{ position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)',
                      zIndex: 9999, background: accessToast.status === 'approved' ? '#3d8c4d' : '#a52828',
                      color: '#fff', padding: '12px 24px', borderRadius: 10, fontWeight: 600,
                      fontSize: 14, boxShadow: '0 4px 20px rgba(0,0,0,0.2)', maxWidth: 380, textAlign: 'center' }}>
          {accessToast.status === 'approved'
            ? '✓ Acesso aprovado! Recarregue a página para editar.'
            : '✗ Sua solicitação de acesso foi reprovada.'}
        </div>
      )}

      <LegendFooter
        legend={legend}
        legendConfig={legendConfig}
        editorMode={editorMode}
        isAdmin={IS_ADMIN}
        onChange={setLegend}
        onConfigChange={setLegendConfig}
        collapsed={legendCollapsed}
        onToggleCollapse={() => setLegendCollapsed(c => !c)}
      />

      <TweaksPanel title="Tweaks">
        <TweakSection label="Popup das etapas">
          <TweakSelect label="Estilo" value={t.popupStyle}
                       options={[
                         { value: 'modal', label: 'Modal centralizado' },
                         { value: 'drawer', label: 'Drawer lateral' },
                         { value: 'drill', label: 'Drill-down' },
                       ]}
                       onChange={(v) => setTweak('popupStyle', v)} />
          <TweakButton label="Abrir um exemplo"
                       onClick={() => { setEditorMode(false); setOpenNodeId((nodes.find(n => n.id === 'sdr_pipe') || nodes[0])?.id); }} />
        </TweakSection>
        <TweakSection label="Canvas">
          <TweakToggle label="Labels nas setas"
                       value={t.showLabels} onChange={(v) => setTweak('showLabels', v)} />
        </TweakSection>
      </TweaksPanel>

      {updateToast && (
        <div style={{
          position: 'fixed', bottom: 28, left: '50%', transform: 'translateX(-50%)',
          background: '#1a1a1a', color: '#fff',
          padding: '11px 22px', borderRadius: 10,
          fontSize: 13.5, fontWeight: 600,
          boxShadow: '0 6px 24px rgba(0,0,0,0.25)',
          zIndex: 9999, pointerEvents: 'none',
          display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <span style={{ fontSize: 16 }}>↺</span> Fluxo atualizado
        </div>
      )}
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
