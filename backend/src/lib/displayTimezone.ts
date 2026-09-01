export const QLIX_DISPLAY_TIMEZONE = 'Asia/Kolkata';

function partsInDisplayTz(ms: number): Record<string, string> {
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: QLIX_DISPLAY_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  return Object.fromEntries(
    formatter.formatToParts(new Date(ms)).map((part) => [part.type, part.value]),
  );
}

export function formatClockInDisplayTz(ms: number): string {
  const parts = partsInDisplayTz(ms);
  return `${parts.hour}:${parts.minute}:${parts.second}`;
}

export function formatDateInDisplayTz(ms: number): string {
  const parts = partsInDisplayTz(ms);
  return `${parts.year}-${parts.month}-${parts.day}`;
}
