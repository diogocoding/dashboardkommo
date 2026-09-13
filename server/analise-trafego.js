// analise-trafego.js (v2)
// Fase 2 (+ 8/9) do sistema de acompanhamento de tráfego e leads.
//
// Novidades desta versão:
//   - Cada grupo (público/anúncio/região/etc.) agora carrega a lista de
//     leads que o compõem (id, nome, telefone) — é o que permite o
//     drill-down "quem são esses leads" ao clicar num gráfico.
//   - mesclarCustoComAnalise(): cruza o orçamento (só valores de custo,
//     ver armazenamento-trafego.js) com os números que o Kommo já entrega
//     (leads, qualificados), calculando custo/lead e custo/qualificado —
//     não é mais preciso digitar esses derivados manualmente.

import { getLocalizacao } from './localizacao.js';

const ORDEM_FUNIL = [
  'CONTATO INICIAL',
  'CONTATO INICIADO',
  'QUALIFICAÇÃO',
  'MARCAÇÃO DE REUNIÃO (BOT)',
  'LEADS QUALIFICADOS',
  'MARCAÇÃO DE REUNIÃO',
  'NO SHOW',
  'protocolo farmer',
  'protocolo farmer - ADIPLENTE',
  'CLIENTE QUENTE',
  'CONTRATO FECHADO',
];

function indiceFunil(nomeEtapa) {
  const i = ORDEM_FUNIL.indexOf(nomeEtapa);
  return i === -1 ? -1 : i;
}

function consolidarLeads(historico) {
  const porLead = new Map();

  for (const linha of historico) {
    if (linha.nome && linha.nome.includes('não encontrado no lote atual de leads')) {
      continue;
    }
    // Eventos marcados como "movimentação errada, excluída do cálculo" pela
    // ferramenta de correção do dashboard precisam ser ignorados aqui também
    // — sem isso, esse módulo contava eventos que o /api/metrics (usado nos
    // relatórios antigos) sempre descartou, causando divergência de números.
    if (linha.excluidoDoCalculo) {
      continue;
    }

    if (!porLead.has(linha.leadId)) {
      porLead.set(linha.leadId, {
        leadId: linha.leadId,
        nome: linha.nome,
        telefone: linha.telefone,
        campanha: linha.campanha || '',
        publico: linha.publico || '',
        anuncio: linha.anuncio || '',
        respostasFormulario: linha.respostasFormulario || {},
        dataCriacaoLead: linha.dataCriacaoLead,
        etapaMaisAvancada: null,
        indiceMaisAvancado: -1,
        etapasVisitadas: new Set(),
      });
    }

    const lead = porLead.get(linha.leadId);

    if (!lead.campanha && linha.campanha) lead.campanha = linha.campanha;
    if (!lead.publico && linha.publico) lead.publico = linha.publico;
    if (!lead.anuncio && linha.anuncio) lead.anuncio = linha.anuncio;

    [linha.etapaOrigem, linha.etapaDestino].forEach((etapa) => {
      if (!etapa) return;
      lead.etapasVisitadas.add(etapa);
      const idx = indiceFunil(etapa);
      if (idx > lead.indiceMaisAvancado) {
        lead.indiceMaisAvancado = idx;
        lead.etapaMaisAvancada = etapa;
      }
    });
  }

  return Array.from(porLead.values()).map((lead) => ({
    ...lead,
    localizacao: getLocalizacao(lead.telefone),
  }));
}

/**
 * Resumo enxuto de um lead, usado dentro de cada grupo — só o suficiente
 * pra identificar/clicar no drill-down, sem duplicar o objeto inteiro
 * (que carrega o Set de etapasVisitadas, pesado de mais pra mandar repetido
 * em cada grupo que o lead aparece).
 */
function resumoLead(lead) {
  return {
    leadId: lead.leadId,
    nome: lead.nome,
    telefone: lead.telefone,
    etapaMaisAvancada: lead.etapaMaisAvancada,
  };
}

