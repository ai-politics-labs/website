import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(process.env.AIP_SIGNATURE_SOURCE || new URL('../src/pages/index.astro', import.meta.url), 'utf8');
const start = source.indexOf("const canvas = document.getElementById('signature-canvas');");
const signatureSetup = source.slice(start, source.indexOf('// 자택 전화번호', start));

function setup() {
  const size = { width: 600, height: 160 };
  const events = {};
  const button = { addEventListener(name, handler) { events[name] = handler; } };
  const context = { setTransform(...args) { this.transform = args; }, scale() {} };
  const canvas = { width: 300, height: 150, getBoundingClientRect: () => size, getContext: () => context };
  let pad;
  let observer;
  class SignaturePad {
    constructor() { pad = this; this.data = []; this.events = {}; }
    toData() { return this.data; }
    fromData(data) { this.data = data; }
    clear() { this.data = []; }
    addEventListener(name, handler) { this.events[name] = handler; }
  }
  const window = { devicePixelRatio: 2, addEventListener(name, handler) { events[name] = handler; } };
  vm.runInNewContext(signatureSetup, {
    SignaturePad, window,
    document: { getElementById: id => id === 'signature-canvas' ? canvas : button },
    ResizeObserver: class { constructor(callback) { observer = callback; } observe() {} },
  });
  return {
    canvas, context, pad,
    draw() {
      pad.data = [{ penColor: 'black', points: [{ x: 100, y: 40, time: 1 }, { x: 500, y: 120, time: 2 }] }];
      pad.events.endStroke?.();
    },
    resize(width, height, ratio = 2) {
      Object.assign(size, { width, height });
      window.devicePixelRatio = ratio;
      if (observer) observer();
      else events.resize?.();
    },
    clear() { events.click(); },
    points() { return JSON.parse(JSON.stringify(pad.data[0]?.points ?? [])); },
  };
}

test('signature survives narrow/wide rotations without distortion or cumulative shrinkage', () => {
  const app = setup();
  app.draw();
  app.resize(300, 160);
  assert.equal(app.canvas.width, 600);
  assert.equal(app.canvas.height, 320);
  assert.deepEqual(app.points(), [{ x: 50, y: 20, time: 1 }, { x: 250, y: 60, time: 2 }]);
  for (let i = 0; i < 3; i++) {
    app.resize(600, 160);
    assert.deepEqual(app.points(), [{ x: 100, y: 40, time: 1 }, { x: 500, y: 120, time: 2 }]);
    app.resize(300, 160);
  }
  app.resize(600, 160, 1);
  assert.equal(app.canvas.width, 600);
  assert.equal(app.canvas.height, 160);
  assert.deepEqual(app.context.transform, [1, 0, 0, 1, 0, 0]);
});

test('a cleared signature cannot reappear when the form resizes', () => {
  const app = setup();
  app.draw();
  app.clear();
  app.resize(300, 160);
  app.resize(600, 160);
  assert.deepEqual(app.points(), []);
});

test('temporarily hiding the canvas preserves its bitmap and signed strokes', () => {
  const app = setup();
  app.draw();
  app.resize(0, 0);
  assert.equal(app.canvas.width, 1200);
  assert.equal(app.canvas.height, 320);
  assert.deepEqual(app.points(), [{ x: 100, y: 40, time: 1 }, { x: 500, y: 120, time: 2 }]);
});
