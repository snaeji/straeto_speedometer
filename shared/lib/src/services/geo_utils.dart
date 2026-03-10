import 'dart:math';

import '../constants.dart';

const _earthRadiusM = 6371000.0;

/// Haversine distance in meters between two WGS84 coordinates.
double haversineDistanceM(
  double lat1,
  double lng1,
  double lat2,
  double lng2,
) {
  final dLat = _toRad(lat2 - lat1);
  final dLng = _toRad(lng2 - lng1);
  final a = sin(dLat / 2) * sin(dLat / 2) +
      cos(_toRad(lat1)) * cos(_toRad(lat2)) * sin(dLng / 2) * sin(dLng / 2);
  final c = 2 * atan2(sqrt(a), sqrt(1 - a));
  return _earthRadiusM * c;
}

/// Minimum distance in meters from point (pLat, pLng) to the line segment
/// from (aLat, aLng) to (bLat, bLng).
///
/// Uses flat-Earth approximation with Reykjavik-specific degree-to-km
/// conversions for the projection (sufficient for distances <50m), then
/// Haversine for the final distance to the closest point.
double pointToLineSegmentDistanceM(
  double pLat,
  double pLng,
  double aLat,
  double aLng,
  double bLat,
  double bLng,
) {
  // Convert to flat km coordinates for projection math
  final pX = pLng * reykjavikLngDegToKm;
  final pY = pLat * reykjavikLatDegToKm;
  final aX = aLng * reykjavikLngDegToKm;
  final aY = aLat * reykjavikLatDegToKm;
  final bX = bLng * reykjavikLngDegToKm;
  final bY = bLat * reykjavikLatDegToKm;

  final dx = bX - aX;
  final dy = bY - aY;
  final lenSq = dx * dx + dy * dy;

  double closestLat, closestLng;

  if (lenSq == 0) {
    // Segment is a single point
    closestLat = aLat;
    closestLng = aLng;
  } else {
    // Project point onto the line, clamped to [0, 1]
    var t = ((pX - aX) * dx + (pY - aY) * dy) / lenSq;
    t = t.clamp(0.0, 1.0);
    closestLat = aLat + t * (bLat - aLat);
    closestLng = aLng + t * (bLng - aLng);
  }

  return haversineDistanceM(pLat, pLng, closestLat, closestLng);
}

/// Convert distance in meters and time delta in seconds to speed in km/h.
double speedKmh(double distanceM, double timeDeltaS) {
  if (timeDeltaS <= 0) return 0;
  return (distanceM / 1000) / (timeDeltaS / 3600);
}

double _toRad(double deg) => deg * pi / 180;
