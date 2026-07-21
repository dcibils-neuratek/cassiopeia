// Customer journeys — a projection (a lens) over a workflow, defined separately
// from the ProcessDefinition. The workflow stays the source of truth of state;
// a journey only maps the active flow node to a customer-facing screen, so the
// portal shows ~3 steps over a 9-node flow. Config-in-code for now (per
// docs/journey-apertura-ejemplo.md); could become a DB artifact with an editor.

export type JourneyStepKind = "form" | "wait" | "result";

export interface JourneyPage {
  label: string;
  /** Field ids (from the form) shown on this wizard page. */
  fields: string[];
}

export interface JourneyStep {
  key: string;
  label: string;
  expect?: string;
  kind: JourneyStepKind;
  /** form: the customer userTask this step maps to. */
  task?: string;
  /** form: split the single form into wizard pages (submitted together). */
  pages?: JourneyPage[];
  /** wait: flow nodes that all project onto this one waiting step. */
  covers?: string[];
  /** wait: if the open task is one of these, show "en revisión" (not "analizando"). */
  reviewNodes?: string[];
}

export interface Journey {
  product: string;
  token: string;
  defId: string;
  title: string;
  steps: JourneyStep[];
}

/** Public shape of a step (no internal task/covers wiring). */
export interface JourneyStepPublic {
  key: string;
  label: string;
  expect?: string;
  kind: JourneyStepKind;
}

export function publicSteps(j: Journey): JourneyStepPublic[] {
  return j.steps.map((s) => ({ key: s.key, label: s.label, expect: s.expect, kind: s.kind }));
}

/** The first `form` step (the intake) of a journey. */
export function intakeStep(j: Journey): JourneyStep | undefined {
  return j.steps.find((s) => s.kind === "form");
}

const JOURNEYS: Record<string, Journey> = {
  "banco-cuenta": {
    product: "cuenta",
    token: "banco-cuenta",
    defId: "onboarding",
    title: "Apertura de cuenta",
    steps: [
      {
        key: "datos",
        label: "Tus datos",
        expect: "Cargá tus datos. Toma 2 minutos.",
        kind: "form",
        task: "datos",
        pages: [
          { label: "Sobre vos", fields: ["fullName", "email", "clientType"] },
          { label: "Ingresos y documento", fields: ["document", "monthlyIncome"] },
        ],
      },
      {
        key: "verificacion",
        label: "Verificación",
        expect: "Verificamos tu identidad con IA; si hace falta, un analista revisa tu caso.",
        kind: "wait",
        covers: ["kyc", "gwRisk", "revision", "gwRev", "abrir"],
        reviewNodes: ["revision"],
      },
      {
        key: "resultado",
        label: "Resultado",
        expect: "Te confirmamos si tu cuenta quedó abierta.",
        kind: "result",
      },
    ],
  },
};

export function getJourney(token: string): Journey | undefined {
  return JOURNEYS[token];
}
