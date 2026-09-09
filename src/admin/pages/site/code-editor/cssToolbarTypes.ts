/** Plain toolbar contracts; CodeMirror itself stays in the lazy editor chunk. */
export type CssToolbarCommand =
  | { kind: 'declarations'; declarations: Record<string, string> }
  | { kind: 'wrap'; condition: string }
  | { kind: 'navigate'; from: number }

export interface CssToolbarRule {
  from: number
  label: string
  locked: boolean
}

export interface CssToolbarContext {
  rules: CssToolbarRule[]
  activeRule: string | null
  declarations: Record<string, string>
  canEdit: boolean
  canWrap: boolean
}

export type CssToolbarResult = { ok: true } | { ok: false; error: string }
