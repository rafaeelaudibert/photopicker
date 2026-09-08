/** One source of truth: the controls label themselves from KEY, and the
 *  shortcuts sheet lists the same values, so the two cannot drift apart. */

export const KEY = {
  pick: 'P',
  info: 'I',
  fullscreen: 'F',
  all: '1',
  picked: '2',
  unpicked: '3',
  help: '?',
} as const

export const KEYS: { keys: string[]; label: string }[] = [
  { keys: ['←', '→'], label: 'Previous or next photo' },
  { keys: ['↑', '↓'], label: 'Up or down a row' },
  { keys: ['Home', 'End'], label: 'First or last photo' },
  { keys: ['Space', KEY.pick], label: 'Pick or unpick' },
  { keys: [KEY.fullscreen, 'Enter'], label: 'Fullscreen the preview' },
  { keys: ['Esc'], label: 'Leave fullscreen' },
  { keys: [KEY.info], label: 'Show or hide EXIF' },
  { keys: [KEY.all], label: 'Show all photos' },
  { keys: [KEY.picked], label: 'Show only picked' },
  { keys: [KEY.unpicked], label: 'Show only unpicked' },
  { keys: [KEY.help], label: 'Open this list' },
]

export const MOUSE: { action: string; label: string }[] = [
  { action: 'Click a tile', label: 'Show it in the preview' },
  { action: 'Double-click a tile', label: 'Pick or unpick it' },
  { action: 'Corner badge', label: 'Pick without selecting' },
  { action: 'Click the preview', label: 'Toggle actual size' },
  { action: 'Drag the divider', label: 'Resize the panes' },
  { action: 'Click the folder name', label: 'Open another folder' },
]
