import { useEffect, useMemo, useState, type CSSProperties } from "react";
import type { MonthSummary } from "../domain/summary";
import { MoneyValue } from "./bits";

export const BALANCE_INSTRUMENT_GEOMETRY = {
  desktop: {
    beamWidth: 250,
    panWidth: 120,
    containerHeight: 206,
    cardInset: 26,
  },
  mobile: {
    beamWidth: 190,
    panWidth: 104,
    containerHeight: 168,
    cardInset: 26,
  },
} as const;

type BalanceInstrumentGeometry =
  (typeof BALANCE_INSTRUMENT_GEOMETRY)[keyof typeof BALANCE_INSTRUMENT_GEOMETRY];

export function minimumBalanceInstrumentWidth(geometry: BalanceInstrumentGeometry): number {
  return geometry.beamWidth + geometry.panWidth + geometry.cardInset * 2;
}

export function balanceInstrumentFits(
  containerWidth: number,
  geometry: BalanceInstrumentGeometry,
): boolean {
  return geometry.beamWidth / 2 + geometry.panWidth / 2
    <= containerWidth / 2 - geometry.cardInset;
}

export function balanceInstrumentTilt(actuallySaved: number, promised: number): number {
  if (!Number.isFinite(actuallySaved) || !Number.isFinite(promised) || promised <= 0) return 0;
  return Math.max(-7, Math.min(7, (promised - actuallySaved) / promised * 20));
}

function monthName(month: string, style: "long" | "short"): string {
  const [year, rawMonth] = month.split("-").map(Number);
  if (!year || !rawMonth) return month;
  return new Intl.DateTimeFormat("en", {
    month: style,
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, rawMonth - 1, 1)));
}

function joinMonthNames(months: string[]): string {
  if (months.length < 2) return months[0] ?? "";
  return `${months[0]} and ${months[1]}`;
}

function tipProgressLabel(actuallySaved: number, promised: number): string {
  if (promised <= 0) return "level";
  const progress = Math.min(1, Math.abs(promised - actuallySaved) / promised);
  const commonFractions: Array<[number, string]> = [
    [1, "all"],
    [3 / 4, "three quarters"],
    [2 / 3, "two thirds"],
    [1 / 2, "half"],
    [1 / 3, "a third"],
    [1 / 4, "a quarter"],
    [1 / 5, "a fifth"],
    [1 / 10, "a tenth"],
  ];
  const nearest = commonFractions.find(([value]) => Math.abs(progress - value) <= 0.025);
  return nearest?.[1] ?? `${Math.max(1, Math.round(progress * 100))}%`;
}

function historyStatus(rate: number, targetSaveRate: number): "met" | "near" | "below" {
  if (rate >= targetSaveRate) return "met";
  if (rate > targetSaveRate - 5) return "near";
  return "below";
}

export interface BalanceInstrumentProps {
  summary: MonthSummary;
  history: MonthSummary[];
  money: (value: number) => string;
  percent: (value: number, digits?: number) => string;
  financialValuesHidden: boolean;
}

export function BalanceInstrument({
  summary,
  history,
  money,
  percent,
  financialValuesHidden,
}: BalanceInstrumentProps) {
  const actuallySaved = summary.projectedSaved;
  const promised = summary.incomeTotal * summary.targetSaveRate / 100;
  const tilt = balanceInstrumentTilt(actuallySaved, promised);
  const [displayedTilt, setDisplayedTilt] = useState(0);

  useEffect(() => {
    setDisplayedTilt(tilt);
  }, [tilt]);

  const levelMonths = useMemo(
    () => [...history]
      .filter((row) => row.saveRate >= summary.targetSaveRate)
      .sort((left, right) => right.month.localeCompare(left.month))
      .slice(0, 2)
      .sort((left, right) => left.month.localeCompare(right.month))
      .map((row) => monthName(row.month, "long")),
    [history, summary.targetSaveRate],
  );

  const footerMonths = useMemo(() => {
    const rows = new Map(
      history.map((row) => [row.month, { month: row.month, rate: row.saveRate }]),
    );
    rows.set(summary.month, { month: summary.month, rate: summary.projectedSaveRate });
    return [...rows.values()]
      .sort((left, right) => left.month.localeCompare(right.month))
      .slice(-4);
  }, [history, summary.month, summary.projectedSaveRate]);

  const difference = Math.abs(promised - actuallySaved);
  const beamStyle = {
    "--balance-tilt": `${displayedTilt}deg`,
    "--balance-counter-tilt": `${-displayedTilt}deg`,
  } as CSSProperties;

  return (
    <section className="balance-instrument" aria-label="Savings balance instrument">
      <header className="balance-instrument-header">
        <span className="mz-eyebrow">Mīzān · the balance</span>
        <span className="balance-instrument-target">
          level at{" "}
          <MoneyValue
            formatted={percent(summary.targetSaveRate, 0)}
            hidden={financialValuesHidden}
          />
        </span>
      </header>

      <div className="balance-instrument-stage">
        <span className="balance-instrument-post" aria-hidden="true" />
        <span className="balance-instrument-base" aria-hidden="true" />
        <span className="balance-instrument-fulcrum" aria-hidden="true" />
        <div className="balance-instrument-beam" style={beamStyle}>
          <span className="balance-instrument-cap left" aria-hidden="true" />
          <span className="balance-instrument-cap right" aria-hidden="true" />
          <span className="balance-instrument-hanger left" aria-hidden="true" />
          <span className="balance-instrument-hanger right" aria-hidden="true" />
          <div className="balance-instrument-pan saved">
            <span>Actually saved</span>
            <strong className="balance-instrument-figure mz-figure">
              <MoneyValue formatted={money(actuallySaved)} hidden={financialValuesHidden} />
            </strong>
          </div>
          <div className="balance-instrument-pan promised">
            <span>You promised</span>
            <strong className="balance-instrument-figure mz-figure">
              <MoneyValue formatted={money(promised)} hidden={financialValuesHidden} />
            </strong>
          </div>
        </div>
      </div>

      <p className="balance-instrument-caption mz-body">
        {difference > 0 && promised > 0 ? (
          <>
            The beam is off by{" "}
            <strong><MoneyValue formatted={money(difference)} hidden={financialValuesHidden} /></strong>
            {" "}— {tipProgressLabel(actuallySaved, promised)} of the way tipped.
          </>
        ) : (
          <>The beam is level.</>
        )}
        {levelMonths.length > 0 && (
          <> It sat level in <strong>{joinMonthNames(levelMonths)}</strong>.</>
        )}
      </p>

      {footerMonths.length > 0 && (
        <div className="balance-instrument-history" aria-label="Recent save-rate history">
          {footerMonths.map((row) => {
            const status = historyStatus(row.rate, summary.targetSaveRate);
            return (
              <div
                className="balance-instrument-month"
                data-status={status}
                aria-label={`${monthName(row.month, "long")}: ${status === "met" ? "met target" : status === "near" ? "within five points of target" : "below target"}`}
                key={row.month}
              >
                <span>{monthName(row.month, "short")}</span>
                <span className="balance-instrument-month-bar" aria-hidden="true" />
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
