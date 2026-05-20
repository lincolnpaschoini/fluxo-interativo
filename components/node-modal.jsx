// node-modal.jsx
// Popup com sub-fluxograma (editável).
// Aparece em 3 estilos: modal | drawer | drill.
// Suporta 3 níveis: Fluxo principal → Sub-fluxo → Sub-etapas (3° nível).

const SUBFLOW_STORAGE_KEY = 'fluxograma:subflows:v1';

function loadSubflows() {
  try { return JSON.parse(localStorage.getItem(SUBFLOW_STORAGE_KEY) || '{}'); }
  catch (e) { return {}; }
}
function saveSubflows(data) {
  try { localStorage.setItem(SUBFLOW_STORAGE_KEY, JSON.stringify(data)); } catch (e) {}
}

const COLOR_OPTIONS = ['blue', 'green', 'orange', 'yellow'];

// ─── Lightbox ─────────────────────────────────────────────────────────────────
function Lightbox({ images, startIdx, onClose }) {
  const [idx, setIdx] = React.useState(startIdx || 0);
  const total = images.length;

  React.useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight') setIdx(i => (i + 1) % total);
      if (e.key === 'ArrowLeft')  setIdx(i => (i - 1 + total) % total);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [total, onClose]);

  const img = images[idx];
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 3000, background: 'rgba(0,0,0,0.92)',
                  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}
         onClick={onClose}>
      {total > 1 && (
        <button onClick={(e) => { e.stopPropagation(); setIdx(i => (i - 1 + total) % total); }}
                style={{ position: 'absolute', left: 20, top: '50%', transform: 'translateY(-50%)',
                         background: 'rgba(255,255,255,0.15)', border: 'none', borderRadius: '50%',
                         width: 44, height: 44, fontSize: 22, color: '#fff', cursor: 'pointer' }}>‹</button>
      )}
      <img src={img.url} alt={img.caption || ''}
           style={{ maxWidth: '88vw', maxHeight: '82vh', objectFit: 'contain',
                    borderRadius: 6, boxShadow: '0 8px 48px rgba(0,0,0,0.5)' }}
           onClick={(e) => e.stopPropagation()} />
      {img.caption && (
        <div style={{ marginTop: 14, color: 'rgba(255,255,255,0.85)', fontSize: 14,
                      maxWidth: 600, textAlign: 'center', lineHeight: 1.5 }}>
          {img.caption}
        </div>
      )}
      {total > 1 && (
        <>
          <button onClick={(e) => { e.stopPropagation(); setIdx(i => (i + 1) % total); }}
                  style={{ position: 'absolute', right: 20, top: '50%', transform: 'translateY(-50%)',
                           background: 'rgba(255,255,255,0.15)', border: 'none', borderRadius: '50%',
                           width: 44, height: 44, fontSize: 22, color: '#fff', cursor: 'pointer' }}>›</button>
          <div style={{ position: 'absolute', bottom: 20, color: 'rgba(255,255,255,0.5)', fontSize: 13 }}>
            {idx + 1} / {total}
          </div>
        </>
      )}
      <button onClick={onClose}
              style={{ position: 'absolute', top: 16, right: 20, background: 'rgba(255,255,255,0.12)',
                       border: 'none', borderRadius: '50%', width: 36, height: 36,
                       fontSize: 20, color: '#fff', cursor: 'pointer', lineHeight: 1 }}>×</button>
    </div>
  );
}

// ─── Rich Text Editor ─────────────────────────────────────────────────────────
function RichTextEditor({ value, onChange, placeholder }) {
  const divRef = React.useRef(null);
  const lastHtmlRef = React.useRef(value || '');

  React.useEffect(() => {
    if (divRef.current) {
      divRef.current.innerHTML = lastHtmlRef.current;
    }
  }, []);

  React.useEffect(() => {
    if (divRef.current && value !== lastHtmlRef.current) {
      lastHtmlRef.current = value || '';
      divRef.current.innerHTML = lastHtmlRef.current;
    }
  }, [value]);

  const handleInput = () => {
    const html = divRef.current?.innerHTML || '';
    lastHtmlRef.current = html;
    onChange(html);
  };

  const exec = (cmd, arg) => {
    divRef.current?.focus();
    document.execCommand(cmd, false, arg || null);
  };

  return (
    <div className="rte-wrap">
      <div className="rte-toolbar">
        <button type="button" title="Negrito (Ctrl+B)"
                onMouseDown={(e) => { e.preventDefault(); exec('bold'); }}
                style={{ fontWeight: 700 }}>B</button>
        <button type="button" title="Itálico (Ctrl+I)"
                onMouseDown={(e) => { e.preventDefault(); exec('italic'); }}
                style={{ fontStyle: 'italic' }}>I</button>
        <button type="button" title="Sublinhado (Ctrl+U)"
                onMouseDown={(e) => { e.preventDefault(); exec('underline'); }}
                style={{ textDecoration: 'underline' }}>U</button>
        <div className="rte-toolbar-sep" />
        <button type="button" title="Lista com marcadores"
                onMouseDown={(e) => { e.preventDefault(); exec('insertUnorderedList'); }}>• Lista</button>
        <button type="button" title="Lista numerada"
                onMouseDown={(e) => { e.preventDefault(); exec('insertOrderedList'); }}>1. Lista</button>
        <div className="rte-toolbar-sep" />
        <button type="button" title="Remover formatação"
                onMouseDown={(e) => { e.preventDefault(); exec('removeFormat'); }}
                style={{ fontSize: 10, opacity: 0.7 }}>Tx</button>
      </div>
      <div
        ref={divRef}
        className="rte-body"
        contentEditable
        suppressContentEditableWarning
        onInput={handleInput}
        data-placeholder={placeholder || ''}
      />
    </div>
  );
}

