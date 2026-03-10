import '../constants.dart';
import '../models/bus_location.dart';
import 'geo_utils.dart';

class _PositionFix {
  final double lat;
  final double lng;
  final int timestamp; // epoch ms

  _PositionFix(this.lat, this.lng, this.timestamp);
}

class SpeedCalculator {
  final Map<String, List<_PositionFix>> _busBuffers = {};
  final Map<String, _PositionFix> _lastSmoothed = {};

  /// Process a new GPS fix. Returns BusLocation with speedKmh set,
  /// or null if rejected by outlier detection.
  BusLocation? processFix(BusLocation location) {
    final busId = location.busId;
    final buffer = _busBuffers[busId];
    final newFix =
        _PositionFix(location.lat, location.lng, location.timestamp);

    // First fix for this bus
    if (buffer == null || buffer.isEmpty) {
      _busBuffers[busId] = [newFix];
      _lastSmoothed.remove(busId);
      return location.copyWith(speedKmh: 0);
    }

    final lastFix = buffer.last;

    // Step 1: Outlier rejection
    final distanceM =
        haversineDistanceM(lastFix.lat, lastFix.lng, newFix.lat, newFix.lng);
    final timeDeltaMs = newFix.timestamp - lastFix.timestamp;
    final timeDeltaS = timeDeltaMs ~/ 1000;

    if (timeDeltaS < outlierMinTimeGapS) return null;
    if (distanceM > outlierMaxDistanceM) return null;

    final rawSpeed = speedKmh(distanceM, timeDeltaS);
    if (rawSpeed > outlierMaxSpeedKmh) return null;

    // Step 2: Minimum distance threshold
    if (distanceM < minDistanceThresholdM) {
      buffer.add(newFix);
      if (buffer.length > smoothingBufferSize) {
        buffer.removeAt(0);
      }
      return location.copyWith(speedKmh: 0);
    }

    // Step 3: Position smoothing
    buffer.add(newFix);
    if (buffer.length > smoothingBufferSize) {
      buffer.removeAt(0);
    }

    // Compute smoothed position
    var smoothLat = 0.0;
    var smoothLng = 0.0;
    for (final fix in buffer) {
      smoothLat += fix.lat;
      smoothLng += fix.lng;
    }
    smoothLat /= buffer.length;
    smoothLng /= buffer.length;

    final currentSmoothed =
        _PositionFix(smoothLat, smoothLng, newFix.timestamp);
    final prevSmoothed = _lastSmoothed[busId];
    _lastSmoothed[busId] = currentSmoothed;

    if (prevSmoothed == null) {
      return location.copyWith(speedKmh: 0);
    }

    final smoothedDistanceM = haversineDistanceM(
      prevSmoothed.lat,
      prevSmoothed.lng,
      currentSmoothed.lat,
      currentSmoothed.lng,
    );
    final smoothedTimeDeltaS =
        (currentSmoothed.timestamp - prevSmoothed.timestamp) ~/ 1000;

    if (smoothedTimeDeltaS <= 0) {
      return location.copyWith(speedKmh: 0);
    }

    final smoothedSpeed = speedKmh(smoothedDistanceM, smoothedTimeDeltaS);

    // Step 4: Conservative speed factor
    final finalSpeed = smoothedSpeed * conservativeSpeedFactor;

    return location.copyWith(speedKmh: finalSpeed);
  }

  void resetBus(String busId) {
    _busBuffers.remove(busId);
    _lastSmoothed.remove(busId);
  }

  void resetAll() {
    _busBuffers.clear();
    _lastSmoothed.clear();
  }
}
