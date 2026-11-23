#!/usr/bin/env python3
"""Classify only proven iOS Maestro/XCUITest transport faults. No log output."""
from pathlib import Path
from xml.etree import ElementTree as ET
import re
import sys

EXPLICIT_TRANSPORT = (
    'DeviceUnreachableException',
    'Transport unreachable',
    'Unreachable while processing deviceInfo',
)
DRIVER_FAILURE = re.compile(
    r'xcTestDriverStatusCheck: \[Failed\]|Failed to connect to /127\.0\.0\.1'
)


def read_text(path: Path) -> str:
    try:
        return path.read_text(encoding='utf-8', errors='replace')
    except (OSError, ValueError):
        return ''


def is_transport_failure(report: Path, console_output: Path, test_dir: Path) -> bool:
    """Return False for assertions, uncategorised errors or missing logs."""
    if not report.is_file():
        return False
    if any(signature in text
           for text in (read_text(report), read_text(console_output))
           for signature in EXPLICIT_TRANSPORT):
        return True

    try:
        root = ET.parse(report).getroot()
    except (ET.ParseError, OSError, ValueError):
        return False
    failures = root.findall('.//failure')
    errors = root.findall('.//error')
    if len(failures) != 1 or errors or (failures[0].text or '').strip() != 'Unknown error':
        return False
    try:
        logs = [p for p in test_dir.glob('*/maestro.log') if p.is_file()]
        if not logs:
            return False
        newest = max(logs, key=lambda p: p.stat().st_mtime_ns)
    except OSError:
        return False
    return bool(DRIVER_FAILURE.search(read_text(newest)))


if __name__ == '__main__':
    if len(sys.argv) != 4:
        raise SystemExit(2)
    raise SystemExit(0 if is_transport_failure(
        Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3])) else 1)
