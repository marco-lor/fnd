import contextlib
import io
import json
import subprocess
import sys
import textwrap
import unittest
from pathlib import Path

try:
    from backfill_npc_nome import run_backfill
    from maintenance_cli import (
        normalize_user_roles,
        run_admin_cli,
        run_call_on_everyone,
    )
except ImportError:
    from backend.backfill_npc_nome import run_backfill
    from backend.maintenance_cli import (
        normalize_user_roles,
        run_admin_cli,
        run_call_on_everyone,
    )


BACKEND_DIR = Path(__file__).resolve().parent


class FakeSnapshot:
    def __init__(self, doc_id, data):
        self.id = doc_id
        self._data = data
        self.reference = f"ref:{doc_id}"

    def get(self, field):
        return self._data.get(field)

    def to_dict(self):
        return dict(self._data)


class FakeBatch:
    def __init__(self, owner):
        self.owner = owner
        self.updates = []

    def update(self, reference, payload):
        self.updates.append((reference, payload))

    def commit(self):
        self.owner.committed_batch_sizes.append(len(self.updates))


class FakeQuery:
    def __init__(self, collection, *, limit_count=None, cursor=None):
        self.collection = collection
        self.limit_count = limit_count
        self.cursor = cursor

    def limit(self, count):
        self.collection.requested_page_sizes.append(count)
        return FakeQuery(
            self.collection,
            limit_count=count,
            cursor=self.cursor,
        )

    def start_after(self, cursor):
        return FakeQuery(
            self.collection,
            limit_count=self.limit_count,
            cursor=cursor,
        )

    def stream(self):
        start = 0
        if self.cursor is not None:
            start = self.collection.snapshots.index(self.cursor) + 1
        end = start + self.limit_count
        page = self.collection.snapshots[start:end]
        self.collection.streamed_page_sizes.append(len(page))
        return iter(page)


class FakeCollection:
    def __init__(self, snapshots):
        self.snapshots = sorted(snapshots, key=lambda snapshot: snapshot.id)
        self.document_calls = []
        self.order_by_calls = []
        self.requested_page_sizes = []
        self.streamed_page_sizes = []

    def stream(self):
        return iter(self.snapshots)

    def order_by(self, field):
        self.order_by_calls.append(field)
        return FakeQuery(self)

    def document(self, doc_id):
        self.document_calls.append(doc_id)
        return f"ref:{doc_id}"


class FakeDatabase:
    def __init__(self, snapshots):
        self.collection_ref = FakeCollection(snapshots)
        self.committed_batch_sizes = []
        self.batch_calls = 0

    def collection(self, name):
        if name not in {"users", "echi_npcs"}:
            raise AssertionError(f"Unexpected collection: {name}")
        return self.collection_ref

    def batch(self):
        self.batch_calls += 1
        return FakeBatch(self)


class HealthSurfaceTests(unittest.TestCase):
    def test_health_contracts_and_main_import_are_firebase_free(self):
        script = textwrap.dedent(
            """
            import importlib.util
            import json
            import sys
            import types

            if importlib.util.find_spec("fastapi") is None:
                class FakeFastAPI:
                    def __init__(self):
                        self.routes = {}

                    def add_middleware(self, *_args, **_kwargs):
                        return None

                    def get(self, path):
                        def register(function):
                            self.routes[path] = function
                            return function
                        return register

                fastapi_module = types.ModuleType("fastapi")
                fastapi_module.FastAPI = FakeFastAPI
                middleware_module = types.ModuleType("fastapi.middleware")
                cors_module = types.ModuleType("fastapi.middleware.cors")
                cors_module.CORSMiddleware = object
                sys.modules["fastapi"] = fastapi_module
                sys.modules["fastapi.middleware"] = middleware_module
                sys.modules["fastapi.middleware.cors"] = cors_module

            import main
            import health_app

            print(json.dumps({
                "has_app": hasattr(main, "app"),
                "root": health_app.read_root(),
                "healthz": health_app.read_healthz(),
                "firebase": any(
                    name == "firebase_admin" or name.startswith("firebase_admin.")
                    for name in sys.modules
                ),
                "maintenance": "maintenance_cli" in sys.modules,
                "backup": "firestore_backup" in sys.modules,
            }))
            """
        )
        result = subprocess.run(
            [sys.executable, "-c", script],
            cwd=BACKEND_DIR,
            check=True,
            capture_output=True,
            text=True,
        )
        self.assertEqual(
            json.loads(result.stdout.strip().splitlines()[-1]),
            {
                "has_app": True,
                "root": {"message": "Hello from FastAPI - DnD Game Backend!"},
                "healthz": {"status": "ok", "service": "fnd-backend"},
                "firebase": False,
                "maintenance": False,
                "backup": False,
            },
        )

    def test_firebase_connection_module_is_lazy(self):
        script = (
            "import json,sys; "
            "import firebase_conn; "
            "print(json.dumps({"
            "'has_factory': hasattr(firebase_conn, 'get_db'), "
            "'firebase': any(n == 'firebase_admin' or n.startswith('firebase_admin.') for n in sys.modules)"
            "}))"
        )
        result = subprocess.run(
            [sys.executable, "-c", script],
            cwd=BACKEND_DIR,
            check=True,
            capture_output=True,
            text=True,
        )
        self.assertEqual(
            json.loads(result.stdout),
            {"has_factory": True, "firebase": False},
        )


