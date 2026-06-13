import { describe, expect, test } from 'bun:test'
import { csvEscape, parseCsv } from '../csv'

describe('parseCsv', () => {
  test('parses simple comma-separated rows', () => {
    expect(parseCsv('a,b,c\n1,2,3\n')).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', '3'],
    ])
  })

  test('handles quoted fields with embedded commas and newlines', () => {
    expect(parseCsv('a,"b,c\nd",e\n')).toEqual([['a', 'b,c\nd', 'e']])
  })

  test('unescapes doubled quotes inside quoted fields', () => {
    expect(parseCsv('"say ""hi"""\n')).toEqual([['say "hi"']])
  })

  test('handles CRLF line endings', () => {
    expect(parseCsv('a,b\r\n1,2\r\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ])
  })

  test('handles a trailing row with no newline', () => {
    expect(parseCsv('a,b\n1,2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ])
  })

  test('ignores a fully empty trailing line', () => {
    expect(parseCsv('a,b\n1,2\n\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ])
  })
})

describe('csvEscape', () => {
  test('returns plain values unchanged', () => {
    expect(csvEscape('hello')).toBe('hello')
  })

  test('quotes values containing a comma', () => {
    expect(csvEscape('a,b')).toBe('"a,b"')
  })

  test('quotes and escapes embedded double quotes', () => {
    expect(csvEscape('say "hi"')).toBe('"say ""hi"""')
  })

  test('quotes values containing newlines', () => {
    expect(csvEscape('a\nb')).toBe('"a\nb"')
  })
})
