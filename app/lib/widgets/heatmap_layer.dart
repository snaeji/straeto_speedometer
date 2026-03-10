import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:latlong2/latlong.dart';
import 'package:shared/shared.dart';

class HeatmapLayer extends StatelessWidget {
  final List<BusLocation> locations;

  const HeatmapLayer({super.key, required this.locations});

  @override
  Widget build(BuildContext context) {
    final violations = locations.where((l) => l.isViolation).toList();

    return CircleLayer(
      circles: violations
          .map((loc) => CircleMarker(
                point: LatLng(loc.lat, loc.lng),
                radius: 80,
                useRadiusInMeter: true,
                color: Colors.red.withValues(alpha: 0.3),
                borderStrokeWidth: 0,
              ))
          .toList(),
    );
  }
}
