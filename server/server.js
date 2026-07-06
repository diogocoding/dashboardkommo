import express from "express";
import cors from "cors";
import axios from "axios";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CAMINHO_EXCLUSOES = path.join(__dirname, "exclusoes.json");

// --- CORREÇÃO DE MOVIMENTAÇÕES ERRADAS ---
// O Kommo não permite apagar eventos de histórico. Quando alguém move um
// lead errado sem querer (e depois devolve pra etapa certa), isso gera
// eventos extras que sujam as métricas. Em vez de tentar "desfazer" no
// Kommo, guardamos aqui os IDs de eventos que devem ser IGNORADOS no cálculo.
function lerExclusoes() {
  try {
    const conteudo = fs.readFileSync(CAMINHO_EXCLUSOES, "utf-8");
    return JSON.parse(conteudo);
  } catch {
    return [];
  }
}

function salvarExclusoes(lista) {
  fs.writeFileSync(CAMINHO_EXCLUSOES, JSON.stringify(lista, null, 2));
}

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3001;
const KOMMO_URL = `https://${process.env.KOMMO_SUBDOMAIN}.kommo.com/api/v4`;
const HEADERS = { Authorization: `Bearer ${process.env.KOMMO_TOKEN}` };

const ETAPAS_IDS = {
  "97353747": "ETAPA DE ENTRADA",
  "97353751": "CONTATO INICIAL",
  "104878772": "CONTATO INICIADO",
  "107763012": "INTERESSADOS",
  "97353759": "MARCAÇÃO DE REUNIÃO",
  "97353755": "DESQUALIFICADOS",
  "103294216": "protocolo farmer",
  "105105968": "protocolo farmer - ADIPLENTE",
  "103294220": "CLIENTE QUENTE",
  "103294224": "CONTRATO FECHADO",
  "103294212": "LEADS QUALIFICADOS",
  "103294208": "QUALIFICAÇÃO",
  "107297324": "NO SHOW",
  "104878776": "CLIENTE SEM INTERESSE",
  "105108420": "CLIENTE FRIO",
  "107143436": "INVÁLIDOS"
};

// Mapa reverso: nome textual → nome canônico (para quando o evento traz .name em vez de .id)
const NOMES_CANONICOS = {};
Object.values(ETAPAS_IDS).forEach((nome) => {
  NOMES_CANONICOS[nome.toLowerCase()] = nome;
});

// Resolve qualquer valor (ID numérico como string, ou nome textual) para o nome canônico da etapa
function resolverNomeEtapa(valor) {
  if (!valor || valor === "undefined" || valor === "null") return "Desconhecido";
  // Tenta por ID direto
  if (ETAPAS_IDS[valor]) return ETAPAS_IDS[valor];
  // Tenta por nome textual exato (case-insensitive)
  const canonical = NOMES_CANONICOS[valor.toLowerCase()];
  if (canonical) return canonical;
  // Se for só número desconhecido, exibe como ID desconhecido
  if (/^\d+$/.test(valor)) return `ID ${valor}`;
  // Retorna o próprio valor textual (pode ser nome de etapa não mapeada)
  return valor;
}

// Palavras-chave usadas para reconhecer campos de telefone, mesmo quando o
// field_code não é o padrão "PHONE" (ex.: campo customizado de grupo "Telefone"
// com sub-rótulos "Comercial", "Celular", "Direto Comercial", "Residencial" etc.)
const PALAVRAS_CHAVE_TELEFONE = [
  "telefone",
  "celular",
  "fone",
  "whatsapp",
  "phone",
  "tel.",
  "tel ",
];

// Varre uma lista de custom_fields_values (de um lead OU de um contato) e
// retorna o primeiro telefone preenchido.
function extrairTelefoneDeCampos(camposCustomizados) {
  const candidatos = (camposCustomizados || []).filter((f) => {
    const nome = f.field_name?.toLowerCase() || "";
    return (
      f.field_code === "PHONE" ||
      PALAVRAS_CHAVE_TELEFONE.some((kw) => nome.includes(kw))
    );
  });

  for (const campo of candidatos) {
    for (const v of campo.values || []) {
      const valor = String(v?.value || "").trim();
      if (valor) return valor;
    }
  }
  return "";
}

