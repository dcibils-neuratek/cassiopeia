# Restore this Claude Code session on another machine

This repo carries the full Claude Code **conversation transcript** and **memory**
in `.session/`, so you can pick the conversation back up on any machine — not
just start a fresh one.

## TL;DR

```bash
git clone https://github.com/dcibils-neuratek/cassiopeia.git
cd cassiopeia
pnpm install
node scripts/restore-session.mjs   # copies the transcript + memory into ~/.claude
claude --resume                    # then pick this session from the list
```

That's it. `claude --resume` shows a list of sessions — choose the Cassiopeia
one and the conversation continues where it left off.

> Prefer a clean start instead? Just run `claude` in the repo. It won't have the
> chat history, but `CLAUDE.md` gives it full project context automatically.

## What each step does

| Step | Why |
| --- | --- |
| `git clone …` | Gets the code **and** the `.session/` snapshot (transcript + memory). |
| `pnpm install` | Installs deps so `pnpm start` works. |
| `node scripts/restore-session.mjs` | Copies `.session/*.jsonl` + `.session/memory/` into `~/.claude/projects/<this-repo>/` where Claude Code looks for sessions. |
| `claude --resume` | Lists local sessions; pick this one to continue the conversation. |

## Before you switch machines: save the latest history

The snapshot in `.session/` is a **point-in-time copy** — it does not auto-update
as we keep chatting. On the machine you were working on, run this to push the
newest transcript so the other machine can pick it up:

```bash
node scripts/save-session.mjs
git add .session && git commit -m "Update session snapshot" && git push
```

(Claude can also do this for you at the end of a turn — just ask.)

## Caveats

- **Keep this repo private.** The transcript in `.session/` contains the entire
  conversation.
- **Best fidelity = same absolute path.** The conversation resumes no matter
  where you clone it, but file paths *quoted inside the transcript* point at the
  original location. Cloning to the same path (e.g. `~/Code/Cassiopeia`) keeps
  those clickable.
- **Sessions are local to each machine.** There's no cloud sync — this
  snapshot-in-git is the bridge between machines.

See also `.session/README.md` (same steps, lives next to the snapshot) and
`CLAUDE.md` (project guide, loaded automatically by Claude Code).
