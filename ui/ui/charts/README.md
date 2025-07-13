# Unified Chart Tooltip System

This unified tooltip system provides consistent tooltip behavior across all charts while eliminating code duplication. It includes smart positioning, mobile-friendly interactions, and modal-aware positioning.

## Components

### `useChartTooltip` Hook

A reusable hook that provides tooltip functionality with smart positioning and unified interaction handling.

```typescript
import { useChartTooltip } from './hooks/useChartTooltip';

const {
  tooltipData,
  tooltipLeft,
  tooltipTop,
  tooltipOpen,
  showTooltip,
  hideTooltip,
  handleMouseMove,
  handleTouch,
  TooltipInPortal,
  containerRef,
  svgRef,
} = useChartTooltip<YourDataType>({
  data,
  margin,
  config: {
    zIndex: 10000,
    debounce: 100,
    detectBounds: true,
    scroll: true,
  },
});
```

### `ChartTooltip` Component

A unified tooltip component with consistent styling and flexible content structure.

```typescript
import { ChartTooltip } from './ChartTooltip';

<ChartTooltip
  title="Main Value"
  fields={[
    { label: 'Max', value: '25°C' },
    { label: 'Min', value: '15°C', secondary: true },
  ]}
  timestamp={new Date()}
  TooltipInPortal={TooltipInPortal}
  tooltipTop={tooltipTop}
  tooltipLeft={tooltipLeft}
  tooltipOpen={tooltipOpen}
  margin={margin}
/>
```

## Features

### Smart Positioning

- **Viewport Aware**: Automatically adjusts position to stay within viewport bounds
- **Modal Aware**: Detects when inside DaisyUI modals and adjusts positioning strategy
- **Mobile Optimized**: Different positioning logic for mobile vs desktop

### Unified Interactions

- **Single Interaction Area**: Eliminates tooltip bouncing with one overlay per chart
- **Mouse Support**: Smooth mouse tracking with debouncing
- **Touch Support**: Mobile-friendly touch interactions
- **Consistent API**: Same interface across all chart types
- **No Conflicts**: ChartInteractionOverlay prevents competing event handlers

### Performance Optimized

- **Debounced Updates**: Reduces excessive re-renders
- **Smart Bounds Detection**: Efficiently calculates optimal tooltip placement
- **Memory Efficient**: Reuses tooltip portal instances

## Usage Examples

### Basic Chart Integration

```typescript
export const MyChart: React.FC<Props> = ({ data, width, height }) => {
  const margin = { top: 20, right: 20, bottom: 40, left: 40 };

  const {
    tooltipData,
    tooltipOpen,
    handleMouseMove,
    handleTouch,
    hideTooltip,
    TooltipInPortal,
    containerRef,
    svgRef,
  } = useChartTooltip<DataPoint>({ data, margin });

  // Function to find closest data point
  const findDataPoint = (position: TooltipPosition): DataPoint | undefined => {
    const xPos = position.x - margin.left;
    // Your data point finding logic here
    return closestDataPoint;
  };

  return (
    <div ref={containerRef}>
      <svg ref={svgRef} width={width} height={height}>
        {/* Your chart content */}

        {/* Unified interaction overlay */}
        <ChartInteractionOverlay
          width={width}
          height={height}
          margin={margin}
          data={data}
          findDataPoint={findDataPoint}
          handleMouseMove={handleMouseMove}
          handleTouch={handleTouch}
          hideTooltip={hideTooltip}
        />
      </svg>

      {tooltipData && (
        <ChartTooltip
          title={`${tooltipData.value}°C`}
          fields={[
            { label: 'Type', value: tooltipData.type },
            { label: 'Status', value: tooltipData.status, secondary: true },
          ]}
          timestamp={tooltipData.time}
          TooltipInPortal={TooltipInPortal}
          tooltipTop={tooltipTop}
          tooltipLeft={tooltipLeft}
          tooltipOpen={tooltipOpen}
          margin={margin}
        />
      )}
    </div>
  );
};
```

### Custom Tooltip Configuration

```typescript
const tooltipConfig = {
  zIndex: 15000,        // Higher z-index for special cases
  debounce: 50,         // Faster updates
  detectBounds: false,  // Disable automatic bounds detection
  scroll: false,        // Disable scroll handling
};

const { ... } = useChartTooltip<DataType>({
  data,
  margin,
  config: tooltipConfig
});
```

### Advanced Tooltip Fields

```typescript
const tooltipFields: TooltipField[] = [
  {
    label: 'Temperature',
    value: `${data.temp}°C`,
    color: '#ff6b6b', // Custom color
  },
  {
    label: 'Humidity',
    value: `${data.humidity}%`,
    secondary: true, // Muted styling
  },
  {
    label: 'Pressure',
    value: `${data.pressure} hPa`,
  },
];
```

## ChartInteractionOverlay

The `ChartInteractionOverlay` component provides a unified interaction system that eliminates tooltip bouncing and ensures consistent behavior across all charts.

```typescript
import { ChartInteractionOverlay } from './ChartInteractionOverlay';

<ChartInteractionOverlay
  width={width}
  height={height}
  margin={margin}
  data={data}
  findDataPoint={findDataPoint}
  handleMouseMove={handleMouseMove}
  handleTouch={handleTouch}
  hideTooltip={hideTooltip}
/>
```

### Benefits

- **No Bouncing**: Single interaction area prevents tooltip flickering
- **Consistent**: Same behavior across all chart types
- **Edge Case Handling**: Extended interaction area handles mouse leave events
- **Touch Friendly**: Proper touch event handling for mobile

## Migration from Old System

