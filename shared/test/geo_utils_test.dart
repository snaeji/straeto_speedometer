import 'package:test/test.dart';
import 'package:shared/shared.dart';

void main() {
  group('haversineDistanceM', () {
    test('Hallgrimskirkja to Harpa is ~1.2km', () {
      // Hallgrimskirkja: 64.1418, -21.9268
      // Harpa: 64.1505, -21.9330
      final dist = haversineDistanceM(64.1418, -21.9268, 64.1505, -21.9330);
      expect(dist, closeTo(1000, 300)); // ~1.0km ± 300m
    });

    test('same point returns 0', () {
      final dist = haversineDistanceM(64.1466, -21.9426, 64.1466, -21.9426);
      expect(dist, equals(0.0));
    });

    test('antipodal points return ~20000km', () {
      final dist = haversineDistanceM(0, 0, 0, 180);
      expect(dist / 1000, closeTo(20015, 20)); // half Earth circumference
    });
  });

  group('pointToLineSegmentDistanceM', () {
    test('point on the line returns ~0', () {
      // Midpoint of a segment
      final dist = pointToLineSegmentDistanceM(
        64.135, -21.844, // point (midpoint)
        64.134, -21.845, // segment start
        64.136, -21.843, // segment end
      );
      expect(dist, lessThan(50)); // should be very close
    });

    test('point perpendicular to midpoint', () {
      // Straight horizontal line, point above
      final dist = pointToLineSegmentDistanceM(
        64.136, -21.900, // point above
        64.135, -21.901, // segment start
        64.135, -21.899, // segment end
      );
      // ~111m per degree lat
      expect(dist, closeTo(111, 20));
    });

    test('point closest to endpoint (clamping)', () {
      // Point far to the right of the segment
      final dist = pointToLineSegmentDistanceM(
        64.135, -21.890, // point far right
        64.135, -21.900, // segment start
        64.135, -21.898, // segment end
      );
      // Should be distance to segment end (-21.898), not perpendicular
      final expected = haversineDistanceM(64.135, -21.890, 64.135, -21.898);
      expect(dist, closeTo(expected, 5));
    });
  });

  group('speedKmh', () {
    test('1000m in 60s = 60 km/h', () {
      expect(speedKmh(1000, 60), equals(60.0));
    });

    test('0 time delta returns 0', () {
      expect(speedKmh(100, 0), equals(0.0));
    });
  });
}
