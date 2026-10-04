import type { On, SessionMeasureInput, SessionRateLimit } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

const NOW = Date.parse('2026-10-02T10:00:00Z')
const LOW = '#3A82DA'
const WARNING = '#C98414'
const CRITICAL = '#D2544A'

const BAND = {
  plugin: 'usage-band',
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

const RUN = {
  command: 'usage-band',
  args: '',
  origin: { kind: 'composer' },
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

// What sits beneath the mod: the engine, which echoes the measurement and draws
// an empty band, and, when asked for, another mod that drew in that band.
const engine = (on: On, { hasOtherBand = false } = {}) => {
  const clock = mock.clock(on, { now: NOW })
  on('session.measure', (_, e) => ({ changed: e.changed }))
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Box, Text } = $.ui.resolve(e)

    return hasOtherBand ? (
      <Box>
        <Text>another band</Text>
      </Box>
    ) : (
      <Box />
    )
  })

  return clock
}

test('draws one mark and one percentage per window on the desktop', async (
  $,
  on,
) => {
  engine(on)
  await $.session.measure(MEASURE)
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  const svgs = await ui.findAll({ type: 'Svg' })
  const session = String(svgs[0]?.props.source)
  const week = String(svgs[1]?.props.source)

  expect(svgs.length).toBe(2)
  expect(svgs[0]?.props.alt).toBe('Current session: 42% used, resets in 2h 14m')
  expect(svgs[1]?.props.alt).toBe('Weekly: 92% used, resets in 3d 4h')
  // The outer ring is the share used, the wedge the share of time left.
  expect(session.includes('stroke-dasharray="24.81 59.06"')).toBe(true)
  expect(session.includes('stroke-dasharray="8.42 18.85"')).toBe(true)
  expect(week.includes('stroke-dasharray="54.04 59.06"')).toBe(true)
  expect(week.includes('stroke-dasharray="8.53 18.85"')).toBe(true)
  expect((await ui.find({ type: 'Text', text: '42%' }))?.props.color).toBe(LOW)
  expect((await ui.find({ type: 'Text', text: '92%' }))?.props.color).toBe(
    CRITICAL,
  )
  expect(await ui.find({ type: 'Text', text: 'Current session' })).toBeUndefined()
  expect(await ui.find({ type: 'Button' })).toBeUndefined()

  await ui.unmount()
})

test('turns amber at 70% and stays blue below it', async ($, on) => {
  engine(on)
  await $.session.measure({
    ...MEASURE,
    rateLimits: [
      { kind: 'five_hour', percentUsed: 69.4, resetsAt: '2026-10-02T12:14:00Z' },
      { kind: 'seven_day', percentUsed: 70, resetsAt: '2026-10-05T14:00:00Z' },
    ],
  })
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  const svgs = await ui.findAll({ type: 'Svg' })

  expect((await ui.find({ type: 'Text', text: '69%' }))?.props.color).toBe(LOW)
  expect((await ui.find({ type: 'Text', text: '70%' }))?.props.color).toBe(
    WARNING,
  )
  expect(String(svgs[0]?.props.source).includes(`stroke="${LOW}"`)).toBe(true)
  expect(String(svgs[1]?.props.source).includes(`stroke="${WARNING}"`)).toBe(
    true,
  )

  await ui.unmount()
})

test('hides and shows on /usage-band, and stays out of the terminal', async (
  $,
  on,
) => {
  engine(on)
  await $.session.measure(MEASURE)

  const terminal = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await terminal.find({ text: '42%' })).toBeUndefined()
  await terminal.unmount()

  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await ui.find({ type: 'Svg' })).toBeDefined()

  await $.command.run(RUN)
  await ui.redraw()
  expect(await ui.find({ type: 'Svg' })).toBeUndefined()

  await $.command.run(RUN)
  await ui.redraw()
  expect(await ui.find({ type: 'Svg' })).toBeDefined()

  await ui.unmount()
})

test('draws nothing without a reading', async ($, on) => {
  engine(on)
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })

  expect(await ui.find({ type: 'Svg' })).toBeUndefined()

  await ui.unmount()
})

