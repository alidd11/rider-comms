/** A neutral fallback while Rider Comms' shared avatar art is not available.
 * Names and handles are account data; no generated pictures or helmet art.
 */
export function initialsForName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return 'R';
  const chars = parts.length > 1
    ? (parts[0][0] ?? '') + (parts[parts.length - 1][0] ?? '')
    : parts[0].slice(0, 2);
  return chars.toLocaleUpperCase().slice(0, 2);
}
export function handleWithAt(handle: string): string {
  const text = handle.trim();
  if (!text) return '';
  return text.startsWith('@') ? text : '@' + text;
}
