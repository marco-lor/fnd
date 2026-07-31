"""Versioned recursive Firestore backup and non-destructive restore helpers.

The pure functions in this module use an injected adapter and never initialize a
Firebase application.  CLI wiring in ``main.py`` is responsible for explicit
project confirmation before constructing the live adapter.
"""

from __future__ import annotations

import base64
import hashlib
import json
import math
import os
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Iterable, Mapping


BACKUP_FORMAT = "fnd.firestore-recursive-backup"
BACKUP_SCHEMA_VERSION = 2
RESTORE_REPORT_SCHEMA_VERSION = 1
PROTECTED_RESTORE_DOCUMENTS = frozenset({
    "app_config/user_data_v2",
})
PROTECTED_RESTORE_PREFIXES = (
    "app_config/user_data_v2/",
    "migration_state/",
    "user_deletion_jobs/",
    "user_media_cleanup/",
    "user_operations/",
)


def canonical_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def canonical_hash(value: Any) -> str:
    return hashlib.sha256(canonical_json(value).encode("utf-8")).hexdigest()


def _timestamp_parts(value: datetime) -> tuple[str, int]:
    normalized = value
    if normalized.tzinfo is None:
        normalized = normalized.replace(tzinfo=timezone.utc)
    normalized = normalized.astimezone(timezone.utc)
    nanosecond = int(getattr(value, "nanosecond", normalized.microsecond * 1000))
    return normalized.isoformat().replace("+00:00", "Z"), nanosecond


def encode_firestore_value(value: Any) -> dict[str, Any]:
    """Encode Firestore values without ambiguous magic keys in user maps."""
    if value is None:
        return {"type": "null"}
    if isinstance(value, bool):
        return {"type": "boolean", "value": value}
    if isinstance(value, int):
        return {"type": "integer", "value": str(value)}
    if isinstance(value, float):
        if math.isnan(value):
            encoded = "NaN"
        elif value == math.inf:
            encoded = "Infinity"
        elif value == -math.inf:
            encoded = "-Infinity"
        elif value == 0 and math.copysign(1, value) < 0:
            encoded = "-0"
        else:
            encoded = repr(value)
        return {"type": "double", "value": encoded}
    if isinstance(value, str):
        return {"type": "string", "value": value}
    if isinstance(value, (bytes, bytearray, memoryview)):
        return {
            "type": "bytes",
            "value": base64.b64encode(bytes(value)).decode("ascii"),
        }
    if isinstance(value, datetime):
        iso_value, nanosecond = _timestamp_parts(value)
        return {"type": "timestamp", "value": iso_value, "nanosecond": nanosecond}
    if isinstance(value, (list, tuple)):
        return {"type": "array", "value": [encode_firestore_value(item) for item in value]}
    if isinstance(value, Mapping):
        if not all(isinstance(key, str) for key in value):
            raise TypeError("Firestore maps require string keys.")
        return {
            "type": "map",
            "value": {
                key: encode_firestore_value(value[key])
                for key in sorted(value)
            },
        }

    class_name = value.__class__.__name__
    if class_name == "GeoPoint" and hasattr(value, "latitude") and hasattr(value, "longitude"):
        return {
            "type": "geopoint",
            "latitude": float(value.latitude),
            "longitude": float(value.longitude),
        }
    if class_name.endswith("DocumentReference") and isinstance(getattr(value, "path", None), str):
        return {"type": "reference", "path": value.path}
    raise TypeError(f"Unsupported Firestore value type: {value.__class__.__module__}.{class_name}")


