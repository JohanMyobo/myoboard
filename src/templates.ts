import { INK, SECTION_COLORS, STICKY_COLORS } from './model/palette'
import type { BoardObject, NewObject } from './model/types'

/**
 * Ready-made boards for common workshops. Objects are laid out around (0, 0)
 * and inserted where the view is, like a paste.
 */

export interface BuiltInTemplate {
  key: string
  name: string
  description: string
  build(): BoardObject[]
}

const color = (name: string, list: readonly { name: string; value: string }[]) => list.find((c) => c.name === name)!.value

/** Gives template objects stable ids so connectors can refer to them. */
function withIds(objects: (NewObject & { key?: string })[]): BoardObject[] {
  return objects.map((obj, i) => {
    const { key, ...rest } = obj
    return { ...rest, id: key ?? `t${i}`, index: '' } as BoardObject
  })
}

const sticky = (x: number, y: number, text: string, tint: string): NewObject => ({
  type: 'sticky',
  x,
  y,
  w: 200,
  h: 200,
  color: color(tint, STICKY_COLORS),
  text,
})

function retro(): BoardObject[] {
  const columns: [string, string, string, string][] = [
    ['What went well', 'Mint', 'Mint', 'Shipped the new onboarding on time'],
    ['What to improve', 'Rose', 'Rose', 'Too many meetings on Thursdays'],
    ['Actions', 'Sky', 'Sky', 'Who does what, by when?'],
  ]
  return withIds([
    { type: 'text', x: 0, y: -110, w: 900, text: 'Sprint retrospective', fontSize: 40, color: INK },
    ...columns.flatMap(([title, section, note, example], i): NewObject[] => [
      { type: 'section', x: i * 560, y: 0, w: 520, h: 640, title, color: color(section, SECTION_COLORS) },
      sticky(i * 560 + 40, 70, example, note),
    ]),
  ])
}

function brainstorm(): BoardObject[] {
  const ideas = 8
  const radius = 430
  const notes: (NewObject & { key: string })[] = Array.from({ length: ideas }, (_, i) => {
    const angle = (i / ideas) * Math.PI * 2 - Math.PI / 2
    const tint = STICKY_COLORS[i % 6].name
    return { ...sticky(Math.round(Math.cos(angle) * radius) - 100, Math.round(Math.sin(angle) * radius * 0.75) - 100, 'Idea', tint), key: `idea${i}` }
  })
  return withIds([
    { type: 'shape', kind: 'ellipse', x: -170, y: -90, w: 340, h: 180, color: '#ffffff', text: 'What problem are we solving?', key: 'topic' },
    ...notes,
    ...notes.map(
      (note, i): NewObject & { key: string } => ({
        type: 'connector',
        x: 0,
        y: 0,
        from: { id: 'topic' },
        to: { id: note.key },
        color: '#8a8a83',
        style: 'curved',
        arrows: 'none',
        key: `link${i}`,
      }),
    ),
    { type: 'section', x: 660, y: -360, w: 460, h: 720, title: 'Parking lot', color: color('Paper', SECTION_COLORS) },
  ])
}

function kanban(): BoardObject[] {
  const columns: [string, string, [string, string][]][] = [
    ['To do', 'Paper', [['Write the brief', 'Lemon'], ['Plan the kick-off', 'Lemon']]],
    ['In progress', 'Lemon', [['Collect feedback', 'Apricot']]],
    ['Done', 'Mint', [['Set up the board', 'Mint']]],
  ]
  return withIds([
    { type: 'text', x: 0, y: -110, w: 900, text: 'Team board', fontSize: 40, color: INK },
    ...columns.flatMap(([title, section, cards], i): NewObject[] => [
      { type: 'section', x: i * 460, y: 0, w: 420, h: 760, title, color: color(section, SECTION_COLORS) },
      ...cards.map(([text, tint], j) => sticky(i * 460 + 40, 70 + j * 230, text, tint)),
    ]),
  ])
}

export const BUILT_IN_TEMPLATES: readonly BuiltInTemplate[] = [
  { key: 'retro', name: 'Retrospective', description: 'What went well, what to improve, actions.', build: retro },
  { key: 'brainstorm', name: 'Brainstorm', description: 'A question in the middle, ideas around it, a parking lot.', build: brainstorm },
  { key: 'kanban', name: 'Kanban', description: 'To do, in progress, done.', build: kanban },
]

export const builtInTemplate = (key: string) => BUILT_IN_TEMPLATES.find((t) => t.key === key)
