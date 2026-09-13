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

function consolidarLeads(historico, opcoes = {}) {
  const { apenasNovos = false, inicio = null, fim = null } = opcoes;
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

  let leads = Array.from(porLead.values()).map((lead) => ({
    ...lead,
    localizacao: getLocalizacao(lead.telefone),
  }));

  // "Leads novos do período" = nasceram (data de criação) dentro do próprio
  // intervalo consultado — é essa a definição que bate com o que o tráfego
  // conta como leads gerados pela campanha, diferente de "qualquer atividade"
  // (que também inclui leads antigos reaquecidos avançando no funil).
  if (apenasNovos && inicio && fim) {
    const inicioTs = new Date(`${inicio}T00:00:00-03:00`).getTime();
    const fimTs = new Date(`${fim}T23:59:59-03:00`).getTime();
    leads = leads.filter((lead) => {
      if (!lead.dataCriacaoLead) return false;
      const criadoTs = new Date(lead.dataCriacaoLead).getTime();
      return criadoTs >= inicioTs && criadoTs <= fimTs;
    });
  }

  return leads;
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
      return { ...g, orcamentoDiario: custo?.orcamentoDiario ?? null, custoTotal: null, custoPorLead: null, custoPorQualificado: null, custoPorContratoFechado: null };
    }
    const custoTotal = custo.orcamentoDiario * diasNoPeriodo;
    return {
      ...g,
      orcamentoDiario: custo.orcamentoDiario,
      custoTotal: Math.round(custoTotal * 100) / 100,
      custoPorLead: g.totalLeads ? Math.round((custoTotal / g.totalLeads) * 100) / 100 : null,
      custoPorQualificado: g.qualificados ? Math.round((custoTotal / g.qualificados) * 100) / 100 : null,
      // O número que realmente fecha a conta do ROI — quanto custou cada
      // contrato fechado, não só cada lead ou qualificado.
      custoPorContratoFechado: g.contratoFechado ? Math.round((custoTotal / g.contratoFechado) * 100) / 100 : null,
    };
  });
}

/**
 * Soma os grupos de uma mesma dimensão (ex.: porPublico) vindos de VÁRIAS
 * semanas já salvas, casando pelo texto exato do grupo. Percentuais são
 * RECALCULADOS a partir da soma das contagens brutas — nunca soma-se
 * percentual com percentual (isso daria conta errada).
 */
function somarGruposDeVariasSemanas(listaDeArraysDeGrupos) {
  const somaPorChave = new Map();
  for (const arrayDeGrupos of listaDeArraysDeGrupos) {
    for (const g of arrayDeGrupos || []) {
      if (!somaPorChave.has(g.grupo)) {
        somaPorChave.set(g.grupo, {
          grupo: g.grupo, totalLeads: 0, qualificados: 0, reuniao: 0,
          noShow: 0, farmer: 0, clienteQuente: 0, contratoFechado: 0,
          leads: [], leadsQualificados: [], leadsReuniao: [], leadsFarmer: [],
        });
      }
      const acc = somaPorChave.get(g.grupo);
      acc.totalLeads += g.totalLeads || 0;
      acc.qualificados += g.qualificados || 0;
      acc.reuniao += g.reuniao || 0;
      acc.noShow += g.noShow || 0;
      acc.farmer += g.farmer || 0;
      acc.clienteQuente += g.clienteQuente || 0;
      acc.contratoFechado += g.contratoFechado || 0;
      acc.leads.push(...(g.leads || []));
      acc.leadsQualificados.push(...(g.leadsQualificados || []));
      acc.leadsReuniao.push(...(g.leadsReuniao || []));
      acc.leadsFarmer.push(...(g.leadsFarmer || []));
    }
  }
  const resultado = Array.from(somaPorChave.values()).map((g) => ({
    ...g,
    percentualQualificados: g.totalLeads ? Math.round((g.qualificados / g.totalLeads) * 1000) / 10 : 0,
    percentualReuniao: g.totalLeads ? Math.round((g.reuniao / g.totalLeads) * 1000) / 10 : 0,
  }));
  resultado.sort((a, b) => b.totalLeads - a.totalLeads);
  return resultado;
}

/**
 * Combina a análise de várias semanas salvas em uma só análise agregada
 * (mesmo formato de analisarTrafego) — base do rollup mensal ("soma essas
 * 4 semanas salvas num relatório só").
 */
