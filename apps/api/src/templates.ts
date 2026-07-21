// Workflow templates — the ready-made "Banco del Futuro" products. Each bundles
// a process definition (with layout), its forms, and its agents/connectors, plus
// "teaches"/"steps" docs shown in the gallery. Every product has a real AI agent
// (Claude, tool-calling) for its decision step; agents are installed key-less and
// inherit the platform key at seed. Forms/agents are reusable across flows.

import type { ConnectorRow } from "./db.js";
import type { FormDefinition, ProcessDefinition } from "@cassiopeia/model";
import { getDefinition, maxPublishedVersion, saveConnector, saveDefinition, saveForm } from "./db.js";
import { ONBOARDING, ONBOARDING_FORM, MANUAL_REVIEW_FORM, ONBOARDING_CONNECTORS } from "./sample.js";

export interface Template {
  id: string;
  name: string;
  description: string;
  teaches: string[];
  steps: string[];
  definition: ProcessDefinition;
  forms: FormDefinition[];
  connectors: ConnectorRow[];
}

const ANTHROPIC = "https://api.anthropic.com/v1";
const MODEL = "claude-haiku-4-5-20251001";

// ---- shared agents (reusable across flows) --------------------------------

// Credit scoring analyst — used by BOTH the loan pre-approval and the personal
// credit flows. Calls the credit_bureau tool, then decides.
const CREDIT_AGENT: ConnectorRow = {
  id: "credit-agent",
  type: "ai-agent",
  config: {
    baseUrl: ANTHROPIC, model: MODEL, apiKey: "", jsonOutput: true,
    instructions:
      "Sos un analista de riesgo crediticio de un banco. Primero llamá a la herramienta credit_bureau con el annualIncome y el amount del solicitante para obtener su perfil crediticio. Después decidí. Respondé SOLO con un objeto JSON: {\"creditScore\": <el número del buró>, \"decision\": \"approved\" o \"review\", \"reasoning\": \"<una frase corta EN ESPAÑOL>\", \"confidence\": <0..1>}.",
    requiredKeys: ["creditScore", "decision"],
    tools: [{
      name: "credit_bureau",
      description: "Retrieve the applicant's credit score and repayment decision from the credit bureau",
      connector: "mock-credit-score",
      parameters: { type: "object", properties: { annualIncome: { type: "number" }, amount: { type: "number" } }, required: ["annualIncome", "amount"] },
    }],
  },
};

const MORTGAGE_AGENT: ConnectorRow = {
  id: "mortgage-agent",
  type: "ai-agent",
  config: {
    baseUrl: ANTHROPIC, model: MODEL, apiKey: "", jsonOutput: true,
    instructions:
      "Sos un asesor hipotecario de un banco. Primero llamá a la herramienta mortgage_calc con propertyValue, downPayment, termYears y annualIncome para obtener la cuota mensual (monthlyPayment) y el ratio de endeudamiento (dti). Después decidí. Respondé SOLO con un objeto JSON: {\"monthlyPayment\": <número>, \"dti\": <número>, \"decision\": \"approved\" o \"declined\", \"reasoning\": \"<una frase corta EN ESPAÑOL>\"}. Aprobá cuando el dti sea menor o igual a 0.35.",
    requiredKeys: ["decision", "monthlyPayment"],
    tools: [{
      name: "mortgage_calc",
      description: "Compute the monthly payment and debt-to-income ratio for the mortgage",
      connector: "mock-mortgage",
      parameters: { type: "object", properties: { propertyValue: { type: "number" }, downPayment: { type: "number" }, termYears: { type: "number" }, annualIncome: { type: "number" } }, required: ["propertyValue", "termYears", "annualIncome"] },
    }],
  },
};

// Fraud analyst — assesses the travel notice risk (no side effects). A separate
// deterministic service task does the actual registration.
const FRAUD_AGENT: ConnectorRow = {
  id: "fraud-agent",
  type: "ai-agent",
  config: {
    baseUrl: ANTHROPIC, model: MODEL, apiKey: "", jsonOutput: true,
    instructions:
      "Sos un analista de fraude de tarjetas de un banco. El cliente avisa un viaje (países y fechas). Evaluá el riesgo de fraude del aviso (destinos inusuales, fechas incoherentes, etc.). Respondé SOLO con un objeto JSON: {\"riskLevel\": \"bajo\" | \"medio\" | \"alto\", \"reasoning\": \"<una frase corta EN ESPAÑOL>\"}.",
    requiredKeys: ["riskLevel"],
  },
};

