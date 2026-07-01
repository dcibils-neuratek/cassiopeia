#!/usr/bin/env node
// Snapshot this machine's Claude Code session transcript + memory into .session/
// so it can be committed and continued on another machine. Run from repo root:
//   node scripts/save-session.mjs   (then git add/commit/push)
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const repo = process.cwd();
const encoded = repo.replace(/[^a-zA-Z0-9]/g, "-");
const source = join(homedir(), ".claude", "projects", encoded);
const dest = join(repo, ".session");

if (!existsSync(source)) {
  console.error(`No Claude Code project dir found at:\n  ${source}`);
  process.exit(1);
}
mkdirSync(dest, { recursive: true });

// clear old jsonl snapshots
for (const f of readdirSync(dest)) if (f.endsWith(".jsonl")) rmSync(join(dest, f));

let n = 0;
for (const f of readdirSync(source)) {
  if (f.endsWith(".jsonl")) { cpSync(join(source, f), join(dest, f)); n++; }
}
if (existsSync(join(source, "memory"))) {
  cpSync(join(source, "memory"), join(dest, "memory"), { recursive: true });
}

console.log(`Snapshotted ${n} session file(s) + memory into .session/`);
console.log("Commit & push to carry the conversation to another machine.");
