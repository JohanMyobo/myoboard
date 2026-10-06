import { describe, expect, it } from 'vitest'
import { Board } from './model/board'
import { boundsOf, copySelection, parsePayload, pasteable, plainText, textToObjects } from './clipboard'

function sampleBoard() {
  const board = new Board()
  const [section, inside, outside] = board.createMany([
    { type: 'section', x: 0, y: 0, w: 500, h: 400, title: 'Ideas', color: '#f7f6f2' },
    { type: 'sticky', x: 40, y: 60, w: 200, h: 200, color: '#ffe58f', text: 'Inside' },
    { type: 'sticky', x: 800, y: 60, w: 200, h: 200, color: '#ffe58f', text: 'Outside' },
  ])
  const [link] = board.createMany([{ type: 'connector', x: 0, y: 0, from: { id: inside }, to: { id: outside }, color: '#000', style: 'elbow', label: 'next' }])
  return { board, section, inside, outside, link }
}

describe('copy and paste', () => {
  it('takes what a section holds, and connectors between copied objects', () => {
    const { board, section, inside, outside, link } = sampleBoard()
    const payload = copySelection(board.getSnapshot(), [section, outside], 'board-a')!
    expect(payload.objects.map((obj) => obj.id).sort()).toEqual([section, inside, outside, link].sort())
    expect(plainText(payload).split('\n').sort()).toEqual(['Ideas', 'Inside', 'Outside', 'next'])
  })

  it('frees a connector end attached to something left behind', () => {
    const { board, inside, link } = sampleBoard()
    const payload = copySelection(board.getSnapshot(), [inside, link], 'board-a')!
    const copied = payload.objects.find((obj) => obj.id === link)!
    expect(copied.type === 'connector' && copied.from).toEqual({ id: inside })
    expect(copied.type === 'connector' && 'x' in copied.to).toBe(true)
  })

  it('pastes copies with new ids, connectors following the copies, as one undo step', () => {
    const { board, section } = sampleBoard()
    const payload = copySelection(board.getSnapshot(), [section], 'board-a')!
    board.checkpoint()
    const ids = board.insertCopies(payload.objects, { x: 0, y: 1000 })
    expect(ids).toHaveLength(payload.objects.length)
    const copies = ids.map((id) => board.get(id)!)
    const copiedLink = copies.find((obj) => obj.type === 'connector')
    // Only section + inside were copied: the connector to "Outside" stays behind.
    expect(copiedLink).toBeUndefined()
    expect(copies.every((obj) => obj.type === 'connector' || obj.y >= 1000)).toBe(true)
    board.undo()
    expect(ids.every((id) => board.get(id) === undefined)).toBe(true)
  })

  it('remaps connectors between pasted objects to the pasted copies', () => {
    const { board, inside, outside } = sampleBoard()
    const payload = copySelection(board.getSnapshot(), [inside, outside], 'board-a')!
    const ids = board.insertCopies(payload.objects, { x: 0, y: 500 })
    const link = ids.map((id) => board.get(id)!).find((obj) => obj.type === 'connector')!
    expect(link.type === 'connector' && [link.from, link.to]).toEqual([{ id: ids[0] }, { id: ids[1] }])
  })

  it('reads back only well-formed payloads', () => {
    expect(parsePayload('not json')).toBeNull()
    expect(parsePayload(JSON.stringify({ myoboard: 2, board: 'x', objects: [] }))).toBeNull()
    const ok = parsePayload(JSON.stringify({ myoboard: 1, board: 'x', objects: [{ id: 'a', type: 'sticky' }, 'junk'] }))
    expect(ok?.objects).toHaveLength(1)
  })

  it('drops connectors attached to objects that are nowhere', () => {
    const objects = [{ id: 'c', type: 'connector', index: 'a0', x: 0, y: 0, from: { id: 'gone' }, to: { x: 1, y: 1 }, color: '#000' }] as const
    expect(pasteable([...objects], () => false)).toEqual([])
    expect(pasteable([...objects], (id) => id === 'gone')).toHaveLength(1)
  })

  it('measures what is pasted, connectors resolved among the pasted objects', () => {
    const { board, inside, outside } = sampleBoard()
    const payload = copySelection(board.getSnapshot(), [inside, outside], 'board-a')!
    expect(boundsOf(payload.objects)).toEqual({ x: 40, y: 60, w: 960, h: 200 })
  })

  it('turns a pasted list into sticky notes, and long text into a text block', () => {
    const notes = textToObjects('First idea\nSecond idea\n\nThird idea', { x: 0, y: 0 }, 'Ada', '#ffe58f')
    expect(notes.map((obj) => obj.type)).toEqual(['sticky', 'sticky', 'sticky'])
    expect(notes.map((obj) => ('text' in obj ? obj.text : ''))).toEqual(['First idea', 'Second idea', 'Third idea'])
    const essay = textToObjects('x'.repeat(500), { x: 0, y: 0 }, 'Ada', '#ffe58f')
    expect(essay).toHaveLength(1)
    expect(essay[0].type).toBe('text')
  })
})
