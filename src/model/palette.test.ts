import { describe, expect, it } from 'vitest'
import { darken, textColorOn } from './palette'

describe('darken', () => {
  it('scales each channel down', () => {
    expect(darken('#ffffff', 0.5)).toBe('#808080')
    expect(darken('#38b6ff', 0)).toBe('#38b6ff')
    expect(darken('#38B6FF', 1)).toBe('#000000')
  })

  it('leaves colours it cannot read alone', () => {
    expect(darken('red', 0.2)).toBe('red')
    expect(darken('#fff', 0.2)).toBe('#fff')
  })
})

describe('textColorOn', () => {
  it('picks white on dark fills and ink on light ones', () => {
    expect(textColorOn('#0d3272')).toBe('#ffffff')
    expect(textColorOn('#ffe47a')).not.toBe('#ffffff')
  })
})
