class BusLocation {
  final String busId;
  final String routeNr;
  final String tripId;
  final double lat;
  final double lng;
  final int direction;
  final int timestamp; // Unix epoch milliseconds
  final String? headsign;
  final double? speedKmh;
  final double? speedLimitKmh;
  final bool isViolation;

  const BusLocation({
    required this.busId,
    required this.routeNr,
    required this.tripId,
    required this.lat,
    required this.lng,
    required this.direction,
    required this.timestamp,
    this.headsign,
    this.speedKmh,
    this.speedLimitKmh,
    this.isViolation = false,
  });

  /// Construct from Straeto GraphQL API JSON response.
  factory BusLocation.fromApiJson(Map<String, dynamic> json, int timestamp) {
    return BusLocation(
      busId: json['busId'] as String,
      routeNr: json['routeNr'] as String,
      tripId: json['tripId'] as String,
      lat: (json['lat'] as num).toDouble(),
      lng: (json['lng'] as num).toDouble(),
      direction: json['direction'] as int,
      timestamp: timestamp,
      headsign: json['headsign'] as String?,
    );
  }

  /// Construct from a JSONL record (short keys for compact storage).
  factory BusLocation.fromJsonLine(Map<String, dynamic> json) {
    return BusLocation(
      busId: json['b'] as String,
      routeNr: json['r'] as String,
      tripId: json['t'] as String,
      lat: (json['la'] as num).toDouble(),
      lng: (json['ln'] as num).toDouble(),
      direction: json['d'] as int,
      timestamp: json['ts'] as int,
      headsign: json['h'] as String?,
      speedKmh: (json['s'] as num?)?.toDouble(),
      speedLimitKmh: (json['sl'] as num?)?.toDouble(),
      isViolation: json['v'] as bool? ?? false,
    );
  }

  /// Serialize to compact JSONL format.
  Map<String, dynamic> toJsonLine() {
    final map = <String, dynamic>{
      'b': busId,
      'r': routeNr,
      't': tripId,
      'la': lat,
      'ln': lng,
      'd': direction,
      'ts': timestamp,
    };
    if (headsign != null) map['h'] = headsign;
    if (speedKmh != null) map['s'] = double.parse(speedKmh!.toStringAsFixed(1));
    if (speedLimitKmh != null) map['sl'] = speedLimitKmh!.toInt();
    if (isViolation) map['v'] = true;
    return map;
  }

  BusLocation copyWith({
    double? speedKmh,
    double? speedLimitKmh,
    bool? isViolation,
  }) {
    return BusLocation(
      busId: busId,
      routeNr: routeNr,
      tripId: tripId,
      lat: lat,
      lng: lng,
      direction: direction,
      timestamp: timestamp,
      headsign: headsign,
      speedKmh: speedKmh ?? this.speedKmh,
      speedLimitKmh: speedLimitKmh ?? this.speedLimitKmh,
      isViolation: isViolation ?? this.isViolation,
    );
  }
}
