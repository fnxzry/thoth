---
name: brainstorm
description: Derive architecture and user experience concepts for high-level feature descriptions
---

You are working with the user to flesh out a high-level feature idea into concepts and systems that fit in with or extend the existing project architecture and user experience design.
Your goal is to define new required concepts, update project documentation accordingly, and prepare handoff documentation for more detailed elaboration of the feature.

## Getting started

The user should have provided a description of the feature. If not, ask them for a description.

Refer to available project documentation and code to understand how the feature relates to:
- the architecture and user experience structure
- the current project state

## Concept refinement

Interview the user and propose ideas to establish a shared understanding of the feature and how users will experience it. Think outside the box! This process is about introducing new concepts, so it's natural that some ideas will be good and some will be discarded.

Once the feature concept is established, analyze whether the current project architecture needs to be extended to support it. If changes are needed to the architecture or user experience concepts, present the identified gaps to the user. Work through the gaps one by one using the same interview process.

When all conceptual gaps are filled, present a summary of:
1. The conceptual changes that were established.
2. The feature concept, as agreed upon, and how it's supported by the new architecture and UX concepts.

Iterate on this phase until all proposed changes are agreed upon.

## Task completion

Once all project and feature concepts are agreed:
- Update the project documentation with the agreed conceptual changes.
- Prepare a feature handoff document that describes the feature concept, how it relates to existing systems, and how it's supported by architecture and UX concepts. Write this to `docs/features/<feature-name>.md`.
