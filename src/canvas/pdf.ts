/**
 * A one-page PDF around a JPEG, written by hand: the format only needs a
 * few objects for this, so no library is worth it.
 */

const encoder = new TextEncoder()
/** Largest page side PDF readers accept, in points. */
const MAX_POINTS = 14_400

export function jpegToPdf(jpeg: Uint8Array, widthPx: number, heightPx: number): Uint8Array<ArrayBuffer> {
  // CSS pixels are 1/96 inch, PDF points 1/72.
  let w = widthPx * 0.75
  let h = heightPx * 0.75
  const shrink = Math.min(1, MAX_POINTS / Math.max(w, h))
  w = Math.round(w * shrink * 100) / 100
  h = Math.round(h * shrink * 100) / 100

  const chunks: Uint8Array[] = []
  const offsets: number[] = []
  let length = 0
  const write = (chunk: string | Uint8Array) => {
    const bytes = typeof chunk === 'string' ? encoder.encode(chunk) : chunk
    chunks.push(bytes)
    length += bytes.length
  }
  const object = (n: number, ...body: (string | Uint8Array)[]) => {
    offsets[n] = length
    write(`${n} 0 obj\n`)
    body.forEach(write)
    write('\nendobj\n')
  }

  const content = `q ${w} 0 0 ${h} 0 0 cm /Im0 Do Q`
  write('%PDF-1.4\n')
  object(1, '<< /Type /Catalog /Pages 2 0 R >>')
  object(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>')
  object(3, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`)
  object(
    4,
    `<< /Type /XObject /Subtype /Image /Width ${widthPx} /Height ${heightPx} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`,
    jpeg,
    '\nendstream',
  )
  object(5, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`)

  const xref = length
  write(`xref\n0 6\n0000000000 65535 f \n`)
  for (let n = 1; n <= 5; n++) write(`${String(offsets[n]).padStart(10, '0')} 00000 n \n`)
  write(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`)

  const out = new Uint8Array(length)
  let at = 0
  for (const chunk of chunks) {
    out.set(chunk, at)
    at += chunk.length
  }
  return out
}
