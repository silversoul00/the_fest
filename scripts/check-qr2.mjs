// Smart QR (TF2) self-check: seal on the "server", open with the scanner's WebCrypto code, no database.
// Usage: node --conditions=react-server scripts/check-qr2.mjs      (run by tests/run-e2e.sh)
import { randomUUID } from 'node:crypto';
import QRCode from 'qrcode';
import { loadEnv } from './env.mjs';

loadEnv();
const { sealTicket, scannerKeys, verifyTf2, openPublic, liveSecret, liveCode } = await import('../src/lib/qr2.ts');
const { importBundle, openTicket } = await import('../src/lib/qr2-client.ts');
const { b64u, unb64u, splitTf2, liveStep, ROLES } = await import('../src/lib/qr2-format.ts');
const { signTicket } = await import('../src/lib/ticket-crypto.ts');

let fails = 0;
const check = (name, ok, extra = '') => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'} qr2: ${name}${extra ? `  [${extra}]` : ''}`); };

const festId = randomUUID(), otherFest = randomUUID(), ticketId = randomUUID();
const worst = {
  ticketId, festId, epoch: 1, name: 'Abcdefghijklmnopqrstuvwxyz', type: 'Workshop Bundle Plus',
  startsOn: '2026-11-01', endsOn: '2026-11-16', lunchDays: ['2026-11-01', '2026-11-03', '2026-11-16'], stay: true,
  aid: { blood: 'AB-', phone: '9876543210', allergies: 'Peanuts, penicillin, dust' }, holderPhone: '+91 98450 12345',
};
const bundleFor = async (fid, roles, epoch = 1) => importBundle({
  festId: fid, startsOn: worst.startsOn, endsOn: worst.endsOn, epoch, expiresAt: new Date(Date.now() + 864e5).toISOString(),
  ...JSON.parse(JSON.stringify(scannerKeys(fid, roles, epoch))),
});
const withLive = async (url, step = liveStep(Date.now())) => `${url}.${b64u(new Uint8Array(liveCode(liveSecret(ticketId), step)))}`;

// Size: all five sections + live code, 20-char name, 16-byte allergies, 16-day fest (2-byte lunch mask)
const s1 = sealTicket('https://thefest.in', worst);
const big = await withLive(s1.url);
const ver = QRCode.create(big, { errorCorrectionLevel: 'M' }).version;
check('worst case ≤ 300 chars and QR version ≤ 13 (thefest.in)', big.length <= 300 && ver <= 13, `${big.length} chars, v${ver}`);
const local = await withLive(sealTicket('http://localhost:3000', worst).url);
check('worst case ≤ 13 on localhost too (e2e)', QRCode.create(local, { errorCorrectionLevel: 'M' }).version <= 13, `${local.length} chars`);

// Round trip with every key (organizer)
const all = await bundleFor(festId, ROLES);
const o = await openTicket(big, all);
check('organizer opens all sections', o.kind === 'ok' && o.gate?.name === 'Abcdefghijklmnopqrst' && o.gate?.type === 'Workshop Bun'
  && o.stay === true && o.lunch === 0b1000000000000101 && o.aid?.blood === 'AB-' && o.aid?.phone === '9876543210'
  && o.aid?.allergies === 'Peanuts, penicil' && o.org === '9845012345' && o.live === 'live', JSON.stringify(o));
const sv = verifyTf2(big);
check('server verifies TF2 + live', sv.ok && sv.ticketId === ticketId && sv.live === 'live');

// Role isolation
const gateOnly = await openTicket(big, await bundleFor(festId, ['gate']));
check('gate key opens only gate', gateOnly.kind === 'ok' && gateOnly.gate && gateOnly.lunch === undefined && !gateOnly.aid && !gateOnly.org);
const lunchOnly = await openTicket(big, await bundleFor(festId, ['lunch']));
check('lunch key opens only lunch (no live chip)', lunchOnly.kind === 'ok' && lunchOnly.lunch !== undefined && !lunchOnly.gate && !lunchOnly.aid && lunchOnly.live === null);
const aidOnly = await openTicket(big, await bundleFor(festId, ['aid']));
check('aid key opens only aid', aidOnly.kind === 'ok' && aidOnly.aid && !aidOnly.gate && !aidOnly.org);

