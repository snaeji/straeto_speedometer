import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:shared/shared.dart';

import '../state/app_state.dart';

class RouteFilter extends StatelessWidget {
  const RouteFilter({super.key});

  @override
  Widget build(BuildContext context) {
    final appState = context.watch<AppState>();
    final selected = appState.selectedRoutes;
    final label =
        selected.isEmpty ? 'All routes' : '${selected.length} routes';

    return PopupMenuButton<String>(
      tooltip: 'Filter routes',
      offset: const Offset(0, 40),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(8),
          border: Border.all(color: Colors.white24),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.filter_list, size: 16),
            const SizedBox(width: 6),
            Text(label, style: const TextStyle(fontSize: 13)),
            const SizedBox(width: 4),
            const Icon(Icons.arrow_drop_down, size: 16),
          ],
        ),
      ),
      itemBuilder: (context) {
        return [
          PopupMenuItem(
            value: '_all',
            child: Text(
              'Show all',
              style: TextStyle(
                fontWeight:
                    selected.isEmpty ? FontWeight.bold : FontWeight.normal,
              ),
            ),
          ),
          const PopupMenuDivider(),
          ...allRoutes.map(
            (route) => CheckedPopupMenuItem(
              value: route,
              checked: selected.contains(route),
              child: Text('Route $route'),
            ),
          ),
        ];
      },
      onSelected: (value) {
        if (value == '_all') {
          appState.selectAllRoutes();
        } else {
          appState.toggleRoute(value);
        }
      },
    );
  }
}
