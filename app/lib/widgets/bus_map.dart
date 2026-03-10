import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:latlong2/latlong.dart';
import 'package:provider/provider.dart';

import '../state/app_state.dart';
import 'bus_marker.dart';
import 'heatmap_layer.dart';

class BusMap extends StatefulWidget {
  const BusMap({super.key});

  @override
  State<BusMap> createState() => _BusMapState();
}

class _BusMapState extends State<BusMap> {
  final _mapController = MapController();

  @override
  void dispose() {
    _mapController.dispose();
    super.dispose();
  }

  void _moveToBus(AppState appState) {
    final busId = appState.selectedBusId;
    if (busId == null) return;

    final bus = appState.filteredLocations
        .where((b) => b.busId == busId)
        .toList();
    if (bus.isEmpty) return;

    final target = LatLng(bus.first.lat, bus.first.lng);
    final currentZoom = _mapController.camera.zoom;
    final followZoom = currentZoom < 14 ? 14.0 : currentZoom;

    _mapController.move(target, followZoom);
  }

  @override
  Widget build(BuildContext context) {
    final appState = context.watch<AppState>();
    final locations = appState.filteredLocations;
    final selectedBusId = appState.selectedBusId;

    // Move to bus when following is active
    if (appState.followBus && selectedBusId != null) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        _moveToBus(appState);
      });
    }

    return FlutterMap(
      mapController: _mapController,
      options: MapOptions(
        initialCenter: const LatLng(64.1466, -21.9426),
        initialZoom: 12.0,
        minZoom: 10.0,
        maxZoom: 18.0,
        onPositionChanged: (position, hasGesture) {
          if (hasGesture) {
            appState.followBus = false;
          }
        },
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
                .map((loc) {
                  final isSelected = loc.busId == selectedBusId;
                  return Marker(
                    point: LatLng(loc.lat, loc.lng),
                    width: isSelected ? 120 : 40,
                    height: isSelected ? 80 : 50,
                    child: BusMarkerWidget(
                      location: loc,
                      isSelected: isSelected,
                      onTap: () => appState.selectBus(loc.busId),
                    ),
                  );
                })
                .toList(),
          ),
      ],
    );
  }
}