// ─── Galeria de imagens (reutilizável) ────────────────────────────────────────
function ImageGallery({ images, editorMode, onAddMany, onRemove }) {
  const [lightbox, setLightbox] = React.useState(null);
  const [uploading, setUploading] = React.useState(false);
  const [uploadError, setUploadError] = React.useState('');

  const handleFiles = (files) => {
    const fileArray = Array.from(files);
    if (!fileArray.length) return;
    setUploading(true);
    setUploadError('');
    Promise.all(fileArray.map(file => new Promise(resolve => {
      // Validação de tamanho no cliente (limite de 6 MB)
      if (file.size > 6 * 1024 * 1024) {
        resolve({ error: `"${file.name}" é grande demais (máximo 6 MB)` });
        return;
      }
      const reader = new FileReader();
      reader.onload = (e) => {
        fetch('/api/images/upload', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filename: file.name, data: e.target.result }),
        })
          .then(r => r.json())
          .then(d => resolve(d.ok
            ? { id: 'img' + Date.now() + Math.random(), url: d.url, caption: '' }
            : { error: d.error || 'Falha ao enviar imagem' }
          ))
          .catch(() => resolve({ error: 'Erro de conexão ao enviar imagem' }));
      };
      reader.readAsDataURL(file);
    }))).then(results => {
      setUploading(false);
      const errors = results.filter(r => r && r.error).map(r => r.error);
      const newImgs = results.filter(r => r && r.url);
      if (errors.length) setUploadError(errors.join(' · '));
      if (newImgs.length && onAddMany) onAddMany(newImgs);
    });
  };

  if (!editorMode && (!images || images.length === 0)) return null;

  return (
    <div style={{ marginTop: 8 }}>
      {images && images.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: editorMode ? 6 : 0 }}>
          {images.map((img, ii) => (
            <div key={img.id || ii} style={{ position: 'relative', flexShrink: 0 }}>
              <img src={img.url} alt={img.caption || ''}
                   style={{ width: 72, height: 72, objectFit: 'cover', borderRadius: 5,
                            cursor: 'pointer', border: '1.5px solid rgba(0,0,0,0.12)',
                            display: 'block' }}
                   onClick={(e) => { e.stopPropagation(); setLightbox(ii); }} />
              {editorMode && (
                <button onClick={(e) => { e.stopPropagation(); onRemove(ii); }}
                        style={{ position: 'absolute', top: -6, right: -6, width: 18, height: 18,
                                 borderRadius: '50%', background: '#a52828', border: '1.5px solid #fff',
                                 color: '#fff', fontSize: 11, lineHeight: 1, cursor: 'pointer',
                                 display: 'flex', alignItems: 'center', justifyContent: 'center',
                                 padding: 0, fontFamily: 'inherit' }}>×</button>
              )}
            </div>
          ))}
        </div>
      )}
      {editorMode && (
        <>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11,
                          padding: '3px 8px', borderRadius: 4, border: '1px solid rgba(0,0,0,0.18)',
                          background: uploading ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.55)',
                          cursor: uploading ? 'default' : 'pointer', userSelect: 'none',
                          opacity: uploading ? 0.7 : 1 }}>
            <input type="file" accept="image/*" multiple style={{ display: 'none' }}
                   disabled={uploading}
                   onChange={(e) => { handleFiles(e.target.files); e.target.value = ''; }} />
            {uploading ? '⏳ Enviando...' : '🖼 Adicionar imagens'}
          </label>
          {uploadError && (
            <div style={{ marginTop: 4, fontSize: 11, color: '#a52828', display: 'flex', alignItems: 'center', gap: 4 }}>
              <span>⚠</span> {uploadError}
              <button onClick={() => setUploadError('')}
                      style={{ marginLeft: 4, background: 'none', border: 'none', cursor: 'pointer',
                               color: '#a52828', fontSize: 11, padding: 0, lineHeight: 1 }}>×</button>
            </div>
          )}
        </>
      )}
      {lightbox !== null && (
        <Lightbox images={images} startIdx={lightbox} onClose={() => setLightbox(null)} />
      )}
    </div>
  );
}