// Extrai o telefone de um lead. No Kommo, telefone normalmente é um campo
// PADRÃO DO CONTATO (não do lead) — então primeiro tentamos os campos do
// próprio lead (caso exista customização), e só depois caímos pro contato
// vinculado, que é onde o telefone costuma realmente morar.
function extrairTelefone(lead, contato) {
  const doLead = extrairTelefoneDeCampos(lead.custom_fields_values);
  if (doLead) return doLead;

  if (contato) {
    const doContato = extrairTelefoneDeCampos(contato.custom_fields_values);
    if (doContato) return doContato;
  }

  return "";
}

// Extrai o nome "de verdade" do lead. lead.name é o TÍTULO do negócio, que o
// Kommo preenche sozinho como "Lead #12345" quando ninguém digita um título.
// O nome real da pessoa costuma estar num campo customizado (ex.: "Nome
// completo") — então priorizamos esse campo e só usamos lead.name como
// segunda opção.
const PALAVRAS_CHAVE_NOME = ["nome completo", "nome do lead", "nome cliente"];

function pareceTituloAutoGerado(titulo) {
  return /^lead\s*#\s*\d+$/i.test(titulo.trim());
}

function contemLetra(texto) {
  return /\p{L}/u.test(texto);
}

// Nomes genéricos que o Kommo usa quando cria um contato sem que ninguém
// digite um nome de verdade — não contam como "nome real".
function pareceNomeAutoGerado(nome) {
  return /^(sem nome|contato sem nome|unnamed contact)$/i.test(nome.trim());
}

function extrairNomeDeCampos(camposCustomizados) {
  const campoNome = (camposCustomizados || []).find((f) => {
    const nome = f.field_name?.toLowerCase() || "";
    return PALAVRAS_CHAVE_NOME.some((kw) => nome.includes(kw));
  });
  const valor = campoNome?.values?.[0]?.value
    ? String(campoNome.values[0].value).trim()
    : "";
  return valor && contemLetra(valor) ? valor : "";
}

// Extrai o nome "de verdade" da pessoa. Ordem de prioridade:
// 1. Campo customizado "Nome completo" (ou similar) do LEAD;
// 2. Campo customizado "Nome completo" (ou similar) do CONTATO vinculado;
// 3. Nome padrão do CONTATO vinculado (campo `name` do contato no Kommo,
//    que é onde o nome da pessoa normalmente fica, já que lead.name é só o
//    título do negócio);
// 4. Título do lead (lead.name), só se não for um título automático tipo
//    "Lead #12345".
function extrairNome(lead, contato) {
  const doLead = extrairNomeDeCampos(lead.custom_fields_values);
  if (doLead) return doLead;

  if (contato) {
    const doContato = extrairNomeDeCampos(contato.custom_fields_values);
    if (doContato) return doContato;

    const nomeContato = contato.name ? contato.name.trim() : "";
    if (nomeContato && contemLetra(nomeContato) && !pareceNomeAutoGerado(nomeContato)) {
      return nomeContato;
    }
  }

  const tituloLead = lead.name ? lead.name.trim() : "";
  if (tituloLead && contemLetra(tituloLead) && !pareceTituloAutoGerado(tituloLead)) {
    return tituloLead;
  }

  return "";
}

function higienizarEDeduplicarLeads(leadsBrutos, contatosPorId = new Map()) {
  const leadsFormatados = leadsBrutos.map((lead) => {
    const idContato = lead._embedded?.contacts?.[0]?.id;
    const contato = idContato ? contatosPorId.get(idContato) : null;

    const telefoneBruto = extrairTelefone(lead, contato);
    const telefoneLimpo = String(telefoneBruto).replace(/[^0-9]/g, "");

    let nomeCompleto = extrairNome(lead, contato);
    let nomeSinalizado = false;
    if (!nomeCompleto) {
      nomeCompleto = `⚠ Sem Nome (${telefoneLimpo || "Sem Telefone"})`;
      nomeSinalizado = true;
    }

    const idStatusString = String(lead.status_id);
    const nomeEtapaResolvido = ETAPAS_IDS[idStatusString] || `Status ID: ${idStatusString}`;

    return {
      id: Number(lead.id),
      name: nomeCompleto,
      telefone: telefoneLimpo,
      etapa_atual: nomeEtapaResolvido,
      id_etapa_puro: idStatusString,
      tags: lead._embedded?.tags?.map((t) => t.name) || [],
      nomeSinalizado,
      updated_at: lead.updated_at,
    };
  });

  leadsFormatados.sort((a, b) => a.id - b.id);
  const mapDeduplicado = new Map();
  leadsFormatados.forEach((lead) => {
    const chave =
      lead.telefone && lead.telefone.length >= 8
        ? lead.telefone
        : `ID_${lead.id}`;
    mapDeduplicado.set(chave, lead);
  });
  return Array.from(mapDeduplicado.values());
}

