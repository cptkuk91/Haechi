'use client';

import { useMemo } from 'react';
import { ChevronRight, PanelRightClose, Radar, Siren, Target } from 'lucide-react';
import GlassCard from '@/components/ui/GlassCard';
import DataFeed from '@/components/ui/DataFeed';
import { HealthAedLoadingToast } from '@/components/panels/HealthAedLoadingToast';
import { DisasterCivilDefenseShelterLoadingToast } from '@/components/panels/DisasterCivilDefenseShelterLoadingToast';
import { HealthFacilityDetailPanel } from '@/components/panels/HealthFacilityDetailPanel';
import { HealthInfectiousDistributionPanel } from '@/components/panels/HealthInfectiousDistributionPanel';
import { HealthInfectiousTrendsPanel } from '@/components/panels/HealthInfectiousTrendsPanel';
import { HealthInfectiousRiskLoadingToast } from '@/components/panels/HealthInfectiousRiskLoadingToast';
import { HealthPharmacyLoadingToast } from '@/components/panels/HealthPharmacyLoadingToast';
import { MaritimeBuoyLoadingToast } from '@/components/panels/MaritimeBuoyLoadingToast';
import { MaritimeSeatnLoadingToast } from '@/components/panels/MaritimeSeatnLoadingToast';
import { MaritimeSeafogLoadingToast } from '@/components/panels/MaritimeSeafogLoadingToast';
import { MaritimeUlsanAnchoragesLoadingToast } from '@/components/panels/MaritimeUlsanAnchoragesLoadingToast';
import { MaritimeUlsanPortFacilitiesLoadingToast } from '@/components/panels/MaritimeUlsanPortFacilitiesLoadingToast';
import { WeatherAirQualityHeatmapLoadingToast } from '@/components/panels/WeatherAirQualityHeatmapLoadingToast';
import { WeatherAirQualityStationsLoadingToast } from '@/components/panels/WeatherAirQualityStationsLoadingToast';
import { useAppStore } from '@/stores/app-store';

function formatValue(value: unknown): string {
  if (typeof value === 'number') return Number.isInteger(value) ? String(value) : value.toFixed(2);
  if (typeof value === 'string') return value;
  if (typeof value === 'boolean') return value ? '가능' : '불가';
  if (value === null || value === undefined) return '-';
  return JSON.stringify(value);
}

function pickFirstString(properties: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = properties[key];
    if (typeof value !== 'string') continue;
    const normalized = value.trim();
    if (normalized) return normalized;
  }
  return null;
}

