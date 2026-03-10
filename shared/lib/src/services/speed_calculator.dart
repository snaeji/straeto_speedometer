import 'dart:math';

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
  final Map<String, List<double>> _speedBuffers = {};
  final Map<String, double> _lastSpeed = {};
  final Map<String, int> _stationaryCount = {};

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
      _speedBuffers.remove(busId);
      _lastSpeed.remove(busId);
      _stationaryCount[busId] = 0;
      return location.copyWith(speedKmh: 0);
    }

    final lastFix = buffer.last;

    // Step 1: Outlier rejection
    final distanceM =
        haversineDistanceM(lastFix.lat, lastFix.lng, newFix.lat, newFix.lng);
    final timeDeltaS = (newFix.timestamp - lastFix.timestamp) / 1000.0;

    if (timeDeltaS < outlierMinTimeGapS) return null;
    if (distanceM > outlierMaxDistanceM) return null;

    final rawSpeed = speedKmh(distanceM, timeDeltaS);
    if (rawSpeed > outlierMaxSpeedKmh) return null;

    // Add fix to position buffer
    buffer.add(newFix);
    if (buffer.length > smoothingBufferSize) {
      buffer.removeAt(0);
    }

    // Step 2: Minimum distance threshold
    if (distanceM < minDistanceThresholdM) {
      final count = (_stationaryCount[busId] ?? 0) + 1;
      _stationaryCount[busId] = count;

      if (count >= stationaryConfirmCount) {
        // Confirmed stationary — report 0 and clear speed history
        _lastSpeed.remove(busId);
        _speedBuffers.remove(busId);
        return location.copyWith(speedKmh: 0);
      }

      // Not yet confirmed — hold last known speed
      return location.copyWith(speedKmh: _lastSpeed[busId] ?? 0);
    }

    // Bus is moving — reset stationary counter
    _stationaryCount[busId] = 0;

    // Step 3: Speed smoothing — average of raw speeds capped by endpoint speed
    final spdBuffer = _speedBuffers.putIfAbsent(busId, () => []);
    spdBuffer.add(rawSpeed);
    if (spdBuffer.length > smoothingBufferSize) {
      spdBuffer.removeAt(0);
    }

    final avgSpeed = spdBuffer.reduce((a, b) => a + b) / spdBuffer.length;

    // Endpoint speed: displacement across full buffer / time across full buffer
    double smoothedSpeed = avgSpeed;
    if (buffer.length >= 2) {
      final first = buffer.first;
      final last = buffer.last;
      final epDistM =
          haversineDistanceM(first.lat, first.lng, last.lat, last.lng);
      final epTimeS = (last.timestamp - first.timestamp) / 1000.0;
      if (epTimeS > 0) {
        final endpointSpeed = speedKmh(epDistM, epTimeS);
        smoothedSpeed = min(avgSpeed, endpointSpeed);
      }
    }

    // Step 4: Conservative speed factor, capped at outlier max
    final finalSpeed =
        (smoothedSpeed * conservativeSpeedFactor).clamp(0.0, outlierMaxSpeedKmh);

    _lastSpeed[busId] = finalSpeed;
    return location.copyWith(speedKmh: finalSpeed);
  }

  void resetBus(String busId) {
    _busBuffers.remove(busId);
    _speedBuffers.remove(busId);
    _lastSpeed.remove(busId);
    _stationaryCount.remove(busId);
  }

  void resetAll() {
    _busBuffers.clear();
    _speedBuffers.clear();
    _lastSpeed.clear();
    _stationaryCount.clear();
  }
}
