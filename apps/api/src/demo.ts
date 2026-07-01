// M1 walking-skeleton proof: run the onboarding flow end-to-end in-process,
// exercising BOTH gateway branches. No HTTP, no UI — just the engine + DB.
// Run with: pnpm demo

import { initDb, getInstance, listEvents } from "./db.js";
import { seedSample } from "./sample.js";
import { startInstance, submitTask } from "./runtime.js";
import { openTaskForInstance } from "./db.js";

function printTrace(label: string, instanceId: string): void {
  const inst = getInstance(instanceId);
  console.log(`\n── ${label} ─────────────────────────────`);
  console.log(`instance ${instanceId}`);
  console.log(`status:  ${inst.status}  (at node: ${inst.currentNodeId})`);
  console.log(`context: ${JSON.stringify(inst.context)}`);
  console.log("events:");
  for (const e of listEvents(instanceId)) {
    const p = e.payload !== undefined ? ` ${JSON.stringify(e.payload)}` : "";
    console.log(`   • ${e.type}${e.nodeId ? ` @${e.nodeId}` : ""}${p}`);
  }
}

async function main() {
  initDb(":memory:");
  seedSample();

  // ---- Branch A: low risk (income >= 5000) -> auto Create Account -> end ----
  {
    const { instanceId, result } = await startInstance("onboarding");
    console.log(`[A] started -> ${result.status}`);
    const task = openTaskForInstance(instanceId)!;
    const r = await submitTask(task.id, { legalName: "Ada Lovelace", income: 8000 });
    console.log(`[A] submitted Request Info -> ${r.status}`);
    printTrace("BRANCH A · low risk", instanceId);
  }

  // ---- Branch B: high risk (income < 5000) -> Manual Review -> end ----
  {
    const { instanceId } = await startInstance("onboarding");
    const t1 = openTaskForInstance(instanceId)!;
    const r1 = await submitTask(t1.id, { legalName: "Bob Risky", income: 1200 });
    console.log(`\n[B] submitted Request Info -> ${r1.status} (expect waiting @ manual_review)`);
    const t2 = openTaskForInstance(instanceId)!;
    const r2 = await submitTask(t2.id, { reviewDecision: "approved" });
    console.log(`[B] submitted Manual Review -> ${r2.status}`);
    printTrace("BRANCH B · high risk", instanceId);
  }
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
