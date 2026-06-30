import express from "express";
import cors from "cors";
import axios from "axios";
import dotenv from "dotenv";

dotenv.config();

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

function higienizarEDeduplicarLeads(leadsBrutos) {
  const leadsFormatados = leadsBrutos.map((lead) => {
    let telefoneBruto =
      lead.custom_fields_values?.find(
        (f) =>
          f.field_code === "PHONE" ||
          f.field_name?.toLowerCase().includes("telefone"),
      )?.values[0]?.value || "";
    const telefoneLimpo = String(telefoneBruto).replace(/[^0-9]/g, "");

    let nomeCompleto = lead.name ? lead.name.trim() : "";
    let nomeSinalizado = false;
    if (
      !nomeCompleto ||
      nomeCompleto === telefoneLimpo ||
      /^\d+$/.test(nomeCompleto.replace(/[^0-9]/g, ""))
    ) {
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

app.get('/api/descobrir-ids', async (req, res) => {
  try {
    const r = await axios.get(`${KOMMO_URL}/leads/pipelines`, { headers: HEADERS });
    res.json(r.data?._embedded?.pipelines || r.data);
  } catch (error) {
    res.status(500).json({ error: "Erro ao buscar pipelines do Kommo." });
  }
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
          params: { limit: 250, page: pageLeads }
        });
        const batchLeads = responseLeads.data?._embedded?.leads || [];
        leadsBrutos = leadsBrutos.concat(batchLeads);
        if (batchLeads.length < 250) temMaisLeads = false;
        else pageLeads++;
      } catch (err) {
        temMaisLeads = false;
      }
    }

    const leadsLimpos = higienizarEDeduplicarLeads(leadsBrutos);
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
          totalRealizadas++;
        }

        if (
          (deOndeSaiu === "97353759" || ETAPAS_IDS[deOndeSaiu] === "MARCAÇÃO DE REUNIÃO") &&
          paraOndeFoi === "107297324"
        ) {
          totalNoShowsNoPeriodo++;
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
