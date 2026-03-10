// Usage: dart run tools/download_speed_limits.dart
// Output: app/assets/speed_limits.geojson

import 'dart:convert';
import 'dart:io';

const _baseUrl =
    'https://borgarvefsja.reykjavik.is/arcgis/rest/services/Borgarvefsja/Borgarvefsja_over/MapServer/23/query';

const _params =
    'where=1%3D1&outFields=*&f=geojson&outSR=4326&returnGeometry=true&resultRecordCount=2000';

const _offsets = [0, 2000, 4000, 6000, 8000];

void main() async {
  final client = HttpClient();
  final allFeatures = <dynamic>[];

  try {
    for (var i = 0; i < _offsets.length; i++) {
      final offset = _offsets[i];
      final url = '$_baseUrl?$_params&resultOffset=$offset';
      stdout.write('Page ${i + 1}/${_offsets.length}: fetching offset $offset... ');

      final request = await client.getUrl(Uri.parse(url));
      final response = await request.close();
      final body = await response.transform(utf8.decoder).join();
      final json = jsonDecode(body) as Map<String, dynamic>;
      final features = json['features'] as List<dynamic>;

      allFeatures.addAll(features);
      print('got ${features.length} features');
    }
  } finally {
    client.close();
  }

  final merged = {
    'type': 'FeatureCollection',
    'features': allFeatures,
  };

  final outputDir = Directory('app/assets');
  if (!outputDir.existsSync()) {
    outputDir.createSync(recursive: true);
  }

  final outputFile = File('app/assets/speed_limits.geojson');
  final jsonStr = jsonEncode(merged);
  outputFile.writeAsStringSync(jsonStr);

  final sizeMb = (outputFile.lengthSync() / (1024 * 1024)).toStringAsFixed(1);
  print('\nTotal features: ${allFeatures.length}');
  print('Output: ${outputFile.path} ($sizeMb MB)');

  // Speed limit distribution
  final distribution = <int, int>{};
  for (final f in allFeatures) {
    final speed = (f as Map)['properties']['HRADI'] as int;
    distribution[speed] = (distribution[speed] ?? 0) + 1;
  }
  final sorted = distribution.entries.toList()
    ..sort((a, b) => a.key.compareTo(b.key));
  print('\nSpeed limit distribution:');
  for (final e in sorted) {
    print('  ${e.key} km/h: ${e.value} segments');
  }
}
