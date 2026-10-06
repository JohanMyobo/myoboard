import type { Page, TestInfo } from '@playwright/test'
import type { BoardObject } from '../../src/model/types'

export function boardIdFor(info: TestInfo): string {
  const slug = info.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40)
  return `e2e-${slug}-${Date.now().toString(36)}`
}

let people = 0

/** Signs in the page's browser context (name-and-email sign-in), unless it already is. */
export async function signIn(page: Page, name = `Tester ${++people}`): Promise<{ name: string; email: string }> {
  const me = (await (await page.request.get('/api/me')).json()) as { user: { name: string; email: string } | null }
  if (me.user) return me.user
  const email = `${name.toLowerCase().replace(/[^a-z0-9]+/g, '.')}.${Date.now().toString(36)}@example.com`
  const res = await page.request.post('/auth/local', { data: { name, email } })
  if (!res.ok()) throw new Error(`sign-in failed: ${res.status()}`)
  return { name, email }
}

/** Creates a board with this id, owned by the page's user (fine if it exists already). */
export async function createBoard(page: Page, boardId: string): Promise<void> {
  const res = await page.request.post('/api/boards', { data: { id: boardId } })
  if (res.status() !== 201 && res.status() !== 409) throw new Error(`could not create the board: ${res.status()}`)
}

/** Signs in if needed, makes sure the board exists, opens it and waits until it is synced with the server. */
export async function openBoard(page: Page, boardId: string): Promise<void> {
  await signIn(page)
  await createBoard(page, boardId)
  await page.goto(`/b/${boardId}`)
  await page.waitForFunction(() => window.__myoboard?.session.provider.synced === true)
}

export function objects(page: Page): Promise<BoardObject[]> {
  return page.evaluate(() => [...window.__myoboard!.session.board.getSnapshot().ordered])
}

export async function objectsOfType<T extends BoardObject['type']>(page: Page, type: T) {
  return (await objects(page)).filter((obj): obj is Extract<BoardObject, { type: T }> => obj.type === type)
}

export async function texts(page: Page): Promise<string[]> {
  return (await objects(page)).flatMap((obj) => ('text' in obj ? [obj.text] : []))
}

/** Screen position (in the page) of a point on the board. */
export async function toScreen(page: Page, point: { x: number; y: number }): Promise<{ x: number; y: number }> {
  return page.evaluate((p) => {
    const camera = window.__myoboard!.getCamera()
    const rect = document.querySelector('.canvas-wrap')!.getBoundingClientRect()
    return { x: rect.left + p.x * camera.scale + camera.x, y: rect.top + p.y * camera.scale + camera.y }
  }, point)
}

export async function scale(page: Page): Promise<number> {
  return page.evaluate(() => window.__myoboard!.getCamera().scale)
}

/**
 * Waits until the canvas has redrawn. Konva updates what a click hits on the
 * next frame, so a click right after a change can land where things were.
 */
export async function nextFrames(page: Page): Promise<void> {
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
}

export async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }): Promise<void> {
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(to.x, to.y, { steps: 10 })
  await page.mouse.up()
}

/** Adds a sticky note through the UI: shortcut, click, type, done. */
export async function addSticky(page: Page, at: { x: number; y: number }, text: string): Promise<void> {
  await page.keyboard.press('s')
  await page.mouse.click(at.x, at.y)
  await page.locator('textarea.text-editor').waitFor()
  await page.keyboard.type(text)
  await page.keyboard.press('Escape')
}
