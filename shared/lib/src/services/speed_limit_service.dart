import '../constants.dart';
import '../models/speed_limit_segment.dart';
import 'geo_utils.dart';

class SpeedLimitService {
  List<SpeedLimitSegment> _segments = [];

  bool get isLoaded => _segments.isNotEmpty;

  /// Load segments from a parsed GeoJSON FeatureCollection.
  void loadFromGeoJson(Map<String, dynamic> geoJson) {
    final features = geoJson['features'] as List<dynamic>;
    _segments = features
        .map((f) => SpeedLimitSegment.fromGeoJsonFeature(
            f as Map<String, dynamic>))
        .toList();
  }

  /// Find the speed limit at a given GPS coordinate.
  /// Returns the HRADI of the nearest segment within 50m,
  /// or 50.0 (default urban) if none found.
  double getSpeedLimit(double lat, double lng) {
    double minDistance = double.infinity;
    int? bestSpeedLimit;

    for (final segment in _segments) {
      final coords = segment.coordinates;
      // Check each sub-segment of the LineString
      for (var i = 0; i < coords.length - 1; i++) {
        // GeoJSON coordinates are [lng, lat]
        final aLng = coords[i][0];
        final aLat = coords[i][1];
        final bLng = coords[i + 1][0];
        final bLat = coords[i + 1][1];

        final dist =
            pointToLineSegmentDistanceM(lat, lng, aLat, aLng, bLat, bLng);

        if (dist < minDistance) {
          minDistance = dist;
          bestSpeedLimit = segment.speedLimitKmh;
        }
      }
    }

    if (minDistance <= maxSpeedLimitSearchDistanceM && bestSpeedLimit != null) {
      return bestSpeedLimit.toDouble();
    }

    return defaultSpeedLimitKmh;
  }
}
