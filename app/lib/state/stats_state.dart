import 'package:flutter/foundation.dart';

import '../services/storage_service.dart';

class StatsState extends ChangeNotifier {
  bool _isLoading = false;

  List<MapEntry<String, int>> topSpeedingBuses = [];
  List<MapEntry<String, int>> topSpeedingRoutes = [];
  List<MapEntry<int, int>> violationsOverTime = [];
  Map<String, double> avgSpeedByRoute = {};
  List<MapEntry<int, int>> violationsByHour = [];
  int totalDistanceKm = 0;
  int totalBusesTracked = 0;

  late StorageService _storageService;

  bool get isLoading => _isLoading;

  void initialize({required StorageService storageService}) {
    _storageService = storageService;
  }

  Future<void> computeStats() async {
    _isLoading = true;
    notifyListeners();

    final busViolations = <String, int>{};
    final routeViolations = <String, int>{};
    final hourViolations = <int, int>{};
    final routeSpeedSum = <String, double>{};
    final routeSpeedCount = <String, int>{};
    final busIds = <String>{};
    var totalDist = 0.0;

    await for (final chunk in _storageService.getAllLocationsStream()) {
      for (final loc in chunk) {
        busIds.add(loc.busId);

        if (loc.isViolation) {
          busViolations[loc.busId] = (busViolations[loc.busId] ?? 0) + 1;
          routeViolations[loc.routeNr] =
              (routeViolations[loc.routeNr] ?? 0) + 1;
          final hour = DateTime.fromMillisecondsSinceEpoch(loc.timestamp,
                  isUtc: true)
              .hour;
          hourViolations[hour] = (hourViolations[hour] ?? 0) + 1;
        }

        if (loc.speedKmh != null && loc.speedKmh! > 0) {
          routeSpeedSum[loc.routeNr] =
              (routeSpeedSum[loc.routeNr] ?? 0) + loc.speedKmh!;
          routeSpeedCount[loc.routeNr] =
              (routeSpeedCount[loc.routeNr] ?? 0) + 1;
          // Approximate distance: speed(km/h) * 2s / 3600
          totalDist += loc.speedKmh! * 2 / 3600;
        }
      }
    }

    topSpeedingBuses = busViolations.entries.toList()
      ..sort((a, b) => b.value.compareTo(a.value));
    if (topSpeedingBuses.length > 10) {
      topSpeedingBuses = topSpeedingBuses.sublist(0, 10);
    }

    topSpeedingRoutes = routeViolations.entries.toList()
      ..sort((a, b) => b.value.compareTo(a.value));

    violationsByHour = List.generate(24, (h) => MapEntry(h, hourViolations[h] ?? 0));

    avgSpeedByRoute = {};
    for (final route in routeSpeedSum.keys) {
      avgSpeedByRoute[route] =
          routeSpeedSum[route]! / routeSpeedCount[route]!;
    }

    totalDistanceKm = totalDist.round();
    totalBusesTracked = busIds.length;

    // Use violationsOverTime as hourly data too
    violationsOverTime = violationsByHour;

    _isLoading = false;
    notifyListeners();
  }
}
