import { expect, test } from '@playwright/test'
import { addSticky, boardIdFor, drag, objects, objectsOfType, openBoard, scale, texts, toScreen } from './helpers'

test('two people see each other’s edits and cursors live', async ({ browser }, info) => {
  const boardId = boardIdFor(info)
  const alice = await browser.newContext()
  const bob = await browser.newContext()
  const a = await alice.newPage()
  const b = await bob.newPage()
  await openBoard(a, boardId)
  await openBoard(b, boardId)

  // Alice adds a sticky note; Bob sees it, text included.
  await a.getByRole('button', { name: 'Sticky note' }).click()
  await a.mouse.click(400, 400)
  await a.keyboard.type('Ship the MVP')
  await a.keyboard.press('Escape')
  await expect.poll(() => texts(b)).toContain('Ship the MVP')

  // Bob drags it; Alice sees it move.
  const [sticky] = await objectsOfType(b, 'sticky')
  const from = await toScreen(b, { x: sticky.x + 100, y: sticky.y + 100 })
  await drag(b, from, { x: from.x + 150, y: from.y + 80 })
  const moved = 150 / (await scale(b))
  await expect.poll(async () => Math.round((await objectsOfType(a, 'sticky'))[0].x - sticky.x)).toBe(Math.round(moved))

  // Alice sees Bob's cursor, labelled with his name.
  await b.mouse.move(700, 300)
  await b.mouse.move(720, 320)
  const bobName = await b.evaluate(() => window.__myoboard!.session.awareness.getLocalState()?.user.name as string)
  await expect(a.locator('.peer-cursor', { hasText: bobName })).toBeVisible()
  // ...and both appear in each other's presence list.
  await expect(a.locator('.avatars .avatar')).toHaveCount(2)

  await alice.close()
  await bob.close()
})

test('a board survives reloads and opens on another device', async ({ browser }, info) => {
  const boardId = boardIdFor(info)
  const first = await browser.newContext()
  const page = await first.newPage()
  await openBoard(page, boardId)

  await addSticky(page, { x: 500, y: 400 }, 'Persist me')
  await page.keyboard.press('t')
  await page.mouse.click(820, 300)
  await page.keyboard.type('A text label')
  await page.keyboard.press('Escape')
  await page.getByRole('textbox', { name: 'Board title' }).fill('Sprint retro')
  await page.getByRole('textbox', { name: 'Board title' }).press('Enter')

  await page.reload()
  await openBoard(page, boardId)
  await expect.poll(() => texts(page)).toEqual(expect.arrayContaining(['Persist me', 'A text label']))
  await expect(page.getByRole('textbox', { name: 'Board title' })).toHaveValue('Sprint retro')

  // A fresh browser profile has no local copy: everything comes from the server.
  const second = await browser.newContext()
  const fresh = await second.newPage()
  await openBoard(fresh, boardId)
  await expect.poll(() => texts(fresh)).toEqual(expect.arrayContaining(['Persist me', 'A text label']))

  await first.close()
  await second.close()
})

test('connectors follow objects, sections carry their content, undo reverts', async ({ page }, info) => {
  await openBoard(page, boardIdFor(info))
  await addSticky(page, { x: 450, y: 450 }, 'Idea A')
  await addSticky(page, { x: 850, y: 450 }, 'Idea B')
  const [a, b] = await objectsOfType(page, 'sticky')

  // Connect A to B.
  await page.keyboard.press('c')
  await drag(page, await toScreen(page, { x: a.x + 100, y: a.y + 100 }), await toScreen(page, { x: b.x + 100, y: b.y + 100 }))
  const [link] = await objectsOfType(page, 'connector')
  expect(link.from).toEqual({ id: a.id })
  expect(link.to).toEqual({ id: b.id })

  // Draw a section around both, then move it by its title.
  await page.keyboard.press('f')
  await drag(page, await toScreen(page, { x: a.x - 80, y: a.y - 80 }), await toScreen(page, { x: b.x + 280, y: b.y + 280 }))
  const [section] = await objectsOfType(page, 'section')
  expect(section.title).toBe('Section 1')
  const title = await toScreen(page, { x: section.x + 40, y: section.y + 22 })
  await drag(page, title, { x: title.x + 120, y: title.y + 60 })
  const dx = 120 / (await scale(page))
  await expect.poll(async () => Math.round((await objectsOfType(page, 'sticky'))[0].x - a.x)).toBe(Math.round(dx))
  expect(Math.round((await objectsOfType(page, 'section'))[0].x - section.x)).toBe(Math.round(dx))

  // Undo puts everything back.
  await page.keyboard.press('Control+z')
  await expect.poll(async () => (await objectsOfType(page, 'sticky'))[0].x).toBe(a.x)

  // Deleting a sticky removes the connector attached to it.
  const aNow = (await objectsOfType(page, 'sticky'))[0]
  const onA = await toScreen(page, { x: aNow.x + 100, y: aNow.y + 60 })
  await page.mouse.click(onA.x, onA.y)
  await page.keyboard.press('Delete')
  await expect.poll(async () => (await objectsOfType(page, 'connector')).length).toBe(0)
  expect((await objectsOfType(page, 'sticky')).map((s) => s.text)).toEqual(['Idea B'])
})

test('pen strokes, shapes with text, stamps and PNG export', async ({ page }, info) => {
  await openBoard(page, boardIdFor(info))

  // A pen stroke.
  await page.keyboard.press('p')
  await page.mouse.move(300, 500)
  await page.mouse.down()
  for (let i = 1; i <= 20; i++) await page.mouse.move(300 + i * 12, 500 + Math.sin(i / 2) * 30)
  await page.mouse.up()
  const [stroke] = await objectsOfType(page, 'pen')
  expect(stroke.points.length).toBeGreaterThanOrEqual(10)

  // An ellipse with a label, set from the tool options.
  await page.keyboard.press('r')
  await page.getByRole('group', { name: 'Shape options' }).getByRole('button', { name: 'Ellipse' }).click()
  await drag(page, { x: 650, y: 250 }, { x: 850, y: 380 })
  await page.keyboard.press('Enter')
  await page.locator('textarea.text-editor').waitFor()
  await page.keyboard.type('Decision')
  await page.keyboard.press('Escape')
  const [shape] = await objectsOfType(page, 'shape')
  expect(shape).toMatchObject({ kind: 'ellipse', text: 'Decision' })

  // Two reaction stamps.
  await page.keyboard.press('e')
  await page.mouse.click(900, 550)
  await page.mouse.click(950, 560)
  expect(await objectsOfType(page, 'stamp')).toHaveLength(2)
  await page.keyboard.press('v')

  // Export downloads a PNG of the whole board.
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export PNG' }).click()
  const file = await (await download).path()
  const { readFileSync } = await import('node:fs')
  const bytes = readFileSync(file!)
  expect(bytes.subarray(1, 4).toString()).toBe('PNG')
  expect(bytes.length).toBeGreaterThan(2_000)
  expect((await objects(page)).length).toBe(4)
})
