// analise-trafego.js
// Fase 2 do sistema de acompanhamento de tráfego e leads.
//
// NÃO busca nada no Kommo diretamente — recebe o array `historico` que já
// vem pronto de GET /api/historico-completo?incluirCampanha=true (ver
// server.js) e calcula o que ainda não existe: agrupamento por
// público/anúncio/campanha, e cruzamento com região via DDD.
//
// Uso típico dentro de uma rota nova do Hub Comercial:
//
//   const { leadsLimposPorId, todosEventos } = await buscarLeadsEEventosNoPeriodo(...);
//   // (ou simplesmente chamando a própria rota /api/historico-completo internamente)
//   const analise = analisarTrafego(historico);

const { getLocalizacao } = require('./localizacao.js');

// Ordem de "avanço" no funil, usada para achar a etapa mais distante que
// cada lead alcançou no período. Mantido como lista simples (não como
// dependência de ETAPAS_IDS do server.js) para este módulo não precisar
// importar o servidor inteiro — só os NOMES de etapa já resolvidos, que é o
// que o histórico-completo já entrega em etapaDestino/etapaOrigem.
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

/**
 * Agrupa as linhas do histórico (uma por evento) em um registro por lead,
 * já com: etapa mais avançada alcançada no período, se passou por cada
 * etapa-chave, dados de campanha/público/anúncio, e localização via telefone.
 */
function consolidarLeads(historico) {
  const porLead = new Map();

  for (const linha of historico) {
    // Linhas de leads que já não existem mais no Kommo (removidos/mesclados/
    // testes excluídos) não têm dado de campanha nem telefone confiável —
    // mesma convenção já usada no resto do sistema: nome contém esse texto.
    if (linha.nome && linha.nome.includes('não encontrado no lote atual de leads')) {
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

    // Preenche campanha/público/anúncio com o primeiro valor não-vazio
    // encontrado (mesma lógica de "primeiro valor válido" usada no restante
    // do sistema) — cobre o caso de o evento inicial não ter esses dados
    // ainda preenchidos no card do lead.
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

  // Enriquece cada lead consolidado com a localização, calculada uma única
  // vez (não por evento) — mais barato e evita repetir o mesmo cálculo.
  const leads = Array.from(porLead.values()).map((lead) => ({
    ...lead,
    localizacao: getLocalizacao(lead.telefone),
  }));

  return leads;
}

/**
 * Agrupa uma lista de leads consolidados (ver consolidarLeads) por uma
 * chave à sua escolha (público, anúncio, campanha, estado, região...) e
 * calcula as taxas-chave do funil pra cada grupo.
 */
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
    });
  }

  resultado.sort((a, b) => b.totalLeads - a.totalLeads);
  return resultado;
}

/**
 * Função principal exposta pelo módulo: recebe o array `historico` (vindo
 * de /api/historico-completo?incluirCampanha=true) e devolve todos os
 * cruzamentos já prontos pra alimentar os painéis da aba nova.
 */
function analisarTrafego(historico) {
  const leads = consolidarLeads(historico);

  return {
    totalLeads: leads.length,
    porPublico: agruparEComputarTaxas(leads, (l) => l.publico),
    porAnuncio: agruparEComputarTaxas(leads, (l) => l.anuncio),
    porCampanha: agruparEComputarTaxas(leads, (l) => l.campanha),
    porRegiao: agruparEComputarTaxas(leads, (l) => l.localizacao.regiao),
    porEstado: agruparEComputarTaxas(leads, (l) => l.localizacao.estado),
    // Cruzamento específico que já rendeu insight real na nossa análise:
    // público de anúncio x região REAL do DDD, pra flagrar quando um
    // público segmentado não está trazendo quem deveria.
    publicoVsRegiaoReal: agruparEComputarTaxas(
      leads,
      (l) => `${l.publico || '(sem público)'} → ${l.localizacao.regiao || '(DDD não identificado)'}`
    ),
    leadsSemTelefoneReconhecido: leads.filter((l) => !l.localizacao.formatoReconhecido).length,
  };
}

module.exports = { analisarTrafego, consolidarLeads, agruparEComputarTaxas, ORDEM_FUNIL };
