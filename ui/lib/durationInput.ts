/** Duration fields carry whole milliseconds on the wire, including fractional display units. */
export function parseDurationInput(
  raw: string,
  factor: number,
  required = false,
): { value?: number; error?: string } {
  if (!raw.trim())
    return required ? { error: 'Enter a duration.' } : { value: undefined };
  if (!/^[+]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(raw.trim()))
    return { error: 'Enter a complete, non-negative duration.' };
  const ms = Number(raw) * factor;
  const rounded = Math.round(ms);
  if (!Number.isSafeInteger(rounded) || Math.abs(ms - rounded) > 1e-7)
    return {
      error: 'Use a duration in whole milliseconds within the supported range.',
    };
  return { value: rounded };
}
