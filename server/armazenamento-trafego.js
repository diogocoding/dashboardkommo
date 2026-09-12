// armazenamento-trafego.js (v2)
// Fases 3, 8 e 9 do sistema de acompanhamento de tráfego e leads.
//
// Mudança importante desta versão: os dados manuais de CUSTO agora ficam
// presos dentro de cada semana (não existe mais um "valor atual" solto).
// Isso evita viés: se o orçamento de um anúncio mudar mês que vem, isso não
// reescreve o custo das semanas já salvas — cada semana carrega o custo que
// era real naquele momento.
//
// Também: os dados manuais agora são SÓ CUSTO (orçamento diário por
// anúncio/campanha, mensal, branding) — não leads/qualificados/custo
// derivado. Esses números já vêm prontos do lado do Kommo (analise-trafego.js);
// o custo por lead/qualificado é CALCULADO cruzando os dois, não digitado.

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
  lista.sort((a, b) => new Date(a.inicio) - new Date(b.inicio));
  await salvarListaSemanas(lista);
}

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

async function salvarSemana(inicio, fim, analise) {
  const chave = gerarChaveSemana(inicio, fim);
  const registroExistente = await lerSemana(inicio, fim);

  const registro = {
    inicio,
    fim,
    analise,
    decisoes: registroExistente?.decisoes || [],
    observacoes: registroExistente?.observacoes || [],
    // Custo agora é um objeto fixo por semana, não uma lista solta —
    // ver salvarCustoSemana logo abaixo pro formato completo.
    custo: registroExistente?.custo || null,
    criadoEm: registroExistente?.criadoEm || new Date().toISOString(),
    atualizadoEm: new Date().toISOString(),
  };

  await upstash.post(`/set/${chave}`, JSON.stringify(registro));
  await adicionarNaListaSeNaoExiste(inicio, fim);
  return registro;
}

/**
 * Remove uma semana inteira (análise + decisões + observações + custo).
 * Não tem confirmação aqui dentro — quem confirma é a interface, antes de
 * chamar isso. Retorna true/false conforme achou ou não a semana.
 */
async function excluirSemana(inicio, fim) {
  const chave = gerarChaveSemana(inicio, fim);
  const registro = await lerSemana(inicio, fim);
  if (!registro) return false;

  await upstash.post(`/del/${chave}`);
  const lista = (await lerListaSemanas()).filter((s) => !(s.inicio === inicio && s.fim === fim));
  await salvarListaSemanas(lista);
  return true;
}

/**
 * Salva os dados de CUSTO de uma semana — só orçamento, sem leads/qualificados
 * (esses o sistema já sabe calcular sozinho a partir do Kommo). Formato:
 *   {
 *     orcamentoMensal: 6800,
 *     orcamentoDiarioTotal: 226,
 *     brandingDiario: 20,
 *     porAnuncio: [
 *       { anuncio: "AD 10 - ...", publico: "SP (...)", orcamentoDiario: 55.47 },
 *       ...
 *     ]
 *   }
 * "porAnuncio" usa o MESMO texto de público/anúncio que já vem do Kommo
 * (analise-trafego.js), pra o cruzamento na hora de calcular custo/lead
 * bater certinho — ver mesclarCustoComAnalise() em analise-trafego.js.
 */
async function salvarCustoSemana(inicio, fim, custo) {
  const registro = await lerSemana(inicio, fim);
  if (!registro) {
    throw new Error('Semana não encontrada — salve a análise dessa semana antes de registrar o custo.');
  }
  registro.custo = custo;
  registro.atualizadoEm = new Date().toISOString();
  await upstash.post(`/set/${gerarChaveSemana(inicio, fim)}`, JSON.stringify(registro));
  return registro;
}

async function adicionarDecisao(inicio, fim, decisao) {
  const registro = await lerSemana(inicio, fim);
  if (!registro) {
    throw new Error('Semana não encontrada — salve a análise dessa semana antes de registrar uma decisão.');
  }
  registro.decisoes.push({ id: Date.now().toString(), ...decisao, criadoEm: new Date().toISOString() });
  registro.atualizadoEm = new Date().toISOString();
  await upstash.post(`/set/${gerarChaveSemana(inicio, fim)}`, JSON.stringify(registro));
  return registro;
}

async function editarDecisao(inicio, fim, decisaoId, novosDados) {
  const registro = await lerSemana(inicio, fim);
  if (!registro) throw new Error('Semana não encontrada.');
  const item = registro.decisoes.find((d) => d.id === decisaoId);
  if (!item) throw new Error('Decisão não encontrada nessa semana.');
  Object.assign(item, novosDados, { editadoEm: new Date().toISOString() });
  registro.atualizadoEm = new Date().toISOString();
  await upstash.post(`/set/${gerarChaveSemana(inicio, fim)}`, JSON.stringify(registro));
  return registro;
}

async function excluirDecisao(inicio, fim, decisaoId) {
  const registro = await lerSemana(inicio, fim);
  if (!registro) throw new Error('Semana não encontrada.');
  registro.decisoes = registro.decisoes.filter((d) => d.id !== decisaoId);
  registro.atualizadoEm = new Date().toISOString();
  await upstash.post(`/set/${gerarChaveSemana(inicio, fim)}`, JSON.stringify(registro));
  return registro;
}

async function adicionarObservacao(inicio, fim, texto) {
  const registro = await lerSemana(inicio, fim);
  if (!registro) {
    throw new Error('Semana não encontrada — salve a análise dessa semana antes de registrar uma observação.');
  }
  registro.observacoes.push({ id: Date.now().toString(), texto, criadoEm: new Date().toISOString() });
  registro.atualizadoEm = new Date().toISOString();
  await upstash.post(`/set/${gerarChaveSemana(inicio, fim)}`, JSON.stringify(registro));
  return registro;
}

async function editarObservacao(inicio, fim, observacaoId, novoTexto) {
  const registro = await lerSemana(inicio, fim);
  if (!registro) throw new Error('Semana não encontrada.');
  const item = registro.observacoes.find((o) => o.id === observacaoId);
  if (!item) throw new Error('Observação não encontrada nessa semana.');
  item.texto = novoTexto;
  item.editadoEm = new Date().toISOString();
  registro.atualizadoEm = new Date().toISOString();
  await upstash.post(`/set/${gerarChaveSemana(inicio, fim)}`, JSON.stringify(registro));
  return registro;
}

async function excluirObservacao(inicio, fim, observacaoId) {
  const registro = await lerSemana(inicio, fim);
  if (!registro) throw new Error('Semana não encontrada.');
  registro.observacoes = registro.observacoes.filter((o) => o.id !== observacaoId);
  registro.atualizadoEm = new Date().toISOString();
  await upstash.post(`/set/${gerarChaveSemana(inicio, fim)}`, JSON.stringify(registro));
  return registro;
}

export {
  lerSemana,
  salvarSemana,
  excluirSemana,
  lerListaSemanas,
  salvarCustoSemana,
  adicionarDecisao,
  editarDecisao,
  excluirDecisao,
  adicionarObservacao,
  editarObservacao,
  excluirObservacao,
};
