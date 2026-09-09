/** Isolated process: intentionally suspended panel modules must not leak into other tests. */
import { mock, expect, it } from 'bun:test'
import { Suspense } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useEditorStore } from '@site/store/store'

const pending = new Promise<void>(() => {})
export function PendingPanel(): never {
  throw pending
}
mock.module('@site/code-dock/html/HtmlPanel', () => ({ HtmlPanel: PendingPanel }))
mock.module('@site/code-dock/css/CssPanel', () => ({ CssPanel: PendingPanel }))
mock.module('@site/code-dock/js/JsPanel', () => ({ JsPanel: PendingPanel }))
it('renders the dock around suspended panels', async () => {
  const { CodeDock } = await import('@site/code-dock')
  useEditorStore.setState({
    codeDockPanels: { html: true, css: true, js: true },
    codeDockPanelOrder: ['css', 'html', 'js'],
  })
  render(
    <Suspense fallback={<p data-testid="blocked-dock">Blocked dock</p>}>
      <CodeDock />
    </Suspense>,
  )
  await act(() => new Promise((resolve) => setTimeout(resolve, 30)))
  expect(screen.queryByTestId('blocked-dock')).toBeNull()
  expect(screen.getByTestId('code-dock-toggle-css')).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Properties Panel' })).toBeTruthy()
  expect(screen.getAllByRole('status', { name: 'Loading code editor' })).toHaveLength(3)
  fireEvent.click(screen.getByTestId('code-dock-toggle-html'))
  expect(screen.queryByTestId('code-dock-panel-html')).toBeNull()
  expect(screen.getByTestId('code-dock-panel-css')).toBeTruthy()
  cleanup()
})
