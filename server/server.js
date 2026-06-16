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
        const batchLeads = responseLeads.
