# Speed Calculation Pipeline Analysis

## Current Implementation

### Four-Step Pipeline (`src/lib/services/speed-calculator.ts`)

**Per-bus state:**
- `busBuffers: Map<string, PositionFix[]>` — Last 6 position fixes
- `speedBuffers: Map<string, number[]>` — Last 6 raw speed readings
- `lastSpeed: Map<string, number>` — Most recent reported speed
- `stationaryCount: Map<string, number>` — Consecutive sub-threshold readings

### Step 1: Outlier Rejection
- Time gap < 1s → reject (duplicate/stale)
- Distance > 500m → reject + reset bus state (GPS glitch)
- Raw Haversine speed > 120 km/h → reject + reset (physically impossible)

### Step 2: Minimum Distance Threshold
- If distance < 10m between consecutive fixes:
  - Increment stationary counter
  - After 2 consecutive sub-threshold readings → confirmed stopped → speed = 0
  - Before confirmation → hold previous speed (prevents jitter)
- At 2-4s polling, 10m threshold = ~7 km/h minimum detectable speed
- Eliminates phantom speed from GPS noise (stationary buses show 5-12 km/h raw)

### Step 3: Speed Smoothing (Dual Method)
1. **Average speed**: Mean of all speeds in 6-reading buffer
2. **Endpoint speed**: Total displacement across buffer / total time across buffer
3. **Final**: `Math.min(avgSpeed, endpointSpeed)` — conservative minimum

Why two methods:
- Average speed smooths individual reading noise
- Endpoint speed prevents overestimation during turns (displacement < arc length)
- Taking the minimum ensures we never overestimate

### Step 4: Conservative Speed Factor
- Multiply by 0.95 (5% reduction)
- Compensates for systematic GPS overestimation bias
- GPS noise always adds apparent distance → overestimates speed
- Clamp to [0, 120] km/h

### Constants (`src/lib/utils/constants.ts`)
```
OUTLIER_MAX_DISTANCE_M = 500.0
OUTLIER_MAX_SPEED_KMH = 120.0
OUTLIER_MIN_TIME_GAP_S = 1
MIN_DISTANCE_THRESHOLD_M = 10.0
STATIONARY_CONFIRM_COUNT = 2
SMOOTHING_BUFFER_SIZE = 6
MIN_SPEED_READINGS = 3
CONSERVATIVE_SPEED_FACTOR = 0.95
```

## Weaknesses Identified

### 1. Buffer Initialization Lag
- Requires 3+ readings before reporting any speed
- First 5-10 seconds of a trip shows 0 km/h even if moving
- Prevents noise spikes but feels sluggish

### 2. Endpoint Method Underestimates During Turns
- `Math.min(avgSpeed, endpointSpeed)` heavily penalizes curves
- A bus at 40 km/h through a curve might show 35 km/h
- Intentional (conservative) but aggressive

### 3. Fixed Buffer Size
- Same 6-reading buffer regardless of update frequency
- No adaptation to velocity changes (same smoothing for acceleration & cruise)

### 4. No Velocity State Model
- Treats each speed reading independently
- Doesn't track acceleration/deceleration trends
- Can't predict future position (needed for smooth animation)

### 5. Speed Limit Search is O(n)
- Brute-force iteration over 10K road segments
- ~20-30K distance calculations per GPS fix
- Acceptable for 100 buses but could bottleneck at scale

## Expected Accuracy

| True Speed | Raw Haversine | After Pipeline | 95th Percentile |
|---|---|---|---|
| 0 km/h | ~6 km/h | 0 km/h | 0 km/h |
| 20 km/h | ~23 km/h | ~17 km/h | ~21 km/h |
| 50 km/h | ~52 km/h | ~44 km/h | ~49 km/h |
| 70 km/h | ~72 km/h | ~62 km/h | ~67 km/h |

Pipeline systematically underestimates by 15-20%. This trades accuracy for zero false positives on violations.
