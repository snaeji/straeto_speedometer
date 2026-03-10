import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:shared/shared.dart';

import '../../services/import_service.dart';
import '../../services/storage_service.dart';
import '../../state/app_state.dart';
import '../../state/collection_state.dart';
import '../../theme.dart';

class LiveSidebar extends StatelessWidget {
  const LiveSidebar({super.key});

  @override
  Widget build(BuildContext context) {
    final collectionState = context.watch<CollectionState>();
    final appState = context.watch<AppState>();

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        _CollectionControls(collectionState: collectionState),
        const Divider(height: 1),
        _DataManagement(),
        const Divider(height: 1),
        Expanded(child: _BusList(locations: appState.filteredLocations)),
      ],
    );
  }
}

class _CollectionControls extends StatelessWidget {
  final CollectionState collectionState;
  const _CollectionControls({required this.collectionState});

  @override
  Widget build(BuildContext context) {
    final isCollecting = collectionState.isCollecting;
    final elapsed = collectionState.collectionStartTime != null
        ? DateTime.now().difference(collectionState.collectionStartTime!)
        : null;

    return Padding(
      padding: const EdgeInsets.all(12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          FilledButton.icon(
            onPressed: () {
              if (isCollecting) {
                collectionState.stopCollecting();
              } else {
                collectionState.startCollecting();
              }
            },
            icon: Icon(isCollecting ? Icons.stop : Icons.play_arrow),
            label: Text(isCollecting ? 'Stop Collecting' : 'Start Collecting'),
            style: FilledButton.styleFrom(
              backgroundColor: isCollecting ? kViolationColor : kNormalColor,
            ),
          ),
          const SizedBox(height: 8),
          Text(
            isCollecting && elapsed != null
                ? 'Collecting for ${_formatDuration(elapsed)}'
                : 'Not collecting',
            style: const TextStyle(fontSize: 12, color: Colors.white54),
          ),
          if (collectionState.recordsCollected > 0)
            Text(
              '${collectionState.recordsCollected} records, ${collectionState.violations} violations',
              style: const TextStyle(fontSize: 12, color: Colors.white54),
            ),
        ],
      ),
    );
  }

  String _formatDuration(Duration d) {
    if (d.inHours > 0) return '${d.inHours}h ${d.inMinutes % 60}m';
    if (d.inMinutes > 0) return '${d.inMinutes}m ${d.inSeconds % 60}s';
    return '${d.inSeconds}s';
  }
}

class _DataManagement extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    final storageService = context.read<StorageService>();

    return Padding(
      padding: const EdgeInsets.all(12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          OutlinedButton.icon(
            onPressed: () async {
              final importService = ImportService(storageService);
              final count = await importService.importFiles();
              if (context.mounted && count > 0) {
                ScaffoldMessenger.of(context).showSnackBar(
                  SnackBar(content: Text('Imported $count records')),
                );
              }
            },
            icon: const Icon(Icons.upload_file),
            label: const Text('Import Data'),
          ),
          const SizedBox(height: 8),
          FutureBuilder<int>(
            future: storageService.getStorageSize(),
            builder: (context, snapshot) {
              final bytes = snapshot.data ?? 0;
              final mb = (bytes / (1024 * 1024)).toStringAsFixed(1);
              return Text(
                'Storage: ~$mb MB',
                style: const TextStyle(fontSize: 12, color: Colors.white54),
              );
            },
          ),
          const SizedBox(height: 4),
          TextButton.icon(
            onPressed: () async {
              final confirmed = await showDialog<bool>(
                context: context,
                builder: (ctx) => AlertDialog(
                  title: const Text('Clear all data?'),
                  content: const Text('This cannot be undone.'),
                  actions: [
                    TextButton(
                      onPressed: () => Navigator.pop(ctx, false),
                      child: const Text('Cancel'),
                    ),
                    FilledButton(
                      onPressed: () => Navigator.pop(ctx, true),
                      child: const Text('Clear'),
                    ),
                  ],
                ),
              );
              if (confirmed == true) {
                await storageService.clearAll();
              }
            },
            icon: const Icon(Icons.delete_outline, size: 16),
            label: const Text('Clear Data',
                style: TextStyle(fontSize: 12)),
          ),
        ],
      ),
    );
  }
}

class _BusList extends StatelessWidget {
  final List<BusLocation> locations;
  const _BusList({required this.locations});

  @override
  Widget build(BuildContext context) {
    if (locations.isEmpty) {
      return const Center(
        child: Padding(
          padding: EdgeInsets.all(16),
          child: Text(
            'No buses visible.\nStart collecting or import data.',
            textAlign: TextAlign.center,
            style: TextStyle(color: Colors.white38),
          ),
        ),
      );
    }

    final sorted = List.of(locations)
      ..sort((a, b) {
        final aNum = int.tryParse(a.routeNr) ?? 999;
        final bNum = int.tryParse(b.routeNr) ?? 999;
        final routeCmp = aNum.compareTo(bNum);
        if (routeCmp != 0) return routeCmp;
        return a.busId.compareTo(b.busId);
      });

    return ListView.builder(
      padding: const EdgeInsets.symmetric(vertical: 4),
      itemCount: sorted.length,
      itemBuilder: (context, index) {
        final bus = sorted[index];
        final speedText = bus.speedKmh != null
            ? '${bus.speedKmh!.toStringAsFixed(0)} km/h'
            : '—';

        Color speedColor = Colors.white70;
        if (bus.isViolation) {
          speedColor = kViolationColor;
        } else if (bus.speedKmh != null &&
            bus.speedLimitKmh != null &&
            bus.speedKmh! > bus.speedLimitKmh! * 0.8) {
          speedColor = kApproachingColor;
        } else if (bus.speedKmh != null && bus.speedKmh! > 0) {
          speedColor = kNormalColor;
        }

        final appState = context.watch<AppState>();
        final isSelected = appState.selectedBusId == bus.busId;

        return ListTile(
          dense: true,
          selected: isSelected,
          selectedTileColor: Colors.white.withValues(alpha: 0.05),
          onTap: () => appState.selectBus(bus.busId),
          leading: CircleAvatar(
            radius: 14,
            backgroundColor: speedColor.withValues(alpha: 0.2),
            child: Text(
              bus.routeNr,
              style: TextStyle(
                fontSize: 11,
                fontWeight: FontWeight.bold,
                color: speedColor,
              ),
            ),
          ),
          title: Text(bus.busId, style: const TextStyle(fontSize: 12)),
          subtitle: bus.headsign != null
              ? Text(bus.headsign!, style: const TextStyle(fontSize: 10))
              : null,
          trailing: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              Text(
                speedText,
                style: TextStyle(
                  color: speedColor,
                  fontWeight: FontWeight.bold,
                  fontSize: 12,
                ),
              ),
              if (bus.speedLimitKmh != null)
                Text(
                  'limit ${bus.speedLimitKmh!.toStringAsFixed(0)} km/h',
                  style: const TextStyle(
                    color: Colors.white38,
                    fontSize: 10,
                  ),
                ),
            ],
          ),
        );
      },
    );
  }
}
