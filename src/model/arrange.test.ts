import { describe, expect, it } from 'vitest'
import { alignMoves, distributeMoves, guidesFor, movePatches, snapBox, snapPoint } from './arrange'
import type { BoardObject } from './types'

const box = (x: number, y: number, w = 100, h = 50) => ({ x, y, w, h })

describe('snapping while moving', () => {
  const others = [box(0, 0), box(300, 200, 80, 80)]

  it('pulls a nearby edge onto another box’s edge, and draws the guide', () => {
    const { dx, dy, guides } = snapBox(box(4, 120), others, 6)
    expect(dx).toBe(-4)
    expect(dy).toBe(0)
    expect(guides).toContainEqual({ axis: 'x', at: 0, from: 0, to: 170 })
  })

  it('lines centres up too', () => {
    // Its centre (52) is 2 away from the other box's centre (50).
    const { dx } = snapBox(box(2, 300), [box(0, 0)], 6)
    expect(dx).toBe(-2)
  })

  it('stays put when nothing is within reach', () => {
    expect(snapBox(box(150, 120), [box(0, 0)], 6)).toEqual({ dx: 0, dy: 0, guides: [] })
  })

  it('takes the closest line on each axis', () => {
    const { dx, dy } = snapBox(box(297, 197, 80, 80), others, 6)
    expect([dx, dy]).toEqual([3, 3])
  })

  it('merges guides on the same line into one long one', () => {
    const guides = guidesFor(box(0, 100), [box(0, 0), box(0, 300)])
    expect(guides.filter((g) => g.axis === 'x' && g.at === 0)).toEqual([{ axis: 'x', at: 0, from: 0, to: 350 }])
  })

  it('snaps a resize handle only along the axes it moves', () => {
    expect(snapPoint({ x: 97, y: 47 }, { x: true, y: false }, [box(0, 0)], 6)).toEqual({ x: 100, y: 47 })
    expect(snapPoint({ x: 97, y: 47 }, { x: true, y: true }, [box(0, 0)], 6)).toEqual({ x: 100, y: 50 })
  })
})

describe('aligning and distributing', () => {
  const items = [
    { id: 'a', box: box(0, 0) },
    { id: 'b', box: box(150, 40, 60, 100) },
    { id: 'c', box: box(400, 10, 40, 20) },
  ]

  it('aligns edges and centres on the selection’s own bounds', () => {
    expect(alignMoves(items, 'left')).toEqual(new Map([['b', { x: -150, y: 0 }], ['c', { x: -400, y: 0 }]]))
    expect(alignMoves(items, 'right').get('a')).toEqual({ x: 340, y: 0 })
    expect(alignMoves(items, 'bottom').get('c')).toEqual({ x: 0, y: 110 })
    // Middle of 0..140 is 70: a's centre (25) moves by 45.
    expect(alignMoves(items, 'middle').get('a')).toEqual({ x: 0, y: 45 })
    // Centre of 0..440 is 220: b's centre (180) moves by 40.
    expect(alignMoves(items, 'center').get('b')).toEqual({ x: 40, y: 0 })
  })

  it('needs two objects to align', () => {
    expect(alignMoves(items.slice(0, 1), 'left').size).toBe(0)
  })

  it('spaces objects out evenly between the first and the last', () => {
    // 0..100, 150..210, 400..440: 440 - 200 of objects = 240 of space, 120 per gap.
    expect(distributeMoves(items, 'x')).toEqual(new Map([['b', { x: 70, y: 0 }]]))
    expect(distributeMoves(items.slice(0, 2), 'x').size).toBe(0)
  })
})

describe('applying moves', () => {
  const section: BoardObject = { id: 's', type: 'section', index: 'a0', x: 0, y: 0, w: 400, h: 400, title: 'S', color: '#fff' }
  const inside: BoardObject = { id: 'n', type: 'sticky', index: 'a1', x: 20, y: 20, w: 100, h: 100, color: '#fff', text: '' }
  const own: BoardObject = { id: 'o', type: 'sticky', index: 'a2', x: 200, y: 200, w: 100, h: 100, color: '#fff', text: '' }
  const ordered = [section, inside, own]
  const lookup = (id: string) => ordered.find((obj) => obj.id === id)

  it('moves a section with what it holds, unless that has its own move', () => {
    const patches = movePatches(new Map([['s', { x: 10, y: 0 }], ['o', { x: -5, y: 0 }]]), ordered, lookup)
    expect(patches).toEqual([
      { id: 's', patch: { x: 10, y: 0 } },
      { id: 'o', patch: { x: 195, y: 200 } },
      { id: 'n', patch: { x: 30, y: 20 } },
    ])
  })
})
