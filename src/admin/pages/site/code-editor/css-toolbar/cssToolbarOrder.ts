import { useSyncExternalStore } from 'react'
import { Type } from '@core/utils/typeboxHelpers'
import { parseJsonWithFallback } from '@core/utils/jsonValidate'
import { getErrorMessage } from '@core/utils/errorMessage'
import { pushToast } from '@ui/components/Toast'
import { CSS_TOOLS } from './cssToolbarCatalog'
import type { CssToolbarIcon } from './cssToolbarIcons'

export const CSS_TOOLBAR_ITEMS = [
  ...CSS_TOOLS.map(({ id, label }) => ({ id, label, icon: id })),
  { id: 'conditions' as const, label: 'Conditional rules', icon: 'code' },
  { id: 'navigator' as const, label: 'Navigate CSS rules', icon: 'rows' },
] satisfies { id: string; label: string; icon: CssToolbarIcon }[]

export const CSS_TOOLBAR_ORDER_KEY = 'instatic-css-toolbar-order'
const CHANGE_EVENT = 'instatic-css-toolbar-order-changed'
const OrderSchema = Type.Array(Type.String(), { maxItems: 128 })

function readSnapshot(): string | null {
  try {
    return localStorage.getItem(CSS_TOOLBAR_ORDER_KEY)
  } catch (_err) {
    // Unavailable browser storage must not prevent editing CSS.
    return null
  }
}

function subscribe(listener: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.key === CSS_TOOLBAR_ORDER_KEY || event.key === null) listener()
  }
  window.addEventListener('storage', onStorage)
  window.addEventListener(CHANGE_EVENT, listener)
  return () => {
    window.removeEventListener('storage', onStorage)
    window.removeEventListener(CHANGE_EVENT, listener)
  }
}

export function useCssToolbarOrder() {
  const raw = useSyncExternalStore(subscribe, readSnapshot, () => null)
  const saved = parseJsonWithFallback(raw, OrderSchema, [])
  // Preserve the chosen order while ensuring every available control appears once.
  const ids = [...new Set([...saved, ...CSS_TOOLBAR_ITEMS.map((item) => item.id)])]
  const items = ids.flatMap((id) => CSS_TOOLBAR_ITEMS.filter((item) => item.id === id))

  function saveOrder(order: readonly string[]) {
    try {
      localStorage.setItem(CSS_TOOLBAR_ORDER_KEY, JSON.stringify(order))
      window.dispatchEvent(new Event(CHANGE_EVENT))
    } catch (err) {
      console.error('[CssToolbar] failed to save toolbar order:', err)
      pushToast({
        kind: 'error',
        title: 'Could not save toolbar order',
        body: getErrorMessage(err, 'Browser storage is unavailable'),
      })
    }
  }

  return { items, saveOrder }
}
