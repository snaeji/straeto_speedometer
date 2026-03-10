import 'dart:convert';

import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:test/test.dart';
import 'package:shared/shared.dart';

const _sampleResponse = '''
{
  "data": {
    "BusLocationByRoute": {
      "lastUpdate": "2026-03-10T21:56:11.000Z",
      "results": [
        {
          "busId": "1-A",
          "tripId": "63714",
          "routeNr": "1",
          "lat": 64.134,
          "lng": -21.905,
          "direction": 109,
          "headsign": "Hfj."
        },
        {
          "busId": "3-B",
          "tripId": "63720",
          "routeNr": "3",
          "lat": 64.150,
          "lng": -21.930,
          "direction": 220,
          "headsign": null
        }
      ]
    }
  }
}
''';

void main() {
  test('successful response parses correctly', () async {
    final mockClient = MockClient((request) async {
      return http.Response(_sampleResponse, 200);
    });

    final api = StraetoApi(client: mockClient);
    final (timestamp, buses) = await api.fetchBusLocations();

    expect(timestamp,
        equals(DateTime.parse('2026-03-10T21:56:11.000Z').millisecondsSinceEpoch));
    expect(buses, hasLength(2));

    expect(buses[0].busId, equals('1-A'));
    expect(buses[0].routeNr, equals('1'));
    expect(buses[0].tripId, equals('63714'));
    expect(buses[0].lat, equals(64.134));
    expect(buses[0].lng, equals(-21.905));
    expect(buses[0].direction, equals(109));
    expect(buses[0].headsign, equals('Hfj.'));
    expect(buses[0].speedKmh, isNull);
    expect(buses[0].isViolation, isFalse);

    expect(buses[1].busId, equals('3-B'));
    expect(buses[1].headsign, isNull);
  });

  test('HTTP error throws StraetoApiException', () async {
    final mockClient = MockClient((request) async {
      return http.Response('Server Error', 500);
    });

    final api = StraetoApi(client: mockClient);
    expect(
      () => api.fetchBusLocations(),
      throwsA(isA<StraetoApiException>()),
    );
  });

  test('malformed JSON throws', () async {
    final mockClient = MockClient((request) async {
      return http.Response('not json', 200);
    });

    final api = StraetoApi(client: mockClient);
    expect(
      () => api.fetchBusLocations(),
      throwsA(anything),
    );
  });

  test('missing data field throws StraetoApiException', () async {
    final mockClient = MockClient((request) async {
      return http.Response(jsonEncode({'errors': []}), 200);
    });

    final api = StraetoApi(client: mockClient);
    expect(
      () => api.fetchBusLocations(),
      throwsA(isA<StraetoApiException>()),
    );
  });
}
