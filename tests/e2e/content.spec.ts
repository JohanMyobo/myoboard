import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { addSticky, boardIdFor, drag, nextFrames, objectsOfType, openBoard, toScreen } from './helpers'

/** A 64x32 PNG drawn by the browser itself. */
async function pngBytes(page: Page): Promise<Buffer> {
  const base64 = await page.evaluate(async () => {
    const canvas = new OffscreenCanvas(64, 32)
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#2563eb'
    ctx.fillRect(0, 0, 64, 32)
    const blob = await canvas.convertToBlob({ type: 'image/png' })
    const bytes = new Uint8Array(await blob.arrayBuffer())
    let binary = ''
    for (const b of bytes) binary += String.fromCharCode(b)
    return btoa(binary)
  })
  return Buffer.from(base64, 'base64')
}

/** Fires a paste or drop carrying files and text, as the browser would. */
async function sendTransfer(page: Page, kind: 'paste' | 'drop', items: { png?: Buffer; text?: string; at?: { x: number; y: number } }) {
  await page.evaluate(
    ({ kind, png, text, at }) => {
      const transfer = new DataTransfer()
      if (png) transfer.items.add(new File([Uint8Array.from(atob(png), (c) => c.charCodeAt(0))], 'picture.png', { type: 'image/png' }))
      if (text) transfer.setData('text/plain', text)
      if (kind === 'paste') {
        document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }))
      } else {
        const target = document.querySelector('.canvas-wrap')!
        const init = { dataTransfer: transfer, bubbles: true, cancelable: true, clientX: at!.x, clientY: at!.y }
        target.dispatchEvent(new DragEvent('dragover', init))
        target.dispatchEvent(new DragEvent('drop', init))
      }
    },
    { kind, png: items.png?.toString('base64'), text: items.text, at: items.at },
  )
}

test('add images from the toolbar, by dropping files and by pasting', async ({ page }, info) => {
  const boardId = boardIdFor(info)
  await openBoard(page, boardId)
  const png = await pngBytes(page)

  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Image' }).click()
  await (await chooser).setFiles({ name: 'logo.png', mimeType: 'image/png', buffer: png })
  await expect.poll(async () => (await objectsOfType(page, 'image')).length).toBe(1)
  const [first] = await objectsOfType(page, 'image')
  expect(first).toMatchObject({ w: 64, h: 32, name: 'logo.png' })
  expect(first.src).toMatch(new RegExp(`^/media/${boardId}/[a-f0-9]{32}\\.png$`))

  await sendTransfer(page, 'drop', { png, at: { x: 900, y: 300 } })
  await sendTransfer(page, 'paste', { png })
  await expect.poll(async () => (await objectsOfType(page, 'image')).length).toBe(3)

  // The same picture three times is stored once: files are named by their content.
  const images = await objectsOfType(page, 'image')
  expect(new Set(images.map((image) => image.src)).size).toBe(1)

  // Pasting a list of lines makes one sticky note per line.
  await sendTransfer(page, 'paste', { text: 'Faster builds\nFewer meetings\nBetter docs' })
  await expect.poll(async () => (await objectsOfType(page, 'sticky')).map((s) => s.text).sort()).toEqual(['Better docs', 'Faster builds', 'Fewer meetings'])
})

test('copy and paste within a board and into another board, images included', async ({ browser }, info) => {
  const context = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] })
  const page = await context.newPage()
  const boardA = `${boardIdFor(info)}-a`
  const boardB = `${boardIdFor(info)}-b`
  await openBoard(page, boardA)
  await addSticky(page, { x: 400, y: 350 }, 'Copy me')
  await sendTransfer(page, 'paste', { png: await pngBytes(page) })
  await expect.poll(async () => (await objectsOfType(page, 'image')).length).toBe(1)

  await page.mouse.click(1100, 650)
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.press('ControlOrMeta+c')
  await page.mouse.move(700, 600)
  await page.keyboard.press('ControlOrMeta+v')
  await expect.poll(async () => (await objectsOfType(page, 'sticky')).map((s) => s.text)).toEqual(['Copy me', 'Copy me'])
  const sameBoard = await objectsOfType(page, 'image')
  expect(sameBoard).toHaveLength(2)
  expect(sameBoard[1].src).toBe(sameBoard[0].src)

  // The same clipboard, another board: the image is copied over to it.
  const other = await context.newPage()
  await openBoard(other, boardB)
  await other.mouse.move(640, 400)
  await other.keyboard.press('ControlOrMeta+v')
  await expect.poll(async () => (await objectsOfType(other, 'sticky')).map((s) => s.text)).toEqual(['Copy me'])
  const [copied] = await objectsOfType(other, 'image')
  expect(copied.src).toMatch(new RegExp(`^/media/${boardB}/`))
  const served = await other.request.get(copied.src)
  expect(served.headers()['content-type']).toBe('image/png')

  // Cut removes the selection after copying it.
  await other.keyboard.press('ControlOrMeta+a')
  await other.keyboard.press('ControlOrMeta+x')
  await expect.poll(async () => (await objectsOfType(other, 'sticky')).length).toBe(0)
  await other.keyboard.press('ControlOrMeta+v')
  await expect.poll(async () => (await objectsOfType(other, 'sticky')).length).toBe(1)
  await context.close()
})

test('more shapes, and elbow connectors with a label', async ({ page }, info) => {
  await openBoard(page, boardIdFor(info))

  await page.keyboard.press('r')
  await page.getByRole('group', { name: 'Shape options' }).getByRole('button', { name: 'Hexagon' }).click()
  await drag(page, { x: 300, y: 250 }, { x: 480, y: 360 })
  await expect.poll(async () => (await objectsOfType(page, 'shape'))[0]?.kind).toBe('hexagon')

  // Change it from the selection bar.
  await page.getByRole('button', { name: 'Shape: Hexagon' }).click()
  await page.getByRole('toolbar', { name: 'Selection' }).getByRole('button', { name: 'Cylinder' }).click()
  await expect.poll(async () => (await objectsOfType(page, 'shape'))[0].kind).toBe('cylinder')

  await addSticky(page, { x: 450, y: 600 }, 'Cause')
  await addSticky(page, { x: 950, y: 450 }, 'Effect')
  const [cause, effect] = await objectsOfType(page, 'sticky')
  await page.keyboard.press('c')
  await drag(page, await toScreen(page, { x: cause.x + 100, y: cause.y + 100 }), await toScreen(page, { x: effect.x + 100, y: effect.y + 100 }))
  const [link] = await objectsOfType(page, 'connector')
  expect(link).toMatchObject({ from: { id: cause.id }, to: { id: effect.id }, style: 'elbow' })

  // The new connector is selected: Enter edits its label.
  await nextFrames(page)
  await page.keyboard.press('Enter')
  await page.getByRole('textbox', { name: 'Connector label' }).fill('leads to')
  await page.keyboard.press('Enter')
  await expect.poll(async () => (await objectsOfType(page, 'connector'))[0].label).toBe('leads to')

  const bar = page.getByRole('toolbar', { name: 'Selection' })
  await bar.getByRole('button', { name: 'Curved' }).click()
  await bar.getByRole('button', { name: 'Arrows at both ends' }).click()
  await expect.poll(async () => (await objectsOfType(page, 'connector'))[0]).toMatchObject({ style: 'curved', arrows: 'both' })
})
