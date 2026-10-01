type Cell = string | number | boolean | null | undefined;

function escapeCell(value: Cell): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number" || typeof value === "boolean")
    return String(value);
  // Neutralise spreadsheet formula injection in text cells.
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** RFC 4180 CSV with a UTF-8 BOM so Excel opens it with the right encoding. */
export function toCsv(headers: string[], rows: Cell[][]): string {
  return `﻿${[headers, ...rows].map(row => row.map(escapeCell).join(",")).join("\r\n")}\r\n`;
}
