/** Декодування тексту з автоматичним вибором кодування (UTF-8 → windows-1251). */
export function decodeText(bytes: Uint8Array, fallback = 'windows-1251'): string {
  let start = 0;
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) start = 3;
  const body = bytes.subarray(start);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(body);
  } catch {
    return new TextDecoder(fallback).decode(body);
  }
}

export function decodeFixed(bytes: Uint8Array, encoding: string): string {
  let end = bytes.indexOf(0);
  if (end < 0) end = bytes.length;
  return new TextDecoder(encoding).decode(bytes.subarray(0, end));
}

export interface InputFile {
  name: string;
  bytes: Uint8Array;
}

export function baseName(name: string): string {
  const slash = Math.max(name.lastIndexOf('/'), name.lastIndexOf('\\'));
  return name.slice(slash + 1);
}

export function stem(name: string): string {
  const b = baseName(name);
  const dot = b.lastIndexOf('.');
  return dot > 0 ? b.slice(0, dot) : b;
}

export function extension(name: string): string {
  const b = baseName(name);
  const dot = b.lastIndexOf('.');
  return dot > 0 ? b.slice(dot + 1).toLowerCase() : '';
}
