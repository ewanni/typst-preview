import { expect, test } from 'claude-code/testing'

const PANE = {
  plugin: 'typst-preview',
  component: 'Pane',
  requestId: 'typst-preview',
  props: {
    title: 'Typst Preview',
    isFocused: false,
    bodyColumns: 60,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"></svg>'

const seeded = (value: object) => ({
  value: {
    value: {
      shape: 'view-1',
      value: {
        status: 'ok', file: '/doc/report.typ', page: 2, pageCount: 3, kind: 'svg',
        parts: [SVG, SVG], errors: [], warnings: [], mtimeMs: 1, renderMs: 42, ...value,
      },
    },
    version: 1,
  },
})

test('the pane shows the page and its parts on desktop', async ($, on) => {
  on('state.get', () => seeded({}))
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })

  expect((await ui.find({ type: 'Text', text: /report\.typ/ }))?.text).toBe('report.typ')
  expect((await ui.find({ type: 'Text', text: /page 2 \/ 3/ }))?.text).toContain('42 ms')
  expect(await ui.find({ type: 'Svg' })).toBeTruthy()
  await ui.unmount()
})

test('errors are listed and the terminal gets a note instead of images', async ($, on) => {
  on('state.get', () =>
    seeded({
      status: 'error',
      errors: [{ severity: 'error', message: 'unclosed delimiter', file: null, line: 4, column: 2, hints: [], rendered: '' }],
    }),
  )
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })

  expect((await ui.find({ type: 'Text', text: /unclosed/ }))?.text).toBe('line 4: unclosed delimiter')
  expect(await ui.find({ type: 'Text', text: /Claude Code Desktop/ })).toBeTruthy()
  await ui.unmount()
})

test('an empty pane explains how to start', async ($, on) => {
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })

  expect(await ui.find({ type: 'Text', text: /\/typst-preview/ })).toBeTruthy()
  await ui.unmount()
})
