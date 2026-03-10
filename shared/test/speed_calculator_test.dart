import 'package:test/test.dart';
import 'package:shared/shared.dart';

BusLocation _makeFix(double lat, double lng, int timestampMs) {
  return BusLocation(
    busId: 'bus-1',
    routeNr: '1',
    tripId: 'trip-1',
    lat: lat,
    lng: lng,
    direction: 0,
    timestamp: timestampMs,
  );
}

void main() {
  late SpeedCalculator calc;

  setUp(() {
    calc = SpeedCalculator();
  });

  test('first fix returns speedKmh = 0', () {
    final result = calc.processFix(_makeFix(64.135, -21.900, 1000000));
    expect(result, isNotNull);
    expect(result!.speedKmh, equals(0));
  });

  test('stationary bus returns speedKmh = 0', () {
    calc.processFix(_makeFix(64.135, -21.900, 1000000));
    final result = calc.processFix(_makeFix(64.135, -21.900, 1005000));
    expect(result, isNotNull);
    expect(result!.speedKmh, equals(0));
  });

  test('normal movement returns reasonable speed', () {
    // ~500m apart, 10s interval → ~180 km/h raw, but with smoothing+factor
    // Use smaller movement: ~50m apart, 5s interval → ~36 km/h raw
    calc.processFix(_makeFix(64.1350, -21.9000, 0));
    calc.processFix(_makeFix(64.1354, -21.9000, 5000)); // ~44m north
    calc.processFix(_makeFix(64.1358, -21.9000, 10000)); // ~44m more
    final result = calc.processFix(_makeFix(64.1362, -21.9000, 15000));

    expect(result, isNotNull);
    expect(result!.speedKmh, isNotNull);
    expect(result!.speedKmh!, greaterThan(0));
    // After 0.92 factor, should be less than raw Haversine speed
    final rawDist = haversineDistanceM(64.1358, -21.9000, 64.1362, -21.9000);
    final rawSpeed = speedKmh(rawDist, 5);
    expect(result!.speedKmh!, lessThan(rawSpeed));
  });

  test('outlier rejection: >500m jump returns null', () {
    calc.processFix(_makeFix(64.135, -21.900, 0));
    // Jump ~5km north
    final result = calc.processFix(_makeFix(64.180, -21.900, 5000));
    expect(result, isNull);
  });

  test('outlier rejection: >120 km/h returns null', () {
    calc.processFix(_makeFix(64.1350, -21.900, 0));
    // ~400m in 2s → 720 km/h
    final result = calc.processFix(_makeFix(64.1386, -21.900, 2000));
    expect(result, isNull);
  });

  test('outlier rejection: <1s time gap returns null', () {
    calc.processFix(_makeFix(64.135, -21.900, 1000));
    final result = calc.processFix(_makeFix(64.135, -21.901, 1500));
    expect(result, isNull);
  });

  test('minimum distance: <10m movement returns speedKmh = 0', () {
    calc.processFix(_makeFix(64.13500, -21.90000, 0));
    // ~5m movement
    final result = calc.processFix(_makeFix(64.13504, -21.90000, 5000));
    expect(result, isNotNull);
    expect(result!.speedKmh, equals(0));
  });

  test('resetBus clears state, next fix returns 0', () {
    calc.processFix(_makeFix(64.135, -21.900, 0));
    calc.processFix(_makeFix(64.136, -21.900, 5000));
    calc.resetBus('bus-1');
    final result = calc.processFix(_makeFix(64.137, -21.900, 10000));
    expect(result, isNotNull);
    expect(result!.speedKmh, equals(0));
  });
}