test('shows a move of less than a point after a turn', async ($, on) => {
  engine(on)
  await $.session.measure(MEASURE)
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })

  // What the engine raises after a turn that moved the session window by 0.6:
  // the exact figures, with `changed` naming only the context.
  await $.session.measure({
    ...MEASURE,
    rateLimits: [{ ...MEASURE.rateLimits[0]!, percentUsed: 42.6 }],
    changed: ['context'],
  })
  await ui.redraw()

  expect(await ui.find({ type: 'Text', text: '43%' })).toBeDefined()

  await ui.unmount()
})

test('reads the figures again on its ten-minute timer', async (
  $,
  on,
) => {
  const clock = mock.clock(on, { now: NOW })
  let current: SessionRateLimit[] = [...MEASURE.rateLimits]
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('session.usage', () => ({
    value: {
      startedAt: NOW,
      context: { window: 200_000 },
      rateLimits: current,
    },
  }))
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Box } = $.ui.resolve(e)

    return <Box />
  })

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: '42%' })).toBeDefined()

  current = [
    { kind: 'five_hour', percentUsed: 47.2, resetsAt: '2026-10-02T12:14:00Z' },
  ]
  await clock.advance(10 * 60_000)
  await ui.redraw()

  // A window missing from a reading stays: only a newer reading replaces it.
  expect(await ui.find({ type: 'Text', text: '47%' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '92%' })).toBeDefined()

  await ui.unmount()
})

test('shows a window past its reset time at 0% with no time left', async (
  $,
  on,
) => {
  const clock = engine(on)
  await $.session.measure(MEASURE)
  await clock.set(Date.parse('2026-10-02T12:15:00Z'))
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  const svgs = await ui.findAll({ type: 'Svg' })
  const session = String(svgs[0]?.props.source)

  expect(svgs[0]?.props.alt).toBe('Current session: 0% used, reset')
  expect(session.includes('stroke-dasharray="0.00 59.06"')).toBe(true)
  expect(session.includes('stroke-dasharray="0.00 18.85"')).toBe(true)
  expect((await ui.find({ type: 'Text', text: '0%' }))?.props.color).toBe(LOW)
  expect(String(svgs[1]?.props.source).includes('stroke-dasharray="8.27 18.85"')).toBe(
    true,
  )
  expect(await ui.find({ type: 'Text', text: '92%' })).toBeDefined()

  await ui.unmount()
})

test('keeps what another mod drew beside the dials on the desktop', async (
  $,
  on,
) => {
  engine(on, { hasOtherBand: true })
  await $.session.measure(MEASURE)
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  const drawn = await ui.drawn()
  const texts = await ui.findAll({ type: 'Text' })

  expect((await ui.findAll({ type: 'Svg' })).length).toBe(2)
  expect(await ui.find({ type: 'Text', text: 'another band' })).toBeDefined()
  // The dials come first, then what was beneath.
  expect(texts.map(one => one.text)).toEqual(['42%', '92%', 'another band'])
  expect('children' in drawn ? drawn.children?.length : 0).toBe(3)

  await ui.unmount()
})

test('leaves what another mod drew when /usage-band hides the dials', async (
  $,
  on,
) => {
  engine(on, { hasOtherBand: true })
  await $.session.measure(MEASURE)
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })

  await $.command.run(RUN)
  await ui.redraw()

  expect(await ui.find({ type: 'Text', text: 'another band' })).toBeDefined()
  expect(await ui.find({ type: 'Svg' })).toBeUndefined()

  await ui.unmount()
})

test('passes on what another mod drew in the terminal', async ($, on) => {
  engine(on, { hasOtherBand: true })
  await $.session.measure(MEASURE)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })

  expect(await ui.find({ type: 'Text', text: 'another band' })).toBeDefined()
  expect(await ui.find({ type: 'Svg' })).toBeUndefined()

  await ui.unmount()
})

test('adds nothing for the empty band of the engine', async ($, on) => {
  engine(on)
  await $.session.measure(MEASURE)
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  const drawn = await ui.drawn()

  expect(drawn.type).toBe('Box')
  expect('children' in drawn ? drawn.children?.length : 0).toBe(2)

  await ui.unmount()
})