class MaintenanceTests(unittest.TestCase):
    def test_streamed_users_are_not_refetched(self):
        database = FakeDatabase([
            FakeSnapshot("u1", {"stats": {"level": 2}}),
            FakeSnapshot("u2", {"stats": {"level": 3}}),
        ])
        with contextlib.redirect_stdout(io.StringIO()):
            result = run_call_on_everyone(database=database)

        self.assertEqual(result["checked"], 2)
        self.assertEqual(database.collection_ref.document_calls, [])

    def test_role_writes_are_batched_at_four_hundred(self):
        database = FakeDatabase([
            FakeSnapshot(f"private-{index}", {"role": "players"})
            for index in range(805)
        ])
        with contextlib.redirect_stdout(io.StringIO()):
            result = normalize_user_roles(database=database, dry_run=False)

        self.assertEqual(result["updated"], 805)
        self.assertEqual(result["commits"], 3)
        self.assertEqual(database.committed_batch_sizes, [400, 400, 5])
        self.assertLessEqual(max(database.committed_batch_sizes), 400)

    def test_role_dry_run_does_not_write_or_leak_values(self):
        database = FakeDatabase([
            FakeSnapshot("private-user-id", {"role": "Top Secret Role"}),
        ])
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            result = normalize_user_roles(database=database, dry_run=True)

        self.assertEqual(result["invalid"], 1)
        self.assertEqual(database.batch_calls, 0)
        self.assertNotIn("private-user-id", output.getvalue())
        self.assertNotIn("Top Secret Role", output.getvalue())

    def test_role_batch_limit_is_enforced(self):
        with self.assertRaisesRegex(ValueError, "between 1 and 400"):
            normalize_user_roles(
                database=FakeDatabase([]),
                dry_run=False,
                batch_size=401,
            )

    def test_cli_refuses_implicit_live_access_before_client_creation(self):
        factory_called = False

        def db_factory(**_kwargs):
            nonlocal factory_called
            factory_called = True
            return FakeDatabase([])

        with contextlib.redirect_stderr(io.StringIO()):
            with self.assertRaises(SystemExit):
                run_admin_cli(
                    ["--normalize-user-roles", "--project", "fatins"],
                    db_factory=db_factory,
                    environment={},
                )
        self.assertFalse(factory_called)

    def test_cli_accepts_only_loopback_demo_emulator_without_live_flags(self):
        database = FakeDatabase([])
        result = run_admin_cli(
            ["--normalize-user-roles", "--project", "demo-fnd-perf"],
            db_factory=lambda **_kwargs: database,
            environment={"FIRESTORE_EMULATOR_HOST": "127.0.0.1:8080"},
        )
        self.assertEqual(result["status"], "dry-run")
        self.assertEqual(database.batch_calls, 0)

    def test_npc_backfill_batches_and_redacts(self):
        database = FakeDatabase([
            FakeSnapshot(
                f"private-npc-{index}",
                {"description": f"Secret NPC Name {index}"},
            )
            for index in range(801)
        ])
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            result = run_backfill(database=database, apply_changes=True)

        self.assertEqual(result["written"], 801)
        self.assertEqual(database.committed_batch_sizes, [400, 400, 1])
        self.assertEqual(database.collection_ref.streamed_page_sizes, [400, 400, 1])
        self.assertTrue(
            all(size <= 400 for size in database.collection_ref.requested_page_sizes)
        )
        self.assertEqual(len(database.collection_ref.order_by_calls), 1)
        self.assertNotIn("private-npc-", output.getvalue())
        self.assertNotIn("Secret NPC Name", output.getvalue())

    def test_npc_dry_run_retains_only_five_redacted_samples(self):
        database = FakeDatabase([
            FakeSnapshot(f"private-npc-{index}", {"description": f"Secret {index}"})
            for index in range(12)
        ])
        with contextlib.redirect_stdout(io.StringIO()):
            result = run_backfill(
                database=database,
                apply_changes=False,
                page_size=5,
            )

        self.assertEqual(result["checked"], 12)
        self.assertEqual(result["wouldUpdate"], 12)
        self.assertEqual(len(result["sampleHashes"]), 5)
        self.assertEqual(database.batch_calls, 0)
        self.assertEqual(database.collection_ref.streamed_page_sizes, [5, 5, 2])


if __name__ == "__main__":
    unittest.main()
