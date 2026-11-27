export function seasonIsSetup(status) {
  return status === 'forming' || status === 'drafting'
}

export function dashboardShows({ status = '', hasTeam = false } = {}) {
  if (seasonIsSetup(status)) {
    return {
      setup: true,
      next: false,
      play: false,
      played: false,
      outside: false,
    }
  }
  const joined = Boolean(hasTeam)
  return {
    setup: false,
    next: joined,
    play: joined,
    played: joined,
    outside: !joined,
  }
}

export function showRecruitingTab({ hasTeam = false, hasRecruits = false } = {}) {
  return Boolean(hasTeam && hasRecruits)
}

export function seasonSubtabs({ forming = false, drafting = false, pool = false, recruiting = false } = {}) {
  const tabs = []
  if (pool) tabs.push(['pool', 'THE POOL'])
  if (recruiting) tabs.push(['recruiting', 'RECRUITING'])
  if (!forming) tabs.push(drafting ? ['draft', 'DRAFT'] : ['schedule', 'SCHEDULE'])
  tabs.push(['details', 'DETAILS'])
  return tabs
}
