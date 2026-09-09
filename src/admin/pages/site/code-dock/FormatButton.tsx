/**
 * The Code Dock panels' "Format" action: Prettier over the panel's buffer,
 * the same as the editor's Shift-Alt-F.
 */
import { formatShortcut, getKeybindingForCommand } from '@admin/spotlight/keybindings'
import { TextWrapIcon } from 'pixel-art-icons/icons/text-wrap'
import { Button } from '@ui/components/Button'

const FORMAT_SHORTCUT = formatShortcut(getKeybindingForCommand('codeEditor.format')!.shortcut)

export function FormatButton({ onFormat, testId }: { onFormat: () => void; testId: string }) {
  return (
    <Button
      variant="ghost"
      size="xs"
      iconOnly
      aria-label="Format code"
      onClick={onFormat}
      tooltip={`Format the code with Prettier (${FORMAT_SHORTCUT})`}
      data-testid={testId}
    >
      <TextWrapIcon size={14} aria-hidden="true" />
    </Button>
  )
}
