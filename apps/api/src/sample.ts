// "Apertura de cuenta" — the default onboarding flow for Banco del Futuro.
// A customer submits their data; a real KYC/AML AI agent (Claude, tool-calling
// an AML screening tool) decides auto-open vs a compliance review; then the
// account is opened.
//
//  Inicio → [Datos del cliente] → (Verificación KYC · IA) → <¿Aprobado?>
//              userTask + form        serviceTask (agent)      gateway
//                                                           /          \
//                                       decision==review   /            \ default
//                                                         v              v
//                                          [Revisión de cumplimiento]  (Abrir cuenta)
//                                              userTask (staff)          serviceTask
//                                                   |                        |
//                                        <¿Decisión?> → Abrir / Rechazado    v
//                                                                       Cuenta abierta

import type { FormDefinition, ProcessDefinition } from "@cassiopeia/model";
import type { ConnectorRow } from "./db.js";
import { saveConnector, saveDefinition, saveForm } from "./db.js";

export const ONBOARDING: ProcessDefinition = {
  id: "onboarding",
  name: "Apertura de cuenta",
  version: 1,
  status: "published",
  startNodeId: "start",
  nodes: [
    { id: "start", type: "start" },
    { id: "datos", type: "userTask", name: "Datos del cliente", formId: "apertura-form" },
    { id: "kyc", type: "serviceTask", name: "Verificación KYC (IA)", connectorId: "kyc-agent", retries: 1, retryDelayMs: 200 },
    { id: "gwRisk", type: "gateway", name: "¿Aprobado?", branches: [{ edgeId: "e_review", when: "decision == 'review'" }], defaultEdgeId: "e_open" },
    { id: "revision", type: "userTask", name: "Revisión de cumplimiento", formId: "apertura-review", candidateRole: "cumplimiento", priority: "high", slaHours: 24 },
    { id: "gwRev", type: "gateway", name: "¿Decisión?", branches: [{ edgeId: "e_rev_open", when: "complianceDecision == 'approve'" }], defaultEdgeId: "e_rev_rej" },
    { id: "abrir", type: "serviceTask", name: "Abrir cuenta", connectorId: "create-account", inputMap: { legalName: "fullName" } },
    { id: "endOpen", type: "end", name: "Cuenta abierta" },
    { id: "endRej", type: "end", name: "Rechazado" },
  ],
  edges: [
    { id: "e0", from: "start", to: "datos" },
    { id: "e1", from: "datos", to: "kyc" },
    { id: "e2", from: "kyc", to: "gwRisk" },
    { id: "e_review", from: "gwRisk", to: "revision" },
    { id: "e_open", from: "gwRisk", to: "abrir" },
    { id: "e_rev", from: "revision", to: "gwRev" },
    { id: "e_rev_open", from: "gwRev", to: "abrir" },
    { id: "e_rev_rej", from: "gwRev", to: "endRej" },
    { id: "e_abrir_end", from: "abrir", to: "endOpen" },
  ],
  layout: {
    start: { x: 40, y: 220 }, datos: { x: 180, y: 220 }, kyc: { x: 350, y: 220 }, gwRisk: { x: 540, y: 220 },
    revision: { x: 700, y: 360 }, gwRev: { x: 890, y: 360 }, abrir: { x: 720, y: 120 }, endOpen: { x: 920, y: 120 }, endRej: { x: 1080, y: 360 },
  },
};

export const ONBOARDING_FORM: FormDefinition = {
  id: "apertura-form",
  version: 1,
  title: "Apertura de cuenta",
  fields: [
    { kind: "text", id: "f_name", bind: "fullName", label: "Nombre y apellido", required: true },
    { kind: "email", id: "f_email", bind: "email", label: "Email", required: true },
    { kind: "text", id: "f_doc", bind: "document", label: "Documento (DNI/CUIT)", required: true },
    { kind: "number", id: "f_income", bind: "monthlyIncome", label: "Ingreso mensual (USD)", required: true, min: 0 },
    { kind: "select", id: "f_type", bind: "clientType", label: "Tipo de cliente", required: true, options: [
      { label: "Persona física", value: "persona" }, { label: "Empresa", value: "empresa" }] },
  ],
};

export const MANUAL_REVIEW_FORM: FormDefinition = {
  id: "apertura-review",
  version: 1,
  title: "Revisión de cumplimiento",
  fields: [
    { kind: "computed", id: "r_risk", bind: "amlRiskShown", label: "Riesgo AML del solicitante", expr: "amlRisk" },
    { kind: "select", id: "r_decision", bind: "complianceDecision", label: "Decisión", required: true, options: [
      { label: "Aprobar", value: "approve" }, { label: "Rechazar", value: "reject" }] },
    { kind: "text", id: "r_notes", bind: "complianceNotes", label: "Motivo del rechazo", visibleIf: "complianceDecision == 'reject'" },
  ],
};

// The KYC/AML agent (real ai-agent, tool-calling the AML screening tool) and its
// tool. Installed key-less; the platform key is copied in at seed (server.ts).
export const ONBOARDING_CONNECTORS: ConnectorRow[] = [
  { id: "create-account", type: "mock-create-account", config: {} },
  { id: "mock-aml", type: "mock-aml", config: {} },
  {
    id: "kyc-agent",
    type: "ai-agent",
    config: {
      baseUrl: "https://api.anthropic.com/v1",
      model: "claude-haiku-4-5-20251001",
      apiKey: "",
      jsonOutput: true,
      instructions:
        "Sos un analista de KYC y prevención de lavado de un banco. Primero llamá a la herramienta aml_screening con el nombre del solicitante (fullName) para obtener su perfil de riesgo (listas, PEP, sanciones). Después decidí. Respondé SOLO con un objeto JSON: {\"amlRisk\": <número 0..1 del screening>, \"decision\": \"approve\" o \"review\", \"reasoning\": \"<una frase corta EN ESPAÑOL>\"}. Mandá a review (decision=\"review\") si amlRisk supera 0.6 o si hay un hit en listas/PEP/sanciones.",
      requiredKeys: ["amlRisk", "decision"],
      tools: [{
        name: "aml_screening",
        description: "Screen the applicant against AML watchlists, PEP and sanctions lists",
        connector: "mock-aml",
        parameters: { type: "object", properties: { fullName: { type: "string" } }, required: ["fullName"] },
      }],
    },
  },
];

export function seedSample(): void {
  saveDefinition(ONBOARDING);
  saveForm(ONBOARDING_FORM);
  saveForm(MANUAL_REVIEW_FORM);
  // The LLM used for ✦ Describe / ✦ Build with AI / the AI analyst. The user
  // sets the API key (and can change the model) in Settings → Modelo de IA.
  saveConnector({
    id: "describer",
    type: "ai-agent",
    config: { baseUrl: "https://api.anthropic.com/v1", model: "claude-haiku-4-5-20251001", apiKey: "", jsonOutput: false },
  });
  for (const c of ONBOARDING_CONNECTORS) saveConnector(c);
}
