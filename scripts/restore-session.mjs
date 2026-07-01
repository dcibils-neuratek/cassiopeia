#!/usr/bin/env node
// Restore the Claude Code session transcript + memory (snapshotted in .session/)
// into this machine's ~/.claude so `claude --resume` can reopen the conversation.
// Run from the repo root:  node scripts/restore-session.mjs
import { cpSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const repo = process.cwd();
const encoded = repo.replace(/[^a-zA-Z0-9]/g, "-"); // matches Claude Code's project-dir naming
const target = join(homedir(), ".claude", "projects", encoded);
const src = join(repo, ".session");

if (!existsSync(src)) {
  console.error("No .session/ snapshot found in this repo.");
  process.exit(1);
}
mkdirSync(join(target, "memory"), { recursive: true });

let n = 0;
for (const f of readdirSync(src)) {
  if (f.endsWith(".jsonl")) { cpSync(join(src, f), join(target, f)); n++; }
}
if (existsSync(join(src, "memory"))) {
  cpSync(join(src, "memory"), join(target, "memory"), { recursive: true });
}

console.log(`Restored ${n} session file(s) + memory into:\n  ${target}\n`);
console.log("Now run:  claude --resume   (and pick this session)");
console.log("Note: for best fidelity clone the repo to the SAME absolute path as the");
console.log("original machine; the conversation resumes either way, but file paths in");
console.log("the transcript point at the original location.");
