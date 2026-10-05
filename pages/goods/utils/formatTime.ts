type TimeValue = string | number | Date | null | undefined;

export const formatTime = (value: TimeValue, template: string) => {
  const text = typeof value === 'string' ? value.trim() : '';
  const date = value instanceof Date
    ? new Date(value.getTime())
    : typeof value === 'number'
      ? new Date(value)
      : text && /^\d+$/.test(text)
        ? new Date(Number(text))
        : new Date(text);
  if (!Number.isFinite(date.getTime())) return '';

  const pad = (part: number) => (part < 10 ? `0${part}` : String(part));
  const tokens: Record<string, string> = {
    YYYY: String(date.getFullYear()),
    MM: pad(date.getMonth() + 1),
    DD: pad(date.getDate()),
    HH: pad(date.getHours()),
    mm: pad(date.getMinutes()),
    ss: pad(date.getSeconds()),
  };
  return template.replace(/YYYY|MM|DD|HH|mm|ss/g, (token) => tokens[token]);
};