const MOCK_CREDIT: ConnectorRow = { id: "mock-credit-score", type: "mock-credit-score", config: {} };
const MOCK_MORTGAGE: ConnectorRow = { id: "mock-mortgage", type: "mock-mortgage", config: {} };
const MOCK_TRAVEL: ConnectorRow = { id: "travel-register", type: "mock-travel-register", config: {} };

// ---------- 1. Apertura de cuenta (onboarding, defined in sample.ts) ----------
const onboarding: Template = {
  id: "onboarding",
  name: "Apertura de cuenta",
  description:
    "El cliente abre una cuenta: carga sus datos, un agente de IA hace la verificación KYC/AML (consultando listas de riesgo) y decide abrir la cuenta al instante o derivar a cumplimiento. Los casos limpios se abren solos.",
  teaches: [
    "Un agente KYC/AML real (Claude) con tool-calling a un screening de listas",
    "Un gateway que enruta según la decisión del agente (approve / review)",
    "Una tarea humana de cumplimiento (área: cumplimiento) para los casos marcados",
    "Un servicio automático que abre la cuenta al final",
  ],
  steps: [
    "Datos del cliente recolecta nombre, documento, ingreso y tipo de cliente.",
    "Verificación KYC (IA) llama a aml_screening, evalúa el riesgo y devuelve {amlRisk, decision, reasoning}.",
    "¿Aprobado? manda decision=='review' a Revisión de cumplimiento; el resto a Abrir cuenta.",
    "Revisión de cumplimiento (prioridad alta, SLA 24h) aprueba → Abrir cuenta, o rechaza → Rechazado.",
    "Abrir cuenta genera el número de cuenta y termina en Cuenta abierta.",
  ],
  definition: ONBOARDING,
  forms: [ONBOARDING_FORM, MANUAL_REVIEW_FORM],
  connectors: ONBOARDING_CONNECTORS,
};