// Busca em lote os contatos vinculados aos leads (é lá que o Kommo costuma
// guardar nome e telefone de verdade). Filtra por ID em blocos de 100 pra
// não estourar o limite de tamanho de URL.
async function buscarContatosPorIds(ids) {
  const contatosPorId = new Map();
  const idsUnicos = [...new Set(ids)].filter(Boolean);
  const tamanhoLote = 100;

  for (let i = 0; i < idsUnicos.length; i += tamanhoLote) {
    const lote = idsUnicos.slice(i, i + tamanhoLote);
    const queryFiltro = lote.map((id) => `filter[id][]=${id}`).join("&");
    let page = 1;
    let temMais = true;
    while (temMais) {
      try {
        const r = await axios.get(
          `${KOMMO_URL}/contacts?${queryFiltro}&limit=250&page=${page}`,
          { headers: HEADERS },
        );
        const contatos = r.data?._embedded?.contacts || [];
        contatos.forEach((c) => contatosPorId.set(c.id, c));
        if (contatos.length < 250) temMais = false;
        else page++;
      } catch (err) {
        // Se um lote falhar, seguimos sem travar o dashboard inteiro —
        // os leads desse lote só ficam sem o fallback do contato.
        temMais = false;
      }
    }
  }

  return contatosPorId;
}

// Endpoint de diagnóstico: mostra os campos customizados brutos de um lead
// específico, pra confirmar os field_name/field_code reais da sua conta Kommo.
// Uso: /api/debug-lead/104652827
app.get('/api/debug-lead/:id', async (req, res) => {
  try {
    const r = await axios.get(`${KOMMO_URL}/leads/${req.params.id}`, {
      headers: HEADERS,
      params: { with: "contacts" },
    });

    const idContato = r.data._embedded?.contacts?.[0]?.id;
    let contato = null;
    if (idContato) {
      const rc = await axios.get(`${KOMMO_URL}/contacts/${idContato}`, { headers: HEADERS });
      contato = rc.data;
    }

    res.json({
      id: r.data.id,
      name: r.data.name,
      custom_fields_values: r.data.custom_fields_values,
      contato: contato && {
        id: contato.id,
        name: contato.name,
        custom_fields_values: contato.custom_fields_values,
      },
      telefone_extraido: extrairTelefone(r.data, contato),
      nome_extraido: extrairNome(r.data, contato),
    });
  } catch (error) {
    res.status(500).json({ error: "Erro ao buscar lead.", detalhe: error.message });
  }
});

app.get('/api/descobrir-ids', async (req, res) => {
  try {
    const r = await axios.get(`${KOMMO_URL}/leads/pipelines`, { headers: HEADERS });
    res.json(r.data?._embedded?.pipelines || r.data);
  } catch (error) {
    res.status(500).json({ error: "Erro ao buscar pipelines do Kommo." });
  }
});

// Lista os eventos de mudança de etapa de UM lead específico, com o ID de
// cada evento — usado para descobrir qual evento excluir quando um lead foi
// movido errado sem querer. Uso: /api/eventos-lead/104652827
app.get('/api/eventos-lead/:id', async (req, res) => {
  try {
    const leadId = req.params.id;
    let todosEventos = [];
    let page = 1, temMais = true;
    while (temMais) {
      const r = await axios.get(`${KOMMO_URL}/events`, {
        headers: HEADERS,
        params: {
          "filter[entity]": "leads",
          "filter[type]": "lead_status_changed",
          "filter[entity_id]": leadId,
          limit: 250,
          page,
        },
      });
      const batch = r.data?._embedded?.events || [];
      todosEventos = todosEventos.concat(batch);
      if (batch.length < 250) temMais = false;
      else page++;
    }

    const exclusoesAtuais = new Set(lerExclusoes().map((e) => e.eventId));

    const eventosFormatados = todosEventos
      .sort((a, b) => a.created_at - b.created_at)
      .map((ev) => {
        const statusBefore = ev.value_before?.[0]?.lead_status;
        const statusAfter = ev.value_after?.[0]?.lead_status;
        const deId = String(statusBefore?.id ?? statusBefore?.name ?? "");
        const paraId = String(statusAfter?.id ?? statusAfter?.name ?? "");
        return {
          eventId: ev.id,
          data: new Date(ev.created_at * 1000).toISOString(),
          de: resolverNomeEtapa(deId),
          para: resolverNomeEtapa(paraId),
          jaExcluido: exclusoesAtuais.has(ev.id),
        };
      });

    res.json({ leadId, eventos: eventosFormatados });
  } catch (error) {
    res.status(500).json({ error: "Erro ao buscar eventos do lead.", detalhe: error.message });
  }
});

