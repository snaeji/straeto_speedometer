import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import 'state/app_state.dart';
import 'theme.dart';
import 'widgets/bus_map.dart';
import 'widgets/playback/playback_bar.dart';
import 'widgets/sidebar/sidebar.dart';
import 'widgets/speed_graph.dart';
import 'widgets/top_bar.dart';

class StraetoApp extends StatelessWidget {
  const StraetoApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Straeto Speedometer',
      theme: appTheme,
      debugShowCheckedModeBanner: false,
      home: const AppShell(),
    );
  }
}

class AppShell extends StatelessWidget {
  const AppShell({super.key});

  @override
  Widget build(BuildContext context) {
    final showGraph = context.watch<AppState>().selectedBusId != null;

    return Scaffold(
      body: Column(
        children: [
          const TopBar(),
          Expanded(
            child: Stack(
              children: [
                const BusMap(),
                const Positioned(
                  top: 0,
                  left: 0,
                  bottom: 0,
                  child: Sidebar(),
                ),
                const Positioned(
                  bottom: 0,
                  left: 0,
                  right: 0,
                  child: PlaybackBar(),
                ),
              ],
            ),
          ),
          if (showGraph) const SpeedGraph(),
        ],
      ),
    );
  }
}
