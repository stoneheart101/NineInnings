import assert from 'node:assert/strict'
import test from 'node:test'
import {
  GAMES_DID_NOT_LOAD,
  KID_STATS,
  NO_GAMES_YET,
  battingAverage,
  careerFromGames,
  careerRows,
  inningsPitched,
  onBaseAverage,
  perkDetail,
  sexWord,
  statBars,
} from './kid-details.js'

test('details name a kid male or female', () => {
  assert.equal(sexWord('M'), 'MALE')
  assert.equal(sexWord('F'), 'FEMALE')
  assert.equal(sexWord(null), '')
  assert.equal(sexWord('X'), '')
})

test('the seven bars use the card order and the same integers', () => {
  const bars = statBars({
    contact: 50,
    power: 80,
    eye: 20,
    speed: 1,
    glove: 100,
    arm: 44,
    stamina: 63,
  })
  assert.deepEqual(bars.map((bar) => [bar.key, bar.label]), KID_STATS)
  assert.deepEqual(bars.map((bar) => bar.text), ['50', '80', '20', '1', '100', '44', '63'])
  assert.deepEqual(bars.map((bar) => bar.width), [50, 80, 20, 1, 100, 44, 63])
  assert.deepEqual(bars.map((bar) => bar.value), [50, 80, 20, 1, 100, 44, 63])
})

test('a missing stat is a dash and an empty bar', () => {
  for (const bar of statBars(null)) {
    assert.equal(bar.value, null)
    assert.equal(bar.text, '-')
    assert.equal(bar.width, 0)
  }
  const mixed = statBars({ contact: null, power: 12.5, eye: '80', speed: 0 })
  assert.equal(mixed[0].text, '-')
  assert.equal(mixed[0].width, 0)
  assert.equal(mixed[1].text, '-')
  assert.equal(mixed[2].text, '-')
  assert.equal(mixed[3].text, '0')
  assert.equal(mixed[3].width, 0)
  assert.equal(mixed[4].text, '-')
})

test('the home help sits on one line after a dash', () => {
  assert.equal(
    perkDetail(
      'BRINGS CAREFUL RAKING',
      'THE KID RAKES THE MOUND THE SAME WAY. HOME PITCHING KEEPS A LITTLE COMMAND.',
    ),
    'BRINGS CAREFUL RAKING -THE KID RAKES THE MOUND THE SAME WAY. HOME PITCHING KEEPS A LITTLE COMMAND.',
  )
  assert.equal(perkDetail('BRINGS MOM\'S MUFFINS', ''), 'BRINGS MOM\'S MUFFINS')
  assert.equal(perkDetail('', 'A NOTE'), 'A NOTE')
  assert.equal(perkDetail(null, null), '')
})

test('a kid with no line has not played', () => {
  assert.equal(careerFromGames([], 'kid-1'), null)
  assert.equal(careerFromGames([{ result: { lines: [{ player_id: 'other', ab: 1, h: 1, r: 0, rbi: 0, bb: 0, k: 0, outs: 0 }] } }], 'kid-1'), null)
  assert.equal(NO_GAMES_YET, 'HAS NOT PLAYED ANY GAMES YET')
  assert.equal(GAMES_DID_NOT_LOAD, 'THE GAMES DID NOT LOAD')
})

test('played lines add the usual batting totals and innings', () => {
  const games = [
    {
      result: {
        lines: [
          { player_id: 'Kid-1', ab: 4, h: 2, r: 1, rbi: 1, bb: 1, k: 1, outs: 0 },
          { player_id: 'other', ab: 3, h: 0, r: 0, rbi: 0, bb: 0, k: 2, outs: 3 },
        ],
      },
    },
    {
      result: {
        lines: [
          { player_id: 'kid-1', ab: 3, h: 1, r: 1, rbi: 0, bb: 0, k: 0, outs: 7 },
          { player_id: 'kid-1', ab: 1, h: 0, r: 0, rbi: 2, bb: 1, k: 0, outs: 0 },
        ],
      },
    },
    { result: null },
  ]
  const totals = careerFromGames(games, 'kid-1')
  assert.deepEqual(totals, { g: 2, ab: 8, h: 3, r: 2, rbi: 3, bb: 2, k: 1, outs: 7 })
  assert.equal(battingAverage(3, 8), '.375')
  assert.equal(battingAverage(1, 1), '1.000')
  assert.equal(battingAverage(0, 0), '-')
  assert.equal(onBaseAverage(3, 2, 8), '.500')
  assert.equal(onBaseAverage(0, 0, 0), '-')
  assert.equal(inningsPitched(0), '')
  assert.equal(inningsPitched(1), '0.1')
  assert.equal(inningsPitched(3), '1')
  assert.equal(inningsPitched(7), '2.1')
  assert.deepEqual(careerRows(totals).map((row) => `${row.label} ${row.value}`), [
    'G 2',
    'AB 8',
    'H 3',
    'R 2',
    'RBI 3',
    'BB 2',
    'K 1',
    'AVG .375',
    'OBP .500',
    'IP 2.1',
  ])
  assert.deepEqual(careerRows({ g: 1, ab: 0, h: 0, r: 0, rbi: 0, bb: 0, k: 0, outs: 0 }).map((row) => row.label), [
    'G', 'AB', 'H', 'R', 'RBI', 'BB', 'K', 'AVG', 'OBP',
  ])
})

test('a bar width stays inside 0 to 100 and the number stays the integer', () => {
  const bars = statBars({ contact: -4, power: 140, eye: 100 })
  assert.equal(bars[0].text, '-4')
  assert.equal(bars[0].width, 0)
  assert.equal(bars[0].value, -4)
  assert.equal(bars[1].text, '140')
  assert.equal(bars[1].width, 100)
  assert.equal(bars[1].value, 140)
  assert.equal(bars[2].text, '100')
  assert.equal(bars[2].width, 100)
})
