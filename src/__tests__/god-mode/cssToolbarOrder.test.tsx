import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { CssToolbar } from '@site/code-dock/css/CssToolbar'
import { CSS_TOOLBAR_ITEMS, CSS_TOOLBAR_ORDER_KEY } from '@site/code-dock/css/cssToolbarOrder'

const run = mock(() => {})
const defaults = CSS_TOOLBAR_ITEMS.map((item) => item.label)
const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve))

function mount() {
  return render(
    <CssToolbar
      context={{ canEdit: true, canWrap: true, declarations: {}, rules: [], activeRule: null }}
      conditions={[]}
      run={run}
    />,
  )
}

function labels() {
  return within(screen.getByRole('group', { name: 'CSS categories' }))
    .getAllByRole('button')
    .map((button) => button.getAttribute('aria-label'))
}

function openOrder() {
  fireEvent.click(screen.getByRole('button', { name: 'Reorder CSS toolbar' }))
  return within(screen.getByRole('group', { name: 'Toolbar order' }))
}

beforeEach(() => {
  localStorage.removeItem(CSS_TOOLBAR_ORDER_KEY)
  run.mockClear()
})
afterEach(() => {
  cleanup()
  localStorage.removeItem(CSS_TOOLBAR_ORDER_KEY)
})

describe('CSS toolbar order', () => {
  it('reorders icons, restores the order after remount, and resets without changing CSS', async () => {
    mount()
    expect(labels()).toEqual(defaults)
    const palette = openOrder()
    await act(nextFrame)
    fireEvent.click(palette.getByRole('button', { name: 'Layout', exact: true }))
    fireEvent.click(screen.getByRole('button', { name: 'Move earlier' }))
    const expected = [...defaults]
    expected.splice(expected.indexOf('Layout'), 1)
    expected.splice(5, 0, 'Layout')
    expect(labels()).toEqual(expected)
    expect(localStorage.getItem(CSS_TOOLBAR_ORDER_KEY)).toContain('layout')
    cleanup()
    mount()
    expect(labels()).toEqual(expected)
    const toolbarButtons = within(screen.getByTestId('css-toolbar')).getAllByRole('button')
    expect(toolbarButtons.at(-1)?.getAttribute('aria-label')).toBe('Reorder CSS toolbar')
    openOrder()
    fireEvent.click(screen.getByRole('button', { name: 'Reset toolbar order' }))
    expect(labels()).toEqual(defaults)
    await act(nextFrame)
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Reorder CSS toolbar' }))
    expect(run).not.toHaveBeenCalled()
  })

  it('moves navigation with keyboard and drag, keeping every control available', async () => {
    mount()
    const palette = openOrder()
    await act(nextFrame)
    const navigation = palette.getByRole('button', { name: 'Navigate CSS rules' })
    fireEvent.keyDown(navigation, { key: 'Home' })
    expect(labels()[0]).toBe('Navigate CSS rules')
    await act(nextFrame)
    expect(document.activeElement).toBe(navigation)
    expect(screen.getByRole('button', { name: 'Move earlier' }).getAttribute('aria-disabled')).toBe(
      'true',
    )
    const transfer = { setData: mock(() => {}), effectAllowed: '', dropEffect: '' }
    fireEvent.dragStart(navigation, { dataTransfer: transfer })
    const position = palette.getByRole('button', { name: 'Position', exact: true })
    fireEvent.dragOver(position, { dataTransfer: transfer })
    fireEvent.drop(position, { dataTransfer: transfer })
    expect(labels().at(-2)).toBe('Navigate CSS rules')
    expect(new Set(labels()).size).toBe(defaults.length)
    expect(run).not.toHaveBeenCalled()
  })

  it('recovers corrupt preferences and synchronizes changes from another tab', () => {
    localStorage.setItem(CSS_TOOLBAR_ORDER_KEY, '{broken')
    mount()
    expect(labels()).toEqual(defaults)
    act(() => {
      localStorage.setItem(
        CSS_TOOLBAR_ORDER_KEY,
        JSON.stringify(['layout', 'layout', 'unknown', 'type']),
      )
      window.dispatchEvent(new window.StorageEvent('storage', { key: CSS_TOOLBAR_ORDER_KEY }))
    })
    expect(labels().slice(0, 2)).toEqual(['Layout', 'Typography'])
    expect(new Set(labels()).size).toBe(defaults.length)
    act(() => {
      localStorage.removeItem(CSS_TOOLBAR_ORDER_KEY)
      window.dispatchEvent(new window.StorageEvent('storage', { key: null }))
    })
    expect(labels()).toEqual(defaults)
  })
})
