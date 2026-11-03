import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Diagnostic, PreviewView } from '../types'

const PANE = 'typst-preview'
const TITLE = 'Typst Preview'
// The renderer ships with the mod; uv installs its dependencies on first use.
const RENDERER = 'renderer/render.py'
const POLL_MS = 1500
// The first run downloads typst and pillow.
const RENDER_TIMEOUT_MS = 180_000

const EMPTY: PreviewView = {
  status: 'idle',
  file: null,
  page: 1,
  pageCount: 0,
  kind: 'svg',
  parts: [],
  errors: [],
  warnings: [],
  mtimeMs: null,
  renderMs: null,
}

// Change the tag when PreviewView's fields change.
const view = atom({ plugin: 'typst-preview', key: 'view' } as const, EMPTY, {
  shape: 'view-1',
})

type RenderOutput = {
  ok: boolean
  page: number
  page_count: number
  kind: 'svg' | 'raster'
  parts: string[]
  errors: Diagnostic[]
  warnings: Diagnostic[]
  mtime_ms: number | null
}

let isRendering = false
let isQueued = false

const basename = (path: string) => path.slice(path.lastIndexOf('/') + 1)

async function renderOnce($: EngineInterface): Promise<void> {
  const current = await read($, view)
  if (!current.file) return
  const file = current.file
  await update($, view, (v): PreviewView => ({ ...v, status: 'rendering' }))

  const startedAt = await $.clock.now()
  let out: RenderOutput
  try {
    const script = `${$.plugin.root}/${RENDERER}`
    const ran = await $.process.run(
      ['uv', 'run', '--quiet', '--script', script, file, '--page', String(current.page)],
      { timeoutMs: RENDER_TIMEOUT_MS },
    )
    if (ran.exitCode !== 0) throw new Error(ran.stderr.trim() || `exit ${ran.exitCode}`)
    out = JSON.parse(ran.stdout) as RenderOutput
  } catch (error) {
    const message = `Renderer failed: ${error instanceof Error ? error.message : String(error)}`
    await update($, view, (v): PreviewView => ({
      ...v,
      status: 'error',
      errors: [{ severity: 'error', message, file: null, line: null, column: null, hints: [], rendered: message }],
    }))
    return
  }
  const renderMs = (await $.clock.now()) - startedAt

  await update($, view, (v): PreviewView =>
    v.file !== file
      ? v
      : {
          ...v,
          status: out.ok ? 'ok' : 'error',
          page: out.ok ? out.page : v.page,
          pageCount: out.ok ? out.page_count : v.pageCount,
          // A failed render keeps the last good page on screen under the errors.
          kind: out.ok ? out.kind : v.kind,
          parts: out.ok ? out.parts : v.parts,
          errors: out.errors,
          warnings: out.warnings,
          mtimeMs: out.mtime_ms,
          renderMs,
        },
  )
}

async function render($: EngineInterface): Promise<void> {
  if (isRendering) {
    isQueued = true
    return
  }
  isRendering = true
  try {
    do {
      isQueued = false
      await renderOnce($)
    } while (isQueued)
  } finally {
    isRendering = false
  }
}

async function show($: EngineInterface, file: string): Promise<void> {
  await update($, view, v => (v.file === file ? v : { ...EMPTY, file }))
  await $.ui.open({ id: PANE, title: TITLE })
  await render($)
}

// Renders on a timer so the edit's result reaches the model without waiting.
function afterEdit($: EngineInterface, filePath: string | undefined): void {
  if (filePath?.endsWith('.typ')) $.clock.after(0, () => void show($, filePath))
}

async function goTo($: EngineInterface, page: number): Promise<void> {
  await update($, view, v => ({ ...v, page: Math.min(Math.max(page, 1), Math.max(v.pageCount, 1)) }))
  await render($)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'typst-preview',
      description: 'Show a Typst document in the live preview pane',
      argumentHint: '[file.typ]',
    })

    // Catches edits made outside Claude (your editor) while a file is shown.
    $.clock.every(POLL_MS, () => {
      void (async () => {
        const current = await read($, view)
        if (!current.file || isRendering) return
        const stat = await $.fs.stat(current.file).catch(() => undefined)
        if (stat && Math.trunc(stat.mtimeMs) !== current.mtimeMs) await render($)
      })()
    })

    return next(e)
  })

  on('command.run', { command: 'typst-preview' }, async ($, e) => {
    const arg = e.args.trim()
    const current = await read($, view)
    const file = arg ? (arg.startsWith('/') ? arg : `${await $.session.cwd()}/${arg}`) : current.file
    if (!file) return { text: 'Usage: /typst-preview <file.typ>' }
    if (!file.endsWith('.typ')) return { text: `Not a Typst file: ${file}` }
    await show($, file)

    return { text: `Typst preview: ${file}` }
  })

  on('tool.call', { tool: 'Write' }, async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny === undefined && !ran.isError) afterEdit($, e.file_path)

    return ran
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: 'Edit' }, async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny === undefined && !ran.isError) afterEdit($, e.file_path)

    return ran
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const table = $.ui.resolve(e)
    const { Box, Text, Button, Code } = table
    // Every surface but the terminal draws Svg.
    const Svg = e.surface !== 'terminal' && 'Svg' in table ? table.Svg : undefined
    const v = await read($, view)

    if (!v.file) {
      return (
        <Box flexDirection="column">
          <Text dimColor>No Typst file yet. Edit a .typ file or run /typst-preview file.typ</Text>
        </Box>
      )
    }

    const status =
      v.status === 'rendering'
        ? 'rendering…'
        : v.status === 'error'
          ? `${v.errors.length} error(s)`
          : v.renderMs !== null
            ? `${v.renderMs} ms`
            : ''

    return (
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="row" gap={1}>
          <Text bold>{basename(v.file)}</Text>
          <Text dimColor>
            page {v.page} / {v.pageCount || '?'} · {status}
          </Text>
        </Box>
        <Box flexDirection="row" gap={1}>
          <Button key="prev" label="◀ Prev" hotkey="p" onPress={() => goTo($, v.page - 1)} />
          <Button key="next" label="Next ▶" hotkey="n" onPress={() => goTo($, v.page + 1)} />
          <Button key="refresh" label="Refresh" hotkey="r" onPress={() => render($)} />
        </Box>
        {v.errors.map((d, i) => (
          <Box key={`err-${i}`} flexDirection="column">
            <Text color="red">
              {d.line !== null ? `line ${d.line}: ` : ''}
              {d.message}
            </Text>
            {d.rendered ? <Code source={d.rendered} /> : null}
          </Box>
        ))}
        {v.warnings.map((d, i) => (
          <Text key={`warn-${i}`} color="yellow">
            warning{d.line !== null ? ` (line ${d.line})` : ''}: {d.message}
          </Text>
        ))}
        {Svg ? (
          <Box flexDirection="column">
            {v.parts.map((svg, i) => (
              <Svg
                source={svg}
                alt={`${basename(v.file ?? '')}, page ${v.page}${v.parts.length > 1 ? `, part ${i + 1} of ${v.parts.length}` : ''}`}
              />
            ))}
          </Box>
        ) : (
          <Text dimColor>Page images are drawn in Claude Code Desktop.</Text>
        )}
      </Box>
    )
  })
}
