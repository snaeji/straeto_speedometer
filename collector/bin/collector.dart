import 'dart:convert';
import 'dart:io';

import 'package:args/args.dart';
import 'package:shared/shared.dart';

import '../lib/collector_service.dart';
import '../lib/jsonl_writer.dart';

void main(List<String> arguments) async {
  final parser = ArgParser()
    ..addOption('output-dir', abbr: 'o', defaultsTo: './data',
        help: 'Output directory for .jsonl files')
    ..addOption('interval', abbr: 'i', defaultsTo: '2',
        help: 'Polling interval in seconds')
    ..addFlag('help', abbr: 'h', negatable: false, help: 'Show help');

  final args = parser.parse(arguments);

  if (args['help'] as bool) {
    print('Straeto Bus Data Collector\n');
    print('Usage: dart run bin/collector.dart [options]\n');
    print(parser.usage);
    exit(0);
  }

  // Load speed limit data
  final geoJsonFile = File('../app/assets/speed_limits.geojson');
  if (!geoJsonFile.existsSync()) {
    print('Error: speed_limits.geojson not found.');
    print('Run: dart run tools/download_speed_limits.dart');
    exit(1);
  }

  print('Loading speed limit data...');
  final geoJson =
      jsonDecode(geoJsonFile.readAsStringSync()) as Map<String, dynamic>;
  final speedLimitService = SpeedLimitService()..loadFromGeoJson(geoJson);
  print('Loaded ${(geoJson['features'] as List).length} road segments.');

  final speedCalculator = SpeedCalculator();
  final api = StraetoApi();
  final writer = JsonlWriter(args['output-dir'] as String);
  final interval = Duration(seconds: int.parse(args['interval'] as String));

  final service = CollectorService(
    api: api,
    speedCalculator: speedCalculator,
    speedLimitService: speedLimitService,
    writer: writer,
    interval: interval,
  );

  // Handle Ctrl+C gracefully
  ProcessSignal.sigint.watch().listen((_) {
    service.stop();
    exit(0);
  });

  await service.start();
}
