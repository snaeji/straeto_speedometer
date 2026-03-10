import 'dart:async';

import 'package:flutter/foundation.dart';

import '../services/storage_service.dart';
import 'app_state.dart';

class PlaybackState extends ChangeNotifier {
  bool _isPlaying = false;
  double _playbackSpeed = 1.0;
  int? _currentTimestamp;
  int? _startTimestamp;
  int? _endTimestamp;
  Timer? _playTimer;

  late StorageService _storageService;
  late AppState _appState;

  bool get isPlaying => _isPlaying;
  double get playbackSpeed => _playbackSpeed;
  int? get currentTimestamp => _currentTimestamp;
  int? get startTimestamp => _startTimestamp;
  int? get endTimestamp => _endTimestamp;

  bool get hasData => _startTimestamp != null && _endTimestamp != null;

  double get progress {
    if (_startTimestamp == null || _endTimestamp == null || _currentTimestamp == null) {
      return 0;
    }
    final range = _endTimestamp! - _startTimestamp!;
    if (range <= 0) return 0;
    return ((_currentTimestamp! - _startTimestamp!) / range).clamp(0.0, 1.0);
  }

  void initialize({
    required StorageService storageService,
    required AppState appState,
  }) {
    _storageService = storageService;
    _appState = appState;
  }

  Future<void> loadDataRange() async {
    final (earliest, latest) = await _storageService.getTimeRange();
    _startTimestamp = earliest;
    _endTimestamp = latest;
    _currentTimestamp = earliest;
    notifyListeners();
  }

  Future<void> seekTo(int timestamp) async {
    _currentTimestamp = timestamp;
    await _loadCurrentFrame();
    notifyListeners();
  }

  void play() {
    if (!hasData) return;
    _isPlaying = true;
    notifyListeners();

    _playTimer = Timer.periodic(const Duration(milliseconds: 500), (_) async {
      if (_currentTimestamp == null || _endTimestamp == null) return;

      final step = (2000 * _playbackSpeed).toInt();
      _currentTimestamp = _currentTimestamp! + step;

      if (_currentTimestamp! >= _endTimestamp!) {
        _currentTimestamp = _endTimestamp;
        pause();
        return;
      }

      await _loadCurrentFrame();
      notifyListeners();
    });
  }

  void pause() {
    _playTimer?.cancel();
    _playTimer = null;
    _isPlaying = false;
    notifyListeners();
  }

  void setSpeed(double speed) {
    _playbackSpeed = speed;
    notifyListeners();
  }

  void stepForward() {
    if (_currentTimestamp == null || _endTimestamp == null) return;
    _currentTimestamp = (_currentTimestamp! + 5000).clamp(_startTimestamp!, _endTimestamp!);
    _loadCurrentFrame();
    notifyListeners();
  }

  void stepBackward() {
    if (_currentTimestamp == null || _startTimestamp == null) return;
    _currentTimestamp = (_currentTimestamp! - 5000).clamp(_startTimestamp!, _endTimestamp!);
    _loadCurrentFrame();
    notifyListeners();
  }

  Future<void> _loadCurrentFrame() async {
    if (_currentTimestamp == null) return;
    final locations = await _storageService.getLocationsInRange(
      _currentTimestamp! - 5000,
      _currentTimestamp! + 5000,
    );
    _appState.updateBusLocations(locations);
  }

  @override
  void dispose() {
    _playTimer?.cancel();
    super.dispose();
  }
}
