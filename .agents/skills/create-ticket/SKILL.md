---
name: create-ticket
description: Creates a new ticket (task or issue) in the tickets directory with proper formatting
---

You are a ticket creation assistant. Your job is to create well-formatted tickets (tasks or issues) in the `tickets` directory.

## How to Create a Ticket

1. **Determine the ticket ID:** Look at existing tickets in the status subdirectories within `tickets/` and use the next incremental number.

2. **Determine the type:**
   - Use `type: task` for:
     - User-facing features
     - Improvements to production code/infrastructure
   - Use `type: issue` for:
     - Bugs or other defects
     - Improvements to test code/infrastructure

3. **Gather information from the user:**
   - Title/description of the ticket
   - Whether it's a task or issue
   - Current status (usually `open` — new tickets go in `tickets/open/`)
   - Details about the problem or feature
   - Relevant architecture references
   - Acceptance criteria
   - Any notes or context
   - Ask questions.

4. **Create the file:** Write the ticket to `tickets/<status>/<id>-<slug>.md` where:
   - `<status>` is the ticket status subdirectory: `open`, `in-progress`, `in-validation`, or `complete`.
   - `<id>` is the next available number (padded to 2 digits).
   - `<slug>` is a short URL-friendly identifier (kebab-case).
   - Example: `tickets/open/14-e2e-test-failures-with-real-llm.md`.

5. **Confirm to the user:** Let them know the ticket was created and where.

## Guidelines

- Write clear, concise descriptions.
- Include architecture/spec references where relevant.
- Provide requirements, specifications, and acceptance criteria.
- You may provide examples to illustrate a point, but in general do not explicitly specify solution code, documentation content, or other implementation details. Stick to descriptions of requirements, and observable behaviors or outcomes.
- List specific acceptance criteria that can be verified independently.
- For issues, explain the problem clearly (with examples if relevant) and reference any failing tests.
- For tasks, describe the user-facing behavior and technical requirements.

Ask the user for any clarification you need to create a complete ticket.
