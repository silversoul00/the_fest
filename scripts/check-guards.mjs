// Static guard (Team & Roles, v2.7): fails if any organizer server action or fest page/route skips its permission check.
//  • every exported function in src/app/organizer/actions.ts must call requirePerm(fd, '<perm>') or requireOwnRole(fd)
//    (only createFest may use requireUser('organizer') instead — it makes a new fest);
//  • every page.tsx / layout.tsx / route.ts under src/app/organizer/[festId] must call pageAccess(…) or eventPageAccess(…)
//    (routes: festAccess + a perm, or festAccess + eventAllowed for one event);
//  • v2.8 events: every export of src/app/organizer/events-actions.ts calls requirePerm(fd, '<perm>') or
//    requireEventPerm(fd, 'manage'|'view'); every export of src/app/(student)/my-events/actions.ts calls requireUser().
// Usage: node scripts/check-guards.mjs   (exit 1 + a list of problems)
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

// GUARD_ROOT: check a copy of the tree instead (tests/team_roles.py proves the check catches a missing guard)
const root = (process.env.GUARD_ROOT ?? new URL('..', import.meta.url).pathname).replace(/\/?$/, '/');
const problems = [];

const actions = readFileSync(join(root, 'src/app/organizer/actions.ts'), 'utf8');
const chunks = actions.split(/^(?=export async function )/m).slice(1);
const names = [];
for (const c of chunks) {
  const name = c.match(/^export async function (\w+)/)[1];
  names.push(name);
  const body = c.split(/^\}/m)[0];
  const ok = /await requirePerm\(fd, '[a-z_]+'\)/.test(body) || /await requireOwnRole\(fd\)/.test(body)
    || (name === 'createFest' && /await requireUser\('organizer'\)/.test(body));
  if (!ok) problems.push(`actions.ts: ${name} has no requirePerm / requireOwnRole`);
}
// Other exports (const / function without async) would slip past the check above
for (const m of actions.matchAll(/^export (?!async function |type |interface )(\w+)/gm)) problems.push(`actions.ts: unexpected export "${m[0]}"`);
if (/ownFest\(|canManage\(/.test(actions)) problems.push('actions.ts: still uses ownFest / canManage');

// v2.8 fest events
const checkFile = (rel, ok, what) => {
  const src = readFileSync(join(root, rel), 'utf8');
  const parts = src.split(/^(?=export async function )/m).slice(1);
  for (const c of parts) {
    const name = c.match(/^export async function (\w+)/)[1];
    names.push(name);
    if (!ok(c.split(/^\}/m)[0])) problems.push(`${rel}: ${name} has no ${what}`);
  }
  for (const m of src.matchAll(/^export (?!async function |type |interface )(\w+)/gm)) problems.push(`${rel}: unexpected export "${m[0]}"`);
};
checkFile('src/app/organizer/events-actions.ts',
  (b) => /await requirePerm\(fd, '[a-z_]+'\)/.test(b) || /await requireEventPerm\(fd, '(manage|view)'\)/.test(b), 'requirePerm / requireEventPerm');
checkFile('src/app/(student)/my-events/actions.ts', (b) => /await requireUser\(\)/.test(b), 'requireUser');

const walk = (d) => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]));
const pages = walk(join(root, 'src/app/organizer/[festId]')).filter((f) => /\/(page|layout)\.tsx$|\/route\.ts$/.test(f));
for (const f of pages) {
  const src = readFileSync(f, 'utf8');
  const rel = f.slice(root.length);
  const ok = f.endsWith('route.ts') ? /festAccess\(/.test(src) && (/perms\.has\('[a-z_]+'\)/.test(src) || /eventAllowed\(access, [\w.]+, 'manage'\)/.test(src))
    : /await (pageAccess|eventPageAccess)\(/.test(src);
  if (!ok) problems.push(`${rel}: no pageAccess / festAccess check`);
  if (/getOwnFest|canManage/.test(src)) problems.push(`${rel}: still uses getOwnFest / canManage`);
}

if (problems.length) {
  console.error('✗ Permission guard check failed:\n  ' + problems.join('\n  '));
  process.exit(1);
}
console.log(`✓ Permission guards: ${names.length} organizer actions, ${pages.length} fest pages/routes checked`);
