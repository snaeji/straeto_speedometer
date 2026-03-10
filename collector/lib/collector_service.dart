import 'dart:async';

import 'package:shared/shared.dart';

import 'jsonl_writer.dart';

class CollectorService {
  final StraetoApi _api;
  final SpeedCalculator _speedCalculator;
  final SpeedLimitService _speedLimitService;
  final JsonlWriter _writer;
  final Duration _interval;

  final Map<String, int> _lastSeenTimestamp = {};
  bool _running = false;

  int totalRecords = 0;
  int totalViolations = 0;
  DateTime? startTime;
  DateTime? _lastStatsTime;

  CollectorService({
    required StraetoApi api,
    required SpeedCalculator speedCalculator,
    required SpeedLimitService speedLimitService,
    required JsonlWriter writer,
    required Duration interval,
  })  : _api = api,
        _speedCalculator = speedCalculator,
        _speedLimitService = speedLimitService,
        _writer = writer,
        _interval = interval;

  Future<void> start() async {
    _running = true;
    startTime = DateTime.now();
    _lastStatsTime = startTime;

    print('Collector started. Polling every ${_interval.inSeconds}s...');

    while (_running) {
      try {
        final (timestamp, buses) = await _api.fetchBusLocations();
        var written = 0;
        var violations = 0;

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
          final isViolation = processed.speedKmh != null &&
              processed.speedKmh! > limit;

          final record = processed.copyWith(
            speedLimitKmh: limit,
            isViolation: isViolation,
          );

          _writer.write(record);
          written++;
          if (isViolation) violations++;
        }

        totalRecords += written;
        totalViolations += violations;

        // Print stats every 60 seconds
        final now = DateTime.now();
        if (_lastStatsTime != null &&
            now.difference(_lastStatsTime!).inSeconds >= 60) {
          final elapsed = now.difference(startTime!);
          final rate = totalRecords / elapsed.inSeconds * 60;
          print(
            '[${now.toUtc().toIso8601String()}] '
            '${elapsed.inMinutes}m: '
            '$totalRecords records (${rate.toStringAsFixed(0)}/min), '
            '${_lastSeenTimestamp.length} buses, '
            '$totalViolations violations',
          );
          _lastStatsTime = now;
        }
      } catch (e) {
        print('Warning: $e');
      }

      await Future.delayed(_interval);
    }
  }

  void stop() {
    _running = false;
    _writer.close();

    final elapsed = startTime != null
        ? DateTime.now().difference(startTime!).inMinutes
        : 0;
    print('\nCollector stopped after ${elapsed}m.');
    print('Total: $totalRecords records, $totalViolations violations.');
  }
}
