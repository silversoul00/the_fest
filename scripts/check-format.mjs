// Bug-hunt fixes (2026-10-23): safe redirects, slugs for Kannada/Hindi names, whole-letter cuts, UTR sanity.
// Run: node scripts/check-format.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';

const load = async (f) => import('data:text/javascript,' + encodeURIComponent(stripTypeScriptTypes(readFileSync(new URL(f, import.meta.url), 'utf8'))));
const { safeNext, slugify, festSlug, cutText, clip, initials } = await load('../src/lib/format.ts');
const { UTR_RE } = await load('../src/lib/upi-parse.ts');

// H1: only same-site paths
for (const ok of ['/me', '/organizer/abc?x=1', '/fests/neon#tickets', '/x?y=//z']) assert.equal(safeNext(ok), ok, ok);
for (const bad of ['//example.org/phish', '/\\example.org', '\\\\example.org', '/%5Cexample.org', '/%5cexample.org', '/%2F/example.org',
  '%2F%2Fexample.org', '/%252F%252Fexample.org', 'https://example.org', 'HTTPS://example.org', 'javascript:alert(1)', '/\t/example.org',
  '/%09/example.org', '/%0a/example.org', ' /me', 'me', '', null, undefined, 42, '/%E0%A4%A']) {
  assert.equal(safeNext(bad), '', String(bad));
}

// M5: Indian-script names become readable slugs; never plain "fest"
assert.equal(slugify('ನಮ್ಮ ಉತ್ಸವ नमस्ते Fest'), 'namma-utsava-namaste-fest');
assert.equal(slugify('नमस्ते'), 'namaste');
assert.equal(slugify('ಕನ್ನಡ ಹಬ್ಬ'), 'kannada-habba');
assert.equal(slugify('Café Fest'), 'cafe-fest');
assert.equal(slugify('Neon Utsav'), 'neon-utsav');
const base = { college: 'RV College', city: 'Bengaluru', starts_on: '2026-11-20' };
assert.equal(festSlug({ ...base, name: 'Fest' }), 'fest-rv-college-bengaluru');
assert.equal(festSlug({ ...base, name: '🎉🎉🎉' }), 'rv-college-bengaluru');
assert.match(festSlug({ name: '祭り', college: '祭り', city: '東京', starts_on: '2026-11-20' }), /^fest-2026-[a-z0-9]{4}$/);
for (const n of ['Fest', '🎉', 'Utsav 2026', '!!!']) assert.notEqual(festSlug({ ...base, name: n }), 'fest', n);

// Whole letters: a Kannada letter with its vowel sign / an emoji is never split
const kn = 'ಕ್ಷೇತ್ರ'.repeat(20);
const cut = cutText(kn, 7);
assert.ok(cut.endsWith('…'));
assert.ok(!/[ಾ-್]…$/.test(cut) || cut.normalize() === cut);
assert.equal(cutText('abc', 3), 'abc');
assert.equal(clip('👍🏽👍🏽', 5), '👍🏽');
assert.equal(clip('abcdef', 3), 'abc');
assert.equal(initials('👍🏽 Kumar'), '👍🏽K');
assert.ok([...'ಅರ್ಜುನ್ ಶರ್ಮ'].length > initials('ಅರ್ಜುನ್ ಶರ್ಮ').length);

// L3: obviously fake UTRs
assert.ok(UTR_RE.test('412345678901'));
for (const bad of ['000000000000', '111111111111', '99999999999', '4123456789012', 'abcdefghijkl']) assert.ok(!UTR_RE.test(bad), bad);

console.log('✓ format checks passed');
