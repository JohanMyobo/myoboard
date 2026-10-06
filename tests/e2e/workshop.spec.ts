import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { addSticky, boardIdFor, objects, objectsOfType, openBoard, signIn, toScreen } from './helpers'

const synced = (page: Page) => page.waitForFunction(() => window.__myoboard?.session.provider.synced === true)

test('comment on a sticky note, reply, and resolve, live for both people', async ({ browser }, info) => {
  const boardId = boardIdFor(info)
  const alice = await (await browser.newContext()).newPage()
  const bob = await (await browser.newContext()).newPage()
  await openBoard(alice, boardId)
  await addSticky(alice, { x: 500, y: 400 }, 'Launch plan')
  await openBoard(bob, boardId)

  const [note] = await objectsOfType(alice, 'sticky')
  await alice.keyboard.press('m')
  const spot = await toScreen(alice, { x: note.x + 150, y: note.y + 40 })
  await alice.mouse.click(spot.x, spot.y)
  await alice.getByRole('textbox', { name: 'Comment' }).fill('Who owns the launch email?')
  await alice.getByRole('form', { name: 'New comment' }).getByRole('button', { name: 'Comment' }).click()

  // Bob sees the pin, opens the thread and replies.
  const pin = bob.getByRole('button', { name: /Comment by .*Who owns the launch email/ })
  await expect(pin).toBeVisible()
  await pin.click()
  await bob.getByRole('textbox', { name: 'Reply' }).fill('I do, by Friday.')
  await bob.keyboard.press('Enter')
  await expect(bob.getByRole('dialog', { name: 'Comment thread' })).toContainText('I do, by Friday.')
  await bob.getByRole('dialog', { name: 'Comment thread' }).getByRole('button', { name: 'Close' }).click()

  // Alice sees the reply in the comments panel, then resolves the thread.
  await alice.getByRole('button', { name: 'Comments' }).click()
  const panel = alice.getByRole('complementary', { name: 'Comments' })
  await expect(panel).toContainText('1 reply')
  await panel.getByRole('button', { name: /Who owns the launch email/ }).click()
  await alice.getByRole('dialog', { name: 'Comment thread' }).getByRole('button', { name: 'Resolve' }).click()
  await expect(panel.getByRole('tab', { name: 'Resolved (1)' })).toBeVisible()
  await expect(bob.getByRole('button', { name: /Comment by .*Who owns the launch email/ })).toBeHidden()

  // The pin follows the note when it moves.
  await alice.evaluate((id) => window.__myoboard!.session.board.update(id, { x: 1200 }), note.id)
  const thread = await alice.evaluate(() => window.__myoboard!.session.comments.getSnapshot().threads[0])
  expect(thread.on).toBe(note.id)
})

test('start from a template, insert another, and share one with the team', async ({ browser }) => {
  const page = await (await browser.newContext()).newPage()
  await signIn(page, 'Template Maker')
  await page.goto('/')
  await page.getByRole('button', { name: 'New Retrospective board' }).click()
  await expect(page).toHaveURL(/\/b\/[^?]+$/)
  await synced(page)
  await expect.poll(async () => (await objectsOfType(page, 'section')).map((s) => s.title)).toEqual(['What went well', 'What to improve', 'Actions'])
  await expect(page.getByRole('textbox', { name: 'Board title' })).toHaveValue('Retrospective')

  // Insert the kanban on top, then save the whole board for the team.
  await page.getByRole('button', { name: 'Templates' }).click()
  await page.getByRole('button', { name: 'Insert Kanban' }).click()
  await expect.poll(async () => (await objectsOfType(page, 'section')).length).toBe(6)
  await page.keyboard.press('Escape') // nothing selected: the whole board is saved
  await page.getByRole('button', { name: 'Templates' }).click()
  const name = `Team retro ${Date.now().toString(36)}`
  await page.getByRole('textbox', { name: 'Template name' }).fill(name)
  await page.getByRole('button', { name: 'Save this board' }).click()
  await expect(page.getByRole('dialog', { name: 'Templates' })).toContainText(name)

  // Someone else starts a board from it.
  const other = await (await browser.newContext()).newPage()
  await signIn(other, 'Colleague')
  await other.goto('/')
  await other.getByRole('button', { name: `New ${name} board` }).click()
  await synced(other)
  await expect.poll(async () => (await objectsOfType(other, 'section')).length).toBe(6)
})

