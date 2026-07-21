// Background automations for the bank. First one: TTL-driven recovery of
// abandoned applications ("sin completar") — nudge the customer by email after a
// configurable idle time, and eventually drop the draft. Config lives in the
// `automation` connector (Settings → Automatizaciones). Runs on a slow interval.

import { getConnector, listDrafts, deleteDraft, markDraftReminded } from "./db.js";
import { remindDraft } from "./public-apply.js";

export interface AutomationConfig {
  draftsEnabled: boolean;
  remindAfterHours: number;       // idle time before the 1st reminder
  secondRemindAfterHours: number; // idle time before the 2nd (0 = off)
  purgeAfterHours: number;        // idle time before dropping the draft (0 = never)
}

const DEFAULTS: AutomationConfig = {
  draftsEnabled: false,
  remindAfterHours: 24,
  secondRemindAfterHours: 72,
  purgeAfterHours: 336, // 14 days
};

export function automationConfig(): AutomationConfig {
  try {
    const c = getConnector("automation").config as Partial<AutomationConfig>;
    return {
      draftsEnabled: Boolean(c.draftsEnabled),
      remindAfterHours: Number(c.remindAfterHours ?? DEFAULTS.remindAfterHours),
      secondRemindAfterHours: Number(c.secondRemindAfterHours ?? DEFAULTS.secondRemindAfterHours),
      purgeAfterHours: Number(c.purgeAfterHours ?? DEFAULTS.purgeAfterHours),
    };
  } catch {
    return { ...DEFAULTS };
  }
}

function portalBase(): string {
  try {
    const pb = getConnector("mailer").config.portalBase;
    if (pb) return String(pb).replace(/\/+$/, "");
  } catch { /* no mailer */ }
  return "http://localhost:3001";
}

/**
 * One pass over the abandoned drafts. Sends at most one email per draft per pass
 * (incremental: 1st reminder, then 2nd), and purges very old ones. Idle time is
 * measured from the customer's last activity (`updatedAt`), not from reminders.
 */
export async function sweepDrafts(): Promise<{ reminded: number; purged: number }> {
  const cfg = automationConfig();
  if (!cfg.draftsEnabled) return { reminded: 0, purged: 0 };

  const now = Date.now();
  const base = portalBase();
  let reminded = 0;
  let purged = 0;

  for (const d of listDrafts()) {
    const idleH = (now - new Date(d.updatedAt).getTime()) / 3_600_000;

    if (cfg.purgeAfterHours > 0 && idleH >= cfg.purgeAfterHours) {
      deleteDraft(d.appId, d.nodeId);
      purged++;
      continue;
    }

    const email = (d.data as Record<string, unknown>).email;
    if (!email) continue; // no address captured yet — nothing to send

    try {
      if (d.remindersSent === 0 && idleH >= cfg.remindAfterHours) {
        await remindDraft(d.appId, d.nodeId, base);
        markDraftReminded(d.appId, d.nodeId, 1);
        reminded++;
      } else if (d.remindersSent === 1 && cfg.secondRemindAfterHours > 0 && idleH >= cfg.secondRemindAfterHours) {
        await remindDraft(d.appId, d.nodeId, base);
        markDraftReminded(d.appId, d.nodeId, 2);
        reminded++;
      }
    } catch { /* mail failure — retry on the next pass */ }
  }

  return { reminded, purged };
}
