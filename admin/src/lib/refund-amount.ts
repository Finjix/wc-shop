// 金额输入使用元，接口使用整数分；不通过浮点乘法转换。
export function parseRefundAmount(value: string, maximum: number): number | null {
  const text = value.trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(text)) return null;
  const [yuan, fraction = ''] = text.split('.');
  const amount = Number(`${yuan}${fraction.padEnd(2, '0')}`);
  return Number.isSafeInteger(amount) && amount > 0 && amount <= maximum ? amount : null;
}
