# Design Discussions

Ongoing record of design questions, tradeoffs, and decisions.

## Animation: Prediction vs. Delayed Playback

**Question:** Why do we predict where the bus will be between GPS updates (Kalman prediction at 60fps) instead of adding a ~10-second delay and showing more accurate, confirmed positions?

**Prediction approach (current):**
- Feels live — markers move in real-time
- Kalman filter guesses forward between 2-second API updates
- Can overshoot on turns/stops until the next reading corrects it
- Positions are slightly less accurate between updates

**Delayed playback approach:**
- More accurate — you have future readings to smooth backwards with full knowledge
- 10-second delay means the map doesn't match what's happening *right now*
- For a transparency/accountability tool, nobody's making real-time decisions, so delay arguably doesn't matter
- Speed calculations would be more honest

**Decision:** Use **adaptive delayed playback** — each bus buffers N genuine readings before rendering.

**Why adaptive:** The API's genuine GPS update rate varies significantly per bus (median 5s, P75: 6s, P95: 12s). A fixed delay either wastes time for fast updaters or doesn't buffer enough for slow ones. Adaptive means every bus gets the same quality of smoothing regardless of its update rate.

**Known tradeoffs accepted:**
- Two buses at the same intersection may be showing slightly different moments in time — unlikely to be noticeable in practice
- Can't show a single "delayed by X seconds" indicator — each bus is on its own timeline
- New buses take a few readings before appearing on the map

**Implementation:** Each bus maintains its own reading queue. Don't render until N genuine readings are buffered. Interpolate between confirmed positions at 60fps. Speed is calculated from real positions, not estimates.

**Buffer size:** N = 4 genuine readings (initial value). At median 5s update rate, that's ~20 seconds before a bus first appears — acceptable. Gives enough data to establish direction, speed, and handle turns. This value is subject to change after real-world testing and visual review.

## Interpolation Method

**Question:** How should bus markers move between confirmed GPS points?

**Decision:** Catmull-Rom spline interpolation through confirmed points. With 4 buffered readings, we have exactly the control points needed for a smooth curve. Turns look like actual turns, speed changes are gradual. Linear interpolation was considered but produces zig-zag paths with abrupt direction changes at each waypoint.

## Kalman Filter Removal

**Question:** With delayed confirmed positions, do we still need the Kalman filter?

**Decision:** Remove it. It served two purposes — position smoothing and forward prediction. Delayed playback eliminates the need for prediction, and spline interpolation through confirmed points provides the smoothing. Speed is calculated as distance-along-spline divided by time between confirmed positions.

The 0.95 conservative speed factor was compensating for GPS noise inflating Haversine distances. With smoothed confirmed positions the distortion is reduced, so the factor may need adjusting (possibly 0.97 or 1.0). Revisit during testing.

## Buffer Edge Behavior

**Question:** What happens when a bus reaches its newest confirmed position and no new data has arrived?

**Decision:** Freeze in place and visually indicate the bus is stale (e.g. dim the marker or show a visual cue). No prediction, no extrapolation.

**Speed data safety:** When a bus is frozen, its last confirmed speed remains its displayed speed — do not compute a new speed of zero from the freeze. The speed value only updates when new genuine readings arrive. This keeps stale markers from polluting speed statistics.

## Unified Renderer for Live and Playback

**Question:** Live mode and playback mode currently have separate code paths. Should they share rendering logic?

**Decision:** Yes, unify them. One renderer that takes a stream of confirmed positions and animates through them via spline interpolation. Live mode feeds it from the API with an adaptive buffer delay. Playback mode feeds it from a file. Same animation, same speed calculation, same visuals. Less code, fewer bugs, consistent behavior across modes.
