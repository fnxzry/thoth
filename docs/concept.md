# Concept

## What this tool is

`thoth` is a CLI tool that generates documents from sources. Authors write a **template** — a text file containing a mix of static text, verbatim file includes, and LLM-generated blocks. The tool renders the template into a final document.

## Who it's for

Software projects that maintain a small set of human-facing text documents (e.g. `AGENTS.md`, `README.md`, `CONTRIBUTING.md`, internal docs indexes) which need to stay in sync with other files in the repo. Examples of such documents:

- An agent-facing instructions file that summarizes the project's architecture and points to the canonical architecture doc.
- A docs index that lists each project document with a one-line summary and a "when to read" note.
- A README that pulls in the current version, license, and installation instructions from canonical sources.

Today, projects that want this either hand-maintain these documents (with the usual drift) or write ad-hoc scripts. `thoth` is the general-purpose, version-controllable version of the ad-hoc script.

## Core values

- **Static by default.** Anything in a template that is not a directive is passed through unchanged. Authors can read and edit a template directly.
- **Deterministic.** Given the same template, the same config, and a populated cache, the tool produces byte-identical output. This makes generated output safe to commit and safe to compare in code review.
- **Reproducible without network access.** A populated cache covers all `@llm` blocks. Regeneration against committed cache hits requires no LLM credentials.
- **Single source of truth.** When a referenced doc changes, regenerating the template that summarizes it produces updated text automatically. There is no manual sync step.
- **Honest about LLM limits.** LLM blocks are clearly delimited in the template and identifiable in the output. Anyone reading the rendered document can see what came from a model and what came from a human.

## Non-goals

- Not a static site generator. The tool renders one document at a time and does not manage navigation, theming, or HTML output.
- Not a documentation hosting platform. The output is a text document committed to the user's repo.
- Not a templating language in the general sense. The directive set is intentionally small (`static`, `include`, `llm`) and is not extensible via user-defined directives in v0.1.
- Not a multi-provider LLM platform in v0.1. OpenAI-compatible endpoints are supported; other providers are deferred.
