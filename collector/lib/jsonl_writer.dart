import 'dart:convert';
import 'dart:io';

import 'package:intl/intl.dart';
import 'package:shared/shared.dart';

class JsonlWriter {
  final String outputDir;
  IOSink? _currentSink;
  String? _currentDate;

  JsonlWriter(this.outputDir);

  void write(BusLocation location) {
    // Compute date string in UTC (Iceland is UTC+0)
    final date = DateFormat('yyyy-MM-dd').format(
      DateTime.fromMillisecondsSinceEpoch(location.timestamp, isUtc: true),
    );

    if (date != _currentDate) {
      _currentSink?.close();
      final dir = Directory(outputDir);
      if (!dir.existsSync()) dir.createSync(recursive: true);
      final file = File('$outputDir/$date.jsonl');
      _currentSink = file.openWrite(mode: FileMode.append);
      _currentDate = date;
    }

    _currentSink!.writeln(jsonEncode(location.toJsonLine()));
  }

  void close() {
    _currentSink?.close();
    _currentSink = null;
    _currentDate = null;
  }
}
