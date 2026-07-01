#!/usr/bin/env node
// Single entry point to run the whole app: starts the API and the web dev
// server together, streams their logs with a prefix, and shuts both down on
// Ctrl-C. Usage:  pnpm start   (or)   node dev.mjs
import { spawn } from "node:child_process";

const procs = [
  { name: "api", color: "\x1b[36m", args: ["--filter", "@cassiopeia/api", "dev"] },
  { name: "web", color: "\x1b[35m", args: ["--filter", "@cassiopeia/web", "dev"] },
];
const RESET = "\x1b[0m";

const children = [];
let shuttingDown = false;

function prefix(name, color, chunk) {
  const tag = `${color}[${name}]${RESET} `;
  return chunk
    .toString()
    .split("\n")
    .filter((l) => l.length > 0)
    .map((l) => tag + l)
    .join("\n");
}

for (const p of procs) {
  const child = spawn("pnpm", p.args, { stdio: ["ignore", "pipe", "pipe"], env: process.env });
  children.push(child);
  child.stdout.on("data", (d) => console.log(prefix(p.name, p.color, d)));
  child.stderr.on("data", (d) => console.error(prefix(p.name, p.color, d)));
  child.on("exit", (code) => {
    if (!shuttingDown) {
      console.error(`\n${p.color}[${p.name}]${RESET} exited (code ${code}). Shutting down.`);
      shutdown(1);
    }
  });
}

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const c of children) c.kill("SIGTERM");
  setTimeout(() => process.exit(code), 300);
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

console.log(`
  Cassiopeia is starting…
    Web  →  http://localhost:5173
    API  →  http://localhost:3001

  Open http://localhost:5173 in your browser. Press Ctrl-C to stop both.
`);
