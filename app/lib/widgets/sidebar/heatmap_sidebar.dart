import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../state/app_state.dart';
import '../../theme.dart';

class HeatmapSidebar extends StatelessWidget {
  const HeatmapSidebar({super.key});

  @override
  Widget build(BuildContext context) {
    final appState = context.watch<AppState>();
    final violationCount =
        appState.filteredLocations.where((l) => l.isViolation).length;

    return Padding(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text('Heatmap', style: Theme.of(context).textTheme.titleLarge),
          const SizedBox(height: 16),
          const Text('Violation Density',
              style: TextStyle(fontSize: 13, color: Colors.white54)),
          const SizedBox(height: 12),
          // Legend
          Container(
            height: 20,
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(4),
              gradient: LinearGradient(
                colors: [
                  Colors.yellow.withValues(alpha: 0.4),
                  Colors.orange.withValues(alpha: 0.6),
                  kViolationColor.withValues(alpha: 0.8),
                ],
              ),
            ),
          ),
          const SizedBox(height: 4),
          const Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text('Low', style: TextStyle(fontSize: 10, color: Colors.white38)),
              Text('High', style: TextStyle(fontSize: 10, color: Colors.white38)),
            ],
          ),
          const SizedBox(height: 24),
          Card(
            child: Padding(
              padding: const EdgeInsets.all(12),
              child: Column(
                children: [
                  Text(
                    '$violationCount',
                    style: const TextStyle(
                      fontSize: 28,
                      fontWeight: FontWeight.bold,
                      color: kViolationColor,
                    ),
                  ),
                  const Text('Violations',
                      style: TextStyle(fontSize: 12, color: Colors.white54)),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}
