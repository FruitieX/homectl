import Color from 'color';

export const tempToColor = (temp: number) => {
  // Define temperature thresholds and corresponding hue values
  const tempPoints = [
    { temp: -20, hue: 240, sat: 20, light: 30 }, // Deep blue for very cold
    { temp: 0, hue: 200, sat: 60, light: 50 }, // Blue for freezing
    { temp: 8, hue: 180, sat: 70, light: 60 }, // Cyan for cold
    { temp: 15, hue: 120, sat: 60, light: 65 }, // Green for cool
    { temp: 23, hue: 60, sat: 70, light: 70 }, // Yellow for comfortable
    { temp: 30, hue: 20, sat: 80, light: 65 }, // Orange for warm
    { temp: 40, hue: 0, sat: 90, light: 60 }, // Red for hot
  ];

  // Find the two points to interpolate between
  let lowerPoint = tempPoints[0];
  let upperPoint = tempPoints[tempPoints.length - 1];

  for (let i = 0; i < tempPoints.length - 1; i++) {
    if (temp >= tempPoints[i].temp && temp <= tempPoints[i + 1].temp) {
      lowerPoint = tempPoints[i];
      upperPoint = tempPoints[i + 1];
      break;
    }
  }

  // Calculate interpolation factor
  const factor = (temp - lowerPoint.temp) / (upperPoint.temp - lowerPoint.temp);
  const clampedFactor = Math.max(0, Math.min(1, factor));

  // Interpolate between the two colors
  const hue =
    lowerPoint.hue + (upperPoint.hue - lowerPoint.hue) * clampedFactor;
  const sat =
    lowerPoint.sat + (upperPoint.sat - lowerPoint.sat) * clampedFactor;
  const light =
    lowerPoint.light + (upperPoint.light - lowerPoint.light) * clampedFactor;

  return Color(`hsl(${hue}, ${sat}%, ${light}%)`);
};
