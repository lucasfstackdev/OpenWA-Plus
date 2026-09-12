import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePhoneFromJid, formatPhoneForDisplay, formatBrazilianPhone } from './formatPhone.ts';

test('parsePhoneFromJid extracts digits from a personal @c.us JID', () => {
  assert.equal(parsePhoneFromJid('628123456789@c.us'), '628123456789');
});

test('parsePhoneFromJid strips the :device suffix on group-participant ids', () => {
  assert.equal(parsePhoneFromJid('628123456789@c.us:7'), '628123456789');
});

test('parsePhoneFromJid returns null for group JIDs', () => {
  assert.equal(parsePhoneFromJid('120363abc@g.us'), null);
});

test('parsePhoneFromJid returns null for LID privacy ids', () => {
  assert.equal(parsePhoneFromJid('abcdef@lid'), null);
});

test('parsePhoneFromJid returns null for a DIGITS-ONLY LID (privacy ids are not phones)', () => {
  // The actual bug: a LID user part is all digits, so the digits check alone formatted it as a
  // fake phone number ("+26 281 346 125 0071"). The domain guard rejects it first.
  assert.equal(parsePhoneFromJid('262813461250071@lid'), null);
});

test('parsePhoneFromJid returns null for a digits-only GROUP id (not a phone either)', () => {
  assert.equal(parsePhoneFromJid('120363404149049457@g.us'), null);
});

test('parsePhoneFromJid returns null for broadcast/newsletter/status JIDs', () => {
  assert.equal(parsePhoneFromJid('status@broadcast'), null);
  assert.equal(parsePhoneFromJid('abc@newsletter'), null);
});

test('formatPhoneForDisplay formats a typical Indonesian number with 2-digit country code', () => {
  assert.equal(formatPhoneForDisplay('628123456789'), '+62 812 345 6789');
});

test('formatPhoneForDisplay formats a US-style 11-digit number with 1-digit country code', () => {
  assert.equal(formatPhoneForDisplay('14155552671'), '+1 415 555 2671');
});

test('formatPhoneForDisplay returns null for non-phone JIDs (group/lid)', () => {
  assert.equal(formatPhoneForDisplay('120363abc@g.us'), null);
  assert.equal(formatPhoneForDisplay('xyz@lid'), null);
});

test('formatPhoneForDisplay returns null for a digits-only LID instead of inventing a phone', () => {
  assert.equal(formatPhoneForDisplay('262813461250071@lid'), null);
});

test('formatPhoneForDisplay passes short codes through unchanged with a + prefix', () => {
  assert.equal(formatPhoneForDisplay('911'), '+911');
});

test('formatPhoneForDisplay accepts a raw JID as input (delegates to parsePhoneFromJid)', () => {
  assert.equal(formatPhoneForDisplay('628123456789@c.us'), '+62 812 345 6789');
});

test('formatBrazilianPhone formats a complete 13-digit BR mobile number', () => {
  assert.equal(formatBrazilianPhone('5518991604584'), '55 (18) 99160 4584');
});

test('formatBrazilianPhone passes through 2 or fewer digits unchanged (country code being typed)', () => {
  assert.equal(formatBrazilianPhone('5'), '5');
  assert.equal(formatBrazilianPhone('55'), '55');
});

test('formatBrazilianPhone opens the area-code group without closing it until more digits follow', () => {
  assert.equal(formatBrazilianPhone('551'), '55 (1');
  assert.equal(formatBrazilianPhone('5518'), '55 (18');
});

test('formatBrazilianPhone closes the area-code group once the number starts', () => {
  assert.equal(formatBrazilianPhone('55189'), '55 (18) 9');
});

test('formatBrazilianPhone caps at 13 digits, ignoring anything typed beyond that', () => {
  assert.equal(formatBrazilianPhone('551899160458499'), '55 (18) 99160 4584');
});