function makeEmptySubflow(parentColor) {
  const c = parentColor === 'yellow' ? 'blue' : (parentColor || 'blue');
  return {
    steps: [
      { id: 's1', title: 'Etapa 1', desc: 'Descreva o que acontece aqui.', color: c, owner: '', duration: '', hasSubflow: false, subSteps: [] },
      { id: 's2', title: 'Etapa 2', desc: 'Próxima ação do processo.',     color: c, owner: '', duration: '', hasSubflow: false, subSteps: [] },
      { id: 's3', title: 'Etapa 3', desc: 'Resultado / handoff.',           color: c, owner: '', duration: '', hasSubflow: false, subSteps: [] },
    ],
  };
}

// ─── 3° Nível: modal de sub-etapas ───────────────────────────────────────────
function ThirdLevelModal({ step, editorMode, onClose, onSave }) {
  const colors = window.NODE_COLORS;
  const [subSteps, setSubSteps] = React.useState(() =>
    step.subSteps && step.subSteps.length > 0
      ? step.subSteps
      : [{ id: 'ss1', title: 'Sub-etapa 1', desc: '', color: step.color || 'blue', owner: '', duration: '' }]
  );
  const openedSubStepsRef   = React.useRef(JSON.parse(JSON.stringify(step.subSteps || [])));
  const [showSaveConfirm, setShowSaveConfirm] = React.useState(false);

  const updateSub = (i, patch) =>
    setSubSteps((ss) => ss.map((s, j) => j === i ? { ...s, ...patch } : s));

  const addSubImages = (si, imgs) =>
    setSubSteps(ss => ss.map((s, j) => j === si ? { ...s, images: [...(s.images || []), ...imgs] } : s));
  const removeSubImage = (si, ii) =>
    setSubSteps(ss => ss.map((s, j) => j === si ? { ...s, images: (s.images || []).filter((_, k) => k !== ii) } : s));

  const addSubLink = (si) => {
    const id = 'lk' + (Date.now() % 1e6);
    setSubSteps(ss => ss.map((s, j) => j === si ? { ...s, links: [...(s.links || []), { id, label: '', url: '' }] } : s));
  };
  const updateSubLink = (si, li, patch) => {
    setSubSteps(ss => ss.map((s, j) => j === si
      ? { ...s, links: (s.links || []).map((l, k) => k === li ? { ...l, ...patch } : l) } : s));
  };
  const removeSubLink = (si, li) => {
    setSubSteps(ss => ss.map((s, j) => j === si
      ? { ...s, links: (s.links || []).filter((_, k) => k !== li) } : s));
  };

  const addSub = () => {
    const id = 'ss' + (Date.now() % 100000);
    const last = subSteps[subSteps.length - 1];
    setSubSteps((ss) => [...ss, { id, title: 'Nova sub-etapa', desc: '', color: last?.color || 'blue', owner: '', duration: '' }]);
  };

  const removeSub = (i) => {
    if (subSteps.length <= 1) return;
    setSubSteps((ss) => ss.filter((_, j) => j !== i));
  };

  const handleClose = () => {
    if (!editorMode) { onClose(); return; }
    const hasChanges = JSON.stringify(subSteps) !== JSON.stringify(openedSubStepsRef.current);
    if (hasChanges) { setShowSaveConfirm(true); } else { onClose(); }
  };
  const handleSave    = () => { onSave(subSteps); onClose(); };
  const handleDiscard = () => { setShowSaveConfirm(false); onClose(); };

  React.useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !showSaveConfirm) handleClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [subSteps, showSaveConfirm]);

  const arrow = (
    <div className="sf-arrow" aria-hidden="true">
      <svg width="32" height="22" viewBox="0 0 32 22">
        <path d="M 2 11 L 26 11" stroke="#888" strokeWidth="1.6" fill="none" />
        <path d="M 22 5 L 28 11 L 22 17" stroke="#888" strokeWidth="1.6" fill="none" />
      </svg>
    </div>
  );

  return (
    <div className="sf-modal-overlay" style={{ zIndex: 1200 }} onClick={handleClose}>
      <div className="sf-modal" style={{ maxWidth: 960 }} onClick={(e) => e.stopPropagation()}>
        <div className="sf-header" style={{ borderColor: '#c97639' }}>
          <div className="sf-eyebrow" style={{ color: '#c97639' }}>
            3° NÍVEL · SUB-ETAPAS{editorMode ? ' · MODO EDIÇÃO' : ''}
          </div>
          <h2 className="sf-title">{step.title}</h2>
          <p className="sf-sub">
            {editorMode ? 'Edite as sub-etapas desta etapa.' : 'Sub-etapas desta etapa.'}
          </p>
          <button className="sf-close" onClick={handleClose} aria-label="Fechar">×</button>
        </div>
        <div className="sf-editor">
          <div className="sf-flow">
            {subSteps.map((sub, i) => {
              const c = colors[sub.color] || colors.blue;
              return (
                <React.Fragment key={sub.id}>
                  <div className="sf-step" style={{ background: c.fill, borderColor: c.stroke, color: c.text }}>
                    {editorMode && (
                      <button className="sf-step-x" onClick={() => removeSub(i)}
                              title="Remover sub-etapa" aria-label="Remover">×</button>
                    )}
                    {editorMode ? (
                      <>
                        <input className="sf-step-title" value={sub.title}
                               onChange={(e) => updateSub(i, { title: e.target.value })}
                               placeholder="Título da sub-etapa" />
                        <RichTextEditor value={sub.desc || ''}
                                        onChange={(html) => updateSub(i, { desc: html })}
                                        placeholder="Detalhes, responsáveis, ferramentas..." />
                        <div className="sf-step-meta">
                          <input value={sub.owner || ''} onChange={(e) => updateSub(i, { owner: e.target.value })} placeholder="Responsável" />
                          <input value={sub.duration || ''} onChange={(e) => updateSub(i, { duration: e.target.value })} placeholder="Prazo" />
                        </div>
                        <div className="sf-step-colors">
                          {COLOR_OPTIONS.map((col) => (
                            <button key={col}
                                    className={'sf-color' + (sub.color === col ? ' on' : '')}
                                    style={{ background: colors[col].fill, borderColor: colors[col].stroke }}
                                    onClick={() => updateSub(i, { color: col })} title={col} />
                          ))}
                        </div>
                        <div style={{ borderTop: '1px solid rgba(0,0,0,0.08)', marginTop: 8, paddingTop: 8 }}>
                          <ImageGallery images={sub.images || []} editorMode={true}
                                        onAddMany={(imgs) => addSubImages(i, imgs)}
                                        onRemove={(ii) => removeSubImage(i, ii)} />
                        </div>
                        <div style={{ borderTop: '1px solid rgba(0,0,0,0.08)', marginTop: 8, paddingTop: 8 }}>
                          {(sub.links || []).map((link, li) => (
                            <div key={link.id || li} style={{ display: 'flex', gap: 4, alignItems: 'center', marginBottom: 4 }}>
                              <input value={link.label} onChange={(e) => updateSubLink(i, li, { label: e.target.value })}
                                     placeholder="Nome" style={{ flex: '0 0 110px', fontSize: 11, padding: '3px 6px',
                                     borderRadius: 4, border: '1px solid rgba(0,0,0,0.2)', fontFamily: 'inherit',
                                     background: 'rgba(255,255,255,0.7)', minWidth: 0 }} />
                              <input value={link.url} onChange={(e) => updateSubLink(i, li, { url: e.target.value })}
                                     placeholder="https://..." style={{ flex: 1, fontSize: 11, padding: '3px 6px',
                                     borderRadius: 4, border: '1px solid rgba(0,0,0,0.2)', fontFamily: 'inherit',
                                     background: 'rgba(255,255,255,0.7)', minWidth: 0 }} />
                              <button onClick={() => removeSubLink(i, li)} style={{ background: 'none', border: 'none',
                                      cursor: 'pointer', color: '#a52828', fontSize: 16, lineHeight: 1,
                                      padding: '0 2px', flexShrink: 0 }}>×</button>
                            </div>
                          ))}
                          <button onClick={() => addSubLink(i)} style={{ fontSize: 11, padding: '3px 8px', borderRadius: 4,
                                  border: '1px solid rgba(0,0,0,0.18)', background: 'rgba(255,255,255,0.55)',
                                  cursor: 'pointer', fontFamily: 'inherit', color: c.text }}>
                            🔗 Adicionar link
                          </button>
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="sf-step-title-view" style={{ fontWeight: 700 }}>{sub.title}</div>
                        {sub.desc && <div className="sf-step-desc-view" dangerouslySetInnerHTML={{ __html: sub.desc }} />}
                        {(sub.owner || sub.duration) && (
                          <div className="sf-step-meta-view">
                            {sub.owner && <span>👤 {sub.owner}</span>}
                            {sub.duration && <span>⏱ {sub.duration}</span>}
                          </div>
                        )}
                        {(sub.images || []).length > 0 && (
                          <div style={{ marginTop: 8, borderTop: '1px solid rgba(0,0,0,0.08)', paddingTop: 6 }}>
                            <ImageGallery images={sub.images} editorMode={false} />
                          </div>
                        )}
                        {(sub.links || []).filter(l => l.url).length > 0 && (
                          <div style={{ marginTop: 8, borderTop: '1px solid rgba(0,0,0,0.08)', paddingTop: 6,
                                        display: 'flex', flexDirection: 'column', gap: 4 }}>
                            {(sub.links).filter(l => l.url).map((link, li) => (
                              <a key={li} href={link.url} target="_blank" rel="noreferrer"
                                 style={{ fontSize: 12, color: c.stroke, textDecoration: 'none',
                                          display: 'flex', alignItems: 'center', gap: 5, fontWeight: 500 }}>
                                🔗 {link.label || link.url}
                              </a>
                            ))}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                  {i < subSteps.length - 1 && arrow}
                </React.Fragment>
              );
            })}
            {editorMode && <button className="sf-add" onClick={addSub}>+ Sub-etapa</button>}
          </div>
        </div>
      </div>
      {showSaveConfirm && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 2000, display: 'flex', alignItems: 'center',
                      justifyContent: 'center', background: 'rgba(0,0,0,0.45)' }}
             onClick={(e) => e.stopPropagation()}>
          <div style={{ background: '#fff', borderRadius: 12, padding: '28px 32px', maxWidth: 360,
                        width: '90%', textAlign: 'center', boxShadow: '0 8px 32px rgba(0,0,0,0.22)' }}>
            <p style={{ margin: '0 0 6px', fontSize: 16, fontWeight: 700, color: '#222' }}>Salvar alterações?</p>
            <p style={{ margin: '0 0 20px', fontSize: 13, color: '#666', lineHeight: 1.5 }}>
              Você fez alterações nas sub-etapas. Deseja salvar antes de fechar?
            </p>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
              <button onClick={handleDiscard}
                      style={{ padding: '8px 18px', borderRadius: 6, border: '1.5px solid #d0d0d0',
                               background: '#f5f5f5', color: '#555', fontSize: 13, cursor: 'pointer', fontWeight: 500 }}>
                Não, descartar
              </button>
              <button onClick={handleSave}
                      style={{ padding: '8px 18px', borderRadius: 6, border: 'none',
                               background: '#1f5dbb', color: '#fff', fontSize: 13, cursor: 'pointer', fontWeight: 600 }}>
                Sim, salvar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Editor do sub-fluxo (2° nível) ──────────────────────────────────────────
function SubflowEditor({ node, subflow, onChange }) {
  const colors = window.NODE_COLORS;
  const [editingSubStepIdx, setEditingSubStepIdx] = React.useState(null);

  const updateStep = (i, patch) => {
    onChange({ ...subflow, steps: subflow.steps.map((s, j) => j === i ? { ...s, ...patch } : s) });
  };

  const addStep = () => {
    const id = 's' + (Date.now() % 100000);
    const last = subflow.steps[subflow.steps.length - 1];
    onChange({
      ...subflow,
      steps: [...subflow.steps, {
        id, title: 'Nova etapa', desc: '', color: last?.color || 'blue',
        owner: '', duration: '', hasSubflow: false, subSteps: [],
      }],
    });
  };

  const removeStep = (i) => {
    if (subflow.steps.length <= 1) return;
    onChange({ ...subflow, steps: subflow.steps.filter((_, j) => j !== i) });
  };

  const toggleHasSubflow = (i, checked) => {
    const step = subflow.steps[i];
    const subSteps = (checked && (!step.subSteps || !step.subSteps.length))
      ? [{ id: 'ss1', title: 'Sub-etapa 1', desc: '', color: step.color || 'blue', owner: '', duration: '' }]
      : (step.subSteps || []);
    updateStep(i, { hasSubflow: checked, subSteps });
  };

  const saveSubSteps = (i, newSubSteps) => {
    updateStep(i, { subSteps: newSubSteps });
  };

  const addImages = (si, imgs) => updateStep(si, { images: [...(subflow.steps[si].images || []), ...imgs] });
  const removeImage = (si, ii) => updateStep(si, { images: (subflow.steps[si].images || []).filter((_, j) => j !== ii) });

  const addLink = (si) => {
    const id = 'lk' + (Date.now() % 1e6);
    const links = [...(subflow.steps[si].links || []), { id, label: '', url: '' }];
    updateStep(si, { links });
  };
  const updateLink = (si, li, patch) => {
    const links = (subflow.steps[si].links || []).map((l, j) => j === li ? { ...l, ...patch } : l);
    updateStep(si, { links });
  };
  const removeLink = (si, li) => {
    const links = (subflow.steps[si].links || []).filter((_, j) => j !== li);
    updateStep(si, { links });
  };

  const arrow = (
    <div className="sf-arrow" aria-hidden="true">
      <svg width="32" height="22" viewBox="0 0 32 22">
        <path d="M 2 11 L 26 11" stroke="#666" strokeWidth="1.6" fill="none" />
        <path d="M 22 5 L 28 11 L 22 17" stroke="#666" strokeWidth="1.6" fill="none" />
      </svg>
    </div>
  );

  return (
    <div className="sf-editor">
      <div className="sf-flow">
        {subflow.steps.map((step, i) => {
          const c = colors[step.color] || colors.blue;
          return (
            <React.Fragment key={step.id}>
              <div className="sf-step" style={{ background: c.fill, borderColor: c.stroke, color: c.text }}>
                <button className="sf-step-x" onClick={() => removeStep(i)}
                        title="Remover etapa" aria-label="Remover etapa">×</button>
                <input className="sf-step-title" value={step.title}
                       onChange={(e) => updateStep(i, { title: e.target.value })}
                       placeholder="Título da etapa" />
                <RichTextEditor value={step.desc || ''}
                                onChange={(html) => updateStep(i, { desc: html })}
                                placeholder="Detalhes, responsáveis, ferramentas..." />
                <div className="sf-step-meta">
                  <input value={step.owner || ''} onChange={(e) => updateStep(i, { owner: e.target.value })} placeholder="Responsável" />
                  <input value={step.duration || ''} onChange={(e) => updateStep(i, { duration: e.target.value })} placeholder="Prazo (ex: 1 dia)" />
                </div>
                <div className="sf-step-colors">
                  {COLOR_OPTIONS.map((col) => (
                    <button key={col}
                            className={'sf-color' + (step.color === col ? ' on' : '')}
                            style={{ background: colors[col].fill, borderColor: colors[col].stroke }}
                            onClick={() => updateStep(i, { color: col })}
                            title={col} />
                  ))}
                </div>
                {/* 3° nível */}
                <div style={{ borderTop: '1px solid rgba(0,0,0,0.10)', marginTop: 8, paddingTop: 8 }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                    <input type="checkbox" checked={!!step.hasSubflow}
                           onChange={(e) => toggleHasSubflow(i, e.target.checked)}
                           style={{ width: 15, height: 15, accentColor: 'var(--primary)', flexShrink: 0 }} />
                    <span style={{ fontSize: 11.5, color: c.text }}>Tem 3° nível (sub-etapas)</span>
                  </label>
                  {step.hasSubflow && (
                    <button onClick={() => setEditingSubStepIdx(i)}
                            style={{ marginTop: 6, width: '100%', height: 28, fontSize: 12,
                                     borderRadius: 6, border: '1px solid rgba(0,0,0,0.15)',
                                     background: 'rgba(255,255,255,0.55)', cursor: 'pointer',
                                     color: c.text, fontFamily: 'inherit' }}>
                      ✎ Editar sub-etapas ({(step.subSteps || []).length})
                    </button>
                  )}
                </div>
                {/* Imagens */}
                <div style={{ borderTop: '1px solid rgba(0,0,0,0.08)', marginTop: 8, paddingTop: 8 }}>
                  <ImageGallery images={step.images || []} editorMode={true}
                                onAddMany={(imgs) => addImages(i, imgs)}
                                onRemove={(ii) => removeImage(i, ii)} />
                </div>
                {/* Links externos */}
                <div style={{ borderTop: '1px solid rgba(0,0,0,0.08)', marginTop: 8, paddingTop: 8 }}>
                  {(step.links || []).map((link, li) => (
                    <div key={link.id || li} style={{ display: 'flex', gap: 4, alignItems: 'center', marginBottom: 4 }}>
                      <input value={link.label} onChange={(e) => updateLink(i, li, { label: e.target.value })}
                             placeholder="Nome" style={{ flex: '0 0 110px', fontSize: 11, padding: '3px 6px',
                             borderRadius: 4, border: '1px solid rgba(0,0,0,0.2)', fontFamily: 'inherit',
                             background: 'rgba(255,255,255,0.7)', minWidth: 0 }} />
                      <input value={link.url} onChange={(e) => updateLink(i, li, { url: e.target.value })}
                             placeholder="https://..." style={{ flex: 1, fontSize: 11, padding: '3px 6px',
                             borderRadius: 4, border: '1px solid rgba(0,0,0,0.2)', fontFamily: 'inherit',
                             background: 'rgba(255,255,255,0.7)', minWidth: 0 }} />
                      <button onClick={() => removeLink(i, li)} style={{ background: 'none', border: 'none',
                              cursor: 'pointer', color: '#a52828', fontSize: 16, lineHeight: 1,
                              padding: '0 2px', flexShrink: 0 }}>×</button>
                    </div>
                  ))}
                  <button onClick={() => addLink(i)} style={{ fontSize: 11, padding: '3px 8px', borderRadius: 4,
                          border: '1px solid rgba(0,0,0,0.18)', background: 'rgba(255,255,255,0.55)',
                          cursor: 'pointer', fontFamily: 'inherit', color: c.text }}>
                    🔗 Adicionar link
                  </button>
                </div>
              </div>
              {i < subflow.steps.length - 1 && arrow}
            </React.Fragment>
          );
        })}
        <button className="sf-add" onClick={addStep}>+ Etapa</button>
      </div>

      {editingSubStepIdx !== null && (
        <ThirdLevelModal
          step={subflow.steps[editingSubStepIdx]}
          editorMode={true}
          onClose={() => setEditingSubStepIdx(null)}
          onSave={(newSubSteps) => saveSubSteps(editingSubStepIdx, newSubSteps)}
        />
      )}
    </div>
  );
}

// ─── Visualização read-only do sub-fluxo (2° nível) ──────────────────────────
function SubflowViewer({ subflow }) {
  const colors = window.NODE_COLORS;
  const [viewingStep, setViewingStep] = React.useState(null);

  const arrow = (
    <div className="sf-arrow" aria-hidden="true">
      <svg width="32" height="22" viewBox="0 0 32 22">
        <path d="M 2 11 L 26 11" stroke="#666" strokeWidth="1.6" fill="none" />
        <path d="M 22 5 L 28 11 L 22 17" stroke="#666" strokeWidth="1.6" fill="none" />
      </svg>
    </div>
  );

  return (
    <div className="sf-editor">
      <div className="sf-flow">
        {subflow.steps.map((step, i) => {
          const c = colors[step.color] || colors.blue;
          const hasSub = step.hasSubflow && step.subSteps && step.subSteps.length > 0;
          return (
            <React.Fragment key={step.id}>
              <div className="sf-step sf-step-view"
                   style={{
                     background: c.fill, borderColor: c.stroke, color: c.text,
                     cursor: hasSub ? 'pointer' : 'default',
                     position: 'relative',
                   }}
                   onClick={() => hasSub && setViewingStep(step)}
                   title={hasSub ? 'Clique para ver as sub-etapas' : undefined}>
                {hasSub && (
                  <div style={{ position: 'absolute', top: 8, right: 8,
                                width: 8, height: 8, borderRadius: '50%',
                                background: c.stroke, border: '1.5px solid #fff' }} />
                )}
                <div className="sf-step-title-view" style={{ fontWeight: 700 }}>{step.title}</div>
                {step.desc && <div className="sf-step-desc-view" dangerouslySetInnerHTML={{ __html: step.desc }} />}
                {(step.owner || step.duration) && (
                  <div className="sf-step-meta-view">
                    {step.owner && <span>👤 {step.owner}</span>}
                    {step.duration && <span>⏱ {step.duration}</span>}
                  </div>
                )}
                {hasSub && (
                  <div style={{ fontSize: 11, opacity: 0.65, marginTop: 6 }}>
                    ↳ {step.subSteps.length} sub-etapa{step.subSteps.length !== 1 ? 's' : ''}
                  </div>
                )}
                {(step.images || []).length > 0 && (
                  <div style={{ marginTop: 8, borderTop: '1px solid rgba(0,0,0,0.08)', paddingTop: 6 }}
                       onClick={(e) => e.stopPropagation()}>
                    <ImageGallery images={step.images} editorMode={false} />
                  </div>
                )}
                {(step.links || []).filter(l => l.url).length > 0 && (
                  <div style={{ marginTop: 8, borderTop: '1px solid rgba(0,0,0,0.08)', paddingTop: 6,
                                display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {(step.links).filter(l => l.url).map((link, li) => (
                      <a key={li} href={link.url} target="_blank" rel="noreferrer"
                         onClick={(e) => e.stopPropagation()}
                         style={{ fontSize: 12, color: c.stroke, textDecoration: 'none', display: 'flex',
                                  alignItems: 'center', gap: 5, fontWeight: 500 }}>
                        🔗 {link.label || link.url}
                      </a>
                    ))}
                  </div>
                )}
              </div>
              {i < subflow.steps.length - 1 && arrow}
            </React.Fragment>
          );
        })}
      </div>

      {viewingStep && (
        <ThirdLevelModal
          step={viewingStep}
          editorMode={false}
          onClose={() => setViewingStep(null)}
          onSave={() => {}}
        />
      )}
    </div>
  );
}

// ─── Wrapper que troca entre modal / drawer / drill ───────────────────────────
function NodeModal({ node, onClose, popupStyle, editorMode = true, onRequestAccess, requestStatus, onSubflowChange }) {
  const [allSubflows, setAllSubflows] = React.useState(loadSubflows);
  const subflow = allSubflows[node?.id] || makeEmptySubflow(node?.color);
  const openedSubflowRef = React.useRef(JSON.parse(JSON.stringify(allSubflows[node?.id] || null)));
  const [showSaveConfirm, setShowSaveConfirm] = React.useState(false);

  const updateSubflow = (next) => {
    const all = { ...allSubflows, [node.id]: next };
    setAllSubflows(all);
    saveSubflows(all);
    onSubflowChange?.();
  };

  const handleCloseRequest = () => {
    if (showSaveConfirm) return;
    if (!editorMode) { onClose(false); return; }
    const current = allSubflows[node?.id] || null;
    const hasChanges = JSON.stringify(current) !== JSON.stringify(openedSubflowRef.current);
    if (hasChanges) { setShowSaveConfirm(true); } else { onClose(false); }
  };

  React.useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') handleCloseRequest(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [allSubflows, showSaveConfirm]);

  // Recarrega subflows do localStorage quando outro usuário salva via SSE
  React.useEffect(() => {
    const handler = () => setAllSubflows(loadSubflows());
    window.addEventListener('subflows-updated', handler);
    return () => window.removeEventListener('subflows-updated', handler);
  }, []);

  if (!node) return null;
  const color = window.NODE_COLORS[node.color] || window.NODE_COLORS.blue;
  const title = node.label.replace(/\n/g, ' ');

  const requestBtn = !editorMode && onRequestAccess && (
    requestStatus === 'pending' ? (
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 12,
                    fontSize: 12, color: '#c97639', fontWeight: 600 }}>
        <span>⏳</span> Solicitação enviada — aguardando aprovação do admin
      </div>
    ) : requestStatus === 'denied' ? (
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 12,
                    fontSize: 12, color: '#a52828', fontWeight: 600 }}>
        <span>✗</span> Solicitação reprovada
        <button onClick={() => onRequestAccess(node.id, title)}
                style={{ marginLeft: 8, fontSize: 11, padding: '2px 8px', cursor: 'pointer',
                         border: '1px solid #a52828', borderRadius: 4, background: 'transparent', color: '#a52828' }}>
          Solicitar novamente
        </button>
      </div>
    ) : (
      <button onClick={() => onRequestAccess(node.id, title)}
              style={{ marginTop: 12, display: 'inline-flex', alignItems: 'center', gap: 6,
                       padding: '6px 14px', fontSize: 12, fontWeight: 600, cursor: 'pointer',
                       border: '1.5px solid #1f5dbb', borderRadius: 6, background: '#f0f5ff', color: '#1f5dbb' }}>
        🔓 Solicitar Liberação para Editar
      </button>
    )
  );

  const header = (
    <div className="sf-header" style={{ borderColor: color.stroke }}>
      <div className="sf-eyebrow" style={{ color: color.stroke }}>
        2° NÍVEL · SUB-FLUXO{editorMode ? ' · MODO EDIÇÃO' : ''}
      </div>
      <h2 className="sf-title">{title}</h2>
      <p className="sf-sub">{editorMode
        ? 'Edite as etapas abaixo. As alterações ficam salvas no seu navegador.'
        : 'Sub-fluxograma desta etapa. Clique nas etapas marcadas para ver o 3° nível.'}</p>
      {requestBtn}
      <button className="sf-close" onClick={handleCloseRequest} aria-label="Fechar">×</button>
    </div>
  );

  const body = editorMode
    ? <SubflowEditor node={node} subflow={subflow} onChange={updateSubflow} />
    : <SubflowViewer subflow={subflow} />;

  const saveConfirmDialog = showSaveConfirm && (
    <div style={{ position: 'fixed', inset: 0, zIndex: 2000, display: 'flex', alignItems: 'center',
                  justifyContent: 'center', background: 'rgba(0,0,0,0.45)' }}
         onClick={(e) => e.stopPropagation()}>
      <div style={{ background: '#fff', borderRadius: 12, padding: '28px 32px', maxWidth: 360,
                    width: '90%', textAlign: 'center', boxShadow: '0 8px 32px rgba(0,0,0,0.22)' }}>
        <p style={{ margin: '0 0 6px', fontSize: 16, fontWeight: 700, color: '#222' }}>Salvar alterações?</p>
        <p style={{ margin: '0 0 20px', fontSize: 13, color: '#666', lineHeight: 1.5 }}>
          Você fez alterações neste subfluxo. Deseja salvar antes de fechar?
        </p>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
          <button onClick={() => { setShowSaveConfirm(false); onClose(false); }}
                  style={{ padding: '8px 18px', borderRadius: 6, border: '1.5px solid #d0d0d0',
                           background: '#f5f5f5', color: '#555', fontSize: 13, cursor: 'pointer', fontWeight: 500 }}>
            Não, descartar
          </button>
          <button onClick={() => { setShowSaveConfirm(false); onClose(true); }}
                  style={{ padding: '8px 18px', borderRadius: 6, border: 'none',
                           background: '#1f5dbb', color: '#fff', fontSize: 13, cursor: 'pointer', fontWeight: 600 }}>
            Sim, salvar
          </button>
        </div>
      </div>
    </div>
  );

  if (popupStyle === 'drawer') {
    return (
      <div className="sf-drawer-overlay" onClick={handleCloseRequest}>
        <div className="sf-drawer" onClick={(e) => e.stopPropagation()}
             style={{ borderLeft: `4px solid ${color.stroke}` }}>
          {header}
          {body}
          {saveConfirmDialog}
        </div>
      </div>
    );
  }
  if (popupStyle === 'drill') {
    return (
      <div className="sf-drill">
        <div className="sf-drill-bar">
          <button className="sf-back" onClick={handleCloseRequest}>← Voltar ao fluxograma</button>
          <div className="sf-drill-crumb">{title}</div>
        </div>
        <div className="sf-drill-body">
          {header}
          {body}
          {saveConfirmDialog}
        </div>
      </div>
    );
  }
  // default: modal
  return (
    <div className="sf-modal-overlay" onClick={handleCloseRequest}>
      <div className="sf-modal" onClick={(e) => e.stopPropagation()}
           style={{ borderTop: `5px solid ${color.stroke}` }}>
        {header}
        {body}
        {saveConfirmDialog}
      </div>
    </div>
  );
}

window.NodeModal = NodeModal;
