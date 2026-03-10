import 'package:flutter/material.dart';
import 'package:shared/shared.dart';

import '../theme.dart';

class BusMarkerWidget extends StatelessWidget {
  final BusLocation location;
  final bool isSelected;
  final VoidCallback? onTap;

  const BusMarkerWidget({
    super.key,
    required this.location,
    this.isSelected = false,
    this.onTap,
  });

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

    return GestureDetector(
      onTap: onTap,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (isSelected)
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
              margin: const EdgeInsets.only(bottom: 2),
              decoration: BoxDecoration(
                color: const Color(0xE016213E),
                borderRadius: BorderRadius.circular(6),
                border: Border.all(color: markerColor, width: 1),
                boxShadow: const [
                  BoxShadow(color: Colors.black54, blurRadius: 4),
                ],
              ),
              child: Text(
                '$speedText km/h'
                '${location.speedLimitKmh != null ? " / ${location.speedLimitKmh!.toStringAsFixed(0)}" : ""}',
                style: TextStyle(
                  color: markerColor,
                  fontSize: 10,
                  fontWeight: FontWeight.bold,
                ),
              ),
            ),
          Container(
            width: isSelected ? 34 : 28,
            height: isSelected ? 34 : 28,
            decoration: BoxDecoration(
              color: markerColor,
              shape: BoxShape.circle,
              border: Border.all(
                color: isSelected ? Colors.white : Colors.white,
                width: isSelected ? 2.5 : 1.5,
              ),
              boxShadow: [
                BoxShadow(
                  color: isSelected ? markerColor.withValues(alpha: 0.5) : Colors.black38,
                  blurRadius: isSelected ? 8 : 3,
                ),
              ],
            ),
            alignment: Alignment.center,
            child: Text(
              location.routeNr,
              style: TextStyle(
                color: Colors.white,
                fontSize: isSelected ? 12 : 10,
                fontWeight: FontWeight.bold,
              ),
            ),
          ),
          if (!isSelected)
            Text(
              speedText,
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
