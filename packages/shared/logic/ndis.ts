export function normalizeNdis(value: string): string {
  return value.replace(/\D/g, "");
}

/** "431208775" → "431 208 775". Leaves anything that is not nine digits unchanged. */
export function formatNdis(value: string): string {
  const digits = normalizeNdis(value);
  return digits.length === 9
    ? `${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6)}`
    : value;
}

export function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map(part => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}
