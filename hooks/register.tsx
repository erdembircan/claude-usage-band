import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderElement } from 'claude-code'

import type { Limit } from '../types'

const limits = atom({ plugin: 'usage-band', key: 'limits' } as const, [])
const isHidden = atom({ plugin: 'usage-band', key: 'isHidden' } as const, false)

const MINUTE = 60_000
// The figures arrive with session.measure, after each turn. This slow read is
// only a safety net for a measurement that never came.
const POLL = 10 * MINUTE

// One mark per window: an icon for the kind of window, then a dial. The dial's
// outer ring is the share of the limit used, the wedge in its centre the share
// of the window's time still left.
const MARK_WIDTH = 41
const MARK_HEIGHT = 22
const RING = 59.06 // the circumference of the outer ring, r = 9.4
const WEDGE = 18.85 // the circumference the wedge is drawn on, r = 3
// The Svg is drawn as an image, so it cannot read the app's theme: these are
// mid-tones that hold on both the light and the dark ground. The percentage
// takes the same colour as its ring.
const LOW = '#3A82DA'
const WARNING = '#C98414'
const CRITICAL = '#D2544A'
const QUIET = '#87867F'
const TRACK = '#8C8C8C'

const HOURGLASS =
  '<path d="M3.4 1.6h6.2M3.4 11.4h6.2M4 1.6v1.6l2.5 3.3L9 3.2V1.6M4 11.4V9.8l2.5-3.3L9 9.8v1.6"/>'
const CALENDAR =
  '<rect x="1.8" y="2.8" width="9.4" height="8.4" rx="1.6"/><path d="M1.8 5.7h9.4M4.4 1.5v2.4M8.6 1.5v2.4"/>'

const SESSION = {
  kind: 'five_hour',
  label: 'Current session',
  icon: HOURGLASS,
  span: 5 * 60 * MINUTE,
}
const WEEK = {
  kind: 'seven_day',
  label: 'Weekly',
  icon: CALENDAR,
  span: 7 * 24 * 60 * MINUTE,
}

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

const share = (value: number) =>
  Number.isNaN(value) ? 0 : Math.min(1, Math.max(0, value))

const toneOf = (percent: number) =>
  percent >= 90 ? CRITICAL : percent >= 70 ? WARNING : LOW

const mark = (icon: string, used: number, left: number, colour: string) =>
  [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${MARK_WIDTH}" height="${MARK_HEIGHT}" viewBox="0 0 ${MARK_WIDTH} ${MARK_HEIGHT}">`,
    `<g transform="translate(0 4.5)" fill="none" stroke="${QUIET}" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">${icon}</g>`,
    `<circle cx="30" cy="11" r="9.4" fill="none" stroke="${TRACK}" stroke-opacity="0.3" stroke-width="2.6"/>`,
    `<circle cx="30" cy="11" r="9.4" fill="none" stroke="${colour}" stroke-width="2.6" stroke-dasharray="${(RING * used).toFixed(2)} ${RING}" transform="rotate(-90 30 11)"/>`,
    `<circle cx="30" cy="11" r="3" fill="none" stroke="${TRACK}" stroke-opacity="0.3" stroke-width="6"/>`,
    `<circle cx="30" cy="11" r="3" fill="none" stroke="${QUIET}" stroke-width="6" stroke-dasharray="${(WEDGE * left).toFixed(2)} ${WEDGE}" transform="rotate(-90 30 11)"/>`,
    '</svg>',
  ].join('')

// The engine's own band is an empty Box; another mod's band has content.
const hasContent = (drawn: RenderElement) =>
  drawn.type !== 'Box' || (drawn.children?.length ?? 0) > 0

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
    // Another mod may draw the band too: what it drew is kept beside the dials.
    const beneath = await next(e)

    if (e.surface !== 'desktop' || e.props.hasSurvey) {
      return beneath
    }

    const now = await $.clock.now()
    const list = await read($, limits)
    const session = windowOf(list, SESSION.kind)
    const week = windowOf(list, WEEK.kind)
    const isQuiet = (!session && !week) || (await read($, isHidden))

    if (isQuiet) {
      return beneath
    }

    const { Box, Svg, Text } = $.ui.resolve(e)

    const meter = (one: typeof SESSION, limit: Limit) => {
      const isOver = hasReset(limit, now)
      const used = isOver ? 0 : limit.percentUsed
      const percent = Math.round(used)
      const reset = isOver ? 'reset' : remaining(limit.resetsAt, now)
      const left =
        limit.resetsAt === undefined
          ? 0
          : share((Date.parse(limit.resetsAt) - now) / one.span)
      const colour = toneOf(percent)
      const alt =
        reset === ''
          ? `${one.label}: ${percent}% used`
          : `${one.label}: ${percent}% used, ${reset}`

      return (
        <Box alignItems="center" columnGap={1}>
          <Svg
            source={mark(one.icon, share(used / 100), left, colour)}
            alt={alt}
            width={MARK_WIDTH}
            height={MARK_HEIGHT}
          />
          <Text bold color={colour}>
            {`${percent}%`}
          </Text>
        </Box>
      )
    }

    return (
      <Box alignItems="center" columnGap={3} flexWrap="wrap">
        {session && meter(SESSION, session)}
        {week && meter(WEEK, week)}
        {hasContent(beneath) && beneath}
      </Box>
    )
  })
}
