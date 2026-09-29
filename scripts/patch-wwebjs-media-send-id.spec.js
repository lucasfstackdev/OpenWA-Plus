'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { applyBackport, ANCHOR, PATCHED } = require('./patch-wwebjs-media-send-id.js');

function makeDependency(source) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'openwa-media-send-id-'));
  const utils = path.join(root, 'src', 'util', 'Injected', 'Utils.js');
  fs.mkdirSync(path.dirname(utils), { recursive: true });
  fs.writeFileSync(utils, source);
  return { root, utils };
}

test('strips the media model private __x_id from outgoing messages', () => {
  const { root, utils } = makeDependency(`before\n${ANCHOR}\nafter\n`);

  assert.deepEqual(applyBackport(root), { skipped: false, note: 'media model __x_id stripped from outgoing messages' });
  const out = fs.readFileSync(utils, 'utf8');
  assert.equal(out, `before\n${PATCHED}\nafter\n`);
  assert.match(out, /delete message\.__x_id;/);
});

test('is idempotent once patched', () => {
  const { root, utils } = makeDependency(`before\n${PATCHED}\nafter\n`);
  const original = fs.readFileSync(utils, 'utf8');

  assert.equal(applyBackport(root).skipped, true);
  assert.equal(fs.readFileSync(utils, 'utf8'), original);
});

test('rejects an unknown shape without changing it', () => {
  const { root, utils } = makeDependency('window.WWebJS.sendMessage = async () => {};\n');
  const original = fs.readFileSync(utils, 'utf8');

  assert.throws(() => applyBackport(root), /unsupported Utils\.js shape/);
  assert.equal(fs.readFileSync(utils, 'utf8'), original);
});

test('applies to the installed whatsapp-web.js (shape still matches)', () => {
  const real = path.join(__dirname, '..', 'node_modules', 'whatsapp-web.js', 'src', 'util', 'Injected', 'Utils.js');
  if (!fs.existsSync(real)) return;
  const src = fs.readFileSync(real, 'utf8');
  assert.ok(src.includes(ANCHOR) || src.includes(PATCHED));
});
