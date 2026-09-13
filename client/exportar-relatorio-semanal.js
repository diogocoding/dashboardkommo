// exportar-relatorio-semanal.js
// Fase 7 do sistema de acompanhamento de tráfego e leads.
//
// Gera um relatório HTML autocontido (sem depender de nenhum arquivo
// externo) a partir dos dados já calculados pelo painel — reaproveita
// /api/metrics, /api/analise-trafego e /api/trafego/semana (se a semana
// já tiver sido salva, incluindo decisões/observações/dados manuais).
//
// Segue o mesmo estilo visual (claro, formal) já usado em
// baixarHistoricoComoHTML() no app.js, em vez do tema escuro do painel —
// é o formato certo para um documento pensado pra ser lido/impresso fora
// da tela do dashboard.

function escaparHTML(v) {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function tabelaGrupoParaHTML(titulo, lista, subtitulo = '') {
  if (!lista || !lista.length) {
    return `<h3>${escaparHTML(titulo)}</h3><p class="vazio">Sem dados neste período.</p>`;
  }
  const linhas = lista.map((g) => `
    <tr>
      <td>${escaparHTML(g.grupo)}</td>
      <td class="num">${g.totalLeads}</td>
      <td class="num">${g.qualificados}</td>
      <td class="num destaque">${g.percentualQualificados}%</td>
      <td class="num">${g.reuniao}</td>
      <td class="num">${g.noShow}</td>
      <td class="num">${g.farmer}</td>
      <td class="num">${g.clienteQuente}</td>
      <td class="num">${g.contratoFechado}</td>
    </tr>`).join('');

  return `
    <h3>${escaparHTML(titulo)}</h3>
    ${subtitulo ? `<p class="subtitulo-tabela">${escaparHTML(subtitulo)}</p>` : ''}
    <table>
      <thead>
        <tr>
          <th>Grupo</th><th>Leads</th><th>Qualif.</th><th>% Qualif.</th>
          <th>Reunião</th><th>No Show</th><th>Farmer</th><th>Cl. Quente</th><th>Contrato</th>
        </tr>
      </thead>
      <tbody>${linhas}</tbody>
    </table>`;
}



function decisoesEObservacoesParaHTML(decisoes, observacoes) {
  let html = '';
  if (decisoes && decisoes.length) {
    html += `<h3>Decisões Registradas</h3><ul class="lista-registro">` +
      decisoes.map((d) => `<li><span class="data-registro">${new Date(d.criadoEm).toLocaleDateString('pt-BR')}</span> — ${escaparHTML(d.assunto || '')}: ${escaparHTML(d.decisao || '')}</li>`).join('') +
      `</ul>`;
  }
  if (observacoes && observacoes.length) {
    html += `<h3>Observações</h3><ul class="lista-registro">` +
      observacoes.map((o) => `<li><span class="data-registro">${new Date(o.criadoEm).toLocaleDateString('pt-BR')}</span> — ${escaparHTML(o.texto)}</li>`).join('') +
      `</ul>`;
  }
  return html;
}

/**
 * Monta e baixa o relatório HTML completo de um período.
 * `contexto` = { inicio, fim, metrics, analiseTrafego, registroSemana }
 * — `registroSemana` pode ser null se essa semana ainda não tiver sido salva.
 */
// Mesmo gerador de SVG usado no painel ao vivo (gerenciamento-semana.js) —
// duplicado aqui porque os dois arquivos são scripts soltos, sem sistema
// de módulos, então não dá pra importar de um pro outro.
function gerarSvgGraficoCustoEstatico(grupos) {
  const maximo = Math.max(...grupos.flatMap((g) => [g.custoPorLead || 0, g.custoPorQualificado || 0, g.custoTotal || 0]), 1);
  const W = 680, H = 300, ML = 46, MR = 16, MT = 20, MB = 60;
  const areaW = W - ML - MR, areaH = H - MT - MB;
  const base = MT + areaH;
  const larguraGrupo = areaW / grupos.length;
  const larguraBarra = Math.min(larguraGrupo * 0.24, 26);

  const marcasY = [0, 0.25, 0.5, 0.75, 1].map((f) => {
    const valor = Math.round(maximo * f);
    const y = MT + areaH - f * areaH;
    return `
      <line x1="${ML}" y1="${y.toFixed(1)}" x2="${W - MR}" y2="${y.toFixed(1)}" stroke="#ccc" stroke-width="1"/>
      <text x="${(ML - 6).toFixed(1)}" y="${(y + 3).toFixed(1)}" text-anchor="end" font-family="monospace" font-size="9" fill="#777">R$${valor}</text>`;
  }).join("");

  const barras = grupos.map((g, i) => {
    const cx = ML + larguraGrupo * i + larguraGrupo / 2;
    const hLead = ((g.custoPorLead || 0) / maximo) * areaH;
    const hQualif = ((g.custoPorQualificado || 0) / maximo) * areaH;
    const hTotal = ((g.custoTotal || 0) / maximo) * areaH;
    const espaco = larguraBarra + 3;
    return `
      <g>
        <rect x="${(cx - espaco * 1.5).toFixed(1)}" y="${(base - hTotal).toFixed(1)}" width="${larguraBarra.toFixed(1)}" height="${Math.max(hTotal, 1).toFixed(1)}" fill="#5B8AA6"/>
        <text x="${(cx - espaco).toFixed(1)}" y="${(base - hTotal - 5).toFixed(1)}" text-anchor="middle" font-family="monospace" font-size="8" fill="#3a6a85">${(g.custoTotal || 0).toFixed(0)}</text>
        <rect x="${(cx - espaco * 0.5).toFixed(1)}" y="${(base - hLead).toFixed(1)}" width="${larguraBarra.toFixed(1)}" height="${Math.max(hLead, 1).toFixed(1)}" fill="#9C6A1F"/>
        <text x="${cx.toFixed(1)}" y="${(base - hLead - 5).toFixed(1)}" text-anchor="middle" font-family="monospace" font-size="8" fill="#7a5218">${(g.custoPorLead || 0).toFixed(0)}</text>
        <rect x="${(cx + espaco * 0.5).toFixed(1)}" y="${(base - hQualif).toFixed(1)}" width="${larguraBarra.toFixed(1)}" height="${Math.max(hQualif, 1).toFixed(1)}" fill="#2E6B44"/>
        <text x="${(cx + espaco).toFixed(1)}" y="${(base - hQualif - 5).toFixed(1)}" text-anchor="middle" font-family="monospace" font-size="8" fill="#1e4a2e">${g.custoPorQualificado != null ? g.custoPorQualificado.toFixed(0) : "—"}</text>
        <text x="${cx.toFixed(1)}" y="${(base + 16).toFixed(1)}" text-anchor="middle" font-family="monospace" font-size="10" font-weight="700" fill="#555">${i + 1}</text>
      </g>`;
  }).join("");

  return `
    <svg viewBox="0 0 ${W} ${H}" style="display:block;width:100%;max-width:600px;height:auto;margin:12px 0">
      ${marcasY}
      <line x1="${ML}" y1="${base}" x2="${W - MR}" y2="${base}" stroke="#999" stroke-width="1.5"/>
      ${barras}
    </svg>
    <div style="display:flex;gap:16px;font-size:11px;font-family:monospace;margin-bottom:12px">
      <span><span style="display:inline-block;width:9px;height:9px;background:#5B8AA6;margin-right:4px"></span>Custo Total</span>
      <span><span style="display:inline-block;width:9px;height:9px;background:#9C6A1F;margin-right:4px"></span>Custo por Lead</span>
      <span><span style="display:inline-block;width:9px;height:9px;background:#2E6B44;margin-right:4px"></span>Custo por Qualificado</span>
    </div>`;
}

// Gráfico de barra estático (SVG), pro relatório exportado — mesmo espírito
// visual do gráfico ao vivo, mas sem interatividade (não precisa de clique
// num arquivo estático).
function gerarSvgBarraEstatico(lista, opcoes = {}) {
  if (!lista?.length) return '<p class="vazio">Sem dados neste período.</p>';
  const campo = opcoes.campo || 'totalLeads';
  const cores = ['#9C6A1F', '#3b6ea5', '#2E6B44', '#8a3324', '#5B8AA6', '#7a5aa0'];
  const maximo = Math.max(...lista.map((g) => g[campo]), 1);
  const alturaLinha = 22, W = 600;
  const H = lista.length * alturaLinha + 20;
  const ML = 40;

  const barras = lista.map((g, i) => {
    const y = 10 + i * alturaLinha;
    const largura = ((g[campo] / maximo) * (W - ML - 50));
    const cor = cores[i % cores.length];
    return `
      <text x="${ML - 6}" y="${y + 13}" text-anchor="end" font-family="monospace" font-size="10" font-weight="700" fill="#555">${i + 1}</text>
      <rect x="${ML}" y="${y}" width="${largura.toFixed(1)}" height="16" fill="${cor}"/>
      <text x="${(ML + largura + 6).toFixed(1)}" y="${y + 13}" font-family="monospace" font-size="10" fill="#333">${g[campo]}</text>`;
  }).join('');

  const legenda = lista.map((g, i) => `<span style="display:inline-block;margin-right:14px;font-size:11px;font-family:monospace"><strong style="color:${cores[i % cores.length]}">${i + 1}</strong> ${escaparHTML(g.grupo)}</span>`).join('');

  return `
    <svg viewBox="0 0 ${W} ${H}" style="display:block;width:100%;max-width:600px;height:auto;margin:10px 0">
      ${barras}
    </svg>
    <div style="margin-bottom:14px">${legenda}</div>`;
}

// Gráfico de linha estático (SVG) de engajamento por etapa, sempre em
// QUANTIDADE (não percentual) — conforme pedido específico do relatório.
function gerarSvgEngajamentoEstatico(listaEngajamento, limiteGrupos = 6) {
  if (!listaEngajamento?.length) return '<p class="vazio">Sem dados suficientes neste período.</p>';

  const listaOrdenada = [...listaEngajamento].sort((a, b) => {
    const ultimoA = a.pontos[a.pontos.length - 1]?.percentual || 0;
    const ultimoB = b.pontos[b.pontos.length - 1]?.percentual || 0;
    return ultimoB - ultimoA;
  });
  const grupos = listaOrdenada.slice(0, limiteGrupos);
  const cores = ['#0f1b2d', '#9C6A1F', '#2E6B44', '#8a3324', '#5B8AA6', '#7a5aa0'];
  const etapas = grupos[0].pontos.map((p) => p.etapa);
  const tracos = [null, '7,3', '2,3', '10,3,2,3', '1,4', '4,2'];

  const W = 640, H = 280, ML = 34, MR = 16, MT = 20, MB = 70;
  const areaW = W - ML - MR, areaH = H - MT - MB;
  const passoX = etapas.length > 1 ? areaW / (etapas.length - 1) : 0;
  const base = MT + areaH;
  const maximo = Math.max(...grupos.flatMap((g) => g.pontos.map((p) => p.quantidade)), 1);

  const marcasY = [0, 0.25, 0.5, 0.75, 1].map((f) => {
    const valor = Math.round(maximo * f);
    const y = MT + areaH - f * areaH;
    return `
      <line x1="${ML}" y1="${y.toFixed(1)}" x2="${W - MR}" y2="${y.toFixed(1)}" stroke="#ddd" stroke-width="1"/>
      <text x="${(ML - 6).toFixed(1)}" y="${(y + 3).toFixed(1)}" text-anchor="end" font-family="monospace" font-size="9" fill="#888">${valor}</text>`;
  }).join('');

  const linhas = grupos.map((g, gi) => {
    const cor = cores[gi % cores.length];
    const jitter = (gi - (grupos.length - 1) / 2) * 2;
    const coords = g.pontos.map((p, i) => ({
      x: ML + i * passoX,
      y: MT + areaH - (p.quantidade / maximo) * areaH + jitter,
      valor: p.quantidade,
    }));
    const path = coords.map((c, i) => `${i === 0 ? 'M' : 'L'}${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(' ');
    const tracoAttr = tracos[gi % tracos.length] ? ` stroke-dasharray="${tracos[gi % tracos.length]}"` : '';
    const pontos = coords.map((c) => `
      <circle cx="${c.x.toFixed(1)}" cy="${c.y.toFixed(1)}" r="3.5" fill="${cor}"/>
      <text x="${c.x.toFixed(1)}" y="${(c.y - 8).toFixed(1)}" text-anchor="middle" font-family="monospace" font-size="9" font-weight="700" fill="${cor}">${c.valor}</text>`).join('');
    return { path, pontos, cor, tracoAttr, nome: `${escaparHTML(g.grupo)} (n=${g.totalLeads})` };
  });

  const rotulosX = etapas.map((nome, i) => {
    const x = ML + i * passoX;
    return `<text x="${x.toFixed(1)}" y="${(base + 16).toFixed(1)}" text-anchor="middle" font-family="monospace" font-size="9" fill="#666">${nome}</text>`;
  }).join('');

  const legenda = linhas.map((l) => `<span style="display:inline-flex;align-items:center;gap:4px;margin-right:14px;font-size:10px;font-family:monospace"><svg width="16" height="8"><line x1="0" y1="4" x2="16" y2="4" stroke="${l.cor}" stroke-width="2"${l.tracoAttr}/></svg>${l.nome}</span>`).join('');

  return `
    <svg viewBox="0 0 ${W} ${H}" style="display:block;width:100%;max-width:620px;height:auto;margin:10px 0">
      ${marcasY}
      ${linhas.map((l) => `<path d="${l.path}" fill="none" stroke="${l.cor}" stroke-width="2"${l.tracoAttr}/>${l.pontos}`).join('')}
      ${rotulosX}
    </svg>
    <div style="margin-bottom:14px">${legenda}</div>`;
}

function custoParaHTML(analiseComCusto) {
  const grupos = (analiseComCusto?.porAnuncio || []).filter((g) => g.custoPorLead !== null && g.custoPorLead !== undefined);
  if (!grupos.length) {
    return '<p class="vazio">Nenhum custo salvo para este período — abra "Gerenciar" na semana e preencha o orçamento por conjunto de anúncio.</p>';
  }
  const linhas = grupos.map((g) => `
    <tr>
      <td>${escaparHTML(g.grupo)}</td>
      <td class="num">${g.totalLeads}</td>
      <td class="num">${g.qualificados}</td>
      <td class="num">R$ ${(g.orcamentoDiario ?? 0).toFixed(2)}</td>
      <td class="num">R$ ${(g.custoTotal ?? 0).toFixed(2)}</td>
      <td class="num destaque">R$ ${(g.custoPorLead ?? 0).toFixed(2)}</td>
      <td class="num destaque">R$ ${g.custoPorQualificado != null ? g.custoPorQualificado.toFixed(2) : '—'}</td>
    </tr>`).join('');

  return `
    ${gerarSvgGraficoCustoEstatico(grupos)}
    <table>
      <thead><tr><th>Conjunto (Anúncio + Público)</th><th>Leads</th><th>Qualif.</th><th>Orçamento/dia</th><th>Custo total</th><th>Custo/Lead</th><th>Custo/Qualif.</th></tr></thead>
      <tbody>${linhas}</tbody>
    </table>`;
}

function comparacaoSemanalParaHTML(comparacaoSemanal) {
  if (!comparacaoSemanal || comparacaoSemanal.semAnterior) {
    return `<p class="vazio">${comparacaoSemanal?.mensagem || 'Sem semana anterior salva para comparar.'}</p>`;
  }
  const linha = (rotulo, chave, custoMaiorEhRuim = false) => {
    const m = comparacaoSemanal[chave];
    if (!m || m.variacaoPct === null || m.variacaoPct === undefined) {
      return `<tr><td>${rotulo}</td><td class="num">${m ? m.atual : '—'}</td><td class="num">—</td><td class="num">sem comparação</td></tr>`;
    }
    const subiu = m.variacaoPct > 0;
    const bom = custoMaiorEhRuim ? !subiu : subiu;
    const cor = m.variacaoPct === 0 ? '#666' : bom ? '#1e7a4a' : '#a33';
    const seta = m.variacaoPct === 0 ? '' : subiu ? '▲ ' : '▼ ';
    const fmt = (v) => (chave.startsWith('custo') ? `R$ ${v?.toFixed(2)}` : v);
    return `<tr><td>${rotulo}</td><td class="num">${fmt(m.anterior)}</td><td class="num">${fmt(m.atual)}</td><td class="num" style="color:${cor};font-weight:700">${seta}${Math.abs(m.variacaoPct)}%</td></tr>`;
  };
  return `
    <p style="font-size:12px;color:#666;margin-bottom:8px">Comparado com a semana de ${comparacaoSemanal.semanaAnterior.inicio} a ${comparacaoSemanal.semanaAnterior.fim}</p>
    <table>
      <thead><tr><th>Métrica</th><th>Semana Anterior</th><th>Esta Semana</th><th>Variação</th></tr></thead>
      <tbody>
        ${linha('Leads', 'leads')}
        ${linha('Qualificados', 'qualificados')}
        ${linha('Reuniões', 'reuniao')}
        ${linha('Contratos Fechados', 'contratoFechado')}
        ${linha('Custo por Lead', 'custoPorLead', true)}
        ${linha('Custo por Qualificado', 'custoPorQualificado', true)}
      </tbody>
    </table>`;
}

function baixarRelatorioSemanalHTML(contexto) {
  const { inicio, fim, metrics, analiseTrafego, analiseComCusto, registroSemana, comparacaoSemanal } = contexto;
  const s = metrics?.summary || {};

  const corpoDecisoes = registroSemana
    ? decisoesEObservacoesParaHTML(registroSemana.decisoes, registroSemana.observacoes)
    : '<p class="vazio">Esta semana ainda não foi salva no histórico — nenhuma decisão ou observação registrada.</p>';

  const corpoComparacao = comparacaoSemanalParaHTML(comparacaoSemanal);
  const corpoDadosManuais = custoParaHTML(analiseComCusto);

  const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<title>Relatório Semanal — ${inicio} a ${fim}</title>
<style>
  :root { --navy:#0f1b2d; --gold:#c9a24b; --border:#e2e2e2; --green:#2e6b44; --red:#8a3324; }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, Segoe UI, Roboto, Arial, sans-serif; max-width: 960px; margin: 0 auto; padding: 32px 24px 80px; color: #1a1a1a; line-height: 1.55; background:#fff; }
  h1 { font-size: 23px; color: var(--navy); border-bottom: 3px solid var(--gold); padding-bottom: 10px; margin-bottom: 4px; }
  p.subtitulo { font-size: 12.5px; color: #666; margin: 0 0 24px; }
  h2 { font-size: 17px; color: var(--navy); margin-top: 34px; border-bottom: 1px solid var(--border); padding-bottom: 6px; }
  h3 { font-size: 14px; color: var(--navy); margin-top: 22px; margin-bottom: 6px; }
  p.subtitulo-tabela { font-size: 11.5px; color: #777; margin: 0 0 8px; }
  p.vazio { font-size: 12.5px; color: #999; font-style: italic; }
  table { border-collapse: collapse; width: 100%; margin: 8px 0 18px; font-size: 12.5px; }
  th, td { border: 1px solid var(--border); padding: 6px 9px; text-align: left; }
  th { background: var(--navy); color: #fff; font-weight: 600; }
  tr:nth-child(even) { background: #fafafa; }
  td.num { text-align: right; font-variant-numeric: tabular-nums; }
  td.destaque { font-weight: 700; color: var(--navy); }
  .kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 1px; background: var(--border); border: 1px solid var(--border); margin: 12px 0 8px; }
  .kpi { background: #fff; padding: 14px 12px; }
  .kpi .valor { font-size: 24px; font-weight: 700; color: var(--navy); }
  .kpi .rotulo { font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.06em; color: #777; margin-top: 3px; }
  .lista-registro { font-size: 12.5px; padding-left: 18px; }
  .lista-registro li { margin-bottom: 6px; }
  .data-registro { font-family: monospace; color: var(--gold); font-weight: 700; margin-right: 6px; }
</style>
</head>
<body>
  <h1>Relatório Semanal — Tráfego e Funil</h1>
  <p class="subtitulo">Período: ${inicio} a ${fim} · Gerado em ${new Date().toLocaleString('pt-BR')} · Robson Menezes Advogados</p>

  <h2>Resumo do Período</h2>
  <div class="kpis">
    <div class="kpi"><div class="valor">${s.agendadasTotal ?? 0}</div><div class="rotulo">Agendadas</div></div>
    <div class="kpi"><div class="valor">${s.realizadas ?? 0}</div><div class="rotulo">Realizadas</div></div>
    <div class="kpi"><div class="valor">${s.porcentagemAproveitamento ?? 0}%</div><div class="rotulo">Taxa de Aproveitamento</div></div>
    <div class="kpi"><div class="valor">${s.porcentagemNoShow ?? 0}%</div><div class="rotulo">No-Show</div></div>
    <div class="kpi"><div class="valor">${s.contratosFechadosNoPeriodo ?? 0}</div><div class="rotulo">Contratos Fechados</div></div>
    <div class="kpi"><div class="valor">${s.totalReengajamentos ?? 0}</div><div class="rotulo">Reengajamentos</div></div>
    <div class="kpi"><div class="valor">${s.totalReunioesEmAberto ?? 0}</div><div class="rotulo">Reuniões em Aberto</div></div>
    <div class="kpi"><div class="valor">${analiseTrafego?.totalLeads ?? 0}</div><div class="rotulo">Total de Leads</div></div>
  </div>

  <h2>Comparação com a Semana Anterior</h2>
  ${corpoComparacao}

  <h2>Cruzamentos de Tráfego</h2>
  ${tabelaGrupoParaHTML('Por Público de Anúncio', analiseTrafego?.porPublico)}
  ${tabelaGrupoParaHTML('Por Anúncio', analiseTrafego?.porAnuncio)}
  ${tabelaGrupoParaHTML('Por Região (DDD real do telefone)', analiseTrafego?.porRegiao)}
  ${tabelaGrupoParaHTML(
    'Público de Anúncio × Região Real',
    analiseTrafego?.publicoVsRegiaoReal,
    'Cruza para onde o anúncio mira com o DDD real de quem chegou.'
  )}

  <h3>Distribuição por Estado (gráfico de barras)</h3>
  ${gerarSvgBarraEstatico(analiseTrafego?.porEstado)}

  <h3>Engajamento por Etapa — Público de Anúncio (em quantidade)</h3>
  ${gerarSvgEngajamentoEstatico(analiseTrafego?.engajamentoPorPublico)}

  <h3>Engajamento por Etapa — Estados mais engajados (em quantidade)</h3>
  ${gerarSvgEngajamentoEstatico(analiseTrafego?.engajamentoPorEstado)}

  <h2>Custo de Tráfego</h2>
  ${corpoDadosManuais}

  <h2>Decisões e Observações</h2>
  ${corpoDecisoes}

</body>
</html>`;

  const blob = new Blob([html], { type: 'text/html;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `relatorio_semanal_${inicio}_${fim}.html`;
  a.click();
  URL.revokeObjectURL(url);
}

// (sem export — este arquivo é carregado como <script> comum no HTML,
// não como módulo ES, pra ficar igual ao resto do projeto)
