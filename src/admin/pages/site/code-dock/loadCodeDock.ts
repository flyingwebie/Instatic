/** Keep the dock frame synchronous; fetch panel engines and CodeMirror together. */
export const loadHtmlPanel = () => import('./html/HtmlPanel')
export const loadCssPanel = () => import('./css/CssPanel')
export const loadJsPanel = () => import('./js/JsPanel')

export function preloadCodeDock(): void {
  void Promise.all([
    loadHtmlPanel(),
    loadCssPanel(),
    loadJsPanel(),
    import('@site/code-editor/CodeMirrorEditor'),
  ]).catch((err) => {
    // Speculative loading is best effort; the mounted lazy boundary handles failures.
    console.warn('[CodeDock] could not preload code editors:', err)
  })
}
