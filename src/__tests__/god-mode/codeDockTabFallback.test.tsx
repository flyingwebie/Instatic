/**
 * CodeDock — narrow-window tab fallback (God Mode ticket 01).
 *
 * The dock watches its own width with a ResizeObserver and switches to
 * tabbed mode when the visible columns can't all fit at min width. The
 * observer is mocked so the test can drive width changes directly.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { render, screen, cleanup, fireEvent, act, within, waitFor } from '@testing-library/react'
import { useEditorStore } from '@site/store/store'
import { CodeDock } from '@site/code-dock'

type ObserverCallback = (entries: Array<{ contentRect: { width: number } }>) => void

const observerCallbacks: ObserverCallback[] = []
const RealResizeObserver = globalThis.ResizeObserver

class MockResizeObserver {
  private callback: ObserverCallback
  constructor(callback: ObserverCallback) {
    this.callback = callback
    observerCallbacks.push(callback)
  }
  observe() {}
  unobserve() {}
  disconnect() {
    const index = observerCallbacks.indexOf(this.callback)
    if (index >= 0) observerCallbacks.splice(index, 1)
  }
}

function emitDockWidth(width: number) {
  act(() => {
    for (const callback of [...observerCallbacks]) {
      callback([{ contentRect: { width } }])
    }
  })
}

beforeEach(() => {
  globalThis.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver
  useEditorStore.setState({
    godModeActive: true,
    codeDockHeight: 280,
    codeDockPanels: { html: true, css: true, js: true },
    codeDockActiveTab: 'html',
    codeDockPanelOrder: ['html', 'css', 'js'],
    codeDockColumnWeights: { html: 1, css: 1, js: 1 },
  } as Parameters<typeof useEditorStore.setState>[0])
})

afterEach(async () => {
  await act(async () => {
    cleanup()
    await Promise.all([
      import('@site/code-dock/html/HtmlPanel'),
      import('@site/code-dock/css/CssPanel'),
      import('@site/code-dock/js/JsPanel'),
      import('@site/code-editor/CodeMirrorEditor'),
    ])
  })
  observerCallbacks.length = 0
  globalThis.ResizeObserver = RealResizeObserver
})

describe('CodeDock — tab fallback', () => {
  it('shows three columns when wide, one tabbed editor when narrow, and restores on widening', () => {
    render(<CodeDock />)
    const dock = screen.getByTestId('code-dock')

    // Wide: all three columns render side by side.
    emitDockWidth(1200)
    expect(dock.getAttribute('data-tabbed')).toBe('false')
    expect(screen.getByTestId('code-dock-panel-html')).toBeDefined()
    expect(screen.getByTestId('code-dock-panel-css')).toBeDefined()
    expect(screen.getByTestId('code-dock-panel-js')).toBeDefined()

    // Narrow (3 visible columns need 3 × 280px): tabbed mode, active tab only.
    emitDockWidth(500)
    expect(dock.getAttribute('data-tabbed')).toBe('true')
    expect(screen.getByTestId('code-dock-panel-html')).toBeDefined()
    expect(screen.queryByTestId('code-dock-panel-css')).toBeNull()
    expect(screen.queryByTestId('code-dock-panel-js')).toBeNull()

    // Tab buttons switch the visible panel in tabbed mode.
    fireEvent.click(screen.getByTestId('code-dock-toggle-css'))
    expect(screen.getByTestId('code-dock-panel-css')).toBeDefined()
    expect(screen.queryByTestId('code-dock-panel-html')).toBeNull()

    // Widening restores the columns.
    emitDockWidth(1200)
    expect(dock.getAttribute('data-tabbed')).toBe('false')
    expect(screen.getByTestId('code-dock-panel-html')).toBeDefined()
    expect(screen.getByTestId('code-dock-panel-js')).toBeDefined()
  })

  it('reorders panel columns and tabs while preserving widths, visibility, and active editor', async () => {
    useEditorStore.getState().setCodeDockColumnWeights({ html: 2, css: 3, js: 1 })
    render(<CodeDock />)
    emitDockWidth(1200)
    fireEvent.click(screen.getByRole('button', { name: 'Reorder code panels' }))
    const palette = within(screen.getByRole('group', { name: 'Panel order' }))
    fireEvent.keyDown(palette.getByRole('button', { name: 'CSS', exact: true }), { key: 'Home' })
    expect(useEditorStore.getState().codeDockPanelOrder).toEqual(['css', 'html', 'js'])
    expect(useEditorStore.getState().codeDockColumnWeights).toEqual({ html: 2, css: 3, js: 1 })
    const columns = () =>
      [...document.querySelectorAll('[data-testid^="code-dock-panel-"]')].map((el) =>
        el.getAttribute('aria-label'),
      )
    expect(columns()).toEqual(['CSS panel', 'HTML panel', 'JS panel'])
    fireEvent.keyDown(screen.getByRole('dialog', { name: 'Reorder code panels' }), {
      key: 'Escape',
    })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    fireEvent.click(screen.getByTestId('code-dock-toggle-html'))
    expect(columns()).toEqual(['CSS panel', 'JS panel'])
    emitDockWidth(400)
    expect(screen.getAllByRole('tab').map((el) => el.textContent)).toEqual(['CSS', 'HTML', 'JS'])
    fireEvent.click(screen.getByTestId('code-dock-toggle-js'))
    expect(columns()).toEqual(['JS panel'])
    expect(useEditorStore.getState().codeDockActiveTab).toBe('js')
  })

  it('never tabs with a single visible column, however narrow', () => {
    useEditorStore.setState({
      codeDockPanels: { html: true, css: false, js: false },
    } as Parameters<typeof useEditorStore.setState>[0])
    render(<CodeDock />)
    emitDockWidth(200)
    expect(screen.getByTestId('code-dock').getAttribute('data-tabbed')).toBe('false')
    expect(screen.getByTestId('code-dock-panel-html')).toBeDefined()
  })
})