// ---------- 2. Solicitud de hipoteca ----------
const hipotecaForm: FormDefinition = {
  id: "hipoteca-form", version: 1, title: "Solicitud de hipoteca",
  fields: [
    { kind: "text", id: "h_name", bind: "fullName", label: "Nombre y apellido", required: true },
    { kind: "email", id: "h_email", bind: "email", label: "Email", required: true },
    { kind: "number", id: "h_price", bind: "propertyValue", label: "Valor de la propiedad (USD)", required: true, min: 0 },
    { kind: "number", id: "h_down", bind: "downPayment", label: "Anticipo (USD)", required: true, min: 0 },
    { kind: "number", id: "h_term", bind: "termYears", label: "Plazo (años)", required: true, min: 1, max: 40, defaultValue: 20 },
    { kind: "number", id: "h_income", bind: "annualIncome", label: "Ingreso anual (USD)", required: true, min: 0 },
  ],
};
const hipotecaOffer: FormDefinition = {
  id: "hipoteca-oferta", version: 1, title: "Tu oferta de hipoteca",
  fields: [
    { kind: "computed", id: "ho_pay", bind: "monthlyPaymentShown", label: "Cuota mensual estimada (USD)", expr: "monthlyPayment" },
    { kind: "computed", id: "ho_dti", bind: "dtiShown", label: "Ratio de endeudamiento", expr: "dti" },
    { kind: "checkbox", id: "ho_ok", bind: "accepted", label: "Acepto las condiciones de la hipoteca", required: true },
  ],
};
const mortgage: Template = {
  id: "mortgage-sim",
  name: "Solicitud de hipoteca",
  description:
    "El cliente pide una hipoteca: carga la propiedad y sus ingresos, un agente de IA calcula la cuota y el ratio de endeudamiento y aprueba o rechaza. Si aprueba, presenta la oferta para aceptar.",
  teaches: [
    "Un agente de IA (Claude) que calcula la cuota con una herramienta y juzga la accesibilidad",
    "Un gateway que enruta según la decisión del agente (approved / declined)",
    "Una oferta con campos calculados (cuota, dti) que el cliente acepta",
  ],
  steps: [
    "Datos de la propiedad captura valor, anticipo, plazo e ingreso.",
    "Análisis de capacidad (IA) llama a mortgage_calc y devuelve {monthlyPayment, dti, decision}.",
    "¿Aprobado? manda approved a Tu oferta; el resto a Rechazado.",
    "Tu oferta muestra la cuota y toma la aceptación del cliente; termina en Aprobado o Rechazado.",
  ],
  forms: [hipotecaForm, hipotecaOffer],
  connectors: [MORTGAGE_AGENT, MOCK_MORTGAGE],
  definition: {
    id: "mortgage-sim", name: "Solicitud de hipoteca", version: 1, status: "published", startNodeId: "start",
    nodes: [
      { id: "start", type: "start" },
      { id: "datos", type: "userTask", name: "Datos de la propiedad", formId: "hipoteca-form" },
      { id: "analisis", type: "serviceTask", name: "Análisis de capacidad (IA)", connectorId: "mortgage-agent", inputMap: { propertyValue: "propertyValue", downPayment: "downPayment", termYears: "termYears", annualIncome: "annualIncome" }, retries: 1, retryDelayMs: 200 },
      { id: "gw", type: "gateway", name: "¿Aprobado?", branches: [{ edgeId: "e_ok", when: "decision == 'approved'" }], defaultEdgeId: "e_no" },
      { id: "offer", type: "userTask", name: "Tu oferta", formId: "hipoteca-oferta" },
      { id: "gwSign", type: "gateway", name: "¿Aceptás?", branches: [{ edgeId: "e_acc", when: "accepted == true" }], defaultEdgeId: "e_dec" },
      { id: "endOk", type: "end", name: "Aprobado" },
      { id: "endNo", type: "end", name: "Rechazado" },
    ],
    edges: [
      { id: "e0", from: "start", to: "datos" },
      { id: "e1", from: "datos", to: "analisis" },
      { id: "e2", from: "analisis", to: "gw" },
      { id: "e_ok", from: "gw", to: "offer" },
      { id: "e_no", from: "gw", to: "endNo" },
      { id: "e3", from: "offer", to: "gwSign" },
      { id: "e_acc", from: "gwSign", to: "endOk" },
      { id: "e_dec", from: "gwSign", to: "endNo" },
    ],
    layout: {
      start: { x: 40, y: 200 }, datos: { x: 180, y: 200 }, analisis: { x: 360, y: 200 }, gw: { x: 560, y: 200 },
      offer: { x: 730, y: 110 }, gwSign: { x: 910, y: 110 }, endOk: { x: 1090, y: 110 }, endNo: { x: 730, y: 320 },
    },
  },
};

