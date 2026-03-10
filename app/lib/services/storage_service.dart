import 'dart:convert';

import 'package:idb_shim/idb_browser.dart';
import 'package:shared/shared.dart';

class StorageService {
  static const String _dbName = 'straeto_speedometer';
  static const int _dbVersion = 1;
  static const String _storeName = 'bus_locations';

  Database? _db;

  Future<void> open() async {
    final factory = getIdbFactory()!;
    _db = await factory.open(_dbName, version: _dbVersion,
        onUpgradeNeeded: (e) {
      final db = e.database;
      final store = db.createObjectStore(_storeName);
      store.createIndex('timestamp', 'ts');
      store.createIndex('busId', 'b');
    });
  }

  Future<void> storeBatch(List<BusLocation> locations) async {
    if (_db == null) return;
    final txn = _db!.transaction(_storeName, idbModeReadWrite);
    final store = txn.objectStore(_storeName);
    for (final loc in locations) {
      final key = '${loc.timestamp}_${loc.busId}';
      await store.put(loc.toJsonLine(), key);
    }
    await txn.completed;
  }

  Future<List<BusLocation>> getLocationsInRange(int startMs, int endMs) async {
    if (_db == null) return [];
    final txn = _db!.transaction(_storeName, idbModeReadOnly);
    final store = txn.objectStore(_storeName);
    final index = store.index('timestamp');
    final range = KeyRange.bound(startMs, endMs);
    final results = <BusLocation>[];

    final cursors = index.openCursor(range: range, autoAdvance: true);
    await for (final cursor in cursors) {
      final map = cursor.value as Map;
      results.add(BusLocation.fromJsonLine(Map<String, dynamic>.from(map)));
    }
    return results;
  }

  Stream<List<BusLocation>> getAllLocationsStream({int chunkSize = 1000}) async* {
    if (_db == null) return;
    final txn = _db!.transaction(_storeName, idbModeReadOnly);
    final store = txn.objectStore(_storeName);
    final chunk = <BusLocation>[];

    final cursors = store.openCursor(autoAdvance: true);
    await for (final cursor in cursors) {
      final map = cursor.value as Map;
      chunk.add(BusLocation.fromJsonLine(Map<String, dynamic>.from(map)));
      if (chunk.length >= chunkSize) {
        yield List.from(chunk);
        chunk.clear();
      }
    }
    if (chunk.isNotEmpty) yield chunk;
  }

  Future<(int?, int?)> getTimeRange() async {
    if (_db == null) return (null, null);
    final txn = _db!.transaction(_storeName, idbModeReadOnly);
    final store = txn.objectStore(_storeName);
    final index = store.index('timestamp');

    int? earliest;
    int? latest;

    final firstCursor = index.openCursor(autoAdvance: false);
    await for (final cursor in firstCursor) {
      final map = cursor.value as Map;
      earliest = map['ts'] as int?;
      break;
    }

    final lastCursor =
        index.openCursor(direction: idbDirectionPrev, autoAdvance: false);
    await for (final cursor in lastCursor) {
      final map = cursor.value as Map;
      latest = map['ts'] as int?;
      break;
    }

    return (earliest, latest);
  }

  Future<List<BusLocation>> getBusHistory(String busId, {int maxMinutes = 30}) async {
    if (_db == null) return [];
    final now = DateTime.now().millisecondsSinceEpoch;
    final startMs = now - maxMinutes * 60 * 1000;
    final txn = _db!.transaction(_storeName, idbModeReadOnly);
    final store = txn.objectStore(_storeName);
    final index = store.index('timestamp');
    final range = KeyRange.bound(startMs, now);
    final results = <BusLocation>[];

    final cursors = index.openCursor(range: range, autoAdvance: true);
    await for (final cursor in cursors) {
      final map = cursor.value as Map;
      if (map['b'] == busId) {
        results.add(BusLocation.fromJsonLine(Map<String, dynamic>.from(map)));
      }
    }
    return results;
  }

  Future<int> getStorageSize() async {
    if (_db == null) return 0;
    final txn = _db!.transaction(_storeName, idbModeReadOnly);
    final store = txn.objectStore(_storeName);
    final count = await store.count();
    // Rough estimate: ~150 bytes per record
    return count * 150;
  }

  Future<void> clearAll() async {
    if (_db == null) return;
    final txn = _db!.transaction(_storeName, idbModeReadWrite);
    final store = txn.objectStore(_storeName);
    await store.clear();
    await txn.completed;
  }

  Future<int> importJsonl(String jsonlContent) async {
    final lines = jsonlContent.split('\n').where((l) => l.trim().isNotEmpty);
    final locations = <BusLocation>[];
    for (final line in lines) {
      try {
        final json = jsonDecode(line) as Map<String, dynamic>;
        locations.add(BusLocation.fromJsonLine(json));
      } catch (_) {
        // Skip malformed lines
      }
    }
    if (locations.isNotEmpty) {
      await storeBatch(locations);
    }
    return locations.length;
  }

  void close() {
    _db?.close();
    _db = null;
  }
}
