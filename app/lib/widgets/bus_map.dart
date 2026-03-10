import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:latlong2/latlong.dart';
import 'package:provider/provider.dart';

import '../state/app_state.dart';
import 'bus_marker.dart';
import 'heatmap_layer.dart';

class BusMap extends StatelessWidget {
  const BusMap({super.key});

  @override
  Widget build(BuildContext context) {
    final appState = context.watch<AppState>();
    final locations = appState.filteredLocations;

    return FlutterMap(
      options: const MapOptions(
        initialCenter: LatLng(64.1466, -21.9426),
        initialZoom: 12.0,
        minZoom: 10.0,
        maxZoom: 18.0,
      ),
      children: [
        TileLayer(
          urlTemplate: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
          userAgentPackageName: 'is.straeto.speedometer',
        ),
        if (appState.mode == AppMode.heatmap)
          HeatmapLayer(locations: locations),
        if (appState.mode != AppMode.heatmap)
          MarkerLayer(
            markers: locations
                .map((loc) => Marker(
                      point: LatLng(loc.lat, loc.lng),
                      width: 40,
                      height: 50,
                      child: BusMarkerWidget(location: loc),
                    ))
                .toList(),
          ),
      ],
    );
  }
}
