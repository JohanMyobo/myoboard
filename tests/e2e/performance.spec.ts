import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { boardIdFor, openBoard } from './helpers'

/** Pans in a loop for 150 frames and returns the median and p95 frame time. */
async function measurePan(page: Page): Promise<{ median: number; p95: number }> {
  const frames = await page.evaluate(async () => {
    const handle = window.__myoboard!
    const start = handle.getCamera()
    const times: number[] = []
    let last = performance.now()
    await new Promise<void>((resolve) => {
      let i = 0
      const step = (now: number) => {
        times.push(now - last)
        last = now
        handle.setCamera({ ...start, x: start.x + Math.sin(i / 10) * 200, y: start.y + Math.cos(i / 10) * 100 })
        if (++i < 150) requestAnimationFrame(step)
        else resolve()
      }
      requestAnimationFrame(step)
    })
    return times.slice(10)
  })
  const sorted = [...frames].sort((a, b) => a - b)
  return { median: sorted[Math.floor(sorted.length / 2)], p95: sorted[Math.floor(sorted.length * 0.95)] }
}

test('stays fluid with 500 sticky notes', async ({ page }, info) => {
  await openBoard(page, boardIdFor(info))
  await page.evaluate(() => {
    window.__myoboard!.session.board.createMany(
      Array.from({ length: 500 }, (_, i) => ({
        type: 'sticky' as const,
        x: (i % 25) * 220,
        y: Math.floor(i / 25) * 220,
        w: 200,
        h: 200,
        color: '#ffe58f',
        text: `Idea ${i + 1}: something worth discussing with the team`,
        author: 'Load test',
      })),
    )
  })

  // Overview: all 500 on screen at once.
  await page.getByRole('button', { name: 'Zoom to fit' }).click()
  const overview = await measurePan(page)

  // Working zoom: 100%, text drawn, the rest of the board off screen.
  await page.getByRole('button', { name: 'Reset zoom to 100%' }).click()
  const working = await measurePan(page)

  const summary =
    `500 stickies, ms per frame while panning — overview: median ${overview.median.toFixed(1)}, p95 ${overview.p95.toFixed(1)}; ` +
    `100% zoom: median ${working.median.toFixed(1)}, p95 ${working.p95.toFixed(1)}`
  info.annotations.push({ type: 'performance', description: summary })
  console.log(summary)
  // Headless Chromium draws in software; a real browser with a GPU does better.
  // 34 ms is two frames at 60 Hz, i.e. at least 30 frames per second.
  expect(overview.median).toBeLessThan(34)
  expect(working.median).toBeLessThan(34)
})
