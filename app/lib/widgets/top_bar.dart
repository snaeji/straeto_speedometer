import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../state/app_state.dart';
import 'kpi_cards.dart';
import 'mode_switcher.dart';
import 'route_filter.dart';

class TopBar extends StatelessWidget implements PreferredSizeWidget {
  const TopBar({super.key});

  @override
  Size get preferredSize => const Size.fromHeight(56);

  @override
  Widget build(BuildContext context) {
    final appState = context.read<AppState>();

    return Container(
      height: 56,
      padding: const EdgeInsets.symmetric(horizontal: 16),
      color: Theme.of(context).colorScheme.surface,
      child: Row(
        children: [
          IconButton(
            onPressed: () => appState.toggleSidebar(),
            icon: const Icon(Icons.menu),
          ),
          const SizedBox(width: 16),
          const ModeSwitcher(),
          const SizedBox(width: 24),
          const RouteFilter(),
          const Spacer(),
          const KpiCards(),
        ],
      ),
    );
  }
}
