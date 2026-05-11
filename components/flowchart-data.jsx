// flowchart-data.jsx
// Nó = caixa do fluxograma. Edge = seta entre nós.
// Coordenadas no canvas virtual (2000x1500).
// shape: 'rect' (retangular arredondado) | 'pill' | 'diamond'
// color: 'blue' | 'green' | 'orange' | 'yellow' | 'legend-blue' | 'legend-green' | 'legend-orange'
// fromSide/toSide: 'l' | 'r' | 't' | 'b' — define onde a seta sai/entra
// mid: posição do "cotovelo" para roteamento Z (opcional)
// label: texto sobre a seta

const NODES = [
  // ─── Fontes (pílulas azuis claras à esquerda)
  { id: 'src_indicacao',     label: 'Indicação',         x: 40,  y: 60,  w: 160, h: 44, shape: 'pill', color: 'blue' },
  { id: 'src_cross',         label: 'Cross Sell',         x: 40,  y: 120, w: 160, h: 44, shape: 'pill', color: 'blue' },
  { id: 'src_mkt',           label: 'Marketing\nDigital', x: 40,  y: 220, w: 160, h: 56, shape: 'pill', color: 'blue' },
  { id: 'src_publicas',      label: 'Lista Públicas',     x: 40,  y: 320, w: 160, h: 44, shape: 'pill', color: 'blue' },
  { id: 'src_setoriais',     label: 'Listas Setoriais',   x: 40,  y: 380, w: 160, h: 44, shape: 'pill', color: 'blue' },

  // ─── Captação (azul)
  { id: 'alimentacao',  label: 'ALIMENTAÇÃO\nLEADS NO PIPEDRIVE',                          x: 280, y: 80,  w: 200, h: 80,  shape: 'rect', color: 'blue' },
  { id: 'robo',         label: 'ROBO DE\nHIGIENIZAÇÃO\nPH3A / LEMIT /\nRECEITAWS',         x: 280, y: 290, w: 200, h: 110, shape: 'rect', color: 'blue' },
  { id: 'd_qualifica',  label: 'Pré\nqualificação\npela IA?',                              x: 580, y: 100, w: 160, h: 110, shape: 'diamond', color: 'yellow' },
  { id: 'growth',       label: 'GROWTH MACHINE\nTI INSERE NA\nFERRAMENTA\n3 HORAS',        x: 580, y: 290, w: 200, h: 110, shape: 'rect', color: 'blue' },
  { id: 'sdr_pipe',     label: 'SDR\nRecebe no\nPIPEDRIVE\nTRABALHO\nCONSTANTE',           x: 850, y: 100, w: 200, h: 130, shape: 'rect', color: 'blue' },
  { id: 'd_reuniao',    label: 'Reunião\nagendada?',                                       x: 1110, y: 110, w: 160, h: 110, shape: 'diamond', color: 'yellow' },
  { id: 'sdr_reagend',  label: 'SDR /\nREAGENDAMENTO\nACOMPANHAMENTO',                    x: 1330, y: 60,  w: 220, h: 80,  shape: 'rect', color: 'blue' },

  // ─── Pós-reunião (verde) — fluxo descendente à direita
  { id: 'bgc',          label: 'COMERCIAL\nSOLICITA BGC\nIDONEUM\n1 DIA',                  x: 1330, y: 270, w: 200, h: 110, shape: 'rect', color: 'green' },
  { id: 'orcamento',    label: 'ORÇAMENTO /\nPROPOSTA TÉCNICA\nPRECIFICADA\nHEAD BU - 1 DIA', x: 1580, y: 270, w: 220, h: 110, shape: 'rect', color: 'green' },
  { id: 'reuniao_apre', label: 'REUNIÃO CLIENTE\nAPRESENTAÇÃO\nINICIAL\nORÇAMENTO',        x: 1450, y: 430, w: 220, h: 110, shape: 'rect', color: 'green' },
  { id: 'ata',          label: 'ATA GERADA\nCOMERCIAL\nDIA 2 - 3 HORAS',                   x: 1450, y: 580, w: 220, h: 100, shape: 'rect', color: 'green' },
  { id: 'controladoria', label: 'CONTROLADORIA\nPRAZOS ATRIBUÍDOS\nPIPEDRIVE / LEGAL ONE', x: 1750, y: 580, w: 220, h: 100, shape: 'rect', color: 'green' },
  { id: 'proposta_tec', label: 'PROPOSTA TÉCNICA\nHEAD BU - 1 DIA\n\nPROPOSTA COMERCIAL\nCOMERCIAL - 1 DIA', x: 1750, y: 740, w: 220, h: 150, shape: 'rect', color: 'green' },
  { id: 'reuniao_final', label: 'REUNIÃO FINAL\nDE ACEITE',                                x: 1450, y: 770, w: 200, h: 90,  shape: 'rect', color: 'green' },
  { id: 'd_aceitou',    label: 'Cliente aceitou\na proposta?',                             x: 1480, y: 920, w: 160, h: 110, shape: 'diamond', color: 'yellow' },
  { id: 'envio_final',  label: 'ENVIO PROPOSTA\nFINAL / CONTRATO\nASSISTENTE\nCOMERCIAL\nSOBE CLICK SIGN\n1 DIA', x: 1180, y: 770, w: 220, h: 160, shape: 'rect', color: 'green' },
  { id: 'assinatura',   label: 'ASSINATURA\nINTERNA\nCLICK SIGN\n1 DIA',                   x: 920,  y: 790, w: 200, h: 120, shape: 'rect', color: 'green' },
  { id: 'd_assinado',   label: 'Contrato\nassinado?',                                      x: 700,  y: 950, w: 160, h: 110, shape: 'diamond', color: 'orange' },
  { id: 'follow_up',    label: 'COMERCIAL\nFAZ FOLLOW UP\nNO CLIENTE\n2 DIAS',             x: 920,  y: 620, w: 200, h: 110, shape: 'rect', color: 'green' },

  // ─── Pós-contrato (laranja) — bloco inferior esquerdo
  { id: 'ctrl_email',   label: 'CONTROLADOR IA\nRECEBE EMAIL\nAUTOMÁTICO\nCLICK SIGN',     x: 470,  y: 800, w: 200, h: 130, shape: 'rect', color: 'orange' },
  { id: 'ctrl_cadastro', label: 'CONTROLADOR IA\nCADASTRO\nCONTRATO /\nCONTATO /\nREGRA DE COBRANÇA\nLEGAL ONE', x: 230,  y: 800, w: 200, h: 160, shape: 'rect', color: 'orange' },
  { id: 'financeiro',   label: 'FINANCEIRO\nRECEBE REGRAS\nDE COBRANÇA\nVIA LEGAL ONE\n1 DIA', x: 40,   y: 600, w: 180, h: 140, shape: 'rect', color: 'orange' },
  { id: 'nf',           label: 'EMITIR NOTA\nFISCAL\nPAGAMENTO\nEMITIR BOLETO\n1 DIA',     x: 230,  y: 600, w: 200, h: 140, shape: 'rect', color: 'orange' },
  { id: 'ctrl_mkt',     label: 'CONTROLADORIA\nENCAMINHA PARA\nMARKETING\nINFORMAÇÃO DE\nCONTRATO ASSINADO', x: 230, y: 1000, w: 200, h: 150, shape: 'rect', color: 'orange' },
  { id: 'email_comm',   label: 'EMAIL INTERNO\n(TIME) /\nEXTERNO (CLIENTE)\nCOMUNICANDO\nNOVO CONTRATO',     x: 40,  y: 1000, w: 180, h: 150, shape: 'rect', color: 'orange' },

  // ─── Legendas das fases (não clicáveis no fluxo)
  { id: 'leg_cap',  label: 'CAPTAÇÃO DO LEAD E ABORDAGEM\nLEAD QUENTE - 1 DIA\nLEAD FRIO - CONSTANTE', x: 470,  y: 470, w: 280, h: 90, shape: 'rect', color: 'legend-blue', isLegend: true },
  { id: 'leg_pos',  label: 'JORNADA PÓS REUNIÃO\n4 DIAS',                                              x: 800,  y: 480, w: 200, h: 70, shape: 'rect', color: 'legend-green', isLegend: true },
  { id: 'leg_ctr',  label: 'PÓS CONTRATO\n3 DIAS DE CADASTRO',                                         x: 1050, y: 480, w: 200, h: 70, shape: 'rect', color: 'legend-orange', isLegend: true },
];