// ---------- 3. Solicitud de crédito personal (reuses credit-agent) ----------
const creditoForm: FormDefinition = {
  id: "credito-form", version: 1, title: "Solicitud de crédito personal",
  fields: [
    { kind: "text", id: "c_name", bind: "fullName", label: "Nombre y apellido", required: true },
    { kind: "email", id: "c_email", bind: "email", label: "Email", required: true },
    { kind: "number", id: "c_amount", bind: "amount", label: "Monto solicitado (USD)", required: true, min: 1000 },
    { kind: "number", id: "c_income", bind: "annualIncome", label: "Ingreso anual (USD)", required: true, min: 0 },
    { kind: "select", id: "c_purpose", bind: "purpose", label: "Destino del crédito", required: true, options: [
      { label: "Refacción del hogar", value: "hogar" }, { label: "Vehículo", value: "vehiculo" },
      { label: "Unificación de deudas", value: "deudas" }, { label: "Otro", value: "otro" }] },
  ],
};
const creditoSign: FormDefinition = {
  id: "credito-firma", version: 1, title: "Firmá tu crédito",
  fields: [
    { kind: "computed", id: "cs_score", bind: "scoreShown", label: "Tu score crediticio", expr: "creditScore" },
    { kind: "checkbox", id: "cs_ok", bind: "agreed", label: "Acepto las condiciones del crédito", required: true },
  ],
};
const creditoReview: FormDefinition = {
  id: "credito-review", version: 1, title: "Análisis manual de crédito",
  fields: [
    { kind: "computed", id: "cr_score", bind: "scoreShown", label: "Score del solicitante", expr: "creditScore" },
    { kind: "select", id: "cr_dec", bind: "underwriterDecision", label: "Decisión", required: true, options: [
      { label: "Aprobar", value: "approve" }, { label: "Rechazar", value: "reject" }] },
    { kind: "text", id: "cr_notes", bind: "notes", label: "Notas" },
  ],
};
const credit: Template = {
  id: "personal-credit",
  name: "Solicitud de crédito personal",
  description:
    "El cliente pide un crédito personal: un agente de IA (el mismo analista de crédito del préstamo) hace el scoring consultando el buró y decide. Los fuertes firman al instante; el resto va a un analista humano.",
  teaches: [
    "Reutilización de un agente (credit-agent) en más de un flujo",
    "Ruteo según la decisión del agente (approved / review)",
    "Una tarea de analista (área: creditos) que reincorpora al camino de firma",
  ],
  steps: [
    "Solicitud de crédito captura monto, ingreso y destino.",
    "Scoring crediticio (IA) llama al buró y devuelve {creditScore, decision, reasoning}.",
    "¿Decisión? manda approved a Firmá tu crédito; el resto a Análisis manual.",
    "Análisis manual (área: creditos) aprueba → firma, o rechaza → Rechazado.",
  ],
  forms: [creditoForm, creditoSign, creditoReview],
  connectors: [CREDIT_AGENT, MOCK_CREDIT],
  definition: {
    id: "personal-credit", name: "Solicitud de crédito personal", version: 1, status: "published", startNodeId: "start",
    nodes: [
      { id: "start", type: "start" },
      { id: "apply", type: "userTask", name: "Solicitud de crédito", formId: "credito-form" },
      { id: "scoring", type: "serviceTask", name: "Scoring crediticio (IA)", connectorId: "credit-agent", inputMap: { annualIncome: "annualIncome", amount: "amount" }, retries: 1, retryDelayMs: 200 },
      { id: "gw", type: "gateway", name: "¿Decisión?", branches: [{ edgeId: "e_appr", when: "decision == 'approved'" }], defaultEdgeId: "e_rev" },
      { id: "firma", type: "userTask", name: "Firmá tu crédito", formId: "credito-firma" },
      { id: "review", type: "userTask", name: "Análisis manual", formId: "credito-review", candidateRole: "creditos", priority: "high", slaHours: 24 },
      { id: "gwRev", type: "gateway", name: "¿Decisión del analista?", branches: [{ edgeId: "e_rev_ok", when: "underwriterDecision == 'approve'" }], defaultEdgeId: "e_rev_no" },
      { id: "endOk", type: "end", name: "Aprobado" },
      { id: "endNo", type: "end", name: "Rechazado" },
    ],
    edges: [
      { id: "e0", from: "start", to: "apply" },
      { id: "e1", from: "apply", to: "scoring" },
      { id: "e2", from: "scoring", to: "gw" },
      { id: "e_appr", from: "gw", to: "firma" },
      { id: "e_rev", from: "gw", to: "review" },
      { id: "e_rev2", from: "review", to: "gwRev" },
      { id: "e_rev_ok", from: "gwRev", to: "firma" },
      { id: "e_rev_no", from: "gwRev", to: "endNo" },
      { id: "e_firma_end", from: "firma", to: "endOk" },
    ],
    layout: {
      start: { x: 40, y: 220 }, apply: { x: 180, y: 220 }, scoring: { x: 360, y: 220 }, gw: { x: 560, y: 220 },
      firma: { x: 740, y: 120 }, endOk: { x: 940, y: 120 }, review: { x: 620, y: 360 }, gwRev: { x: 820, y: 360 }, endNo: { x: 1020, y: 360 },
    },
  },
};