def decode_firestore_value(
    encoded: Mapping[str, Any],
    *,
    reference_factory: Callable[[str], Any] | None = None,
    geopoint_factory: Callable[[float, float], Any] | None = None,
    timestamp_factory: Callable[[str, int], Any] | None = None,
) -> Any:
    value_type = encoded.get("type")
    if value_type == "null":
        return None
    if value_type == "boolean":
        return bool(encoded["value"])
    if value_type == "integer":
        return int(encoded["value"])
    if value_type == "double":
        value = encoded["value"]
        if value == "NaN":
            return float("nan")
        if value == "Infinity":
            return float("inf")
        if value == "-Infinity":
            return float("-inf")
        if value == "-0":
            return -0.0
        return float(value)
    if value_type == "string":
        return str(encoded["value"])
    if value_type == "bytes":
        return base64.b64decode(encoded["value"], validate=True)
    if value_type == "timestamp":
        iso_value = str(encoded["value"])
        nanosecond = int(encoded.get("nanosecond", 0))
        if timestamp_factory:
            return timestamp_factory(iso_value, nanosecond)
        return datetime.fromisoformat(iso_value.replace("Z", "+00:00"))
    if value_type == "reference":
        path_value = validate_document_path(str(encoded["path"]))
        return reference_factory(path_value) if reference_factory else {"reference": path_value}
    if value_type == "geopoint":
        latitude = float(encoded["latitude"])
        longitude = float(encoded["longitude"])
        return geopoint_factory(latitude, longitude) if geopoint_factory else {
            "latitude": latitude,
            "longitude": longitude,
        }
    if value_type == "array":
        return [
            decode_firestore_value(
                item,
                reference_factory=reference_factory,
                geopoint_factory=geopoint_factory,
                timestamp_factory=timestamp_factory,
            )
            for item in encoded["value"]
        ]
    if value_type == "map":
        values = encoded.get("value")
        if not isinstance(values, Mapping):
            raise ValueError("Encoded Firestore map must contain an object value.")
        return {
            key: decode_firestore_value(
                item,
                reference_factory=reference_factory,
                geopoint_factory=geopoint_factory,
                timestamp_factory=timestamp_factory,
            )
            for key, item in values.items()
        }
    raise ValueError(f"Unsupported encoded Firestore value type: {value_type!r}")


def validate_collection_path(collection_path: str) -> str:
    segments = collection_path.split("/")
    if not collection_path or any(not segment or segment in {".", ".."} for segment in segments):
        raise ValueError("Invalid Firestore collection path.")
    if len(segments) % 2 != 1:
        raise ValueError("A Firestore collection path must contain an odd number of segments.")
    return collection_path


def validate_document_path(document_path: str) -> str:
    segments = document_path.split("/")
    if not document_path or any(not segment or segment in {".", ".."} for segment in segments):
        raise ValueError("Invalid Firestore document path.")
    if len(segments) % 2 != 0:
        raise ValueError("A Firestore document path must contain an even number of segments.")
    return document_path


