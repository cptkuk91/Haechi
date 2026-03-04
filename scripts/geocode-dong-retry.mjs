/**
 * dong_coordinates 지오코딩 실패 건 재시도 스크립트
 *
 * 전략:
 * 1차) dongName에서 숫자 접미사 제거 후 재검색 (창신1동 → 창신동)
 * 2차) "시군구 + 동" 만으로 검색
 * 3차) ROAD 타입으로 검색
 *
 * Usage: node scripts/geocode-dong-retry.mjs
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
      if (!process.env[key]) process.env[key] = val;
    }
  } catch {
    // ignore
  }
}

const CWD = process.cwd();
loadEnv(path.join(CWD, '.env.local'));

const MONGODB_URL = process.env.MONGODB_URL;
const VWORLD_KEY = process.env.TEAM2_DIGITAL_TWIN_API_KEY;

if (!MONGODB_URL || !VWORLD_KEY) {
  console.error('MONGODB_URL 또는 TEAM2_DIGITAL_TWIN_API_KEY가 없습니다.');
  process.exit(1);
}

const GEOCODE_URL = 'https://api.vworld.kr/req/address';
const DELAY_MS = 200;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function geocodeOnce(address, type = 'PARCEL') {
  const url = new URL(GEOCODE_URL);
  url.searchParams.set('service', 'address');
  url.searchParams.set('request', 'getcoord');
  url.searchParams.set('version', '2.0');
  url.searchParams.set('crs', 'epsg:4326');
  url.searchParams.set('type', type);
  url.searchParams.set('address', address);
  url.searchParams.set('key', VWORLD_KEY);
  url.searchParams.set('format', 'json');

  const res = await fetch(url.toString());
  if (!res.ok) return null;

  const json = await res.json();
  if (json.response?.status === 'OK') {
    const point = json.response.result.point;
    return { lng: parseFloat(point.x), lat: parseFloat(point.y) };
  }
  return null;
}

/** 동 이름에서 숫자 접미사 제거: 창신1동 → 창신동 */
function stripDongNumber(dongName) {
  return dongName.replace(/[0-9·]+동$/, '동');
}

async function tryGeocode(doc) {
  const { sidoName, sigunguName, dongName } = doc;

  // 1차: 숫자 제거 후 PARCEL
  const stripped = stripDongNumber(dongName);
  if (stripped !== dongName) {
    const addr1 = `${sidoName} ${sigunguName} ${stripped}`;
    const r1 = await geocodeOnce(addr1, 'PARCEL');
    if (r1) return r1;
    await sleep(DELAY_MS);
  }

  // 2차: 시도 + 시군구만으로 PARCEL (동 단위 근사 좌표)
  const addr2 = `${sidoName} ${sigunguName}`;
  const r2 = await geocodeOnce(addr2, 'PARCEL');
  if (r2) return r2;
  await sleep(DELAY_MS);

  // 3차: 원래 주소로 ROAD 타입
  const r3 = await geocodeOnce(doc.fullAddress, 'ROAD');
  if (r3) return r3;
  await sleep(DELAY_MS);

  // 4차: 숫자 제거 주소로 ROAD
  if (stripped !== dongName) {
    const addr4 = `${sidoName} ${sigunguName} ${stripped}`;
    const r4 = await geocodeOnce(addr4, 'ROAD');
    if (r4) return r4;
  }

  return null;
}

// ── 메인 ────────────────────────────────────────────────────────────
const client = new MongoClient(MONGODB_URL);

try {
  await client.connect();
  console.log('MongoDB 연결 성공');

  const collection = client.db('haechi').collection('dong_coordinates');
  const pending = await collection.find({ lat: null }).toArray();
  const total = pending.length;

  if (total === 0) {
    console.log('미처리 건 없음.');
    process.exit(0);
  }

  console.log(`재시도 대상: ${total}건\n`);

  let success = 0;
  let failed = 0;

  for (let i = 0; i < pending.length; i++) {
    const doc = pending[i];
    const result = await tryGeocode(doc);

    if (result) {
      await collection.updateOne(
        { _id: doc._id },
        { $set: { lat: result.lat, lng: result.lng } },
      );
      success++;
    } else {
      failed++;
    }

    const current = i + 1;
    if (current % 50 === 0 || current === total) {
      process.stdout.write(
        `\r[${current}/${total}] | 성공: ${success} | 실패: ${failed}`,
      );
    }

    await sleep(DELAY_MS);
  }

  console.log('\n\n── 재시도 완료 ──');
  console.log(`성공: ${success}건`);
  console.log(`실패: ${failed}건`);

  const remaining = await collection.countDocuments({ lat: null });
  console.log(`최종 미처리 건수: ${remaining}건`);

  const totalDocs = await collection.countDocuments();
  const geocoded = await collection.countDocuments({ lat: { $ne: null } });
  console.log(`전체: ${totalDocs}건 | 지오코딩 완료: ${geocoded}건 (${((geocoded / totalDocs) * 100).toFixed(1)}%)`);
} finally {
  await client.close();
  console.log('MongoDB 연결 종료');
}
