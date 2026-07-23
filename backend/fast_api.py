# file ./backend/fast_api.py
"""Backward-compatible import for the dependency-light health application."""

try:
    from .health_app import app, read_healthz, read_root
except ImportError:
    from health_app import app, read_healthz, read_root

__all__ = ["app", "read_healthz", "read_root"]
