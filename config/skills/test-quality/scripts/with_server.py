#!/usr/bin/env python3
"""Start one or more local dev servers, wait for their ports, run a command, then tear down.

Used by the `test e2e` flow in ../SKILL.md. Written to the interface that
SKILL.md documents:

    python scripts/with_server.py --server "npm run dev" --port 5173 -- python automation.py
    python scripts/with_server.py \
        --server "npm run dev" --port 5173 \
        --server "python mock_api.py" --port 8000 \
        -- python automation.py

Servers start in the order given and are killed in reverse order when the
command exits (or when it fails). Ports are polled before the command runs, so
an automation script never races the dev server.

Run with --help first; do not read this source unless a customized solution is
actually necessary.
"""

from __future__ import annotations

import argparse
import os
import signal
import socket
import subprocess
import sys
import time


def port_is_open(host: str, port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.settimeout(0.5)
        return sock.connect_ex((host, port)) == 0


def wait_for_port(host: str, port: int, timeout: float, proc: subprocess.Popen) -> None:
    """Block until the port accepts a connection, or fail loudly."""
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if proc.poll() is not None:
            raise SystemExit(
                f"server for {host}:{port} exited early with code {proc.returncode}"
            )
        if port_is_open(host, port):
            return
        time.sleep(0.2)
    raise SystemExit(f"timed out after {timeout:g}s waiting for {host}:{port}")


def terminate(proc: subprocess.Popen) -> None:
    if proc.poll() is not None:
        return
    try:
        os.killpg(os.getpgid(proc.pid), signal.SIGTERM)
    except (ProcessLookupError, PermissionError):
        proc.terminate()
    try:
        proc.wait(timeout=10)
    except subprocess.TimeoutExpired:
        try:
            os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
        except (ProcessLookupError, PermissionError):
            proc.kill()


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Run servers, then a command, then stop the servers."
    )
    parser.add_argument(
        "--server",
        action="append",
        default=[],
        metavar="CMD",
        help="shell command to start a server (repeatable, started in order)",
    )
    parser.add_argument(
        "--port",
        action="append",
        type=int,
        default=[],
        metavar="N",
        help="port that the matching --server must open (repeatable)",
    )
    parser.add_argument(
        "--host",
        default="127.0.0.1",
        help="host to poll (default: 127.0.0.1)",
    )
    parser.add_argument(
        "--timeout",
        type=float,
        default=30.0,
        help="seconds to wait for each port (default: 30)",
    )
    parser.add_argument(
        "command",
        nargs=argparse.REMAINDER,
        help="-- followed by the command to run once servers are up",
    )

    args = parser.parse_args()

    cmd = args.command
    if cmd and cmd[0] == "--":
        cmd = cmd[1:]
    if not cmd:
        parser.error("no command given; put it after `--`, e.g. `-- python your_script.py`")
    if not args.server:
        parser.error("at least one --server is required")
    if len(args.port) != len(args.server):
        parser.error(
            f"{len(args.server)} --server(s) but {len(args.port)} --port(s); "
            "give one --port per --server"
        )

    started: list[subprocess.Popen] = []
    try:
        for index, (server_cmd, port) in enumerate(zip(args.server, args.port), start=1):
            print(f"[with_server] starting: {server_cmd}  (port {port})", flush=True)
            proc = subprocess.Popen(
                server_cmd,
                shell=True,
                start_new_session=True,
            )
            started.append(proc)
            wait_for_port(args.host, port, args.timeout, proc)
            print(f"[with_server] ready: port {port} is open", flush=True)

        print(f"[with_server] running: {' '.join(cmd)}", flush=True)
        result = subprocess.run(cmd)
        return result.returncode
    finally:
        for proc in reversed(started):
            terminate(proc)
        print("[with_server] servers stopped", flush=True)


if __name__ == "__main__":
    sys.exit(main())