'use client';

import { useMemo } from 'react';
import { ChevronRight, PanelRightClose, Radar, Siren, Target } from 'lucide-react';
import GlassCard from '@/components/ui/GlassCard';
import DataFeed from '@/components/ui/DataFeed';
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
    <aside className="absolute right-4 top-4 z-[70] flex h-[calc(100vh-2rem)] w-[320px] flex-col gap-3 pointer-events-auto">
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
  );
}
