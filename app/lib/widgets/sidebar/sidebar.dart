import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../state/app_state.dart';
import 'heatmap_sidebar.dart';
import 'live_sidebar.dart';
import 'stats_sidebar.dart';

class Sidebar extends StatelessWidget {
  const Sidebar({super.key});

  @override
  Widget build(BuildContext context) {
    final appState = context.watch<AppState>();
    if (!appState.sidebarExpanded) return const SizedBox.shrink();
    if (appState.mode == AppMode.playback) return const SizedBox.shrink();

    final width = appState.mode == AppMode.stats ? 450.0 : 300.0;

    return AnimatedContainer(
      duration: const Duration(milliseconds: 200),
      width: width,
      child: Card(
        margin: const EdgeInsets.all(8),
        child: switch (appState.mode) {
          AppMode.live => const LiveSidebar(),
          AppMode.playback => const SizedBox.shrink(),
          AppMode.stats => const StatsSidebar(),
          AppMode.heatmap => const HeatmapSidebar(),
        },
      ),
    );
  }
}
