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

/**
 * 格式化价格数额为字符串
 * 可对小数部分进行填充，默认不填充
 * @param price 价格数额，以分为单位!
 * @param fill 是否填充小数部分 0-不填充 1-填充第一位小数 2-填充两位小数
 */
export function priceFormat(price: number | string | null, fill = 0): number | string | null {
  const numericPrice = Number(price);
  if (!Number.isFinite(numericPrice) || price === null) {
    return price;
  }

  const restoredValue = Math.round(numericPrice * 10 ** 8) / 10 ** 8; // 恢复精度丢失
  let priceFormatValue = `${Math.ceil(restoredValue) / 100}`; // 向上取整，单位转换为元，转换为字符串
  if (fill > 0) {
    // 补充小数位数
    if (priceFormatValue.indexOf('.') === -1) {
      priceFormatValue = `${priceFormatValue}.`;
    }
    const n = fill - priceFormatValue.split('.')[1]?.length;
    for (let i = 0; i < n; i++) {
      priceFormatValue = `${priceFormatValue}0`;
    }
  }
  return priceFormatValue;
}

/**
 * 获取cdn裁剪后链接
 *
 * @param {string} url 基础链接
 * @param {number} width 宽度，单位px
 * @param {number} [height] 可选，高度，不填时与width同值
 */
export const cosThumb = (url: string, width: number, height = width) => {
  if (!url) return '';
  if (!/^https?:\/\/[^/]+\.cos\.[^/]+\.myqcloud\.com\//i.test(url)
    || /[?#]/.test(url)) return url;

  return `${url}?imageMogr2/thumbnail/${~~width}x${~~height}`;
};
