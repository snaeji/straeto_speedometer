class SpeedLimitSegment {
  final int objectId;
  final String? name;
  final int speedLimitKmh;
  final List<List<double>> coordinates; // [[lng, lat], ...] GeoJSON order

  const SpeedLimitSegment({
    required this.objectId,
    this.name,
    required this.speedLimitKmh,
    required this.coordinates,
  });

  factory SpeedLimitSegment.fromGeoJsonFeature(Map<String, dynamic> feature) {
    final props = feature['properties'] as Map<String, dynamic>;
    final geometry = feature['geometry'] as Map<String, dynamic>;
    final type = geometry['type'] as String;
    final rawCoords = geometry['coordinates'] as List;

    // MultiLineString has an extra nesting level: [[[lng,lat],...],...]
    // Flatten to a single list of [lng,lat] pairs.
    List<List<double>> coords;
    if (type == 'MultiLineString') {
      coords = <List<double>>[];
      for (final lineString in rawCoords) {
        for (final point in lineString as List) {
          coords.add(
              (point as List).map((v) => (v as num).toDouble()).toList());
        }
      }
    } else {
      coords = rawCoords
          .map((c) =>
              (c as List).map((v) => (v as num).toDouble()).toList())
          .toList();
    }

    return SpeedLimitSegment(
      objectId: (props['OBJECTID'] ?? feature['id']) as int,
      name: props['NAFN'] as String?,
      speedLimitKmh: props['HRADI'] as int,
      coordinates: coords,
    );
  }
}