function agruparEComputarTaxas(leadsConsolidados, chaveDeAgrupamento) {
  const grupos = new Map();

  for (const lead of leadsConsolidados) {
    const chave = chaveDeAgrupamento(lead) || '(sem valor)';
    if (!grupos.has(chave)) grupos.set(chave, []);
    grupos.get(chave).push(lead);
  }

  const resultado = [];
  for (const [chave, leadsDoGrupo] of grupos.entries()) {
    const n = leadsDoGrupo.length;
    const contar = (etapa) =>
      leadsDoGrupo.filter((l) => l.etapasVisitadas.has(etapa)).length;
    const leadsQueVisitaram = (etapa) =>
      leadsDoGrupo.filter((l) => l.etapasVisitadas.has(etapa)).map(resumoLead);

    const qualificados = contar('LEADS QUALIFICADOS');
    const reuniao = contar('MARCAÇÃO DE REUNIÃO');
    const farmer = contar('protocolo farmer') + contar('protocolo farmer - ADIPLENTE');
    const clienteQuente = contar('CLIENTE QUENTE');
    const contratoFechado = contar('CONTRATO FECHADO');
    const noShow = contar('NO SHOW');

    resultado.push({
      grupo: chave,
      totalLeads: n,
      qualificados,
      percentualQualificados: n ? Math.round((qualificados / n) * 1000) / 10 : 0,
      reuniao,
      percentualReuniao: n ? Math.round((reuniao / n) * 1000) / 10 : 0,
      noShow,
      farmer,
      clienteQuente,
      contratoFechado,
      // Listas de leads por etapa, pro drill-down — "quem são" ao clicar.
      leads: leadsDoGrupo.map(resumoLead),
      leadsQualificados: leadsQueVisitaram('LEADS QUALIFICADOS'),
      leadsReuniao: leadsQueVisitaram('MARCAÇÃO DE REUNIÃO'),
      leadsFarmer: [...leadsQueVisitaram('protocolo farmer'), ...leadsQueVisitaram('protocolo farmer - ADIPLENTE')],
    });
  }

  resultado.sort((a, b) => b.totalLeads - a.totalLeads);
  return resultado;
}

/**
 * Engajamento por etapa do funil, por grupo — % do grupo que alcançou cada
 * etapa-marco (pro gráfico de linha "Engajamento por público/estado").
 */
const ETAPAS_MARCO = ['CONTATO INICIADO', 'LEADS QUALIFICADOS', 'MARCAÇÃO DE REUNIÃO', 'protocolo farmer'];
const ROTULOS_ETAPAS_MARCO = ['Contato Iniciado', 'Qualificação', 'Marcação de Reunião', 'Farmer/Quente/Fechado'];

function engajamentoPorEtapa(gruposComTaxas, leadsConsolidados, chaveDeAgrupamento) {
  // Reconstroi os leads de cada grupo (precisamos do Set de etapasVisitadas,
  // que os grupos já resumidos não carregam mais).
  const leadsPorGrupo = new Map();
  for (const lead of leadsConsolidados) {
    const chave = chaveDeAgrupamento(lead) || '(sem valor)';
    if (!leadsPorGrupo.has(chave)) leadsPorGrupo.set(chave, []);
    leadsPorGrupo.get(chave).push(lead);
  }

  return gruposComTaxas.map((g) => {
    const leadsDoGrupo = leadsPorGrupo.get(g.grupo) || [];
    const n = leadsDoGrupo.length;
    const pontos = ETAPAS_MARCO.map((etapa, i) => {
      const leadsQueAlcancaram = leadsDoGrupo.filter((l) => l.etapasVisitadas.has(etapa));
      return {
        etapa: ROTULOS_ETAPAS_MARCO[i],
        percentual: n ? Math.round((leadsQueAlcancaram.length / n) * 1000) / 10 : 0,
        // Quantidade bruta e a lista de leads que alcançaram esse ponto —
        // usado pro toggle %/quantidade e pro drill-down ao clicar na bolinha.
        quantidade: leadsQueAlcancaram.length,
        leads: leadsQueAlcancaram.map(resumoLead),
      };
    });
    return { grupo: g.grupo, totalLeads: n, pontos };
  });
}