// ─── Conexões (setas)
const EDGES = [
  // Fontes → Alimentação / Robô
  { from: 'src_indicacao', to: 'alimentacao', fromSide: 'r', toSide: 'l', label: 'COMERCIAL\nSLA - 3 HORAS' },
  { from: 'src_cross',     to: 'alimentacao', fromSide: 'r', toSide: 'l' },
  { from: 'src_mkt',       to: 'alimentacao', fromSide: 'r', toSide: 'l', label: 'TECNOLOGIA\n3 HORAS' },
  { from: 'src_publicas',  to: 'robo',        fromSide: 'r', toSide: 'l', label: 'COMERCIAL\n2 DIAS' },
  { from: 'src_setoriais', to: 'robo',        fromSide: 'r', toSide: 'l' },

  // Captação principal
  { from: 'alimentacao', to: 'd_qualifica', fromSide: 'r', toSide: 'l', label: 'TECNOLOGIA\nDIA 1 - 3 HORAS' },
  { from: 'robo',        to: 'd_qualifica', fromSide: 'r', toSide: 'l' },
  { from: 'd_qualifica', to: 'sdr_pipe',    fromSide: 'r', toSide: 'l', label: 'NÃO' },
  { from: 'd_qualifica', to: 'growth',      fromSide: 'b', toSide: 't', label: 'SIM' },
  { from: 'growth',      to: 'sdr_pipe',    fromSide: 'r', toSide: 'b', label: 'TECNOLOGIA\nAUTOMATIZADO\nLEAD QUENTE\nFECHANDO NA\nFERRAMENTA\nEM TEMPO REAL' },
  { from: 'sdr_pipe',    to: 'd_reuniao',   fromSide: 'r', toSide: 'l' },
  { from: 'd_reuniao',   to: 'sdr_reagend', fromSide: 't', toSide: 'l', label: 'NÃO' },
  { from: 'd_reuniao',   to: 'bgc',         fromSide: 'b', toSide: 't', label: 'SIM' },

  // Pós-reunião
  { from: 'bgc',           to: 'orcamento',     fromSide: 'r', toSide: 'l' },
  { from: 'orcamento',     to: 'reuniao_apre',  fromSide: 'b', toSide: 't' },
  { from: 'reuniao_apre',  to: 'ata',           fromSide: 'b', toSide: 't' },
  { from: 'ata',           to: 'controladoria', fromSide: 'r', toSide: 'l', label: 'COMERCIAL ENVIA\nPARA CONTROLADORIA' },
  { from: 'controladoria', to: 'proposta_tec',  fromSide: 'b', toSide: 't' },
  { from: 'proposta_tec',  to: 'reuniao_final', fromSide: 'l', toSide: 'r' },
  { from: 'reuniao_final', to: 'd_aceitou',     fromSide: 'b', toSide: 't' },
  { from: 'd_aceitou',     to: 'proposta_tec',  fromSide: 'r', toSide: 'b', label: 'NÃO' },
  { from: 'd_aceitou',     to: 'envio_final',   fromSide: 'l', toSide: 'r', label: 'SIM' },
  { from: 'envio_final',   to: 'assinatura',    fromSide: 'l', toSide: 'r' },
  { from: 'assinatura',    to: 'd_assinado',    fromSide: 'b', toSide: 't' },
  { from: 'd_assinado',    to: 'follow_up',     fromSide: 't', toSide: 'b', label: 'NÃO' },
  { from: 'follow_up',     to: 'envio_final',   fromSide: 'r', toSide: 't' },
  { from: 'd_assinado',    to: 'ctrl_email',    fromSide: 'l', toSide: 'r', label: 'SIM' },

  // Pós-contrato
  { from: 'ctrl_email',    to: 'ctrl_cadastro', fromSide: 'l', toSide: 'r' },
  { from: 'ctrl_cadastro', to: 'financeiro',    fromSide: 't', toSide: 'b' },
  { from: 'financeiro',    to: 'nf',            fromSide: 'r', toSide: 'l' },
  { from: 'ctrl_cadastro', to: 'ctrl_mkt',      fromSide: 'b', toSide: 't' },
  { from: 'ctrl_mkt',      to: 'email_comm',    fromSide: 'l', toSide: 'r' },
];

window.FLOWCHART = { NODES, EDGES };
