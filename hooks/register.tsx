import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Limit } from '../types'

const limits = atom({ plugin: 'usage-band', key: 'limits' } as const, [])
const isHidden = atom({ plugin: 'usage-band', key: 'isHidden' } as const, false)

const MINUTE = 60_000
// The figures arrive with session.measure, after each turn. This slow read is
// only a safety net for a measurement that never came.
const POLL = 10 * MINUTE
const BAR_WIDTH = 96
const BAR_HEIGHT = 6
// The Svg is drawn as an image, so it cannot read the app's theme: the fill is
// Claude's clay accent and the track a translucent grey that sits on light and dark.
const ACCENT = '#D97757'
const CRITICAL = '#C4453A'
const TRACK = '#8C8C8C'

const windowOf = (list: readonly Limit[], kind: string) =>
  list.find(one => one.kind === kind) ??
  list.find(one => one.kind.startsWith(kind))

// Past its reset time a window is empty again: it is shown at 0% until the next
// reply reports the new one.
const hasReset = (limit: Limit, now: number) =>
  limit.resetsAt !== undefined && Date.parse(limit.resetsAt) <= now

const remaining = (resetsAt: string | undefined, now: number) => {
  const left = resetsAt === undefined ? NaN : Date.parse(resetsAt) - now

  if (Number.isNaN(left)) {
    return ''
  }

  const minutes = Math.ceil(left / MINUTE)
  const days = Math.floor(minutes / 1440)
  const hours = Math.floor((minutes % 1440) / 60)

  if (days > 0) {
    return `resets in ${days}d ${hours}h`
  }

  if (hours > 0) {
    return `resets in ${hours}h ${minutes % 60}m`
  }

  return `resets in ${minutes}m`
}

const bar = (percent: number) => {
  const share = Math.min(100, Math.max(0, percent)) / 100
  const filled =
    share === 0 ? 0 : Math.max(BAR_HEIGHT, Math.round(BAR_WIDTH * share))
  const radius = BAR_HEIGHT / 2

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${BAR_WIDTH}" height="${BAR_HEIGHT}" viewBox="0 0 ${BAR_WIDTH} ${BAR_HEIGHT}">`,
    `<rect width="${BAR_WIDTH}" height="${BAR_HEIGHT}" rx="${radius}" fill="${TRACK}" fill-opacity="0.3"/>`,
    `<rect width="${filled}" height="${BAR_HEIGHT}" rx="${radius}" fill="${percent >= 90 ? CRITICAL : ACCENT}"/>`,
    '</svg>',
  ].join('')
}

const sameLimits = (a: readonly Limit[], b: readonly Limit[]) =>
  a.length === b.length &&
  a.every((one, i) => {
    const other = b[i]

    return (
      other !== undefined &&
      one.kind === other.kind &&
      one.percentUsed === other.percentUsed &&
      one.resetsAt === other.resetsAt
    )
  })

// Claude Code stops reporting a window once its reset time has passed, so a
// reading replaces the stored window of its kind and never removes one. A write
// redraws the band, so only a list that differs is written.
const keep = async ($: EngineInterface, reported: readonly Limit[]) => {
  const stored = await read($, limits)
  const next = [
    ...stored.map(old => reported.find(one => one.kind === old.kind) ?? old),
    ...reported.filter(one => !stored.some(old => old.kind === one.kind)),
  ]

  if (!sameLimits(stored, next)) {
    await update($, limits, () => next)
  }
}

const refresh = async ($: EngineInterface) => {
  const { rateLimits } = await $.session.usage()
  await keep($, rateLimits)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'usage-band',
      description: 'Show or hide the usage band above the prompt',
    })
    await refresh($)
    $.clock.every(POLL, () => void refresh($).catch(() => undefined))
    $.clock.every(MINUTE, () => $.ui.invalidate('ui.render'))

    return next(e)
  })

  // /clear, /resume and /branch reset $.state without a session.start.
  on(
    'classic.SessionStart',
    { source: ['clear', 'resume', 'fork'] },
    async ($, e, next) => {
      await refresh($)

      return next(e)
    },
  )

  on('session.measure', async ($, e, next) => {
    // Every measurement carries the exact figures, whatever `changed` names.
    await keep($, e.rateLimits)

    return next(e)
  })

  on('command.run', { command: 'usage-band' }, async $ => {
    const hidden = await update($, isHidden, value => !value)

    return { text: hidden ? 'Usage band hidden.' : 'Usage band shown.' }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.surface !== 'desktop' || e.props.hasSurvey) {
      return next(e)
    }

    const now = await $.clock.now()
    const list = await read($, limits)
    const session = windowOf(list, 'five_hour')
    const week = windowOf(list, 'seven_day')
    const isQuiet = (!session && !week) || (await read($, isHidden))

    if (isQuiet) {
      return next(e)
    }

    const { Box, Button, Svg, Text } = $.ui.resolve(e)

    const meter = (label: string, limit: Limit) => {
      const isOver = hasReset(limit, now)
      const used = isOver ? 0 : limit.percentUsed
      const percent = Math.round(used)
      const reset = isOver ? 'reset' : remaining(limit.resetsAt, now)
      const figure = `${percent}%`

      return (
        <Box alignItems="center" columnGap={1}>
          <Text dimColor>{label}</Text>
          <Svg
            source={bar(used)}
            alt={`${label}: ${percent}% used`}
            width={BAR_WIDTH}
            height={BAR_HEIGHT}
          />
          {percent >= 90 ? (
            <Text bold color="error">
              {figure}
            </Text>
          ) : percent >= 75 ? (
            <Text bold color="warning">
              {figure}
            </Text>
          ) : (
            <Text bold>{figure}</Text>
          )}
          {reset !== '' && <Text dimColor>{`· ${reset}`}</Text>}
        </Box>
      )
    }

    return (
      <Box alignItems="center" columnGap={3} flexWrap="wrap">
        {session && meter('Current session', session)}
        {week && meter('Weekly', week)}
        <Button
          key="hide"
          role="dismiss"
          label="Hide usage"
          onPress={() => update($, isHidden, () => true)}
        />
      </Box>
    )
  })
}
