import json
import math
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path

try:
    from firestore_backup import (
        apply_restore_plan,
        assert_approved_restore_report,
        assert_safe_firestore_target,
        build_restore_plan,
        build_restore_report,
        canonical_hash,
        decode_firestore_value,
        encode_firestore_value,
        export_recursive_firestore,
        read_backup,
        validate_backup,
        write_json_atomic,
    )
except ModuleNotFoundError:  # Supports root-level unittest discovery.
    from backend.firestore_backup import (
        apply_restore_plan,
        assert_approved_restore_report,
        assert_safe_firestore_target,
        build_restore_plan,
        build_restore_report,
        canonical_hash,
        decode_firestore_value,
        encode_firestore_value,
        export_recursive_firestore,
        read_backup,
        validate_backup,
        write_json_atomic,
    )


DocumentReference = type(
    "DocumentReference",
    (),
    {"__init__": lambda self, path: setattr(self, "path", path)},
)
GeoPoint = type(
    "GeoPoint",
    (),
    {
        "__init__": lambda self, latitude, longitude: (
            setattr(self, "latitude", latitude),
            setattr(self, "longitude", longitude),
        )[-1]
    },
)


class FakeAdapter:
    def __init__(self, documents=None, collections=None):
        self.documents = dict(documents or {})
        self.collections = collections or {}
        self.writes = []

    def list_root_collections(self):
        return sorted(path for path in self.collections if "/" not in path)

    def list_documents(self, collection_path):
        paths = self.collections.get(collection_path, [])
        return [
            {
                "path": path,
                "exists": path in self.documents,
                "fields": self.documents.get(path, {}),
                "create_time": datetime(2026, 1, 1, tzinfo=timezone.utc),
                "update_time": datetime(2026, 1, 2, tzinfo=timezone.utc),
            }
            for path in paths
        ]

    def list_subcollections(self, document_path):
        prefix = f"{document_path}/"
        return sorted(
            collection_path[len(prefix):]
            for collection_path in self.collections
            if collection_path.startswith(prefix)
            and "/" not in collection_path[len(prefix):]
        )

    def get_document(self, document_path):
        if document_path not in self.documents:
            return None
        return {"path": document_path, "fields": self.documents[document_path]}

    def set_document(self, document_path, fields):
        self.writes.append(document_path)
        self.documents[document_path] = fields


