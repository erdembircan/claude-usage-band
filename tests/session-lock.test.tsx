import type {
  On,
  PaneOpenArgs,
  PromptOrigin,
  RenderSurface,
  SessionMeasureInput,
} from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

const NOW = Date.parse('2026-10-02T10:00:00Z')
const LOW = '#3A82DA'
const PANE = 'usage-band-lock'
const OPEN = {
  id: PANE,
  title: 'Session lock',
  focus: true,
  closeOnEscape: true,
}

const BAND = {
  plugin: 'usage-band',
  surface: 'desktop',
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 10,
    bodyColumns: 120,
    scroll: { offset: 0, bodyRows: 10 },
    view: {},
  },
} as const

const BODY = {
  title: 'Session lock',
  isFocused: false,
  bodyColumns: 40,
  placement: 'dock',
  scroll: { offset: 0, bodyRows: 20 },
  view: {},
} as const

const LOCK_PANE = {
  plugin: 'usage-band',
  surface: 'desktop',
  component: 'Pane',
  requestId: PANE,
  props: BODY,
} as const

const RUN = {
  command: 'usage-band',
  origin: { kind: 'sdk' },
  presentation: { isFullscreen: false, columns: 120 },
} as const

const MEASURE: SessionMeasureInput = {
  context: { window: 200_000 },
  rateLimits: [
    { kind: 'five_hour', percentUsed: 42, resetsAt: '2026-10-02T12:14:00Z' },
    { kind: 'seven_day', percentUsed: 91.5, resetsAt: '2026-10-05T14:00:00Z' },
  ],
  changed: ['rateLimits'],
}

const typed = (text: string, kind: PromptOrigin['kind'] = 'sdk') => ({
  text,
  wait: false,
  origin: { kind } as PromptOrigin,
})

// What sits beneath the mod: the engine and the desktop it draws on. It keeps
// the pane the mod opened and the prompt box, and notes what the mod asked.
const engine = (
  on: On,
  {
    surfaces = ['desktop'],
    draft = '',
  }: { surfaces?: RenderSurface[]; draft?: string } = {},
) => {
  const clock = mock.clock(on, { now: NOW })
  const desk = {
    opens: [] as PaneOpenArgs[],
    closes: [] as string[],
    entered: [] as string[],
    isUp: false,
    hasKeyboard: false,
    box: draft,
  }

  on('session.measure', (_, e) => ({ changed: e.changed }))
  on('session.surfaces', () => ({ value: surfaces }))
  on('ui.open', (_, e) => {
    desk.opens.push(e)
    desk.isUp = true

    return { value: { isPlaced: true } }
  })
  on('ui.close', (_, e) => {
    desk.closes.push(e.id)
    desk.isUp = false
    desk.hasKeyboard = false

    return { value: undefined }
  })
  on('ui.panes', () => ({
    value: desk.isUp
      ? [
          {
            id: PANE,
            title: 'Session lock',
            isShown: true,
            isFocused: desk.hasKeyboard,
            isPlaced: true,
          },
        ]
      : [],
  }))
  on('prompt.read', () => ({
    value: { text: desk.box, cursor: desk.box.length },
  }))
  on('prompt.fill', (_, e) => {
    desk.box = e.mode === 'append' ? desk.box + e.text : e.text

    return { isFilled: true, text: desk.box, cursor: desk.box.length }
  })
  on('prompt.submit', (_, e) => {
    desk.entered.push(e.text)

    return { text: e.text }
  })
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Box } = $.ui.resolve(e)

    return <Box />
  })
  on('ui.render', { component: 'Pane' }, ($, e) => {
    const { Box } = $.ui.resolve(e)

    return <Box />
  })

  return { clock, desk }
}

test('draws a lock beside the dials, and a press locks the session', async (
  $,
  on,
) => {
  const { desk } = engine(on)
  await $.session.measure(MEASURE)
  const band = await $.ui.mount(BAND)

  expect((await band.find({ type: 'Button', key: 'lock' }))?.text).toBe('Lock')
  expect((await band.findAll({ type: 'Svg' }))[2]?.props.alt).toBe(
    'Session lock: off',
  )

  await band.press({ key: 'lock' })
  await band.redraw()
  const padlock = (await band.findAll({ type: 'Svg' }))[2]

  expect(desk.opens).toEqual([OPEN])
  expect((await band.find({ type: 'Button', key: 'lock' }))?.text).toBe('Unlock')
  expect(padlock?.props.alt).toBe('Session lock: on')
  expect(String(padlock?.props.source).includes(`stroke="${LOW}"`)).toBe(true)

  await band.unmount()
})

test('sets a draft aside on lock and puts it back on unlock', async ($, on) => {
  const { desk } = engine(on, { draft: 'half a thought' })
  await $.session.measure(MEASURE)
  const band = await $.ui.mount(BAND)

  await band.press({ key: 'lock' })
  expect(desk.box).toBe('')

  await band.press({ key: 'lock' })
  expect(desk.closes).toEqual([PANE])
  expect(desk.box).toBe('half a thought')

  await band.unmount()
})

test('keeps a prompt the person sends while locked, and returns it', async (
  $,
  on,
) => {
  const { desk } = engine(on)
  await $.command.run({ ...RUN, args: 'lock' })

  for (const kind of ['sdk', 'composer', 'bridge', 'slack-ping'] as const) {
    const answer = await $.prompt.submit(typed(`from ${kind}`, kind))

    expect(String(answer.drop).startsWith('The session is locked.')).toBe(true)
  }

  expect(desk.entered).toEqual([])
  // Each refusal asks for the keyboard again: the prompt box has just emptied.
  expect(desk.opens.length).toBe(5)

  await $.command.run({ ...RUN, args: 'unlock' })
  expect(desk.box).toBe(
    'from sdk\n\nfrom composer\n\nfrom bridge\n\nfrom slack-ping',
  )

  expect((await $.prompt.submit(typed('after'))).text).toBe('after')
  expect(desk.entered).toEqual(['after'])
})

