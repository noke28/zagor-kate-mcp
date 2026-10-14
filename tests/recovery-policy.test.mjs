import test from 'node:test';
import assert from 'node:assert/strict';
import { policy, decideRecovery } from '../src/recovery-policy.mjs';
test('does not act before three consecutive failures', () => {
  assert.equal(decideRecovery({ failures: 2, status: 503 }), 'OBSERVE');
});
test('authentication errors only alert', () => {
  assert.equal(decideRecovery({ failures: 3, status: 401 }), 'ALERT');
  assert.equal(decideRecovery({ failures: 3, status: 403 }), 'ALERT');
});
test('upstream errors permit bounded retry only', () => {
  assert.equal(decideRecovery({ failures: 3, status: 503, component: 'root' }), 'RETRY_THEN_ALERT');
  assert.equal(policy.retryLimit, 3);
});
test('rollback stays disabled', () => assert.equal(policy.productionRollback, false));
