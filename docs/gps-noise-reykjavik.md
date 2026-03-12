# GPS Noise Characteristics at Reykjavik (64°N)

## Position Error
- Typical sigma: ~1.5-3.0 meters per axis (moving), ~0.6m (stationary). Based on empirical analysis of 977K GPS records.
- High latitude (64°N) degrades GPS geometry — satellites cluster toward southern sky
- Partially mitigated by GLONASS constellation
- Urban canyon effects are mild (Reykjavik is low-rise) — adds ~1-3m in dense downtown

## Coordinate Conversion at 64°N
- 1° latitude ≈ 111 km (111,000 m)
- 1° longitude ≈ 48.6 km (48,600 m)
- Ratio: lat/lng = 2.28x (longitude is compressed at high latitudes)

## Impact on Speed Estimation

### Systematic Overestimation
GPS noise **always** adds apparent distance:
- Random position errors in any direction increase the measured path length
- This is a mathematical property — noise cannot reduce apparent distance
- At 50 km/h with ~2.5m GPS sigma: raw Haversine overestimates by +2 to +6 km/h
- A stationary bus shows 1-5 km/h phantom speed (empirical P95: 1.89 km/h raw)

### Overestimation by True Speed (with ~2.5m sigma, ~5s intervals)
| True Speed | Raw Haversine Mean | Overestimation |
|---|---|---|
| 0 km/h | ~2 km/h | infinite |
| 20 km/h | ~21 km/h | +5% |
| 50 km/h | ~51 km/h | +2% |
| 70 km/h | ~71 km/h | +1-3% |

## Straeto API Coordinate Precision
From sample data analysis:
- 44% of coordinates have 13 decimal places (sub-nanometer precision — API artifact)
- Remaining have 6-8 decimal places
- All well above the ~2.5m real GPS error tolerance
- High-precision values don't indicate high-accuracy measurements

## Iceland Default Speed Limits (fallback)
| Context | Speed |
|---|---|
| Urban | 50 km/h |
| Rural (paved) | 90 km/h |
| Pedestrian zones | 10 km/h |

## Speed Limit Data Source
- Reykjavik Borgarvefsja ArcGIS API: 9,997 street segments
- Distribution: 30 km/h (44.8%), 50 km/h (48%), remainder higher
- 50m search radius for matching GPS to road segment
- Fallback: 50 km/h (Iceland urban default) if no segment within 50m
