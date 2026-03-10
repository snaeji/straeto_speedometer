#!/bin/bash
cd "$(dirname "$0")/app"
flutter run -d chrome --web-port 8080
