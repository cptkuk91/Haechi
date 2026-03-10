export const MARITIME_SEAFOG_STATIONS = [
  { code: 'SF_0001', name: '부산항(북항)' },
  { code: 'SF_0002', name: '부산항(신항 동측)' },
  { code: 'SF_0003', name: '인천항' },
  { code: 'SF_0004', name: '평택·당진항' },
  { code: 'SF_0005', name: '군산항' },
  { code: 'SF_0006', name: '대산항' },
  { code: 'SF_0007', name: '목포항' },
  { code: 'SF_0008', name: '여수항' },
  { code: 'SF_0010', name: '울산항' },
  { code: 'SF_0011', name: '포항항' },
  { code: 'SF_0012', name: '부산항(신항 서측)' },
] as const;

export function formatMaritimeSeafogDistance(distanceMeters: number | null): string | null {
  if (distanceMeters === null || !Number.isFinite(distanceMeters)) return null;
  if (distanceMeters >= 20_000) return '20km+';
  if (distanceMeters >= 1_000) {
    const kilometers = distanceMeters / 1_000;
    return `${Number.isInteger(kilometers) ? kilometers.toFixed(0) : kilometers.toFixed(1)}km`;
  }
  return `${Math.round(distanceMeters)}m`;
}

export function getMaritimeSeafogRiskLabel(distanceMeters: number | null): string {
  if (distanceMeters === null) return '정보 없음';
  if (distanceMeters <= 200) return '심각';
  if (distanceMeters <= 1_000) return '높음';
  if (distanceMeters <= 4_000) return '주의';
  return '보통';
}
