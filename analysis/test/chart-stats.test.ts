import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { meanDifferenceInterval, meanInterval, wilsonInterval } from '../site/chart-stats.ts';

describe('chart statistics helpers', () => {
  it('computes bounded t confidence intervals for satisfaction means', () => {
    const estimate = meanInterval([3, 4, 5, 5], { min: 1, max: 5 });

    assert.equal(estimate?.n, 4);
    assert.equal(estimate?.mean, 4.25);
    assert.equal(estimate?.ciEstimated, true);
    assert.ok((estimate?.lower ?? 0) >= 1);
    assert.ok((estimate?.upper ?? 0) <= 5);
    assert.ok((estimate?.lower ?? 0) < (estimate?.mean ?? 0));
    assert.ok((estimate?.upper ?? 0) > (estimate?.mean ?? 0));
  });

  it('marks single-observation means as not estimated', () => {
    const estimate = meanInterval([5], { min: 1, max: 5 });

    assert.equal(estimate?.mean, 5);
    assert.equal(estimate?.lower, 5);
    assert.equal(estimate?.upper, 5);
    assert.equal(estimate?.ciEstimated, false);
  });

  it('uses Wilson intervals for proportions without returning impossible bounds', () => {
    const estimate = wilsonInterval(0, 3);

    assert.equal(estimate?.rate, 0);
    assert.equal(estimate?.lower, 0);
    assert.ok((estimate?.upper ?? 0) > 0);
    assert.ok((estimate?.upper ?? 0) < 1);
  });

  it('computes bounded Welch intervals for mean differences', () => {
    const estimate = meanDifferenceInterval([4, 5, 5], [2, 3, 3], { min: -4, max: 4 });

    assert.equal(estimate?.nA, 3);
    assert.equal(estimate?.nB, 3);
    assert.ok((estimate?.difference ?? 0) > 0);
    assert.equal(estimate?.ciEstimated, true);
    assert.ok((estimate?.lower ?? -5) >= -4);
    assert.ok((estimate?.upper ?? 5) <= 4);
  });
});
