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

// CORREÇÃO 1: Mapeamento baseado nos IDs reais que o Kommo retorna nativamente
// Substitua os números abaixo pelos IDs reais equivalentes de cada coluna se notar divergências
const ETAPAS_IDS = {
  "97353759": "MARCAÇÃO DE REUNIÃO", // O ID exato que você extraiu do funil
  "142": "protocolo farmer", 
  "143": "protocolo farmer - ADIPLENTE",
  "144": "CLIENTE QUENTE",
  "145": "CONTRATO FECHADO",
  "146": "LEADS QUALIFICADOS",
  "147": "QUALIFICAÇÃO",
  "148": "NO SHOW",
  "149": "CLIENTE SEM INTERESSE",
  "150": "CLIENTE FRIO"
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

    // Vincula o ID da etapa ao Nome Amigável usando o nosso mapa de IDs
    const idStatusString = String(lead.status_id);
    const nomeEtapaResolvido = ETAPAS_IDS[idStatusString] || `Status ID: ${idStatusString}`;

    return {
      id: Number(lead.id),
      name: nomeCompleto,
      telefone: telefoneLimpo,
      etapa_atual: nomeEtapaResolvido, // Agora vira string correspondente
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

    // ── LOGICA CRONOLÓGICA ADAPTADA PARA IDS DA API ──
    let totalAgendadasNoPeriodo = 0;
    let totalReagendamentosNoPeriodo = 0;
    let totalRealizadas = 0;

    const eventosPorLead = {};
    todosEventos.forEach((ev) => {
      if (!idsLeadsValidos.has(ev.entity_id)) return;
      if (!eventosPorLead[ev.entity_id]) eventosPorLead[ev.entity_id] = [];
      eventosPorLead[ev.entity_id].push(ev);
    });

    // Mapeamento das chaves de sucesso por ID (Strings correspondentes)
    const idsSucesso = ["142", "143", "144", "145"]; // IDs do Farmer, Quente e Fechado

    Object.entries(eventosPorLead).forEach(([leadId, listaEvs]) => {
      listaEvs.sort((a, b) => a.created_at - b.created_at);
      let vezesQueEntrouEmMarcacao = 0;

      listaEvs.forEach((ev) => {
        // A API do Kommo entrega a alteração estruturada no objeto value_after/value_before pelo status_id puro
        const deOndeSaiu = String(ev.value_before?.[0]?.lead_status?.id || ev.value_before?.[0]?.lead_status?.name);
        const paraOndeFoi = String(ev.value_after?.[0]?.lead_status?.id || ev.value_after?.[0]?.lead_status?.name);

        if (paraOndeFoi === "97353759" || ETAPAS_IDS[paraOndeFoi] === "MARCAÇÃO DE REUNIÃO") {
          totalAgendadasNoPeriodo++;
          vezesQueEntrouEmMarcacao++;

          if (
            vezesQueEntrouEmMarcacao > 1 ||
            deOndeSaiu === "148" || // ID do No Show
            deOndeSaiu === "150" || // ID do Cliente Frio
            deOndeSaiu === "149"    // ID do Sem Interesse
          ) {
            totalReagendamentosNoPeriodo++;
          }
        }

        if (
          (deOndeSaiu === "97353759" || ETAPAS_IDS[deOndeSaiu] === "MARCAÇÃO DE REUNIÃO") &&
          (idsSucesso.includes(paraOndeFoi) || idsSucesso.map(id => ETAPAS_IDS[id]).includes(ETAPAS_IDS[paraOndeFoi]))
        ) {
          totalRealizadas++;
        }
      });
    });

    // Estruturação do breakdown para o Front
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
      },
      breakdownFunil,
      listagem: leadsNoPeriodo.slice(0, 50),
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Falha na análise histórica de eventos." });
  }
});

app.listen(PORT, () =>
  console.log(`🚀 Servidor Robson Menezes Advogados ativo na porta ${PORT}`),
);
