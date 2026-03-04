/**
 * 센서스 읍면동 코드 → MongoDB import 스크립트
 *
 * 엑셀 파일(센서스 공간정보 지역 코드.xlsx)을 파싱하여
 * haechi.dong_coordinates 컬렉션에 삽입한다.
 *
 * Usage: node scripts/import-dong-coordinates.mjs
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import XLSX from 'xlsx';
import { MongoClient } from 'mongodb';

// ── .env.local 로드 (dotenv 없이 직접 파싱) ────────────────────────
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
    // .env.local가 없으면 무시
  }
}

const CWD = process.cwd();
loadEnv(path.join(CWD, '.env.local'));

const MONGODB_URL = process.env.MONGODB_URL;
if (!MONGODB_URL) {
  console.error('MONGODB_URL이 설정되지 않았습니다. .env.local을 확인하세요.');
  process.exit(1);
}

// ── 엑셀 파싱 ──────────────────────────────────────────────────────
const EXCEL_PATH = path.join(CWD, '센서스 공간정보 지역 코드.xlsx');
const wb = XLSX.readFile(EXCEL_PATH);
const ws = wb.Sheets[wb.SheetNames[0]];
const rows = XLSX.utils.sheet_to_json(ws, { header: 1 });

// 행 0: 제목, 행 1: 헤더 → 2행부터 데이터
const dataRows = rows.slice(2).filter((r) => r.length >= 6 && r[0] != null);

const documents = dataRows.map((r) => {
  const sidoCode = String(r[0]).padStart(2, '0');
  const sidoName = String(r[1]);
  const sigunguCode = String(r[2]);
  const sigunguName = String(r[3]);
  const dongCode = String(r[4]);
  const dongName = String(r[5]);

  return {
    sidoCode,
    sidoName,
    sigunguCode,
    sigunguName,
    dongCode,
    dongName,
    fullAddress: `${sidoName} ${sigunguName} ${dongName}`,
    lat: null,
    lng: null,
  };
});

console.log(`파싱 완료: ${documents.length}건`);

// ── MongoDB 삽입 ────────────────────────────────────────────────────
const client = new MongoClient(MONGODB_URL);

try {
  await client.connect();
  console.log('MongoDB 연결 성공');

  const db = client.db('haechi');
  const collection = db.collection('dong_coordinates');

  // 기존 데이터 삭제 (재실행 안전)
  const { deletedCount } = await collection.deleteMany({});
  if (deletedCount > 0) {
    console.log(`기존 데이터 ${deletedCount}건 삭제`);
  }

  // insertMany
  const result = await collection.insertMany(documents);
  console.log(`삽입 완료: ${result.insertedCount}건`);

  // fullAddress unique index
  await collection.createIndex({ fullAddress: 1 }, { unique: true });
  console.log('fullAddress unique 인덱스 생성 완료');

  // 검증
  const count = await collection.countDocuments();
  console.log(`최종 컬렉션 문서 수: ${count}건`);
} finally {
  await client.close();
  console.log('MongoDB 연결 종료');
}
