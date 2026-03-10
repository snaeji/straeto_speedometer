import 'package:fl_chart/fl_chart.dart';
import 'package:flutter/material.dart';

import '../../theme.dart';

class ViolationsChart extends StatelessWidget {
  final List<MapEntry<int, int>> data;
  final String title;

  const ViolationsChart({
    super.key,
    required this.data,
    this.title = 'Violations Over Time',
  });

  @override
  Widget build(BuildContext context) {
    if (data.isEmpty) return const SizedBox.shrink();

    final maxY = data.map((e) => e.value).fold(0, (a, b) => a > b ? a : b);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(title,
            style: const TextStyle(fontSize: 14, fontWeight: FontWeight.bold)),
        const SizedBox(height: 12),
        SizedBox(
          height: 180,
          child: BarChart(
            BarChartData(
              barGroups: data.map((e) {
                return BarChartGroupData(
                  x: e.key,
                  barRods: [
                    BarChartRodData(
                      toY: e.value.toDouble(),
                      width: 10,
                      color: kViolationColor.withValues(alpha: 0.8),
                      borderRadius: const BorderRadius.vertical(
                          top: Radius.circular(2)),
                    ),
                  ],
                );
              }).toList(),
              titlesData: FlTitlesData(
                bottomTitles: AxisTitles(
                  sideTitles: SideTitles(
                    showTitles: true,
                    getTitlesWidget: (value, meta) {
                      return Padding(
                        padding: const EdgeInsets.only(top: 4),
                        child: Text('${value.toInt()}',
                            style: const TextStyle(fontSize: 9)),
                      );
                    },
                  ),
                ),
                leftTitles: AxisTitles(
                  sideTitles: SideTitles(
                    showTitles: true,
                    reservedSize: 36,
                    getTitlesWidget: (value, meta) => Text(
                      '${value.toInt()}',
                      style: const TextStyle(fontSize: 10),
                    ),
                  ),
                ),
                topTitles: const AxisTitles(
                    sideTitles: SideTitles(showTitles: false)),
                rightTitles: const AxisTitles(
                    sideTitles: SideTitles(showTitles: false)),
              ),
              gridData: const FlGridData(show: true, drawVerticalLine: false),
              borderData: FlBorderData(show: false),
              maxY: maxY > 0 ? maxY.toDouble() * 1.1 : 10,
            ),
          ),
        ),
      ],
    );
  }
}
