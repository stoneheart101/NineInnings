const INNINGS = [1, 2, 3, 4, 5, 6, 7, 8, 9]

const CLUBS = [
  { name: 'VISITORS', short: 'VIS', runs: 0, hits: 0, errors: 0 },
  { name: 'HOME', short: 'HOME', runs: 0, hits: 0, errors: 0 },
]

export function drawField(root) {
  root.replaceChildren()

  const boardWrap = document.createElement('div')
  boardWrap.className = 'board-wrap'
  boardWrap.tabIndex = 0
  boardWrap.setAttribute('aria-label', 'Inning scoreboard')
  const board = document.createElement('table')
  board.className = 'board'
  board.innerHTML = `
    <thead>
      <tr>
        <th class="title"><span class="desk">NINE INNINGS</span><span class="phone">NI</span></th>
        ${INNINGS.map((inning) => `<th>${inning}</th>`).join('')}
        <th>R</th><th>H</th><th>E</th>
      </tr>
    </thead>
    <tbody>
      ${CLUBS.map(
        (club) => `
        <tr>
          <th><span class="desk">${club.name}</span><span class="phone">${club.short}</span></th>
          ${INNINGS.map(() => '<td></td>').join('')}
          <td>${club.runs}</td><td>${club.hits}</td><td>${club.errors}</td>
        </tr>`,
      ).join('')}
    </tbody>
  `

  const info = document.createElement('div')
  info.className = 'info'
  info.innerHTML = `
    <p><span class="label">BATTER</span> <span class="label">AVG.=</span><b>.274</b></p>
    <p class="indent">A SAMPLE</p>
    <p><span class="label">ON DECK</span></p>
    <p class="indent">B SAMPLE</p>
    <p><span class="label">PITCHER</span></p>
    <p class="indent">C SAMPLE</p>
    <p><span class="label"><span class="desk">VISITOR BULLPEN</span><span class="phone">V BULLPEN</span></span></p>
    <p class="gap"></p>
    <p><span class="label"><span class="desk">HOME BULLPEN</span><span class="phone">H BULLPEN</span></span></p>
  `

  const diamond = document.createElement('div')
  diamond.className = 'diamond'
  diamond.innerHTML = `
    <svg viewBox="0 0 320 250" role="img" aria-label="Sample baseball diamond">
      <polygon points="24,22 296,22 232,156 160,228 88,156" fill="var(--field)" stroke="#fff" stroke-width="2"/>
      <polygon points="160,204 214,148 160,92 106,148" fill="none" stroke="#fff" stroke-width="2"/>
      <polygon points="160,214 170,204 170,196 150,196 150,204" fill="#fff"/>
      <rect x="-6" y="-6" width="12" height="12" fill="#fff" transform="translate(214,148) rotate(45)"/>
      <rect x="-6" y="-6" width="12" height="12" fill="#fff" transform="translate(160,92) rotate(45)"/>
      <rect x="-6" y="-6" width="12" height="12" fill="#fff" transform="translate(106,148) rotate(45)"/>
      <g fill="var(--player)">
        <g transform="translate(160,208)"><circle cy="-7" r="3.4"/><rect x="-3.4" y="-3" width="6.8" height="9"/></g>
        <g transform="translate(160,148)"><circle cy="-7" r="3.4"/><rect x="-3.4" y="-3" width="6.8" height="9"/></g>
        <g transform="translate(228,156)"><circle cy="-7" r="3.4"/><rect x="-3.4" y="-3" width="6.8" height="9"/></g>
        <g transform="translate(176,104)"><circle cy="-7" r="3.4"/><rect x="-3.4" y="-3" width="6.8" height="9"/></g>
        <g transform="translate(128,118)"><circle cy="-7" r="3.4"/><rect x="-3.4" y="-3" width="6.8" height="9"/></g>
        <g transform="translate(92,156)"><circle cy="-7" r="3.4"/><rect x="-3.4" y="-3" width="6.8" height="9"/></g>
        <g transform="translate(78,78)"><circle cy="-7" r="3.4"/><rect x="-3.4" y="-3" width="6.8" height="9"/></g>
        <g transform="translate(160,58)"><circle cy="-7" r="3.4"/><rect x="-3.4" y="-3" width="6.8" height="9"/></g>
        <g transform="translate(242,78)"><circle cy="-7" r="3.4"/><rect x="-3.4" y="-3" width="6.8" height="9"/></g>
      </g>
    </svg>
    <div class="outs" aria-label="Outs 0">
      <span>O</span><span>U</span><span>T</span><span>S</span>
      <strong>0</strong>
    </div>
  `

  const play = document.createElement('div')
  play.className = 'play'
  play.append(info, diamond)

  const prompt = document.createElement('div')
  prompt.id = 'prompt'
  prompt.className = 'prompt'

  boardWrap.append(board)
  root.append(boardWrap, play, prompt)
  return prompt
}
