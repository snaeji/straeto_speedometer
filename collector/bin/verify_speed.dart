/// Verification script: polls the Straeto API for ~30 seconds and traces
/// every step of the speed-calculation pipeline for each bus.
///
/// Run:  dart run bin/verify_speed.dart
import 'dart:async';
import 'dart:io';
import 'dart:math';
import 'package:shared/shared.dart';

class _Trace {
  final String busId;
  final String routeNr;
  final int pollIndex;
  final int timestampMs;
  final double lat;
  final double lng;

  // Step 1 – outlier check
  final double? rawDistanceM;
  final double? rawTimeDeltaS;
  final double? rawSpeedKmh;
  final String? rejectionReason;

  // Step 2 – min distance
  final bool belowMinDistance;

  // Step 3 – new: raw speed avg + endpoint cap
  final double? avgSpeed;
  final double? endpointDistM;
  final double? endpointTimeS;
  final double? endpointSpeed;
  final double? smoothedSpeed; // min(avg, endpoint)

  // Step 4 – final
  final double? finalSpeedKmh;

  // From SpeedCalculator.processFix (for comparison)
  final double? calculatorSpeedKmh;

  _Trace({
    required this.busId,
    required this.routeNr,
    required this.pollIndex,
    required this.timestampMs,
    required this.lat,
    required this.lng,
    this.rawDistanceM,
    this.rawTimeDeltaS,
    this.rawSpeedKmh,
    this.rejectionReason,
    this.belowMinDistance = false,
    this.avgSpeed,
    this.endpointDistM,
    this.endpointTimeS,
    this.endpointSpeed,
    this.smoothedSpeed,
    this.finalSpeedKmh,
    this.calculatorSpeedKmh,
  });
}

