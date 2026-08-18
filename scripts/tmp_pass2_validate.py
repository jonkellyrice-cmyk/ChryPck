from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]

required = [
    "src/core/run/request-envelope.ts",
    "src/core/run/run-state.ts",
    "src/core/run/run-store.ts",
    "src/core/run/orchestrator.ts",
    "src/core/run/telemetry.ts",
    "src/core/run/failure-evidence.ts",
    "test/pass2-run-core.test.ts",
]

for rel in required:
    path = ROOT / rel
    if not path.is_file():
        raise SystemExit(f"[pass2:validate] missing required file: {rel}")
    text = path.read_text(encoding="utf-8")
    if "export {};" in text:
        raise SystemExit(f"[pass2:validate] placeholder remains in: {rel}")

server = (ROOT / "src/server.ts").read_text(encoding="utf-8")
for marker in ["NativeOrchestrator", "native_run_id", "envelope_fingerprint", "native_state"]:
    if marker not in server:
        raise SystemExit(f"[pass2:validate] live MCP wiring missing marker: {marker}")

print("[pass2:validate] structural checks passed")

install = subprocess.run(["npm", "install"], cwd=ROOT)
if install.returncode != 0:
    raise SystemExit(install.returncode)

check = subprocess.run(["npm", "run", "check"], cwd=ROOT)
if check.returncode != 0:
    raise SystemExit(check.returncode)

print("[pass2:validate] npm run check passed")
print("[pass2:validate] PASS 2 validation succeeded")
