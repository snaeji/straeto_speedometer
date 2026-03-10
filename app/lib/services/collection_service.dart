import 'package:shared/shared.dart';

class CollectionService {
  final StraetoApi _api;
  final SpeedCalculator _speedCalculator;
  final SpeedLimitService _speedLimitService;
  final Map<String, int> _lastSeenTimestamp = {};

  CollectionService({
    required StraetoApi api,
    required SpeedCalculator speedCalculator,
    required SpeedLimitService speedLimitService,
  })  : _api = api,
        _speedCalculator = speedCalculator,
        _speedLimitService = speedLimitService;

  void resetBus(String busId) {
    _speedCalculator.resetBus(busId);
    _lastSeenTimestamp.remove(busId);
  }

  /// Perform one collection cycle.
  /// Returns processed (deduplicated, speed-calculated) bus locations.
  Future<List<BusLocation>> collectOnce() async {
    final (timestamp, buses) = await _api.fetchBusLocations();
    final results = <BusLocation>[];

    for (final bus in buses) {
      // Deduplicate: skip if GPS hasn't updated
      if (_lastSeenTimestamp[bus.busId] == timestamp) continue;
      _lastSeenTimestamp[bus.busId] = timestamp;

      // Speed calculation pipeline
      final processed = _speedCalculator.processFix(bus);
      if (processed == null) continue;

      // Speed limit matching
      final limit =
          _speedLimitService.getSpeedLimit(processed.lat, processed.lng);
      final isViolation =
          processed.speedKmh != null && processed.speedKmh! > limit;

      results.add(processed.copyWith(
        speedLimitKmh: limit,
        isViolation: isViolation,
      ));
    }

    return results;
  }
}