// ---------- 4. Aviso de viaje de tarjeta (AI fraud check, automated) ----------
const viajeForm: FormDefinition = {
  id: "viaje-form", version: 1, title: "Aviso de viaje",
  fields: [
    { kind: "text", id: "v_name", bind: "fullName", label: "Nombre y apellido", required: true },
    { kind: "text", id: "v_card", bind: "cardLast4", label: "Últimos 4 dígitos de la tarjeta", required: true, pattern: "^[0-9]{4}$" },
    { kind: "text", id: "v_dest", bind: "destinations", label: "Países que vas a visitar (separados por coma)", required: true },
    { kind: "date", id: "v_start", bind: "startDate", label: "Fecha de salida", required: true },
    { kind: "date", id: "v_end", bind: "endDate", label: "Fecha de regreso", required: true },
  ],
};
const travel: Template = {
  id: "travel-notification",
  name: "Aviso de viaje de tarjeta",
  description:
    "El cliente avisa dónde y cuándo viaja para que su tarjeta funcione en el exterior. Un agente de IA evalúa el riesgo de fraude del aviso y, si está todo bien, lo registra con la red de tarjetas al instante.",
  teaches: [
    "Un agente de IA (Claude) que evalúa fraude y ejecuta una acción vía tool-calling",
    "Un flujo lineal, totalmente automático (sin intervención humana)",
    "Un formulario con validación (tarjeta de 4 dígitos, fechas)",
  ],
  steps: [
    "Datos del viaje captura tarjeta, países y fechas (con validación).",
    "Chequeo de fraude (IA) evalúa el riesgo y devuelve {riskLevel, reasoning}.",
    "Registrar en la red da de alta el viaje y devuelve {registered, reference}; termina en Registrado.",
  ],
  forms: [viajeForm],
  connectors: [FRAUD_AGENT, MOCK_TRAVEL],
  definition: {
    id: "travel-notification", name: "Aviso de viaje de tarjeta", version: 1, status: "published", startNodeId: "start",
    nodes: [
      { id: "start", type: "start" },
      { id: "details", type: "userTask", name: "Datos del viaje", formId: "viaje-form" },
      { id: "check", type: "serviceTask", name: "Chequeo de fraude (IA)", connectorId: "fraud-agent", inputMap: { destinations: "destinations", startDate: "startDate", endDate: "endDate", cardLast4: "cardLast4" }, retries: 1, retryDelayMs: 200 },
      { id: "register", type: "serviceTask", name: "Registrar en la red", connectorId: "travel-register", inputMap: { destinations: "destinations" } },
      { id: "end", type: "end", name: "Registrado" },
    ],
    edges: [
      { id: "e0", from: "start", to: "details" },
      { id: "e1", from: "details", to: "check" },
      { id: "e2", from: "check", to: "register" },
      { id: "e3", from: "register", to: "end" },
    ],
    layout: {
      start: { x: 40, y: 120 }, details: { x: 200, y: 110 }, check: { x: 420, y: 110 }, register: { x: 640, y: 110 }, end: { x: 860, y: 120 },
    },
  },
};