/**
 * Cruza o orçamento (custo, só valores manuais) com os grupos já calculados
 * a partir do Kommo — devolve os mesmos grupos, com custoPorLead e
 * custoPorQualificado calculados (não digitados). `custo.porAnuncio` deve
 * usar o mesmo texto de "anuncio" (ou "publico") que os grupos já têm.
 */
function mesclarCustoComAnalise(gruposPorAnuncioOuPublico, listaCusto, diasNoPeriodo) {
  // Aceita tanto o formato novo (c.grupo = string exata do grupo, ex.: o
  // "anuncio — publico" combinado) quanto o formato antigo (c.anuncio ou
  // c.publico soltos) — assim uma semana salva antes dessa mudança ainda
  // consegue ser mesclada sem quebrar.
  const custoPorChave = new Map((listaCusto || []).map((c) => [c.grupo || c.anuncio || c.publico, c]));

  return gruposPorAnuncioOuPublico.map((g) => {
    const custo = custoPorChave.get(g.grupo);
    if (!custo || !diasNoPeriodo) {
      return { ...g, orcamentoDiario: custo?.orcamentoDiario ?? null, custoTotal: null, custoPorLead: null, custoPorQualificado: null };
    }
    const custoTotal = custo.orcamentoDiario * diasNoPeriodo;
    return {
      ...g,
      orcamentoDiario: custo.orcamentoDiario,
      custoTotal: Math.round(custoTotal * 100) / 100,
      custoPorLead: g.totalLeads ? Math.round((custoTotal / g.totalLeads) * 100) / 100 : null,
      custoPorQualificado: g.qualificados ? Math.round((custoTotal / g.qualificados) * 100) / 100 : null,
    };
  });
}

function analisarTrafego(historico) {
  const leads = consolidarLeads(historico);

  const porPublico = agruparEComputarTaxas(leads, (l) => l.publico);
  const porAnuncio = agruparEComputarTaxas(leads, (l) => l.anuncio);
  const porCampanha = agruparEComputarTaxas(leads, (l) => l.campanha);
  const porRegiao = agruparEComputarTaxas(leads, (l) => l.localizacao.regiao);
  const porEstado = agruparEComputarTaxas(leads, (l) => l.localizacao.estado);
  // Cruzamento no nível de "conjunto de anúncio" de verdade — o mesmo
  // anúncio (ex.: AD 10) pode rodar com orçamentos diários diferentes em
  // cada público, então o custo precisa ser lançado por essa combinação,
  // não só pelo nome do anúncio isolado.
  const porAnuncioEPublico = agruparEComputarTaxas(leads, (l) => `${l.anuncio || '(sem anúncio)'} — ${l.publico || '(sem público)'}`);

  return {
    totalLeads: leads.length,
    porPublico,
    porAnuncio,
    porAnuncioEPublico,
    porCampanha,
    porRegiao,
    porEstado,
    publicoVsRegiaoReal: agruparEComputarTaxas(
      leads,
      (l) => `${l.publico || '(sem público)'} → ${l.localizacao.regiao || '(DDD não identificado)'}`
    ),
    engajamentoPorPublico: engajamentoPorEtapa(porPublico, leads, (l) => l.publico),
    engajamentoPorEstado: engajamentoPorEtapa(porEstado, leads, (l) => l.localizacao.estado),
    leadsSemTelefoneReconhecido: leads.filter((l) => !l.localizacao.formatoReconhecido).length,
  };
}

export {
  analisarTrafego,
  consolidarLeads,
  agruparEComputarTaxas,
  engajamentoPorEtapa,
  mesclarCustoComAnalise,
  ORDEM_FUNIL,
};
