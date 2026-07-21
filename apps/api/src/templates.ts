// Workflow templates — ready-made banking processes the user can install and
// learn from. Each bundles a process definition (with layout), its forms, and
// its connectors, plus "teaches"/"steps" docs shown in the gallery.

import type { ConnectorRow } from "./db.js";
import type { FormDefinition, ProcessDefinition } from "@cassiopeia/model";
import { maxPublishedVersion, saveConnector, saveDefinition, saveForm } from "./db.js";
import { ONBOARDING, ONBOARDING_FORM, MANUAL_REVIEW_FORM } from "./sample.js";

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

// ---------- 1. New client onboarding (reuses the sample) ----------
const onboarding: Template = {
  id: "onboarding",
  name: "Alta de nuevo cliente",
  description:
    "Recolectá los datos y documentos de un nuevo cliente, verificalos con un agente de IA, y abrí la cuenta automáticamente o derivá los casos de alto riesgo a revisión manual.",
  teaches: [
    "A user task with an attached form (legal name, income, documents)",
    "An AI-agent service task that returns a structured risk decision",
    "A gateway that routes on the AI result (riskScore > 0.7)",
    "A second human task (manual review) on the risky branch",
  ],
  steps: [
    "Request Customer Info collects the applicant's data via its form.",
    "Verify Documents calls the ai-verify connector, which returns {riskScore, verified}.",
    "The Risk? gateway sends riskScore > 0.7 to Manual Review, everything else to Create Account.",
    "Create Account calls a connector to open the account; the flow ends.",
  ],
  definition: ONBOARDING,
  forms: [ONBOARDING_FORM, MANUAL_REVIEW_FORM],
  connectors: [
    { id: "verify-docs", type: "mock-verify", config: {} },
    { id: "create-account", type: "mock-create-account", config: {} },
    {
      id: "ai-verify",
      type: "ai-agent",
      config: {
        baseUrl: "http://localhost:3001/mock-llm",
        apiKey: "mock-key",
        model: "claude-sonnet-5",
        instructions:
          "You verify a customer's onboarding documents. Return JSON {riskScore: 0-1, verified: boolean}.",
        jsonOutput: true,
      },
    },
  ],
};

// ---------- 2. Mortgage simulator ----------
const mortgageForm: FormDefinition = {
  id: "mortgage-form",
  version: 1,
  title: "Mortgage Simulation Request",
  fields: [
    { kind: "text", id: "m_name", bind: "legalName", label: "Full name", required: true },
    { kind: "number", id: "m_price", bind: "propertyValue", label: "Property value", required: true, min: 0 },
    { kind: "number", id: "m_down", bind: "downPayment", label: "Down payment", required: true, min: 0 },
    { kind: "number", id: "m_term", bind: "termYears", label: "Term (years)", required: true, min: 1, max: 40, defaultValue: 20 },
    { kind: "number", id: "m_income", bind: "annualIncome", label: "Annual income", required: true, min: 0 },
  ],
};
const mortgageOffer: FormDefinition = {
  id: "mortgage-offer-form",
  version: 1,
  title: "Your Mortgage Offer",
  fields: [
    { kind: "select", id: "mo_decision", bind: "offerDecision", label: "Do you accept this offer?", required: true, options: [{ label: "Accept", value: "accept" }, { label: "Decline", value: "decline" }] },
  ],
};
const mortgage: Template = {
  id: "mortgage-sim",
  name: "Simulador de hipoteca",
  description:
    "Dejá que un prospecto simule una hipoteca: capturá la propiedad y los ingresos, calculá la cuota mensual y la accesibilidad, y presentá una oferta o sugerí ajustes.",
  teaches: [
    "A compute service task (mock-mortgage) returning payment + affordability",
    "A gateway branching on a boolean the connector produced (affordable)",
    "Showing computed results back to the user in a follow-up form",
  ],
  steps: [
    "Loan Request captures property value, down payment, term and income.",
    "Simulate calls mock-mortgage → {loanAmount, monthlyPayment, dti, affordable}.",
    "Affordable? routes affordable == true to Present Offer, else to Suggest Adjustments.",
    "Swap mock-mortgage for a real pricing API or an AI agent connector when ready.",
  ],
  forms: [mortgageForm, mortgageOffer],
  connectors: [{ id: "mortgage-calc", type: "mock-mortgage", config: {} }],
  definition: {
    id: "mortgage-sim", name: "Simulador de hipoteca", version: 1, status: "published", startNodeId: "start",
    nodes: [
      { id: "start", type: "start" },
      { id: "request", type: "userTask", name: "Loan Request", formId: "mortgage-form" },
      { id: "simulate", type: "serviceTask", name: "Simulate", connectorId: "mortgage-calc" },
      { id: "afford", type: "gateway", name: "Affordable?", branches: [{ edgeId: "e_no", when: "affordable == false" }], defaultEdgeId: "e_yes" },
      { id: "offer", type: "userTask", name: "Present Offer", formId: "mortgage-offer-form" },
      { id: "adjust", type: "userTask", name: "Suggest Adjustments", formId: "mortgage-form" },
      { id: "end", type: "end" },
    ],
    edges: [
      { id: "e0", from: "start", to: "request" },
      { id: "e1", from: "request", to: "simulate" },
      { id: "e2", from: "simulate", to: "afford" },
      { id: "e_yes", from: "afford", to: "offer" },
      { id: "e_no", from: "afford", to: "adjust" },
      { id: "e3", from: "offer", to: "end" },
      { id: "e4", from: "adjust", to: "end" },
    ],
    layout: {
      start: { x: 40, y: 200 }, request: { x: 200, y: 190 }, simulate: { x: 400, y: 190 },
      afford: { x: 600, y: 200 }, offer: { x: 780, y: 90 }, adjust: { x: 780, y: 300 }, end: { x: 980, y: 200 },
    },
  },
};

