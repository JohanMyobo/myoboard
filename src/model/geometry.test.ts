import { describe, expect, it } from 'vitest'
import {
  anchorPoint,
  anchorsOf,
  boundaryPoint,
  connectorEnds,
  connectorRoute,
  connectorTarget,
  contains,
  endpointFor,
  estimateTextHeight,
  fitFontSize,
  intersects,
  objectBounds,
  objectsInside,
  topmostAt,
} from './geometry'
import type { BoardObject } from './types'

const sticky = (id: string, x: number, y: number, index = 'a0'): BoardObject => ({
  id,
  type: 'sticky',
  index,
  x,
  y,
  w: 200,
  h: 200,
  color: '#ffe58f',
  text: '',
})

describe('boundaryPoint', () => {
  const box = { x: 0, y: 0, w: 200, h: 100 }

  it('leaves a rectangle through the nearest side', () => {
    expect(boundaryPoint(box, 'rect', { x: 500, y: 50 })).toEqual({ x: 200, y: 50 })
    expect(boundaryPoint(box, 'rect', { x: 100, y: -300 })).toEqual({ x: 100, y: 0 })
  })

  it('lands on an ellipse', () => {
    const p = boundaryPoint(box, 'ellipse', { x: 300, y: 150 })
    const value = ((p.x - 100) / 100) ** 2 + ((p.y - 50) / 50) ** 2
    expect(value).toBeCloseTo(1, 6)
  })

  it('lands on a diamond', () => {
    const p = boundaryPoint(box, 'diamond', { x: 300, y: 150 })
    expect(Math.abs(p.x - 100) / 100 + Math.abs(p.y - 50) / 50).toBeCloseTo(1, 6)
  })

  it('returns the centre when pointing at the centre', () => {
    expect(boundaryPoint(box, 'rect', { x: 100, y: 50 })).toEqual({ x: 100, y: 50 })
  })
})

describe('connectorEnds', () => {
  const a = sticky('a', 0, 0)
  const b = sticky('b', 400, 0)
  const lookup = (id: string) => ({ a, b })[id as 'a' | 'b']

  it('attaches both ends to facing sides', () => {
    expect(connectorEnds({ from: { id: 'a' }, to: { id: 'b' } }, lookup)).toEqual({
      start: { x: 200, y: 100 },
      end: { x: 400, y: 100 },
    })
  })

  it('supports a free end', () => {
    expect(connectorEnds({ from: { id: 'a' }, to: { x: 100, y: 600 } }, lookup)).toEqual({
      start: { x: 100, y: 200 },
      end: { x: 100, y: 600 },
    })
  })

  it('returns null when an attached object is gone', () => {
    expect(connectorEnds({ from: { id: 'a' }, to: { id: 'missing' } }, lookup)).toBeNull()
  })
})

describe('objectBounds', () => {
  it('measures pen strokes from their points and width', () => {
    const pen: BoardObject = { id: 'p', type: 'pen', index: 'a0', x: 10, y: 20, points: [0, 0, 100, 50], color: '#000', width: 4 }
    expect(objectBounds(pen)).toEqual({ x: 8, y: 18, w: 104, h: 54 })
  })

  it('centres stamps on their position', () => {
    const stamp: BoardObject = { id: 's', type: 'stamp', index: 'a0', x: 100, y: 100, emoji: '👍', color: '#000' }
    expect(objectBounds(stamp)).toEqual({ x: 80, y: 80, w: 40, h: 40 })
  })

  it('grows text boxes with their content', () => {
    const short: BoardObject = { id: 't', type: 'text', index: 'a0', x: 0, y: 0, w: 200, text: 'hi', fontSize: 20, color: '#000' }
    const long = { ...short, text: 'a much longer piece of text that has to wrap over several lines' }
    expect(objectBounds(long)!.h).toBeGreaterThan(objectBounds(short)!.h)
  })
})

describe('text layout', () => {
  it('wraps long paragraphs and counts explicit lines', () => {
    expect(estimateTextHeight('one\ntwo\nthree', 400, 10)).toBeCloseTo(3 * 13)
    expect(estimateTextHeight('x'.repeat(100), 56, 10)).toBeGreaterThan(estimateTextHeight('x'.repeat(10), 56, 10))
  })

  it('shrinks the font until the text fits', () => {
    expect(fitFontSize('short', 168, 148)).toBe(24)
    expect(fitFontSize('word '.repeat(80), 168, 148)).toBeLessThan(24)
  })
})

