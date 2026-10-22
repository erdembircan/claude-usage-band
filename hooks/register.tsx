import { atom, read, update } from 'claude-code'
import type {
  EngineInterface,
  PromptOrigin,
  Register,
  RenderElement,
  Timer,
} from 'claude-code'

import type { Limit } from '../types'

const limits = atom({ plugin: 'usage-band', key: 'limits' } as const, [])
const isHidden = atom({ plugin: 'usage-band', key: 'isHidden' } as const, false)
const isLocked = atom({ plugin: 'usage-band', key: 'isLocked' } as const, false)
const draft = atom({ plugin: 'usage-band', key: 'draft' } as const, '')

const MINUTE = 60_000

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

// The padlock is drawn like the window icons, on its own: open and quiet while
// the session is free, shut and in the band's blue while it is locked.
const LOCK_WIDTH = 13
const PADLOCK_BODY = '<rect x="2.6" y="5.9" width="7.8" height="5.5" rx="1.4"/>'
const SHACKLE_OPEN = 'M4.3 5.9V3.3a2.2 2.2 0 0 1 4.4 0'
const SHACKLE_SHUT = 'M4.3 5.9V4.2a2.2 2.2 0 0 1 4.4 0v1.7'
const KEYHOLE = 'M6.5 8.2v.9'
// In the band the padlock is the lock's whole control. A Button's face is text
// and an Svg takes no press, so a Button with a blank label is laid over the
// padlock and takes the press for it. The label is an en space: it draws
// nothing, and keeps the Button about as wide as it is tall.
const BLANK = '\u2002'
// How far the Box that holds the Button reaches past the padlock on each side,
// in columns. The desktop draws a Button no wider than the Box it is in, and
// this Button is wider than the padlock.
const REACH = 2

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

// The lock is one pane. `focus` asks the surface for the keyboard. Under
// `closeOnEscape` Escape is the person's close of the pane, which the ui.close
// hook refuses while locked: the key ends there and never stops the turn. Left
// out, Escape would hand the keyboard back to the prompt box instead.
const PANE = 'usage-band-lock'
const OPEN = {
  id: PANE,
  title: 'Session lock',
  focus: true,
  closeOnEscape: true,
} as const
// How often a locked session checks that the pane still has the keyboard.
const WATCH = 250

// A prompt the person typed somewhere the lock cannot close: Enter at a
// terminal, a message over Remote Control, a ping from Slack. The desktop app
// is not on the list. It submits what is typed in its box as `sdk`, but it
// sends the same way what goes out on a click or of its own accord, such as an
// artifact comment sent to Claude, so `sdk` cannot tell typing apart. It need
// not: the box takes no typing while locked (see prompt.edit), so nothing typed
// there can reach the gate. Every other prompt passes a locked session: a
// background task or agent reporting back, a schedule, another session, a
// plugin, and whatever the desktop app sends.
const PERSONS: readonly PromptOrigin['kind'][] = [
  'composer',
  'bridge',
  'slack-ping',
]

const LOCK_ON = 'Session lock: on'
const LOCK_OFF = 'Session lock: off'
const LOCKED = 'Session locked.'
const UNLOCKED = 'Session unlocked.'
const NEEDS_DESKTOP = 'The session lock needs the Claude desktop app.'
const USAGE = 'Usage: /usage-band, /usage-band lock or /usage-band unlock.'
const REFUSAL =
  'The session is locked, so this prompt was not sent. Unlock it first: press Unlock, or run /usage-band unlock.'
const STAYS = 'the session is locked'
const NOT_RETURNED =
  'usage-band: your draft could not be put back. Run /usage-band unlock to try again.'

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