// ---------- 3. Personal credit request ----------
const creditForm: FormDefinition = {
  id: "credit-form",
  version: 1,
  title: "Personal Credit Application",
  fields: [
    { kind: "text", id: "c_name", bind: "legalName", label: "Full name", required: true },
    { kind: "number", id: "c_amount", bind: "amount", label: "Requested amount", required: true, min: 0 },
    { kind: "number", id: "c_income", bind: "annualIncome", label: "Annual income", required: true, min: 0 },
    { kind: "select", id: "c_purpose", bind: "purpose", label: "Purpose", required: true, options: [
      { label: "Home improvement", value: "home" }, { label: "Vehicle", value: "vehicle" },
      { label: "Debt consolidation", value: "debt" }, { label: "Other", value: "other" },
    ] },
  ],
};
const creditSign: FormDefinition = {
  id: "credit-sign-form", version: 1, title: "Approved — Sign Agreement",
  fields: [{ kind: "checkbox", id: "cs_agree", bind: "agreed", label: "I accept the credit terms", required: true }],
};
const creditReview: FormDefinition = {
  id: "credit-review-form", version: 1, title: "Underwriting Decision",
  fields: [{ kind: "select", id: "cr_dec", bind: "underwriterDecision", label: "Decision", required: true, options: [{ label: "Approve", value: "approve" }, { label: "Reject", value: "reject" }] }],
};
const credit: Template = {
  id: "personal-credit",
  name: "Solicitud de crédito personal",
  description:
    "Tomá una solicitud de crédito personal, corré un chequeo de crédito automático, y separá en aprobación instantánea (firma) o análisis manual según el score.",
  teaches: [
    "A service task that scores an applicant (mock-credit-score)",
    "Routing on a categorical connector result (decision == 'approved')",
    "Two different follow-up forms depending on the branch",
  ],
  steps: [
    "Credit Application captures amount, income and purpose.",
    "Credit Check calls mock-credit-score → {creditScore, decision}.",
    "Decision? sends decision == 'approved' to Sign Agreement, else to Manual Underwriting.",
    "Replace mock-credit-score with a credit bureau API or an AI agent.",
  ],
  forms: [creditForm, creditSign, creditReview],
  connectors: [{ id: "credit-score", type: "mock-credit-score", config: {} }],
  definition: {
    id: "personal-credit", name: "Solicitud de crédito personal", version: 1, status: "published", startNodeId: "start",
    nodes: [
      { id: "start", type: "start" },
      { id: "apply", type: "userTask", name: "Credit Application", formId: "credit-form" },
      { id: "check", type: "serviceTask", name: "Credit Check", connectorId: "credit-score" },
      { id: "decision", type: "gateway", name: "Decision?", branches: [{ edgeId: "e_appr", when: "decision == 'approved'" }], defaultEdgeId: "e_rev" },
      { id: "sign", type: "userTask", name: "Sign Agreement", formId: "credit-sign-form" },
      { id: "review", type: "userTask", name: "Manual Underwriting", formId: "credit-review-form" },
      { id: "end", type: "end" },
    ],
    edges: [
      { id: "e0", from: "start", to: "apply" },
      { id: "e1", from: "apply", to: "check" },
      { id: "e2", from: "check", to: "decision" },
      { id: "e_appr", from: "decision", to: "sign" },
      { id: "e_rev", from: "decision", to: "review" },
      { id: "e3", from: "sign", to: "end" },
      { id: "e4", from: "review", to: "end" },
    ],
    layout: {
      start: { x: 40, y: 200 }, apply: { x: 200, y: 190 }, check: { x: 400, y: 190 },
      decision: { x: 600, y: 200 }, sign: { x: 790, y: 90 }, review: { x: 790, y: 300 }, end: { x: 990, y: 200 },
    },
  },
};