### Before (Individual Chart Implementation)

```typescript
const { tooltipData, showTooltip, hideTooltip } = useTooltip();
const { TooltipInPortal } = useTooltipInPortal({ ... });

const handleMouseMove = (event) => {
  // Custom positioning logic
  // Duplicate code across charts
};

// Custom tooltip JSX with duplicated styling
```

### After (Unified System)

```typescript
const {
  tooltipData,
  handleMouseMove,
  handleTouch,
  hideTooltip,
  TooltipInPortal,
} = useChartTooltip({ data, margin });

// Standardized interaction handlers
// Consistent tooltip component
```

## Key Benefits

1. **DRY Principle**: Eliminates duplicate tooltip code across charts
2. **Consistent UX**: Same tooltip behavior and styling everywhere
3. **Mobile Optimized**: Built-in mobile and modal support
4. **Performance**: Optimized positioning calculations and debouncing
5. **Type Safe**: Full TypeScript support with proper type inference
6. **Flexible**: Configurable while maintaining sensible defaults

## Chart Compatibility

Currently integrated with:

- ✅ `TemperatureSensorChart`
- ✅ `WeatherChart`
- ✅ `SpotPriceChart`
- 🔄 Add your chart here...

## API Reference

### Types

```typescript
interface TooltipPosition {
  x: number;
  y: number;
  clientX: number;
  clientY: number;
}

interface TooltipField {
  label: string;
  value: string | number;
  color?: string;
  secondary?: boolean;
}

interface TooltipConfig {
  zIndex?: number;
  debounce?: number;
  detectBounds?: boolean;
  scroll?: boolean;
}
```

### Functions

- `findDataPoint(position: TooltipPosition): T | undefined` - Find the closest data point to cursor/touch

### Positioning Behavior

All tooltips now use **cursor-relative positioning** for consistency:

- Tooltips appear near the cursor/touch position, not at data point coordinates
- Simplified positioning logic: 10px above cursor by default, 20px below if near top of viewport
- Proper coordinate system handling for different chart types (bar charts vs line charts)
- Fixed data point alignment for time-series charts with normalized timestamps

For more examples, see the implementation in `TemperatureSensorChart.tsx`, `WeatherChart.tsx`, and `SpotPriceChart.tsx`.

### SpotPriceChart Integration Example

```typescript
// All charts use consistent coordinate handling
const findDataPoint = (position: TooltipPosition): SpotPriceData | undefined => {
  const xPos = position.x; // No margin adjustment needed - handled by hook
  let closestIndex = 0;
  let closestDistance = Infinity;

  data.forEach((d, i) => {
    const barX = (xScale(d.time) ?? 0) + xScale.bandwidth() / 2;
    const distance = Math.abs(xPos - barX);
    if (distance < closestDistance) {
      closestDistance = distance;
      closestIndex = i;
    }
  });

  return data[closestIndex];
};

// Unified interaction overlay (used by all charts)
<ChartInteractionOverlay
  width={width}
  height={height}
  margin={margin}
  data={data}
  findDataPoint={findDataPoint}
  handleMouseMove={handleMouseMove}
  handleTouch={handleTouch}
  hideTooltip={hideTooltip}
/>

<ChartTooltip
  title={
    <div className="flex items-center gap-2">
      <div
        className="w-3 h-3 rounded-full"
        style={{ backgroundColor: spotPriceToColor(tooltipData.value) }}
      />
      {tooltipData.value.toFixed(2)} c/kWh
    </div>
  }
  fields={[
    {
      label: 'Category',
      value: tooltipData.value < 5 ? 'Low price' : 'High price',
      secondary: true,
    },
  ]}
  timestamp={new Date(tooltipData.time)}
  // ... other props
/>
```

## Simplified Tooltip System

The current implementation uses a simplified approach that works reliably across all chart types and environments:

### Key Features

- **No Animation Complexity**: Removed complex animation tracking that caused lag and hiding issues
- **Disabled Scroll Detection**: Uses `scroll: false, detectBounds: false` to avoid positioning conflicts
- **Direct Coordinate Handling**: Simple coordinate calculation without complex transforms
- **Consistent Positioning**: 10px above cursor, 20px below if near viewport top

### Usage

```typescript
const {
  tooltipData,
  tooltipOpen,
  handleMouseMove,
  handleTouch,
  hideTooltip,
  TooltipInPortal,
  containerRef,
  svgRef,
} = useChartTooltip<DataType>({ data, margin });

// Simple, unified interaction
<ChartInteractionOverlay
  width={width}
  height={height}
  margin={margin}
  data={data}
  findDataPoint={findDataPoint}
  handleMouseMove={handleMouseMove}
  handleTouch={handleTouch}
  hideTooltip={hideTooltip}
/>
```

## Recent Fixes

### WeatherChart Data Point Alignment

Fixed issue where tooltip hover was offset from displayed data points:

- **Problem**: Data timestamps (9/12 AM) vs chart ticks (midnight) caused misalignment
- **Solution**: Updated `bisectDate` to use normalized `displayTime` instead of original `time`

### TemperatureSensorChart Positioning

Fixed tooltip positioning offset:

- **Problem**: Tooltips appeared below cursor instead of near it
- **Solution**: Simplified positioning logic and fixed coordinate system handling

### Unified Coordinate System

All charts now use consistent coordinate handling:

- `findDataPoint` functions receive chart-area coordinates (margin-adjusted by hook)
- Tooltip positioning uses direct SVG coordinates for simplicity
- Eliminates coordinate system confusion between different chart types
- Simplified approach avoids lag and hiding issues with complex animation handling