// ---------- 5. Pre-aprobación de préstamo (end-to-end, human-in-the-loop) ----------
const loanApplicationForm: FormDefinition = {
  id: "loan-application", version: 1, title: "Solicitud de préstamo",
  fields: [
    { kind: "text", id: "f1", bind: "fullName", label: "Nombre completo", required: true },
    { kind: "email", id: "f2", bind: "email", label: "Email", required: true },
    { kind: "number", id: "f3", bind: "annualIncome", label: "Ingreso anual (USD)", required: true, min: 0 },
    { kind: "number", id: "f4", bind: "amount", label: "Monto solicitado (USD)", required: true, min: 1000 },
    { kind: "number", id: "f5", bind: "termYears", label: "Plazo (años)", required: true, defaultValue: 5, min: 1, max: 30 },
    { kind: "select", id: "f6", bind: "employmentStatus", label: "Situación laboral", required: true, options: [
      { label: "En relación de dependencia", value: "employed" }, { label: "Independiente", value: "self" }, { label: "Desempleado", value: "unemployed" }] },
  ],
};
const loanSignForm: FormDefinition = {
  id: "loan-sign-offer", version: 1, title: "Tu oferta",
  fields: [
    { kind: "computed", id: "g1", bind: "monthlyPaymentDisplay", label: "Cuota mensual estimada (USD)", expr: "monthlyPayment" },
    { kind: "computed", id: "g2", bind: "creditScoreDisplay", label: "Tu score crediticio", expr: "creditScore" },
    { kind: "checkbox", id: "g3", bind: "accepted", label: "Acepto las condiciones de la oferta", required: true },
  ],
};
const loanUnderwriterForm: FormDefinition = {
  id: "loan-underwriter", version: 1, title: "Revisión de crédito",
  fields: [
    { kind: "computed", id: "h0", bind: "scoreShown", label: "Score del solicitante", expr: "creditScore" },
    { kind: "select", id: "h1", bind: "reviewDecision", label: "Decisión", required: true, options: [
      { label: "Aprobar", value: "approve" }, { label: "Rechazar", value: "reject" }] },
    { kind: "text", id: "h2", bind: "notes", label: "Notas" },
  ],
};
const loanDef: ProcessDefinition = {
  id: "loan-preapproval", name: "Pre-aprobación de préstamo", version: 0, status: "draft", startNodeId: "s",
  nodes: [
    { id: "s", type: "start" },
    { id: "apply", type: "userTask", name: "Solicitud de préstamo", formId: "loan-application" },
    { id: "credit", type: "serviceTask", name: "Chequeo de crédito (IA)", connectorId: "credit-agent", inputMap: { annualIncome: "annualIncome", amount: "amount" }, retries: 1, retryDelayMs: 200 },
    { id: "gwCredit", type: "gateway", name: "¿Apto para crédito?", branches: [{ edgeId: "e_gw_offer", when: "creditScore >= 650" }], defaultEdgeId: "e_gw_review" },
    { id: "offer", type: "serviceTask", name: "Calcular oferta", connectorId: "mock-mortgage", inputMap: { propertyValue: "amount", termYears: "termYears", annualIncome: "annualIncome" } },
    { id: "sign", type: "userTask", name: "Revisar y firmar", formId: "loan-sign-offer" },
    { id: "gwSign", type: "gateway", name: "¿Aceptado?", branches: [{ edgeId: "e_gws_appr", when: "accepted == true" }], defaultEdgeId: "e_gws_decl" },
    { id: "review", type: "userTask", name: "Revisión de crédito", formId: "loan-underwriter", candidateRole: "creditos", priority: "high", slaHours: 24 },
    { id: "gwReview", type: "gateway", name: "¿Decisión del analista?", branches: [{ edgeId: "e_gwr_offer", when: "reviewDecision == 'approve'" }], defaultEdgeId: "e_gwr_decl" },
    { id: "endApproved", type: "end", name: "Aprobado" },
    { id: "endDeclined", type: "end", name: "Rechazado" },
  ],
  edges: [
    { id: "e_s_apply", from: "s", to: "apply" },
    { id: "e_apply_credit", from: "apply", to: "credit" },
    { id: "e_credit_gw", from: "credit", to: "gwCredit" },
    { id: "e_gw_offer", from: "gwCredit", to: "offer" },
    { id: "e_gw_review", from: "gwCredit", to: "review" },
    { id: "e_offer_sign", from: "offer", to: "sign" },
    { id: "e_sign_gw", from: "sign", to: "gwSign" },
    { id: "e_gws_appr", from: "gwSign", to: "endApproved" },
    { id: "e_gws_decl", from: "gwSign", to: "endDeclined" },
    { id: "e_review_gw", from: "review", to: "gwReview" },
    { id: "e_gwr_offer", from: "gwReview", to: "offer" },
    { id: "e_gwr_decl", from: "gwReview", to: "endDeclined" },
  ],
  layout: {
    s: { x: 40, y: 220 }, apply: { x: 170, y: 220 }, credit: { x: 330, y: 220 }, gwCredit: { x: 510, y: 220 },
    offer: { x: 680, y: 120 }, sign: { x: 850, y: 120 }, gwSign: { x: 1030, y: 120 }, endApproved: { x: 1210, y: 120 },
    review: { x: 680, y: 340 }, gwReview: { x: 860, y: 340 }, endDeclined: { x: 1030, y: 340 },
  },
};
const loan: Template = {
  id: "loan-preapproval",
  name: "Pre-aprobación de préstamo",
  description:
    "Pre-aprobación de un préstamo personal donde el chequeo de crédito es un agente de IA real (Claude) con tool-calling: consulta el buró, razona sobre el resultado y devuelve una decisión estructurada. Los solicitantes fuertes se aprueban automáticamente; el resto va a un analista humano — luego se calcula la oferta y se firma.",
  teaches: [
    "Un agente de IA real (Claude) con tool-calling — llama a la herramienta credit_bureau mientras razona",
    "Guardrails de salida (requiredKeys) + un nivel de confianza en la decisión del agente",
    "Un gateway que auto-aprueba según el score y deriva el resto a un humano",
    "Una tarea de analista priorizada y con SLA (área: creditos)",
    "Una unión: la aprobación del analista se reincorpora al camino automático de oferta",
    "Campos calculados que muestran la oferta (cuota, score) en modo lectura",
  ],
  steps: [
    "Solicitud de préstamo recolecta ingreso, monto, plazo y situación laboral.",
    "Chequeo de crédito es un agente Claude: llama a la herramienta credit_bureau, lee el perfil y devuelve {creditScore, decision, reasoning, confidence}.",
    "¿Apto para crédito? manda score ≥ 650 directo a la oferta; el resto a Revisión de crédito.",
    "Revisión de crédito (prioridad alta, SLA 24h) aprueba → oferta, o rechaza → Rechazado.",
    "Calcular oferta usa mock-mortgage para la cuota mensual; Revisar y firmar captura la aceptación.",
    "¿Aceptado? termina en Aprobado o Rechazado.",
  ],
  definition: loanDef,
  forms: [loanApplicationForm, loanSignForm, loanUnderwriterForm],
  connectors: [CREDIT_AGENT, MOCK_CREDIT, MOCK_MORTGAGE],
};

