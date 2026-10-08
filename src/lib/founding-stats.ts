export const REGIONS = ['서울', '부산', '대구', '인천', '광주', '대전', '울산', '세종', '경기', '강원', '충북', '충남', '전북', '전남', '경북', '경남', '제주'] as const;

export interface RegionStat { region: string; count: number }
export interface FoundingStats { total: number; regions: RegionStat[]; updated_at: string }

// Reject incomplete or inconsistent aggregates instead of displaying a misleading total.
export function parseFoundingStats(value: unknown): FoundingStats {
  if (!value || typeof value !== 'object') throw new Error('Invalid statistics');
  const data = value as FoundingStats;
  if (!Number.isSafeInteger(data.total) || data.total < 0 || !Array.isArray(data.regions)
    || typeof data.updated_at !== 'string' || !Number.isFinite(Date.parse(data.updated_at))) {
    throw new Error('Invalid statistics');
  }
  const seen = new Set<string>();
  const regions = data.regions.map((row) => {
    if (!row || ![...REGIONS, '기타'].includes(row.region) || seen.has(row.region)
      || !Number.isSafeInteger(row.count) || row.count < 0) throw new Error('Invalid region');
    seen.add(row.region);
    return { region: row.region, count: row.count };
  });
  if (!REGIONS.every((region) => seen.has(region))
    || regions.reduce((sum, row) => sum + row.count, 0) !== data.total) throw new Error('Incomplete statistics');
  return { total: data.total, regions, updated_at: data.updated_at };
}

export function regionPercentage(count: number, total: number): number {
  return total === 0 ? 0 : count / total * 100;
}

export function sortRegions(regions: RegionStat[], order: string): RegionStat[] {
  return [...regions].sort((a, b) => order === 'count'
    ? b.count - a.count || a.region.localeCompare(b.region, 'ko')
    : a.region.localeCompare(b.region, 'ko'));
}
