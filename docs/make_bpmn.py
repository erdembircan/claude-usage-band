"""Writes the two BPMN 2.0 files of the usage-band mod and the page that renders them."""
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
    ROW = 440          # task row
    END_Y = 620        # collecting line
    cols = {'toggle': 280, 'start': 680, 'measure': 880, 'tick': 1080}

    d.node('dataStoreReference', 'Store_hidden', 'hidden\n(session state)', (350, 520, 50, 50))
    d.node('dataStoreReference', 'Store_limits', 'limits\n(session state)', (755, 520, 50, 50))

    def start(ref, name, lane, cx, cy, definition=''):
        d.node('startEvent', ref, name, ev(cx, cy), (cx + 26, cy - 20, 120, 40), definition)
        lanes[lane].append(ref)

    start('Start_toggle', '/usage-band\ntyped', 'you', cols['toggle'], 100)
    start('Start_session', 'Session starts,\nor /clear', 'engine', cols['start'], 225)
    start('Start_measure', 'Usage measured\nafter a turn', 'engine', cols['measure'], 225,
          '<bpmn:messageEventDefinition/>')
    start('Start_tick', 'Every\nminute', 'mod', cols['tick'], 335,
          '<bpmn:timerEventDefinition/>')

    def step(ref, name, cx, body=''):
        d.node('task', ref, name, task(cx, ROW), None, body)
        lanes['mod'].append(ref)

    step('Task_toggle', 'Flip hidden on or off', cols['toggle'],
         writes(d, 'Store_hidden', [(320, 480), (360, 520)]))
    step('Task_start', 'Add /usage-band and read the limits', cols['start'],
         writes(d, 'Store_limits', [(720, 480), (765, 520)]))
    step('Task_measure', 'Keep the reported limits', cols['measure'],
         writes(d, 'Store_limits', [(840, 480), (795, 520)]))

    d.node('endEvent', 'End_redraw', 'Band is redrawn', ev(1180, END_Y),
           (1135, END_Y + 22, 90, 14), '<bpmn:signalEventDefinition/>')
    lanes['mod'].append('End_redraw')

    for key, src, dst, top in [
        ('toggle', 'Start_toggle', 'Task_toggle', 118),
        ('start', 'Start_session', 'Task_start', 243),
        ('measure', 'Start_measure', 'Task_measure', 243),
    ]:
        x = cols[key]
        d.flow(src, dst, [(x, top), (x, ROW - 40)])
        d.flow(dst, 'End_redraw', [(x, ROW + 40), (x, END_Y), (1162, END_Y)])
    d.flow('Start_tick', 'End_redraw', [(cols['tick'], 353), (cols['tick'], END_Y), (1162, END_Y)])

    lane_xml = ''.join(
        f'<bpmn:lane id="Lane_{key}" name={quoteattr(name)}>'
        + ''.join(f'<bpmn:flowNodeRef>{ref}</bpmn:flowNodeRef>' for ref in lanes[key])
        + '</bpmn:lane>'
        for key, name in [('you', 'You'), ('engine', 'Claude Code'), ('mod', 'usage-band mod')]
    )
    d.shape('Participant', (150, 40, 1110, 650), extra=' isHorizontal="true"')
    d.shape('Lane_you', (180, 40, 1080, 120), extra=' isHorizontal="true"')
    d.shape('Lane_engine', (180, 160, 1080, 120), extra=' isHorizontal="true"')
    d.shape('Lane_mod', (180, 280, 1080, 410), extra=' isHorizontal="true"')

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


