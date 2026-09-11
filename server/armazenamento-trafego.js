// armazenamento-trafego.js
// Fase 3 do sistema de acompanhamento de tráfego e leads.
//
// Guarda o histórico semanal (análise + decisões + observações) no Upstash
// Redis — mesmo padrão já usado em server.js pras exclusões/correções de
// movimentação. Reaproveita as mesmas variáveis de ambiente
// (UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN), não precisa de
// nenhuma conta ou configuração nova.

import axios from 'axios';

const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

const upstash = axios.create({
  baseURL: UPSTASH_URL,
  headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` },
});

const PREFIXO_SEMANA = 'dashboardkommo:trafego:semana:';
const CHAVE_LISTA_SEMANAS = 'dashboardkommo:trafego:lista-semanas';

function gerarChaveSemana(inicio, fim) {
  return `${PREFIXO_SEMANA}${inicio}_${fim}`;
}

/**
 * Lê a lista-índice de todas as semanas já salvas (só metadados leves —
 * inicio/fim/chave — não o conteúdo inteiro de cada uma). É essa lista que
 * alimenta a tela "histórico de semanas" sem precisar buscar cada semana
 * individualmente só pra montar um menu.
 */
async function lerListaSemanas() {
  try {
    const r = await upstash.get(`/get/${CHAVE_LISTA_SEMANAS}`);
    if (!r.data?.result) return [];
    return JSON.parse(r.data.result);
  } catch (error) {
    console.error('Erro ao ler lista de semanas do Upstash:', error.message);
    return [];
  }
}

async function salvarListaSemanas(lista) {
  try {
    await upstash.post(`/set/${CHAVE_LISTA_SEMANAS}`, JSON.stringify(lista));
  } catch (error) {
    console.error('Erro ao salvar lista de semanas no Upstash:', error.message);
    throw error;
  }
}

async function adicionarNaListaSeNaoExiste(inicio, fim) {
  const lista = await lerListaSemanas();
  const jaExiste = lista.some((s) => s.inicio === inicio && s.fim === fim);
  if (jaExiste) return;
  lista.push({ inicio, fim, chave: gerarChaveSemana(inicio, fim) });
  // Mantém ordenado por data — evita ter que ordenar de novo cada vez que a
  // tela de histórico for exibida.
  lista.sort((a, b) => new Date(a.inicio) - new Date(b.inicio));
  await salvarListaSemanas(lista);
}

/**
 * Lê o registro completo de uma semana (análise + decisões + observações).
 * Retorna null se essa semana ainda não foi salva nenhuma vez.
 */
async function lerSemana(inicio, fim) {
  const chave = gerarChaveSemana(inicio, fim);
  try {
    const r = await upstash.get(`/get/${chave}`);
    if (!r.data?.result) return null;
    return JSON.parse(r.data.result);
  } catch (error) {
    console.error('Erro ao ler semana do Upstash:', error.message);
    return null;
  }
}

/**
 * Salva (ou atualiza) a análise de uma semana. Se a semana já existia,
 * preserva decisões e observações já registradas — só substitui a análise
 * em si (útil pra re-rodar o cálculo depois de uma correção no Kommo, sem
 * perder o histórico de decisões já tomadas naquela semana).
 */
async function salvarSemana(inicio, fim, analise) {
  const chave = gerarChaveSemana(inicio, fim);
  const registroExistente = await lerSemana(inicio, fim);

  const registro = {
    inicio,
    fim,
    analise,
    decisoes: registroExistente?.decisoes || [],
    observacoes: registroExistente?.observacoes || [],
    criadoEm: registroExistente?.criadoEm || new Date().toISOString(),
    atualizadoEm: new Date().toISOString(),
  };

  await upstash.post(`/set/${chave}`, JSON.stringify(registro));
  await adicionarNaListaSeNaoExiste(inicio, fim);
  return registro;
}

/**
 * Acrescenta uma decisão ao histórico de uma semana já salva. Lança erro se
 * a semana ainda não tiver sido salva (precisa rodar a análise primeiro).
 */
async function adicionarDecisao(inicio, fim, decisao) {
  const registro = await lerSemana(inicio, fim);
  if (!registro) {
    throw new Error('Semana não encontrada — salve a análise dessa semana antes de registrar uma decisão.');
  }
  registro.decisoes.push({ ...decisao, criadoEm: new Date().toISOString() });
  registro.atualizadoEm = new Date().toISOString();
  await upstash.post(`/set/${gerarChaveSemana(inicio, fim)}`, JSON.stringify(registro));
  return registro;
}

/**
 * Acrescenta uma observação/nota qualitativa (ex.: feedback de lead
 * retido, print de conversa) ao histórico de uma semana já salva.
 */
async function adicionarObservacao(inicio, fim, texto) {
  const registro = await lerSemana(inicio, fim);
  if (!registro) {
    throw new Error('Semana não encontrada — salve a análise dessa semana antes de registrar uma observação.');
  }
  registro.observacoes.push({ texto, criadoEm: new Date().toISOString() });
  registro.atualizadoEm = new Date().toISOString();
  await upstash.post(`/set/${gerarChaveSemana(inicio, fim)}`, JSON.stringify(registro));
  return registro;
}

/**
 * Salva (ou substitui) os dados manuais de custo de tráfego de uma semana —
 * os números que só existem do lado da Meta/tráfego (custo por lead, custo
 * por qualificado por público/anúncio), sem equivalente no Kommo. Preserva
 * a análise e as decisões/observações já registradas para essa semana.
 *
 * `dados` é uma lista de entradas, uma por combinação público+anúncio, ex.:
 *   [{ publico: "SP", anuncio: "AD10", leads: 8, custoPorLead: 55.47,
 *      qualificados: 1, custoPorQualificado: 443.72 }, ...]
 */
async function salvarDadosTrafegoManual(inicio, fim, dados) {
  const registro = await lerSemana(inicio, fim);
  if (!registro) {
    throw new Error('Semana não encontrada — salve a análise dessa semana antes de registrar dados manuais de tráfego.');
  }
  registro.dadosTrafegoManual = dados;
  registro.atualizadoEm = new Date().toISOString();
  await upstash.post(`/set/${gerarChaveSemana(inicio, fim)}`, JSON.stringify(registro));
  return registro;
}

export {
  lerSemana,
  salvarSemana,
  lerListaSemanas,
  adicionarDecisao,
  adicionarObservacao,
  salvarDadosTrafegoManual,
};
