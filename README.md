# Typst Preview

A live preview pane for [Typst](https://typst.app) documents in Claude Code
Desktop. It shows the rendered pages of the current `.typ` file beside the
chat and re-renders after every change.

- Opens by itself when Claude writes or edits a `.typ` file.
- `/typst-preview path/to/file.typ` shows any document.
- Refreshes when the file changes on disk, so your own editor's saves show up.
- **◀ Prev**, **Next ▶** and **Refresh** buttons (keys `p`, `n`, `r`).
- Compile errors are listed with line numbers above the last good page.

Pages are drawn as vector SVG. Dense pages too large for the pane are drawn
as PNG strips. The terminal shows the status and errors, but not page images.

## Requirements

[uv](https://docs.astral.sh/uv/) on your `PATH`. On first use it installs the
renderer's dependencies, Typst 0.15 (`typst` Python bindings) and Pillow, into
uv's cache. No separate Typst install is needed.

## Install

At the prompt of a Claude Code terminal session:

```text
/plugin install typst-preview --marketplace ewanni/typst-preview
```

From a shell:

```bash
claude plugin install typst-preview --marketplace ewanni/typst-preview
```

In the desktop app, where `/plugin` does not run: click **+** next to the
prompt box, then **Plugins**, **Add marketplace** with `ewanni/typst-preview`,
then **Add plugin**.

## License

MIT
