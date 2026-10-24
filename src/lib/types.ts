export type Role = 'student' | 'organizer' | 'sponsor';

export interface User {
  id: string;
  email: string;
  name: string;
  phone: string | null;
  college: string | null;
  role: Role;
  created_at: Date;
  is_admin?: boolean;
  /** Has proved they own `email`. Email-based access (co-organizer, staff, sponsor) needs this. */
  verified: boolean;
}

export interface Fest {
  id: string;
  slug: string;
  organizer_id: string;
  name: string;
  college: string;
  city: string;
  venue: string | null;
  category: string;
  starts_on: string; // YYYY-MM-DD
  ends_on: string;
  description: string;
  emoji: string;
  accent: string;
  capacity: number | null;
  status: 'draft' | 'review' | 'live' | 'ended' | 'cancelled';
  created_at: Date;
  upi_enabled: boolean;
  allow_transfers: boolean;
  upi_vpa: string | null;
  upi_name: string | null;
  inbound_token: string | null;
  approved_at: Date | null;
  review_note: string | null;
  cancelled_reason: string | null;
}

export interface TicketType {
  id: string;
  fest_id: string;
  name: string;
  description: string;
  price_paise: number;
  quota: number;
  sold: number;
  sort: number;
  active: boolean;
  /** 'addon' = bought on top of an existing ticket (no new ticket, no seat). */
  kind: 'entry' | 'addon';
  /** IST dates ('YYYY-MM-DD') this type gives one lunch on. */
  lunch_days: string[];
  includes_stay: boolean;
}

export interface Ticket {
  id: string;
  code: string;
  order_id: string;
  user_id: string;
  fest_id: string;
  ticket_type_id: string;
  holder_name: string;
  status: 'valid' | 'used' | 'void';
  issued_at: Date;
  checked_in_at: Date | null;
  gate: string | null;
}

export interface ScheduleEvent {
  id: string;
  fest_id: string;
  title: string;
  venue: string;
  category: string;
  starts_at: Date;
  ends_at: Date;
}

export interface Announcement {
  id: string;
  fest_id: string;
  title: string;
  body: string;
  urgent: boolean;
  created_at: Date;
}

export interface Sponsor {
  id: string;
  fest_id: string;
  email: string;
  brand: string;
  tier: string;
  amount_paise: number;
  booth_code: string;
  created_at: Date;
}

export type ActionState = {
  ok?: boolean; error?: string; message?: string;
  /** The server wants the "I understand" tick (fest details changed after tickets were sold, or a rename needs review). */
  confirm?: { holders: number; review: 'now' | 'next' | null };
} | null;
