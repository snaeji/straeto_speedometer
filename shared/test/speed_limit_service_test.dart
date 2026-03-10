import 'package:test/test.dart';
import 'package:shared/shared.dart';

Map<String, dynamic> _makeGeoJson(List<Map<String, dynamic>> features) {
  return {
    'type': 'FeatureCollection',
    'features': features,
  };
}

Map<String, dynamic> _makeFeature(
    int id, String name, int speedLimit, List<List<double>> coords) {
  return {
    'type': 'Feature',
    'id': id,
    'geometry': {
      'type': 'LineString',
      'coordinates': coords, // [lng, lat] pairs
    },
    'properties': {
      'OBJECTID': id,
      'NAFN': name,
      'HRADI': speedLimit,
    },
  };
}

void main() {
  late SpeedLimitService service;

  setUp(() {
    service = SpeedLimitService();
    service.loadFromGeoJson(_makeGeoJson([
      // 30 km/h street running east-west at lat 64.135
      _makeFeature(1, 'Street A', 30, [
        [-21.910, 64.135],
        [-21.900, 64.135],
      ]),
      // 50 km/h street running east-west at lat 64.140
      _makeFeature(2, 'Street B', 50, [
        [-21.910, 64.140],
        [-21.900, 64.140],
      ]),
      // 70 km/h street running north-south at lng -21.920
      _makeFeature(3, 'Street C', 70, [
        [-21.920, 64.130],
        [-21.920, 64.145],
      ]),
    ]));
  });

  test('isLoaded returns true after loading', () {
    expect(service.isLoaded, isTrue);
  });

  test('point on 30 km/h segment returns 30', () {
    // Directly on Street A
    final limit = service.getSpeedLimit(64.135, -21.905);
    expect(limit, equals(30.0));
  });

  test('point near 50 km/h segment returns 50', () {
    // ~20m from Street B
    final limit = service.getSpeedLimit(64.14018, -21.905);
    expect(limit, equals(50.0));
  });

  test('point far from any segment returns default 50', () {
    // Far away from all segments
    final limit = service.getSpeedLimit(64.200, -21.800);
    expect(limit, equals(50.0));
  });

  test('nearest segment wins when multiple within range', () {
    // Close to Street A (30), farther from Street C (70)
    final limit = service.getSpeedLimit(64.1351, -21.909);
    expect(limit, equals(30.0));
  });
}