describe('hit testing', () => {
  const section: BoardObject = { id: 's', type: 'section', index: 'a0', x: -50, y: -50, w: 800, h: 600, title: 'S', color: '#fff' }
  const a = sticky('a', 0, 0, 'a1')
  const b = sticky('b', 100, 100, 'a2')
  const outside = sticky('c', 900, 900, 'a3')
  const ordered = [section, a, b, outside]

  it('picks the topmost object, then the section', () => {
    expect(topmostAt({ x: 150, y: 150 }, ordered)?.id).toBe('b')
    expect(topmostAt({ x: 10, y: 10 }, ordered)?.id).toBe('a')
    expect(topmostAt({ x: 700, y: 500 }, ordered)?.id).toBe('s')
    expect(topmostAt({ x: 700, y: 500 }, ordered, { includeSections: false })).toBeNull()
  })

  it('finds what a section holds', () => {
    const lookup = (id: string) => ordered.find((o) => o.id === id)
    expect(objectsInside(objectBounds(section)!, ordered, lookup).map((o) => o.id)).toEqual(['a', 'b'])
  })

  it('compares boxes', () => {
    expect(intersects({ x: 0, y: 0, w: 10, h: 10 }, { x: 5, y: 5, w: 10, h: 10 })).toBe(true)
    expect(intersects({ x: 0, y: 0, w: 10, h: 10 }, { x: 11, y: 0, w: 10, h: 10 })).toBe(false)
    expect(contains({ x: 0, y: 0, w: 10, h: 10 }, { x: 2, y: 2, w: 5, h: 5 })).toBe(true)
  })
})

describe('connector routes', () => {
  const a = { id: 'a', type: 'sticky', index: 'a0', x: 0, y: 0, w: 100, h: 100, color: '#fff', text: '' } as const
  const b = { id: 'b', type: 'sticky', index: 'a1', x: 300, y: 200, w: 100, h: 100, color: '#fff', text: '' } as const
  const lookup = (id: string) => ({ a, b })[id as 'a' | 'b']

  it('runs elbows from the facing sides, bending halfway', () => {
    const route = connectorRoute({ from: { id: 'a' }, to: { id: 'b' }, style: 'elbow' }, lookup)!
    expect(route.points).toEqual([100, 50, 200, 50, 200, 250, 300, 250])
    expect(route.mid).toEqual({ x: 200, y: 150 })
  })

  it('turns an elbow vertical when the ends are mostly above each other', () => {
    const below = { ...b, x: 50, y: 400 }
    const route = connectorRoute({ from: { id: 'a' }, to: { id: 'b' }, style: 'elbow' }, (id) => (id === 'a' ? a : below))!
    expect(route.points.slice(0, 2)).toEqual([50, 100])
    expect(route.points.slice(-2)).toEqual([100, 400])
  })

  it('drops the bends of an elbow between aligned objects', () => {
    const level = { ...b, y: 0 }
    const route = connectorRoute({ from: { id: 'a' }, to: { id: 'b' }, style: 'elbow' }, (id) => (id === 'a' ? a : level))!
    expect(route.points).toEqual([100, 50, 300, 50])
  })

  it('curves leave and arrive along the facing sides', () => {
    const route = connectorRoute({ from: { id: 'a' }, to: { id: 'b' }, style: 'curved' }, lookup)!
    expect(route.bezier).toBe(true)
    const [sx, sy, c1x, c1y, c2x, c2y, ex, ey] = route.points
    expect([sx, sy, ex, ey]).toEqual([100, 50, 300, 250])
    expect(c1y).toBe(sy)
    expect(c1x).toBeGreaterThan(sx)
    expect(c2y).toBe(ey)
    expect(c2x).toBeLessThan(ex)
  })

  it('keeps old connectors straight', () => {
    const route = connectorRoute({ from: { id: 'a' }, to: { id: 'b' } }, lookup)!
    expect(route.points).toHaveLength(4)
    expect(route.bezier).toBe(false)
  })

  it('bounds a connector by its whole route', () => {
    const conn = { id: 'c', type: 'connector', index: 'a2', x: 0, y: 0, from: { id: 'a' }, to: { id: 'b' }, color: '#000', style: 'elbow' } as const
    expect(objectBounds(conn, lookup)).toEqual({ x: 100, y: 50, w: 200, h: 200 })
  })
})

