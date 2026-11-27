import assert from 'node:assert/strict'
import test from 'node:test'
import { recapClose, recapParts } from './recap.js'

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
  assert.match(heard, /RIVER RATS PACKED ICE POPS\. THE KIDS HOLD THEIR STAMINA THROUGH THE HEAT\./)
  assert.match(heard, /THE TOP OF THE FIRST\. GOONIES SCORES 2 RUNS\. PAT SMITH PUTS ONE UP AND THE WIND TAKES IT OUT\./)
  assert.equal(heard.includes('THE TOP OF THE SECOND'), false)
  assert.match(heard, /THE BOTTOM OF THE FOURTH\. RIVER RATS SCORES 2 RUNS\. HERE COMES SAM LEE, AND THE SLIDE ARRIVES IN A TANGLE\./)
  assert.equal(parts.at(-2), 'FOR GOONIES, PAT SMITH FINISHES WITH 3 HITS, 2 DRIVEN IN, AND 1 RUN. FOR RIVER RATS, SAM LEE FINISHES WITH 2 HITS, 1 DRIVEN IN, AND 2 RUNS.')
  assert.equal(parts.at(-1), 'AND THAT IS YOUR BALLGAME. RIVER RATS TAKES IT AT HOME, 3 TO 2.')
  assert.equal(recapClose(called), parts.at(-1))
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

test('a game with no line has no recap', () => {
  assert.deepEqual(recapParts({ narrative: 'THE BOOTH CALLS THE DAY CLEAR.' }), [])
  assert.equal(recapClose({}), '')
})
