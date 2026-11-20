const INNINGS = [1, 2, 3, 4, 5, 6, 7, 8, 9]

const CLUBS = [
  { name: 'VISITORS', runs: 0, hits: 0, errors: 0 },
  { name: 'HOME', runs: 0, hits: 0, errors: 0 },
]

export function drawField(root) {
  root.replaceChildren()

  const board = document.createElement('table')
  board.className = 'board'
  board.innerHTML = `
    <thead>
      <tr>
        <th>NINE INNINGS</th>
        ${INNINGS.map((inning) => `<th>${inning}</th>`).join('')}
        <th>R</th><th>H</th><th>E</th>
      </tr>
    </thead>
    <tbody>
      ${CLUBS.map(
        (club) => `
        <tr>
          <th>${club.name}</th>
          ${INNINGS.map(() => '<td></td>').join('')}
          <td>${club.runs}</td><td>${club.hits}</td><td>${club.errors}</td>
        </tr>`,
      ).join('')}
    </tbody>
  `

  const info = document.createElement('div')
  info.className = 'info'
  info.innerHTML = `
    <p><span>BATTER:</span> <b>.274</b></p>
    <p class="indent">A SAMPLE</p>
    <p><span>ON DECK:</span></p>
    <p class="indent">B SAMPLE</p>
    <p><span>PITCHER:</span></p>
    <p class="indent">C SAMPLE</p>
    <p><span>VISITOR BULLPEN:</span></p>
    <p class="gap"></p>
    <p><span>HOME BULLPEN:</span></p>
  `

  const diamond = document.createElement('div')
  diamond.className = 'diamond'
  diamond.innerHTML = `
    <svg viewBox="0 0 220 200" role="img" aria-label="Sample baseball diamond">
      <polygon points="110,168 176,102 110,36 44,102" fill="none" stroke="currentColor" stroke-width="2"/>
      <line x1="110" y1="168" x2="28" y2="168" stroke="currentColor" stroke-width="2"/>
      <line x1="110" y1="168" x2="192" y2="168" stroke="currentColor" stroke-width="2"/>
      <circle cx="110" cy="102" r="3" fill="currentColor"/>
      <circle cx="110" cy="168" r="3" fill="currentColor"/>
      <circle cx="176" cy="102" r="3" fill="currentColor"/>
      <circle cx="110" cy="36" r="3" fill="currentColor"/>
      <circle cx="44" cy="102" r="3" fill="currentColor"/>
      <text x="104" y="184">C</text>
      <text x="116" y="106">P</text>
      <text x="182" y="106">1</text>
      <text x="104" y="30">2</text>
      <text x="28" y="106">3</text>
      <text x="70" y="78">S</text>
      <text x="48" y="58">L</text>
      <text x="104" y="58">F</text>
      <text x="158" y="58">R</text>
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

  root.append(board, play, prompt)
  return prompt
}
