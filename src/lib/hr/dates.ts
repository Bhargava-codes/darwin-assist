import {
  addDays,
  eachDayOfInterval,
  format,
  isSameMonth,
  isWeekend,
  parseISO,
  startOfMonth,
} from "date-fns";

export const iso = (d: Date) => format(d, "yyyy-MM-dd");
export const pretty = (d: string) => format(parseISO(d), "d MMM yyyy");
export const prettyShort = (d: string) => format(parseISO(d), "d MMM");

export type DayBreakdown = {
  total_days: number;
  working_days: number;
  weekend_dates: string[];
};

export function breakdown(start: string, end: string): DayBreakdown {
  const days = eachDayOfInterval({ start: parseISO(start), end: parseISO(end) });
  const weekend = days.filter((d) => isWeekend(d));
  return {
    total_days: days.length,
    working_days: days.length - weekend.length,
    weekend_dates: weekend.map(iso),
  };
}

export function weekendSentence(b: DayBreakdown): string | null {
  if (b.weekend_dates.length === 0) return null;
  const labels = b.weekend_dates.map((d) => format(parseISO(d), "do"));
  return `${labels.join(" and ")} ${labels.length > 1 ? "are" : "is"} a weekend`;
}

export function monthDays(reference = new Date()): Date[] {
  const first = startOfMonth(reference);
  const days: Date[] = [];
  let cursor = first;
  while (isSameMonth(cursor, first)) {
    days.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return days;
}
