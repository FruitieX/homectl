import Color from 'color';

// Unified humidity thresholds and categories
const HUMIDITY_THRESHOLDS = {
  VERY_DRY: 20,
  DRY: 30,
  COMFORTABLE_MIN: 40,
  COMFORTABLE_MAX: 60,
  HUMID: 70,
  VERY_HUMID: 80,
} as const;

export const getHumidityCategory = (humidity: number): string => {
  if (humidity < HUMIDITY_THRESHOLDS.VERY_DRY) return 'Very Dry';
  if (humidity < HUMIDITY_THRESHOLDS.DRY) return 'Dry';
  if (humidity < HUMIDITY_THRESHOLDS.COMFORTABLE_MIN) return 'Low';
  if (humidity <= HUMIDITY_THRESHOLDS.COMFORTABLE_MAX) return 'Comfortable';
  if (humidity < HUMIDITY_THRESHOLDS.HUMID) return 'High';
  if (humidity < HUMIDITY_THRESHOLDS.VERY_HUMID) return 'Humid';
  return 'Very Humid';
};

// Get single humidity color for tooltips and badges
export const getHumidityColor = (
  humidity: number,
  boostLightness?: boolean,
) => {
  const saturation = boostLightness ? 1 : 0.7;
  const lightness = boostLightness ? 0.7 : 0.5;

  // Define humidity points and corresponding hue values for smooth interpolation
  // Using purple/magenta/cyan spectrum to be distinct from temperature (orange/red/blue)
  const humidityPoints = [
    { humidity: 0, hue: 300 }, // Magenta for very dry
    { humidity: HUMIDITY_THRESHOLDS.VERY_DRY, hue: 280 }, // Purple-magenta for dry
    { humidity: HUMIDITY_THRESHOLDS.DRY, hue: 260 }, // Purple for low
    { humidity: HUMIDITY_THRESHOLDS.COMFORTABLE_MIN, hue: 240 }, // Blue-purple for comfortable start
    { humidity: HUMIDITY_THRESHOLDS.COMFORTABLE_MAX, hue: 200 }, // Light blue for comfortable end
    { humidity: HUMIDITY_THRESHOLDS.HUMID, hue: 180 }, // Cyan for high
    { humidity: HUMIDITY_THRESHOLDS.VERY_HUMID, hue: 160 }, // Blue-cyan for humid
    { humidity: 100, hue: 140 }, // Blue-green for very humid
  ];

  // Find the two points to interpolate between
  let lowerPoint = humidityPoints[0];
  let upperPoint = humidityPoints[humidityPoints.length - 1];

  for (let i = 0; i < humidityPoints.length - 1; i++) {
    if (
      humidity >= humidityPoints[i].humidity &&
      humidity <= humidityPoints[i + 1].humidity
    ) {
      lowerPoint = humidityPoints[i];
      upperPoint = humidityPoints[i + 1];
      break;
    }
  }

  // Calculate interpolation factor
  const factor =
    (humidity - lowerPoint.humidity) /
    (upperPoint.humidity - lowerPoint.humidity);
  const clampedFactor = Math.max(0, Math.min(1, factor));

  // Interpolate between the two hue values
  const baseHue =
    lowerPoint.hue + (upperPoint.hue - lowerPoint.hue) * clampedFactor;

  return `hsl(${baseHue}, ${saturation * 100}%, ${lightness * 100}%)`;
};

export const humidityToColor = (humidity: number) => {
  // Define humidity thresholds and corresponding hue values
  // Using purple/magenta/cyan spectrum to be distinct from temperature
  const humidityPoints = [
    { humidity: 0, hue: 300, sat: 80, light: 60 }, // Magenta for very dry
    { humidity: 20, hue: 280, sat: 70, light: 65 }, // Purple-magenta for dry
    { humidity: 30, hue: 260, sat: 60, light: 70 }, // Purple for low
    { humidity: 40, hue: 240, sat: 60, light: 65 }, // Blue-purple for comfortable start
    { humidity: 60, hue: 200, sat: 70, light: 60 }, // Light blue for comfortable end
    { humidity: 70, hue: 180, sat: 80, light: 55 }, // Cyan for high
    { humidity: 80, hue: 160, sat: 90, light: 50 }, // Blue-cyan for humid
    { humidity: 100, hue: 140, sat: 100, light: 45 }, // Blue-green for very humid
  ];

  // Find the two points to interpolate between
  let lowerPoint = humidityPoints[0];
  let upperPoint = humidityPoints[humidityPoints.length - 1];

  for (let i = 0; i < humidityPoints.length - 1; i++) {
    if (
      humidity >= humidityPoints[i].humidity &&
      humidity <= humidityPoints[i + 1].humidity
    ) {
      lowerPoint = humidityPoints[i];
      upperPoint = humidityPoints[i + 1];
      break;
    }
  }

  // Calculate interpolation factor
  const factor =
    (humidity - lowerPoint.humidity) /
    (upperPoint.humidity - lowerPoint.humidity);
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

export { HUMIDITY_THRESHOLDS };