# --------------------------------------------------------------- visibility
def visibility():
    d = Diagram()
    Y = 230            # main line
    OUT_Y = 400        # "not shown" ends

    d.node('startEvent', 'Start_draw', 'Band is about\nto be drawn', ev(200, Y),
           (155, Y + 24, 90, 27), '<bpmn:signalEventDefinition/>')

    def decide(ref, name, cx):
        d.node('exclusiveGateway', ref, name, gw(cx, Y), (cx - 70, Y - 80, 140, 40))

    def stop(ref, name, cx):
        d.node('endEvent', ref, name, ev(cx, OUT_Y), (cx - 60, OUT_Y + 24, 120, 27))

    decide('Gw_surface', 'In the desktop app?', 340)
    decide('Gw_survey', 'Is a Claude Code survey using the band?', 510)
    d.node('dataStoreReference', 'Store_limits', 'limits\n(session state)', (675, 50, 50, 50), (735, 62, 80, 27))
    d.node('task', 'Task_read', 'Take the stored limits; a window past its reset time counts as 0%',
           task(700, Y, 170), None, reads(d, 'Store_limits', [(700, 100), (700, Y - 40)]))
    decide('Gw_reading', 'Any session or weekly reading stored?', 900)
    d.node('dataStoreReference', 'Store_hidden', 'hidden\n(session state)', (1045, 50, 50, 50), (1105, 62, 80, 27))
    d.node('task', 'Task_hidden', 'Check the hidden flag', task(1070, Y, 130), None,
           reads(d, 'Store_hidden', [(1070, 100), (1070, Y - 40)]))
    decide('Gw_hidden', 'Hidden by you?', 1230)
    d.node('task', 'Task_build', 'Build the row: a mark and a percentage per window', task(1400, Y, 150))
    d.node('endEvent', 'End_shown', 'Usage row shown', ev(1560, Y), (1515, Y + 24, 90, 14))

    stop('End_surface', 'Not shown', 340)
    stop('End_survey', 'Not shown', 510)
    stop('End_reading', 'Not shown', 900)
    stop('End_hidden', 'Not shown', 1230)

    d.flow('Start_draw', 'Gw_surface', [(218, Y), (315, Y)])
    d.flow('Gw_surface', 'Gw_survey', [(365, Y), (485, Y)], 'yes', (395, Y - 20, 20, 14))
    d.flow('Gw_surface', 'End_surface', [(340, Y + 25), (340, OUT_Y - 18)], 'no', (348, Y + 40, 14, 14))
    d.flow('Gw_survey', 'Task_read', [(535, Y), (615, Y)], 'no', (560, Y - 20, 14, 14))
    d.flow('Gw_survey', 'End_survey', [(510, Y + 25), (510, OUT_Y - 18)], 'yes', (518, Y + 40, 20, 14))
    d.flow('Task_read', 'Gw_reading', [(785, Y), (875, Y)])
    d.flow('Gw_reading', 'Task_hidden', [(925, Y), (1005, Y)], 'yes', (950, Y - 20, 20, 14))
    d.flow('Gw_reading', 'End_reading', [(900, Y + 25), (900, OUT_Y - 18)], 'no', (908, Y + 40, 14, 14))
    d.flow('Task_hidden', 'Gw_hidden', [(1135, Y), (1205, Y)])
    d.flow('Gw_hidden', 'Task_build', [(1255, Y), (1325, Y)], 'no', (1280, Y - 20, 14, 14))
    d.flow('Gw_hidden', 'End_hidden', [(1230, Y + 25), (1230, OUT_Y - 18)], 'yes', (1238, Y + 40, 20, 14))
    d.flow('Task_build', 'End_shown', [(1475, Y), (1542, Y)])

    d.note('Note_surface', 'The terminal and other apps never show it.',
           (250, 490, 180, 40), 'End_surface', [(340, OUT_Y + 60), (340, 490)])
    d.note('Note_survey', 'Comes back by itself when the survey closes.',
           (450, 490, 180, 40), 'End_survey', [(510, OUT_Y + 60), (520, 490)])
    d.note('Note_reading',
           'No reading in two cases:\n'
           '1. New session: Claude Code learns the limits from a reply, so nothing shows until the first message is answered.\n'
           '2. The account has no plan limits.',
           (720, 490, 360, 100), 'End_reading', [(900, OUT_Y + 60), (900, 490)])
    d.note('Note_hidden', 'Until /usage-band is typed again, /clear, or a new session.',
           (1140, 490, 200, 54), 'End_hidden', [(1230, OUT_Y + 60), (1230, 490)])

    return (
        HEAD.format(id='Definitions_visibility')
        + '<bpmn:process id="Process_visibility" name="Is the usage band shown?" isExecutable="false">'
        + ''.join(d.sem)
        + '</bpmn:process>\n'
        + '<bpmndi:BPMNDiagram id="Diagram_visibility"><bpmndi:BPMNPlane id="Plane_visibility" bpmnElement="Process_visibility">'
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
  #visibility { height: 640px; }
  #feed { height: 700px; }
</style>
</head>
<body>
<h2>Is the usage band shown?</h2>
<div class="canvas" id="visibility"></div>
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

files = {'visibility': visibility(), 'feed': feed()}
open(f'{OUT}/usage-band-visibility.bpmn', 'w').write(files['visibility'])
open(f'{OUT}/usage-band-feed.bpmn', 'w').write(files['feed'])
open(f'{OUT}/bpmn.html', 'w').write(
    PAGE.replace('__DIAGRAMS__', json.dumps(files).replace('</', '<\\/'))
)
print('written')
