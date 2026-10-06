"""Writes the BPMN 2.0 file of the usage-band mod and the page that renders it."""
import json
import sys
from xml.sax.saxutils import escape, quoteattr

OUT = sys.argv[1]

HEAD = (
    '<?xml version="1.0" encoding="UTF-8"?>\n'
    '<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" '
    'xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" '
    'xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" '
    'xmlns:di="http://www.omg.org/spec/DD/20100524/DI" '
    'id="{id}" targetNamespace="https://github.com/erdembircan/claude-usage-band">\n'
)


def bounds(x, y, w, h):
    return f'<dc:Bounds x="{x}" y="{y}" width="{w}" height="{h}"/>'


class Diagram:
    def __init__(self):
        self.sem = []
        self.di = []
        self.n = 0

    def uid(self, prefix):
        self.n += 1
        return f'{prefix}_{self.n}'

    def shape(self, ref, box, label=None, extra=''):
        inner = bounds(*box)
        if label:
            inner += f'<bpmndi:BPMNLabel>{bounds(*label)}</bpmndi:BPMNLabel>'
        self.di.append(
            f'<bpmndi:BPMNShape id="{ref}_di" bpmnElement="{ref}"{extra}>{inner}</bpmndi:BPMNShape>'
        )

    def edge(self, ref, points, label=None):
        inner = ''.join(f'<di:waypoint x="{x}" y="{y}"/>' for x, y in points)
        if label:
            inner += f'<bpmndi:BPMNLabel>{bounds(*label)}</bpmndi:BPMNLabel>'
        self.di.append(
            f'<bpmndi:BPMNEdge id="{ref}_di" bpmnElement="{ref}">{inner}</bpmndi:BPMNEdge>'
        )

    def node(self, tag, ref, name, box, label=None, body=''):
        self.sem.append(f'<bpmn:{tag} id="{ref}" name={quoteattr(name)}>{body}</bpmn:{tag}>')
        self.shape(ref, box, label)

    def flow(self, src, dst, points, name=None, label=None):
        ref = self.uid('Flow')
        attr = f' name={quoteattr(name)}' if name else ''
        self.sem.append(f'<bpmn:sequenceFlow id="{ref}" sourceRef="{src}" targetRef="{dst}"{attr}/>')
        self.edge(ref, points, label)

    def note(self, ref, text, box, target, points):
        self.sem.append(
            f'<bpmn:textAnnotation id="{ref}"><bpmn:text>{escape(text)}</bpmn:text></bpmn:textAnnotation>'
        )
        self.shape(ref, box)
        link = self.uid('Association')
        self.sem.append(f'<bpmn:association id="{link}" sourceRef="{target}" targetRef="{ref}"/>')
        self.edge(link, points)


def writes(d, store, points):
    """A task's data output association to a store; returns the task body."""
    ref = d.uid('DataOut')
    d.edge(ref, points)
    return f'<bpmn:dataOutputAssociation id="{ref}"><bpmn:targetRef>{store}</bpmn:targetRef></bpmn:dataOutputAssociation>'


def reads(d, store, points):
    ref = d.uid('DataIn')
    prop = d.uid('Property')
    d.edge(ref, points)
    return (
        f'<bpmn:property id="{prop}" name="__targetRef_placeholder"/>'
        f'<bpmn:dataInputAssociation id="{ref}"><bpmn:sourceRef>{store}</bpmn:sourceRef>'
        f'<bpmn:targetRef>{prop}</bpmn:targetRef></bpmn:dataInputAssociation>'
    )


def ev(cx, cy):
    return (cx - 18, cy - 18, 36, 36)


