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
  name: "New Client Onboarding",
  description:
    "Collect a new customer's details and documents, verify them with an AI agent, and either auto-open the account or route high-risk cases to manual review.",
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
  name: "Mortgage Simulator",
  description:
    "Let a prospect simulate a mortgage: capture the property and income, compute the monthly payment and affordability, and present an offer or suggest adjustments.",
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
    id: "mortgage-sim", name: "Mortgage Simulator", version: 1, status: "published", startNodeId: "start",
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
  name: "Personal Credit Request",
  description:
    "Take a personal loan application, run an automated credit check, and split into instant approval (sign) or manual underwriting based on the score.",
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
    id: "personal-credit", name: "Personal Credit Request", version: 1, status: "published", startNodeId: "start",
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
  name: "Card Travel Notification",
  description:
    "Let a customer tell the bank where and when they're travelling so their card keeps working abroad. Captures trip details, registers them with the card network, and confirms.",
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
    id: "travel-notification", name: "Card Travel Notification", version: 1, status: "published", startNodeId: "start",
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

export const TEMPLATES: Template[] = [onboarding, mortgage, credit, travel];

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
