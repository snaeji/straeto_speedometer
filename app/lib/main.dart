import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';
import 'package:shared/shared.dart';

import 'app.dart';
import 'services/storage_service.dart';
import 'state/app_state.dart';
import 'state/collection_state.dart';
import 'state/playback_state.dart';
import 'state/stats_state.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();

  // Open IndexedDB
  final storageService = StorageService();
  await storageService.open();

  // Load speed limit data from bundled asset
  final geoJsonStr =
      await rootBundle.loadString('assets/speed_limits.geojson');
  final geoJson = jsonDecode(geoJsonStr) as Map<String, dynamic>;
  final speedLimitService = SpeedLimitService()..loadFromGeoJson(geoJson);

  // Initialize state
  final appState = AppState();
  final collectionState = CollectionState()
    ..initialize(
      speedLimitService: speedLimitService,
      storageService: storageService,
      appState: appState,
    );
  final playbackState = PlaybackState()
    ..initialize(
      storageService: storageService,
      appState: appState,
    );
  final statsState = StatsState()
    ..initialize(storageService: storageService);

  runApp(
    MultiProvider(
      providers: [
        ChangeNotifierProvider.value(value: appState),
        ChangeNotifierProvider.value(value: collectionState),
        ChangeNotifierProvider.value(value: playbackState),
        ChangeNotifierProvider.value(value: statsState),
        Provider.value(value: storageService),
        Provider.value(value: speedLimitService),
      ],
      child: const StraetoApp(),
    ),
  );
}
