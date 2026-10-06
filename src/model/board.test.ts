import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { Board, DEFAULT_TITLE } from './board'
import type { NewObject } from './types'

const newSticky = (x = 0, y = 0, text = ''): NewObject => ({ type: 'sticky', x, y, w: 200, h: 200, color: '#ffe58f', text })

/** Two boards wired together the way the sync server wires two browsers. */
function connectedPair() {
  const a = new Board()
  const b = new Board()
  // Each side forwards every update except the ones it received from the other.
  a.doc.on('update', (update: Uint8Array, origin: unknown) => {
    if (origin !== b) Y.applyUpdate(b.doc, update, a)
  })
  b.doc.on('update', (update: Uint8Array, origin: unknown) => {
    if (origin !== a) Y.applyUpdate(a.doc, update, b)
  })
  return { a, b }
}

describe('Board', () => {
  it('creates objects on top of each other in order', () => {
    const board = new Board()
    const [first, second] = board.createMany([newSticky(0, 0), newSticky(10, 10)])
    const third = board.create(newSticky(20, 20))
    expect(board.getSnapshot().ordered.map((o) => o.id)).toEqual([first, second, third])
  })

  it('publishes a new snapshot on every change', () => {
    const board = new Board()
    let calls = 0
    board.subscribe(() => calls++)
    const before = board.getSnapshot()
    const id = board.create(newSticky())
    board.update(id, { x: 50 })
    expect(calls).toBe(2)
    expect(board.getSnapshot()).not.toBe(before)
    expect(board.get(id)).toMatchObject({ x: 50, y: 0, type: 'sticky' })
  })

  it('keeps untouched objects identical between snapshots', () => {
    const board = new Board()
    const [a, b] = board.createMany([newSticky(), newSticky(300)])
    const before = board.getSnapshot()
    board.update(a, { text: 'changed' })
    const after = board.getSnapshot()
    expect(after.byId.get(b)).toBe(before.byId.get(b))
    expect(after.byId.get(a)).not.toBe(before.byId.get(a))
  })

  it('removes connectors with the objects they attach to', () => {
    const board = new Board()
    const [a, b] = board.createMany([newSticky(), newSticky(400)])
    const link = board.create({ type: 'connector', x: 0, y: 0, from: { id: a }, to: { id: b }, color: '#000' })
    board.remove([a])
    expect(board.get(link)).toBeUndefined()
    expect(board.get(b)).toBeDefined()
  })

  it('duplicates objects and rewires copied connectors', () => {
    const board = new Board()
    const [a, b] = board.createMany([newSticky(), newSticky(400)])
    const link = board.create({ type: 'connector', x: 0, y: 0, from: { id: a }, to: { id: b }, color: '#000' })
    const [a2, b2, link2] = board.duplicate([a, b, link])
    expect(board.get(a2)).toMatchObject({ x: 24, y: 24 })
    expect(board.get(link2)).toMatchObject({ from: { id: a2 }, to: { id: b2 } })
  })

  it('brings objects to the front', () => {
    const board = new Board()
    const [a, b, c] = board.createMany([newSticky(), newSticky(), newSticky()])
    board.bringToFront([a])
    expect(board.getSnapshot().ordered.map((o) => o.id)).toEqual([b, c, a])
  })

  it('undoes and redoes local edits, grouped by checkpoints', () => {
    const board = new Board()
    const id = board.create(newSticky())
    board.checkpoint()
    board.update(id, { x: 10 })
    board.update(id, { x: 20 })
    board.checkpoint()
    board.undo()
    expect(board.get(id)?.x).toBe(0)
    board.redo()
    expect(board.get(id)?.x).toBe(20)
    board.undo()
    board.undo()
    expect(board.get(id)).toBeUndefined()
  })

  it('has a default title', () => {
    const board = new Board()
    expect(board.getSnapshot().title).toBe(DEFAULT_TITLE)
    board.setTitle('Retro')
    expect(board.getSnapshot().title).toBe('Retro')
  })
})

describe('Board sync', () => {
  it('merges concurrent edits to different properties of the same object', () => {
    const { a, b } = connectedPair()
    const id = a.create(newSticky())
    expect(b.get(id)).toBeDefined()

    // Edits made "at the same time": exchange them only afterwards.
    const offline = new Y.Doc()
    Y.applyUpdate(offline, Y.encodeStateAsUpdate(a.doc))
    const c = new Board(offline)
    c.update(id, { color: '#a9d4ff' })
    a.update(id, { x: 300 })
    Y.applyUpdate(a.doc, Y.encodeStateAsUpdate(c.doc), 'remote')

    expect(a.get(id)).toMatchObject({ x: 300, color: '#a9d4ff' })
    expect(b.get(id)).toMatchObject({ x: 300, color: '#a9d4ff' })
  })

  it('converges when two people change the same property', () => {
    const base = new Board()
    const id = base.create(newSticky())
    const docA = new Y.Doc()
    const docB = new Y.Doc()
    Y.applyUpdate(docA, Y.encodeStateAsUpdate(base.doc))
    Y.applyUpdate(docB, Y.encodeStateAsUpdate(base.doc))
    const a = new Board(docA)
    const b = new Board(docB)
    a.update(id, { text: 'from A' })
    b.update(id, { text: 'from B' })
    Y.applyUpdate(docA, Y.encodeStateAsUpdate(docB))
    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA))
    const textA = a.get(id)?.type === 'sticky' ? a.get(id) : null
    expect(textA).toEqual(b.get(id))
    expect(['from A', 'from B']).toContain((a.get(id) as { text: string }).text)
  })

  it('only undoes edits made locally', () => {
    const { a, b } = connectedPair()
    const id = a.create(newSticky())
    a.checkpoint()
    b.update(id, { color: '#ffb3c7' })
    a.update(id, { x: 99 })
    a.checkpoint()
    a.undo()
    expect(a.get(id)).toMatchObject({ x: 0, color: '#ffb3c7' })
  })
})