export const TEMPLATES: Template[] = [onboarding, mortgage, credit, travel, loan];

export function listTemplates() {
  return TEMPLATES.map((t) => ({
    id: t.id, name: t.name, description: t.description, teaches: t.teaches, steps: t.steps,
  }));
}

/** Install a template: persist its forms, connectors, and definition (published + editable draft). */
export function installTemplate(id: string): string {
  const t = TEMPLATES.find((x) => x.id === id);
  if (!t) throw new Error(`Template not found: ${id}`);
  for (const f of t.forms) saveForm(f);
  for (const c of t.connectors) saveConnector(c);
  const version = maxPublishedVersion(t.id) + 1;
  saveDefinition({ ...t.definition, version, status: "published" });
  saveDefinition({ ...t.definition, version: 0, status: "draft" });
  return t.id;
}

const structureSig = (d: ProcessDefinition) => `${d.name}|${d.nodes.map((n) => n.id).sort().join(",")}`;

/**
 * Keep a product's installed flow in sync with its template. Always refreshes
 * forms + agents (idempotent, keeps stored keys). Publishes a new version only
 * when the latest published structure/name differs — so a template update rolls
 * out once, then no-ops on later boots. Existing instances/versions are untouched.
 */
export function syncTemplate(id: string): boolean {
  const t = TEMPLATES.find((x) => x.id === id);
  if (!t) throw new Error(`Template not found: ${id}`);
  for (const f of t.forms) saveForm(f);
  for (const c of t.connectors) saveConnector(c);
  let current: ProcessDefinition | undefined;
  try { current = getDefinition(id); } catch { current = undefined; }
  if (current && structureSig(current) === structureSig(t.definition)) return false;
  const version = maxPublishedVersion(id) + 1;
  saveDefinition({ ...t.definition, version, status: "published" });
  saveDefinition({ ...t.definition, version: 0, status: "draft" });
  return true;
}