test('lets through what is not the person typing', async ($, on) => {
  const { desk } = engine(on)
  await $.command.run({ ...RUN, args: 'lock' })

  for (const kind of [
    'task-notification',
    'scheduled-trigger',
    'peer',
    'peer-send-message',
    'unclassified',
    'auto-continuation',
  ] as const) {
    await $.prompt.submit(typed(kind, kind))
  }

  await $.prompt.submit({
    text: 'from a plugin',
    wait: false,
    origin: { kind: 'plugin', name: 'other' },
  })

  expect(desk.entered).toEqual([
    'task-notification',
    'scheduled-trigger',
    'peer',
    'peer-send-message',
    'unclassified',
    'auto-continuation',
    'from a plugin',
  ])
})

test(
  'keeps the pane open while locked, whoever closes it',
  {
    plugins: [
      {
        name: 'closer',
        register(on) {
          on('command.run', { command: 'close-lock' }, async $ => {
            try {
              await $.ui.close({ id: 'usage-band-lock' })
            } catch {
              return { text: 'refused' }
            }

            return { text: 'closed' }
          })
        },
      },
    ],
  },
  async ($, on) => {
    const { desk } = engine(on)
    const close = { ...RUN, command: 'close-lock', args: '' }
    await $.command.run({ ...RUN, args: 'lock' })

    expect((await $.command.run(close)).text).toBe('refused')
    expect(desk.closes).toEqual([])

    await $.command.run({ ...RUN, args: 'unlock' })
    expect(desk.closes).toEqual([PANE])
    expect((await $.command.run(close)).text).toBe('closed')
  },
)

test('draws the pane, and its button unlocks', async ($, on) => {
  const { desk } = engine(on)

  expect((await $.command.run({ ...RUN, args: 'lock' })).text).toBe(
    'Session locked.',
  )
  const pane = await $.ui.mount(LOCK_PANE)

  expect(await pane.find({ type: 'Text', text: 'Session locked' })).toBeDefined()
  expect((await pane.find({ type: 'Svg' }))?.props.alt).toBe('Session lock: on')
  expect((await pane.find({ type: 'Button', key: 'unlock' }))?.text).toBe(
    'Unlock',
  )

  await pane.press({ key: 'unlock' })
  expect(desk.closes).toEqual([PANE])
  expect((await $.prompt.submit(typed('free again'))).text).toBe('free again')

  await pane.unmount()
})

test('asks for the keyboard again when it has left the pane', async ($, on) => {
  const { clock, desk } = engine(on)
  await $.command.run({ ...RUN, args: 'lock' })
  desk.hasKeyboard = true
  const pane = await $.ui.mount({
    ...LOCK_PANE,
    props: { ...BODY, isFocused: true },
  })
  expect(desk.opens.length).toBe(1)

  // The person clicks away: the pane is drawn again without the keyboard.
  desk.hasKeyboard = false
  await pane.redraw(BODY)
  await clock.settle()
  expect(desk.opens.length).toBe(2)

  // Refused then, it is asked again on the watch, and not once it is back.
  await clock.advance(1_000)
  expect(desk.opens.length).toBe(3)

  desk.hasKeyboard = true
  await clock.advance(5_000)
  expect(desk.opens.length).toBe(3)

  await pane.unmount()
})

test('stops watching once unlocked', async ($, on) => {
  const { clock, desk } = engine(on)
  await $.command.run({ ...RUN, args: 'lock' })
  await $.command.run({ ...RUN, args: 'unlock' })
  await clock.advance(5_000)

  expect(desk.opens.length).toBe(1)
  expect(desk.isUp).toBe(false)
})

test('locks only where the desktop draws', async ($, on) => {
  const { desk } = engine(on, { surfaces: ['terminal'] })

  expect((await $.command.run({ ...RUN, args: 'lock' })).text).toBe(
    'The session lock needs the Claude desktop app.',
  )
  expect(desk.opens).toEqual([])
  expect((await $.prompt.submit(typed('still free'))).text).toBe('still free')
})

test('names its arguments for one it does not know', async ($, on) => {
  engine(on)

  expect((await $.command.run({ ...RUN, args: 'sideways' })).text).toBe(
    'Usage: /usage-band, /usage-band lock or /usage-band unlock.',
  )
})

test('puts the lock back when the session starts over', async ($, on) => {
  const { clock, desk } = engine(on)
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('session.usage', () => ({
    value: { startedAt: NOW, context: { window: 200_000 }, rateLimits: [] },
  }))
  await $.command.run({ ...RUN, args: 'lock' })

  // A reload runs the session's start again, the state kept, the timer gone.
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  expect(desk.opens.length).toBe(2)

  await clock.advance(1_000)
  expect(desk.opens.length).toBe(3)
})

test('closes a lock pane left up once the lock is gone', async ($, on) => {
  const { desk } = engine(on)
  on('classic.SessionStart', () => ({}))
  on('session.usage', () => ({
    value: { startedAt: NOW, context: { window: 200_000 }, rateLimits: [] },
  }))
  desk.isUp = true

  // /clear resets the state, the lock with it, and leaves the pane.
  await $.classic.SessionStart({ source: 'clear' })
  expect(desk.closes).toEqual([PANE])
})
