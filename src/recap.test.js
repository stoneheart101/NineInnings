import assert from 'node:assert/strict'
import test from 'node:test'
import { recapClose, recapMarks, recapParts, recapPieces } from './recap.js'

const away = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const home = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'

function line(team, name, marks) {
  return { team_id: team, name, ab: 4, h: 0, r: 0, rbi: 0, bb: 0, k: 0, outs: 0, ...marks }
}

const called = {
  weather: {
    forecast: {
      sky: 'cloudy',
      heat: 'cool',
      wind: 'in',
      wind_speed: 'breeze',
      temp: 58,
      report: 'FROM THE WEATHER DESK. THIS ONE LOOKS MOSTLY CLOUDY AND COOL, ABOUT 58 DEGREES, WITH A LIGHT BREEZE BLOWING IN.',
    },
    opening: {
      sky: 'cloudy',
      heat: 'cool',
      wind: 'in',
      wind_speed: 'wind',
      temp: 56,
      report: 'LIVE FROM THE PARK. MOSTLY CLOUDY AND COOL, 56 DEGREES, WITH A STEADY WIND BLOWING IN. THE BREEZE PICKED UP. IT IS A LITTLE COOLER THAN WE CALLED.',
    },
    shift: {
      inning: 4,
      half: 'top',
      report: 'WE BREAK IN FROM THE TOP OF THE FOURTH. A LIGHT RAIN HAS STARTED. 56 DEGREES, WITH A STEADY WIND BLOWING IN.',
    },
  },
  result: {
    winner: 'home',
    away: { team_id: away, name: 'Goonies', runs: 2, hits: 4, errors: 1 },
    home: { team_id: home, name: 'River Rats', runs: 3, hits: 5, errors: 0 },
    innings: [
      { inning: 1, away: 2, home: 0 },
      { inning: 2, away: 0, home: 0 },
      { inning: 3, away: 0, home: 1 },
      { inning: 4, away: 0, home: 2 },
    ],
    lines: [
      line(away, 'Pat Smith', { h: 3, r: 1, rbi: 2 }),
      line(away, 'Quiet Kid', { h: 0, r: 0, rbi: 0 }),
      line(home, 'Sam Lee', { h: 2, r: 2, rbi: 1 }),
    ],
    events: [
      { inning: 1, half: 'top', tag: 'wind_carried', name: 'Pat Smith' },
      { inning: 4, half: 'top', tag: 'rain_misplay', name: 'Pat Smith' },
      { inning: 4, half: 'bottom', tag: 'awkward_slide', name: 'Sam Lee' },
    ],
  },
}

test('the recap starts with the forecast and says the break once', () => {
  const parts = recapParts(called, {
    used: [{ team_id: home, name: 'Ice Pops' }],
    perkIds: ['short_fence'],
  })
  const heard = parts.join(' ')
  assert.equal(parts[0].startsWith('FROM THE WEATHER DESK.'), true)
  assert.match(parts[0], /AT FIRST PITCH\. THE BREEZE PICKED UP\. IT IS A LITTLE COOLER THAN WE CALLED\./)
  assert.equal(heard.split('FROM THE WEATHER DESK').length - 1, 1)
  assert.equal(heard.split('WE BREAK IN').length - 1, 1)
  assert.equal(heard.includes('LIVE FROM THE PARK'), false)
  assert.equal(heard.includes('56 DEGREES'), false)
  assert.match(heard, /THE TOP OF THE FOURTH\. WE BREAK IN\. A LIGHT RAIN HAS STARTED\./)
  assert.match(heard, /A WET HOP GETS PAST THE GLOVE\./)
  assert.match(heard, /FOR GOONIES, PAT SMITH FINISHES WITH 3 HITS, 2 DRIVEN IN, AND 1 RUN\./)
  assert.match(heard, /FOR RIVER RATS, SAM LEE FINISHES WITH 2 HITS, 1 DRIVEN IN, AND 2 RUNS\./)
  assert.match(heard, /THE HOME ADVANTAGE FOR RIVER RATS IS SHORT FENCE\. THE PARK PLAYS SMALL\./)
  assert.match(heard, /THEY PACKED ICE POPS\. THE KIDS HOLD THEIR STAMINA THROUGH THE HEAT\./)
  assert.equal((heard.match(/THE HOME ADVANTAGE FOR/g) || []).length, 1)
  assert.equal((heard.match(/PACKED/g) || []).length, 1)
  assert.match(heard, /THE TOP OF THE FIRST\. GOONIES SCORES 2 RUNS\. PAT SMITH PUTS ONE UP AND THE WIND TAKES IT OUT\./)
  assert.equal(heard.includes('THE TOP OF THE SECOND'), false)
  assert.match(heard, /THE BOTTOM OF THE FOURTH\. RIVER RATS SCORES 2 RUNS\. HERE COMES SAM LEE, AND THE SLIDE ARRIVES IN A TANGLE\./)
  assert.equal(parts.at(-3), 'FOR GOONIES, PAT SMITH FINISHES WITH 3 HITS, 2 DRIVEN IN, AND 1 RUN.')
  assert.equal(parts.at(-2), 'FOR RIVER RATS, SAM LEE FINISHES WITH 2 HITS, 1 DRIVEN IN, AND 2 RUNS.')
  assert.equal(parts.at(-1), 'AND THAT IS YOUR BALLGAME. RIVER RATS TAKES IT AT HOME, 3 TO 2.')
  assert.equal(recapClose(called), parts.at(-1))
})