class FirestoreBackupTests(unittest.TestCase):
    def test_value_encoding_is_unambiguous_and_round_trips_special_types(self):
        source = {
            "$firestore": "ordinary user key",
            "none": None,
            "bool": True,
            "integer": 2**60,
            "double": -0.0,
            "nan": float("nan"),
            "bytes": b"\x00private",
            "timestamp": datetime(2026, 1, 2, 3, 4, 5, 123456, tzinfo=timezone.utc),
            "reference": DocumentReference("users/example"),
            "point": GeoPoint(41.9, 12.5),
            "array": [1, "two"],
        }
        encoded = encode_firestore_value(source)
        decoded = decode_firestore_value(
            encoded,
            reference_factory=lambda path: ("reference", path),
            geopoint_factory=lambda lat, lon: ("point", lat, lon),
        )
        self.assertEqual(decoded["$firestore"], "ordinary user key")
        self.assertEqual(decoded["integer"], 2**60)
        self.assertEqual(math.copysign(1, decoded["double"]), -1)
        self.assertTrue(math.isnan(decoded["nan"]))
        self.assertEqual(decoded["bytes"], b"\x00private")
        self.assertEqual(decoded["reference"], ("reference", "users/example"))
        self.assertEqual(decoded["point"], ("point", 41.9, 12.5))

    def test_recursive_export_is_deterministic_and_includes_all_subcollections(self):
        adapter = FakeAdapter(
            documents={
                "users/u1": {"email": "private@example.test", "level": 2},
                "users/u1/inventory/i1": {"name": "Sword"},
                "users/u1/inventory/i1/audit/a1": {"event": "created"},
                "utils/schema": {"version": 1},
            },
            collections={
                "users": ["users/u1"],
                "users/u1/inventory": ["users/u1/inventory/i1"],
                "users/u1/inventory/i1/audit": ["users/u1/inventory/i1/audit/a1"],
                "utils": ["utils/schema"],
            },
        )
        fixed_time = datetime(2026, 7, 22, tzinfo=timezone.utc)
        first = export_recursive_firestore(adapter, project_id="demo-fnd", generated_at=fixed_time)
        second = export_recursive_firestore(adapter, project_id="demo-fnd", generated_at=fixed_time)
        self.assertEqual(first["canonicalHash"], second["canonicalHash"])
        self.assertEqual(first["counts"], {"rootCollections": 2, "documents": 4, "subcollections": 2})
        self.assertEqual(
            [document["path"] for document in first["documents"]],
            [
                "users/u1",
                "users/u1/inventory/i1",
                "users/u1/inventory/i1/audit/a1",
                "utils/schema",
            ],
        )
        validate_backup(first, expected_project_id="demo-fnd")

    def test_recursive_export_traverses_subcollections_below_missing_parent(self):
        adapter = FakeAdapter(
            documents={"users/missing/inventory/i1": {"name": "Preserved"}},
            collections={
                "users": ["users/missing"],
                "users/missing/inventory": ["users/missing/inventory/i1"],
            },
        )
        backup = export_recursive_firestore(adapter, project_id="demo-fnd")
        self.assertEqual(
            [document["path"] for document in backup["documents"]],
            ["users/missing/inventory/i1"],
        )
        self.assertEqual(backup["counts"]["subcollections"], 1)

    def test_validation_detects_document_and_manifest_tampering(self):
        adapter = FakeAdapter(
            documents={"users/u1": {"gold": 1}},
            collections={"users": ["users/u1"]},
        )
        backup = export_recursive_firestore(adapter, project_id="demo-fnd")
        tampered = json.loads(json.dumps(backup))
        tampered["documents"][0]["fields"]["value"]["gold"]["value"] = "999"
        with self.assertRaisesRegex(ValueError, "document hash mismatch"):
            validate_backup(tampered)

        manifest_tampered = json.loads(json.dumps(backup))
        manifest_tampered["rootCollections"] = []
        with self.assertRaisesRegex(ValueError, "canonical hash mismatch"):
            validate_backup(manifest_tampered)

    def test_atomic_backup_file_can_be_read_and_verified(self):
        adapter = FakeAdapter(
            documents={"utils/schema": {"version": 1}},
            collections={"utils": ["utils/schema"]},
        )
        backup = export_recursive_firestore(adapter, project_id="demo-fnd")
        with tempfile.TemporaryDirectory() as directory:
            file_path = Path(directory) / "backup.json"
            write_json_atomic(file_path, backup)
            loaded = read_backup(file_path, expected_project_id="demo-fnd")
            self.assertEqual(loaded["canonicalHash"], backup["canonicalHash"])
            self.assertFalse(any(path.name.endswith(".tmp") for path in Path(directory).iterdir()))

    def test_restore_plan_is_dry_run_redacted_and_non_destructive(self):
        source = FakeAdapter(
            documents={
                "users/u1": {"secret": "alpha"},
                "users/u1/inventory/i1": {"name": "Sword"},
            },
            collections={
                "users": ["users/u1"],
                "users/u1/inventory": ["users/u1/inventory/i1"],
            },
        )
        backup = export_recursive_firestore(source, project_id="demo-fnd")
        target = FakeAdapter(documents={"users/u1": {"secret": "old"}})
        plan = build_restore_plan(target, backup, project_id="demo-fnd")
        report = build_restore_report(plan)
        self.assertEqual(plan["counts"], {"documents": 2, "create": 1, "update": 1, "unchanged": 0})
        self.assertEqual(target.writes, [])
        serialized_report = json.dumps(report)
        self.assertNotIn("users/u1", serialized_report)
        self.assertNotIn("alpha", serialized_report)
        self.assertNotIn("Sword", serialized_report)
        self.assertEqual(len(report["documents"][0]["pathHash"]), 64)

    def test_restore_requires_exact_report_and_verifies_each_write(self):
        source = FakeAdapter(
            documents={"users/u1": {"gold": 10}, "utils/schema": {"version": 2}},
            collections={"users": ["users/u1"], "utils": ["utils/schema"]},
        )
        backup = export_recursive_firestore(source, project_id="demo-fnd")
        target = FakeAdapter()
        plan = build_restore_plan(target, backup, project_id="demo-fnd")
        report = build_restore_report(plan)
        assert_approved_restore_report(
            report,
            plan,
            approved_fingerprint=plan["planFingerprint"],
        )
        with self.assertRaisesRegex(ValueError, "does not match"):
            assert_approved_restore_report(report, plan, approved_fingerprint="0" * 64)

        result = apply_restore_plan(target, plan)
        self.assertEqual(result, {"written": 2, "unchanged": 0})
        self.assertEqual(target.writes, ["users/u1", "utils/schema"])
        repeated = build_restore_plan(target, backup, project_id="demo-fnd")
        self.assertEqual(repeated["counts"]["unchanged"], 2)

    def test_target_safety_refuses_implicit_live_access_and_project_mismatch(self):
        with self.assertRaisesRegex(ValueError, "Live Firestore access is refused"):
            assert_safe_firestore_target(
                project_id="fatins",
                allow_live_project=False,
                confirm_project="",
                environment={},
            )
        self.assertEqual(
            assert_safe_firestore_target(
                project_id="fatins",
                allow_live_project=True,
                confirm_project="fatins",
                environment={},
            )["live"],
            True,
        )
        self.assertEqual(
            assert_safe_firestore_target(
                project_id="demo-fnd",
                allow_live_project=False,
                confirm_project="",
                environment={"FIRESTORE_EMULATOR_HOST": "127.0.0.1:8080"},
            )["live"],
            False,
        )
        with self.assertRaisesRegex(ValueError, "does not match"):
            assert_safe_firestore_target(
                project_id="demo-fnd",
                allow_live_project=False,
                confirm_project="",
                environment={
                    "FIRESTORE_EMULATOR_HOST": "127.0.0.1:8080",
                    "GOOGLE_CLOUD_PROJECT": "another-project",
                },
            )

    def test_live_restore_execution_is_blocked_but_dry_run_and_demo_are_safe(self):
        live_dry_run = assert_safe_firestore_target(
            project_id="fatins",
            allow_live_project=True,
            confirm_project="fatins",
            operation="restore",
            execute=False,
            environment={},
        )
        self.assertTrue(live_dry_run["live"])
        with self.assertRaisesRegex(ValueError, "pause fence"):
            assert_safe_firestore_target(
                project_id="fatins",
                allow_live_project=True,
                confirm_project="fatins",
                operation="restore",
                execute=True,
                environment={},
            )
        demo_execute = assert_safe_firestore_target(
            project_id="demo-fnd",
            allow_live_project=False,
            confirm_project="",
            operation="restore",
            execute=True,
            environment={"FIRESTORE_EMULATOR_HOST": "localhost:8080"},
        )
        self.assertFalse(demo_execute["live"])

    def test_restore_plan_refuses_changed_control_documents(self):
        source = FakeAdapter(
            documents={"app_config/user_data_v2": {"mode": "new-only"}},
            collections={"app_config": ["app_config/user_data_v2"]},
        )
        backup = export_recursive_firestore(source, project_id="demo-fnd")
        with self.assertRaisesRegex(ValueError, "protected Task 05 control"):
            build_restore_plan(FakeAdapter(), backup, project_id="demo-fnd")

        unchanged = FakeAdapter(
            documents={"app_config/user_data_v2": {"mode": "new-only"}}
        )
        plan = build_restore_plan(unchanged, backup, project_id="demo-fnd")
        self.assertEqual(plan["counts"]["unchanged"], 1)

    def test_backup_project_must_match_restore_target(self):
        source = FakeAdapter(
            documents={"utils/schema": {"version": 1}},
            collections={"utils": ["utils/schema"]},
        )
        backup = export_recursive_firestore(source, project_id="demo-source")
        with self.assertRaisesRegex(ValueError, "project ID does not match"):
            build_restore_plan(FakeAdapter(), backup, project_id="demo-target")


if __name__ == "__main__":
    unittest.main()
