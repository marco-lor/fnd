# Python backend

The supported web surface is intentionally health-only:

```powershell
python -m pip install -r requirements.txt
uvicorn main:app --host 127.0.0.1 --port 8000
```

`GET /` preserves the historical response and `GET /healthz` returns a small
service status. Importing `main:app` never imports Firebase Admin, discovers
credentials, or initializes Firestore.

Firestore utilities are local maintenance commands, not HTTP routes. Install
their separate dependencies with:

```powershell
python -m pip install -r requirements-maintenance.txt
```

Every Firestore command is dry-run by default and requires `--project`. A
loopback `FIRESTORE_EMULATOR_HOST` is accepted only for a `demo-*` project.
Without an emulator, even read-only access requires both
`--allow-live-project` and an exact `--confirm-project <project-id>`. Mutating
commands additionally require their explicit execution switch.

Examples:

```powershell
python main.py --update-all-users --project demo-fnd-perf
python main.py --normalize-user-roles --project demo-fnd-perf
python backfill_npc_nome.py --project demo-fnd-perf
```

Maintenance output is limited to counts, stable content hashes, and error
classes/hashes. It must not print user IDs, roles, NPC names, document contents,
credential paths, or raw exception messages.
