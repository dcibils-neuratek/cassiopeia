---
name: commit-push-every-change
description: Always commit and push to the Cassiopeia GitHub repo after each change
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 99cafdd9-d41a-4fd0-981f-179cc265798c
---

After completing any change in the Cassiopeia project, commit it and push to
`origin/main` (https://github.com/dcibils-neuratek/cassiopeia.git) without being
asked again.

**Why:** The user explicitly requested "commit and push from now on every time we do something."

**How to apply:** Once a change is done and verified, `git add -A`, commit with a
clear message (end with the `Co-Authored-By: Claude Opus 4.8` trailer), and
`git push`. Work directly on `main` (the user wants a simple linear history on
this repo, not per-change branches). Git identity is set locally to
Diego Cibils <dcibils@gmail.com>. Never stage `node_modules/`, `data/`, or
`*.sqlite` (already covered by .gitignore).
