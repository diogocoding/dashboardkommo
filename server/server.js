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

// Mapeamento baseado nos IDs REAIS extraídos do seu CRM
const ETAPAS_IDS = {
  "97353759": "MARCAÇÃO DE REUNIÃO", 
  "103294216": "protocolo farmer", 
  "105105968": "protocolo farmer - ADIPLENTE",
  "103294220": "CLIENTE QUENTE",
  "103294224": "CONTRATO FECHADO",
  "103294212": "LEADS QUALIFICADOS",
  "103294208": "QUALIFICAÇÃO",
  "107297324": "NO SHOW",
  "104878776": "CLIENTE SEM INTERESSE",
  "105108420": "CLIENTE FRIO"
};

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

    // --- CONTADORES PARA AS MÉTRICAS DE EFICIÊNCIA ---
    let totalAgendadasNoPeriodo = 0;
    let totalReagendamentosNoPeriodo = 0;
    let totalRealizadas = 0;
    let totalNoShowsNoPeriodo = 0;
    let totalReengajamentosNoPeriodo = 0;

    const eventosPorLead = {};
    todosEventos.forEach((ev) => {
      if (!idsLeadsValidos.has(ev.entity_id)) return;
      if (!eventosPorLead[ev.entity_id]) eventosPorLead[ev.entity_id] = [];
      eventosPorLead[ev.entity_id].push(ev);
    });

    const idsSucesso = ["103294216", "105105968", "103294220", "103294224"]; 

    Object.entries(eventosPorLead).forEach(([leadId, listaEvs]) => {
      listaEvs.sort((a, b) => a.created_at - b.created_at);
      let vezesQueEntrouEmMarcacao = 0;

      listaEvs.forEach((ev) => {
        const deOndeSaiu = String(ev.value_before?.[0]?.lead_status?.id || ev.value_before?.[0]?.lead_status?.name);
        const paraOndeFoi = String(ev.value_after?.[0]?.lead_status?.id || ev.value_after?.[0]?.lead_status?.name);

        if (paraOndeFoi === "97353759" || ETAPAS_IDS[paraOndeFoi] === "MARCAÇÃO DE REUNIÃO") {
          totalAgendadasNoPeriodo++;
          vezesQueEntrouEmMarcacao++;

          if (
            vezesQueEntrouEmMarcacao > 1 ||
            deOndeSaiu === "107297324" || // ID do No Show
            deOndeSaiu === "105108420" || // ID do Cliente Frio
            deOndeSaiu === "104878776"    // ID do Sem Interesse
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
      });
    });

    const divisor = totalAgendadasNoPeriodo || 1;
    const taxaAproveitamento = Math.round((totalRealizadas / divisor) * 100);
    const taxaNoShow = Math.round((totalNoShowsNoPeriodo / divisor) * 100);

    const breakdownFunil = {};
    Object.values(ETAPAS_IDS).forEach((nome) => {
      breakdownFunil[nome] = leadsLimpos.filter(
        (l) => l.etapa_atual === nome,
      ).length;
    });

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
        porcentagemNoShow: taxaNoShow
      },
      breakdownFunil,
      listagem: leadsNoPeriodo.slice(0, 50),
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