function combinarAnalisesSemanais(listaDeAnalises) {
  return {
    totalLeads: listaDeAnalises.reduce((acc, a) => acc + (a.totalLeads || 0), 0),
    totalQualificados: listaDeAnalises.reduce((acc, a) => acc + (a.totalQualificados || 0), 0),
    totalReuniao: listaDeAnalises.reduce((acc, a) => acc + (a.totalReuniao || 0), 0),
    totalContratoFechado: listaDeAnalises.reduce((acc, a) => acc + (a.totalContratoFechado || 0), 0),
    porPublico: somarGruposDeVariasSemanas(listaDeAnalises.map((a) => a.porPublico)),
    porAnuncio: somarGruposDeVariasSemanas(listaDeAnalises.map((a) => a.porAnuncio)),
    porAnuncioEPublico: somarGruposDeVariasSemanas(listaDeAnalises.map((a) => a.porAnuncioEPublico)),
    porRegiao: somarGruposDeVariasSemanas(listaDeAnalises.map((a) => a.porRegiao)),
    porEstado: somarGruposDeVariasSemanas(listaDeAnalises.map((a) => a.porEstado)),
  };
}


/**
 * Soma o custo TOTAL (já calculado, orçamento × dias) de cada conjunto de
 * anúncio através de várias semanas — usado no rollup mensal. Diferente de
 * mesclarCustoComAnalise (que recebe orçamento diário bruto e multiplica
 * pelos dias de UMA semana), aqui os valores já vêm prontos por semana e só
 * precisam ser somados.
 */
function somarCustoTotalDeVariasSemanas(listaDeRegistrosSemana) {
  const somaPorGrupo = new Map();
  for (const registro of listaDeRegistrosSemana) {
    if (!registro.custo?.porAnuncio) continue;
    const dias = (new Date(registro.fim) - new Date(registro.inicio)) / 86400000 + 1;
    for (const c of registro.custo.porAnuncio) {
      const chave = c.grupo || c.anuncio || c.publico;
      const custoTotal = (c.orcamentoDiario || 0) * dias;
      somaPorGrupo.set(chave, (somaPorGrupo.get(chave) || 0) + custoTotal);
    }
  }
  return somaPorGrupo;
}

/**
 * Recalcula custo/lead, custo/qualificado e custo/contrato a partir de um
 * custo TOTAL já somado (rollup) — não multiplica por dias de novo, já que
 * a soma em somarCustoTotalDeVariasSemanas já fez isso por semana.
 */
function aplicarCustoJaSomado(gruposCombinados, mapaCustoTotalPorGrupo) {
  return gruposCombinados.map((g) => {
    const custoTotal = mapaCustoTotalPorGrupo.get(g.grupo);
    if (custoTotal === undefined) {
      return { ...g, custoTotal: null, custoPorLead: null, custoPorQualificado: null, custoPorContratoFechado: null };
    }
    return {
      ...g,
      custoTotal: Math.round(custoTotal * 100) / 100,
      custoPorLead: g.totalLeads ? Math.round((custoTotal / g.totalLeads) * 100) / 100 : null,
      custoPorQualificado: g.qualificados ? Math.round((custoTotal / g.qualificados) * 100) / 100 : null,
      custoPorContratoFechado: g.contratoFechado ? Math.round((custoTotal / g.contratoFechado) * 100) / 100 : null,
    };
  });
}


function analisarTrafego(historico, opcoes = {}) {
  const leads = consolidarLeads(historico, opcoes);

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
    // Totais agregados da semana inteira — somados aqui uma vez (em vez de
    // cada consumidor ter que somar os grupos de novo) porque a comparação
    // semana-a-semana e o rollup mensal precisam desses números prontos.
    totalQualificados: porPublico.reduce((acc, g) => acc + g.qualificados, 0),
    totalReuniao: porPublico.reduce((acc, g) => acc + g.reuniao, 0),
    totalContratoFechado: porPublico.reduce((acc, g) => acc + g.contratoFechado, 0),
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
    apenasNovos: Boolean(opcoes.apenasNovos),
  };
}

export {
  analisarTrafego,
  consolidarLeads,
  agruparEComputarTaxas,
  engajamentoPorEtapa,
  mesclarCustoComAnalise,
  somarGruposDeVariasSemanas,
  combinarAnalisesSemanais,
  somarCustoTotalDeVariasSemanas,
  aplicarCustoJaSomado,
  ORDEM_FUNIL,
};
