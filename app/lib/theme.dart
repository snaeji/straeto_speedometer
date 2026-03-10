import 'package:flutter/material.dart';

const kViolationColor = Color(0xFFEF5350);
const kApproachingColor = Color(0xFFFFA726);
const kNormalColor = Color(0xFF66BB6A);
const kNoDataColor = Color(0xFF9E9E9E);

final appTheme = ThemeData(
  brightness: Brightness.dark,
  scaffoldBackgroundColor: const Color(0xFF1A1A2E),
  colorScheme: const ColorScheme.dark(
    primary: Color(0xFF4FC3F7),
    surface: Color(0xFF16213E),
    error: Color(0xFFEF5350),
  ),
  cardTheme: const CardThemeData(
    color: Color(0xFF16213E),
    elevation: 2,
  ),
  segmentedButtonTheme: const SegmentedButtonThemeData(
    style: ButtonStyle(
      textStyle: WidgetStatePropertyAll(TextStyle(fontSize: 13)),
    ),
  ),
);
