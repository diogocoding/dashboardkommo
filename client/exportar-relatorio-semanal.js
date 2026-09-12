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
    <table>
      <thead><tr><th>Conjunto (Anúncio + Público)</th><th>Leads</th><th>Qualif.</th><th>Orçamento/dia</th><th>Custo total</th><th>Custo/Lead</th><th>Custo/Qualif.</th></tr></thead>
      <tbody>${linhas}</tbody>
    </table>`;
}

function baixarRelatorioSemanalHTML(contexto) {
  const { inicio, fim, metrics, analiseTrafego, analiseComCusto, registroSemana } = contexto;
  const s = metrics?.summary || {};

  const corpoDecisoes = registroSemana
    ? decisoesEObservacoesParaHTML(registroSemana.decisoes, registroSemana.observacoes)
    : '<p class="vazio">Esta semana ainda não foi salva no histórico — nenhuma decisão ou observação registrada.</p>';

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

  <h2>Cruzamentos de Tráfego</h2>
  ${tabelaGrupoParaHTML('Por Público de Anúncio', analiseTrafego?.porPublico)}
  ${tabelaGrupoParaHTML('Por Anúncio', analiseTrafego?.porAnuncio)}
  ${tabelaGrupoParaHTML('Por Região (DDD real do telefone)', analiseTrafego?.porRegiao)}
  ${tabelaGrupoParaHTML(
    'Público de Anúncio × Região Real',
    analiseTrafego?.publicoVsRegiaoReal,
    'Cruza para onde o anúncio mira com o DDD real de quem chegou.'
  )}

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
