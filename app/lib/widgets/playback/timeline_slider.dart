import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../../state/playback_state.dart';

class TimelineSlider extends StatelessWidget {
  final PlaybackState playbackState;

  const TimelineSlider({super.key, required this.playbackState});

  @override
  Widget build(BuildContext context) {
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Text(
              _formatDate(playbackState.startTimestamp),
              style: const TextStyle(fontSize: 10, color: Colors.white54),
            ),
            Text(
              _formatDate(playbackState.endTimestamp),
              style: const TextStyle(fontSize: 10, color: Colors.white54),
            ),
          ],
        ),
        Slider(
          value: playbackState.progress,
          onChanged: playbackState.hasData
              ? (value) {
                  final range =
                      playbackState.endTimestamp! - playbackState.startTimestamp!;
                  final ts =
                      playbackState.startTimestamp! + (range * value).toInt();
                  playbackState.seekTo(ts);
                }
              : null,
        ),
      ],
    );
  }

  String _formatDate(int? timestamp) {
    if (timestamp == null) return '—';
    final dt =
        DateTime.fromMillisecondsSinceEpoch(timestamp, isUtc: true);
    return DateFormat('MMM d, HH:mm').format(dt);
  }
}
