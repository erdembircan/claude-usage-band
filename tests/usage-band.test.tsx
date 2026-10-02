import type { On, SessionMeasureInput, SessionRateLimit } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

const NOW = Date.parse('2026-10-02T10:00:00Z')

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

const MEASURE: SessionMeasureInput = {
  context: { window: 200_000 },
  rateLimits: [
    { kind: 'five_hour', percentUsed: 42, resetsAt: '2026-10-02T12:14:00Z' },
    { kind: 'seven_day', percentUsed: 91.5, resetsAt: '2026-10-05T14:00:00Z' },
  ],
  changed: ['rateLimits'],
}

// What the engine does beneath the mod: echo the measurement, draw an empty band.
const engine = (on: On) => {
  const clock = mock.clock(on, { now: NOW })
  on('session.measure', (_, e) => ({ changed: e.changed }))
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Box } = $.ui.resolve(e)

    return <Box />
  })

  return clock
}

test('draws both windows on the desktop', async ($, on) => {
  engine(on)
  await $.session.measure(MEASURE)
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })

  expect(await ui.find({ type: 'Text', text: 'Current session' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '42%' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /resets in 2h 14m/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'Weekly' })).toBeDefined()
  expect((await ui.find({ type: 'Text', text: '92%' }))?.props.color).toBe(
    'error',
  )
  expect(await ui.find({ type: 'Text', text: /resets in 3d 4h/ })).toBeDefined()
  expect((await ui.findAll({ type: 'Svg' })).length).toBe(2)

  await ui.unmount()
})

test('hides on its button and stays out of the terminal', async ($, on) => {
  engine(on)
  await $.session.measure(MEASURE)

  const terminal = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await terminal.find({ text: 'Current session' })).toBeUndefined()
  await terminal.unmount()

  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await ui.press({ key: 'hide' })
  expect(await ui.find({ text: 'Current session' })).toBeUndefined()

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

test('shows a window past its reset time as reset, at 0%', async ($, on) => {
  const clock = engine(on)
  await $.session.measure(MEASURE)
  await clock.set(Date.parse('2026-10-02T12:15:00Z'))
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })

  expect(await ui.find({ type: 'Text', text: 'Current session' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '0%' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '· reset' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '92%' })).toBeDefined()

  await ui.unmount()
})
