'use client';
import { useState } from 'react';

// Same format as scripts/gen-keys.mjs: PEM on one line with \n between lines.
function pem(label: string, der: ArrayBuffer) {
  const b64 = btoa(String.fromCharCode(...new Uint8Array(der)));
  const lines = b64.match(/.{1,64}/g) ?? [];
  return [`-----BEGIN ${label}-----`, ...lines, `-----END ${label}-----`].join('\\n');
}

function CopyBox({ name, value }: { name: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="stack g8">
      <div className="row between g8"><span className="label">{name}</span>
        <button type="button" className="btn sm outline" onClick={async () => { await navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 2000); }}>
          {copied ? 'Copied ✓' : 'Copy'}
        </button>
      </div>
      <textarea className="input mono xs" readOnly value={value} rows={4} aria-label={name} style={{ width: '100%', wordBreak: 'break-all', resize: 'vertical', fontSize: 11, lineHeight: 1.4 }} onFocus={(e) => e.currentTarget.select()} />
    </div>
  );
}

/**
 * `other`: keys are already set on this site. Offer a fresh pair for ANOTHER environment (e.g. Production)
 * without showing or touching the current keys — the server never sends them here, and nothing is sent back.
 */
export function KeyGen({ other = false }: { other?: boolean }) {
  const [keys, setKeys] = useState<{ priv: string; pub: string } | null>(null);
  const [err, setErr] = useState('');

  async function make() {
    setErr('');
    try {
      const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
      const [p8, spki] = await Promise.all([crypto.subtle.exportKey('pkcs8', pair.privateKey), crypto.subtle.exportKey('spki', pair.publicKey)]);
      setKeys({ priv: pem('PRIVATE KEY', p8), pub: pem('PUBLIC KEY', spki) });
    } catch {
      setErr('This browser can’t make keys. Open this page over https (or on your computer run “npm run keys”).');
    }
  }

  return (
    <div className="stack g16">
      {other ? (
        <p className="small soft">This makes a brand-new pair for a <strong>different</strong> environment — for example Production, while this site is a Preview. It doesn’t show or change the keys this site uses. Made right here in your browser; nothing is sent to the server.</p>
      ) : (
        <p className="small soft">Every ticket QR is signed with these keys, so nobody can fake a ticket. They are made right here in your browser — nothing is sent to the server.</p>
      )}
      <ol className="small soft stack g8" style={{ paddingLeft: 18 }}>
        <li>Tap <strong>{other ? 'Make a pair for another environment' : 'Make keys'}</strong>.</li>
        <li>In Vercel → your project → Settings → Environment Variables, add <span className="mono">TICKET_PRIVATE_KEY</span> and <span className="mono">TICKET_PUBLIC_KEY</span> with these values{other ? ', ticking only the environment this pair is for (e.g. Production)' : ''}.</li>
        <li>Preview and Production each need their own pair. Make both now, one after the other: copy this pair into one environment, then tap <strong>Make a different pair</strong> for the other.</li>
        <li>{other ? 'Redeploy that environment.' : 'Redeploy. This page will then say “Keys are already set”.'}</li>
      </ol>
      <div className="alert error">Never change a site’s keys after tickets are sold — every ticket already issued would stop scanning. Keep the private key secret.</div>
      {err && <div className="alert error" role="alert">{err}</div>}
      {!keys ? (
        <button type="button" className="btn block" onClick={make}>{other ? 'Make a pair for another environment' : 'Make keys'}</button>
      ) : (
        <>
          <CopyBox name="TICKET_PRIVATE_KEY" value={keys.priv} />
          <CopyBox name="TICKET_PUBLIC_KEY" value={keys.pub} />
          <button type="button" className="btn block outline" onClick={make}>Make a different pair</button>
        </>
      )}
    </div>
  );
}