def _metadata_timestamp(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return _timestamp_parts(value)[0]
    if hasattr(value, "to_datetime"):
        return _metadata_timestamp(value.to_datetime())
    if hasattr(value, "toDate"):
        return _metadata_timestamp(value.toDate())
    return str(value)


def _document_payload(record: Mapping[str, Any], subcollections: list[str]) -> dict[str, Any]:
    document_path = validate_document_path(str(record["path"]))
    fields = encode_firestore_value(record.get("fields") or {})
    payload = {
        "path": document_path,
        "fields": fields,
        "createTime": _metadata_timestamp(record.get("create_time")),
        "updateTime": _metadata_timestamp(record.get("update_time")),
        "subcollections": sorted(subcollections),
    }
    return {**payload, "documentHash": canonical_hash(payload)}


def export_recursive_firestore(
    adapter: Any,
    *,
    project_id: str,
    generated_at: datetime | None = None,
) -> dict[str, Any]:
    """Recursively export all documents, including empty-parent subcollections."""
    if not project_id:
        raise ValueError("An explicit project ID is required for export.")
    root_collections = sorted(set(adapter.list_root_collections()))
    documents: list[dict[str, Any]] = []
    visited_collections: set[str] = set()

    def visit_collection(collection_path: str) -> None:
        validate_collection_path(collection_path)
        if collection_path in visited_collections:
            return
        visited_collections.add(collection_path)
        records = sorted(adapter.list_documents(collection_path), key=lambda item: item["path"])
        for record in records:
            document_path = validate_document_path(str(record["path"]))
            expected_parent = document_path.rsplit("/", 1)[0]
            if expected_parent != collection_path:
                raise ValueError("Adapter returned a document outside the requested collection.")
            subcollections = sorted(set(adapter.list_subcollections(document_path)))
            if record.get("exists", True):
                documents.append(_document_payload(record, subcollections))
            for collection_id in subcollections:
                if not collection_id or "/" in collection_id:
                    raise ValueError("Adapter returned an invalid subcollection ID.")
                visit_collection(f"{document_path}/{collection_id}")

    for collection_id in root_collections:
        if not collection_id or "/" in collection_id:
            raise ValueError("Adapter returned an invalid root collection ID.")
        visit_collection(collection_id)

    documents.sort(key=lambda item: item["path"])
    content = {
        "format": BACKUP_FORMAT,
        "schemaVersion": BACKUP_SCHEMA_VERSION,
        "projectId": project_id,
        "rootCollections": root_collections,
        "documents": documents,
    }
    generated = generated_at or datetime.now(timezone.utc)
    return {
        **content,
        "generatedAt": _metadata_timestamp(generated),
        "canonicalHash": canonical_hash(content),
        "counts": {
            "rootCollections": len(root_collections),
            "documents": len(documents),
            "subcollections": max(0, len(visited_collections) - len(root_collections)),
        },
    }


def validate_backup(backup: Mapping[str, Any], *, expected_project_id: str | None = None) -> Mapping[str, Any]:
    if backup.get("format") != BACKUP_FORMAT or backup.get("schemaVersion") != BACKUP_SCHEMA_VERSION:
        raise ValueError("Unsupported Firestore backup format or schema version.")
    if expected_project_id and backup.get("projectId") != expected_project_id:
        raise ValueError("Backup project ID does not match the explicit target project.")
    documents = backup.get("documents")
    if not isinstance(documents, list):
        raise ValueError("Backup documents must be an array.")
    paths: set[str] = set()
    for document in documents:
        path_value = validate_document_path(str(document.get("path", "")))
        if path_value in paths:
            raise ValueError("Backup contains duplicate document paths.")
        paths.add(path_value)
        payload = {
            "path": path_value,
            "fields": document.get("fields"),
            "createTime": document.get("createTime"),
            "updateTime": document.get("updateTime"),
            "subcollections": document.get("subcollections"),
        }
        if document.get("documentHash") != canonical_hash(payload):
            raise ValueError("Backup document hash mismatch.")
        decode_firestore_value(document["fields"])

    content = {
        "format": backup.get("format"),
        "schemaVersion": backup.get("schemaVersion"),
        "projectId": backup.get("projectId"),
        "rootCollections": backup.get("rootCollections"),
        "documents": documents,
    }
    if backup.get("canonicalHash") != canonical_hash(content):
        raise ValueError("Backup canonical hash mismatch.")
    return backup


def write_json_atomic(file_path: str | os.PathLike[str], value: Mapping[str, Any]) -> Path:
    destination = Path(file_path)
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_name(f"{destination.name}.{os.getpid()}.tmp")
    temporary.write_text(f"{json.dumps(value, ensure_ascii=False, indent=2)}\n", encoding="utf-8")
    os.replace(temporary, destination)
    return destination


def read_backup(file_path: str | os.PathLike[str], *, expected_project_id: str | None = None) -> dict[str, Any]:
    parsed = json.loads(Path(file_path).read_text(encoding="utf-8"))
    validate_backup(parsed, expected_project_id=expected_project_id)
    return parsed


def _encoded_existing(record: Mapping[str, Any] | None) -> dict[str, Any] | None:
    if record is None:
        return None
    return encode_firestore_value(record.get("fields") or {})


def _is_protected_restore_document(document_path: str) -> bool:
    return document_path in PROTECTED_RESTORE_DOCUMENTS or any(
        document_path.startswith(prefix) for prefix in PROTECTED_RESTORE_PREFIXES
    )


def build_restore_plan(adapter: Any, backup: Mapping[str, Any], *, project_id: str) -> dict[str, Any]:
    validate_backup(backup, expected_project_id=project_id)
    entries = []
    for document in sorted(backup["documents"], key=lambda item: item["path"]):
        existing = adapter.get_document(document["path"])
        existing_fields = _encoded_existing(existing)
        if existing_fields is None:
            action = "create"
        elif canonical_hash(existing_fields) == canonical_hash(document["fields"]):
            action = "unchanged"
        else:
            action = "update"
        if action != "unchanged" and _is_protected_restore_document(document["path"]):
            raise ValueError(
                "Restore refuses mutations to protected Task 05 control documents."
            )
        entries.append({
            "path": document["path"],
            "pathHash": canonical_hash({"projectId": project_id, "path": document["path"]}),
            "action": action,
            "expectedFieldsHash": canonical_hash(document["fields"]),
            "existingFieldsHash": canonical_hash(existing_fields) if existing_fields is not None else None,
            "encodedFields": document["fields"],
        })

    fingerprint = canonical_hash({
        "schemaVersion": RESTORE_REPORT_SCHEMA_VERSION,
        "projectId": project_id,
        "backupHash": backup["canonicalHash"],
        "entries": [
            {key: entry[key] for key in ("path", "action", "expectedFieldsHash", "existingFieldsHash")}
            for entry in entries
        ],
    })
    counts = {
        "documents": len(entries),
        "create": sum(entry["action"] == "create" for entry in entries),
        "update": sum(entry["action"] == "update" for entry in entries),
        "unchanged": sum(entry["action"] == "unchanged" for entry in entries),
    }
    return {
        "schemaVersion": RESTORE_REPORT_SCHEMA_VERSION,
        "projectId": project_id,
        "backupHash": backup["canonicalHash"],
        "planFingerprint": fingerprint,
        "counts": counts,
        "entries": entries,
    }


def build_restore_report(plan: Mapping[str, Any]) -> dict[str, Any]:
    return {
        "schemaVersion": RESTORE_REPORT_SCHEMA_VERSION,
        "mode": "dry-run",
        "complete": True,
        "projectId": plan["projectId"],
        "backupHash": plan["backupHash"],
        "planFingerprint": plan["planFingerprint"],
        "counts": plan["counts"],
        "documents": [
            {
                "pathHash": entry["pathHash"],
                "action": entry["action"],
                "expectedFieldsHash": entry["expectedFieldsHash"],
                "existingFieldsHash": entry["existingFieldsHash"],
            }
            for entry in plan["entries"]
        ],
    }


def assert_approved_restore_report(
    report: Mapping[str, Any],
    plan: Mapping[str, Any],
    *,
    approved_fingerprint: str,
) -> None:
    if (
        report.get("schemaVersion") != RESTORE_REPORT_SCHEMA_VERSION
        or report.get("mode") != "dry-run"
        or report.get("complete") is not True
        or report.get("projectId") != plan["projectId"]
        or report.get("backupHash") != plan["backupHash"]
        or report.get("planFingerprint") != plan["planFingerprint"]
        or report.get("counts") != plan["counts"]
    ):
        raise ValueError("Restore requires the exact completed dry-run report for this plan.")
    if approved_fingerprint != plan["planFingerprint"]:
        raise ValueError("Approved restore fingerprint does not match the dry-run plan.")


def apply_restore_plan(
    adapter: Any,
    plan: Mapping[str, Any],
    *,
    reference_factory: Callable[[str], Any] | None = None,
    geopoint_factory: Callable[[float, float], Any] | None = None,
    timestamp_factory: Callable[[str, int], Any] | None = None,
) -> dict[str, int]:
    written = 0
    for entry in sorted(plan["entries"], key=lambda item: (item["path"].count("/"), item["path"])):
        if entry["action"] == "unchanged":
            continue
        fields = decode_firestore_value(
            entry["encodedFields"],
            reference_factory=reference_factory,
            geopoint_factory=geopoint_factory,
            timestamp_factory=timestamp_factory,
        )
        adapter.set_document(entry["path"], fields)
        verified = adapter.get_document(entry["path"])
        if canonical_hash(_encoded_existing(verified)) != entry["expectedFieldsHash"]:
            raise RuntimeError("Post-restore verification hash mismatch.")
        written += 1
    return {"written": written, "unchanged": plan["counts"]["unchanged"]}


def assert_safe_firestore_target(
    *,
    project_id: str,
    allow_live_project: bool,
    confirm_project: str,
    operation: str = "",
    execute: bool = False,
    environment: Mapping[str, str] | None = None,
) -> dict[str, Any]:
    environment = environment or os.environ
    if not project_id:
        raise ValueError("An explicit project ID is required.")
    for variable in ("GCLOUD_PROJECT", "GOOGLE_CLOUD_PROJECT"):
        inherited = environment.get(variable)
        if inherited and inherited != project_id:
            raise ValueError(f"{variable} does not match the explicit project ID.")
    emulator_host = environment.get("FIRESTORE_EMULATOR_HOST", "")
    if emulator_host:
        if "://" in emulator_host:
            raise ValueError("Invalid Firestore emulator host.")
        host = emulator_host.rsplit(":", 1)[0].strip("[]")
        if host not in {"127.0.0.1", "localhost", "::1"}:
            raise ValueError("Non-loopback Firestore emulator hosts are refused.")
        if not project_id.startswith("demo-"):
            raise ValueError("Emulator maintenance requires a demo-* project ID.")
        return {"projectId": project_id, "live": False, "emulatorHost": emulator_host}
    if not allow_live_project or confirm_project != project_id:
        raise ValueError(
            "Live Firestore access is refused without allow-live-project and exact project confirmation."
        )
    if operation == "restore" and execute:
        raise ValueError(
            "Live restore execution is blocked until a compatible mutation pause fence exists."
        )
    return {"projectId": project_id, "live": True, "emulatorHost": None}


class FirestoreAdminAdapter:
    """Thin google-cloud-firestore adapter; construction has no network side effect."""

    def __init__(self, client: Any):
        self.client = client

    def list_root_collections(self) -> Iterable[str]:
        return [collection.id for collection in self.client.collections()]

    def list_documents(self, collection_path: str) -> Iterable[dict[str, Any]]:
        records = []
        references = self.client.collection(collection_path).list_documents(
            show_missing=True
        )
        for reference in references:
            snapshot = reference.get()
            records.append({
                "path": reference.path,
                "exists": snapshot.exists,
                "fields": snapshot.to_dict() or {} if snapshot.exists else {},
                "create_time": snapshot.create_time if snapshot.exists else None,
                "update_time": snapshot.update_time if snapshot.exists else None,
            })
        return records

    def list_subcollections(self, document_path: str) -> Iterable[str]:
        return [collection.id for collection in self.client.document(document_path).collections()]

    def get_document(self, document_path: str) -> dict[str, Any] | None:
        snapshot = self.client.document(document_path).get()
        if not snapshot.exists:
            return None
        return {
            "path": snapshot.reference.path,
            "fields": snapshot.to_dict() or {},
            "create_time": snapshot.create_time,
            "update_time": snapshot.update_time,
        }

    def set_document(self, document_path: str, fields: Mapping[str, Any]) -> None:
        self.client.document(document_path).set(dict(fields))

    def restore_factories(self) -> dict[str, Callable[..., Any]]:
        from google.api_core.datetime_helpers import DatetimeWithNanoseconds
        from google.cloud.firestore_v1 import GeoPoint

        def timestamp_factory(iso_value: str, nanosecond: int) -> Any:
            parsed = DatetimeWithNanoseconds.fromisoformat(iso_value.replace("Z", "+00:00"))
            if nanosecond == parsed.microsecond * 1000:
                return parsed
            seconds = int(parsed.timestamp())
            return DatetimeWithNanoseconds.from_rfc3339(
                datetime.fromtimestamp(seconds, timezone.utc).strftime("%Y-%m-%dT%H:%M:%S")
                + f".{nanosecond:09d}Z"
            )

        return {
            "reference_factory": self.client.document,
            "geopoint_factory": GeoPoint,
            "timestamp_factory": timestamp_factory,
        }


__all__ = [
    "BACKUP_FORMAT",
    "BACKUP_SCHEMA_VERSION",
    "FirestoreAdminAdapter",
    "RESTORE_REPORT_SCHEMA_VERSION",
    "apply_restore_plan",
    "assert_approved_restore_report",
    "assert_safe_firestore_target",
    "build_restore_plan",
    "build_restore_report",
    "canonical_hash",
    "canonical_json",
    "decode_firestore_value",
    "encode_firestore_value",
    "export_recursive_firestore",
    "read_backup",
    "validate_backup",
    "write_json_atomic",
]