function pickFirstNumber(properties: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = properties[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return null;
}

function isSocialWelfareFacilitySelection(selectedObject: { domain: string; properties: Record<string, unknown> }): boolean {
  if (selectedObject.domain !== 'vulnerable') return false;
  const properties = selectedObject.properties;
  return (
    typeof properties.facilityType === 'string'
    || typeof properties.cat_nam === 'string'
    || typeof properties.fac_nam === 'string'
  );
}

function isPublicFacilitySafetySelection(selectedObject: { domain: string; properties: Record<string, unknown> }): boolean {
  if (selectedObject.domain !== 'infra') return false;
  const properties = selectedObject.properties;
  return (
    typeof properties.facilityNo === 'string'
    || typeof properties.safetyGrade === 'string'
    || typeof properties.facilityKind === 'string'
  );
}

function isHighwayTollgateSelection(selectedObject: { domain: string; properties: Record<string, unknown> }): boolean {
  if (selectedObject.domain !== 'infra') return false;
  const properties = selectedObject.properties;
  return (
    typeof properties.unitCode === 'string'
    || typeof properties.routeNo === 'string'
    || typeof properties.routeName === 'string'
  );
}

function isHealthFacilitySelection(selectedObject: { domain: string; properties: Record<string, unknown> }): boolean {
  if (selectedObject.domain !== 'health') return false;
  const properties = selectedObject.properties;
  if (properties.layerKind === 'pharmacy') return false;
  return (
    typeof properties.hpid === 'string'
    || typeof properties.facilityCategory === 'string'
    || typeof properties.institutionType === 'string'
  );
}

function isHealthAedSelection(selectedObject: { domain: string; properties: Record<string, unknown> }): boolean {
  if (selectedObject.domain !== 'health') return false;
  const properties = selectedObject.properties;
  return (
    properties.layerKind === 'aed'
    || typeof properties.installationPlace === 'string'
    || typeof properties.organization === 'string'
    || typeof properties.serialNumber === 'string'
  );
}

function isHealthPharmacySelection(selectedObject: { domain: string; properties: Record<string, unknown> }): boolean {
  if (selectedObject.domain !== 'health') return false;
  const properties = selectedObject.properties;
  return (
    properties.layerKind === 'pharmacy'
    || typeof properties.todayHours === 'string'
    || typeof properties.operatingStatusLabel === 'string'
  );
}

function isHealthInfectiousRiskSelection(selectedObject: { domain: string; properties: Record<string, unknown> }): boolean {
  if (selectedObject.domain !== 'health') return false;
  const properties = selectedObject.properties;
  return (
    properties.layerKind === 'infectious-risk-sido'
    || typeof properties.riskMetric === 'string'
    || typeof properties.provinceRank === 'number'
  );
}

function isWeatherAirQualityStationSelection(selectedObject: { domain: string; properties: Record<string, unknown> }): boolean {
  if (selectedObject.domain !== 'weather') return false;
  const properties = selectedObject.properties;
  return (
    properties.layerKind === 'air-quality-station'
    || typeof properties.stationName === 'string'
    || typeof properties.monitoringNetwork === 'string'
    || typeof properties.observationItems === 'string'
  );
}

function isMaritimeBuoySelection(selectedObject: { domain: string; properties: Record<string, unknown> }): boolean {
  if (selectedObject.domain !== 'maritime') return false;
  const properties = selectedObject.properties;
  return (
    properties.layerKind === 'maritime-buoy'
    || typeof properties.blfrNo === 'string'
    || typeof properties.lightProperty === 'string'
  );
}

function isDisasterEarthquakeSelection(selectedObject: { domain: string; properties: Record<string, unknown> }): boolean {
  if (selectedObject.domain !== 'disaster') return false;
  const properties = selectedObject.properties;
  return (
    properties.layerKind === 'earthquake-ripple'
    || typeof properties.occurredAt === 'string'
    || typeof properties.magnitude === 'number'
    || typeof properties.imageUrl === 'string'
  );
}

function isDisasterCivilDefenseShelterSelection(selectedObject: { domain: string; properties: Record<string, unknown> }): boolean {
  if (selectedObject.domain !== 'disaster') return false;
  const properties = selectedObject.properties;
  return (
    properties.layerKind === 'civil-defense-shelter'
    || typeof properties.managementNo === 'string'
    || typeof properties.facilityType === 'string'
    || typeof properties.operationStatus === 'string'
  );
}

function isMaritimeUlsanPortFacilitySelection(selectedObject: { domain: string; properties: Record<string, unknown> }): boolean {
  if (selectedObject.domain !== 'maritime') return false;
  const properties = selectedObject.properties;
  return (
    properties.layerKind === 'maritime-ulsan-port-facility'
    || typeof properties.wharfName === 'string'
    || typeof properties.operatorName === 'string'
  );
}

function isMaritimeUlsanAnchorageSelection(selectedObject: { domain: string; properties: Record<string, unknown> }): boolean {
  if (selectedObject.domain !== 'maritime') return false;
  const properties = selectedObject.properties;
  return (
    properties.layerKind === 'maritime-ulsan-anchorage'
    || typeof properties.anchorageName === 'string'
    || typeof properties.geometryKind === 'string'
  );
}

function isMaritimeSeatnSelection(selectedObject: { domain: string; properties: Record<string, unknown> }): boolean {
  if (selectedObject.domain !== 'maritime') return false;
  const properties = selectedObject.properties;
  return (
    properties.layerKind === 'maritime-seatn'
    || typeof properties.posCd === 'string'
    || typeof properties.zoneDesc === 'string'
  );
}

function isMaritimeSeafogSelection(selectedObject: { domain: string; properties: Record<string, unknown> }): boolean {
  if (selectedObject.domain !== 'maritime') return false;
  const properties = selectedObject.properties;
  return (
    properties.layerKind === 'maritime-seafog'
    || typeof properties.obsCode === 'string'
    || typeof properties.visibilityMeters === 'number'
  );
}

function buildHealthFacilityEntries(properties: Record<string, unknown>): Array<[string, unknown]> {
  const name = pickFirstString(properties, ['name', 'dutyName']);
  const facilityType = pickFirstString(properties, ['facilityCategoryLabel']);
  const institutionType = pickFirstString(properties, ['institutionType', 'dutyEmclsName']);
  const hpid = pickFirstString(properties, ['hpid']);
  const source = pickFirstString(properties, ['source']);
  const occupancyPct = properties.occupancyPct;
  const availableBeds = properties.availableBeds;
  const severity = pickFirstString(properties, ['severity']);
  const updatedAt = pickFirstString(properties, ['updatedAt', 'syncedAt', 'lastUpdated']);

  const entries: Array<[string, unknown]> = [
    ['기관명', name ?? '-'],
    ['구분', facilityType ?? institutionType ?? '-'],
  ];

  if (institutionType && institutionType !== facilityType) {
    entries.push(['기관유형', institutionType]);
  }
  if (hpid) {
    entries.push(['HPID', hpid]);
  }
  if (occupancyPct !== undefined && occupancyPct !== null) {
    entries.push(['수용률', `${formatValue(occupancyPct)}%`]);
  }
  if (availableBeds !== undefined && availableBeds !== null) {
    entries.push(['가용병상', availableBeds]);
  }
  if (severity) {
    entries.push(['상태', severity]);
  }
  if (updatedAt) {
    entries.push(['갱신시각', updatedAt]);
  }
  if (source) {
    entries.push(['소스', source]);
  }

  return entries;
}

function buildHealthAedEntries(properties: Record<string, unknown>): Array<[string, unknown]> {
  const name = pickFirstString(properties, ['name', 'organization']);
  const installationPlace = pickFirstString(properties, ['installationPlace']);
  const address = pickFirstString(properties, ['address']);
  const phone = pickFirstString(properties, ['phone']);
  const manager = pickFirstString(properties, ['manager']);
  const managerTel = pickFirstString(properties, ['managerTel']);
  const manufacturer = pickFirstString(properties, ['manufacturer']);
  const model = pickFirstString(properties, ['model']);
  const serialNumber = pickFirstString(properties, ['serialNumber']);
  const source = pickFirstString(properties, ['sourceLabel', 'source']);

  const entries: Array<[string, unknown]> = [
    ['기관명', name ?? '-'],
  ];

  if (installationPlace) {
    entries.push(['설치장소', installationPlace]);
  }
  if (address) {
    entries.push(['주소', address]);
  }
  if (phone) {
    entries.push(['연락처', phone]);
  }
  if (manager) {
    entries.push(['관리자', manager]);
  }
  if (managerTel) {
    entries.push(['관리자 연락처', managerTel]);
  }
  if (manufacturer) {
    entries.push(['제조사', manufacturer]);
  }
  if (model) {
    entries.push(['모델명', model]);
  }
  if (serialNumber) {
    entries.push(['제조번호', serialNumber]);
  }
  if (source) {
    entries.push(['소스', source]);
  }

  return entries;
}

function buildHealthPharmacyEntries(properties: Record<string, unknown>): Array<[string, unknown]> {
  const name = pickFirstString(properties, ['name', 'dutyName']);
  const address = pickFirstString(properties, ['address', 'dutyAddr']);
  const phone = pickFirstString(properties, ['phone', 'dutyTel1']);
  const hpid = pickFirstString(properties, ['hpid']);
  const operatingStatusLabel = pickFirstString(properties, ['operatingStatusLabel']);
  const operatingDayLabel = pickFirstString(properties, ['operatingDayLabel']);
  const todayHours = pickFirstString(properties, ['todayHours']);
  const notes = pickFirstString(properties, ['notes', 'dutyEtc']);
  const source = pickFirstString(properties, ['sourceLabel', 'source']);

  const entries: Array<[string, unknown]> = [
    ['약국명', name ?? '-'],
  ];

  if (operatingStatusLabel) {
    entries.push(['운영상태', operatingStatusLabel]);
  }
  if (todayHours) {
    entries.push(['오늘 운영', operatingDayLabel ? `${operatingDayLabel} ${todayHours}` : todayHours]);
  }
  if (address) {
    entries.push(['주소', address]);
  }
  if (phone) {
    entries.push(['대표전화', phone]);
  }
  if (hpid) {
    entries.push(['HPID', hpid]);
  }
  if (notes) {
    entries.push(['비고', notes]);
  }
  if (source) {
    entries.push(['소스', source]);
  }

  return entries;
}

function buildHealthInfectiousRiskEntries(properties: Record<string, unknown>): Array<[string, unknown]> {
  const name = pickFirstString(properties, ['name', 'provinceName', 'ctp_kor_nm']);
  const riskMetricLabel = pickFirstString(properties, ['riskMetricLabel']);
  const riskLabel = pickFirstString(properties, ['riskLabel']);
  const aggregationLabel = pickFirstString(properties, ['aggregationLabel']);
  const sourceLabel = pickFirstString(properties, ['sourceLabel', 'source']);
  const year = pickFirstString(properties, ['year']);
  const topDiseaseName = pickFirstString(properties, ['topDiseaseName']);
  const topDiseaseGroup = pickFirstString(properties, ['topDiseaseGroup']);
  const riskValue = properties.riskValue;
  const incidencePer100k = properties.incidencePer100k;
  const reportedCases = properties.reportedCases;
  const provinceRank = properties.provinceRank;
  const provinceTotal = properties.provinceTotal;
  const diseaseCount = properties.diseaseCount;
  const topDiseaseReportedCases = properties.topDiseaseReportedCases;
  const topDiseaseIncidencePer100k = properties.topDiseaseIncidencePer100k;
  const dataAvailable = properties.dataAvailable;

  const entries: Array<[string, unknown]> = [
    ['시도', name ?? '-'],
  ];

  if (riskLabel) {
    entries.push(['위험수준', riskLabel]);
  }
  if (riskMetricLabel) {
    entries.push(['지표', riskMetricLabel]);
  }
  if (riskValue !== undefined && riskValue !== null) {
    entries.push(['지표값', riskValue]);
  } else if (dataAvailable === false) {
    entries.push(['지표값', '현재 정보 없음']);
  }
  if (reportedCases !== undefined && reportedCases !== null) {
    entries.push(['발생건수', reportedCases]);
  }
  if (incidencePer100k !== undefined && incidencePer100k !== null) {
    entries.push(['10만명당 발생률', incidencePer100k]);
  }
  if (typeof provinceRank === 'number' && typeof provinceTotal === 'number') {
    entries.push(['시도 순위', `${provinceRank}/${provinceTotal}`]);
  }
  if (typeof diseaseCount === 'number') {
    entries.push(['집계 질병수', diseaseCount]);
  }
  if (topDiseaseName) {
    const diseaseSummary = [
      topDiseaseName,
      topDiseaseGroup ? `(${topDiseaseGroup})` : null,
      topDiseaseReportedCases !== undefined && topDiseaseReportedCases !== null ? `${formatValue(topDiseaseReportedCases)}건` : null,
      topDiseaseIncidencePer100k !== undefined && topDiseaseIncidencePer100k !== null ? `${formatValue(topDiseaseIncidencePer100k)}/10만명` : null,
    ].filter(Boolean).join(' ');
    entries.push(['대표 감염병', diseaseSummary]);
  }
  if (aggregationLabel) {
    entries.push(['집계범위', aggregationLabel]);
  }
  if (year) {
    entries.push(['기준연도', year]);
  }
  if (sourceLabel) {
    entries.push(['소스', sourceLabel]);
  }

  return entries;
}

function buildMaritimeBuoyEntries(properties: Record<string, unknown>): Array<[string, unknown]> {
  const name = pickFirstString(properties, ['name', 'buoyKr']);
  const englishName = pickFirstString(properties, ['buoyEn']);
  const blfrNo = pickFirstString(properties, ['blfrNo']);
  const buoyType = pickFirstString(properties, ['buoyType']);
  const seaName = pickFirstString(properties, ['seaName']);
  const kind = pickFirstString(properties, ['kind']);
  const lightProperty = pickFirstString(properties, ['lightProperty']);
  const remark = pickFirstString(properties, ['remark']);
  const source = pickFirstString(properties, ['sourceLabel', 'source']);

  const entries: Array<[string, unknown]> = [
    ['표지명', name ?? '-'],
  ];

  if (englishName) {
    entries.push(['영문명', englishName]);
  }
  if (blfrNo) {
    entries.push(['등대번호', blfrNo]);
  }
  if (buoyType) {
    entries.push(['표지구분', buoyType]);
  }
  if (seaName) {
    entries.push(['연안구분', seaName]);
  }
  if (kind) {
    entries.push(['표지종류', kind]);
  }
  if (lightProperty) {
    entries.push(['등질', lightProperty]);
  }
  if (remark) {
    entries.push(['비고', remark]);
  }
  if (source) {
    entries.push(['소스', source]);
  }

  return entries;
}

function buildDisasterEarthquakeEntries(properties: Record<string, unknown>): Array<[string, unknown]> {
  const name = pickFirstString(properties, ['locationLabel', 'name']);
  const occurredAt = pickFirstString(properties, ['occurredAt']);
  const announcedAt = pickFirstString(properties, ['announcedAt']);
  const intensityLabel = pickFirstString(properties, ['intensityLabel']);
  const remarks = pickFirstString(properties, ['remarks']);
  const corrections = pickFirstString(properties, ['corrections']);
  const source = pickFirstString(properties, ['sourceLabel', 'source']);
  const stationId = pickFirstString(properties, ['stationId']);
  const bulletinType = pickFirstString(properties, ['bulletinType']);
  const magnitude = pickFirstNumber(properties, ['magnitude']);
  const depthKm = pickFirstNumber(properties, ['depthKm']);

  const entries: Array<[string, unknown]> = [
    ['진앙 위치', name ?? '-'],
    ['규모', magnitude !== null ? `M${formatValue(magnitude)}` : '-'],
  ];

  if (intensityLabel) {
    entries.push(['최대진도', intensityLabel]);
  }
  if (depthKm !== null) {
    entries.push(['깊이', `${formatValue(depthKm)} km`]);
  }
  if (occurredAt) {
    entries.push(['발생시각', occurredAt]);
  }
  if (announcedAt) {
    entries.push(['발표시각', announcedAt]);
  }
  if (stationId) {
    entries.push(['지점코드', stationId]);
  }
  if (bulletinType) {
    entries.push(['통보종류', bulletinType]);
  }
  if (remarks) {
    entries.push(['참고사항', remarks]);
  }
  if (corrections) {
    entries.push(['수정사항', corrections]);
  }
  if (source) {
    entries.push(['소스', source]);
  }

  return entries;
}

function buildDisasterCivilDefenseShelterEntries(properties: Record<string, unknown>): Array<[string, unknown]> {
  const name = pickFirstString(properties, ['name']);
  const managementNo = pickFirstString(properties, ['managementNo']);
  const facilityType = pickFirstString(properties, ['facilityType']);
  const operationStatus = pickFirstString(properties, ['operationStatus']);
  const locationType = pickFirstString(properties, ['locationType']);
  const roadAddress = pickFirstString(properties, ['roadAddress']);
  const lotAddress = pickFirstString(properties, ['lotAddress']);
  const postalCode = pickFirstString(properties, ['postalCode']);
  const designatedAt = pickFirstString(properties, ['designatedAt']);
  const updatedAt = pickFirstString(properties, ['updatedAt', 'lastModifiedAt']);
  const source = pickFirstString(properties, ['sourceLabel', 'source']);
  const capacity = pickFirstNumber(properties, ['capacity']);
  const facilityArea = pickFirstNumber(properties, ['facilityArea']);

  const entries: Array<[string, unknown]> = [
    ['시설명', name ?? '-'],
    ['운영상태', operationStatus ?? '-'],
  ];

  if (facilityType) {
    entries.push(['시설구분', facilityType]);
  }
  if (capacity !== null) {
    entries.push(['최대수용인원', `${formatValue(capacity)}명`]);
  }
  if (facilityArea !== null) {
    entries.push(['시설면적', `${formatValue(facilityArea)}㎡`]);
  }
  if (locationType) {
    entries.push(['지상/지하', locationType]);
  }
  if (roadAddress) {
    entries.push(['도로명주소', roadAddress]);
  }
  if (lotAddress) {
    entries.push(['지번주소', lotAddress]);
  }
  if (postalCode) {
    entries.push(['우편번호', postalCode]);
  }
  if (managementNo) {
    entries.push(['관리번호', managementNo]);
  }
  if (designatedAt) {
    entries.push(['지정일자', designatedAt]);
  }
  if (updatedAt) {
    entries.push(['데이터갱신', updatedAt]);
  }
  if (source) {
    entries.push(['소스', source]);
  }

  return entries;
}

function buildWeatherAirQualityStationEntries(properties: Record<string, unknown>): Array<[string, unknown]> {
  const name = pickFirstString(properties, ['name', 'stationName']);
  const address = pickFirstString(properties, ['address']);
  const monitoringNetwork = pickFirstString(properties, ['monitoringNetwork']);
  const observationItems = pickFirstString(properties, ['observationItems']);
  const regionLabel = pickFirstString(properties, ['regionLabel']);
  const source = pickFirstString(properties, ['sourceLabel', 'source']);
  const dataTime = pickFirstString(properties, ['dataTime']);
  const installedYear = pickFirstNumber(properties, ['installedYear']);
  const pm10Value = pickFirstNumber(properties, ['pm10Value']);
  const pm25Value = pickFirstNumber(properties, ['pm25Value']);
  const khaiValue = pickFirstNumber(properties, ['khaiValue']);
  const pm10Grade = pickFirstNumber(properties, ['pm10Grade']);
  const pm25Grade = pickFirstNumber(properties, ['pm25Grade']);

  const entries: Array<[string, unknown]> = [
    ['측정소명', name ?? '-'],
    ['관제망', monitoringNetwork ?? '-'],
  ];

  if (regionLabel) {
    entries.push(['권역', regionLabel]);
  }
  if (address) {
    entries.push(['주소', address]);
  }
  if (observationItems) {
    entries.push(['관측항목', observationItems]);
  }
  if (installedYear !== null) {
    entries.push(['설치연도', installedYear]);
  }
  if (dataTime) {
    entries.push(['측정시각', dataTime]);
  }
  if (pm10Value !== null) {
    entries.push(['PM10', `${formatValue(pm10Value)} ㎍/m3`]);
  }
  if (pm25Value !== null) {
    entries.push(['PM2.5', `${formatValue(pm25Value)} ㎍/m3`]);
  }
  if (pm10Grade !== null) {
    entries.push(['PM10 등급', pm10Grade]);
  }
  if (pm25Grade !== null) {
    entries.push(['PM2.5 등급', pm25Grade]);
  }
  if (khaiValue !== null) {
    entries.push(['통합대기지수', khaiValue]);
  }
  if (source) {
    entries.push(['소스', source]);
  }

  return entries;
}

function buildMaritimeUlsanPortFacilityEntries(properties: Record<string, unknown>): Array<[string, unknown]> {
  const name = pickFirstString(properties, ['name', 'wharfName']);
  const portName = pickFirstString(properties, ['portName']);
  const facilityCode = pickFirstString(properties, ['facilityCode']);
  const facilitySubCode = pickFirstString(properties, ['facilitySubCode']);
  const wharfCategory = pickFirstString(properties, ['wharfCategory']);
  const cargoName = pickFirstString(properties, ['cargoName']);
  const operatorName = pickFirstString(properties, ['operatorName']);
  const length = pickFirstString(properties, ['length']);
  const depthOfWater = pickFirstString(properties, ['depthOfWater']);
  const berthCapacity = pickFirstString(properties, ['berthCapacity']);
  const berthVesselCount = pickFirstString(properties, ['berthVesselCount']);
  const unloadCapacity = pickFirstString(properties, ['unloadCapacity']);
  const source = pickFirstString(properties, ['sourceLabel', 'source']);

  const entries: Array<[string, unknown]> = [
    ['시설명', name ?? '-'],
  ];

  if (portName) {
    entries.push(['항만', portName]);
  }
  if (facilityCode) {
    entries.push(['시설코드', facilityCode]);
  }
  if (facilitySubCode) {
    entries.push(['세부코드', facilitySubCode]);
  }
  if (wharfCategory) {
    entries.push(['부두구분', wharfCategory]);
  }
  if (cargoName) {
    entries.push(['취급화물', cargoName]);
  }
  if (operatorName) {
    entries.push(['운영사', operatorName]);
  }
  if (length) {
    entries.push(['연장', length]);
  }
  if (depthOfWater) {
    entries.push(['수심', depthOfWater]);
  }
  if (berthCapacity) {
    entries.push(['접안능력', berthCapacity]);
  }
  if (berthVesselCount) {
    entries.push(['동시접안척수', berthVesselCount]);
  }
  if (unloadCapacity) {
    entries.push(['하역능력', unloadCapacity]);
  }
  if (source) {
    entries.push(['소스', source]);
  }

  return entries;
}

function buildMaritimeUlsanAnchorageEntries(properties: Record<string, unknown>): Array<[string, unknown]> {
  const name = pickFirstString(properties, ['name', 'anchorageName']);
  const facilityCode = pickFirstString(properties, ['facilityCode']);
  const geometryKindLabel = pickFirstString(properties, ['geometryKindLabel']);
  const anchorageType = pickFirstString(properties, ['anchorageType']);
  const remark = pickFirstString(properties, ['remark']);
  const titleVisible = pickFirstString(properties, ['titleVisible']);
  const source = pickFirstString(properties, ['sourceLabel', 'source']);
  const pointCount = properties.pointCount;
  const radiusMeters = properties.radiusMeters;
  const rawTypes = Array.isArray(properties.rawTypes) ? properties.rawTypes.join(', ') : null;

  const entries: Array<[string, unknown]> = [
    ['정박지명', name ?? '-'],
  ];

  if (facilityCode) {
    entries.push(['시설코드', facilityCode]);
  }
  if (geometryKindLabel) {
    entries.push(['표시형태', geometryKindLabel]);
  }
  if (anchorageType) {
    entries.push(['원본타입', anchorageType]);
  }
  if (radiusMeters !== undefined && radiusMeters !== null) {
    entries.push(['반경', `${formatValue(radiusMeters)} m`]);
  }
  if (pointCount !== undefined && pointCount !== null) {
    entries.push(['좌표수', pointCount]);
  }
  if (remark) {
    entries.push(['비고', remark]);
  }
  if (titleVisible) {
    entries.push(['라벨표시', titleVisible]);
  }
  if (rawTypes) {
    entries.push(['포함타입', rawTypes]);
  }
  if (source) {
    entries.push(['소스', source]);
  }

  return entries;
}

function buildMaritimeSeatnEntries(properties: Record<string, unknown>): Array<[string, unknown]> {
  const name = pickFirstString(properties, ['name', 'locationLabel']);
  const posCd = pickFirstString(properties, ['posCd']);
  const tnzone = pickFirstString(properties, ['tnzone']);
  const locationLabel = pickFirstString(properties, ['locationLabel']);
  const zoneDesc = pickFirstString(properties, ['zoneDesc']);
  const geometryKindLabel = pickFirstString(properties, ['geometryKindLabel']);
  const heightLimit = pickFirstString(properties, ['heightLimit']);
  const chartName = pickFirstString(properties, ['chartName']);
  const chartRef = pickFirstString(properties, ['chartRef']);
  const chartScale = pickFirstString(properties, ['chartScale']);
  const originName = pickFirstString(properties, ['originName']);
  const originOrg = pickFirstString(properties, ['originOrg']);
  const originYear = pickFirstString(properties, ['originYear']);
  const relatedDept = pickFirstString(properties, ['relatedDept']);
  const relatedRegulation = pickFirstString(properties, ['relatedRegulation']);
  const revisedAt = pickFirstString(properties, ['revisedAt']);
  const source = pickFirstString(properties, ['sourceLabel', 'source']);
  const coordinateCount = properties.coordinateCount;
  const radiusNm = properties.radiusNm;

  const entries: Array<[string, unknown]> = [
    ['구역명', name ?? '-'],
  ];

  if (posCd) {
    entries.push(['구역코드', posCd]);
  }
  if (tnzone) {
    entries.push(['훈련구역', tnzone]);
  }
  if (geometryKindLabel) {
    entries.push(['구역형태', geometryKindLabel]);
  }
  if (locationLabel) {
    entries.push(['위치', locationLabel]);
  }
  if (zoneDesc) {
    entries.push(['형태설명', zoneDesc]);
  }
  if (radiusNm !== undefined && radiusNm !== null) {
    entries.push(['반경', `${formatValue(radiusNm)} NM`]);
  }
  if (coordinateCount !== undefined && coordinateCount !== null) {
    entries.push(['좌표수', coordinateCount]);
  }
  if (heightLimit) {
    entries.push(['사용고도', heightLimit]);
  }
  if (chartName) {
    entries.push(['참조해도명', chartName]);
  }
  if (chartRef) {
    entries.push(['참조해도', chartRef]);
  }
  if (chartScale) {
    entries.push(['축척', chartScale]);
  }
  if (originName) {
    entries.push(['원본명', originName]);
  }
  if (originOrg) {
    entries.push(['원본기관', originOrg]);
  }
  if (originYear) {
    entries.push(['원본연도', originYear]);
  }
  if (relatedDept) {
    entries.push(['관련부서', relatedDept]);
  }
  if (relatedRegulation) {
    entries.push(['관련규정', relatedRegulation]);
  }
  if (revisedAt) {
    entries.push(['개정년월', revisedAt]);
  }
  if (source) {
    entries.push(['소스', source]);
  }

  return entries;
}

function buildMaritimeSeafogEntries(properties: Record<string, unknown>): Array<[string, unknown]> {
  const name = pickFirstString(properties, ['name']);
  const obsCode = pickFirstString(properties, ['obsCode']);
  const observedAt = pickFirstString(properties, ['observedAt']);
  const fogRiskLabel = pickFirstString(properties, ['fogRiskLabel']);
  const visibilityLabel = pickFirstString(properties, ['visibilityLabel']);
  const verticalVisibilityLabel = pickFirstString(properties, ['verticalVisibilityLabel']);
  const windDirection = pickFirstString(properties, ['windDirection']);
  const source = pickFirstString(properties, ['sourceLabel', 'source']);
  const windSpeed = properties.windSpeed;
  const humidityPct = properties.humidityPct;
  const pressureHpa = properties.pressureHpa;
  const airTemperatureC = properties.airTemperatureC;
  const waterTemperatureC = properties.waterTemperatureC;

  const entries: Array<[string, unknown]> = [
    ['관측소', name ?? '-'],
  ];

  if (obsCode) {
    entries.push(['관측소 코드', obsCode]);
  }
  if (observedAt) {
    entries.push(['기준시각', observedAt]);
  }
  if (fogRiskLabel) {
    entries.push(['해무 위험도', fogRiskLabel]);
  }
  if (visibilityLabel) {
    entries.push(['수평시정', visibilityLabel]);
  }
  if (verticalVisibilityLabel) {
    entries.push(['수직시정', verticalVisibilityLabel]);
  }
  if (windSpeed !== undefined && windSpeed !== null) {
    entries.push(['풍속', `${formatValue(windSpeed)} m/s`]);
  }
  if (windDirection) {
    entries.push(['풍향', windDirection]);
  }
  if (humidityPct !== undefined && humidityPct !== null) {
    entries.push(['습도', `${formatValue(humidityPct)}%`]);
  }
  if (pressureHpa !== undefined && pressureHpa !== null) {
    entries.push(['기압', `${formatValue(pressureHpa)} hPa`]);
  }
  if (airTemperatureC !== undefined && airTemperatureC !== null) {
    entries.push(['기온', `${formatValue(airTemperatureC)}°C`]);
  }
  if (waterTemperatureC !== undefined && waterTemperatureC !== null) {
    entries.push(['수온', `${formatValue(waterTemperatureC)}°C`]);
  }
  if (source) {
    entries.push(['소스', source]);
  }

  return entries;
}

function buildSocialWelfareFacilityEntries(properties: Record<string, unknown>): Array<[string, unknown]> {
  const name = pickFirstString(properties, ['name', 'fac_nam']);
  const facilityType = pickFirstString(properties, ['facilityType', 'category', 'cat_nam']);
  const phone = pickFirstString(properties, ['phone', 'fac_tel', 'rprsTelno']);
  const consultPhone = pickFirstString(properties, ['consultPhone', 'dscsnTelno']);
  const managerName = pickFirstString(properties, ['managerName', 'cnterChNm']);
  const homepage = pickFirstString(properties, ['homepage', 'hmpgAddr']);
  const email = pickFirstString(properties, ['email', 'emlAddr']);
  const languages = pickFirstString(properties, ['languages', 'pvsnLngNm']);
  const operHours = pickFirstString(properties, ['operHours', 'operHrCn']);
  const operAgency = pickFirstString(properties, ['operAgency', 'operMbyCn']);
  const operMode = pickFirstString(properties, ['operMode', 'operModeCn']);
  const fax = pickFirstString(properties, ['fax', 'fxno']);
  const remarks = pickFirstString(properties, ['remarks', 'rmrkCn']);
  const roadAddress = pickFirstString(properties, ['roadAddress', 'fac_n_add']);
  const oldAddress = pickFirstString(properties, ['oldAddress', 'fac_o_add']);
  const address = pickFirstString(properties, ['address']);
  const employeeCount = properties.employeeCount;

  const entries: Array<[string, unknown]> = [
    ['시설명', name ?? '-'],
    ['시설유형', facilityType ?? '-'],
    ['대표전화', phone ?? '-'],
  ];

  if (roadAddress || address) {
    entries.push(['도로명주소', roadAddress ?? address ?? '-']);
  }
  if (oldAddress) {
    entries.push(['지번주소', oldAddress]);
  }
  if (consultPhone) {
    entries.push(['상담전화', consultPhone]);
  }
  if (managerName) {
    entries.push(['센터장명', managerName]);
  }
  if (languages) {
    entries.push(['제공언어', languages]);
  }
  if (operHours) {
    entries.push(['운영시간', operHours]);
  }
  if (operAgency) {
    entries.push(['설립주체', operAgency]);
  }
  if (operMode) {
    entries.push(['운영형태', operMode]);
  }
  if (typeof employeeCount === 'number') {
    entries.push(['직원수', employeeCount]);
  }
  if (homepage) {
    entries.push(['홈페이지', homepage]);
  }
  if (email) {
    entries.push(['이메일', email]);
  }
  if (fax) {
    entries.push(['팩스번호', fax]);
  }
  if (remarks) {
    entries.push(['비고', remarks]);
  }

  return entries;
}

function buildPublicFacilitySafetyEntries(properties: Record<string, unknown>): Array<[string, unknown]> {
  const name = pickFirstString(properties, ['name']);
  const facilityNo = pickFirstString(properties, ['facilityNo']);
  const facilityCategory = pickFirstString(properties, ['facilityCategory']);
  const facilityKind = pickFirstString(properties, ['facilityKind']);
  const safetyGrade = pickFirstString(properties, ['safetyGrade']);
  const facilityClass = pickFirstString(properties, ['facilityClass']);
  const address = pickFirstString(properties, ['address']);
  const completionDate = pickFirstString(properties, ['completionDate', 'cplYmd']);
  const nextInspectionDate = pickFirstString(properties, ['nextInspectionDate', 'nextPcchkArrvlYmd']);
  const lastInspectionDate = pickFirstString(properties, ['lastInspectionDate', 'astChckDignYmd']);
  const buildingNo = pickFirstString(properties, ['buildingNo']);

  const entries: Array<[string, unknown]> = [
    ['시설명', name ?? '-'],
    ['안전등급', safetyGrade ?? '-'],
  ];

  if (facilityNo) {
    entries.push(['시설물번호', facilityNo]);
  }
  if (facilityCategory) {
    entries.push(['시설물구분', facilityCategory]);
  }
  if (facilityKind) {
    entries.push(['시설물종류', facilityKind]);
  }
  if (facilityClass) {
    entries.push(['시설물종별', facilityClass]);
  }
  if (address) {
    entries.push(['주소', address]);
  }
  if (completionDate) {
    entries.push(['준공일자', completionDate]);
  }
  if (nextInspectionDate) {
    entries.push(['차기정밀점검도래일', nextInspectionDate]);
  }
  if (lastInspectionDate) {
    entries.push(['최종점검진단일', lastInspectionDate]);
  }
  if (buildingNo) {
    entries.push(['건축물번호', buildingNo]);
  }

  return entries;
}

function buildHighwayTollgateEntries(properties: Record<string, unknown>): Array<[string, unknown]> {
  const name = pickFirstString(properties, ['name', 'unitName']);
  const unitCode = pickFirstString(properties, ['unitCode']);
  const routeName = pickFirstString(properties, ['routeName']);
  const routeNo = pickFirstString(properties, ['routeNo']);
  const useYn = pickFirstString(properties, ['useYn', 'status']);

  const entries: Array<[string, unknown]> = [
    ['영업소명', name ?? '-'],
    ['노선명', routeName ?? '-'],
  ];

  if (unitCode) {
    entries.push(['영업소코드', unitCode]);
  }
  if (routeNo) {
    entries.push(['노선코드', routeNo]);
  }
  if (useYn) {
    entries.push(['사용여부', useYn]);
  }

  return entries;
}

export default function StatusPanel() {
  const selectedObject = useAppStore((s) => s.selectedObject);
  const rightPanelOpen = useAppStore((s) => s.rightPanelOpen);
  const setRightPanelOpen = useAppStore((s) => s.setRightPanelOpen);
  const openAlertToast = useAppStore((s) => s.openAlertToast);
  const alerts = useAppStore((s) => s.alerts);

  const activeAlerts = useMemo(() => alerts.filter((alert) => !alert.dismissed), [alerts]);

  const selectedEntries = useMemo(() => {
    if (!selectedObject) return [];
    if (isHealthInfectiousRiskSelection(selectedObject)) {
      return buildHealthInfectiousRiskEntries(selectedObject.properties);
    }
    if (isWeatherAirQualityStationSelection(selectedObject)) {
      return buildWeatherAirQualityStationEntries(selectedObject.properties);
    }
    if (isDisasterCivilDefenseShelterSelection(selectedObject)) {
      return buildDisasterCivilDefenseShelterEntries(selectedObject.properties);
    }
    if (isDisasterEarthquakeSelection(selectedObject)) {
      return buildDisasterEarthquakeEntries(selectedObject.properties);
    }
    if (isMaritimeUlsanAnchorageSelection(selectedObject)) {
      return buildMaritimeUlsanAnchorageEntries(selectedObject.properties);
    }
    if (isMaritimeUlsanPortFacilitySelection(selectedObject)) {
      return buildMaritimeUlsanPortFacilityEntries(selectedObject.properties);
    }
    if (isMaritimeSeatnSelection(selectedObject)) {
      return buildMaritimeSeatnEntries(selectedObject.properties);
    }
    if (isMaritimeSeafogSelection(selectedObject)) {
      return buildMaritimeSeafogEntries(selectedObject.properties);
    }
    if (isMaritimeBuoySelection(selectedObject)) {
      return buildMaritimeBuoyEntries(selectedObject.properties);
    }
    if (isHealthPharmacySelection(selectedObject)) {
      return buildHealthPharmacyEntries(selectedObject.properties);
    }
    if (isHealthAedSelection(selectedObject)) {
      return buildHealthAedEntries(selectedObject.properties);
    }
    if (isHealthFacilitySelection(selectedObject)) {
      return buildHealthFacilityEntries(selectedObject.properties);
    }
    if (isHighwayTollgateSelection(selectedObject)) {
      return buildHighwayTollgateEntries(selectedObject.properties);
    }
    if (isPublicFacilitySafetySelection(selectedObject)) {
      return buildPublicFacilitySafetyEntries(selectedObject.properties);
    }
    if (isSocialWelfareFacilitySelection(selectedObject)) {
      return buildSocialWelfareFacilityEntries(selectedObject.properties);
    }
    return Object.entries(selectedObject.properties).slice(0, 8);
  }, [selectedObject]);

  const feedItems = useMemo(() => {
    return activeAlerts.slice(0, 5).map((alert) => ({
      id: alert.id,
      title: alert.title,
      description: alert.message,
      severity: alert.severity,
      timestampLabel: new Date(alert.timestamp).toLocaleTimeString('ko-KR', { hour12: false }),
    }));
  }, [activeAlerts]);

  if (!rightPanelOpen) {
    return (
      <button
        onClick={() => setRightPanelOpen(true)}
        className="absolute right-4 top-1/2 z-[70] -translate-y-1/2 rounded-xl border border-cyan-900/40 bg-[#0a0f14]/85 p-3 text-cyan-500 backdrop-blur-md transition-colors hover:border-cyan-700/50 hover:text-cyan-300"
      >
        <ChevronRight className="h-4 w-4" />
      </button>
    );
  }

  return (
    <div className="absolute right-4 top-4 z-[70] flex max-w-[calc(100vw-2rem)] flex-col-reverse items-end gap-3 xl:flex-row xl:items-start">
      <HealthInfectiousDistributionPanel />
      <HealthInfectiousTrendsPanel />

      {selectedObject && isHealthFacilitySelection(selectedObject) ? (
        <HealthFacilityDetailPanel selectedObject={selectedObject} />
      ) : null}

      <aside className="relative flex h-[calc(100vh-2rem)] w-[min(20rem,calc(100vw-2rem))] flex-col gap-3 pointer-events-auto">
        <div className="pointer-events-none absolute left-0 right-0 -top-16 z-[75] flex flex-col gap-3 xl:left-auto xl:right-[calc(100%+0.75rem)] xl:top-3 xl:w-[280px]">
          <WeatherAirQualityHeatmapLoadingToast />
          <WeatherAirQualityStationsLoadingToast />
          <DisasterCivilDefenseShelterLoadingToast />
          <HealthInfectiousRiskLoadingToast />
          <HealthPharmacyLoadingToast />
          <HealthAedLoadingToast />
          <MaritimeUlsanPortFacilitiesLoadingToast />
          <MaritimeUlsanAnchoragesLoadingToast />
          <MaritimeSeatnLoadingToast />
          <MaritimeSeafogLoadingToast />
          <MaritimeBuoyLoadingToast />
        </div>

        <GlassCard
          title="Object Detail"
          subtitle={selectedObject ? `${selectedObject.domain.toUpperCase()} • ${selectedObject.type}` : 'No object selected'}
          rightSlot={
            <button
              onClick={() => setRightPanelOpen(false)}
              className="rounded-lg border border-cyan-900/40 p-1 text-cyan-700 transition-colors hover:border-cyan-700/60 hover:text-cyan-300"
              aria-label="Close right status panel"
            >
              <PanelRightClose className="h-3.5 w-3.5" />
            </button>
          }
        >
          {selectedObject ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between rounded-xl border border-cyan-900/30 bg-cyan-950/20 px-3 py-2">
                <span className="text-[10px] uppercase tracking-[0.2em] text-cyan-700">Object ID</span>
                <span className="max-w-[150px] truncate text-[10px] text-cyan-300">{selectedObject.id}</span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-xl border border-cyan-900/30 bg-cyan-950/20 px-3 py-2">
                  <p className="text-[9px] tracking-[0.2em] text-cyan-800">LAT</p>
                  <p className="mt-1 text-[11px] text-cyan-300">{selectedObject.coordinates[1].toFixed(4)}</p>
                </div>
                <div className="rounded-xl border border-cyan-900/30 bg-cyan-950/20 px-3 py-2">
                  <p className="text-[9px] tracking-[0.2em] text-cyan-800">LNG</p>
                  <p className="mt-1 text-[11px] text-cyan-300">{selectedObject.coordinates[0].toFixed(4)}</p>
                </div>
              </div>
              <ul className="space-y-1.5">
                {selectedEntries.map(([key, value]) => (
                  <li key={key} className="flex items-center justify-between gap-2 rounded-lg border border-cyan-900/20 bg-cyan-950/20 px-2.5 py-1.5">
                    <span className="max-w-[45%] truncate text-[10px] uppercase tracking-wider text-cyan-700">{key}</span>
                    <span className="max-w-[55%] truncate text-right text-[10px] text-cyan-300">{formatValue(value)}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <div className="flex h-28 items-center justify-center rounded-xl border border-dashed border-cyan-900/30 bg-cyan-950/15 text-[10px] tracking-[0.2em] text-cyan-700">
              MAP OBJECT SELECT REQUIRED
            </div>
          )}
        </GlassCard>

        <GlassCard
          title="Live Feed"
          subtitle="Alert engine stream"
          className="overflow-hidden"
        >
          <div className="max-h-[26rem] overflow-y-auto pr-1">
            <DataFeed
              items={feedItems}
              emptyMessage="No active alerts"
              onItemClick={(item) => openAlertToast(item.id)}
            />
          </div>
        </GlassCard>

        <div className="pointer-events-none absolute inset-x-3 bottom-2 flex items-center justify-between text-[9px] tracking-[0.2em] text-cyan-800">
          <span className="inline-flex items-center gap-1"><Radar className="h-3 w-3" />LINKED</span>
          <span className="inline-flex items-center gap-1"><Siren className="h-3 w-3" />ALERT BUS</span>
          <span className="inline-flex items-center gap-1"><Target className="h-3 w-3" />STORE</span>
        </div>
      </aside>
    </div>
  );
}
