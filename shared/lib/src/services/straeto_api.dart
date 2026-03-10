import 'dart:convert';

import 'package:http/http.dart' as http;

import '../constants.dart';
import '../models/bus_location.dart';

class StraetoApi {
  final http.Client _client;

  StraetoApi({http.Client? client}) : _client = client ?? http.Client();

  /// Fetches current bus positions for all routes.
  /// Returns (timestamp in epoch ms, list of BusLocation).
  Future<(int, List<BusLocation>)> fetchBusLocations() async {
    final body = jsonEncode({
      'extensions': {
        'persistedQuery': {
          'version': 1,
          'sha256Hash': persistedQueryHash,
        },
      },
      'variables': {
        'routes': allRoutes,
      },
    });

    final response = await _client.post(
      Uri.parse(straetoApiUrl),
      headers: {'Content-Type': 'application/json'},
      body: body,
    );

    if (response.statusCode != 200) {
      throw StraetoApiException(
        'HTTP ${response.statusCode}: ${response.reasonPhrase}',
      );
    }

    final json = jsonDecode(response.body) as Map<String, dynamic>;
    final data = json['data'] as Map<String, dynamic>?;
    if (data == null) {
      throw StraetoApiException('Response missing "data" field');
    }

    final busLocationByRoute =
        data['BusLocationByRoute'] as Map<String, dynamic>?;
    if (busLocationByRoute == null) {
      throw StraetoApiException(
          'Response missing "data.BusLocationByRoute" field');
    }

    final lastUpdateStr = busLocationByRoute['lastUpdate'] as String?;
    if (lastUpdateStr == null) {
      throw StraetoApiException('Response missing "lastUpdate" field');
    }
    final timestamp =
        DateTime.parse(lastUpdateStr).millisecondsSinceEpoch;

    final results = busLocationByRoute['results'] as List<dynamic>?;
    if (results == null) {
      throw StraetoApiException('Response missing "results" field');
    }

    final buses = results
        .map((r) =>
            BusLocation.fromApiJson(r as Map<String, dynamic>, timestamp))
        .toList();

    return (timestamp, buses);
  }

  void close() => _client.close();
}

class StraetoApiException implements Exception {
  final String message;
  StraetoApiException(this.message);

  @override
  String toString() => 'StraetoApiException: $message';
}
