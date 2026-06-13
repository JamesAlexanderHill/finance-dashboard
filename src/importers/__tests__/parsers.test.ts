import { describe, expect, test, afterEach } from 'bun:test'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { rowHash } from '../shared/hash'

const FIXTURES = join(import.meta.dir, 'fixtures')
const CANONICAL_HEADER =
  'externalEventId,eventGroup,eventDescription,effectiveAt,postedAt,legDescription,legTicker,legUnitCount'

function runParser(parser: string, args: string[], outPath: string) {
  const result = Bun.spawnSync({
    cmd: ['bun', join(import.meta.dir, '..', `${parser}-parser.ts`), ...args, '--out', outPath],
    cwd: join(import.meta.dir, '..', '..', '..'),
  })
  return { exitCode: result.exitCode, stderr: result.stderr.toString() }
}

describe('importer parsers (functional)', () => {
  const outPath = join('/tmp', `parser-test-${process.pid}.csv`)

  afterEach(() => {
    if (existsSync(outPath)) rmSync(outPath)
  })

  test('amex: negates charges and uses the stripped Reference as the id', () => {
    const { exitCode } = runParser('amex', ['--in', join(FIXTURES, 'amex.csv')], outPath)
    expect(exitCode).toBe(0)

    const lines = readFileSync(outPath, 'utf8').trim().split('\n')
    expect(lines[0]).toBe(CANONICAL_HEADER)
    expect(lines).toEqual([
      CANONICAL_HEADER,
      '12345,12345,COFFEE SHOP,2025-02-01T00:00:00Z,2025-02-02T00:00:00Z,COFFEE SHOP,AUD,-1250',
      '67890,67890,REFUND STORE,2025-02-03T00:00:00Z,2025-02-03T00:00:00Z,REFUND STORE,AUD,2000',
    ])
  })

  test('commbank: uses the Reference column as the id (--has-header)', () => {
    const { exitCode } = runParser(
      'commbank',
      ['--in', join(FIXTURES, 'commbank.csv'), '--has-header'],
      outPath,
    )
    expect(exitCode).toBe(0)

    const lines = readFileSync(outPath, 'utf8').trim().split('\n')
    expect(lines).toEqual([
      CANONICAL_HEADER,
      'REF001,REF001,COFFEE SHOP,2025-02-01T00:00:00Z,2025-02-01T00:00:00Z,COFFEE SHOP,AUD,-1250',
      'REF002,REF002,SALARY,2025-02-03T00:00:00Z,2025-02-03T00:00:00Z,SALARY,AUD,100000',
    ])
  })

  test('vanguard: Deposit/Distribution produce one leg, Buy produces two legs sharing an id', () => {
    const { exitCode } = runParser('vanguard', ['--in', join(FIXTURES, 'vanguard.csv')], outPath)
    expect(exitCode).toBe(0)

    const lines = readFileSync(outPath, 'utf8').trim().split('\n')

    const depositId = rowHash(['16-Apr-2025', 'Deposit', '', '', '', '500.00'])
    const buyId = rowHash(['16-Apr-2025', 'Buy', 'Vanguard Australian Shares', 'VAS', '10', '-1000.00'])
    const distributionId = rowHash(['17-Apr-2025', 'Distribution', 'Vanguard Australian Shares', 'VAS', '', '25.50'])

    expect(lines).toEqual([
      CANONICAL_HEADER,
      `${depositId},${depositId},,2025-04-16T00:00:00Z,2025-04-16T00:00:00Z,,AUD,50000`,
      `${buyId},${buyId},Buy 10 VAS - Vanguard Australian Shares,2025-04-16T00:00:00Z,2025-04-16T00:00:00Z,Buy 10 VAS - Vanguard Australian Shares,AUD,-100000`,
      `${buyId},${buyId},Buy 10 VAS - Vanguard Australian Shares,2025-04-16T00:00:00Z,2025-04-16T00:00:00Z,Buy 10 VAS - Vanguard Australian Shares,VAS,10`,
      `${distributionId},${distributionId},Distribution - Vanguard Australian Shares,2025-04-17T00:00:00Z,2025-04-17T00:00:00Z,Distribution - Vanguard Australian Shares,AUD,2550`,
    ])
  })

  test('wise: OUT is a single leg, NEUTRAL is two legs, CANCELLED rows are skipped', () => {
    const { exitCode } = runParser('wise', ['--in', join(FIXTURES, 'wise.csv')], outPath)
    expect(exitCode).toBe(0)

    const lines = readFileSync(outPath, 'utf8').trim().split('\n')
    expect(lines).toEqual([
      CANONICAL_HEADER,
      'tx1,tx1,Some Merchant,2025-06-19T21:28:31Z,2025-06-19T21:30:00Z,Some Merchant,AUD,-5000',
      'tx2,tx2,Currency exchange AUD → NZD,2025-06-20T10:00:00Z,2025-06-20T10:00:05Z,Sold AUD,AUD,-10000',
      'tx2,tx2,Currency exchange AUD → NZD,2025-06-20T10:00:00Z,2025-06-20T10:00:05Z,Bought NZD,NZD,10850',
    ])
    expect(lines.join('\n')).not.toContain('tx3')
  })
})
