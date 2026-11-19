// The scheduled jobs depend on these tool names; a refresh must not drop or rename any (18 Nov 2026).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const src = readFileSync(new URL('../app/api/mcp/[key]/route.ts', import.meta.url), 'utf8');
const names = [...src.matchAll(/registerTool\('([a-z_]+)'/g)].map(m => m[1]);
test('MCP tools the jobs use are all still registered', () => {
  for (const t of ['todos_list', 'todo_add', 'todo_done', 'pursuits_list', 'pursuits_save', 'pursuit_propose', 'pursuit_park', 'people_met', 'person_set', 'people_propose', 'people_due', 'find_people', 'search_contacts', 'find_contact_by_email', 'captures_list', 'capture_done', 'signal_feed', 'list_events', 'add_researched_event', 'job_ran', 'log_interaction', 'people_set', 'give_get'])
    assert.ok(names.includes(t), 'missing tool ' + t);
});
