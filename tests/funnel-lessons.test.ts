import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lessons } from '../lib/funnel-logic.ts';

test('lessons stay quiet until there is data, then name the winner and the dud', () => {
  const thin = lessons([{ template: 'first_approach', sent: 2, replies: 0, replyRate: 0 }], []);
  assert.match(thin[0], /too few sends/);
  const rich = lessons([
    { template: 'signal_warm', sent: 9, replies: 4, replyRate: 44 },
    { template: 'first_approach', sent: 12, replies: 0, replyRate: 0 },
  ], [{ trigger: 'planning', sent: 6, replies: 2, replyRate: 33 }, { trigger: 'none', sent: 7, replies: 0, replyRate: 0 }]);
  assert.match(rich[0], /"signal_warm" is replying at 44%/);
  assert.match(rich[1], /Triggers: "planning"/);
  assert.match(rich[2], /"first_approach" has 12 sends and no reply/);
});
