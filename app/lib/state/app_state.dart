import 'package:flutter/foundation.dart';
import 'package:shared/shared.dart';

enum AppMode { live, playback, stats, heatmap }

class AppState extends ChangeNotifier {
  AppMode _mode = AppMode.live;
  Set<String> _selectedRoutes = {};
  bool _sidebarExpanded = true;
  List<BusLocation> _busLocations = [];
  List<BusLocation> _allData = [];

  AppMode get mode => _mode;
  bool get sidebarExpanded => _sidebarExpanded;

  int get activeBuses => _busLocations
      .map((b) => b.busId)
      .toSet()
      .length;

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
    if (_selectedRoutes.isEmpty) return _busLocations;
    return _busLocations
        .where((b) => _selectedRoutes.contains(b.routeNr))
        .toList();
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

  void updateBusLocations(List<BusLocation> locations) {
    _busLocations = locations;
    notifyListeners();
  }

  void loadAllData(List<BusLocation> data) {
    _allData = data;
    notifyListeners();
  }
}
