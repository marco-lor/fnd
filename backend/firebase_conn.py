"""Lazy Firestore client construction for local maintenance commands.

Importing this module never imports ``firebase_admin``, reads credentials, or
initializes an application. Callers must pass the project ID that already
passed the CLI target fence.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any


_CLIENT: Any | None = None
_CLIENT_PROJECT: str | None = None


def _credential_source() -> str | dict[str, Any] | None:
    explicit_path = os.getenv("GOOGLE_APPLICATION_CREDENTIALS")
    if explicit_path:
        return explicit_path

    render_path = Path("/etc/secrets/firestoreServiceAccountKey.json")
    if os.getenv("RENDER") is not None and render_path.is_file():
        with render_path.open("r", encoding="utf-8") as source_file:
            return json.load(source_file)

    local_path = Path(__file__).with_name("firestoreServiceAccountKey.json")
    if local_path.is_file():
        return str(local_path)

    return None


def get_db(*, project_id: str) -> Any:
    """Return one lazily initialized client for the explicitly selected project."""
    global _CLIENT, _CLIENT_PROJECT

    if not project_id:
        raise ValueError("An explicit project ID is required before Firestore initialization.")
    if _CLIENT is not None:
        if _CLIENT_PROJECT != project_id:
            raise ValueError("The cached Firestore client belongs to a different project.")
        return _CLIENT

    from firebase_admin import credentials, firestore, get_app, initialize_app

    source = _credential_source()
    credential = (
        credentials.Certificate(source)
        if source is not None
        else credentials.ApplicationDefault()
    )
    app_name = f"fnd-maintenance-{project_id}"
    try:
        application = get_app(app_name)
    except ValueError:
        application = initialize_app(
            credential,
            {"projectId": project_id},
            name=app_name,
        )

    client = firestore.client(app=application)
    client_project = str(getattr(client, "project", "") or "")
    if client_project and client_project != project_id:
        raise ValueError("Initialized Firestore client does not match the explicit project ID.")

    _CLIENT = client
    _CLIENT_PROJECT = project_id
    return client


__all__ = ["get_db"]
