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

const ETAPAS = {
  MARCACAO: "MARCAÇÃO DE REUNIÃO",
  FARMER: "protocolo farmer",
  FARMER_ADI: "protocolo farmer - ADIPLENTE",
  QUENTE: "CLIENTE QUENTE",
  FECHADO: "CONTRATO FECHADO",
  QUALIFICADOS: "LEADS QUALIFICADOS",
  QUALIFICACAO: "QUALIFICAÇÃO",
  NOSHOW: "NO SHOW",
  SEM_INTERESSE: "CLIENTE SEM INTERESSE",
  FRIO: "CLIENTE FRIO",
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

    return {
      id: Number(lead.id),
      name: nomeCompleto,
      telefone: telefoneLimpo,
      etapa_atual: lead.status_name || String(lead.status_id),
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

// ROTA DE SUPORTE: Caso precise ler os IDs novamente amanhã
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
    // CORREÇÃO 1: Criação dos timestamps Unix (segundos) esperados pelo Kommo
    const fromTs = Math.floor(new Date(`${inicio}T00:00:00`).getTime() / 1000);
    const toTs = Math.floor(new Date(`${fim}T23:59:59`).getTime() / 1000);

    // CORREÇÃO 2: Puxar os leads brutos reais do Kommo antes de higienizar
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

    // 2. Puxar Todos os Eventos do Período
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

    // ── ENGENHARIA CRONOLÓGICA DE AGENDAMENTOS ──
    let totalAgendadasNoPeriodo = 0;
    let totalReagendamentosNoPeriodo = 0;
    let totalRealizadas = 0;

    const eventosPorLead = {};
    todosEventos.forEach((ev) => {
      if (!idsLeadsValidos.has(ev.entity_id)) return;
      if (!eventosPorLead[ev.entity_id]) eventosPorLead[ev.entity_id] = [];
      eventosPorLead[ev.entity_id].push(ev);
    });

    const etapasSucesso = [
      ETAPAS.FARMER,
      ETAPAS.FARMER_ADI,
      ETAPAS.QUENTE,
      ETAPAS.FECHADO,
    ];

    Object.entries(eventosPorLead).forEach(([leadId, listaEvs]) => {
      listaEvs.sort((a, b) => a.created_at - b.created_at);
      let vezesQueEntrouEmMarcacao = 0;

      listaEvs.forEach((ev) => {
        const deOndeSaiu = ev.value_before?.[0]?.lead_status?.name;
        const paraOndeFoi = ev.value_after?.[0]?.lead_status?.name;

        if (paraOndeFoi === ETAPAS.MARCACAO) {
          totalAgendadasNoPeriodo++;
          vezesQueEntrouEmMarcacao++;

          if (
            vezesQueEntrouEmMarcacao > 1 ||
            deOndeSaiu === ETAPAS.NOSHOW ||
            deOndeSaiu === ETAPAS.FRIO ||
            deOndeSaiu === ETAPAS.SEM_INTERESSE
          ) {
            totalReagendamentosNoPeriodo++;
          }
        }

        if (
          deOndeSaiu === ETAPAS.MARCACAO &&
          etapasSucesso.includes(paraOndeFoi)
        ) {
          totalRealizadas++;
        }
      });
    });

    const breakdownFunil = {};
    Object.values(ETAPAS).forEach((nome) => {
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
