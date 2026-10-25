// Generates the ECDSA P-256 key pair used to sign ticket QR codes.
// Usage: npm run keys   → copy both lines into .env.local and Vercel.
import { generateKeyPairSync } from 'node:crypto';

const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const oneLine = (pem) => pem.trim().replace(/\n/g, '\\n');

console.log('TICKET_PRIVATE_KEY="' + oneLine(privateKey.export({ type: 'pkcs8', format: 'pem' })) + '"');
console.log('TICKET_PUBLIC_KEY="' + oneLine(publicKey.export({ type: 'spki', format: 'pem' })) + '"');
console.log('\n# Keep the PRIVATE key secret. If it leaks, generate new keys — old tickets stop validating.');