void main() async {
  const pollCount = 16;
  const pollIntervalMs = 2000;

  final api = StraetoApi();
  final calculator = SpeedCalculator();

  // Per-bus state for manual trace
  final buffers = <String, List<({double lat, double lng, int ts})>>{};
  final speedBuffers = <String, List<double>>{};
  final traces = <String, List<_Trace>>{};
  final lastSeenTs = <String, int>{};

  stdout.writeln('Polling Straeto API $pollCount times (~${pollCount * 2}s)...');
  stdout.writeln('');

  for (var i = 0; i < pollCount; i++) {
    try {
      final (timestamp, buses) = await api.fetchBusLocations();
      final now = DateTime.fromMillisecondsSinceEpoch(timestamp);
      stdout.write(
          '\rPoll ${i + 1}/$pollCount  (${now.hour.toString().padLeft(2, '0')}:${now.minute.toString().padLeft(2, '0')}:${now.second.toString().padLeft(2, '0')})  ${buses.length} buses');

      for (final bus in buses) {
        if (lastSeenTs[bus.busId] == timestamp) continue;
        lastSeenTs[bus.busId] = timestamp;

        // Run through the real calculator
        final processed = calculator.processFix(bus);

        // Manual trace
        final buf = buffers[bus.busId];
        final newFix = (lat: bus.lat, lng: bus.lng, ts: bus.timestamp);

        if (buf == null || buf.isEmpty) {
          buffers[bus.busId] = [newFix];
          speedBuffers.remove(bus.busId);
          traces.putIfAbsent(bus.busId, () => []).add(_Trace(
            busId: bus.busId,
            routeNr: bus.routeNr,
            pollIndex: i,
            timestampMs: bus.timestamp,
            lat: bus.lat,
            lng: bus.lng,
            rejectionReason: 'first fix',
            calculatorSpeedKmh: processed?.speedKmh,
          ));
          continue;
        }

        final last = buf.last;
        final distM =
            haversineDistanceM(last.lat, last.lng, bus.lat, bus.lng);
        final dtS = (bus.timestamp - last.ts) / 1000.0;
        final rawSpd = dtS > 0 ? speedKmh(distM, dtS) : 0.0;

        // Outlier checks
        String? rejection;
        if (dtS < outlierMinTimeGapS) {
          rejection = 'time gap ${dtS.toStringAsFixed(2)}s < ${outlierMinTimeGapS}s';
        } else if (distM > outlierMaxDistanceM) {
          rejection = 'distance ${distM.toStringAsFixed(1)}m > ${outlierMaxDistanceM}m';
        } else if (rawSpd > outlierMaxSpeedKmh) {
          rejection = 'raw speed ${rawSpd.toStringAsFixed(1)} > $outlierMaxSpeedKmh';
        }

        if (rejection != null) {
          traces.putIfAbsent(bus.busId, () => []).add(_Trace(
            busId: bus.busId,
            routeNr: bus.routeNr,
            pollIndex: i,
            timestampMs: bus.timestamp,
            lat: bus.lat,
            lng: bus.lng,
            rawDistanceM: distM,
            rawTimeDeltaS: dtS,
            rawSpeedKmh: rawSpd,
            rejectionReason: rejection,
            calculatorSpeedKmh: processed?.speedKmh,
          ));
          continue;
        }

        // Add to position buffer
        buf.add(newFix);
        if (buf.length > smoothingBufferSize) buf.removeAt(0);

        final belowMin = distM < minDistanceThresholdM;

        double? traceAvgSpd, traceEpDist, traceEpTime, traceEpSpd,
            traceSmoothed, traceFinal;

        if (!belowMin) {
          // Speed buffer
          final spdBuf = speedBuffers.putIfAbsent(bus.busId, () => []);
          spdBuf.add(rawSpd);
          if (spdBuf.length > smoothingBufferSize) spdBuf.removeAt(0);

          traceAvgSpd = spdBuf.reduce((a, b) => a + b) / spdBuf.length;

          // Endpoint speed
          traceSmoothed = traceAvgSpd;
          if (buf.length >= 2) {
            final first = buf.first;
            final lastBuf = buf.last;
            traceEpDist = haversineDistanceM(
                first.lat, first.lng, lastBuf.lat, lastBuf.lng);
            traceEpTime = (lastBuf.ts - first.ts) / 1000.0;
            if (traceEpTime! > 0) {
              traceEpSpd = speedKmh(traceEpDist, traceEpTime);
              traceSmoothed = min(traceAvgSpd, traceEpSpd!);
            }
          }

          traceFinal = (traceSmoothed! * conservativeSpeedFactor)
              .clamp(0.0, outlierMaxSpeedKmh);
        }

        traces.putIfAbsent(bus.busId, () => []).add(_Trace(
          busId: bus.busId,
          routeNr: bus.routeNr,
          pollIndex: i,
          timestampMs: bus.timestamp,
          lat: bus.lat,
          lng: bus.lng,
          rawDistanceM: distM,
          rawTimeDeltaS: dtS,
          rawSpeedKmh: rawSpd,
          belowMinDistance: belowMin,
          avgSpeed: traceAvgSpd,
          endpointDistM: traceEpDist,
          endpointTimeS: traceEpTime,
          endpointSpeed: traceEpSpd,
          smoothedSpeed: traceSmoothed,
          finalSpeedKmh: traceFinal,
          calculatorSpeedKmh: processed?.speedKmh,
        ));
      }
    } catch (e) {
      stderr.writeln('\nPoll $i error: $e');
    }

    if (i < pollCount - 1) {
      await Future.delayed(const Duration(milliseconds: pollIntervalMs));
    }
  }

  api.close();
  stdout.writeln('\n');

  // Print traces for buses with >= 4 fixes
  final interesting = traces.entries
      .where((e) => e.value.length >= 4)
      .toList()
    ..sort((a, b) => a.value.first.routeNr.compareTo(b.value.first.routeNr));

  stdout.writeln('${'=' * 130}');
  stdout.writeln(
      'SPEED CALCULATION TRACE (new algorithm: avg raw speeds + endpoint cap) — ${interesting.length} buses with >= 4 fixes');
  stdout.writeln('${'=' * 130}');

  for (final entry in interesting) {
    final busTraces = entry.value;
    final first = busTraces.first;
    stdout.writeln('');
    stdout.writeln(
        '--- Bus ${first.busId} (Route ${first.routeNr}) — ${busTraces.length} fixes ---');
    stdout.writeln(
        '${'Poll'.padRight(5)}'
        '${'Time'.padRight(13)}'
        '${'Dist(m)'.padRight(9)}'
        '${'dt(s)'.padRight(7)}'
        '${'RawSpd'.padRight(9)}'
        '${'AvgSpd'.padRight(9)}'
        '${'EpDist'.padRight(9)}'
        '${'EpDt'.padRight(7)}'
        '${'EpSpd'.padRight(9)}'
        '${'Smooth'.padRight(9)}'
        '${'Final'.padRight(9)}'
        '${'Calc'.padRight(9)}'
        'Notes');
    stdout.writeln('-' * 130);

    for (final t in busTraces) {
      final time = DateTime.fromMillisecondsSinceEpoch(t.timestampMs);
      final timeStr =
          '${time.hour.toString().padLeft(2, '0')}:${time.minute.toString().padLeft(2, '0')}:${time.second.toString().padLeft(2, '0')}.${(time.millisecond ~/ 100)}';

      String note = '';
      if (t.rejectionReason != null) note = 'REJECTED: ${t.rejectionReason}';
      if (t.belowMinDistance) note = 'below ${minDistanceThresholdM}m → 0';

      if (t.finalSpeedKmh != null &&
          t.calculatorSpeedKmh != null &&
          (t.finalSpeedKmh! - t.calculatorSpeedKmh!).abs() > 0.01) {
        note +=
            ' MISMATCH trace=${t.finalSpeedKmh!.toStringAsFixed(1)} calc=${t.calculatorSpeedKmh!.toStringAsFixed(1)}';
      }

      String _f(double? v) => v != null ? v.toStringAsFixed(1) : '-';
      String _f2(double? v) => v != null ? v.toStringAsFixed(2) : '-';

      stdout.writeln(
          '${t.pollIndex.toString().padRight(5)}'
          '${timeStr.padRight(13)}'
          '${_f(t.rawDistanceM).padRight(9)}'
          '${_f2(t.rawTimeDeltaS).padRight(7)}'
          '${_f(t.rawSpeedKmh).padRight(9)}'
          '${_f(t.avgSpeed).padRight(9)}'
          '${_f(t.endpointDistM).padRight(9)}'
          '${_f2(t.endpointTimeS).padRight(7)}'
          '${_f(t.endpointSpeed).padRight(9)}'
          '${_f(t.smoothedSpeed).padRight(9)}'
          '${_f(t.finalSpeedKmh).padRight(9)}'
          '${_f(t.calculatorSpeedKmh).padRight(9)}'
          '$note');
    }
  }

  // Summary
  stdout.writeln('');
  stdout.writeln('${'=' * 130}');
  stdout.writeln('SUMMARY');
  stdout.writeln('${'=' * 130}');

  var totalFixes = 0, rejections = 0, belowMin = 0;
  var maxFinal = 0.0, maxRaw = 0.0;
  String? maxFinalBus, maxRawBus;
  var mismatches = 0;
  var capped = 0; // times endpoint was lower than avg

  for (final entry in traces.entries) {
    for (final t in entry.value) {
      totalFixes++;
      if (t.rejectionReason != null) rejections++;
      if (t.belowMinDistance) belowMin++;
      if (t.calculatorSpeedKmh != null && t.calculatorSpeedKmh! > maxFinal) {
        maxFinal = t.calculatorSpeedKmh!;
        maxFinalBus = '${t.busId} (route ${t.routeNr})';
      }
      if (t.rawSpeedKmh != null && t.rawSpeedKmh! > maxRaw) {
        maxRaw = t.rawSpeedKmh!;
        maxRawBus = '${t.busId} (route ${t.routeNr})';
      }
      if (t.finalSpeedKmh != null &&
          t.calculatorSpeedKmh != null &&
          (t.finalSpeedKmh! - t.calculatorSpeedKmh!).abs() > 0.01) {
        mismatches++;
      }
      if (t.avgSpeed != null && t.endpointSpeed != null &&
          t.endpointSpeed! < t.avgSpeed! - 0.01) {
        capped++;
      }
    }
  }

  stdout.writeln('Total fixes processed:     $totalFixes');
  stdout.writeln('Rejected (outlier):        $rejections');
  stdout.writeln('Below min distance:        $belowMin');
  stdout.writeln('Max raw speed seen:        ${maxRaw.toStringAsFixed(1)} km/h  ($maxRawBus)');
  stdout.writeln('Max final speed seen:      ${maxFinal.toStringAsFixed(1)} km/h  ($maxFinalBus)');
  stdout.writeln('Endpoint cap kicked in:    $capped times');
  stdout.writeln('Trace vs Calc mismatch:    $mismatches');
  stdout.writeln('Unique buses seen:         ${traces.length}');
}
