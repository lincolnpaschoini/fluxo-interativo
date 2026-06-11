// flowchart-app.jsx
// App principal: header, editor, canvas, inspector, modal e publish.

const { FlowchartCanvas, NodeModal, NODE_COLORS } = window;
const LIVE_DOC = window.__LIVE_DOC__ || null;
const { NODES: SEED_NODES, EDGES: SEED_EDGES } = window.FLOWCHART;

const PUBLISHED_SLUG    = window.__PUBLISHED_SLUG__    || null;
const PUBLISHED_ENVS    = window.__PUBLISHED_ENVS__    || [];
const PUBLISHED_ENV_ID  = window.__PUBLISHED_ENV_ID__  || null;
// Persiste a ultima escolha de ambiente para um link publicado (LS por slug)
const PUBLISHED_ENV_LS_KEY = PUBLISHED_SLUG ? `fluxograma:pub-env:${PUBLISHED_SLUG}` : null;

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
const INITIAL_ENVIRONMENTS = window.__ENVIRONMENTS__ || [];
const INITIAL_CURRENT_ENV  = window.__CURRENT_ENV__  || null;
const TAB_ID         = Math.random().toString(36).slice(2); // ID único por aba — distingue "eu salvei" de "outra aba minha salvou"

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
  const [envList, setEnvList] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState(null);
  const [newAdminEmail, setNewAdminEmail] = React.useState('');
  const [newUserEmail, setNewUserEmail] = React.useState('');
  const [newUserName, setNewUserName] = React.useState('');
  const [expandedUser, setExpandedUser] = React.useState(null);

  React.useEffect(() => {
    Promise.all([
      fetch('/api/users').then(r => r.json()),
      fetch('/api/environments').then(r => r.json()),
    ]).then(([u, e]) => {
      if (u.ok) setData(u.data);
      if (e.ok) setEnvList(e.environments || []);
      setLoading(false);
    }).catch(() => { setError('Erro ao carregar dados.'); setLoading(false); });
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
      users: d.users.some(u => u.email === email) ? d.users : [...d.users, { email, name: email.split('@')[0], environments: envList.map(e => e.id) }],
    }));
    setNewAdminEmail('');
  };

  const removeAdmin = (email) => setData(d => ({ ...d, admins: d.admins.filter(a => a !== email) }));

  const addUser = () => {
    const email = newUserEmail.trim().toLowerCase();
    if (!email || !email.includes('@')) return;
    if (data.users.some(u => u.email === email)) return;
    const name = newUserName.trim() || email.split('@')[0];
    // Novo usuário comum: por padrão sem nenhum ambiente — admin precisa atribuir explicitamente
    setData(d => ({ ...d, users: [...d.users, { email, name, environments: [] }] }));
    setNewUserEmail(''); setNewUserName('');
  };

  const removeUser = (email) => setData(d => ({ ...d, users: d.users.filter(u => u.email !== email) }));

  const toggleUserEnv = (email, envId) => {
    setData(d => ({
      ...d,
      users: d.users.map(u => {
        if (u.email !== email) return u;
        const envs = new Set(u.environments || []);
        if (envs.has(envId)) envs.delete(envId); else envs.add(envId);
        return { ...u, environments: [...envs] };
      }),
    }));
  };

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
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 10, maxHeight: 280, overflowY: 'auto' }}>
                {data.users.map(u => {
                  const isAdminUser = data.admins.includes(u.email);
                  const expanded = expandedUser === u.email;
                  const userEnvs = u.environments || [];
                  return (
                    <div key={u.email} style={{ background: '#f4faf4', borderRadius: 6 }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 10px' }}>
                        <span style={{ fontSize: 13, minWidth: 0, flex: 1 }}>
                          <b>{u.name}</b>
                          <span style={{ color: '#6b6b66', marginLeft: 5 }}>({u.email})</span>
                          {isAdminUser && (
                            <span style={{ fontSize: 10, background: '#1f5dbb', color: '#fff', borderRadius: 3, padding: '1px 5px', marginLeft: 6 }}>ADMIN</span>
                          )}
                          {!isAdminUser && envList.length > 0 && (
                            <span style={{ fontSize: 10, color: '#6b6b66', marginLeft: 6 }}>
                              · {userEnvs.length} ambiente{userEnvs.length === 1 ? '' : 's'}
                            </span>
                          )}
                        </span>
                        {!isAdminUser && envList.length > 0 && (
                          <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#1f5dbb', fontSize: 11, padding: '0 6px', fontWeight: 600 }}
                                  onClick={() => setExpandedUser(expanded ? null : u.email)}>
                            {expanded ? '▲ ambientes' : '▼ ambientes'}
                          </button>
                        )}
                        <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#a52828', fontSize: 18, padding: '0 4px', lineHeight: 1, flexShrink: 0 }}
                                onClick={() => removeUser(u.email)} title="Remover">×</button>
                      </div>
                      {expanded && !isAdminUser && (
                        <div style={{ borderTop: '1px solid rgba(0,0,0,0.08)', padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 4 }}>
                          <div style={{ fontSize: 10, fontWeight: 700, color: '#3d8c4d', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 2 }}>
                            Ambientes que pode acessar
                          </div>
                          {envList.map(env => (
                            <label key={env.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 6px', borderRadius: 4, cursor: 'pointer', fontSize: 12 }}>
                              <input type="checkbox"
                                     checked={userEnvs.includes(env.id)}
                                     onChange={() => toggleUserEnv(u.email, env.id)}
                                     style={{ accentColor: '#1f5dbb' }} />
                              {env.logo ? (
                                <img src={env.logo} alt="" style={{ height: 16, width: 16, objectFit: 'contain' }} />
                              ) : (
                                <span style={{ width: 16, height: 16, borderRadius: '50%', background: '#dbeaff', color: '#1f5dbb',
                                               display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, fontWeight: 700 }}>
                                  {(env.name || '?').charAt(0).toUpperCase()}
                                </span>
                              )}
                              <span>{env.name}</span>
                            </label>
                          ))}
                        </div>
                      )}
                      {expanded && isAdminUser && (
                        <div style={{ borderTop: '1px solid rgba(0,0,0,0.08)', padding: '8px 10px', fontSize: 11, color: '#6b6b66' }}>
                          Administradores têm acesso a todos os ambientes automaticamente.
                        </div>
                      )}
                    </div>
                  );
                })}
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

  // ── State LOCAL para inputs de texto (evita reverter texto durante digitacao por re-render externo) ──
  // Sincroniza com o node prop SOMENTE quando o nó selecionado MUDA (outro node.id), nao a cada keystroke.
  const [localLabel,  setLocalLabel]  = React.useState(node.label || '');
  const [localPeriod, setLocalPeriod] = React.useState(node.period || '');
  const prevNodeIdRef = React.useRef(node.id);
  React.useEffect(() => {
    if (prevNodeIdRef.current !== node.id) {
      prevNodeIdRef.current = node.id;
      setLocalLabel(node.label || '');
      setLocalPeriod(node.period || '');
    }
  }, [node.id, node.label, node.period]);

  const onLabelInput = (e) => {
    setLocalLabel(e.target.value);
    onChange({ label: e.target.value });
  };
  const onPeriodInput = (e) => {
    setLocalPeriod(e.target.value);
    onChange({ period: e.target.value });
  };

  return (
    <div className="inspector">
      <div className="inspector-hd">
        <b>Editar caixa</b>
        <button onClick={onClose} aria-label="Fechar">×</button>
      </div>
      <div className="inspector-body">
        <label className="ins-row">
          <span>Texto</span>
          <textarea value={localLabel} rows="4"
                    onChange={onLabelInput}
                    placeholder="Nome da etapa (use Enter para quebrar linha)" />
        </label>

        {!isDecorative && (
          <div className="ins-row">
            <span>Período</span>
            <input value={localPeriod} onChange={onPeriodInput}
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
  const [deletingId, setDeletingId] = React.useState(null);
  const [hoveredId, setHoveredId] = React.useState(null);
  const [dbStatus, setDbStatus] = React.useState(null);
  const [loadingStatus, setLoadingStatus] = React.useState(false);
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

  // Real-time: listen to SSE audit_new events AND local dispatch from flushDocSync
  React.useEffect(() => {
    const es = new EventSource('/api/events/__main__');
    es.addEventListener('audit_new', () => fetchLogsRef.current(true));
    const onLocalRefresh = () => fetchLogsRef.current(true);
    window.addEventListener('audit-refresh', onLocalRefresh);
    return () => { es.close(); window.removeEventListener('audit-refresh', onLocalRefresh); };
  }, []);

  const clearHistory = async () => {
    if (!window.confirm('Limpar todo o histórico de auditoria? Esta ação não pode ser desfeita.')) return;
    setClearing(true);
    try {
      await fetch('/api/audit', { method: 'DELETE' });
      setLogs([]); setTotal(0); setOffset(0);
    } finally { setClearing(false); }
  };

  const deleteLog = async (e, id) => {
    e.stopPropagation();
    setDeletingId(id);
    try {
      const r = await fetch(`/api/audit/${id}`, { method: 'DELETE' });
      if ((await r.json()).ok) {
        setLogs(prev => prev.filter(l => l.id !== id));
        setTotal(prev => prev - 1);
        if (expandedId === id) setExpandedId(null);
      }
    } finally { setDeletingId(null); }
  };

  const checkDbStatus = async () => {
    setLoadingStatus(true);
    try {
      const r = await fetch('/api/admin/db-status');
      const d = await r.json();
      setDbStatus(d);
    } finally { setLoadingStatus(false); }
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
        <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
          {total > 0 && <span style={{ fontSize: 12, color: '#6b6b66' }}>{total.toLocaleString('pt-BR')} registro{total !== 1 ? 's' : ''}</span>}
          <button onClick={checkDbStatus} disabled={loadingStatus}
                  style={{ fontSize: 12, padding: '4px 10px', background: 'transparent', border: '1px solid rgba(31,93,187,0.35)',
                           borderRadius: 6, color: '#1f5dbb', cursor: 'pointer', opacity: loadingStatus ? 0.6 : 1 }}>
            {loadingStatus ? 'Verificando…' : '🛡 Verificar BD'}
          </button>
          <button onClick={clearHistory} disabled={clearing || total === 0}
                  style={{ fontSize: 12, padding: '4px 10px', background: 'transparent', border: '1px solid rgba(165,40,40,0.35)',
                           borderRadius: 6, color: '#a52828', cursor: 'pointer', opacity: (clearing || total === 0) ? 0.5 : 1 }}>
            {clearing ? 'Limpando…' : '🗑 Limpar histórico'}
          </button>
        </span>
      </div>

      {/* Status do banco */}
      {dbStatus && (
        <div style={{ background: dbStatus.ok ? '#f0f7f0' : '#fdf0f0', borderBottom: '1px solid rgba(0,0,0,0.08)',
                      padding: '12px 20px', display: 'flex', flexWrap: 'wrap', gap: 20, alignItems: 'center' }}>
          {dbStatus.ok ? (
            <>
              <span style={{ fontSize: 13, fontWeight: 600, color: '#3d8c4d' }}>✓ Banco de dados confirmado</span>
              <span style={{ fontSize: 12, color: '#555' }}>
                Último save: <b>{dbStatus.live_doc.last_save ? new Date(dbStatus.live_doc.last_save).toLocaleString('pt-BR') : '—'}</b>
              </span>
              <span style={{ fontSize: 12, color: '#555' }}>Nós: <b>{dbStatus.live_doc.node_count}</b></span>
              <span style={{ fontSize: 12, color: '#555' }}>Sub-fluxos: <b>{dbStatus.live_doc.subflow_count}</b></span>
              <span style={{ fontSize: 12, color: '#555' }}>Tamanho doc: <b>{dbStatus.live_doc.doc_size}</b></span>
              <span style={{ fontSize: 12, color: '#555' }}>Backups: <b>{dbStatus.counts.backups}</b></span>
              <span style={{ fontSize: 12, color: '#555' }}>Imagens: <b>{dbStatus.counts.images}</b></span>
              <span style={{ fontSize: 12, color: '#555' }}>Usuários: <b>{dbStatus.counts.users}</b></span>
            </>
          ) : (
            <span style={{ fontSize: 13, color: '#a52828' }}>✗ Erro ao consultar banco: {dbStatus.error}</span>
          )}
          <button onClick={() => setDbStatus(null)} style={{ marginLeft: 'auto', fontSize: 12, background: 'none', border: 'none', cursor: 'pointer', color: '#999' }}>✕</button>
        </div>
      )}

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
              const isHovered  = hoveredId === log.id;
              const isDeleting = deletingId === log.id;
              return (
                <div key={log.id} style={{ borderBottom: '1px solid rgba(0,0,0,0.04)' }}>
                  <div
                    style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '10px 20px',
                             transition: 'background 0.1s', cursor: hasDetail ? 'pointer' : 'default',
                             background: isHovered ? '#f5f4f0' : '' }}
                    onClick={() => hasDetail && setExpandedId(isOpen ? null : log.id)}
                    onMouseEnter={() => setHoveredId(log.id)}
                    onMouseLeave={() => setHoveredId(null)}>
                    <span style={{ fontSize: 17, lineHeight: 1.35, flexShrink: 0, width: 24, textAlign: 'center' }}>{icon}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, color: '#1d1d1b', lineHeight: 1.45 }}>{log.description}</div>
                      <div style={{ fontSize: 11.5, color: '#6b6b66', marginTop: 2 }}>{log.actor_email}</div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                      <span style={{ fontSize: 11.5, color: '#9a9a95', fontVariantNumeric: 'tabular-nums' }}>{time}</span>
                      {hasDetail && <span style={{ fontSize: 10, color: '#aaa' }}>{isOpen ? '▲' : '▼'}</span>}
                      <button
                        onClick={e => deleteLog(e, log.id)}
                        disabled={isDeleting}
                        title="Excluir registro"
                        style={{ display: 'flex', alignItems: 'center', justifyContent: 'center',
                                 width: 24, height: 24, padding: 0,
                                 background: isDeleting ? 'rgba(165,40,40,0.08)' : (isHovered ? 'rgba(165,40,40,0.08)' : 'transparent'),
                                 border: isHovered || isDeleting ? '1px solid rgba(165,40,40,0.25)' : '1px solid transparent',
                                 borderRadius: 5, cursor: isDeleting ? 'default' : 'pointer',
                                 opacity: isHovered || isDeleting ? 1 : 0,
                                 transition: 'opacity 0.15s, background 0.15s',
                                 fontSize: 13, color: '#a52828' }}>
                        {isDeleting ? '…' : '🗑'}
                      </button>
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
                      {meta.added && meta.added.length > 0 && meta.added.map((item, i) => {
                        const isStr = typeof item === 'string';
                        const title = isStr ? item : item.title;
                        return (
                          <div key={i} style={{ marginBottom: 6 }}>
                            <div style={{ fontWeight: 600, color: '#3d8c4d' }}>+ {title}</div>
                            {!isStr && item.desc     && <div style={{ paddingLeft: 12, color: '#555', fontSize: 12 }}>· Descrição: {typeof item.desc === 'string' ? <em>"{item.desc}"</em> : 'preenchida'}</div>}
                            {!isStr && item.owner    && <div style={{ paddingLeft: 12, color: '#555', fontSize: 12 }}>· Responsável: "{item.owner}"</div>}
                            {!isStr && item.duration && <div style={{ paddingLeft: 12, color: '#555', fontSize: 12 }}>· Duração: "{item.duration}"</div>}
                            {!isStr && item.images && item.images.length > 0 && (
                              <div style={{ paddingLeft: 12, marginTop: 3 }}>
                                <div style={{ fontSize: 12, color: '#3d8c4d' }}>· +{item.images.length} imagem(ns)</div>
                                {item.images.some(img => img.url) && (
                                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, paddingLeft: 10, marginTop: 5 }}>
                                    {item.images.map((img, k) => img.url
                                      ? <img key={k} src={img.url} alt={img.caption || ''} title={img.caption || ''}
                                             style={{ width: 60, height: 60, objectFit: 'cover', borderRadius: 5,
                                                      border: '2px solid #3d8c4d', cursor: 'pointer' }}
                                             onClick={() => window.open(img.url, '_blank')} />
                                      : null)}
                                  </div>
                                )}
                              </div>
                            )}
                            {!isStr && item.links && item.links.length > 0 && (
                              <div style={{ paddingLeft: 12, marginTop: 3 }}>
                                <div style={{ fontSize: 12, color: '#3d8c4d' }}>· +{item.links.length} link(s)</div>
                                {item.links.map((l, k) => (
                                  <div key={k} style={{ paddingLeft: 10, fontSize: 12 }}>
                                    {l.url ? <a href={l.url} target="_blank" rel="noopener noreferrer" style={{ color: '#1f5dbb', wordBreak: 'break-all' }}>{l.label ? `${l.label} — ${l.url}` : l.url}</a> : <span style={{ color: '#888' }}>{l.label || '—'}</span>}
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })}
                      {meta.removed && meta.removed.length > 0 && meta.removed.map((item, i) => {
                        const isStr = typeof item === 'string';
                        const title = isStr ? item : item.title;
                        return (
                          <div key={i} style={{ marginBottom: 6 }}>
                            <div style={{ fontWeight: 600, color: '#a52828' }}>− {title}</div>
                            {!isStr && item.images && item.images.length > 0 && (
                              <div style={{ paddingLeft: 12, marginTop: 3 }}>
                                <div style={{ fontSize: 12, color: '#a52828' }}>· Tinha {item.images.length} imagem(ns)</div>
                                {item.images.some(img => img.url) && (
                                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, paddingLeft: 10, marginTop: 5 }}>
                                    {item.images.map((img, k) => img.url
                                      ? <img key={k} src={img.url} alt={img.caption || ''} title={img.caption || ''}
                                             style={{ width: 60, height: 60, objectFit: 'cover', borderRadius: 5,
                                                      border: '2px solid #a52828', cursor: 'pointer', opacity: 0.7 }}
                                             onClick={() => window.open(img.url, '_blank')} />
                                      : null)}
                                  </div>
                                )}
                              </div>
                            )}
                            {!isStr && item.links && item.links.length > 0 && (
                              <div style={{ paddingLeft: 12, marginTop: 3 }}>
                                <div style={{ fontSize: 12, color: '#a52828' }}>· Tinha {item.links.length} link(s)</div>
                                {item.links.map((l, k) => (
                                  <div key={k} style={{ paddingLeft: 10, fontSize: 12 }}>
                                    {l.url ? <a href={l.url} target="_blank" rel="noopener noreferrer" style={{ color: '#1f5dbb', wordBreak: 'break-all' }}>{l.label ? `${l.label} — ${l.url}` : l.url}</a> : <span style={{ color: '#888' }}>{l.label || '—'}</span>}
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })}
                      {meta.edited  && meta.edited.length > 0 && meta.edited.map((e, i) => (
                        <div key={i} style={{ marginBottom: 8 }}>
                          <div style={{ fontWeight: 600, color: '#1f5dbb' }}>✎ {typeof e === 'string' ? e : e.title}
                            {typeof e !== 'string' && (!e.changes || e.changes.length === 0) && <span style={{ fontWeight: 400, color: '#888', fontSize: 11, marginLeft: 6 }}>(campos internos alterados)</span>}
                          </div>
                          {typeof e !== 'string' && e.changes && e.changes.map((ch, j) => {
                            if (typeof ch === 'string') return <div key={j} style={{ paddingLeft: 12, color: '#555', fontSize: 12 }}>· {ch}</div>;
                            if (ch.type === 'title')    return <div key={j} style={{ paddingLeft: 12, color: '#555', fontSize: 12 }}>· Título: <span style={{ color: '#a52828' }}>"{ch.before}"</span> → <span style={{ color: '#3d8c4d' }}>"{ch.after}"</span></div>;
                            if (ch.type === 'desc')     return <div key={j} style={{ paddingLeft: 12, color: '#555', fontSize: 12 }}>· Descrição: {ch.after ? <span style={{ fontStyle: 'italic', color: '#3a3a35' }}>"{ch.after}{ch.after.length >= 200 ? '…' : ''}"</span> : <span style={{ color: '#888' }}>alterada</span>}</div>;
                            if (ch.type === 'owner')    return <div key={j} style={{ paddingLeft: 12, color: '#555', fontSize: 12 }}>· Responsável: <span style={{ color: '#a52828' }}>"{ch.before || '—'}"</span> → <span style={{ color: '#3d8c4d' }}>"{ch.after || '—'}"</span></div>;
                            if (ch.type === 'duration') return <div key={j} style={{ paddingLeft: 12, color: '#555', fontSize: 12 }}>· Duração: <span style={{ color: '#a52828' }}>"{ch.before || '—'}"</span> → <span style={{ color: '#3d8c4d' }}>"{ch.after || '—'}"</span></div>;
                            if (ch.type === 'color')    return <div key={j} style={{ paddingLeft: 12, color: '#555', fontSize: 12 }}>· Cor: {ch.before} → {ch.after}</div>;
                            if (ch.type === 'hasSubflow') return <div key={j} style={{ paddingLeft: 12, color: '#555', fontSize: 12 }}>· 3° nível: {ch.after ? <span style={{ color: '#3d8c4d' }}>ativado</span> : <span style={{ color: '#a52828' }}>desativado</span>}</div>;
                            if (ch.type === 'substeps') return (
                              <div key={j} style={{ paddingLeft: 12, marginTop: 2 }}>
                                {ch.added && ch.added.map((s, k) => (
                                  <div key={k} style={{ fontSize: 12, color: '#3d8c4d' }}>
                                    + Sub-etapa: <strong>"{s.title}"</strong>
                                    {s.desc && <div style={{ paddingLeft: 12, fontStyle: 'italic', color: '#555', fontSize: 11.5 }}>"{s.desc}"</div>}
                                  </div>
                                ))}
                                {ch.removed && ch.removed.map((s, k) => (
                                  <div key={k} style={{ fontSize: 12, color: '#a52828' }}>− Sub-etapa: <strong>"{s.title}"</strong></div>
                                ))}
                                {ch.edited && ch.edited.map((s, k) => (
                                  <div key={k} style={{ fontSize: 12, color: '#1f5dbb' }}>
                                    ✎ Sub-etapa: <strong>"{s.title}"</strong>
                                    {s.changes && s.changes.map((c, l) => (
                                      <div key={l} style={{ paddingLeft: 12, color: '#555', fontSize: 11.5 }}>
                                        {c.type === 'title'    && <span>· Título: <span style={{color:'#a52828'}}>"{c.before}"</span> → <span style={{color:'#3d8c4d'}}>"{c.after}"</span></span>}
                                        {c.type === 'desc'     && <span>· Descrição: {c.after ? <em>"{c.after}"</em> : 'alterada'}</span>}
                                        {c.type === 'owner'    && <span>· Responsável: <span style={{color:'#a52828'}}>"{c.before||'—'}"</span> → <span style={{color:'#3d8c4d'}}>"{c.after||'—'}"</span></span>}
                                        {c.type === 'duration' && <span>· Duração: <span style={{color:'#a52828'}}>"{c.before||'—'}"</span> → <span style={{color:'#3d8c4d'}}>"{c.after||'—'}"</span></span>}
                                        {(c.type === 'images_added' || c.type === 'images_removed') && (() => { const isAdd = c.type === 'images_added'; return <span style={{color: isAdd ? '#3d8c4d' : '#a52828'}}>· {isAdd ? `+${c.images.length} imagem(ns) adicionada(s)` : `−${c.images.length} imagem(ns) removida(s)`}</span>; })()}
                                        {(c.type === 'links_added' || c.type === 'links_removed' || c.type === 'links_changed') && (() => { const clr = {links_added:'#3d8c4d',links_removed:'#a52828',links_changed:'#1f5dbb'}[c.type]; const lbl = {links_added:`+${c.links.length} link(s) adicionado(s)`,links_removed:`−${c.links.length} link(s) removido(s)`,links_changed:`✎ ${c.links.length} link(s) alterado(s)`}[c.type]; return <span style={{color:clr}}>· {lbl}</span>; })()}
                                      </div>
                                    ))}
                                  </div>
                                ))}
                                {!ch.added?.length && !ch.removed?.length && !ch.edited?.length && (
                                  <span style={{ color: '#888', fontSize: 12 }}>· Sub-etapas alteradas</span>
                                )}
                              </div>
                            );
                            if (ch.type === 'images_added' || ch.type === 'images_removed') {
                              const isAdd = ch.type === 'images_added';
                              return (
                                <div key={j} style={{ paddingLeft: 12, marginTop: 4, marginBottom: 4 }}>
                                  <div style={{ fontSize: 12, color: isAdd ? '#3d8c4d' : '#a52828', fontWeight: 500 }}>
                                    · {isAdd ? `+${ch.images.length} imagem(ns) adicionada(s)` : `−${ch.images.length} imagem(ns) removida(s)`}
                                  </div>
                                  {ch.images.some(img => img.url) && (
                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, paddingLeft: 10, marginTop: 5 }}>
                                      {ch.images.map((img, k) => img.url ? (
                                        <img key={k} src={img.url} alt={img.caption || ''}
                                             title={img.caption || ''}
                                             style={{ width: 60, height: 60, objectFit: 'cover', borderRadius: 5,
                                                      border: `2px solid ${isAdd ? '#3d8c4d' : '#a52828'}`,
                                                      cursor: 'pointer', opacity: isAdd ? 1 : 0.6 }}
                                             onClick={() => window.open(img.url, '_blank')} />
                                      ) : null)}
                                    </div>
                                  )}
                                </div>
                              );
                            }
                            if (ch.type === 'links_added' || ch.type === 'links_removed' || ch.type === 'links_changed') {
                              const clr = { links_added: '#3d8c4d', links_removed: '#a52828', links_changed: '#1f5dbb' }[ch.type];
                              const lbl = { links_added: `+${ch.links.length} link(s) adicionado(s)`, links_removed: `−${ch.links.length} link(s) removido(s)`, links_changed: `✎ ${ch.links.length} link(s) alterado(s)` }[ch.type];
                              return (
                                <div key={j} style={{ paddingLeft: 12, marginTop: 3 }}>
                                  <div style={{ fontSize: 12, color: clr, fontWeight: 500 }}>· {lbl}</div>
                                  {ch.links.map((l, k) => (
                                    <div key={k} style={{ paddingLeft: 10, fontSize: 12, marginTop: 2 }}>
                                      {l.url
                                        ? <a href={l.url} target="_blank" rel="noopener noreferrer"
                                             style={{ color: '#1f5dbb', wordBreak: 'break-all' }}>
                                            {l.label ? `${l.label} — ${l.url}` : l.url}
                                          </a>
                                        : <span style={{ color: '#888' }}>{l.label || '—'}</span>}
                                    </div>
                                  ))}
                                </div>
                              );
                            }
                            return null;
                          })}
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

// ─── Switcher de ambiente no topbar do link publico
function PublishedEnvSwitcher({ envs, currentEnvId, onSwitch, onChooseAgain }) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef(null);
  React.useEffect(() => {
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    if (open) document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  const current = envs.find(e => e.id === currentEnvId);
  if (!current) return null;
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button onClick={() => setOpen(o => !o)}
              style={{
                display: 'flex', alignItems: 'center', gap: 8, padding: '4px 10px 4px 4px',
                background: '#fff', border: '1px solid rgba(0,0,0,0.12)', borderRadius: 7,
                cursor: 'pointer', font: '13px inherit', maxWidth: 240,
              }} title={current.name}>
        {current.logo ? (
          <img src={current.logo} alt="" style={{ height: 22, width: 22, objectFit: 'contain', borderRadius: 4 }} />
        ) : (
          <span style={{ width: 22, height: 22, borderRadius: '50%', background: '#dbeaff', color: '#1f5dbb',
                         display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700 }}>
            {(current.name || '?').charAt(0).toUpperCase()}
          </span>
        )}
        <span style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{current.name}</span>
        <span style={{ color: '#6b6b66', fontSize: 10 }}>▼</span>
      </button>
      {open && (
        <div style={{ position: 'absolute', top: 'calc(100% + 4px)', left: 0, zIndex: 1000,
                       background: '#fff', border: '1px solid rgba(0,0,0,0.10)', borderRadius: 8,
                       boxShadow: '0 6px 24px rgba(0,0,0,0.12)', minWidth: 260, padding: 6 }}>
          <div style={{ fontSize: 10, color: '#6b6b66', textTransform: 'uppercase', letterSpacing: '0.06em',
                        fontWeight: 700, padding: '6px 10px 4px' }}>Visualizando ambiente</div>
          {envs.map(env => (
            <button key={env.id} onClick={() => { onSwitch(env); setOpen(false); }}
                    style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px',
                             background: env.id === currentEnvId ? '#eef3ff' : 'transparent',
                             border: 'none', borderRadius: 6, cursor: 'pointer',
                             font: '13px inherit', textAlign: 'left', color: 'inherit' }}>
              {env.logo ? (
                <img src={env.logo} alt="" style={{ height: 20, width: 20, objectFit: 'contain', borderRadius: 3 }} />
              ) : (
                <span style={{ width: 20, height: 20, borderRadius: '50%', background: '#dbeaff', color: '#1f5dbb',
                               display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700 }}>
                  {(env.name || '?').charAt(0).toUpperCase()}
                </span>
              )}
              <span style={{ flex: 1, fontWeight: env.id === currentEnvId ? 700 : 500 }}>{env.name}</span>
              {env.id === currentEnvId && <span style={{ color: '#1f5dbb', fontSize: 12 }}>✓</span>}
            </button>
          ))}
          <div style={{ borderTop: '1px solid rgba(0,0,0,0.08)', margin: '6px 0' }} />
          <button onClick={() => { onChooseAgain(); setOpen(false); }}
                  style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px',
                           background: 'transparent', border: 'none', borderRadius: 6, cursor: 'pointer',
                           color: '#1f5dbb', fontWeight: 600, fontSize: 13, textAlign: 'left' }}>
            ← Voltar para a tela de seleção
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Seletor de ambiente no link publico (quando mesmo slug em multiplos ambientes)
function PublishedEnvPicker({ envs, onSelect }) {
  return (
    <div style={{ minHeight: '100vh', background: '#f6f5f1',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div style={{ maxWidth: 760, width: '100%' }}>
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <h1 style={{ fontSize: 28, fontWeight: 700, color: '#1a1a1a', margin: 0 }}>Selecione um ambiente</h1>
          <p style={{ color: '#6b6b66', fontSize: 14, marginTop: 8 }}>Este fluxo está publicado em mais de um ambiente. Escolha qual deseja visualizar.</p>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 14 }}>
          {envs.map(env => (
            <button key={env.id} onClick={() => onSelect(env)}
                    style={{
                      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                      gap: 10, padding: '24px 16px', background: '#fff', borderRadius: 12,
                      border: '1.5px solid rgba(0,0,0,0.10)', cursor: 'pointer', transition: 'all 0.15s',
                      minHeight: 160,
                    }}
                    onMouseEnter={e => { e.currentTarget.style.borderColor = '#1f5dbb'; e.currentTarget.style.boxShadow = '0 4px 12px rgba(31,93,187,0.18)'; }}
                    onMouseLeave={e => { e.currentTarget.style.borderColor = 'rgba(0,0,0,0.10)'; e.currentTarget.style.boxShadow = 'none'; }}>
              {env.logo ? (
                <img src={env.logo} alt={env.name} style={{ maxHeight: 64, maxWidth: '90%', objectFit: 'contain' }} />
              ) : (
                <div style={{ width: 64, height: 64, borderRadius: '50%', background: '#dbeaff', color: '#1f5dbb',
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                              fontSize: 24, fontWeight: 700 }}>
                  {(env.name || '?').charAt(0).toUpperCase()}
                </div>
              )}
              <div style={{ fontSize: 14, fontWeight: 600, color: '#1a1a1a', textAlign: 'center' }}>{env.name}</div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Seletor de ambientes (tela inicial quando o usuário tem múltiplos)
function EnvironmentPicker({ envs, onSelect, isAdmin, onCreate }) {
  return (
    <div style={{ minHeight: '100vh', background: '#f6f5f1',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div style={{ maxWidth: 760, width: '100%' }}>
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <h1 style={{ fontSize: 28, fontWeight: 700, color: '#1a1a1a', margin: 0 }}>Selecione um ambiente</h1>
          <p style={{ color: '#6b6b66', fontSize: 14, marginTop: 8 }}>Cada ambiente possui o seu próprio fluxograma, isolado dos demais.</p>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 14 }}>
          {envs.map(env => (
            <button key={env.id} onClick={() => onSelect(env)}
                    style={{
                      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                      gap: 10, padding: '24px 16px', background: '#fff', borderRadius: 12,
                      border: '1.5px solid rgba(0,0,0,0.10)', cursor: 'pointer', transition: 'all 0.15s',
                      minHeight: 160,
                    }}
                    onMouseEnter={e => { e.currentTarget.style.borderColor = '#1f5dbb'; e.currentTarget.style.boxShadow = '0 4px 12px rgba(31,93,187,0.18)'; }}
                    onMouseLeave={e => { e.currentTarget.style.borderColor = 'rgba(0,0,0,0.10)'; e.currentTarget.style.boxShadow = 'none'; }}>
              {env.logo ? (
                <img src={env.logo} alt={env.name} style={{ maxHeight: 64, maxWidth: '90%', objectFit: 'contain' }} />
              ) : (
                <div style={{ width: 64, height: 64, borderRadius: '50%', background: '#dbeaff', color: '#1f5dbb',
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                              fontSize: 24, fontWeight: 700 }}>
                  {(env.name || '?').charAt(0).toUpperCase()}
                </div>
              )}
              <div style={{ fontSize: 14, fontWeight: 600, color: '#1a1a1a', textAlign: 'center' }}>{env.name}</div>
            </button>
          ))}
          {isAdmin && (
            <button onClick={onCreate}
                    style={{
                      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                      gap: 8, padding: '24px 16px', background: '#fff', borderRadius: 12,
                      border: '1.5px dashed rgba(31,93,187,0.4)', cursor: 'pointer',
                      color: '#1f5dbb', minHeight: 160,
                    }}>
              <div style={{ fontSize: 32 }}>+</div>
              <div style={{ fontSize: 13, fontWeight: 600 }}>Criar novo ambiente</div>
            </button>
          )}
        </div>
        {envs.length === 0 && !isAdmin && (
          <p style={{ marginTop: 24, color: '#a52828', textAlign: 'center', fontSize: 14 }}>
            Nenhum ambiente disponível para o seu usuário. Solicite acesso ao administrador.
          </p>
        )}
      </div>
    </div>
  );
}

// ─── Modal de criação/edição de ambiente
function EnvironmentModal({ env, onClose, onSaved }) {
  const [name, setName] = React.useState(env?.name || '');
  const [logo, setLogo] = React.useState(env?.logo || '');
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState(null);

  const handleLogoUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      fetch('/api/images/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: file.name, data: ev.target.result }),
      }).then(r => r.json()).then(d => { if (d.ok) setLogo(d.url); });
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const save = () => {
    if (!name.trim()) { setError('Informe um nome.'); return; }
    setSaving(true); setError(null);
    const url = env ? `/api/environments/${env.id}` : '/api/environments';
    const method = env ? 'PUT' : 'POST';
    fetch(url, {
      method, headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name.trim(), logo: logo || null }),
    }).then(r => r.json()).then(d => {
      setSaving(false);
      if (d.ok) { onSaved && onSaved(d.environment); onClose(); }
      else setError(d.error || 'Erro ao salvar.');
    }).catch(() => { setSaving(false); setError('Erro de conexão.'); });
  };

  const remove = () => {
    if (!env || !confirm(`Remover ambiente "${env.name}"? Isso apaga TODOS os dados (fluxo, publicações, backups, permissões) deste ambiente.`)) return;
    setSaving(true);
    fetch(`/api/environments/${env.id}`, { method: 'DELETE' })
      .then(r => r.json()).then(d => {
        setSaving(false);
        if (d.ok) { onSaved && onSaved(null); onClose(); }
        else setError(d.error || 'Erro ao remover.');
      }).catch(() => { setSaving(false); setError('Erro de conexão.'); });
  };

  const inp = { border: '1px solid rgba(0,0,0,0.15)', borderRadius: 6, padding: '8px 10px', font: '14px/1.4 inherit', outline: 0, width: '100%' };

  return (
    <div className="sf-modal-overlay" onClick={onClose}>
      <div className="sf-modal" style={{ maxWidth: 460 }} onClick={e => e.stopPropagation()}>
        <button className="sf-close" onClick={onClose}>×</button>
        <div className="sf-header">
          <div className="sf-eyebrow" style={{ color: '#1f5dbb' }}>AMBIENTE</div>
          <h2 className="sf-title" style={{ fontSize: 20, marginBottom: 4 }}>
            {env ? 'Editar ambiente' : 'Criar novo ambiente'}
          </h2>
          <p className="sf-sub">Cada ambiente terá um fluxograma totalmente independente.</p>
        </div>

        <div style={{ padding: '0 32px 28px' }}>
          {error && <div style={{ marginBottom: 12, color: '#a52828', fontSize: 13 }}>{error}</div>}

          <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#3a3a36', marginBottom: 5 }}>
            Nome do ambiente
          </label>
          <input type="text" value={name} onChange={e => setName(e.target.value)}
                 placeholder="Ex: Empresa ABC" style={inp} autoFocus />

          <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#3a3a36', marginTop: 18, marginBottom: 8 }}>
            Logotipo (opcional)
          </label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {logo ? (
              <>
                <img src={logo} alt="Logo" style={{ maxHeight: 64, maxWidth: 120, objectFit: 'contain', border: '1px solid rgba(0,0,0,0.08)', borderRadius: 6, padding: 4 }} />
                <button className="btn-ghost" onClick={() => setLogo('')} style={{ fontSize: 12 }}>Remover logo</button>
              </>
            ) : (
              <label className="btn-ghost" style={{ cursor: 'pointer', fontSize: 13 }}>
                <input type="file" accept="image/*" style={{ display: 'none' }} onChange={handleLogoUpload} />
                + Selecionar imagem
              </label>
            )}
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginTop: 24, borderTop: '1px solid rgba(0,0,0,0.08)', paddingTop: 16 }}>
            {env && env.id !== 1 ? (
              <button onClick={remove} disabled={saving}
                      style={{ background: 'none', border: 'none', color: '#a52828', fontSize: 12, cursor: 'pointer', fontWeight: 600 }}>
                Remover ambiente
              </button>
            ) : <span />}
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn-ghost" onClick={onClose}>Cancelar</button>
              <button className="btn-primary" onClick={save} disabled={saving || !name.trim()}>
                {saving ? 'Salvando…' : (env ? 'Salvar' : 'Criar ambiente')}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Modal: restaurar live_doc a partir de um backup (admin only) ──
function RestoreFromBackupModal({ currentEnv, onClose, onStart, onDone }) {
  const [backups, setBackups] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [selectedFile, setSelectedFile] = React.useState(null);
  const [step, setStep] = React.useState('select'); // select | confirming | loading | error | done
  const [error, setError] = React.useState(null);

  React.useEffect(() => {
    fetch('/api/backup/list')
      .then(r => r.json())
      .then(d => { setLoading(false); if (d.ok) setBackups(d.files || []); })
      .catch(() => { setLoading(false); setError('Erro ao carregar backups.'); });
  }, []);

  const fmtDate = (iso) => {
    try { return new Date(iso).toLocaleString('pt-BR'); } catch { return iso; }
  };
  const fmtSize = (bytes) => {
    if (!bytes && bytes !== 0) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024*1024) return `${(bytes/1024).toFixed(1)} KB`;
    return `${(bytes/1024/1024).toFixed(2)} MB`;
  };

  const confirm = async () => {
    if (!selectedFile) return;
    setStep('loading'); setError(null);
    onStart && onStart();
    try {
      const r = await fetch('/api/backup/restore-to-live', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: selectedFile, environmentId: currentEnv?.id }),
      });
      const d = await r.json();
      if (!d.ok) { setError(d.error || 'Erro ao restaurar.'); setStep('select'); return; }
      setStep('done');
      onDone && onDone({ currentRestored: true });
    } catch (e) { setError('Erro de conexao.'); setStep('select'); }
  };

  return (
    <div className="sf-modal-overlay" onClick={onClose}>
      <div className="sf-modal" style={{ maxWidth: 580 }} onClick={e => e.stopPropagation()}>
        <button className="sf-close" onClick={onClose}>×</button>
        <div className="sf-header">
          <div className="sf-eyebrow" style={{ color: '#3d8c4d' }}>RESTAURAR DO BACKUP</div>
          <h2 className="sf-title" style={{ fontSize: 20, marginBottom: 4 }}>Restaurar a partir de um backup</h2>
          <p className="sf-sub">Substitui o fluxo de trabalho do ambiente <b>{currentEnv?.name}</b> pelo conteudo do backup selecionado.</p>
        </div>

        <div style={{ padding: '0 32px 28px' }}>
          {error && <div style={{ marginBottom: 12, color: '#a52828', fontSize: 13 }}>{error}</div>}
          {loading && <div style={{ padding: '20px 0', color: '#6b6b66', textAlign: 'center', fontSize: 13 }}>Carregando…</div>}

          {!loading && step === 'select' && (
            <>
              {backups.length === 0 ? (
                <p style={{ fontSize: 13, color: '#6b6b66', margin: 0 }}>Nenhum backup encontrado neste ambiente.</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 320, overflowY: 'auto' }}>
                  {backups.map(bk => (
                    <label key={bk.filename} style={{
                      display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px',
                      borderRadius: 7, cursor: 'pointer',
                      background: selectedFile === bk.filename ? '#e8f5e9' : '#fafaf9',
                      border: '1.5px solid ' + (selectedFile === bk.filename ? '#3d8c4d' : 'rgba(0,0,0,0.08)'),
                    }}>
                      <input type="radio" name="backup" checked={selectedFile === bk.filename}
                             onChange={() => setSelectedFile(bk.filename)}
                             style={{ accentColor: '#3d8c4d', flexShrink: 0 }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: '#1a1a1a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {bk.filename}
                        </div>
                        <div style={{ fontSize: 11, color: '#6b6b66', marginTop: 2 }}>
                          {fmtDate(bk.mtime)} · {fmtSize(bk.size)}
                        </div>
                      </div>
                    </label>
                  ))}
                </div>
              )}
            </>
          )}
          {step === 'confirming' && (
            <div style={{ background: '#fff5e6', border: '1px solid #f5c97a', borderRadius: 8, padding: '12px 14px' }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#92400e', marginBottom: 4 }}>⚠ Atencao</div>
              <div style={{ fontSize: 13, color: '#3a3a36', lineHeight: 1.5 }}>
                O fluxo de trabalho do ambiente <b>"{currentEnv?.name}"</b> sera <b>completamente substituido</b> pelo conteudo do backup <b>"{selectedFile}"</b>. As alteracoes atuais que nao estiverem no backup serao perdidas.
              </div>
            </div>
          )}
          {step === 'loading' && (
            <div style={{ padding: '20px 0', color: '#6b6b66', textAlign: 'center', fontSize: 13 }}>Restaurando…</div>
          )}
          {step === 'done' && (
            <div style={{ padding: '12px 0', color: '#3d8c4d', fontSize: 13, fontWeight: 600 }}>✓ Restaurado com sucesso. A pagina vai recarregar.</div>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16, borderTop: '1px solid rgba(0,0,0,0.08)', paddingTop: 16 }}>
            {step === 'select' && (
              <>
                <button className="btn-ghost" onClick={onClose}>Cancelar</button>
                <button className="btn-primary" disabled={!selectedFile} onClick={() => setStep('confirming')}>Continuar →</button>
              </>
            )}
            {step === 'confirming' && (
              <>
                <button className="btn-ghost" onClick={() => setStep('select')}>← Voltar</button>
                <button className="btn-primary" onClick={confirm}>Confirmar e restaurar</button>
              </>
            )}
            {step === 'done' && <button className="btn-ghost" disabled>Aguarde…</button>}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Modal: restaurar live_doc a partir do publicado (admin only) ──
function RestoreFromPublishedModal({ environments, currentEnv, onClose, onDone, onStart }) {
  // selected = Set de envIds
  const [selected, setSelected] = React.useState(new Set(currentEnv ? [currentEnv.id] : []));
  const [step, setStep] = React.useState('select'); // select | confirming | loading | result
  const [error, setError] = React.useState(null);
  const [result, setResult] = React.useState(null);

  const all = environments || [];
  const allSelected = all.length > 0 && selected.size === all.length;

  const toggle = (id) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const toggleAll = () => {
    setSelected(allSelected ? new Set() : new Set(all.map(e => e.id)));
  };

  const confirm = async () => {
    if (selected.size === 0) return;
    setStep('loading'); setError(null);
    // Sinaliza ao pai que comecou o restore — pai cancela syncs pendentes
    onStart && onStart();
    try {
      const r = await fetch('/api/publish/restore-to-live', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ environmentIds: [...selected] }),
      });
      const d = await r.json();
      if (!d.ok) { setError(d.error || 'Erro ao restaurar.'); setStep('select'); return; }
      setResult(d);
      setStep('result');
      // Se o ambiente atual foi restaurado, sinaliza para o pai recarregar
      onDone && onDone({ ...d, currentRestored: currentEnv && (d.restored || []).some(r => r.envId === currentEnv.id) });
    } catch (e) {
      setError('Erro de conexao.'); setStep('select');
    }
  };

  return (
    <div className="sf-modal-overlay" onClick={onClose}>
      <div className="sf-modal" style={{ maxWidth: 520 }} onClick={e => e.stopPropagation()}>
        <button className="sf-close" onClick={onClose}>×</button>
        <div className="sf-header">
          <div className="sf-eyebrow" style={{ color: '#c97639' }}>RESTAURAR DO PUBLICADO</div>
          <h2 className="sf-title" style={{ fontSize: 20, marginBottom: 4 }}>Restaurar fluxo a partir do publicado</h2>
          <p className="sf-sub">Para cada ambiente selecionado, o fluxo de trabalho (live doc) sera substituido pelo ultimo fluxo publicado daquele mesmo ambiente.</p>
        </div>

        <div style={{ padding: '0 32px 28px' }}>
          {step === 'select' && (
            <>
              {error && <div style={{ marginBottom: 12, color: '#a52828', fontSize: 13 }}>{error}</div>}
              {all.length === 0 ? (
                <p style={{ fontSize: 13, color: '#6b6b66', margin: 0 }}>Nenhum ambiente disponivel.</p>
              ) : (
                <>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                    <span style={{ fontSize: 12, color: '#6b6b66' }}>
                      {selected.size} de {all.length} selecionado{selected.size === 1 ? '' : 's'}
                    </span>
                    <button className="btn-ghost" style={{ fontSize: 12 }} onClick={toggleAll}>
                      {allSelected ? 'Limpar selecao' : 'Selecionar todos os ambientes'}
                    </button>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 280, overflowY: 'auto' }}>
                    {all.map(env => (
                      <label key={env.id} style={{
                        display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px',
                        borderRadius: 7, cursor: 'pointer',
                        background: selected.has(env.id) ? '#dbeaff' : '#fafaf9',
                        border: '1.5px solid ' + (selected.has(env.id) ? '#1f5dbb' : 'rgba(0,0,0,0.08)'),
                      }}>
                        <input type="checkbox" checked={selected.has(env.id)} onChange={() => toggle(env.id)}
                               style={{ accentColor: '#1f5dbb', flexShrink: 0 }} />
                        {env.logo ? (
                          <img src={env.logo} alt="" style={{ height: 28, width: 28, objectFit: 'contain', borderRadius: 4 }} />
                        ) : (
                          <span style={{ width: 28, height: 28, borderRadius: '50%', background: '#dbeaff', color: '#1f5dbb',
                                         display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700 }}>
                            {(env.name || '?').charAt(0).toUpperCase()}
                          </span>
                        )}
                        <span style={{ fontSize: 14, fontWeight: 600 }}>{env.name}</span>
                        {currentEnv && env.id === currentEnv.id && (
                          <span style={{ fontSize: 10, background: '#1f5dbb', color: '#fff', borderRadius: 3, padding: '1px 5px' }}>ATUAL</span>
                        )}
                      </label>
                    ))}
                  </div>
                </>
              )}
            </>
          )}
          {step === 'confirming' && (
            <div style={{ background: '#fff5e6', border: '1px solid #f5c97a', borderRadius: 8, padding: '12px 14px' }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#92400e', marginBottom: 4 }}>⚠ Atencao</div>
              <div style={{ fontSize: 13, color: '#3a3a36', lineHeight: 1.5 }}>
                Voce vai substituir o fluxo de trabalho (live doc) de <b>{selected.size}</b> ambiente{selected.size === 1 ? '' : 's'} pelo fluxo publicado de cada um.
                As alteracoes locais nao publicadas serao perdidas.
              </div>
            </div>
          )}
          {step === 'loading' && (
            <div style={{ padding: '20px 0', color: '#6b6b66', textAlign: 'center', fontSize: 13 }}>Restaurando…</div>
          )}
          {step === 'result' && result && (
            <div>
              {(result.restored || []).length > 0 && (
                <div style={{ marginBottom: 12 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#3d8c4d', marginBottom: 6 }}>
                    ✓ Restaurados ({(result.restored || []).length})
                  </div>
                  {(result.restored || []).map(r => {
                    const env = environments.find(e => e.id === r.envId);
                    return (
                      <div key={r.envId} style={{ fontSize: 12, color: '#3a3a36', padding: '2px 0' }}>
                        • {env?.name || `Ambiente #${r.envId}`} <span style={{ color: '#6b6b66' }}>(slug: {r.slug})</span>
                      </div>
                    );
                  })}
                </div>
              )}
              {(result.failed || []).length > 0 && (
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#a52828', marginBottom: 6 }}>
                    ✗ Nao restaurados ({(result.failed || []).length})
                  </div>
                  {(result.failed || []).map(r => {
                    const env = environments.find(e => e.id === r.envId);
                    return (
                      <div key={r.envId} style={{ fontSize: 12, color: '#3a3a36', padding: '2px 0' }}>
                        • {env?.name || `Ambiente #${r.envId}`} — <span style={{ color: '#a52828' }}>{r.reason}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16, borderTop: '1px solid rgba(0,0,0,0.08)', paddingTop: 16 }}>
            {step === 'select' && (
              <>
                <button className="btn-ghost" onClick={onClose}>Cancelar</button>
                <button className="btn-primary" disabled={selected.size === 0} onClick={() => setStep('confirming')}>
                  Continuar →
                </button>
              </>
            )}
            {step === 'confirming' && (
              <>
                <button className="btn-ghost" onClick={() => setStep('select')}>← Voltar</button>
                <button className="btn-primary" onClick={confirm}>Confirmar e restaurar</button>
              </>
            )}
            {step === 'loading' && (
              <button className="btn-ghost" disabled>Aguarde…</button>
            )}
            {step === 'result' && (
              <button className="btn-primary" onClick={onClose}>Fechar</button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Modal: importar fluxo de outro ambiente para o atual (admin only)
function ImportFromEnvModal({ environments, currentEnv, onClose, onImport }) {
  const [selectedId, setSelectedId] = React.useState(null);
  const [step, setStep] = React.useState('select'); // select | confirming | loading | error
  const [error, setError] = React.useState(null);
  const others = (environments || []).filter(e => !currentEnv || e.id !== currentEnv.id);

  const confirm = async () => {
    if (!selectedId) return;
    setStep('loading'); setError(null);
    try {
      const r = await fetch(`/api/doc/live?env=${selectedId}`);
      if (!r.ok) {
        if (r.status === 404) { setError('O ambiente selecionado nao tem fluxo para importar.'); setStep('error'); return; }
        const d = await r.json().catch(() => ({}));
        setError(d.error || 'Erro ao carregar o fluxo.'); setStep('error'); return;
      }
      const d = await r.json();
      if (!d.ok || !d.data) { setError('Resposta invalida do servidor.'); setStep('error'); return; }
      const sourceEnv = environments.find(e => e.id === selectedId);
      onImport && onImport(d.data, sourceEnv);
      onClose();
    } catch (e) { setError('Erro de conexao.'); setStep('error'); }
  };

  return (
    <div className="sf-modal-overlay" onClick={onClose}>
      <div className="sf-modal" style={{ maxWidth: 520 }} onClick={e => e.stopPropagation()}>
        <button className="sf-close" onClick={onClose}>×</button>
        <div className="sf-header">
          <div className="sf-eyebrow" style={{ color: '#c97639' }}>IMPORTAR FLUXO</div>
          <h2 className="sf-title" style={{ fontSize: 20, marginBottom: 4 }}>Importar de outro ambiente</h2>
          <p className="sf-sub">Substitui completamente o fluxo do ambiente atual pelo fluxo selecionado. Os sub-fluxos tambem serao copiados.</p>
        </div>

        <div style={{ padding: '0 32px 28px' }}>
          {step === 'select' && (
            <>
              {others.length === 0 ? (
                <p style={{ fontSize: 13, color: '#6b6b66', margin: 0 }}>Nenhum outro ambiente disponivel.</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 280, overflowY: 'auto' }}>
                  {others.map(env => (
                    <label key={env.id} style={{
                      display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px',
                      borderRadius: 7, cursor: 'pointer',
                      background: selectedId === env.id ? '#dbeaff' : '#fafaf9',
                      border: '1.5px solid ' + (selectedId === env.id ? '#1f5dbb' : 'rgba(0,0,0,0.08)'),
                      transition: 'border-color 0.12s, background 0.12s',
                    }}>
                      <input type="radio" name="import-env" value={env.id}
                             checked={selectedId === env.id}
                             onChange={() => setSelectedId(env.id)}
                             style={{ accentColor: '#1f5dbb', flexShrink: 0 }} />
                      {env.logo ? (
                        <img src={env.logo} alt="" style={{ height: 28, width: 28, objectFit: 'contain', borderRadius: 4 }} />
                      ) : (
                        <span style={{ width: 28, height: 28, borderRadius: '50%', background: '#dbeaff', color: '#1f5dbb',
                                       display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700 }}>
                          {(env.name || '?').charAt(0).toUpperCase()}
                        </span>
                      )}
                      <span style={{ fontSize: 14, fontWeight: 600 }}>{env.name}</span>
                    </label>
                  ))}
                </div>
              )}
            </>
          )}
          {step === 'confirming' && (
            <div style={{ padding: '12px 0' }}>
              <div style={{ background: '#fff5e6', border: '1px solid #f5c97a', borderRadius: 8, padding: '12px 14px', marginBottom: 12 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#92400e', marginBottom: 4 }}>⚠ Atencao</div>
                <div style={{ fontSize: 13, color: '#3a3a36', lineHeight: 1.5 }}>
                  O fluxo atual do ambiente <b>"{currentEnv?.name}"</b> sera <b>completamente substituido</b> pelo fluxo do
                  ambiente <b>"{environments.find(e => e.id === selectedId)?.name}"</b>. Isso inclui nos, setas e sub-fluxos.
                </div>
                <div style={{ fontSize: 12, color: '#6b6b66', marginTop: 8 }}>
                  Sugestao: faca um backup antes de importar.
                </div>
              </div>
            </div>
          )}
          {step === 'loading' && (
            <div style={{ padding: '20px 0', color: '#6b6b66', textAlign: 'center', fontSize: 13 }}>Importando...</div>
          )}
          {step === 'error' && (
            <div style={{ padding: '12px 0', color: '#a52828', fontSize: 13 }}>{error}</div>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16, borderTop: '1px solid rgba(0,0,0,0.08)', paddingTop: 16 }}>
            <button className="btn-ghost" onClick={onClose} disabled={step === 'loading'}>Cancelar</button>
            {step === 'select' && (
              <button className="btn-primary" disabled={!selectedId} onClick={() => setStep('confirming')}>
                Continuar →
              </button>
            )}
            {step === 'confirming' && (
              <button className="btn-primary" onClick={confirm}>
                Confirmar e substituir
              </button>
            )}
            {step === 'error' && (
              <button className="btn-ghost" onClick={() => setStep('select')}>← Voltar</button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Switcher de ambiente no topbar
function EnvironmentSwitcher({ environments, currentEnv, onSwitch, isAdmin, onCreate, onEdit }) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef(null);

  React.useEffect(() => {
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    if (open) document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  if (!currentEnv) return null;

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button onClick={() => setOpen(o => !o)}
              style={{
                display: 'flex', alignItems: 'center', gap: 8, padding: '4px 10px 4px 4px',
                background: '#fff', border: '1px solid rgba(0,0,0,0.12)', borderRadius: 7,
                cursor: 'pointer', font: '13px inherit', maxWidth: 220,
              }} title={currentEnv.name}>
        {currentEnv.logo ? (
          <img src={currentEnv.logo} alt="" style={{ height: 22, width: 22, objectFit: 'contain', borderRadius: 4 }} />
        ) : (
          <span style={{ width: 22, height: 22, borderRadius: '50%', background: '#dbeaff', color: '#1f5dbb',
                         display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700 }}>
            {(currentEnv.name || '?').charAt(0).toUpperCase()}
          </span>
        )}
        <span style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{currentEnv.name}</span>
        <span style={{ color: '#6b6b66', fontSize: 10 }}>▼</span>
      </button>
      {open && (
        <div style={{ position: 'absolute', top: 'calc(100% + 4px)', left: 0, zIndex: 1000,
                       background: '#fff', border: '1px solid rgba(0,0,0,0.10)', borderRadius: 8,
                       boxShadow: '0 6px 24px rgba(0,0,0,0.12)', minWidth: 260, padding: 6 }}>
          <div style={{ fontSize: 10, color: '#6b6b66', textTransform: 'uppercase', letterSpacing: '0.06em',
                        fontWeight: 700, padding: '6px 10px 4px' }}>Ambientes</div>
          {environments.map(env => (
            <div key={env.id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: 2 }}>
              <button onClick={() => { onSwitch(env); setOpen(false); }}
                      style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px',
                               background: env.id === currentEnv.id ? '#eef3ff' : 'transparent',
                               border: 'none', borderRadius: 6, cursor: 'pointer',
                               font: '13px inherit', textAlign: 'left', color: 'inherit' }}>
                {env.logo ? (
                  <img src={env.logo} alt="" style={{ height: 20, width: 20, objectFit: 'contain', borderRadius: 3 }} />
                ) : (
                  <span style={{ width: 20, height: 20, borderRadius: '50%', background: '#dbeaff', color: '#1f5dbb',
                                 display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700 }}>
                    {(env.name || '?').charAt(0).toUpperCase()}
                  </span>
                )}
                <span style={{ flex: 1, fontWeight: env.id === currentEnv.id ? 700 : 500 }}>{env.name}</span>
                {env.id === currentEnv.id && <span style={{ color: '#1f5dbb', fontSize: 12 }}>✓</span>}
              </button>
              {isAdmin && (
                <button onClick={() => { onEdit(env); setOpen(false); }}
                        title="Editar"
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6b6b66', fontSize: 12, padding: '0 6px' }}>
                  ✎
                </button>
              )}
            </div>
          ))}
          {isAdmin && (
            <>
              <div style={{ borderTop: '1px solid rgba(0,0,0,0.08)', margin: '6px 0' }} />
              <button onClick={() => { onCreate(); setOpen(false); }}
                      style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px',
                               background: 'transparent', border: 'none', borderRadius: 6, cursor: 'pointer',
                               color: '#1f5dbb', fontWeight: 600, fontSize: 13, textAlign: 'left' }}>
                + Criar novo ambiente
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ─── App
function App() {
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);
  const serverDoc = (!PUBLISHED_SLUG && LIVE_DOC) ? LIVE_DOC : null;
  const initial = serverDoc;
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
  const lastSlugLsKey = (envId) => `fluxograma:last-slug:${envId || 'default'}`;
  const [lastPublishedSlug, setLastPublishedSlug] = React.useState(() => {
    try {
      const envId = INITIAL_CURRENT_ENV?.id;
      return localStorage.getItem(lastSlugLsKey(envId)) || localStorage.getItem('fluxograma:last-slug') || '';
    } catch (e) { return ''; }
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
  // ── Multi-ambientes ──
  const [environments, setEnvironments] = React.useState(INITIAL_ENVIRONMENTS);
  const [currentEnv, setCurrentEnv] = React.useState(INITIAL_CURRENT_ENV);
  const [showEnvModal, setShowEnvModal] = React.useState(false);
  const [editingEnv, setEditingEnv] = React.useState(null);
  const [showImportFromEnv, setShowImportFromEnv] = React.useState(false);

  // Troca de ambiente: faz flush sincrono do ambiente atual ANTES de trocar (evita race),
  // limpa localStorage especifico do ambiente, depois muda a sessao e recarrega.
  const switchEnvironment = async (env) => {
    if (!env || (currentEnv && env.id === currentEnv.id)) return;
    // Bloqueio: se um restore esta em andamento, nao deixa trocar de ambiente
    // (evita enviar estado local defasado para live_doc do ambiente antigo)
    if (isRestoringRef.current) {
      alert('Aguarde a restauracao terminar antes de trocar de ambiente.');
      return;
    }
    // Em modo SIMULACAO: nao persiste na sessao do admin. Apenas recarrega a aba simulada
    // com env explicito via query string — o servidor monta a "sessao simulada" sob demanda.
    if (SIMULATE_AS) {
      try { localStorage.removeItem('fluxograma:subflows:v1'); } catch (_) {}
      window.location.href = `/?simulate_as=${encodeURIComponent(SIMULATE_AS)}&env=${env.id}`;
      return;
    }
    try {
      // 1) Cancela autosave debounced pendente
      if (syncTimer.current) clearTimeout(syncTimer.current);
      // 2) Se admin (e nao simulando/publicado), faz flush sincrono do estado atual no ambiente CORRENTE.
      //    SE houve restore recente neste env (isRestoringRef true), PULA o flush — o servidor ja tem a versao correta
      //    e o estado React local pode estar defasado.
      // SO faz flush manual se o boot ja passou (caso contrario, o estado local pode estar parcial)
      const bootPassed = Date.now() - bootAtRef.current >= BOOT_BLOCK_MS;
      if (IS_ADMIN && !SIMULATE_AS && !PUBLISHED_SLUG && currentEnv && !isRestoringRef.current && bootPassed) {
        try {
          const payload = buildDocPayload();
          // Garante explicitamente o env do payload = ambiente atual (nao o destino)
          payload.environmentId = currentEnv.id;
          await fetch('/api/doc/sync', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });
        } catch (_) { /* nao bloqueia troca por erro de sync */ }
      }
      // 3) Limpa subflows do localStorage (compartilhado entre ambientes) — sera repopulado no reload
      try { localStorage.removeItem('fluxograma:subflows:v1'); } catch (_) {}
      // 4) Troca o ambiente no backend
      const r = await fetch('/api/environments/select', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ environmentId: env.id }),
      });
      const d = await r.json();
      if (d.ok) {
        // Recarga garante: live_doc do ambiente correto, baseline limpa, sem mistura de subflows
        window.location.reload();
      } else {
        alert(d.error || 'Erro ao trocar de ambiente.');
      }
    } catch (e) { alert('Erro de conexão.'); }
  };

  const handleEnvSaved = async (env) => {
    // Recarrega lista de ambientes do servidor
    try {
      const r = await fetch('/api/environments');
      const d = await r.json();
      if (d.ok) setEnvironments(d.environments);
    } catch (_) {}
    // Se foi remoção do ambiente atual, ou criação, redireciona
    if (env === null) {
      // Removido — recarregar para forçar nova seleção
      window.location.href = '/';
    } else if (currentEnv && env && env.id === currentEnv.id) {
      setCurrentEnv(env);
    }
  };

  // Aplica subflows do serverDoc ao localStorage imediatamente no primeiro carregamento
  // IMPORTANTE: inclui admins — sem isso o admin salva com localStorage desatualizado
  // e o merge interpreta os subflows de outros usuários como "deletados" pelo admin
  // SEMPRE sobrescreve (mesmo se vazio) para evitar vazamento de subflows entre ambientes
  React.useEffect(() => {
    if (PUBLISHED_SLUG) return;
    try {
      const sf = initial?.subflows || {};
      localStorage.setItem('fluxograma:subflows:v1', JSON.stringify(sf));
    } catch (_) {}
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
      environmentId: currentEnv?.id || null,
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

  // ── Visualizacao publica: seletor de ambiente quando mesmo slug em varios ambientes
  const [publishedEnvId, setPublishedEnvId] = React.useState(() => {
    if (!PUBLISHED_SLUG) return null;
    if (PUBLISHED_ENV_ID) return PUBLISHED_ENV_ID;
    // Tenta recuperar escolha previa do localStorage
    try {
      const stored = parseInt(localStorage.getItem(PUBLISHED_ENV_LS_KEY) || '0', 10);
      if (stored && PUBLISHED_ENVS.some(e => e.id === stored)) return stored;
    } catch (_) {}
    return null;
  });

  // carrega fluxo publicado quando em modo de visualização pública
  const loadPublished = React.useCallback((showToast) => {
    const url = publishedEnvId
      ? `/api/publish/load/${PUBLISHED_SLUG}?env=${publishedEnvId}`
      : `/api/publish/load/${PUBLISHED_SLUG}`;
    fetch(url)
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
  }, [publishedEnvId]);

  // Carga inicial do fluxo publicado (apos selecionar o ambiente, se necessario)
  React.useEffect(() => {
    if (!PUBLISHED_SLUG) return;
    if (PUBLISHED_ENVS.length > 1 && !publishedEnvId) return; // aguarda escolha do usuario
    loadPublished(false);
  }, [publishedEnvId]);

  // Refs com versao atual de publishedEnvId / loadPublished para usar no listener SSE sem closure stale
  const publishedEnvIdRef = React.useRef(publishedEnvId);
  const loadPublishedRef  = React.useRef(loadPublished);
  React.useEffect(() => { publishedEnvIdRef.current = publishedEnvId; }, [publishedEnvId]);
  React.useEffect(() => { loadPublishedRef.current  = loadPublished;  }, [loadPublished]);

  // SSE: ouve atualizações em tempo real enquanto a página está aberta
  React.useEffect(() => {
    if (!PUBLISHED_SLUG) return;
    const es = new EventSource(`/api/events/${PUBLISHED_SLUG}`);
    es.addEventListener('updated', (e) => {
      let evtEnvId = null;
      try {
        const data = JSON.parse(e.data);
        if (data && typeof data === 'object') evtEnvId = data.envId || null;
      } catch (_) {
        // Compatibilidade com payload antigo (string com o slug): trata como sem envId conhecido
      }
      const currentEnvId = publishedEnvIdRef.current;
      // Se o evento informa qual ambiente foi publicado E eu estou vendo outro ambiente, NAO recarrega.
      // Isso evita que publicar em "Paschoini" troque o conteudo de uma aba que esta vendo "Focus".
      if (evtEnvId && currentEnvId && evtEnvId !== currentEnvId) return;
      // Em modo de selecao (sem env escolhido) e ha varios ambientes, tambem nao recarrega — usuario ainda nao escolheu.
      if (!currentEnvId && PUBLISHED_ENVS.length > 1) return;
      loadPublishedRef.current(true);
    });
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
      _tabId: TAB_ID,
      // Declara explicitamente para qual ambiente este payload pertence — evita race condition na troca de ambiente
      environmentId: currentEnv?.id || null,
    };
  };

  // Sync de doc live — envia para o banco via fetch (ou sendBeacon no unload)
  const syncTimer        = React.useRef(null);
  const auditBaselineRef = React.useRef(null); // snapshot do doc quando o modal de subfluxo abriu
  // Timestamp da ultima edicao local — usado para BLOQUEAR SSE doc_updated logo apos uma mudanca local,
  // evitando que a propria aba reverta movimentacoes/exclusoes/edits em curso.
  const lastLocalEditRef = React.useRef(0);
  const modalSessionRef  = React.useRef(false); // true enquanto o modal de subfluxo está aberto

  const flushDocSync = (beacon = false, opts = {}) => {
    // Bloqueia sync nos primeiros segundos apos boot (exceto se for chamada explicita do usuario)
    if (!opts.force && Date.now() - bootAtRef.current < BOOT_BLOCK_MS) return;
    clearTimeout(syncTimer.current);
    const base = buildDocPayload();
    if (opts.auditBaseline) base.auditBaseline = opts.auditBaseline;
    const payload = JSON.stringify(base);
    if (beacon && navigator.sendBeacon) {
      navigator.sendBeacon('/api/doc/sync', new Blob([payload], { type: 'application/json' }));
    } else {
      fetch('/api/doc/sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload })
        .then(() => {
          let subflows = {};
          try { subflows = JSON.parse(localStorage.getItem('fluxograma:subflows:v1') || '{}'); } catch(_) {}
          baseDocRef.current = { nodes: nodesRef.current, edges: edgesRef.current, subflows };
          window.dispatchEvent(new Event('audit-refresh'));
        })
        .catch(() => {});
    }
  };
  const debouncedDocSync = () => {
    if (modalSessionRef.current) return; // Não sincroniza com o banco durante sessão de edição do modal (apenas para mudanças fora do modal)
    if (isRestoringRef.current) return;  // Durante restore, NAO sincroniza estado local (que esta defasado)
    if (Date.now() - bootAtRef.current < BOOT_BLOCK_MS) return; // Boot: evita sync com estado inicial parcial
    clearTimeout(syncTimer.current);
    syncTimer.current = setTimeout(() => flushDocSync(false), 800);
  };

  // Sync automatico de subflows: dispara MESMO durante o modal aberto.
  const autoSubflowSync = () => {
    if (PUBLISHED_SLUG) return;
    if (isRestoringRef.current) return; // bloqueia durante restore
    if (Date.now() - bootAtRef.current < BOOT_BLOCK_MS) return; // boot
    lastLocalEditRef.current = Date.now();
    clearTimeout(syncTimer.current);
    syncTimer.current = setTimeout(() => flushDocSync(false), 1500);
  };

  // Garante sync antes de fechar/recarregar a página — agora para TODOS (nao so admin)
  React.useEffect(() => {
    if (PUBLISHED_SLUG) return;
    const onUnload = () => {
      try { flushDocSync(true); } catch (_) {}
    };
    window.addEventListener('beforeunload', onUnload);
    return () => window.removeEventListener('beforeunload', onUnload);
  }, []);

  // Captura baseline ao abrir o modal de subfluxo; limpa refs se fechar por outra via
  React.useEffect(() => {
    if (!IS_ADMIN || SIMULATE_AS || PUBLISHED_SLUG) return;
    if (openNodeId && !modalSessionRef.current) {
      let subflows = {};
      try { subflows = JSON.parse(localStorage.getItem('fluxograma:subflows:v1') || '{}'); } catch(e) {}
      auditBaselineRef.current = { nodes: nodesRef.current, edges: edgesRef.current, subflows };
      modalSessionRef.current = true;
    } else if (!openNodeId && modalSessionRef.current) {
      // Fechado sem passar por handleNodeModalClose (ex: enterEditor) — só limpa refs
      modalSessionRef.current = false;
      auditBaselineRef.current = null;
      clearTimeout(syncTimer.current);
    }
  }, [openNodeId]);

  // Chamado pelo NodeModal com shouldSave=true (Salvar) ou false (Descartar)
  const handleNodeModalClose = (shouldSave) => {
    const baseline = auditBaselineRef.current;
    modalSessionRef.current = false;
    auditBaselineRef.current = null;
    clearTimeout(syncTimer.current);
    if (shouldSave) {
      // Admin: usa flushDocSync com baseline (gera audit + sincroniza live_doc)
      if (IS_ADMIN && !SIMULATE_AS && baseline) {
        flushDocSync(false, { auditBaseline: baseline });
      } else if (!PUBLISHED_SLUG) {
        // Usuario comum (ou admin simulando): forca persistencia imediata via quickSave
        // (salva backup + sincroniza live_doc com os subflows atuais do localStorage)
        try { quickSave(); } catch (_) {}
      }
    } else if (baseline?.subflows) {
      // Descartar: reverte subflows do localStorage ao estado de quando o modal foi aberto
      try { localStorage.setItem('fluxograma:subflows:v1', JSON.stringify(baseline.subflows)); } catch(e) {}
    }
    setOpenNodeId(null);
  };

  // ── Restaurar do fluxo publicado ──
  // Modal permite escolher quais ambientes restaurar (1 ou varios). Backend faz tudo em lote.
  // CRITICO: durante o restore, NENHUM sync local pode disparar porque o estado React local
  // ainda esta com a versao antiga; se um sync sair, vai sobrescrever live_doc com versao antiga.
  const [showRestoreModal, setShowRestoreModal] = React.useState(false);
  const [showRestoreBackupModal, setShowRestoreBackupModal] = React.useState(false);
  // Inicializa isRestoringRef como TRUE se ouve um restore muito recente neste ambiente.
  // Isso protege contra "primeiro sync apos reload" que poderia enviar estado defasado.
  const RESTORE_PROTECTION_MS = 5000;
  const isRestoringRef = React.useRef((() => {
    try {
      const envId = INITIAL_CURRENT_ENV?.id;
      if (!envId) return false;
      const ts = parseInt(localStorage.getItem(`fluxograma:restored-at:${envId}`) || '0', 10);
      return ts && (Date.now() - ts < RESTORE_PROTECTION_MS);
    } catch (_) { return false; }
  })());
  // Timestamp do boot: bloqueia qualquer sync nos primeiros 3 segundos.
  // Isso impede que o primeiro useEffect [nodes,edges,...] envie sync com estado
  // parcial (especialmente quando window.__LIVE_DOC__ esta null e cai para SEED_NODES).
  const BOOT_BLOCK_MS = 3000;
  const bootAtRef = React.useRef(Date.now());
  // Limpa a flag depois da janela de protecao, se foi setada via LS no boot
  React.useEffect(() => {
    if (!isRestoringRef.current) return;
    const t = setTimeout(() => { isRestoringRef.current = false; }, RESTORE_PROTECTION_MS);
    return () => clearTimeout(t);
  }, []);

  const handleRestoreStart = () => {
    isRestoringRef.current = true;
    // Marca no LS o timestamp do restore para o ambiente atual (caso a pagina recarregue,
    // o boot le esse timestamp e continua bloqueando syncs por uns segundos).
    try {
      if (currentEnv?.id) {
        localStorage.setItem(`fluxograma:restored-at:${currentEnv.id}`, String(Date.now()));
      }
    } catch (_) {}
    // Cancela qualquer sync debounced pendente
    if (syncTimer.current) { clearTimeout(syncTimer.current); syncTimer.current = null; }
  };
  const handleRestoreDone = (result) => {
    // Se o ambiente atual foi restaurado, recarrega a pagina IMEDIATAMENTE para pegar a versao
    // limpa do servidor — sem timeout, sem deixar window de race.
    if (result && result.currentRestored) {
      // Cancela syncs pendentes e marca isRestoring para que nenhum useEffect dispare sync
      if (syncTimer.current) { clearTimeout(syncTimer.current); syncTimer.current = null; }
      window.location.reload();
      return;
    }
    // Libera flag depois de uma pequena janela (alguma SSE doc_updated pode chegar)
    setTimeout(() => { isRestoringRef.current = false; }, 1500);
  };

  // Carrega o último slug publicado do banco (para não perder referência entre sessões/dispositivos)
  // Reexecuta quando o ambiente corrente muda
  React.useEffect(() => {
    if (!IS_ADMIN || PUBLISHED_SLUG) return;
    fetch('/api/publish/last-slug')
      .then(r => r.json())
      .then(d => {
        if (d.ok && d.slug) {
          setLastPublishedSlug(d.slug);
          try { localStorage.setItem(lastSlugLsKey(currentEnv?.id), d.slug); } catch (_) {}
        } else {
          // Sem publicação nesse ambiente: limpa para nao oferecer slug de outro ambiente
          setLastPublishedSlug('');
        }
      })
      .catch(() => {});
  }, [currentEnv?.id]);

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
          // Subflows ficam no localStorage — sincronizar junto com o resto.
          // CRITICO: NAO sobrescreve subflows do LS se o modal esta aberto (pode haver edicoes em curso),
          // ou se houve edicao local recente (lastLocalEditRef nos ultimos 3s).
          const modalOpen = modalSessionRef.current;
          const recentEdit = Date.now() - lastLocalEditRef.current < 3000;
          if (d.data.subflows && !modalOpen && !recentEdit) {
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
    // (admin recebe dados frescos via LIVE_DOC no HTML, que agora tem Cache-Control: no-store)
    if (!IS_ADMIN || SIMULATE_AS) applyLiveDoc();

    const es = new EventSource('/api/events/__main__');

    // Alguém salvou → atualiza doc completo; ignora somente SE for esta mesma aba
    // (outras abas do mesmo usuário DEVEM receber a atualização)
    es.addEventListener('doc_updated', (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.tabId && data.tabId === TAB_ID) return;
      } catch (_) {}
      // Defesa: se houve edicao local recente, NAO sobrescreve — evita reverter movimentacoes,
      // exclusoes ou edits em curso por causa de SSE que chegou desordenado ou sem tabId.
      if (Date.now() - lastLocalEditRef.current < 3000) return;
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
    // Marca timestamp da edicao local para que o handler de SSE doc_updated nao sobrescreva mudanças em curso
    lastLocalEditRef.current = Date.now();
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
        ? `/api/access-request/mine?simulate_as=${encodeURIComponent(SIMULATE_AS)}${currentEnv ? `&env=${currentEnv.id}` : ''}`
        : '/api/access-request/mine';
      fetch(url)
        .then(r => r.json())
        .then(d => { if (d.ok) setMyRequests(d.requests); });
    }
  }, []);

  const requestAccess = async (nodeId, nodeTitle) => {
    const body = { nodeId, nodeTitle };
    if (SIMULATE_AS) body.simulateAs = SIMULATE_AS;
    if (currentEnv) body.environmentId = currentEnv.id;
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

  // Tela de selecao de ambiente para link publico (mesmo slug em multiplos ambientes)
  if (PUBLISHED_SLUG && PUBLISHED_ENVS.length > 1 && !publishedEnvId) {
    return (
      <PublishedEnvPicker
        envs={PUBLISHED_ENVS}
        onSelect={(env) => {
          try { localStorage.setItem(PUBLISHED_ENV_LS_KEY, String(env.id)); } catch (_) {}
          setPublishedEnvId(env.id);
        }} />
    );
  }

  // Tela de seleção de ambiente: usuário com múltiplos ambientes sem env corrente, ou admin sem ambiente
  const needsEnvPicker = !PUBLISHED_SLUG && CURRENT_USER && !currentEnv && environments.length !== 1;
  if (needsEnvPicker) {
    return (
      <>
        <EnvironmentPicker
          envs={environments}
          isAdmin={IS_ADMIN}
          onCreate={() => { setEditingEnv(null); setShowEnvModal(true); }}
          onSelect={(env) => switchEnvironment(env)} />
        {showEnvModal && (
          <EnvironmentModal env={editingEnv} onClose={() => setShowEnvModal(false)}
                            onSaved={(newEnv) => {
                              if (newEnv) {
                                // Após criar/editar, recarrega lista; se for nova criação, seleciona ela
                                fetch('/api/environments').then(r => r.json()).then(d => {
                                  if (d.ok) setEnvironments(d.environments);
                                  if (newEnv && !editingEnv) switchEnvironment(newEnv);
                                });
                              } else {
                                window.location.href = '/';
                              }
                            }} />
        )}
      </>
    );
  }

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
            {!PUBLISHED_SLUG && currentEnv && (
              <>
                <div className="divider" />
                <EnvironmentSwitcher
                  environments={environments}
                  currentEnv={currentEnv}
                  onSwitch={switchEnvironment}
                  isAdmin={IS_ADMIN}
                  onCreate={() => { setEditingEnv(null); setShowEnvModal(true); }}
                  onEdit={(env) => { setEditingEnv(env); setShowEnvModal(true); }} />
              </>
            )}
            {PUBLISHED_SLUG && PUBLISHED_ENVS.length > 1 && publishedEnvId && (
              <>
                <div className="divider" />
                <PublishedEnvSwitcher
                  envs={PUBLISHED_ENVS}
                  currentEnvId={publishedEnvId}
                  onSwitch={(env) => {
                    try { localStorage.setItem(PUBLISHED_ENV_LS_KEY, String(env.id)); } catch (_) {}
                    setPublishedEnvId(env.id);
                  }}
                  onChooseAgain={() => {
                    try { localStorage.removeItem(PUBLISHED_ENV_LS_KEY); } catch (_) {}
                    setPublishedEnvId(null);
                  }} />
              </>
            )}
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
                {IS_ADMIN && environments.filter(e => !currentEnv || e.id !== currentEnv.id).length > 0 && (
                  <button className="btn-ghost" onClick={() => setShowImportFromEnv(true)}
                          title="Substitui o fluxo atual pelo fluxo de outro ambiente">
                    ⬇ Importar de outro ambiente
                  </button>
                )}
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
                {IS_ADMIN && (
                  <button className="btn-ghost"
                          onClick={() => setShowRestoreModal(true)}
                          title="Substitui o fluxo de trabalho de um ou mais ambientes pelo fluxo publicado de cada um">
                    ↻ Restaurar do publicado
                  </button>
                )}
                {IS_ADMIN && <button className="btn-primary" onClick={() => setShowPublish(true)}>Publicar</button>}
              </>
            ) : (
              <>
                <button className="btn-ghost" onClick={() => setShowBackup(true)}>💾 Backup</button>
                {IS_ADMIN && (
                  <button className="btn-ghost"
                          onClick={() => setShowRestoreModal(true)}
                          title="Substitui o fluxo de trabalho de um ou mais ambientes pelo fluxo publicado">
                    ↻ Restaurar do publicado
                  </button>
                )}
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
                   onClose={handleNodeModalClose}
                   onRequestAccess={!IS_ADMIN && !PUBLISHED_SLUG && !canEditNode(openNode) ? requestAccess : undefined}
                   requestStatus={myRequests[openNode?.id]}
                   onSubflowChange={!PUBLISHED_SLUG ? autoSubflowSync : undefined} />
      )}
      {showPublish && (
        <PublishDialog
          onClose={() => setShowPublish(false)}
          nodes={nodes} edges={edges} docTitle={docTitle} flowTitle={flowTitle} flowLogo={flowLogo} flowTitleFont={flowTitleFont} flowTitleSize={flowTitleSize} legend={legend} legendConfig={legendConfig}
          lastSlug={lastPublishedSlug}
          onPublished={(slug) => {
            setLastPublishedSlug(slug);
            try { localStorage.setItem(lastSlugLsKey(currentEnv?.id), slug); } catch (e) {}
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
      {showEnvModal && (
        <EnvironmentModal env={editingEnv} onClose={() => setShowEnvModal(false)}
                          onSaved={handleEnvSaved} />
      )}
      {showRestoreModal && (
        <RestoreFromPublishedModal
          environments={environments}
          currentEnv={currentEnv}
          onClose={() => setShowRestoreModal(false)}
          onStart={handleRestoreStart}
          onDone={handleRestoreDone} />
      )}
      {showImportFromEnv && (
        <ImportFromEnvModal
          environments={environments}
          currentEnv={currentEnv}
          onClose={() => setShowImportFromEnv(false)}
          onImport={(data, sourceEnv) => {
            // Substitui o estado local com os dados do ambiente importado
            if (data.nodes)         setNodes(data.nodes);
            if (data.edges)         setEdges(data.edges);
            if (data.title    != null) setDocTitle(data.title);
            if (data.flowTitle     != null) setFlowTitle(data.flowTitle);
            if (data.flowLogo      != null) setFlowLogo(data.flowLogo);
            if (data.flowTitleFont != null) setFlowTitleFont(data.flowTitleFont);
            if (data.flowTitleSize != null) setFlowTitleSize(data.flowTitleSize);
            if (data.legend        != null) setLegend(data.legend);
            if (data.legendConfig  != null) setLegendConfig(data.legendConfig);
            // Aplica subflows no localStorage (sempre, ate vazio)
            try { localStorage.setItem('fluxograma:subflows:v1', JSON.stringify(data.subflows || {})); } catch (_) {}
            window.dispatchEvent(new CustomEvent('subflows-updated'));
            // Atualiza baseline para que o proximo sync nao seja interpretado como "muitas mudancas paralelas"
            baseDocRef.current = { nodes: data.nodes || [], edges: data.edges || [], subflows: data.subflows || {} };
            // Sincroniza imediatamente para persistir no banco
            setTimeout(() => { try { flushDocSync(false); } catch (_) {} }, 50);
            // Feedback visual reusa o toast de "atualizacao"
            setUpdateToast(true);
            setTimeout(() => setUpdateToast(false), 4000);
          }} />
      )}
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
