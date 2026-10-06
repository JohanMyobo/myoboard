import { describe, expect, it } from 'vitest'
import { jpegToPdf } from './pdf'

describe('PDF export', () => {
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 0xff, 0xd9])
  const pdf = jpegToPdf(jpeg, 800, 600)
  const text = new TextDecoder('latin1').decode(pdf)

  it('is a PDF whose page has the image size, in points', () => {
    expect(text.startsWith('%PDF-1.4\n')).toBe(true)
    expect(text).toContain('/MediaBox [0 0 600 450]')
    expect(text).toContain('/Width 800 /Height 600')
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true)
  })

  it('has a cross-reference table that points at every object', () => {
    const start = Number(/startxref\n(\d+)/.exec(text)![1])
    expect(text.slice(start, start + 4)).toBe('xref')
    const entries = text.slice(start).split('\n').slice(3, 8)
    entries.forEach((entry, i) => {
      expect(entry).toHaveLength(19) // 20 bytes with the newline
      const offset = Number(entry.slice(0, 10))
      expect(text.slice(offset, offset + 8)).toBe(`${i + 1} 0 obj\n`)
    })
  })

  it('embeds the JPEG bytes untouched', () => {
    const at = text.indexOf('stream\n\xff\xd8') + 'stream\n'.length
    expect([...pdf.slice(at, at + jpeg.length)]).toEqual([...jpeg])
  })

  it('keeps huge boards within the page size readers accept', () => {
    const big = new TextDecoder('latin1').decode(jpegToPdf(jpeg, 40_000, 20_000))
    expect(big).toContain('/MediaBox [0 0 14400 7200]')
  })
})
