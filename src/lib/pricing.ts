// Pure pricing maths — shared by the checkout screen (client) and the server,
// so the total a student sees is exactly the total they are charged.

export type FeeConfig = {
  mode: 'flat' | 'percent';
  flatPaise: number;     // flat commission per paid ticket
  percent: number;       // % of ticket price (percent mode)
  minPaise: number;      // floor per ticket (percent mode)
  maxPaise: number;      // cap per ticket (percent mode); 0 = no cap
  payer: 'student' | 'organizer';
  gatewayRate: number;   // e.g. 0.0236 = 2% + 18% GST
  passGateway: boolean;  // add gateway charges to the student's total
};

export type Method = 'gateway' | 'upi_direct';

export type Quote = {
  subtotal: number;     // ticket price × qty
  fee: number;          // THE FEST commission (total for all tickets)
  gatewayFee: number;   // charged to student when passGateway and paying by gateway
  total: number;        // what the student pays (before any UPI paise tag)
  perTicketFee: number;
};

export function perTicketFee(pricePaise: number, cfg: FeeConfig): number {
  if (pricePaise <= 0) return 0; // free tickets are always free
  if (cfg.mode === 'flat') return Math.max(0, Math.round(cfg.flatPaise));
  let f = Math.round((pricePaise * cfg.percent) / 100);
  if (cfg.minPaise > 0) f = Math.max(f, cfg.minPaise);
  if (cfg.maxPaise > 0) f = Math.min(f, cfg.maxPaise);
  return f;
}

/**
 * Gateways take their % of the whole amount they collect. To leave the
 * merchant with exactly `base`, the charge is grossed up: g = base·r / (1 − r).
 */
export function quote(pricePaise: number, qty: number, cfg: FeeConfig, method: Method): Quote {
  const unitFee = perTicketFee(pricePaise, cfg);
  const subtotal = pricePaise * qty;
  const fee = unitFee * qty;
  const base = subtotal + (cfg.payer === 'student' ? fee : 0);
  const r = cfg.gatewayRate;
  const gatewayFee = method === 'gateway' && cfg.passGateway && base > 0 && r > 0 && r < 0.5
    ? Math.ceil((base * r) / (1 - r))
    : 0;
  return { subtotal, fee, gatewayFee, total: base + gatewayFee, perTicketFee: unitFee };
}

/** Short description of the commission, for organizer screens. */
export function describeFee(cfg: FeeConfig): string {
  const r = (p: number) => '₹' + (p / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 });
  if (cfg.mode === 'flat') return `${r(cfg.flatPaise)} per paid ticket`;
  const parts = [`${cfg.percent}% of the ticket price`];
  if (cfg.minPaise) parts.push(`min ${r(cfg.minPaise)}`);
  if (cfg.maxPaise) parts.push(`max ${r(cfg.maxPaise)}`);
  return parts.join(', ') + ' per paid ticket';
}
