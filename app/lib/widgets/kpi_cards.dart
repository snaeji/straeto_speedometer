import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../state/app_state.dart';
import '../theme.dart';

class KpiCards extends StatelessWidget {
  const KpiCards({super.key});

  @override
  Widget build(BuildContext context) {
    final appState = context.watch<AppState>();

    return Row(
      children: [
        _KpiCard(
          icon: Icons.directions_bus,
          label: 'Active',
          value: '${appState.activeBuses}',
        ),
        const SizedBox(width: 12),
        _KpiCard(
          icon: Icons.warning,
          label: 'Violations',
          value: '${appState.currentViolations}',
          valueColor: appState.currentViolations > 0 ? kViolationColor : null,
        ),
        const SizedBox(width: 12),
        _KpiCard(
          icon: Icons.speed,
          label: 'Avg Speed',
          value: '${appState.averageSpeed.toStringAsFixed(0)} km/h',
        ),
      ],
    );
  }
}

class _KpiCard extends StatelessWidget {
  final IconData icon;
  final String label;
  final String value;
  final Color? valueColor;

  const _KpiCard({
    required this.icon,
    required this.label,
    required this.value,
    this.valueColor,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
      decoration: BoxDecoration(
        color: Theme.of(context).colorScheme.surface.withValues(alpha: 0.5),
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: Colors.white12),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 16, color: Colors.white54),
          const SizedBox(width: 6),
          Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(label,
                  style: const TextStyle(fontSize: 10, color: Colors.white54)),
              Text(value,
                  style: TextStyle(
                    fontSize: 14,
                    fontWeight: FontWeight.bold,
                    color: valueColor ?? Colors.white,
                  )),
            ],
          ),
        ],
      ),
    );
  }
}
