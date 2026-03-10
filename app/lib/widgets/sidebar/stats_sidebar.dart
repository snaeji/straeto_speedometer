import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../state/stats_state.dart';
import '../stats/route_stats_chart.dart';
import '../stats/speed_chart.dart';
import '../stats/violations_chart.dart';

class StatsSidebar extends StatefulWidget {
  const StatsSidebar({super.key});

  @override
  State<StatsSidebar> createState() => _StatsSidebarState();
}

class _StatsSidebarState extends State<StatsSidebar> {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      context.read<StatsState>().computeStats();
    });
  }

  @override
  Widget build(BuildContext context) {
    final statsState = context.watch<StatsState>();

    if (statsState.isLoading) {
      return const Center(child: CircularProgressIndicator());
    }

    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        Text('Fleet Statistics',
            style: Theme.of(context).textTheme.titleLarge),
        const SizedBox(height: 16),
        Row(
          children: [
            _SummaryCard('Buses Tracked', '${statsState.totalBusesTracked}'),
            const SizedBox(width: 8),
            _SummaryCard('Distance', '${statsState.totalDistanceKm} km'),
          ],
        ),
        const SizedBox(height: 24),
        if (statsState.topSpeedingRoutes.isNotEmpty) ...[
          RouteStatsChart(data: statsState.topSpeedingRoutes),
          const SizedBox(height: 24),
        ],
        if (statsState.violationsOverTime.isNotEmpty) ...[
          ViolationsChart(data: statsState.violationsOverTime),
          const SizedBox(height: 24),
        ],
        if (statsState.avgSpeedByRoute.isNotEmpty) ...[
          SpeedChart(data: statsState.avgSpeedByRoute),
          const SizedBox(height: 24),
        ],
        if (statsState.violationsByHour.isNotEmpty)
          ViolationsChart(
            data: statsState.violationsByHour,
            title: 'Violations by Hour',
          ),
      ],
    );
  }
}

class _SummaryCard extends StatelessWidget {
  final String label;
  final String value;
  const _SummaryCard(this.label, this.value);

  @override
  Widget build(BuildContext context) {
    return Expanded(
      child: Card(
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Column(
            children: [
              Text(value,
                  style: const TextStyle(
                      fontSize: 20, fontWeight: FontWeight.bold)),
              const SizedBox(height: 4),
              Text(label,
                  style:
                      const TextStyle(fontSize: 11, color: Colors.white54)),
            ],
          ),
        ),
      ),
    );
  }
}
