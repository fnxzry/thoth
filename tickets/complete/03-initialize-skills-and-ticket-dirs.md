---
id: 03
type: task
status: complete
description: Create the .agents/skills/ tree and tickets/ status subdirectories, with adapted SKILL.md files mirrored from llmgen-handoff.md.
---

## Overview

Set up the project's agent-skill set and ticket directory structure so that the project workflow skills (create-ticket, complete-ticket, review-ticket, etc.) are available and tickets have a place to live.

## User-Facing Behavior

No runtime behavior. The project gains:
- `.agents/skills/{brainstorm,elaborate,task-breakdown,create-ticket,complete-ticket,select-ticket,review-ticket}/SKILL.md` with content adapted from the handoff (project-specific details removed).
- `tickets/{open,in-progress,in-validation,complete}/` directories.

## Technical Requirements

- Each `SKILL.md` exists with the frontmatter (`name`, `description`) and content adapted from the handoff. Project-specific terms (e.g. "adventure game", "the game") are replaced with neutral language ("the project").
- The seven skill names match exactly: `brainstorm`, `elaborate`, `task-breakdown`, `create-ticket`, `complete-ticket`, `select-ticket`, `review-ticket`.
- `tickets/{open,in-progress,in-validation,complete}/` exist as empty directories (add a `.gitkeep` if necessary for git to track them).
- A `tickets/README.md` does NOT exist (the directory layout is documented in `docs/ticketing-system.md` instead, matching the source project's convention).

## Acceptance Criteria

- [ ] All seven skill directories exist with their `SKILL.md` files.
- [ ] Each `SKILL.md` is internally consistent with the project (no game-engine terminology, no references to docs that do not exist in this repo).
- [ ] `tickets/{open,in-progress,in-validation,complete}/` exist and are tracked by git.
- [ ] Running the `create-ticket` skill produces a well-formed ticket in `tickets/open/`.

## Notes

The handoff `llmgen-handoff.md` contains the SKILL.md contents under the Bootstrap Files section. Lift verbatim.

## Resolution

<filled in by implementer>

## Testing

<filled in by implementer>

## Review

Accepted. Confirmed against the working tree and git index; this work landed as part of the bootstrap (ticket #02 / earlier scaffolding) rather than a dedicated change for #03.

**Acceptance Criteria**
- [x] All seven skill directories exist with their `SKILL.md` files.
- [x] Each `SKILL.md` is internally consistent with the project (no game-engine terminology, no references to docs that do not exist in this repo).
- [x] `tickets/{open,in-progress,in-validation,complete}/` exist and are tracked by git.
- [x] Running the `create-ticket` skill produces a well-formed ticket in `tickets/open/`.

**Verification details**
- `.agents/skills/{brainstorm,complete-ticket,create-ticket,elaborate,review-ticket,select-ticket,task-breakdown}/SKILL.md` — all 7 tracked by git; `grep -i -E "adventure|game|player|character|narrative|quest"` returns no matches.
- Only doc reference in skill files is `docs/features/<feature-name>.md` (a template path), not a broken link to a missing file.
- `tickets/{open,in-progress,in-validation,complete}/` each contain `.gitkeep` and are tracked by git. No `tickets/README.md` exists (matches source-project convention).
- Tickets 05, 06, 07 in `tickets/open/` follow the format prescribed by `.agents/skills/create-ticket/SKILL.md` (frontmatter with padded ID, kebab slug, Overview / Acceptance Criteria / Notes sections).
- `npm run lint` exits 0.

Moving to `tickets/complete/`.
