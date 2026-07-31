"""Dependency-light health entrypoint.

Render and local ASGI servers keep using ``main:app``. Firestore maintenance is
loaded only when this file is executed as a CLI.
"""

try:
    from .health_app import app
except ImportError:
    from health_app import app


if __name__ == "__main__":
    try:
        from .maintenance_cli import run_admin_cli
    except ImportError:
        from maintenance_cli import run_admin_cli

    run_admin_cli()
