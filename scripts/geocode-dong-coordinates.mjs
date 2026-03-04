/**
 * dong_coordinates 컬렉션의 lat/lng를 VWorld Geocoding API로 채우는 스크립트
 *
 * - lat === null 인 문서만 대상
 * - 요청 간 200ms 딜레이 (rate limit 방지)
 * - 실패 시 3회 재시도 후 스킵
 * - 진행 상황 실시간 출력, 중간에 Ctrl+C 해도 이미 저장된 건은 유지
 *
 * Usage: node scripts/geocode-dong-coordinates.mjs
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { MongoClient } from 'mongodb';

// ── .env.local 로드 ─────────────────────────────────────────────────
function loadEnv(filePath) {
  try {
    const content = readFileSync(filePath, 'utf8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim();
      if (!process.env[key]) {
        process.env[key] = val;
      }
    }
  } catch {
    // ignore
  }
}

const CWD = process.cwd();
loadEnv(path.join(CWD, '.env.local'));

const MONGODB_URL = process.env.MONGODB_URL;
const VWORLD_KEY = process.env.TEAM2_DIGITAL_TWIN_API_KEY;

if (!MONGODB_URL) {
  console.error('MONGODB_URL이 설정되지 않았습니다.');
  process.exit(1);
}
if (!VWORLD_KEY) {
  console.error('TEAM2_DIGITAL_TWIN_API_KEY가 설정되지 않았습니다.');
  process.exit(1);
}

// ── VWorld Geocoding ────────────────────────────────────────────────
const GEOCODE_URL = 'https://api.vworld.kr/req/address';
const DELAY_MS = 200;
const MAX_RETRIES = 3;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function geocode(address) {
  const url = new URL(GEOCODE_URL);
  url.searchParams.set('service', 'address');
  url.searchParams.set('request', 'getcoord');
  url.searchParams.set('version', '2.0');
  url.searchParams.set('crs', 'epsg:4326');
  url.searchParams.set('type', 'PARCEL');
  url.searchParams.set('address', address);
  url.searchParams.set('key', VWORLD_KEY);
  url.searchParams.set('format', 'json');

  const res = await fetch(url.toString());
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }

  const json = await res.json();
  const status = json.response?.status;

  if (status === 'OK') {
    const point = json.response.result.point;
    return { lng: parseFloat(point.x), lat: parseFloat(point.y) };
  }

  if (status === 'NOT_FOUND') {
    return null;
  }

  throw new Error(`VWorld status: ${status} - ${JSON.stringify(json.response?.error || '')}`);
}

async function geocodeWithRetry(address) {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await geocode(address);
    } catch (err) {
      if (attempt === MAX_RETRIES) {
        return null;
      }
      // 재시도 전 대기 시간 증가
      await sleep(1000 * attempt);
    }
  }
  return null;
}

// ── 메인 ────────────────────────────────────────────────────────────
const client = new MongoClient(MONGODB_URL);

try {
  await client.connect();
  console.log('MongoDB 연결 성공');

  const collection = client.db('haechi').collection('dong_coordinates');

  // lat이 null인 문서만 조회
  const pending = await collection.find({ lat: null }).toArray();
  const total = pending.length;

  if (total === 0) {
    console.log('처리할 문서가 없습니다. 모두 지오코딩 완료 상태입니다.');
    process.exit(0);
  }

  console.log(`지오코딩 대상: ${total}건`);

  let success = 0;
  let failed = 0;

  for (let i = 0; i < pending.length; i++) {
    const doc = pending[i];
    const result = await geocodeWithRetry(doc.fullAddress);

    if (result) {
      await collection.updateOne(
        { _id: doc._id },
        { $set: { lat: result.lat, lng: result.lng } },
      );
      success++;
    } else {
      failed++;
    }

    // 진행률 (100건 단위 또는 마지막)
    const current = i + 1;
    if (current % 100 === 0 || current === total) {
      const pct = ((current / total) * 100).toFixed(1);
      process.stdout.write(
        `\r[${current}/${total}] ${pct}% | 성공: ${success} | 실패: ${failed}`,
      );
    }

    await sleep(DELAY_MS);
  }

  console.log('\n\n── 완료 ──');
  console.log(`성공: ${success}건`);
  console.log(`실패: ${failed}건`);

  // 최종 확인
  const remaining = await collection.countDocuments({ lat: null });
  console.log(`미처리(lat=null) 남은 건수: ${remaining}건`);
} finally {
  await client.close();
  console.log('MongoDB 연결 종료');
}
