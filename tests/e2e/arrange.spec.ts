import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { boardIdFor, drag, nextFrames, objects, objectsOfType, openBoard, toScreen } from './helpers'

/** Adds rectangles straight through the board model; returns their ids. */
async function addShapes(page: Page, boxes: { x: number; y: number; w: number; h: number }[]): Promise<string[]> {
  const ids = await page.evaluate((list) => {
    const board = window.__myoboard!.session.board
    return list.map((box) => board.create({ type: 'shape', kind: 'rect', ...box, color: '#ffffff', text: '' }))
  }, boxes)
  await nextFrames(page)
  return ids
}

async function byId(page: Page, id: string) {
  return (await objects(page)).find((obj) => obj.id === id)!
}

test('connectors snap to anchor points, and their ends can be moved', async ({ page }, info) => {
  await openBoard(page, boardIdFor(info))
  const [a, b, c] = await addShapes(page, [
    { x: -450, y: -50, w: 160, h: 100 },
    { x: 150, y: 100, w: 160, h: 100 },
    { x: 150, y: -250, w: 160, h: 100 },
  ])

  // From just outside A's right anchor to just outside B's left one: both snap.
  await page.keyboard.press('c')
  await drag(page, await toScreen(page, { x: -284, y: 4 }), await toScreen(page, { x: 144, y: 146 }))
  await expect.poll(async () => (await objectsOfType(page, 'connector')).length).toBe(1)
  const [link] = await objectsOfType(page, 'connector')
  expect(link.from).toEqual({ id: a, side: 'right' })
  expect(link.to).toEqual({ id: b, side: 'left' })

  // The new connector is selected: drag its end handle onto C's top anchor.
  await nextFrames(page)
  await drag(page, await toScreen(page, { x: 150, y: 150 }), await toScreen(page, { x: 236, y: -256 }))
  await expect.poll(async () => (await byId(page, link.id)).type === 'connector' && (await objectsOfType(page, 'connector'))[0].to).toEqual({ id: c, side: 'top' })

  // Dropped in the open, the start comes loose there; undo puts it back.
  await nextFrames(page)
  await drag(page, await toScreen(page, { x: -290, y: 0 }), await toScreen(page, { x: -300, y: 250 }))
  await expect.poll(async () => (await objectsOfType(page, 'connector'))[0].from).toMatchObject({ x: expect.closeTo(-300, 0), y: expect.closeTo(250, 0) })
  await page.keyboard.press('ControlOrMeta+z')
  await expect.poll(async () => (await objectsOfType(page, 'connector'))[0].from).toEqual({ id: a, side: 'right' })
})

test('objects snap into line with their neighbours while moving; Alt moves freely', async ({ page }, info) => {
  await openBoard(page, boardIdFor(info))
  const [, b] = await addShapes(page, [
    { x: -300, y: -100, w: 160, h: 100 },
    { x: 100, y: 60, w: 160, h: 100 },
  ])

  // Dropped 4 px below the other shape's top, B snaps level with it.
  await drag(page, await toScreen(page, { x: 180, y: 110 }), await toScreen(page, { x: 200, y: -46 }))
  await expect.poll(async () => (await byId(page, b)) as { x: number; y: number }).toMatchObject({ x: 120, y: -100 })

  // Holding Alt, the same small nudge is kept as is.
  await nextFrames(page)
  await page.keyboard.down('Alt')
  await drag(page, await toScreen(page, { x: 200, y: -50 }), await toScreen(page, { x: 200, y: -47 }))
  await page.keyboard.up('Alt')
  await expect.poll(async () => ((await byId(page, b)) as { y: number }).y).toBe(-97)
})

test('align and distribute several objects at once', async ({ page }, info) => {
  await openBoard(page, boardIdFor(info))
  const ids = await addShapes(page, [
    { x: -400, y: -150, w: 100, h: 60 },
    { x: -150, y: -60, w: 140, h: 80 },
    { x: 200, y: 20, w: 80, h: 120 },
  ])
  await page.mouse.click(1100, 650)
  await page.keyboard.press('ControlOrMeta+a')
  const bar = page.getByRole('toolbar', { name: 'Selection' })
  await bar.getByRole('button', { name: 'Align', exact: true }).click()

  await page.getByRole('button', { name: 'Align top' }).click()
  await expect.poll(async () => (await objectsOfType(page, 'shape')).map((s) => s.y)).toEqual([-150, -150, -150])

  // 680 across, 320 of shapes: 180 between each, so the middle one starts at -120.
  await page.getByRole('button', { name: 'Distribute horizontally' }).click()
  await expect.poll(async () => ((await byId(page, ids[1])) as { x: number }).x).toBe(-120)

  // Each arrangement is one undo step.
  await page.keyboard.press('ControlOrMeta+z')
  await expect.poll(async () => ((await byId(page, ids[1])) as { x: number }).x).toBe(-150)
  expect(((await byId(page, ids[1])) as { y: number }).y).toBe(-150)
})

test('resize from a generous grip, snap edges to neighbours, and resize several objects together', async ({ page }, info) => {
  await openBoard(page, boardIdFor(info))
  const [a, b] = await addShapes(page, [
    { x: -300, y: -100, w: 160, h: 100 },
    { x: 0, y: -100, w: 160, h: 100 },
  ])
  const size = async (id: string) => {
    const obj = (await byId(page, id)) as { x: number; y: number; w: number; h: number }
    return { x: Math.round(obj.x), y: Math.round(obj.y), w: Math.round(obj.w), h: Math.round(obj.h) }
  }
  await page.mouse.click(...Object.values(await toScreen(page, { x: -220, y: -50 })) as [number, number])
  await nextFrames(page)

  // The corner handle answers 6 px away from its centre.
  await drag(page, await toScreen(page, { x: -134, y: 6 }), await toScreen(page, { x: -94, y: 46 }))
  await expect.poll(() => size(a)).toEqual({ x: -300, y: -100, w: 200, h: 140 })

  // The right edge is a bar; dropped 3 px short of B, it snaps against B's left edge.
  await nextFrames(page)
  await drag(page, await toScreen(page, { x: -97, y: -30 }), await toScreen(page, { x: -3, y: -30 }))
  await expect.poll(() => size(a)).toEqual({ x: -300, y: -100, w: 300, h: 140 })

  // Both selected: one frame around them, and they scale together.
  await page.keyboard.down('Shift')
  await page.mouse.click(...Object.values(await toScreen(page, { x: 80, y: -50 })) as [number, number])
  await page.keyboard.up('Shift')
  await nextFrames(page)
  await drag(page, await toScreen(page, { x: 160, y: 40 }), await toScreen(page, { x: 390, y: 110 }))
  await expect.poll(() => size(b)).toEqual({ x: 150, y: -100, w: 240, h: 150 })
  expect(await size(a)).toEqual({ x: -300, y: -100, w: 450, h: 210 })
})
