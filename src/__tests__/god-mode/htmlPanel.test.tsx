/**
 * HtmlPanel — the God Mode HTML column end to end: projection of the
 * selection, explicit Apply gated on syntax, one undo step, per-scope
 * drafts, read-only Component internals with jump-to-definition, and a
 * token / instatic-* round trip.
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { EditorView } from '@codemirror/view'
import { useEditorStore } from '@site/store/store'
import { HtmlPanel } from '@site/code-dock/html'
import { getKeybindingForCommand } from '@admin/spotlight/keybindings'
import '@modules/base/index'

const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve))

function state() {
  return useEditorStore.getState()
}

function setup() {
  state().clearSite()
  useEditorStore.setState({ activePageId: null, activeDocument: null, selectedNodeId: null, selectedNodeIds: [] } as Parameters<typeof useEditorStore.setState>[0])
  const site = state().createSite('HTML panel')
  const page = site.pages[0]
  const containerId = state().insertNode('base.container', {}, page.rootNodeId)
  const textId = state().insertNode('base.text', { text: 'Hello {page.title}', tag: 'p' }, containerId)
  const siblingId = state().insertNode('base.text', { text: 'Bye', tag: 'p' }, containerId)
  state().renameNode(siblingId, 'Farewell')
  return { pageId: page.id, rootId: page.rootNodeId, containerId, textId, siblingId }
}

async function mountPanel() {
  render(<HtmlPanel />)
  await waitFor(() => expect(document.querySelector('.cm-editor')).toBeTruthy())
  await nextFrame()
  return editorView()
}

function editorView(): EditorView {
  const view = EditorView.findFromDOM(document.querySelector<HTMLElement>('.cm-editor')!)
  expect(view).toBeTruthy()
  return view!
}

function replaceInDoc(view: EditorView, search: string, insert: string) {
  const from = view.state.doc.toString().indexOf(search)
  expect(from).toBeGreaterThanOrEqual(0)
  act(() => {
    view.dispatch({ changes: { from, to: from + search.length, insert } })
  })
}

const status = () => screen.getByTestId('html-panel-status').getAttribute('data-status')
const applyButton = () => screen.getByTestId('html-panel-apply') as HTMLButtonElement
// With a tooltip the Button primitive expresses disabled via aria-disabled.
const applyDisabled = () => applyButton().disabled || applyButton().getAttribute('aria-disabled') === 'true'

beforeEach(setup)
afterEach(cleanup)

describe('HtmlPanel', () => {
  it('advertises the registered apply shortcut', () => {
    expect(getKeybindingForCommand('godMode.applyHtml')?.shortcut.win).toBe('Ctrl+Enter')
  })

  it('projects the selection, applies explicitly as one undo step, and keeps untouched identity', async () => {
    const { containerId, textId, siblingId } = setup()
    state().selectNode(containerId)
    const view = await mountPanel()
    expect(view.state.doc.toString()).toContain(`<p uid="${textId}">Hello {page.title}</p>`)
    expect(applyDisabled()).toBe(true)

    replaceInDoc(view, 'Hello {page.title}', 'Hi {page.title}')
    await nextFrame()
    expect(status()).toBe('dirty')
    expect(applyDisabled()).toBe(false)
    // Nothing touched the tree yet.
    expect(state().site!.pages[0].nodes[textId].props.text).toBe('Hello {page.title}')

    await act(async () => {
      fireEvent.click(applyButton())
    })
    const page = state().site!.pages[0]
    expect(page.nodes[textId].props.text).toBe('Hi {page.title}')
    expect(page.nodes[siblingId].label).toBe('Farewell')
    expect(status()).toBe('clean')

    act(() => {
      state().undo()
    })
    expect(state().site!.pages[0].nodes[textId].props.text).toBe('Hello {page.title}')
    await waitFor(() => expect(editorView().state.doc.toString()).toContain('Hello {page.title}'))
  })

  it('disables Apply with visible diagnostics while the document does not parse', async () => {
    const { containerId, textId } = setup()
    state().selectNode(containerId)
    const view = await mountPanel()
    replaceInDoc(view, '</p>', '</p')
    await nextFrame()
    expect(status()).toBe('syntax')
    expect(applyDisabled()).toBe(true)
    const brokenAt = view.state.doc.toString().indexOf('</p')
    act(() => {
      view.dispatch({ changes: { from: brokenAt + 3, insert: '>' } })
    })
    await nextFrame()
    expect(status()).not.toBe('syntax')
    expect(state().site!.pages[0].nodes[textId].props.text).toBe('Hello {page.title}')
  })

  it('shows the whole page when nothing is selected and keeps a draft across selection changes', async () => {
    const { containerId, textId } = setup()
    state().selectNode(textId)
    const view = await mountPanel()
    replaceInDoc(view, 'Hello', 'Draft')
    await nextFrame()
    expect(status()).toBe('dirty')

    act(() => {
      state().clearSelection()
    })
    await waitFor(() => expect(editorView().state.doc.toString()).toContain(`uid="${containerId}"`))
    expect(status()).toBe('clean')

    act(() => {
      state().selectNode(textId)
    })
    await waitFor(() => expect(editorView().state.doc.toString()).toContain('Draft'))
    expect(status()).toBe('dirty')
  })

  it("renders Component-instance internals read-only with a working jump to the definition", async () => {
    const { containerId } = setup()
    const vcId = state().createVisualComponent('Card')
    useEditorStore.setState({ activeDocument: { kind: 'visualComponent', vcId } } as Parameters<typeof useEditorStore.setState>[0])
    const vcRootId = state().site!.visualComponents.find((v) => v.id === vcId)!.tree.rootNodeId
    const internalId = state().insertNode('base.text', { text: 'Inside', tag: 'p' }, vcRootId)
    useEditorStore.setState({ activeDocument: null } as Parameters<typeof useEditorStore.setState>[0])
    const refId = state().insertComponentRef(containerId, vcId)!
    state().selectNode(internalId)

    const view = await mountPanel()
    expect(status()).toBe('read-only')
    expect(view.contentDOM.getAttribute('contenteditable')).toBe('false')
    expect(screen.queryByTestId('html-panel-apply')).toBeNull()

    await act(async () => {
      fireEvent.click(screen.getByTestId('html-panel-open-definition'))
    })
    expect(state().activeDocument).toEqual({ kind: 'visualComponent', vcId })
    await waitFor(() => expect(status()).toBe('clean'))
    expect(editorView().contentDOM.getAttribute('contenteditable')).toBe('true')

    // Consumer side, the instance itself projects as an opaque marker that survives an edit-and-apply.
    useEditorStore.setState({ activeDocument: null } as Parameters<typeof useEditorStore.setState>[0])
    act(() => {
      state().selectNode(containerId)
    })
    await waitFor(() => expect(editorView().state.doc.toString()).toContain('<instatic-component'))
    replaceInDoc(editorView(), 'Hello {page.title}', 'Hey {page.title}')
    await nextFrame()
    await act(async () => {
      fireEvent.click(applyButton())
    })
    const page = state().site!.pages[0]
    expect(page.nodes[refId]).toMatchObject({ moduleId: 'base.visual-component-ref', parentId: containerId })
    expect(Object.values(page.nodes).some((n) => n.props.text === 'Hey {page.title}')).toBe(true)
  })

  it('round-trips a slot instance and its user content through an edit-and-apply', async () => {
    const { containerId } = setup()
    const vcId = state().createVisualComponent('Card')
    useEditorStore.setState({ activeDocument: { kind: 'visualComponent', vcId } } as Parameters<typeof useEditorStore.setState>[0])
    const vcRootId = state().site!.visualComponents.find((v) => v.id === vcId)!.tree.rootNodeId
    state().insertNode('base.slot-outlet', { slotName: 'body' }, vcRootId)
    useEditorStore.setState({ activeDocument: null } as Parameters<typeof useEditorStore.setState>[0])
    const refId = state().insertComponentRef(containerId, vcId)!
    const slotId = state().site!.pages[0].nodes[refId].children[0]
    expect(state().site!.pages[0].nodes[slotId].moduleId).toBe('base.slot-instance')
    const fillId = state().insertNode('base.text', { text: 'Filled', tag: 'p' }, slotId)
    state().selectNode(containerId)

    const view = await mountPanel()
    expect(view.state.doc.toString()).toContain('<instatic-slot')
    expect(view.state.doc.toString()).toContain(`<p uid="${fillId}">Filled</p>`)
    replaceInDoc(view, 'Filled', 'Filled twice')
    await nextFrame()
    await act(async () => {
      fireEvent.click(applyButton())
    })
    const page = state().site!.pages[0]
    expect(page.nodes[slotId]).toMatchObject({ moduleId: 'base.slot-instance', parentId: refId })
    expect(page.nodes[fillId]).toMatchObject({ parentId: slotId, props: { text: 'Filled twice' } })
  })
})
