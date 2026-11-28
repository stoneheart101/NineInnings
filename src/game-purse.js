export function purseText(purse) {
  const rep = Number(purse?.reputation)
  const caps = Number(purse?.bottlecaps)
  if (!Number.isInteger(rep) || !Number.isInteger(caps) || rep < 0 || caps < 0) return ''
  if (rep === 0 && caps === 0) return 'NOTHING'
  const bits = []
  if (rep > 0) bits.push(`${rep} REP`)
  if (caps > 0) bits.push(`${caps} BC`)
  return bits.join(' · ')
}

export function rewardsReady(data) {
  return Boolean(
    purseText(data?.home_win)
    && purseText(data?.away_win)
    && purseText(data?.loss)
    && purseText(data?.tie),
  )
}

export function rewardVersions(games) {
  const versions = []
  for (const game of games || []) {
    if (!game || game.is_practice) continue
    const version = Number(game.settings_version)
    if (!Number.isInteger(version) || versions.includes(version)) continue
    versions.push(version)
  }
  return versions
}

export function sideOf(game, teamId) {
  if (teamId && game?.home_team_id === teamId) return 'home'
  if (teamId && game?.away_team_id === teamId) return 'away'
  return 'out'
}

export function placeLine(homeName, mineIsHome) {
  if (mineIsHome) return 'AT YOUR FIELD'
  const name = String(homeName || '').trim() || 'TEAM'
  return `AT ${name}`
}

export function rewardLine(rewards, side) {
  const loss = purseText(rewards?.loss)
  const tie = purseText(rewards?.tie)
  if (!loss || !tie) return 'THE REWARD DID NOT LOAD'
  const tail = `LOSS ${loss} · TIE ${tie}`
  if (side === 'home' || side === 'away') {
    const win = purseText(side === 'home' ? rewards.home_win : rewards.away_win)
    if (!win) return 'THE REWARD DID NOT LOAD'
    return `WIN ${win} · ${tail}`
  }
  const home = purseText(rewards?.home_win)
  const away = purseText(rewards?.away_win)
  if (!home || !away) return 'THE REWARD DID NOT LOAD'
  return `HOME WIN ${home} · AWAY WIN ${away} · ${tail}`
}
