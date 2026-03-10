# Straeto Speedometer

Real-time bus speed monitoring system for Reykjavík's public bus system (Straeto). Tracks GPS positions, calculates speeds, compares against official speed limits, and visualizes everything on an interactive map.

## Project Structure

```
├── shared/       Pure Dart library — models, API client, speed calculation, speed limits
├── app/          Flutter web app — map visualization, live collection, playback, stats
├── collector/    Dart CLI — long-running data collection to JSONL files
└── tools/        Utility scripts (speed limit data download)
```

## Quick Start

**Run the web app:**
```bash
./start_app.sh
```

**Run the standalone data collector:**
```bash
./start_collector.sh
```

**Download speed limit data** (needed before first build):
```bash
dart run tools/download_speed_limits.dart
```

## Live Demo

Deployed via GitHub Pages on every push to `main`.
