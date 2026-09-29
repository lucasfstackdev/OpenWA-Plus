/**
 * Stop the media model's private id from leaking into an outgoing media message.
 *
 * `window.WWebJS.sendMessage` assembles `message = { id: newMsgKey, ..., ...mediaOptions, ... }`.
 * `mediaOptions` is a WhatsApp MediaData model, and spreading it copies its enumerable private field
 * `__x_id: undefined` onto the plain object. On WhatsApp Web 2.3000.10477+ `Msg.initialize` reads
 * `__x_id` as the model id, so the send throws "Data passed to getter must include an id property
 * ... got undefined" — every image, video, audio and document send fails while text sends (which
 * spread no media model) keep working. Same fix as rmyndharis/OpenWA#1670.
 *
 * The fix deletes that one key after the object is built. The source transform is deliberately exact
 * and self-disabling: an unknown shape fails the image build instead of silently shipping without it.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_WWJS = path.join(__dirname, '..', 'node_modules', 'whatsapp-web.js');
const UTILS_PATH = path.join('src', 'util', 'Injected', 'Utils.js');

const ANCHOR = "            ...extraOptions,\n        };\n\n        // Bot's won't reply if canonicalUrl is set (linking)";
const FIX_MARKER = 'delete message.__x_id;';
const PATCHED =
  "            ...extraOptions,\n        };\n        // openwa: the media model leaks its private __x_id (undefined) through the spread above.\n        delete message.__x_id;\n\n        // Bot's won't reply if canonicalUrl is set (linking)";

function occurrences(source, needle) {
  return source.split(needle).length - 1;
}

function applyBackport(wwjsDir = DEFAULT_WWJS) {
  const utilsFile = path.join(wwjsDir, UTILS_PATH);
  if (!fs.existsSync(utilsFile)) {
    throw new Error(`whatsapp-web.js Utils.js not found at ${utilsFile}`);
  }

  const source = fs.readFileSync(utilsFile, 'utf8');
  const anchorCount = occurrences(source, ANCHOR);
  const patchedCount = occurrences(source, PATCHED);

  if (anchorCount === 0 && patchedCount === 1) {
    return { skipped: true, reason: 'the media model private __x_id is already stripped' };
  }
  if (anchorCount !== 1 || patchedCount !== 0) {
    throw new Error(
      `unsupported Utils.js shape (unpatched: ${anchorCount}, patched: ${patchedCount}); ` +
        're-evaluate the media-send id repair against the installed whatsapp-web.js',
    );
  }

  fs.writeFileSync(utilsFile, source.replace(ANCHOR, PATCHED));
  return { skipped: false, note: 'media model __x_id stripped from outgoing messages' };
}

function run() {
  const bestEffort = process.argv.includes('--best-effort');
  try {
    const result = applyBackport();
    console.log(`patch-wwebjs-media-send-id: ${result.skipped ? `skipped — ${result.reason}` : result.note}`);
  } catch (error) {
    if (bestEffort) {
      console.warn(`patch-wwebjs-media-send-id: skipped — ${error.message}`);
      return;
    }
    console.error(`patch-wwebjs-media-send-id: ${error.message}`);
    process.exitCode = 1;
  }
}

if (require.main === module) run();

module.exports = { applyBackport, ANCHOR, PATCHED, FIX_MARKER };