def task(cx, cy, w=150, h=80):
    return (cx - w // 2, cy - h // 2, w, h)


def gw(cx, cy):
    return (cx - 25, cy - 25, 50, 50)


# ---------------------------------------------------------------- data feed
def feed():
    d = Diagram()
    lanes = {'you': [], 'engine': [], 'mod': []}
    ROW = 440          # what each start does to the session state
    JOB = 850          # the redraw that follows
    END_Y = 960        # collecting line
    cols = {'toggle': 280, 'start': 620, 'measure': 820, 'tick': 1180}
    MID = 720          # where the two readings meet

    d.node('dataStoreReference', 'Store_hidden', 'hidden\n(session state)', (350, 520, 50, 50))
    d.node('dataStoreReference', 'Store_limits', 'limits\n(session state)', (875, 665, 50, 50))

    def start(ref, name, lane, cx, cy, definition=''):
        d.node('startEvent', ref, name, ev(cx, cy), (cx + 26, cy - 20, 120, 40), definition)
        lanes[lane].append(ref)

    start('Start_toggle', '/usage-band\ntyped', 'you', cols['toggle'], 100)
    start('Start_session', 'Session starts,\nor /clear', 'engine', cols['start'], 225)
    start('Start_measure', 'Usage measured\nafter a turn', 'engine', cols['measure'], 225,
          '<bpmn:messageEventDefinition/>')
    start('Start_tick', 'Every\nminute', 'mod', cols['tick'], 335,
          '<bpmn:timerEventDefinition/>')

    def step(ref, name, cx, cy, body=''):
        d.node('task', ref, name, task(cx, cy), None, body)
        lanes['mod'].append(ref)

    step('Task_toggle', 'Flip hidden on or off', cols['toggle'], ROW,
         writes(d, 'Store_hidden', [(320, 480), (360, 520)]))
    step('Task_start', 'Add /usage-band and read the limits', cols['start'], ROW)
    step('Task_measure', 'Take the reported limits', cols['measure'], ROW)

    d.node('exclusiveGateway', 'Gw_differ', 'Do they differ from the stored figures?',
           gw(MID, 570), (575, 550, 115, 40))
    lanes['mod'].append('Gw_differ')
    d.node('endEvent', 'End_same', 'Band left\nas it is', ev(900, 570), (855, 592, 90, 27))
    lanes['mod'].append('End_same')
    step('Task_keep', 'Store the new figures', MID, 690,
         writes(d, 'Store_limits', [(795, 690), (875, 690)]))

    step('Job_toggle', 'Draw the dials, or leave them out', cols['toggle'], JOB)
    step('Job_figures', 'Redraw from the new figures', MID, JOB)
    step('Job_clock', 'Redraw against the clock', cols['tick'], JOB,
         reads(d, 'Store_limits', [(925, 690), (1140, 690), (1140, JOB - 40)]))

    d.node('endEvent', 'End_redraw', 'Band is redrawn', ev(1620, END_Y),
           (1575, END_Y + 22, 90, 14), '<bpmn:signalEventDefinition/>')
    lanes['mod'].append('End_redraw')

    d.flow('Start_toggle', 'Task_toggle', [(cols['toggle'], 118), (cols['toggle'], ROW - 40)])
    d.flow('Start_session', 'Task_start', [(cols['start'], 243), (cols['start'], ROW - 40)])
    d.flow('Start_measure', 'Task_measure', [(cols['measure'], 243), (cols['measure'], ROW - 40)])
    for key in ('start', 'measure'):
        x = cols[key]
        d.flow(f'Task_{key}', 'Gw_differ', [(x, ROW + 40), (x, 520), (MID, 520), (MID, 545)])
    d.flow('Gw_differ', 'End_same', [(MID + 25, 570), (882, 570)], 'no', (765, 550, 14, 14))
    d.flow('Gw_differ', 'Task_keep', [(MID, 595), (MID, 650)], 'yes', (728, 610, 20, 14))
    d.flow('Task_toggle', 'Job_toggle', [(cols['toggle'], ROW + 40), (cols['toggle'], JOB - 40)])
    d.flow('Task_keep', 'Job_figures', [(MID, 730), (MID, JOB - 40)])
    d.flow('Start_tick', 'Job_clock', [(cols['tick'], 353), (cols['tick'], JOB - 40)])
    for job, x in [('Job_toggle', cols['toggle']), ('Job_figures', MID), ('Job_clock', cols['tick'])]:
        d.flow(job, 'End_redraw', [(x, JOB + 40), (x, END_Y), (1602, END_Y)])

    d.note('Note_figures',
           'The ring and the percentage take the new share used. The wedge takes the new reset time.',
           (830, 820, 240, 60), 'Job_figures', [(795, JOB), (830, JOB)])
    d.note('Note_clock',
           'Reads nothing new: the stored figures, set against the time now.\n'
           '1. The wedge shrinks as the window runs out.\n'
           '2. A window past its reset time is drawn at 0%.\n'
           'Nothing else on the band moves.',
           (1290, 790, 270, 120), 'Job_clock', [(1255, JOB), (1290, JOB)])

    lane_xml = ''.join(
        f'<bpmn:lane id="Lane_{key}" name={quoteattr(name)}>'
        + ''.join(f'<bpmn:flowNodeRef>{ref}</bpmn:flowNodeRef>' for ref in lanes[key])
        + '</bpmn:lane>'
        for key, name in [('you', 'You'), ('engine', 'Claude Code'), ('mod', 'usage-band mod')]
    )
    d.shape('Participant', (150, 40, 1530, 1040), extra=' isHorizontal="true"')
    d.shape('Lane_you', (180, 40, 1500, 120), extra=' isHorizontal="true"')
    d.shape('Lane_engine', (180, 160, 1500, 120), extra=' isHorizontal="true"')
    d.shape('Lane_mod', (180, 280, 1500, 800), extra=' isHorizontal="true"')

    return (
        HEAD.format(id='Definitions_feed')
        + '<bpmn:collaboration id="Collaboration">'
        '<bpmn:participant id="Participant" name="Claude desktop session" processRef="Process_feed"/>'
        '</bpmn:collaboration>\n'
        + '<bpmn:process id="Process_feed" name="Keeping the figures current" isExecutable="false">'
        + f'<bpmn:laneSet id="LaneSet">{lane_xml}</bpmn:laneSet>'
        + ''.join(d.sem)
        + '</bpmn:process>\n'
        + '<bpmndi:BPMNDiagram id="Diagram_feed"><bpmndi:BPMNPlane id="Plane_feed" bpmnElement="Collaboration">'
        + ''.join(d.di)
        + '</bpmndi:BPMNPlane></bpmndi:BPMNDiagram>\n</bpmn:definitions>\n'
    )


PAGE = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>usage-band BPMN</title>
<style>
  body { margin: 0; padding: 16px 24px 32px; font: 14px/1.4 -apple-system, "Segoe UI", sans-serif; background: #fff; color: #222; }
  h2 { font-size: 15px; font-weight: 600; margin: 20px 0 8px; }
  .canvas { border: 1px solid #ccc; }
  #feed { height: 940px; }
</style>
</head>
<body>
<h2>Keeping the figures current</h2>
<div class="canvas" id="feed"></div>
<script src="https://unpkg.com/bpmn-js@17.11.1/dist/bpmn-navigated-viewer.production.min.js"></script>
<script>
  const diagrams = __DIAGRAMS__;
  const viewers = [];
  const fit = viewer => {
    try {
      viewer.get('canvas').zoom('fit-viewport', 'auto');
    } catch (error) {
      // The canvas has no size yet (a hidden tab): it is fitted on the next resize.
    }
  };
  for (const [id, xml] of Object.entries(diagrams)) {
    const viewer = new BpmnJS({ container: '#' + id });
    viewers.push(viewer);
    viewer.importXML(xml).then(({ warnings }) => {
      if (warnings.length) console.warn(id, warnings);
      requestAnimationFrame(() => fit(viewer));
    }).catch(error => console.error(id, error));
  }
  window.viewers = viewers;
  window.addEventListener('resize', () => viewers.forEach(fit));
</script>
</body>
</html>
"""

files = {'feed': feed()}
open(f'{OUT}/usage-band-feed.bpmn', 'w').write(files['feed'])
open(f'{OUT}/bpmn.html', 'w').write(
    PAGE.replace('__DIAGRAMS__', json.dumps(files).replace('</', '<\\/'))
)
print('written')
