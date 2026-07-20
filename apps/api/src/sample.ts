// Hardcoded sample used to seed the DB and drive the M1 walking skeleton:
// the bank onboarding mini-flow.
//
//  start -> [Request Customer Info] -> (Verify Documents) -> <Risk?>
//              userTask + form           serviceTask         gateway
//                                                           /        \
//                                          riskScore>0.7  /            \ default
//                                                        v              v
//                                            [Manual Review]      (Create Account)
//                                              userTask             serviceTask
//                                                   \                  /
//                                                    v                v
//                                                        end

import type { FormDefinition, ProcessDefinition } from "@cassiopeia/model";
import { saveConnector, saveDefinition, saveForm } from "./db.js";

export const ONBOARDING: ProcessDefinition = {
  id: "onboarding",
  name: "Customer Onboarding",
  version: 1,
  status: "published",
  startNodeId: "start",
  nodes: [
    { id: "start", type: "start" },
    {
      id: "request_info",
      type: "userTask",
      name: "Request Customer Info",
      formId: "onboarding-form",
    },
    {
      id: "verify",
      type: "serviceTask",
      name: "Verify Documents",
      connectorId: "verify-docs",
    },
    {
      id: "risk",
      type: "gateway",
      name: "Risk?",
      branches: [{ edgeId: "e_high", when: "riskScore > 0.7" }],
      defaultEdgeId: "e_low",
    },
    {
      id: "manual_review",
      type: "userTask",
      name: "Manual Review",
      formId: "manual-review-form",
    },
    {
      id: "create_account",
      type: "serviceTask",
      name: "Create Account",
      connectorId: "create-account",
    },
    { id: "end", type: "end" },
  ],
  edges: [
    { id: "e0", from: "start", to: "request_info" },
    { id: "e1", from: "request_info", to: "verify" },
    { id: "e2", from: "verify", to: "risk" },
    { id: "e_high", from: "risk", to: "manual_review" },
    { id: "e_low", from: "risk", to: "create_account" },
    { id: "e3", from: "manual_review", to: "end" },
    { id: "e4", from: "create_account", to: "end" },
  ],
  layout: {
    start: { x: 40, y: 200 },
    request_info: { x: 200, y: 190 },
    verify: { x: 400, y: 190 },
    risk: { x: 600, y: 200 },
    manual_review: { x: 780, y: 90 },
    create_account: { x: 780, y: 300 },
    end: { x: 980, y: 200 },
  },
};

export const ONBOARDING_FORM: FormDefinition = {
  id: "onboarding-form",
  version: 1,
  title: "Request Customer Info",
  fields: [
    { kind: "text", id: "f_name", bind: "legalName", label: "Legal name", required: true },
    { kind: "email", id: "f_email", bind: "email", label: "Email", required: true },
    {
      kind: "number",
      id: "f_income",
      bind: "income",
      label: "Annual income",
      description: "Used for risk scoring (≥ 5000 routes to auto-approval).",
      required: true,
      min: 0,
    },
    {
      kind: "checkbox",
      id: "f_iscompany",
      bind: "isCompany",
      label: "Registering as a company?",
    },
    {
      kind: "text",
      id: "f_company",
      bind: "companyName",
      label: "Company legal name",
      required: true,
      visibleIf: "isCompany == true",
    },
    { kind: "file", id: "f_id", bind: "idDocument", label: "ID document" },
    { kind: "file", id: "f_proof", bind: "incomeProof", label: "Proof of income" },
  ],
};

export const MANUAL_REVIEW_FORM: FormDefinition = {
  id: "manual-review-form",
  version: 1,
  title: "Manual Review",
  fields: [
    {
      kind: "select",
      id: "r_decision",
      bind: "reviewDecision",
      label: "Decision",
      required: true,
      options: [
        { label: "Approve", value: "approved" },
        { label: "Reject", value: "rejected" },
      ],
    },
    {
      kind: "text",
      id: "r_notes",
      bind: "reviewNotes",
      label: "Rejection reason",
      required: true,
      visibleIf: "reviewDecision == 'rejected'",
    },
  ],
};

export function seedSample(): void {
  saveDefinition(ONBOARDING);
  saveForm(ONBOARDING_FORM);
  saveForm(MANUAL_REVIEW_FORM);
  // The LLM used to generate a plain-language description of a process.
  // Defaults to Claude Haiku via Anthropic's OpenAI-compatible endpoint; the
  // user sets the API key (and can change the model) in the Describe panel.
  saveConnector({
    id: "describer",
    type: "ai-agent",
    config: {
      baseUrl: "https://api.anthropic.com/v1",
      model: "claude-haiku-4-5-20251001",
      apiKey: "",
      jsonOutput: false,
    },
  });
  saveConnector({ id: "verify-docs", type: "mock-verify", config: {} });
  saveConnector({ id: "create-account", type: "mock-create-account", config: {} });
  // AI Agent connector, provider-neutral. Seeded against the local mock LLM so
  // it works out of the box; point baseUrl/apiKey/model at a real
  // OpenAI-compatible endpoint (e.g. https://api.anthropic.com/v1 + claude-sonnet-5)
  // in the Connectors tab.
  saveConnector({
    id: "ai-verify",
    type: "ai-agent",
    config: {
      baseUrl: "http://localhost:3001/mock-llm",
      apiKey: "mock-key",
      model: "claude-sonnet-5",
      instructions:
        "You verify a customer's onboarding documents. Given the customer's info, assess fraud/credit risk and return a JSON object {riskScore: number 0-1, verified: boolean}.",
      jsonOutput: true,
    },
  });
}
