export type Diagnostic = {
  severity: 'error' | 'warning'
  message: string
  file: string | null
  line: number | null
  column: number | null
  hints: string[]
  rendered: string
}

export type PreviewView = {
  status: 'idle' | 'rendering' | 'ok' | 'error'
  file: string | null
  page: number
  pageCount: number
  kind: 'svg' | 'raster'
  parts: string[]
  errors: Diagnostic[]
  warnings: Diagnostic[]
  mtimeMs: number | null
  renderMs: number | null
}

declare module 'claude-code' {
  interface PluginState {
    'typst-preview': { view: Shaped<PreviewView> }
  }
}