describe('anchor points', () => {
  const a = { id: 'a', type: 'sticky', index: 'a0', x: 0, y: 0, w: 100, h: 100, color: '#fff', text: '' } as const
  const b = { id: 'b', type: 'sticky', index: 'a1', x: 300, y: 200, w: 100, h: 100, color: '#fff', text: '' } as const
  const diamond = { id: 'd', type: 'shape', kind: 'diamond', index: 'a2', x: 600, y: 0, w: 200, h: 100, color: '#fff', text: '' } as const
  const lookup = (id: string) => ({ a, b, d: diamond })[id as 'a' | 'b' | 'd']
  const ordered: BoardObject[] = [a, b, diamond]

  it('puts one anchor in the middle of each side, on the outline', () => {
    expect(anchorsOf(a)).toEqual([
      { side: 'top', point: { x: 50, y: 0 } },
      { side: 'right', point: { x: 100, y: 50 } },
      { side: 'bottom', point: { x: 50, y: 100 } },
      { side: 'left', point: { x: 0, y: 50 } },
    ])
    // A diamond's anchors are its corners.
    expect(anchorPoint({ x: 600, y: 0, w: 200, h: 100 }, 'diamond', 'right')).toEqual({ x: 800, y: 50 })
  })

  it('snaps an end to an anchor within reach, even from just outside the object', () => {
    expect(connectorTarget({ x: 108, y: 54 }, ordered, 12)).toEqual({ id: 'a', side: 'right', point: { x: 100, y: 50 } })
    expect(connectorTarget({ x: 52, y: 6 }, ordered, 12)).toMatchObject({ id: 'a', side: 'top' })
  })

  it('attaches to the whole object away from its anchors, and leaves open space free', () => {
    expect(connectorTarget({ x: 30, y: 30 }, ordered, 12)).toEqual({ id: 'a', point: { x: 50, y: 50 } })
    expect(connectorTarget({ x: 200, y: 140 }, ordered, 12)).toBeNull()
    expect(connectorTarget({ x: 108, y: 54 }, ordered, 12, new Set(['a']))).toBeNull()
  })

  it('stores a side only when the end snapped to one', () => {
    expect(endpointFor({ id: 'a', side: 'top', point: { x: 50, y: 0 } }, { x: 1, y: 1 })).toEqual({ id: 'a', side: 'top' })
    expect(endpointFor({ id: 'a', point: { x: 50, y: 50 } }, { x: 1, y: 1 })).toEqual({ id: 'a' })
    expect(endpointFor(null, { x: 12.345, y: 6.789 })).toEqual({ x: 12.3, y: 6.8 })
  })

  it('runs a pinned straight connector from anchor to anchor', () => {
    const route = connectorRoute({ from: { id: 'a', side: 'bottom' }, to: { id: 'b', side: 'top' } }, lookup)!
    expect(route.points).toEqual([50, 100, 350, 200])
  })

  it('leaves a pinned side straight out, then bends at right angles', () => {
    const route = connectorRoute({ from: { id: 'a', side: 'bottom' }, to: { id: 'b', side: 'left' }, style: 'elbow' }, lookup)!
    expect(route.points).toEqual([50, 100, 50, 250, 300, 250])
    const vertical = connectorRoute({ from: { id: 'a', side: 'bottom' }, to: { id: 'b', side: 'top' }, style: 'elbow' }, lookup)!
    expect(vertical.points).toEqual([50, 100, 50, 150, 350, 150, 350, 200])
    expect(vertical.mid).toEqual({ x: 200, y: 150 })
  })

  it('curves out of pinned sides', () => {
    const route = connectorRoute({ from: { id: 'a', side: 'top' }, to: { id: 'b', side: 'right' }, style: 'curved' }, lookup)!
    const [sx, sy, c1x, c1y, c2x, c2y, ex, ey] = route.points
    expect([sx, sy, ex, ey]).toEqual([50, 0, 400, 250])
    expect(c1x).toBe(sx)
    expect(c1y).toBeLessThan(sy)
    expect(c2y).toBe(ey)
    expect(c2x).toBeGreaterThan(ex)
  })

  it('pins one end and lets the other follow round', () => {
    const route = connectorRoute({ from: { id: 'a', side: 'right' }, to: { id: 'b' } }, lookup)!
    expect(route.start).toEqual({ x: 100, y: 50 })
    expect(route.end.x).toBe(300)
  })
})
