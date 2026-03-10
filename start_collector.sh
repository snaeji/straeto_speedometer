#!/bin/bash
cd "$(dirname "$0")/collector"
dart run bin/collector.dart "$@"
