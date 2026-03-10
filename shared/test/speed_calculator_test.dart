import 'package:test/test.dart';
import 'package:shared/shared.dart';

BusLocation _makeFix(double lat, double lng, int timestampMs,
    {String busId = 'bus-1'}) {
  return BusLocation(
    busId: busId,
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
    // ~44m apart each, 5s interval → ~32 km/h raw
    calc.processFix(_makeFix(64.1350, -21.9000, 0));
    calc.processFix(_makeFix(64.1354, -21.9000, 5000));
    calc.processFix(_makeFix(64.1358, -21.9000, 10000));
    final result = calc.processFix(_makeFix(64.1362, -21.9000, 15000));

    expect(result, isNotNull);
    expect(result!.speedKmh, isNotNull);
    expect(result!.speedKmh!, greaterThan(0));
    // After conservative factor, should be less than raw Haversine speed
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

  // ---- Regression tests for the smoothing amplification bug ----

  test('acceleration: final speed never exceeds raw speed', () {
    // Simulate bus accelerating: slow → medium → fast over 3s intervals
    calc.processFix(_makeFix(64.13500, -21.9000, 0)); // first fix
    calc.processFix(_makeFix(64.13510, -21.9000, 3000)); // ~11m in 3s, slow
    calc.processFix(_makeFix(64.13540, -21.9000, 6000)); // ~33m in 3s, medium
    final result =
        calc.processFix(_makeFix(64.13590, -21.9000, 9000)); // ~56m in 3s, fast

    expect(result, isNotNull);
    expect(result!.speedKmh!, greaterThan(0));

    // The final speed must not exceed the raw speed of this interval
    final rawDist = haversineDistanceM(64.13540, -21.9000, 64.13590, -21.9000);
    final rawSpd = speedKmh(rawDist, 3.0);
    expect(result!.speedKmh!, lessThanOrEqualTo(rawSpd),
        reason: 'smoothed speed must not amplify above raw speed');
  });

  test('deceleration: speed tracks downward', () {
    // Fast → medium → slow over 3s intervals
    calc.processFix(_makeFix(64.13500, -21.9000, 0));
    calc.processFix(_makeFix(64.13560, -21.9000, 3000)); // ~67m in 3s, fast
    final fast =
        calc.processFix(_makeFix(64.13600, -21.9000, 6000)); // ~44m in 3s, med
    final slow =
        calc.processFix(_makeFix(64.13620, -21.9000, 9000)); // ~22m in 3s, slow

    expect(fast, isNotNull);
    expect(slow, isNotNull);
    expect(slow!.speedKmh!, lessThan(fast!.speedKmh!),
        reason: 'speed should decrease when bus decelerates');
  });

  test('short time delta does not amplify speed', () {
    // The old bug was worst with 2-second gaps where centroid shift was large
    calc.processFix(_makeFix(64.13500, -21.9000, 0));
    calc.processFix(_makeFix(64.13530, -21.9000, 2000)); // ~33m in 2s
    calc.processFix(_makeFix(64.13560, -21.9000, 4000)); // ~33m in 2s
    final result =
        calc.processFix(_makeFix(64.13590, -21.9000, 6000)); // ~33m in 2s

    expect(result, isNotNull);
    // Constant 33m/2s ≈ 60 km/h raw. Final should be ~57 km/h (× 0.95).
    // Must never exceed 60 km/h.
    expect(result!.speedKmh!, lessThanOrEqualTo(60.0));
    expect(result!.speedKmh!, greaterThan(40.0),
        reason: 'should still report meaningful speed for a moving bus');
  });

  test('speed never exceeds outlier cap', () {
    // Even with edge-case data, the final speed must be clamped
    calc.processFix(_makeFix(64.1350, -21.9000, 0));
    // ~100m in 3.1s ≈ 116 km/h (just under 120 outlier limit)
    calc.processFix(_makeFix(64.1359, -21.9000, 3100));
    calc.processFix(_makeFix(64.1368, -21.9000, 6200));
    final result = calc.processFix(_makeFix(64.1377, -21.9000, 9300));

    expect(result, isNotNull);
    expect(result!.speedKmh!, lessThanOrEqualTo(outlierMaxSpeedKmh));
  });

  test('moving bus that stops reports 0 immediately, not held speed', () {
    // Bus moves at ~30 km/h, then stops
    calc.processFix(_makeFix(64.13500, -21.9000, 0));
    calc.processFix(_makeFix(64.13540, -21.9000, 5000)); // ~44m, moving
    calc.processFix(_makeFix(64.13580, -21.9000, 10000)); // ~44m, moving

    // Bus stops — next fix is < 10m from last
    final stopped = calc.processFix(_makeFix(64.13581, -21.9000, 15000));
    expect(stopped, isNotNull);
    expect(stopped!.speedKmh, equals(0),
        reason: 'must report 0 immediately when bus stops, not hold prior speed');
  });

  test('independent buses do not interfere', () {
    calc.processFix(_makeFix(64.135, -21.900, 0, busId: 'bus-A'));
    calc.processFix(_makeFix(64.136, -21.900, 5000, busId: 'bus-A'));

    // bus-B's first fix should return 0, not be influenced by bus-A
    final result =
        calc.processFix(_makeFix(64.140, -21.900, 5000, busId: 'bus-B'));
    expect(result, isNotNull);
    expect(result!.speedKmh, equals(0));
  });
}
