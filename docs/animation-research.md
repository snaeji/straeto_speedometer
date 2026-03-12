# Real-Time Vehicle Animation Research

## The Core Problem

GPS fixes arrive every 2-4 seconds. Between fixes, the bus marker needs to move smoothly at 60fps. The current approach (cubic ease-out interpolation over 1800ms) causes visible pauses between animations when the next fix hasn't arrived yet.

## Industry Approaches

### Uber / Google Maps / Gojek / Ola
All major tracking apps use a **buffer delay strategy**:
1. Introduce a deliberate display delay (10-25 seconds behind real-time)
2. Always have "future" positions to animate toward
3. Interpolate between buffered positions using splines

Gojek/Ola use a 15-second default delay, adjustable based on data regularity.

### PubNub / Transit Apps
Recommend **road snapping** — constrain positions to known route polylines for the smoothest possible animation. Works well for buses on fixed routes.

## Smoothing Algorithms Compared

### Exponential Moving Average (EMA)
- `X_t = α × x_t + (1 - α) × X_{t-1}`
- Memory: only 1 previous value
- No edge artifacts (unlike sliding window)
- Best α for 2-second polling: 0.3-0.4 (4-6 seconds effective delay)
- RMSE: 4.14 vs 4.63 for SMA on GPS data
- **Best for**: Real-time speed display

### Savitzky-Golay Filter
- Fits polynomial to sliding window via least-squares
- **Preserves peaks** unlike moving average (critical for violation detection)
- Window=7, order=3 is good starting point for 2s polling
- **Non-causal** by default — needs future points for best results
- **Best for**: Historical chart display, stats panel

### LOWESS/LOESS
- Locally weighted regression at each data point
- Most flexible smoother (no global model assumption)
- Computationally expensive: O(n) regressions
- **Best for**: Trend analysis in statistics panels

### Kalman Filter
- Optimal state estimation from noisy measurements
- Provides both position AND velocity estimates
- Velocity enables prediction between measurements (60fps animation)
- **Best for**: Primary speed estimation and real-time animation

## Animation Techniques

### Cubic Hermite / Catmull-Rom Splines
- Pass through all control points exactly
- Continuous first derivatives (no sudden direction changes)
- Need 4 control points (P0, P1, P2, P3) for segment P1→P2

```typescript
function catmullRom(t: number, p0: number, p1: number, p2: number, p3: number): number {
  const t2 = t * t;
  const t3 = t2 * t;
  return 0.5 * (
    2 * p1 +
    (-p0 + p2) * t +
    (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
    (-p0 + 3 * p1 - 3 * p2 + p3) * t3
  );
}
```

**Best for**: Buffer-delay interpolation (when you have future positions)

### Dead Reckoning
- Extrapolate position from last known velocity + bearing
- Error grows linearly with time (~1-3m after 2 seconds with ~2.5m GPS error)
- Must blend corrections when new GPS fix arrives (ease over 200-500ms)
- **Best for**: Filling gaps between GPS fixes without display delay

### Kalman Prediction
- Use the Kalman predict step (constant velocity extrapolation) at 60fps
- Position: `p + v × dt`
- Naturally smooth between measurements
- Small correction (~2m) when measurement arrives — needs blend window
- **Best for**: Real-time tracking without display delay

## Chosen Approach: Kalman Prediction with Correction Blending

### Why Not Buffer Delay
- Adds 6-10 seconds of latency to a monitoring dashboard
- Buffer management complexity
- Need enough data buffered for spline interpolation

### Why Kalman Prediction
- Zero display delay — shows predicted current position
- Mathematically principled extrapolation
- Same filter provides speed estimation
- Self-correcting when measurements arrive

### Correction Blending
When a GPS fix arrives and the Kalman update runs:
1. Record pre-update predicted position + velocity
2. Run Kalman update (position jumps ~2m)
3. For next 400ms: smoothly blend from old trajectory to new trajectory
4. After 400ms: pure Kalman prediction

```
displayPos = lerp(oldTrajectory, newTrajectory, easeOutCubic(elapsed / 400ms))
```

Note: The blend velocity extrapolation had a unit bug (x1000 instead of /1000) fixed in commit a0ca910. Blend corrections now work as designed.

### Prediction Safety
- Cap extrapolation at 5 seconds
- After 5s: linearly decay velocity to 0 over 2 seconds (bus decelerates to stop)
- After 30s: marker removed (stale threshold)

## Douglas-Peucker for Trail Simplification
- Recursively simplifies polylines by removing points within epsilon
- Library: simplify.js (by Vladimir Agafonkin, from Leaflet)
- Use for bus trails at lower zoom levels
- Tolerance ~0.00001 (roughly 1 meter) at max zoom, larger when zoomed out

## JavaScript Libraries

| Purpose | Library | Notes |
|---|---|---|
| Kalman filter | Custom implementation | 2D constant velocity model, ~150 lines |
| Track simplification | simplify.js | Radial distance + Douglas-Peucker |
| Savitzky-Golay | ml-savitzky-golay | For chart smoothing |
| LOWESS | @stdlib/stats-lowess | For stats panel trends |
| Spline interpolation | cubic-hermite-spline | For buffer-delay approach (not used) |

## Key References

- Tips for Building Smooth Live Tracking (Gojek): https://www.gojek.io/blog/tips-for-building-smooth-live-tracking
- High Performant Real-Time Tracking (Ola): https://medium.com/@ratulroy/high-performant-real-time-tracking-on-web-using-google-map
- The Tech Behind Uber's Smooth Maps: https://medium.com/@ndriqim.muhadri99/the-tech-behind-ubers-smooth-real-time-map-experience
- Smooth Driver Location (PubNub): https://www.pubnub.com/how-to/smooth-driver-location/
- Animate a Marker (Mapbox GL JS): https://docs.mapbox.com/mapbox-gl-js/example/animate-marker/
