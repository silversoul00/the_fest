import type { Fest } from './types';

export type FestFormFields = Pick<Fest, 'id' | 'slug' | 'emoji' | 'accent' | 'name' | 'college' | 'city' | 'venue' | 'category' | 'starts_on' | 'ends_on' | 'description' | 'capacity'>;
export const festFormFields = (f: Fest): FestFormFields => ({
  id: f.id, slug: f.slug, emoji: f.emoji, accent: f.accent, name: f.name, college: f.college, city: f.city, venue: f.venue,
  category: f.category, starts_on: f.starts_on, ends_on: f.ends_on, description: f.description, capacity: f.capacity,
});