test('several home advantages and packed items are each named once', () => {
  const parts = recapParts(called, {
    used: [
      { team_id: home, name: 'Ice Pops' },
      { team_id: home, name: 'Extra Baseballs' },
      { team_id: away, name: 'Borrowed Gloves' },
    ],
    perkIds: ['short_fence', 'moms_muffins'],
  })
  const heard = parts[1]
  assert.equal(heard, [
    'THE HOME ADVANTAGES FOR RIVER RATS ARE SHORT FENCE AND MOM\'S MUFFINS.',
    'THE PARK PLAYS SMALL. HOME HITTERS GAIN A LITTLE POWER.',
    'MOM BAKES FOR THE GAME. THE CLUB HOLDS UP A LITTLE LONGER.',
    'THEY PACKED ICE POPS AND EXTRA BASEBALLS.',
    'THE KIDS HOLD THEIR STAMINA THROUGH THE HEAT.',
    'A SPARE BALL STAYS IN THE BAG SO PLAY DOES NOT STOP FOR A LOST ONE.',
    'GOONIES PACKED BORROWED GLOVES.',
    'THE FIELDERS GET A SURE HAND ON THE BALL.',
  ].join(' '))
  assert.equal((heard.match(/THE HOME ADVANTAGE/g) || []).length, 1)
  assert.equal((heard.match(/PACKED/g) || []).length, 2)
})

test('a late fade is said when it shows and once more if it comes back', () => {
  const fade = (inning, half, name) => ({ inning, half, tag: 'late_fade', name })
  const game = {
    result: {
      winner: 'tie',
      away: { team_id: away, name: 'Goonies', runs: 1, hits: 1, errors: 0 },
      home: { team_id: home, name: 'River Rats', runs: 0, hits: 0, errors: 0 },
      innings: [
        { inning: 7, away: 0, home: 0 },
        { inning: 8, away: 0, home: 0 },
        { inning: 9, away: 1, home: 0 },
      ],
      lines: [],
      events: [
        fade(7, 'top', 'Pat Smith'),
        fade(7, 'bottom', 'Sam Lee'),
        fade(8, 'top', 'Pat Smith'),
        fade(8, 'bottom', 'Pat Smith'),
        fade(9, 'top', 'Pat Smith'),
      ],
    },
  }
  const first = [
    'PAT SMITH LOOKS FLAT IN THE LATE GOING.',
    'THE LATE INNINGS SIT HEAVY ON PAT SMITH.',
    'PAT SMITH RUNS OUT OF GAS AFTER THE SIXTH.',
    'PAT SMITH IS A STEP BEHIND WHEN THE LIGHT GOES.',
  ]
  const again = [
    'THE TIRED STRETCH COMES BACK.',
    'THE LEGS DO NOT COME BACK WITH THE INNING.',
    'THAT LATE STRETCH SHOWS UP AGAIN.',
    'ANOTHER INNING SITS HEAVY.',
  ]
  const sam = [
    'SAM LEE LOOKS FLAT IN THE LATE GOING.',
    'THE LATE INNINGS SIT HEAVY ON SAM LEE.',
    'SAM LEE RUNS OUT OF GAS AFTER THE SIXTH.',
    'SAM LEE IS A STEP BEHIND WHEN THE LIGHT GOES.',
  ]
  const parts = recapParts(game)
  const heard = parts.join(' ')
  assert.equal(parts.filter((part) => first.some((line) => part.includes(line))).length, 1)
  assert.equal(parts.filter((part) => again.some((line) => part.includes(line))).length, 1)
  assert.equal(parts.filter((part) => sam.some((line) => part.includes(line))).length, 1)
  assert.equal((heard.match(/LOOKS FLAT IN THE LATE GOING/g) || []).length <= 2, true)
  assert.equal(heard.includes('THE TOP OF THE NINTH'), true)
  assert.match(heard, /THE TOP OF THE NINTH\. GOONIES SCORES A RUN\./)
  assert.equal(heard.includes('THE BOTTOM OF THE EIGHTH'), false)
  assert.deepEqual(recapParts(game), parts)
})

