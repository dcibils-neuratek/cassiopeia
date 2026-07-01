# Claude Code session snapshot

This folder carries the Claude Code **conversation transcript** (`*.jsonl`) and
**auto-memory** (`memory/`) so you can continue the same session on another
machine. It's produced by `scripts/save-session.mjs` and applied by
`scripts/restore-session.mjs`.

## Continue on another machine

```bash
git clone https://github.com/dcibils-neuratek/cassiopeia.git
cd cassiopeia
pnpm install
node scripts/restore-session.mjs   # copies transcript + memory into ~/.claude
claude --resume                    # pick this session to keep the conversation
```

Or just `claude` for a fresh session — `CLAUDE.md` gives full project context.

## Update the snapshot (on the machine you worked on)

```bash
node scripts/save-session.mjs
git add .session && git commit -m "Update session snapshot" && git push
```

## Notes / caveats

- The transcript contains the **entire conversation** — keep this repo **private**.
- Session resume is best-effort: for exact file-path fidelity, clone the repo to
  the **same absolute path** as the original machine. The conversation resumes
  regardless; only absolute paths referenced inside the transcript differ.
- The transcript grows over time (currently several MB). Re-run `save-session.mjs`
  before pushing whenever you want the other machine to get the latest history.
