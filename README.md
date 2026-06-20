# thoth

A CLI tool that generates documents from a mix of static text, verbatim file includes, and LLM-generated content.

## Install

```bash
npm install
npm run build
```

## Usage

```bash
<T> <input.md>                 # render to stdout
<T> <input.md> > output.md    # render to file
<T> --check <input.md>         # exit non-zero if rendered output differs from disk
<T> --config path/to/cfg.json <input.md>
```

`<T>` = `thoth`.

See `AGENTS.md` for agent-facing instructions and `docs/concept.md` for the design overview.