test('a stored day with no forecast is one park line', () => {
  const parts = recapParts({
    weather: { sky: 'heavy_rain', wind: 'cross', heat: 'cold', sentence: 'HEAVY RAIN, CROSSWIND, AND COLD.' },
    result: {
      winner: 'tie',
      away: { team_id: away, name: 'Goonies', runs: 0, hits: 1, errors: 0 },
      home: { team_id: home, name: 'River Rats', runs: 0, hits: 1, errors: 0 },
      innings: [{ inning: 1, away: 0, home: null }],
      lines: [],
      events: [],
    },
  })
  assert.deepEqual(parts, [
    'LIVE FROM THE PARK. HEAVY RAIN AND COLD, WITH A STEADY WIND ACROSS THE DIAMOND.',
    'AND WE ARE STILL EVEN, 0 TO 0.',
  ])
})

test('this coach is blue and the other side is orange', () => {
  const text = 'FOR NEIGHBORHOOD, ELI ELLIS FINISHES WITH 1 HIT. FOR SPITBALLZ, CARA ALI FINISHES WITH 2 HITS. AND THAT IS YOUR BALLGAME. SPITBALLZ TAKES IT AT HOME, 1 TO 0.'
  const pieces = recapPieces(text, [
    { name: 'Spitballz', tone: 'mine' },
    { name: 'Cara Ali', tone: 'mine' },
    { name: 'Neighborhood', tone: 'foe' },
    { name: 'Eli Ellis', tone: 'foe' },
    { name: 'Ali', tone: 'mine' },
  ])
  assert.deepEqual(pieces.filter((piece) => piece.tone === 'mine').map((piece) => piece.text), ['SPITBALLZ', 'CARA ALI', 'SPITBALLZ'])
  assert.deepEqual(pieces.filter((piece) => piece.tone === 'foe').map((piece) => piece.text), ['NEIGHBORHOOD', 'ELI ELLIS'])
  assert.equal(pieces.map((piece) => piece.text).join(''), text)
  const marks = recapMarks(called, home)
  assert.equal(marks.find((mark) => mark.name === 'RIVER RATS')?.tone, 'mine')
  assert.equal(marks.find((mark) => mark.name === 'SAM LEE')?.tone, 'mine')
  assert.equal(marks.find((mark) => mark.name === 'GOONIES')?.tone, 'foe')
  assert.equal(marks.find((mark) => mark.name === 'PAT SMITH')?.tone, 'foe')
  assert.deepEqual(recapMarks(called, 'cccccccc-cccc-cccc-cccc-cccccccccccc'), [])
})

test('a game with no line has no recap', () => {
  assert.deepEqual(recapParts({ narrative: 'THE BOOTH CALLS THE DAY CLEAR.' }), [])
  assert.equal(recapClose({}), '')
})
