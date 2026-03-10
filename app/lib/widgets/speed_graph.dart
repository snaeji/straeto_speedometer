import 'dart:async';

import 'package:fl_chart/fl_chart.dart';
import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';
import 'package:shared/shared.dart';

import '../services/storage_service.dart';
import '../state/app_state.dart';
import '../theme.dart';

class SpeedGraph extends StatefulWidget {
  const SpeedGraph({super.key});

  @override
  State<SpeedGraph> createState() => _SpeedGraphState();
}

class _SpeedGraphState extends State<SpeedGraph> {
  List<BusLocation> _history = [];
  Timer? _refreshTimer;
  String? _loadedBusId;

  @override
  void dispose() {
    _refreshTimer?.cancel();
    super.dispose();
  }

  Future<void> _loadHistory(String busId) async {
    final storage = context.read<StorageService>();
    final history = await storage.getBusHistory(busId);
    if (mounted) {
      setState(() {
        _history = history..sort((a, b) => a.timestamp.compareTo(b.timestamp));
        _loadedBusId = busId;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final appState = context.watch<AppState>();
    final busId = appState.selectedBusId;

    if (busId == null) return const SizedBox.shrink();

    // Load history when bus changes, and set up periodic refresh
    if (_loadedBusId != busId) {
      _loadHistory(busId);
      _refreshTimer?.cancel();
      _refreshTimer = Timer.periodic(
        const Duration(seconds: 5),
        (_) => _loadHistory(busId),
      );
    }

    // Also include current live data point if available
    final currentBus = appState.filteredLocations
        .where((b) => b.busId == busId)
        .toList();

    final allPoints = [..._history];
    if (currentBus.isNotEmpty) {
      final live = currentBus.first;
      if (allPoints.isEmpty ||
          allPoints.last.timestamp != live.timestamp) {
        allPoints.add(live);
      }
    }

    if (allPoints.isEmpty) {
      return _buildContainer(
        busId,
        const Center(
          child: Text('No history yet', style: TextStyle(color: Colors.white38)),
        ),
      );
    }

    return _buildContainer(busId, _buildChart(allPoints));
  }

  Widget _buildContainer(String busId, Widget child) {
    final appState = context.read<AppState>();
    // Find bus info for header
    final currentBus = appState.filteredLocations
        .where((b) => b.busId == busId)
        .toList();
    final routeNr = currentBus.isNotEmpty ? currentBus.first.routeNr : '?';
    final headsign = currentBus.isNotEmpty ? currentBus.first.headsign : null;

    return Container(
      height: 180,
      decoration: BoxDecoration(
        color: const Color(0xFF16213E),
        border: const Border(top: BorderSide(color: Colors.white12)),
      ),
      child: Column(
        children: [
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
            child: Row(
              children: [
                Text(
                  'Route $routeNr - $busId',
                  style: const TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.bold,
                    color: Colors.white70,
                  ),
                ),
                if (headsign != null)
                  Text(
                    '  $headsign',
                    style: const TextStyle(fontSize: 11, color: Colors.white38),
                  ),
                const Spacer(),
                InkWell(
                  onTap: () => appState.selectBus(null),
                  child: const Icon(Icons.close, size: 16, color: Colors.white38),
                ),
              ],
            ),
          ),
          Expanded(
            child: Padding(
              padding: const EdgeInsets.only(left: 8, right: 16, bottom: 8),
              child: child,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildChart(List<BusLocation> points) {
    final timeFormat = DateFormat('HH:mm:ss');

    // Build speed and speed limit spots
    final speedSpots = <FlSpot>[];
    final limitSpots = <FlSpot>[];

    final startTime = points.first.timestamp.toDouble();

    for (final p in points) {
      final x = (p.timestamp - startTime) / 1000.0; // seconds from start
      if (p.speedKmh != null) {
        speedSpots.add(FlSpot(x, p.speedKmh!));
      }
      if (p.speedLimitKmh != null) {
        limitSpots.add(FlSpot(x, p.speedLimitKmh!));
      }
    }

    if (speedSpots.isEmpty) {
      return const Center(
        child: Text('No speed data', style: TextStyle(color: Colors.white38)),
      );
    }

    // Calculate maxY
    double maxY = 0;
    for (final s in speedSpots) {
      if (s.y > maxY) maxY = s.y;
    }
    for (final s in limitSpots) {
      if (s.y > maxY) maxY = s.y;
    }
    maxY = ((maxY / 10).ceil() * 10 + 10).toDouble();

    return LineChart(
      LineChartData(
        minY: 0,
        maxY: maxY,
        clipData: const FlClipData.all(),
        gridData: FlGridData(
          show: true,
          drawVerticalLine: false,
          horizontalInterval: 10,
          getDrawingHorizontalLine: (value) => FlLine(
            color: Colors.white10,
            strokeWidth: 0.5,
          ),
        ),
        titlesData: FlTitlesData(
          topTitles: const AxisTitles(sideTitles: SideTitles(showTitles: false)),
          rightTitles: const AxisTitles(sideTitles: SideTitles(showTitles: false)),
          leftTitles: AxisTitles(
            sideTitles: SideTitles(
              showTitles: true,
              reservedSize: 32,
              interval: 20,
              getTitlesWidget: (value, meta) => Text(
                '${value.toInt()}',
                style: const TextStyle(fontSize: 9, color: Colors.white38),
              ),
            ),
          ),
          bottomTitles: AxisTitles(
            sideTitles: SideTitles(
              showTitles: true,
              reservedSize: 20,
              interval: _getTimeInterval(speedSpots),
              getTitlesWidget: (value, meta) {
                final ts = startTime + value * 1000;
                final dt = DateTime.fromMillisecondsSinceEpoch(ts.toInt());
                return Text(
                  timeFormat.format(dt),
                  style: const TextStyle(fontSize: 8, color: Colors.white38),
                );
              },
            ),
          ),
        ),
        borderData: FlBorderData(show: false),
        lineTouchData: LineTouchData(
          touchTooltipData: LineTouchTooltipData(
            getTooltipItems: (spots) => spots.map((spot) {
              final label = spot.barIndex == 0 ? 'Speed' : 'Limit';
              return LineTooltipItem(
                '$label: ${spot.y.toStringAsFixed(0)} km/h',
                TextStyle(
                  color: spot.barIndex == 0
                      ? const Color(0xFF4FC3F7)
                      : kApproachingColor,
                  fontSize: 11,
                ),
              );
            }).toList(),
          ),
        ),
        lineBarsData: [
          // Speed line
          LineChartBarData(
            spots: speedSpots,
            isCurved: true,
            curveSmoothness: 0.2,
            color: const Color(0xFF4FC3F7),
            barWidth: 2,
            dotData: const FlDotData(show: false),
            belowBarData: BarAreaData(
              show: true,
              color: const Color(0xFF4FC3F7).withValues(alpha: 0.1),
            ),
          ),
          // Speed limit line
          if (limitSpots.isNotEmpty)
            LineChartBarData(
              spots: limitSpots,
              isCurved: false,
              color: kApproachingColor,
              barWidth: 1.5,
              dashArray: [6, 4],
              dotData: const FlDotData(show: false),
            ),
        ],
      ),
    );
  }

  double _getTimeInterval(List<FlSpot> spots) {
    if (spots.length < 2) return 60;
    final range = spots.last.x - spots.first.x;
    if (range < 120) return 30;
    if (range < 300) return 60;
    if (range < 900) return 120;
    return 300;
  }
}
