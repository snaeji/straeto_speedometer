import 'package:flutter/foundation.dart';
import 'package:shared/shared.dart';

enum AppMode { live, playback, stats, heatmap }

class AppState extends ChangeNotifier {
  AppMode _mode = AppMode.live;
  Set<String> _selectedRoutes = {};
  bool _sidebarExpanded = true;
  final Map<String, BusLocation> _busMap = {};
  List<BusLocation> _allData = [];
  String? _selectedBusId;

  /// Max age before a bus is removed from the live list (seconds).
  static const _busStaleThresholdSecs = 30;

  AppMode get mode => _mode;
  bool get sidebarExpanded => _sidebarExpanded;
  String? get selectedBusId => _selectedBusId;

  List<BusLocation> get _busLocations => _busMap.values.toList();

  int get activeBuses => _busMap.length;

  int get currentViolations =>
      filteredLocations.where((b) => b.isViolation).length;

  double get averageSpeed {
    final withSpeed =
        filteredLocations.where((b) => b.speedKmh != null).toList();
    if (withSpeed.isEmpty) return 0;
    return withSpeed.map((b) => b.speedKmh!).reduce((a, b) => a + b) /
        withSpeed.length;
  }

  List<BusLocation> get filteredLocations {
    final all = _busLocations;
    if (_selectedRoutes.isEmpty) return all;
    return all.where((b) => _selectedRoutes.contains(b.routeNr)).toList();
  }

  List<BusLocation> get allData => _allData;
  Set<String> get selectedRoutes => _selectedRoutes;

  Set<String> get availableRoutes =>
      _busLocations.map((b) => b.routeNr).toSet();

  void setMode(AppMode mode) {
    _mode = mode;
    notifyListeners();
  }

  void toggleRoute(String routeNr) {
    if (_selectedRoutes.contains(routeNr)) {
      _selectedRoutes.remove(routeNr);
    } else {
      _selectedRoutes.add(routeNr);
    }
    notifyListeners();
  }

  void selectAllRoutes() {
    _selectedRoutes = {};
    notifyListeners();
  }

  void clearRouteFilter() {
    _selectedRoutes = {};
    notifyListeners();
  }

  void toggleSidebar() {
    _sidebarExpanded = !_sidebarExpanded;
    notifyListeners();
  }

  /// Callback invoked with bus IDs that were removed due to staleness.
  void Function(List<String> staleBusIds)? onBusesRemoved;

  void updateBusLocations(List<BusLocation> locations) {
    // Merge new locations into the map
    for (final loc in locations) {
      _busMap[loc.busId] = loc;
    }

    // Remove buses that haven't been updated for a while (live mode only)
    if (_mode == AppMode.live) {
      final nowMs = DateTime.now().millisecondsSinceEpoch;
      final staleIds = <String>[];
      _busMap.removeWhere((busId, loc) {
        final stale = (nowMs - loc.timestamp) > _busStaleThresholdSecs * 1000;
        if (stale) staleIds.add(busId);
        return stale;
      });

      if (staleIds.isNotEmpty) {
        onBusesRemoved?.call(staleIds);
      }
    }

    notifyListeners();
  }

  /// Replace all bus locations (for playback mode — clears previous frame).
  void setBusLocations(List<BusLocation> locations) {
    _busMap.clear();
    for (final loc in locations) {
      _busMap[loc.busId] = loc;
    }
    notifyListeners();
  }

  void loadAllData(List<BusLocation> data) {
    _allData = data;
    notifyListeners();
  }

  /// Whether the map should follow the selected bus.
  /// Set to true on bus selection, set to false when user pans manually.
  bool _followBus = false;
  bool get followBus => _followBus;

  set followBus(bool value) {
    _followBus = value;
  }

  void selectBus(String? busId) {
    _selectedBusId = busId == _selectedBusId ? null : busId;
    _followBus = _selectedBusId != null;
    notifyListeners();
  }
}
