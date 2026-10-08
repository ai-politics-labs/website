import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFoundingStats, REGIONS, regionPercentage, sortRegions } from '../src/lib/founding-stats.ts';

const fixture = (counts = {}) => ({
  total: Object.values(counts).reduce((a, b) => a + b, 0),
  regions: [...REGIONS, ...(counts['기타'] ? ['기타'] : [])].map((region) => ({ region, count: counts[region] ?? 0 })),
  updated_at: '2026-10-09T00:00:00Z',
});

test('empty and large totals remain valid; unknown region is in the denominator', () => {
  assert.equal(parseFoundingStats(fixture()).total, 0);
  const stats = parseFoundingStats(fixture({ 서울: 1200, 경기: 600, 기타: 200 }));
  assert.equal(stats.total, 2000);
  assert.equal(regionPercentage(1200, stats.total), 60);
  assert.equal(regionPercentage(0, 0), 0);
});

test('rejects truncated, duplicate, negative and malformed response data', () => {
  const good = fixture({ 서울: 3 });
  for (const bad of [null, {}, { ...good, total: 4 }, { ...good, total: -1 },
    { ...good, regions: good.regions.slice(1) }, { ...good, regions: [...good.regions, good.regions[0]] },
    { ...good, updated_at: 'bad' }, { ...good, regions: [{ region: '<script>', count: 3 }] },
    { ...good, regions: good.regions.map((row) => ({ ...row, count: -.5 })) }]) {
    assert.throws(() => parseFoundingStats(bad));
  }
});

test('ranking, alphabetical sort and ties are deterministic without mutating input', () => {
  const rows = [{ region: '서울', count: 2 }, { region: '경기', count: 3 }, { region: '부산', count: 2 }];
  assert.deepEqual(sortRegions(rows, 'count').map((row) => row.region), ['경기', '부산', '서울']);
  assert.deepEqual(sortRegions(rows, 'name').map((row) => row.region), ['경기', '부산', '서울']);
  assert.equal(rows[0].region, '서울');
});
