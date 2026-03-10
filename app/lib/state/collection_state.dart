import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:shared/shared.dart';

import '../services/collection_service.dart';
import '../services/storage_service.dart';
import 'app_state.dart';

class CollectionState extends ChangeNotifier {
  bool _isCollecting = false;
  Timer? _pollTimer;

  late CollectionService _collectionService;
  late StorageService _storageService;
  late AppState _appState;

  int recordsCollected = 0;
  int violations = 0;
  DateTime? collectionStartTime;

  bool get isCollecting => _isCollecting;

  void initialize({
    required SpeedLimitService speedLimitService,
    required StorageService storageService,
    required AppState appState,
  }) {
    _storageService = storageService;
    _appState = appState;
    _collectionService = CollectionService(
      api: StraetoApi(),
      speedCalculator: SpeedCalculator(),
      speedLimitService: speedLimitService,
    );

    // Clean up speed calculator state when buses go stale
    _appState.onBusesRemoved = (staleBusIds) {
      for (final busId in staleBusIds) {
        _collectionService.resetBus(busId);
      }
    };
  }

  Future<void> startCollecting() async {
    if (_isCollecting) return;
    _isCollecting = true;
    collectionStartTime = DateTime.now();
    notifyListeners();

    _pollTimer = Timer.periodic(
      const Duration(milliseconds: pollingIntervalMs),
      (_) => _pollOnce(),
    );
    // Also poll immediately
    await _pollOnce();
  }

  void stopCollecting() {
    _pollTimer?.cancel();
    _pollTimer = null;
    _isCollecting = false;
    notifyListeners();
  }

  Future<void> _pollOnce() async {
    try {
      final locations = await _collectionService.collectOnce();
      if (locations.isEmpty) return;

      // Store in IndexedDB
      await _storageService.storeBatch(locations);

      recordsCollected += locations.length;
      violations += locations.where((l) => l.isViolation).length;

      // Update map display
      _appState.updateBusLocations(locations);
      notifyListeners();
    } catch (e) {
      debugPrint('Poll error: $e');
    }
  }

  /// Single poll without storing (for live preview without collecting)
  Future<void> pollLivePreview() async {
    try {
      final locations = await _collectionService.collectOnce();
      if (locations.isNotEmpty) {
        _appState.updateBusLocations(locations);
      }
    } catch (e) {
      debugPrint('Live preview error: $e');
    }
  }

  @override
  void dispose() {
    _pollTimer?.cancel();
    super.dispose();
  }
}
