# Kalman Filter Design for GPS Speed Estimation

## Why Kalman Filter?

The current buffer-averaging approach has fundamental limitations:
1. Fixed-size window doesn't adapt to velocity changes
2. No velocity state model — can't predict future position
3. Endpoint speed underestimates during turns
4. Same smoothing for acceleration, cruise, and deceleration

A Kalman filter provides:
- **Optimal** position/velocity estimation from noisy GPS
- **Adaptive** — automatically adjusts trust between model and measurement
- **Velocity estimation** from position data (no Haversine differencing)
- **Prediction** between measurements (enables smooth 60fps animation)
- **Variable dt** handling (works with irregular update intervals)

## Mathematical Model

### Per-Axis 2D Kalman Filter

The full 2D tracking problem decouples into two independent 1D filters (x-axis and y-axis). Each axis has state `[position, velocity]`.

**State vector**: `x = [p, v]ᵀ`
- p: position in local meters (relative to bus reference point)
- v: velocity in m/s

**State transition** (constant velocity model):
```
F = [1  dt]
    [0   1]
```

**Process noise** (piecewise white noise acceleration model):
```
Q = σ_a² × [dt⁴/4  dt³/2]
             [dt³/2  dt²  ]
```
Where σ_a is the acceleration noise standard deviation.

**Measurement matrix**: `H = [1, 0]` (we observe position only)

**Measurement noise**: `R = σ_gps²` (scalar)

### Parameter Tuning

| Parameter | Value | Rationale |
|---|---|---|
| σ_a | 0.8 m/s² | Urban bus acceleration (rarely >0.8 m/s² sustained) |
| σ_gps | 5.0 m | GPS position sigma at 64°N latitude |
| R | 25 m² | σ_gps² |

#### Why σ_a = 0.8 m/s² (not 1.5)

Simulation analysis shows:
- At σ_a = 1.5: K_pos = 0.92, barely better than raw GPS; velocity very noisy
- At σ_a = 0.8: K_pos = 0.84, K_vel = 0.22; much better speed accuracy
- Urban buses rarely sustain >0.8 m/s² acceleration
- Slightly more lag on rapid speed changes, but acceptable for monitoring

### Predict Step (run between measurements and at 60fps for animation)
```
p_pred = p + v × dt
v_pred = v

P_pred[0][0] = P[0][0] + dt×P[0][1] + dt×(P[0][1] + dt×P[1][1]) + σ_a²×dt⁴/4
P_pred[0][1] = P[0][1] + dt×P[1][1] + σ_a²×dt³/2
P_pred[1][1] = P[1][1] + σ_a²×dt²
```

### Update Step (run when GPS measurement arrives)
```
innovation = z - p_pred                    (scalar)
S = P_pred[0][0] + R                      (scalar)
K₀ = P_pred[0][0] / S                     (position gain)
K₁ = P_pred[0][1] / S                     (velocity gain)

p_new = p_pred + K₀ × innovation
v_new = v_pred + K₁ × innovation

P_new[0][0] = (1 - K₀) × P_pred[0][0]
P_new[0][1] = (1 - K₀) × P_pred[0][1]
P_new[1][0] = -K₁ × P_pred[0][0] + P_pred[1][0]
P_new[1][1] = -K₁ × P_pred[0][1] + P_pred[1][1]
```

### Speed Computation
```
speed_ms = sqrt(v_x² + v_y²)
speed_kmh = speed_ms × 3.6
```

## Coordinate System

Work in local meters relative to a per-bus reference point (first GPS fix).

Conversion at 64°N (Reykjavik):
- 1° latitude ≈ 111,000 m
- 1° longitude ≈ 48,600 m

```typescript
function latLngToLocalM(lat, lng, refLat, refLng): [x_meters, y_meters]
function localMToLatLng(x_meters, y_meters, refLat, refLng): { lat, lng }
```

## Critical Design Decisions

### 1. Stationarity Detection (Distance-Based, NOT Velocity-Based)

**Problem**: Kalman velocity for a stationary bus follows a Rayleigh distribution due to noise:
- Mean phantom speed: ~9.9 km/h
- 95th percentile: ~19.4 km/h
- A velocity threshold of 3 km/h would almost never trigger

**Solution**: Keep the existing distance-based stationarity detection:
- Check raw GPS displacement between consecutive fixes
- If <10m for 2+ consecutive readings → force speed = 0
- This pre-filter catches stationary buses before Kalman processes them

### 2. Hybrid Speed: min(Kalman, Endpoint)

**Problem**: Kalman velocity can overestimate individual readings:
- At 50 km/h true speed: mean ~50.1 (good), 95th percentile ~59.2 (bad)
- A 0.97 factor doesn't bound the variance

**Solution**: Maintain a position buffer and compute endpoint speed:
```
finalSpeed = min(kalmanSpeed, endpointSpeed) × 0.95
```
- Endpoint speed always underestimates (displacement ≤ path length)
- Acts as upper bound on the Kalman estimate
- Preserves the "never overestimate" guarantee

### 3. Animation Correction Blending

**Problem**: At each Kalman update, position jumps ~4.2m (with K_pos ≈ 0.84, 5m GPS noise)
- Visible as a jerk every 3-4 seconds
- Raw Kalman prediction is smooth BETWEEN updates, but jerks AT updates

**Solution**: 400ms correction blend window:
```
When Kalman update occurs:
  Save pre-update predicted position + velocity

For next 400ms:
  t = easeOutCubic(elapsed / 400)
  oldPos = preUpdatePos + preUpdateVel × dt
  newPos = postUpdatePos + postUpdateVel × dt
  displayPos = lerp(oldPos, newPos, t)

After 400ms:
  Use pure Kalman prediction
```

### 4. Prediction Caps

- **Max extrapolation**: 5 seconds (at 50 km/h = 69m, acceptable)
- **Velocity decay**: After 5s, linearly decay velocity to 0 over 2 seconds
- **Stale threshold**: 30 seconds (existing) triggers marker removal

### 5. Warm-Up Period

- First 3 fixes: report speed = 0, place marker at raw GPS
- Kalman needs 3-4 fixes to estimate velocity reliably
- After warm-up: enable Kalman prediction for animation

## Steady-State Performance (Simulated)

| True Speed | Kalman Mean | Kalman 95th | After Hybrid Pipeline |
|---|---|---|---|
| 0 km/h | 0 km/h | 0 km/h | 0 km/h (distance filter) |
| 20 km/h | ~20.1 km/h | ~25 km/h | ~18 km/h |
| 50 km/h | ~50.1 km/h | ~59 km/h | ~46 km/h |
| 70 km/h | ~70.1 km/h | ~82 km/h | ~65 km/h |

## Implementation Files

| File | Role |
|---|---|
| `src/lib/services/kalman-speed-calculator.ts` | New Kalman filter implementation |
| `src/lib/services/speed-calculator.ts` | Old implementation (kept for reference) |
| `src/lib/services/collection-service.ts` | Integration point (swap calculator) |
| `src/lib/stores/collection.svelte.ts` | Expose calculator for MapView |
| `src/lib/components/MapView.svelte` | Animation loop uses prediction |
| `src/lib/utils/constants.ts` | Kalman parameters |

## References

- Kalman Filter with Constant Velocity Model: https://balzer82.github.io/Kalman/
- Kalman Filter for 2D Motion: https://cookierobotics.com/071/
- Tuning Q matrix: https://medium.com/data-science/tuning-q-matrix-for-cv-and-ca-models-in-kalman-filter-67084185d08c
- Rethinking GPS at Uber: https://www.uber.com/blog/rethinking-gps/
