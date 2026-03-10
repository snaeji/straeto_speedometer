import 'package:flutter/material.dart';
import 'package:shared/shared.dart';

import '../theme.dart';

class BusMarkerWidget extends StatelessWidget {
  final BusLocation location;

  const BusMarkerWidget({super.key, required this.location});

  Color get markerColor {
    if (location.speedKmh == null) return kNoDataColor;
    if (location.isViolation) return kViolationColor;
    if (location.speedLimitKmh != null &&
        location.speedKmh! > location.speedLimitKmh! * 0.8) {
      return kApproachingColor;
    }
    return kNormalColor;
  }

  @override
  Widget build(BuildContext context) {
    final speedText = location.speedKmh != null
        ? '${location.speedKmh!.toStringAsFixed(0)}'
        : '?';

    return Tooltip(
      message:
          'Bus ${location.busId}\n'
          'Route ${location.routeNr}'
          '${location.headsign != null ? " → ${location.headsign}" : ""}\n'
          'Speed: $speedText km/h'
          '${location.speedLimitKmh != null ? " / Limit: ${location.speedLimitKmh!.toStringAsFixed(0)}" : ""}',
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            width: 28,
            height: 28,
            decoration: BoxDecoration(
              color: markerColor,
              shape: BoxShape.circle,
              border: Border.all(color: Colors.white, width: 1.5),
              boxShadow: const [
                BoxShadow(color: Colors.black38, blurRadius: 3),
              ],
            ),
            alignment: Alignment.center,
            child: Text(
              location.routeNr,
              style: const TextStyle(
                color: Colors.white,
                fontSize: 10,
                fontWeight: FontWeight.bold,
              ),
            ),
          ),
          Text(
            '$speedText',
            style: TextStyle(
              color: markerColor,
              fontSize: 9,
              fontWeight: FontWeight.bold,
            ),
          ),
        ],
      ),
    );
  }
}
