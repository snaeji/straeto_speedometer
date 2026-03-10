import 'package:fl_chart/fl_chart.dart';
import 'package:flutter/material.dart';

import '../../theme.dart';

class RouteStatsChart extends StatelessWidget {
  final List<MapEntry<String, int>> data;

  const RouteStatsChart({super.key, required this.data});

  @override
  Widget build(BuildContext context) {
    if (data.isEmpty) return const SizedBox.shrink();

    final top = data.take(10).toList();
    final maxX = top.map((e) => e.value).fold(0, (a, b) => a > b ? a : b);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Text('Top Speeding Routes',
            style: TextStyle(fontSize: 14, fontWeight: FontWeight.bold)),
        const SizedBox(height: 12),
        SizedBox(
          height: top.length * 32.0 + 20,
          child: BarChart(
            BarChartData(
              barGroups: top.asMap().entries.map((e) {
                return BarChartGroupData(
                  x: e.key,
                  barRods: [
                    BarChartRodData(
                      toY: e.value.value.toDouble(),
                      width: 16,
                      color: kViolationColor,
                      borderRadius: const BorderRadius.horizontal(
                          right: Radius.circular(3)),
                    ),
                  ],
                );
              }).toList(),
              titlesData: FlTitlesData(
                leftTitles: AxisTitles(
                  sideTitles: SideTitles(
                    showTitles: true,
                    reservedSize: 50,
                    getTitlesWidget: (value, meta) {
                      final idx = value.toInt();
                      if (idx >= 0 && idx < top.length) {
                        return Text('Route ${top[idx].key}',
                            style: const TextStyle(fontSize: 10));
                      }
                      return const SizedBox.shrink();
                    },
                  ),
                ),
                bottomTitles: AxisTitles(
                  sideTitles: SideTitles(
                    showTitles: true,
                    getTitlesWidget: (value, meta) => Text(
                      '${value.toInt()}',
                      style: const TextStyle(fontSize: 9),
                    ),
                  ),
                ),
                topTitles: const AxisTitles(
                    sideTitles: SideTitles(showTitles: false)),
                rightTitles: const AxisTitles(
                    sideTitles: SideTitles(showTitles: false)),
              ),
              gridData: const FlGridData(show: true, drawHorizontalLine: false),
              borderData: FlBorderData(show: false),
              maxY: maxX > 0 ? maxX.toDouble() * 1.1 : 10,
            ),
            duration: Duration.zero,
          ),
        ),
      ],
    );
  }
}
