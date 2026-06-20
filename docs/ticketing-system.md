# Ticketing System

This file describes the structure and organization of implementation tickets for the project.

## Ticket Format

Tickets in this project follow a specific markdown format:

```markdown
---
id: NN
type: task | issue
status: open | in-progress | in-validation | complete
description: <Brief description of what this is about>
---

## Overview

<Detailed explanation of what needs to be done>

## User-Facing Behavior

<What the user sees/does - if applicable>

## Technical Requirements

<Implementation details - if already known>

## Acceptance Criteria

- [ ] Criterion 1
- [ ] Criterion 2

## Notes

<Additional context, considerations, or references>

## Resolution

<Notes provided by implementer describing what they did>

## Testing

<Description of how to test the changes, provided by implementer>

## Review

**Decision:** Accept | Reject

<Review comments and rationale>
```

## Ticket Organization

Tasks and issues are tracked as markdown files organized by status in subdirectories:

```
tickets/
├── open/          # New tickets awaiting implementation
├── in-progress/   # Tickets currently being worked on
├── in-validation/ # Completed tickets awaiting review
└── complete/      # Reviewed and approved tickets
```

**Creating Tickets:**
- New tickets go in `tickets/open/` with initial status `open`.
- Use the `create-ticket` skill to create properly formatted tickets.

**Working on Tickets:**
- Use the `complete-ticket` skill to implement tickets.
- When starting: move ticket from `open/` to `in-progress/`.
- When done: move ticket from `in-progress/` to `in-validation/`.

**Reviewing Tickets:**
- Use the `review-ticket` skill to review completed work.
- If approved: move ticket from `in-validation/` to `complete/`.