// Tamper every byte of P and F → rejected by scanner and server
const parts = splitTf2(s1.url);
const P = unb64u(parts.p), F = unb64u(parts.f);
let scannerOk = true, serverOk = true;
for (const [which, bytes] of [['p', P], ['f', F]]) {
  for (let i = 0; i < bytes.length; i++) {
    const c = bytes.slice(); c[i] ^= 0x01;
    const url = which === 'p' ? `https://thefest.in/t/${b64u(c)}#${parts.f}` : `https://thefest.in/t/${parts.p}#${b64u(c)}`;
    if ((await openTicket(url, all)).kind !== 'tampered') scannerOk = false;
    if (verifyTf2(url).ok) serverOk = false;
  }
}
check(`flipping any of ${P.length + F.length} bytes → scanner "tampered"`, scannerOk);
check('flipping any byte → server rejects', serverOk);
check('non-canonical base64 (last char changed) rejected', unb64u(parts.f.slice(0, -1) + (parts.f.endsWith('A') ? 'B' : 'A')) === null || verifyTf2(`${s1.url.split('#')[0]}#${parts.f.slice(0, -1)}${parts.f.endsWith('A') ? 'B' : 'A'}`).ok === false);

// Other fest's keys
const wf = await openTicket(big, await bundleFor(otherFest, ['gate']));
check('another fest\'s keys → wrong fest', wf.kind === 'wrong_fest', wf.kind);

// Fresh nonce per render
const s2 = sealTicket('https://thefest.in', worst);
check('each render has a new nonce (same P, different F)', splitTf2(s2.url).p === parts.p && splitTf2(s2.url).f !== parts.f);

// Live window
const now = liveStep(Date.now());
const states = [];
for (const d of [-3, -2, 1, 2]) states.push((await openTicket(await withLive(s1.url, now + d), all)).live);
check('live window: −3 stale, −2 live, +1 live, +2 stale', states.join() === 'stale,live,live,stale', states.join());
check('no live code → static', (await openTicket(s1.url, all)).live === 'static' && verifyTf2(s1.url).live === 'static');
check('server: 4 steps old → stale', verifyTf2(await withLive(s1.url, now - 4)).live === 'stale');

// Key epochs: previous epoch still opens; two epochs old needs the network
const e1 = sealTicket('https://thefest.in', { ...worst, epoch: 1 }).url;
check('epoch 2 phone opens epoch 1 QR', (await openTicket(e1, await bundleFor(festId, ['gate'], 2))).kind === 'ok');
check('epoch 3 phone: epoch 1 QR → needs network', (await openTicket(e1, await bundleFor(festId, ['gate'], 3))).kind === 'needs_network');
check('server still verifies old-epoch QR', verifyTf2(e1).ok);

// Public page part
check('public P opens', openPublic(parts.p)?.ticketId === ticketId);
const badTag = P.slice(); badTag[23] ^= 1;
check('wrong pathTag / random → null', openPublic(b64u(badTag)) === null && openPublic('abc') === null && openPublic(b64u(new Uint8Array(24))) === null);

// Old TF1 tickets still verify on the scanner
const tf1 = signTicket(ticketId, festId);
check('TF1 verifies offline', (await openTicket(tf1, all)).kind === 'tf1');
check('TF1 tampered → tampered', (await openTicket(tf1.slice(0, -2) + (tf1.endsWith('AA') ? 'BA' : 'AA'), all)).kind !== 'tf1');

if (fails) { console.error(`✕ ${fails} Smart QR check(s) failed`); process.exit(1); }
console.log('✓ Smart QR checks passed');
