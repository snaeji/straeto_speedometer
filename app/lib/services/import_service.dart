import 'dart:convert';

import 'package:file_picker/file_picker.dart';

import 'storage_service.dart';

class ImportService {
  final StorageService _storageService;

  ImportService(this._storageService);

  /// Import one or more .jsonl files selected by the user.
  /// Returns total records imported.
  Future<int> importFiles() async {
    final result = await FilePicker.platform.pickFiles(
      type: FileType.custom,
      allowedExtensions: ['jsonl'],
      allowMultiple: true,
      withData: true,
    );

    if (result == null || result.files.isEmpty) return 0;

    var totalImported = 0;
    for (final file in result.files) {
      if (file.bytes == null) continue;
      final content = utf8.decode(file.bytes!);
      final count = await _storageService.importJsonl(content);
      totalImported += count;
    }

    return totalImported;
  }
}