// ---------- 4. Credit-card travel notification ----------
const travelForm: FormDefinition = {
  id: "travel-form",
  version: 1,
  title: "Travel Notification",
  fields: [
    { kind: "text", id: "t_card", bind: "cardLast4", label: "Card last 4 digits", required: true, pattern: "^[0-9]{4}$" },
    { kind: "text", id: "t_dest", bind: "destinations", label: "Countries you'll visit (comma separated)", required: true },
    { kind: "date", id: "t_start", bind: "startDate", label: "Departure date", required: true },
    { kind: "date", id: "t_end", bind: "endDate", label: "Return date", required: true },
  ],
};
const travelConfirm: FormDefinition = {
  id: "travel-confirm-form", version: 1, title: "Travel Registered",
  fields: [{ kind: "checkbox", id: "tc_ok", bind: "acknowledged", label: "I've noted my card is enabled for these countries", required: true }],
};
const travel: Template = {
  id: "travel-notification",
  name: "Aviso de viaje de tarjeta",
  description:
    "Permití que un cliente le avise al banco dónde y cuándo viaja para que su tarjeta siga funcionando en el exterior. Captura los datos del viaje, los registra con la red de tarjetas y confirma.",
  teaches: [
    "A form with validation (4-digit card, dates) and a date field",
    "A service task that calls out to an external system (mock-travel-register)",
    "A clean linear flow — no gateway needed",
  ],
  steps: [
    "Travel Details collects card, destinations and dates (with pattern validation).",
    "Register Travel calls mock-travel-register → {registered, reference, coverage}.",
    "Confirmation shows the customer their card is enabled; the flow ends.",
    "Swap mock-travel-register for the real card-network API.",
  ],
  forms: [travelForm, travelConfirm],
  connectors: [{ id: "travel-register", type: "mock-travel-register", config: {} }],
  definition: {
    id: "travel-notification", name: "Aviso de viaje de tarjeta", version: 1, status: "published", startNodeId: "start",
    nodes: [
      { id: "start", type: "start" },
      { id: "details", type: "userTask", name: "Travel Details", formId: "travel-form" },
      { id: "register", type: "serviceTask", name: "Register Travel", connectorId: "travel-register" },
      { id: "confirm", type: "userTask", name: "Confirmation", formId: "travel-confirm-form" },
      { id: "end", type: "end" },
    ],
    edges: [
      { id: "e0", from: "start", to: "details" },
      { id: "e1", from: "details", to: "register" },
      { id: "e2", from: "register", to: "confirm" },
      { id: "e3", from: "confirm", to: "end" },
    ],
    layout: {
      start: { x: 40, y: 120 }, details: { x: 200, y: 110 }, register: { x: 420, y: 110 },
      confirm: { x: 640, y: 110 }, end: { x: 840, y: 120 },
    },
  },
};

// ---------- 5. Loan pre-approval (end-to-end, human-in-the-loop) ----------
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
    "Pre-aprobación de un préstamo personal donde el chequeo de crédito es un agente de IA real (Claude) con tool-calling: consulta una herramienta de buró, razona sobre el resultado y devuelve una decisión estructurada. Los solicitantes fuertes se aprueban automáticamente; el resto va a un analista humano — luego se calcula la oferta y se firma.",
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
  connectors: [
    // Real AI-agent credit analyst — calls the credit_bureau tool while reasoning.
    // Installed key-less; add the API key in Settings / the connector library.
    {
      id: "credit-agent",
      type: "ai-agent",
      config: {
        baseUrl: "https://api.anthropic.com/v1",
        model: "claude-haiku-4-5-20251001",
        apiKey: "",
        jsonOutput: true,
        instructions:
          "Sos un analista de riesgo crediticio para un préstamo personal. Primero llamá a la herramienta credit_bureau con el annualIncome y el amount del solicitante para obtener su perfil crediticio. Después decidí. Respondé SOLO con un objeto JSON: {\"creditScore\": <el número del buró>, \"decision\": \"approved\" o \"review\", \"reasoning\": \"<una frase corta EN ESPAÑOL>\", \"confidence\": <0..1>}.",
        requiredKeys: ["creditScore", "decision"],
        tools: [{
          name: "credit_bureau",
          description: "Retrieve the applicant's credit score and repayment decision from the credit bureau",
          connector: "mock-credit-score",
          parameters: { type: "object", properties: { annualIncome: { type: "number" }, amount: { type: "number" } }, required: ["annualIncome", "amount"] },
        }],
      },
    },
    // The tool the agent calls (stands in for a real credit-bureau API).
    { id: "mock-credit-score", type: "mock-credit-score", config: {} },
    { id: "mock-mortgage", type: "mock-mortgage", config: {} },
  ],
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
