import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../state/app_state.dart';

class ModeSwitcher extends StatelessWidget {
  const ModeSwitcher({super.key});

  @override
  Widget build(BuildContext context) {
    final appState = context.watch<AppState>();

    return SegmentedButton<AppMode>(
      segments: const [
        ButtonSegment(value: AppMode.live, label: Text('Live'), icon: Icon(Icons.sensors)),
        ButtonSegment(value: AppMode.playback, label: Text('Playback'), icon: Icon(Icons.history)),
        ButtonSegment(value: AppMode.stats, label: Text('Stats'), icon: Icon(Icons.bar_chart)),
        ButtonSegment(value: AppMode.heatmap, label: Text('Heatmap'), icon: Icon(Icons.whatshot)),
      ],
      selected: {appState.mode},
      onSelectionChanged: (selected) => appState.setMode(selected.first),
    );
  }
}
