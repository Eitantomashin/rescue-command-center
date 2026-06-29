const MOJIBAKE_MARKERS = /[×ÂÃÐÑ�]|׳[0-9A-Za-z]|ג[€‚„]/;

function windows1252Byte(char: string) {
  const code = char.charCodeAt(0);
  if (code <= 0xff) {
    return code;
  }

  const map: Record<number, number> = {
    0x20ac: 0x80,
    0x201a: 0x82,
    0x0192: 0x83,
    0x201e: 0x84,
    0x2026: 0x85,
    0x2020: 0x86,
    0x2021: 0x87,
    0x02c6: 0x88,
    0x2030: 0x89,
    0x0160: 0x8a,
    0x2039: 0x8b,
    0x0152: 0x8c,
    0x017d: 0x8e,
    0x2018: 0x91,
    0x2019: 0x92,
    0x201c: 0x93,
    0x201d: 0x94,
    0x2022: 0x95,
    0x2013: 0x96,
    0x2014: 0x97,
    0x02dc: 0x98,
    0x2122: 0x99,
    0x0161: 0x9a,
    0x203a: 0x9b,
    0x0153: 0x9c,
    0x017e: 0x9e,
    0x0178: 0x9f
  };

  return map[code] ?? null;
}

function scoreHebrew(value: string) {
  const hebrew = (value.match(/[\u0590-\u05ff]/g) ?? []).length;
  const markers = (value.match(MOJIBAKE_MARKERS) ?? []).length;
  return hebrew * 3 - markers * 5;
}

export function repairHebrewMojibake(value: string) {
  if (!MOJIBAKE_MARKERS.test(value)) {
    return value;
  }

  const bytes: number[] = [];
  for (const char of value) {
    const byte = windows1252Byte(char);
    if (byte === null) {
      return value;
    }
    bytes.push(byte);
  }

  try {
    const decoded = new TextDecoder("utf-8", { fatal: true }).decode(new Uint8Array(bytes));
    return scoreHebrew(decoded) > scoreHebrew(value) ? decoded : value;
  } catch {
    return value;
  }
}

export function containsHebrewMojibake(value: string | null | undefined) {
  return typeof value === "string" && MOJIBAKE_MARKERS.test(value);
}

export function displayHebrewText(value: string | null | undefined) {
  return typeof value === "string" ? repairHebrewMojibake(value) : value;
}