const padlock = (isShut: boolean) =>
  [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${LOCK_WIDTH}" height="${MARK_HEIGHT}" viewBox="0 0 ${LOCK_WIDTH} ${MARK_HEIGHT}">`,
    `<g transform="translate(0 4.5)" fill="none" stroke="${isShut ? LOW : QUIET}" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">`,
    PADLOCK_BODY,
    `<path d="${isShut ? SHACKLE_SHUT : SHACKLE_OPEN}${KEYHOLE}"/>`,
    '</g>',
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

const isPersons = (origin: PromptOrigin) => PERSONS.includes(origin.kind)

// Empties the prompt box and answers what was in it. Over text there the
// surface refuses the pane the keyboard, and Escape in the box stops the turn.
const emptied = async ($: EngineInterface) => {
  const { text } = await $.prompt.read()

  if (text.trim() === '') {
    return ''
  }

  const { isFilled } = await $.prompt.fill({ text: '', mode: 'replace' })

  return isFilled ? text : ''
}

// The timer and the two flags live as long as the module: a reload starts them
// over, and the session's start puts the lock back.
let watch: Timer | undefined
let isHolding = false
let hadKeyboard = false

// Gives the pane the keyboard while the session is locked: opens it when it is
// gone, and asks for the keyboard again when the person has clicked away.
const hold = async ($: EngineInterface) => {
  if (isHolding || !(await read($, isLocked))) {
    return
  }

  isHolding = true

  try {
    const pane = (await $.ui.panes()).find(one => one.id === PANE)

    if (pane?.isFocused) {
      return
    }

    // What has landed in the box while locked was not meant for it: it goes.
    await emptied($)
    await $.ui.open(OPEN)
  } finally {
    isHolding = false
  }
}

const disarm = () => {
  watch?.cancel()
  watch = undefined
}

const arm = ($: EngineInterface) => {
  disarm()
  watch = $.clock.every(WATCH, () => void hold($))
}

const engage = async ($: EngineInterface) => {
  if (!(await read($, isLocked))) {
    // The draft in the box as the lock goes on is the person's: it is set
    // aside, and comes back on unlock.
    const text = await emptied($)

    if (text !== '') {
      await update($, draft, () => text)
    }

    await update($, isLocked, () => true)
  }

  arm($)
  await hold($)
}

const release = async ($: EngineInterface) => {
  await update($, isLocked, () => false)
  disarm()
  await $.ui.close({ id: PANE })

  const text = await read($, draft)

  if (text === '') {
    return
  }

  const { isFilled } = await $.prompt.fill({ text, mode: 'append' })

  if (isFilled) {
    await update($, draft, () => '')
  } else {
    $.ui.toast(NOT_RETURNED)
  }
}

// A reload keeps $.state and drops the timer; /clear, /resume and /branch
// reset $.state and may leave the pane up.
const settle = async ($: EngineInterface) => {
  if (await read($, isLocked)) {
    arm($)
    await hold($)

    return
  }

  disarm()

  if ((await $.ui.panes()).some(one => one.id === PANE)) {
    await $.ui.close({ id: PANE })
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'usage-band',
      description: 'Show or hide the usage band, or lock and unlock the session',
      argumentHint: '[lock|unlock]',
      // A session is locked, and unlocked, while it works.
      immediate: true,
    })
    await refresh($)
    $.clock.every(MINUTE, () => $.ui.invalidate('ui.render'))
    await settle($)

    return next(e)
  })

  // /clear, /resume and /branch reset $.state without a session.start.
  on(
    'classic.SessionStart',
    { source: ['clear', 'resume', 'fork'] },
    async ($, e, next) => {
      await refresh($)
      await settle($)

      return next(e)
    },
  )

  on('session.measure', async ($, e, next) => {
    // Every measurement carries the exact figures, whatever `changed` names.
    await keep($, e.rateLimits)

    return next(e)
  })

  on('command.run', { command: 'usage-band' }, async ($, e) => {
    const wanted = e.args.trim()

    if (wanted === 'lock') {
      if (!(await $.session.surfaces()).includes('desktop')) {
        return { text: NEEDS_DESKTOP }
      }

      await engage($)

      return { text: LOCKED }
    }

    if (wanted === 'unlock') {
      await release($)

      return { text: UNLOCKED }
    }

    if (wanted !== '') {
      return { text: USAGE }
    }

    const hidden = await update($, isHidden, value => !value)

    return { text: hidden ? 'Usage band hidden.' : 'Usage band shown.' }
  })

  // The prompt box takes no typing while locked: every edit is answered with an
  // empty box, and the pane asks for the keyboard back.
  on('prompt.edit', async ($, e, next) => {
    if (!(await read($, isLocked))) {
      return next(e)
    }

    void hold($)

    return { text: '', cursor: 0 }
  }).catch((_, e, next) => next(e))

  // A prompt typed somewhere other than the desktop's box is refused while
  // locked, and not kept. A dead gate must never swallow a prompt: it fails open.
  on('prompt.submit', async ($, e, next) => {
    if (!(await read($, isLocked)) || !isPersons(e.origin)) {
      return next(e)
    }

    // The prompt box has just emptied, so the pane can have the keyboard back.
    await $.ui.open(OPEN)

    return { drop: REFUSAL }
  }).catch((_, e, next) => next(e))

  // While locked the pane closes for nobody. Escape and the close mark are the
  // person's close, and refusing it is what keeps Escape from stopping the turn.
  on('ui.close', { id: PANE }, async ($, e, next) =>
    (await read($, isLocked)) ? { deny: STAYS } : next(e),
  ).catch((_, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e, next) => {
    if (!(await read($, isLocked))) {
      return next(e)
    }

    // The keyboard has just left the pane. A drawing may not write, so the
    // asking waits for the draw to end.
    if (hadKeyboard && !e.props.isFocused) {
      $.clock.after(0, () => void hold($))
    }

    hadKeyboard = e.props.isFocused

    const { Box, Button, Text } = $.ui.resolve(e)
    let sign: RenderElement | null = null

    // The padlock is an Svg, which the terminal does not draw.
    if (e.surface === 'desktop') {
      const { Svg } = $.ui.resolve(e)
      sign = (
        <Svg
          source={padlock(true)}
          alt={LOCK_ON}
          width={LOCK_WIDTH}
          height={MARK_HEIGHT}
        />
      )
    }

    return (
      <Box flexDirection="column" rowGap={1}>
        <Box alignItems="center" columnGap={1}>
          {sign}
          <Text bold>Session locked</Text>
        </Box>
        <Box>
          <Button key="unlock" variant="primary" onPress={() => release($)}>
            Unlock
          </Button>
        </Box>
      </Box>
    )
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    // The band is one tree for every mod: each adds its own line and passes the
    // lines beneath through as they came. Ours goes under what another mod drew;
    // we never open that up or set it in our row.
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

    const isShut = await read($, isLocked)
    const { Box, Button, Svg, Text } = $.ui.resolve(e)

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

    const ownLine = (
      <Box alignItems="center" columnGap={3} flexWrap="wrap">
        {session && meter(SESSION, session)}
        {week && meter(WEEK, week)}
        <Box>
          <Svg
            source={padlock(isShut)}
            alt={isShut ? LOCK_ON : LOCK_OFF}
            width={LOCK_WIDTH}
            height={MARK_HEIGHT}
          />
          <Box
            position="absolute"
            top={0}
            bottom={0}
            left={-REACH}
            right={-REACH}
            alignItems="center"
            justifyContent="center"
          >
            <Button
              key="lock"
              label={BLANK}
              plain
              onPress={async () =>
                (await read($, isLocked)) ? release($) : engage($)
              }
            />
          </Box>
        </Box>
      </Box>
    )

    if (!hasContent(beneath)) {
      return ownLine
    }

    return (
      <Box flexDirection="column" rowGap="md">
        {beneath}
        {ownLine}
      </Box>
    )
  })
}