test('a shared timer counts down for everyone', async ({ browser }, info) => {
  const boardId = boardIdFor(info)
  const alice = await (await browser.newContext()).newPage()
  const bob = await (await browser.newContext()).newPage()
  await openBoard(alice, boardId)
  await openBoard(bob, boardId)

  await alice.getByRole('button', { name: 'Timer' }).click()
  await alice.getByRole('button', { name: '1 min' }).click()
  const bobTimer = bob.getByRole('timer', { name: 'Shared timer' })
  await expect(bobTimer).toContainText(/0:5\d|1:00/)

  await alice.getByRole('timer', { name: 'Shared timer' }).getByRole('button', { name: 'Pause timer' }).click()
  await expect(bobTimer).toContainText('Paused')
  await alice.getByRole('timer', { name: 'Shared timer' }).getByRole('button', { name: 'Stop timer' }).click()
  await expect(bobTimer).toBeHidden()
})

test('vote on sticky notes, with results shown once the vote ends', async ({ browser }, info) => {
  const boardId = boardIdFor(info)
  const alice = await (await browser.newContext()).newPage()
  const bob = await (await browser.newContext()).newPage()
  await openBoard(alice, boardId)
  await addSticky(alice, { x: 400, y: 400 }, 'Option A')
  await addSticky(alice, { x: 800, y: 400 }, 'Option B')
  await openBoard(bob, boardId)
  await expect.poll(async () => (await objectsOfType(bob, 'sticky')).length).toBe(2)

  await alice.getByRole('button', { name: 'Vote' }).click()
  await alice.getByRole('button', { name: 'Fewer votes' }).click()
  await alice.getByRole('button', { name: 'Start voting' }).click()
  await expect(bob.getByRole('status', { name: 'Voting' })).toContainText('2 of 2 votes left')

  const [a, b] = await objectsOfType(bob, 'sticky')
  const onA = await toScreen(bob, { x: a.x + 100, y: a.y + 100 })
  const onB = await toScreen(bob, { x: b.x + 100, y: b.y + 100 })
  await bob.mouse.click(onA.x, onA.y)
  await bob.mouse.click(onA.x, onA.y + 20)
  await expect(bob.getByRole('status', { name: 'Voting' })).toContainText('0 of 2 votes left')
  // Two quick clicks are two votes, not a double-click that opens the editor.
  await expect(bob.locator('textarea.text-editor')).toHaveCount(0)
  // Out of votes: one more click does nothing; Shift-click takes one back.
  await bob.mouse.click(onB.x, onB.y)
  await bob.keyboard.down('Shift')
  await bob.mouse.click(onA.x, onA.y)
  await bob.keyboard.up('Shift')
  await bob.mouse.click(onB.x, onB.y)
  await expect(bob.getByRole('status', { name: 'Voting' })).toContainText('0 of 2 votes left')
  // Voting moved nothing.
  expect((await objectsOfType(bob, 'sticky')).map((s) => [s.x, s.y])).toEqual([[a.x, a.y], [b.x, b.y]])

  await alice.getByRole('status', { name: 'Voting' }).getByRole('button', { name: 'End vote' }).click()
  const results = bob.getByRole('status', { name: 'Vote results' })
  await expect(results).toContainText('2 votes')
  await expect(results.getByRole('listitem')).toHaveText(['1Option A', '1Option B'])
})

test('export a board as JPG or PDF, or just the selection', async ({ page }, info) => {
  await openBoard(page, boardIdFor(info))
  await addSticky(page, { x: 400, y: 400 }, 'Export me')
  await addSticky(page, { x: 900, y: 500 }, 'And me')

  const grab = async (label: string, onlySelection = false) => {
    const download = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Export', exact: true }).click()
    if (onlySelection) await page.getByRole('checkbox', { name: /Only the selection/ }).check()
    await page.getByRole('button', { name: label }).click()
    const { readFileSync } = await import('node:fs')
    const done = await download
    return { name: done.suggestedFilename(), bytes: readFileSync((await done.path())!) }
  }

  const jpg = await grab('JPG image')
  expect(jpg.name).toMatch(/\.jpg$/)
  expect([...jpg.bytes.subarray(0, 3)]).toEqual([0xff, 0xd8, 0xff])

  const pdf = await grab('PDF document')
  expect(pdf.name).toMatch(/\.pdf$/)
  expect(pdf.bytes.subarray(0, 8).toString()).toBe('%PDF-1.4')

  // One note selected: a smaller picture than the whole board.
  const [first] = await objectsOfType(page, 'sticky')
  await page.evaluate((id) => window.__myoboard!.session.board.bringToFront([id]), first.id)
  const whole = await grab('PNG image')
  const onFirst = await toScreen(page, { x: first.x + 100, y: first.y + 60 })
  await page.mouse.click(onFirst.x, onFirst.y)
  const part = await grab('PNG image', true)
  expect(part.bytes.length).toBeLessThan(whole.bytes.length)
  expect((await objects(page)).length).toBe(2)
})
