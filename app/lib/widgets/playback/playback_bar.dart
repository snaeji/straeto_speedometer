import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';

import '../../state/app_state.dart';
import '../../state/playback_state.dart';
import 'timeline_slider.dart';

class PlaybackBar extends StatelessWidget {
  const PlaybackBar({super.key});

  @override
  Widget build(BuildContext context) {
    final appState = context.watch<AppState>();
    final playbackState = context.watch<PlaybackState>();

    if (appState.mode != AppMode.playback) return const SizedBox.shrink();

    return Container(
      height: 80,
      color: Theme.of(context).colorScheme.surface,
      padding: const EdgeInsets.symmetric(horizontal: 16),
      child: Row(
        children: [
          IconButton(
            icon: const Icon(Icons.skip_previous),
            onPressed: playbackState.hasData ? () => playbackState.stepBackward() : null,
          ),
          IconButton(
            icon: Icon(
                playbackState.isPlaying ? Icons.pause : Icons.play_arrow),
            onPressed: playbackState.hasData
                ? () => playbackState.isPlaying
                    ? playbackState.pause()
                    : playbackState.play()
                : null,
          ),
          IconButton(
            icon: const Icon(Icons.skip_next),
            onPressed: playbackState.hasData ? () => playbackState.stepForward() : null,
          ),
          const SizedBox(width: 16),
          _SpeedSelector(playbackState: playbackState),
          const SizedBox(width: 16),
          Expanded(
            child: TimelineSlider(playbackState: playbackState),
          ),
          const SizedBox(width: 16),
          Text(
            _formatTimestamp(playbackState.currentTimestamp),
            style: const TextStyle(fontSize: 12),
          ),
        ],
      ),
    );
  }

  String _formatTimestamp(int? timestamp) {
    if (timestamp == null) return '--:--:--';
    final dt =
        DateTime.fromMillisecondsSinceEpoch(timestamp, isUtc: true);
    return DateFormat('HH:mm:ss').format(dt);
  }
}

class _SpeedSelector extends StatelessWidget {
  final PlaybackState playbackState;
  const _SpeedSelector({required this.playbackState});

  @override
  Widget build(BuildContext context) {
    return SegmentedButton<double>(
      segments: const [
        ButtonSegment(value: 1.0, label: Text('1x')),
        ButtonSegment(value: 2.0, label: Text('2x')),
        ButtonSegment(value: 5.0, label: Text('5x')),
        ButtonSegment(value: 10.0, label: Text('10x')),
      ],
      selected: {playbackState.playbackSpeed},
      onSelectionChanged: (s) => playbackState.setSpeed(s.first),
      style: const ButtonStyle(
        visualDensity: VisualDensity.compact,
        textStyle: WidgetStatePropertyAll(TextStyle(fontSize: 11)),
      ),
    );
  }
}
