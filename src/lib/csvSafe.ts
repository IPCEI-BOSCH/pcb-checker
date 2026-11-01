/** Neutralizes spreadsheet formula injection: text starting with = + - @ tab or CR gets a leading apostrophe. */
export function safeCell<T>(v: T): T | string {
  if (typeof v !== "string") return v;
  return /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
}