// Lista as exclusões ativas
app.get('/api/exclusoes', (req, res) => {
  res.json(lerExclusoes());
});

// Marca um evento como "ignorar no cálculo de métricas" (movimentação errada)
app.post('/api/excluir-evento', (req, res) => {
  const { eventId, motivo } = req.body;
  if (!eventId) return res.status(400).json({ error: "eventId é obrigatório." });

  const lista = lerExclusoes();
  if (!lista.some((e) => e.eventId === eventId)) {
    lista.push({ eventId, motivo: motivo || "Movimentação errada corrigida manualmente", criadoEm: new Date().toISOString() });
    salvarExclusoes(lista);
  }
  res.json({ ok: true, exclusoes: lista });
});

// Remove uma exclusão (caso queira reverter)
app.delete('/api/excluir-evento/:eventId', (req, res) => {
  const eventId = String(req.params.eventId);
  const lista = lerExclusoes().filter((e) => e.eventId !== eventId);
  salvarExclusoes(lista);
  res.json({ ok: true, exclusoes: lista });
});

app.get('/api/metrics', async (req, res) => {
  const inicio = req.query.inicio || req.query.startDate;
  const fim = req.query.fim || req.query.endDate;

  console.log("Datas recebidas no servidor:", { inicio, fim });

  if (!inicio || !fim) {
    return res.status(400).json({
      error: "Datas obrigatórias.",
      recebido: { inicio, fim }
    });
  }

  try {
    const fromTs = Math.floor(new Date(`${inicio}T00:00:00-03:00`).getTime() / 1000);
    const toTs = Math.floor(new Date(`${fim}T23:59:59-03:00`).getTime() / 1000);

    let leadsBrutos = [];
    let pageLeads = 1, temMaisLeads = true;

    while (temMaisLeads) {
      try {
        const responseLeads = await axios.get(`${KOMMO_URL}/leads`, {
          headers: HEADERS,
          params: { limit: 250, page: pageLeads, with: "contacts" }
        });
        const batchLeads = responseLeads.data?._embedded?.leads || [];
        leadsBrutos = leadsBrutos.concat(batchLeads);
        if (batchLeads.length < 250) temMaisLeads = false;
        else pageLeads++;
      } catch (err) {
        temMaisLeads = false;
      }
    }

    const idsContatosVinculados = leadsBrutos
      .map((lead) => lead._embedded?.contacts?.[0]?.id)
      .filter(Boolean);
    const contatosPorId = await buscarContatosPorIds(idsContatosVinculados);

    const leadsLimpos = higienizarEDeduplicarLeads(leadsBrutos, contatosPorId);
    const idsLeadsValidos = new Set(leadsLimpos.map((l) => l.id));
    const leadsLimposPorId = new Map(leadsLimpos.map((l) => [l.id, l]));

    let todosEventos = [];
    let pageEv = 1, temMaisEv = true;
    while (temMaisEv) {
      try {
        const r = await axios.get(`${KOMMO_URL}/events`, {
          headers: HEADERS,
          params: {
            "filter[entity]": "leads",
            "filter[type]": "lead_status_changed",
            "filter[created_at][from]": fromTs,
            "filter[created_at][to]": toTs,
            limit: 250,
            page: pageEv,
          },
        });
        const batch = r.data?._embedded?.events || [];
        todosEventos = todosEventos.concat(batch);
        if (batch.length < 250) temMaisEv = false;
        else pageEv++;
      } catch {
        temMaisEv = false;
      }
    }

    // Remove eventos marcados como "movimentação errada corrigida" antes de
    // calcular qualquer métrica — é assim que corrigimos a sujeira sem
    // precisar apagar nada no Kommo (o que não é possível).
    const idsEventosExcluidos = new Set(lerExclusoes().map((e) => e.eventId));
    if (idsEventosExcluidos.size > 0) {
      todosEventos = todosEventos.filter((ev) => !idsEventosExcluidos.has(ev.id));
    }

    // --- CONTADORES ---
    let totalAgendadasNoPeriodo = 0;
    let totalReagendamentosNoPeriodo = 0;
    let totalRealizadas = 0;
    let totalNoShowsNoPeriodo = 0;
    let totalReengajamentosNoPeriodo = 0;
    let totalContratosFechadosNoPeriodo = 0;

    // Contadores de conversão por par de etapas
    // Usamos Sets para contar LEADS ÚNICOS por par/origem, não eventos.
    // Isso evita inflar os totais quando um lead entra e sai da mesma etapa mais de uma vez no período.
    const conversoesPorParSets = {};
    const saidasPorEtapaSets = {};

    const eventosPorLead = {};
    todosEventos.forEach((ev) => {
      if (!idsLeadsValidos.has(ev.entity_id)) return;
      if (!eventosPorLead[ev.entity_id]) eventosPorLead[ev.entity_id] = [];
      eventosPorLead[ev.entity_id].push(ev);
    });

    const idsSucesso = ["103294216", "105105968", "103294220", "103294224"];
    const ultimoAgendamentoPorLead = {}; // leadId -> timestamp do agendamento mais recente no período

    Object.entries(eventosPorLead).forEach(([leadId, listaEvs]) => {
      listaEvs.sort((a, b) => a.created_at - b.created_at);
      let vezesQueEntrouEmMarcacao = 0;
      let agendamentosAbertosNoPeriodo = 0; // entradas em "Marcação de Reunião" vistas neste período que ainda não tiveram desfecho contado

      listaEvs.forEach((ev) => {
        // Extrai tanto o id quanto o name e resolve com o mapa robusto
        const statusBefore = ev.value_before?.[0]?.lead_status;
        const statusAfter  = ev.value_after?.[0]?.lead_status;
        const deOndeSaiu  = String(statusBefore?.id ?? statusBefore?.name ?? "");
        const paraOndeFoi = String(statusAfter?.id  ?? statusAfter?.name  ?? "");

        // Rastrear conversões entre pares de etapas
        const nomeOrigem  = resolverNomeEtapa(deOndeSaiu);
        const nomeDestino = resolverNomeEtapa(paraOndeFoi);
        const parChave = `${nomeOrigem}|||${nomeDestino}`;
        conversoesPorParSets[parChave] = conversoesPorParSets[parChave] || new Set();
        conversoesPorParSets[parChave].add(leadId);
        saidasPorEtapaSets[nomeOrigem] = saidasPorEtapaSets[nomeOrigem] || new Set();
        saidasPorEtapaSets[nomeOrigem].add(leadId);

        if (paraOndeFoi === "97353759" || ETAPAS_IDS[paraOndeFoi] === "MARCAÇÃO DE REUNIÃO") {
          totalAgendadasNoPeriodo++;
          vezesQueEntrouEmMarcacao++;
          agendamentosAbertosNoPeriodo++;
          ultimoAgendamentoPorLead[leadId] = ev.created_at;

          if (
            vezesQueEntrouEmMarcacao > 1 ||
            deOndeSaiu === "107297324" ||
            deOndeSaiu === "105108420" ||
            deOndeSaiu === "104878776"
          ) {
            totalReagendamentosNoPeriodo++;
          }

          if (deOndeSaiu === "105108420" || deOndeSaiu === "104878776") {
            totalReengajamentosNoPeriodo++;
          }
        }

        if (
          (deOndeSaiu === "97353759" || ETAPAS_IDS[deOndeSaiu] === "MARCAÇÃO DE REUNIÃO") &&
          (idsSucesso.includes(paraOndeFoi) || idsSucesso.map(id => ETAPAS_IDS[id]).includes(ETAPAS_IDS[paraOndeFoi]))
        ) {
          // Só conta como "realizada" se o agendamento correspondente também
          // foi visto dentro deste período — evita contar desfechos de
          // agendamentos antigos (fora do filtro) como se fossem do período.
          if (agendamentosAbertosNoPeriodo > 0) {
            totalRealizadas++;
            agendamentosAbertosNoPeriodo--;
          }
        }

        if (
          (deOndeSaiu === "97353759" || ETAPAS_IDS[deOndeSaiu] === "MARCAÇÃO DE REUNIÃO") &&
          paraOndeFoi === "107297324"
        ) {
          // Mesma lógica: só conta No Show se a entrada em "Marcação de
          // Reunião" também estiver dentro do período filtrado. Isso corrige
          // o bug em que leads antigos, ao caírem em No Show agora, inflavam
          // a taxa de absenteísmo sem terem sido contados como agendados.
          if (agendamentosAbertosNoPeriodo > 0) {
            totalNoShowsNoPeriodo++;
            agendamentosAbertosNoPeriodo--;
          }
        }

        if (paraOndeFoi === "103294224" || ETAPAS_IDS[paraOndeFoi] === "CONTRATO FECHADO") {
          totalContratosFechadosNoPeriodo++;
        }
      });
    });

    const divisor = totalAgendadasNoPeriodo || 1;
    const taxaAproveitamento = Math.round((totalRealizadas / divisor) * 100);
    const taxaNoShow = Math.round((totalNoShowsNoPeriodo / divisor) * 100);

    // --- REUNIÕES EM ABERTO (agendadas no período, ainda sem desfecho) ---
    // Um lead entra aqui se foi agendado dentro do período filtrado, mas no estado ATUAL
    // (consultado agora, na hora da chamada) ainda está parado em "MARCAÇÃO DE REUNIÃO" —
    // ou seja, ainda não foi marcado como No Show nem como realizada/sucesso.
    // Isso evita que reuniões muito recentes (ex.: agendadas pro fim do período) inflem
    // o denominador sem nunca aparecer no numerador, distorcendo a taxa de no-show pra baixo.
    const leadsReunioesEmAberto = [];
    Object.entries(ultimoAgendamentoPorLead).forEach(([leadId, tsAgendamento]) => {
      const lead = leadsLimposPorId.get(Number(leadId));
      if (lead && lead.etapa_atual === "MARCAÇÃO DE REUNIÃO") {
        leadsReunioesEmAberto.push({
          id: lead.id,
          name: lead.name,
          telefone: lead.telefone,
          dataAgendamento: new Date(tsAgendamento * 1000).toISOString(),
          diasDesdeAgendamento: Math.floor((Math.floor(Date.now() / 1000) - tsAgendamento) / 86400),
        });
      }
    });
    leadsReunioesEmAberto.sort((a, b) => new Date(b.dataAgendamento) - new Date(a.dataAgendamento));
    const totalReunioesEmAberto = leadsReunioesEmAberto.length;
    const percentualEmAberto = Math.round((totalReunioesEmAberto / divisor) * 100);

    // Taxa de conversão SDR→Contrato
    const taxaConversaoSDRContrato = totalAgendadasNoPeriodo > 0
      ? Math.round((totalContratosFechadosNoPeriodo / totalAgendadasNoPeriodo) * 100)
      : 0;

    const breakdownFunil = {};
    Object.values(ETAPAS_IDS).forEach((nome) => {
      breakdownFunil[nome] = leadsLimpos.filter(
        (l) => l.etapa_atual === nome,
      ).length;
    });

    // Leads sinalizados (sem nome ou sem telefone)
    const leadsSemDados = leadsLimpos.filter((l) => l.nomeSinalizado && l.etapa_atual !== "ETAPA DE ENTRADA").length;

    // Leads parados há mais de 7 dias (updated_at antigo)
    const agora = Math.floor(Date.now() / 1000);
    const seteDiasEmSegundos = 7 * 24 * 60 * 60;
    const leadsFrios = leadsLimpos.filter(
      (l) =>
        (agora - l.updated_at) > seteDiasEmSegundos &&
        !["CONTRATO FECHADO", "CLIENTE SEM INTERESSE", "CLIENTE FRIO", "ETAPA DE ENTRADA", "DESQUALIFICADOS"].includes(l.etapa_atual)
    );

    // Tempo médio parado por etapa (em dias), com base nos leads ativos
    const tempoMedioPorEtapa = {};
    Object.values(ETAPAS_IDS).forEach((nomeEtapa) => {
      const leadsNaEtapa = leadsLimpos.filter((l) => l.etapa_atual === nomeEtapa);
      if (leadsNaEtapa.length === 0) {
        tempoMedioPorEtapa[nomeEtapa] = null;
        return;
      }
      const somasDias = leadsNaEtapa.reduce((acc, l) => {
        return acc + (agora - l.updated_at) / 86400;
      }, 0);
      tempoMedioPorEtapa[nomeEtapa] = Math.round(somasDias / leadsNaEtapa.length);
    });

    // Ranking de tags
    const contagemTags = {};
    leadsLimpos.forEach((l) => {
      l.tags.forEach((tag) => {
        contagemTags[tag] = (contagemTags[tag] || 0) + 1;
      });
    });
    const rankingTags = Object.entries(contagemTags)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([tag, count]) => ({ tag, count }));

    // Converte os Sets de leads únicos em contagens
    const conversoesPorPar = {};
    Object.entries(conversoesPorParSets).forEach(([par, setLeads]) => {
      conversoesPorPar[par] = setLeads.size;
    });
    const saidasPorEtapa = {};
    Object.entries(saidasPorEtapaSets).forEach(([origem, setLeads]) => {
      saidasPorEtapa[origem] = setLeads.size;
    });

    // Taxas de conversão entre pares de etapas relevantes
    const taxasConversaoFunil = [];
    Object.entries(conversoesPorPar).forEach(([par, total]) => {
      const [origem, destino] = par.split("|||");
      const totalSaidas = saidasPorEtapa[origem] || 1;
      const taxa = Math.round((total / totalSaidas) * 100);
      taxasConversaoFunil.push({ origem, destino, total, taxa });
    });
    taxasConversaoFunil.sort((a, b) => b.total - a.total);

    // Card auxiliar: TODOS os destinos por etapa de origem (não só os mais frequentes do funil geral)
    // As taxas aqui somam ~100% por origem, já que usam o mesmo totalSaidas[origem] como base.
    const destinosPorEtapa = {};
    Object.entries(conversoesPorPar).forEach(([par, total]) => {
      const [origem, destino] = par.split("|||");
      if (origem === destino) return; // ignora "loop" sem mudança real de etapa
      const totalSaidas = saidasPorEtapa[origem] || 1;
      const taxa = Math.round((total / totalSaidas) * 100);
      if (!destinosPorEtapa[origem]) destinosPorEtapa[origem] = [];
      destinosPorEtapa[origem].push({ destino, total, taxa });
    });
    Object.values(destinosPorEtapa).forEach((lista) => lista.sort((a, b) => b.total - a.total));

    const leadsNoPeriodo = leadsLimpos.filter(
      (l) => l.updated_at >= fromTs && l.updated_at <= toTs,
    );

    res.json({
      summary: {
        realizadas: totalRealizadas,
        agendadasTotal: totalAgendadasNoPeriodo,
        reagendamentos: totalReagendamentosNoPeriodo,
        agendadasNovas: totalAgendadasNoPeriodo - totalReagendamentosNoPeriodo,
        totalNoShows: totalNoShowsNoPeriodo,
        totalReengajamentos: totalReengajamentosNoPeriodo,
        porcentagemAproveitamento: taxaAproveitamento,
        porcentagemNoShow: taxaNoShow,
        totalReunioesEmAberto,
        percentualEmAberto,
        dadosConsolidados: totalReunioesEmAberto === 0,
        contratosFechadosNoPeriodo: totalContratosFechadosNoPeriodo,
        // NOVOS - médio
        taxaConversaoSDRContrato,
        leadsSemDados,
        totalLeadsFriosAtivos: leadsFrios.length,
      },
      breakdownFunil,
      tempoMedioPorEtapa,
      rankingTags,
      taxasConversaoFunil: taxasConversaoFunil.slice(0, 10),
      destinosPorEtapa,
      saidasPorEtapa,
      leadsReunioesEmAberto,
      leadsFriosAtivos: leadsFrios.map(l => ({
        id: l.id,
        name: l.name,
        telefone: l.telefone,
        etapa_atual: l.etapa_atual,
        diasParado: Math.floor((agora - l.updated_at) / 86400),
      })),
      listagem: leadsNoPeriodo.slice(0, 100),
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Falha na análise histórica de eventos." });
  }
});

app.get('/', (req, res) => {
  res.send('Servidor Ativo - Hub Comercial RM Advogados');
});

app.listen(PORT, () =>
  console.log(`🚀 Servidor Robson Menezes Advogados ativo na porta ${PORT}`),
);
