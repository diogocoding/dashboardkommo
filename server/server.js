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

app.get("/api/metrics", async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    if (!startDate || !endDate)
      return res.status(400).json({ error: "Datas obrigatórias." });

    const fromTs = Math.floor(
      new Date(`${startDate}T00:00:00`).getTime() / 1000,
    );
    const toTs = Math.floor(new Date(`${endDate}T23:59:59`).getTime() / 1000);

    // 1. Puxar Leads
    let leadsBrutos = [];
    let page = 1,
      temMais = true;
    while (temMais) {
      try {
        const r = await axios.get(`${KOMMO_URL}/leads`, {
          headers: HEADERS,
          params: { limit: 250, page, with: "contacts,tags" },
        });
        const batch = r.data?._embedded?.leads || [];
        leadsBrutos = leadsBrutos.concat(batch);
        if (batch.length < 250) temMais = false;
        else page++;
      } catch {
        temMais = false;
      }
    }

    const leadsLimpos = higienizarEDeduplicarLeads(leadsBrutos);
    const idsLeadsValidos = new Set(leadsLimpos.map((l) => l.id));

    // 2. Puxar Todos os Eventos do Período
    let todosEventos = [];
    let pageEv = 1,
      temMaisEv = true;
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

    // ── NOVA ENGENHARIA CRONOLÓGICA DE AGENDAMENTOS ──
    let totalAgendadasNoPeriodo = 0;
    let totalReagendamentosNoPeriodo = 0;
    let totalRealizadas = 0;

    // Agrupar eventos por lead
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
      // Ordena cronologicamente os passos do cliente no período
      listaEvs.sort((a, b) => a.created_at - b.created_at);

      let vezesQueEntrouEmMarcacao = 0;

      listaEvs.forEach((ev) => {
        const deOndeSaiu = ev.value_before?.[0]?.lead_status?.name;
        const paraOndeFoi = ev.value_after?.[0]?.lead_status?.name;

        // Se o destino do movimento no período filtrado for a Marcação de Reunião
        if (paraOndeFoi === ETAPAS.MARCACAO) {
          totalAgendadasNoPeriodo++;
          vezesQueEntrouEmMarcacao++;

          // NOVA LÓGICA DE CORTE: Se ele entrou na coluna de marcação vindo de qualquer etapa que NÃO
          // seja o fluxo inicial básico (como qualificação/entrada), ou se já é a segunda vez dele na coluna, é Reagendamento.
          if (
            vezesQueEntrouEmMarcacao > 1 ||
            deOndeSaiu === ETAPAS.NOSHOW ||
            deOndeSaiu === ETAPAS.FRIO ||
            deOndeSaiu === ETAPAS.SEM_INTERESSE
          ) {
            totalReagendamentosNoPeriodo++;
          }
        }

        // Se ele saiu de marcação e foi para o sucesso dentro do período filtrado
        if (
          deOndeSaiu === ETAPAS.MARCACAO &&
          etapasSucesso.includes(paraOndeFoi)
        ) {
          totalRealizadas++;
        }
      });
    });

    // Contagem da foto atual de Leads por Etapa (Garante a listagem completa pedida)
    const breakdownFunil = {};
    Object.values(ETAPAS).forEach((nome) => {
      breakdownFunil[nome] = leadsLimpos.filter(
        (l) => l.etapa_atual === nome,
      ).length;
    });

    // Filtro temporal para a amostragem na interface
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
