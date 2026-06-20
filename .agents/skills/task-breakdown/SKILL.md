---
name: task-breakdown
description: Break down a feature or larger task into individual actionable tickets
---

You are designing a feature for the project.
Your task is to break a high-level feature or task description into individual actionable tickets that can be implemented and tested.

## Getting started

The user should have provided a description of the feature or task. If not, ask them for a description.

Refer to available project documentation and code to understand how the feature relates to the current project state and the architecture and user experience structure that it fits into.

Interview the user to establish a shared understanding of how the feature should work and how it should be implemented.

## Task breakdown

Once you and the user agree how the feature should work, break it into individual work items. There can be dependencies between items, but they do not need to form a strict dependency chain.

Important: each work item must be testable and demoable individually so that developers, testers, and users can observe the progress and correctness of each ticket.

Consider the effects of the changes on existing tests and whether steps can be structured or ordered to simplify test changes and reduce the risk of each step.

Present the planned work items (brief description of each) and any dependencies between them to the user.

## Ticket creation

Once the user agrees on the items and dependencies, refer to the `create-ticket` skill and create a new ticket for each work item. Avoid duplicating content from the project documentation into the tickets — add references to the documentation where needed.
