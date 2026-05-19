import argparse
from pathlib import Path

from aiws.cli.runtime import (
    RuntimePaths,
    is_running,
    read_pid,
    read_status,
    start_api_daemon,
    start_cloudflare_quick_tunnel,
    stop_pid_file,
    write_status,
)


def cmd_start(args: argparse.Namespace) -> int:
    paths = RuntimePaths()
    workspace_root = Path(args.workspace).expanduser().resolve()
    api_pid = start_api_daemon(
        host=args.host,
        port=args.port,
        workspace_root=workspace_root,
        paths=paths,
    )
    cloudflare_pid = None
    if args.cloudflare:
        cloudflare_pid = start_cloudflare_quick_tunnel(port=args.port, paths=paths)
    write_status(
        paths,
        {
            "host": args.host,
            "port": args.port,
            "workspace_root": str(workspace_root),
            "api_pid": api_pid,
            "cloudflare_pid": cloudflare_pid,
            "local_url": f"http://{args.host}:{args.port}",
            "cloudflare": bool(args.cloudflare),
            "cloudflare_log": str(paths.cloudflare_log),
            "admin_url": f"http://{args.host}:{args.port}/admin",
        },
    )
    print(f"AIWS daemon started: http://{args.host}:{args.port}")
    if args.cloudflare:
        print(f"Cloudflare quick tunnel starting. Watch URL in {paths.cloudflare_log}")
    print(f"Admin dashboard: http://{args.host}:{args.port}/admin")
    return 0


def cmd_stop(_: argparse.Namespace) -> int:
    paths = RuntimePaths()
    stopped_cf = stop_pid_file(paths.cloudflare_pid)
    stopped_api = stop_pid_file(paths.api_pid)
    print(f"Stopped API: {stopped_api}")
    print(f"Stopped Cloudflare tunnel: {stopped_cf}")
    return 0


def cmd_status(_: argparse.Namespace) -> int:
    paths = RuntimePaths()
    status = read_status(paths)
    api_pid = read_pid(paths.api_pid)
    cloudflare_pid = read_pid(paths.cloudflare_pid)
    status["api_running"] = bool(api_pid and is_running(api_pid))
    status["cloudflare_running"] = bool(cloudflare_pid and is_running(cloudflare_pid))
    print(status)
    return 0


def cmd_logs(args: argparse.Namespace) -> int:
    paths = RuntimePaths()
    log_path = paths.cloudflare_log if args.cloudflare else paths.api_log
    if not log_path.exists():
        print(f"No log file at {log_path}")
        return 0
    lines = log_path.read_text(encoding="utf-8", errors="replace").splitlines()
    for line in lines[-args.lines :]:
        print(line)
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="aiws")
    subparsers = parser.add_subparsers(required=True)

    start = subparsers.add_parser("start", help="Start AIWS as a background daemon")
    start.add_argument("--host", default="127.0.0.1")
    start.add_argument("--port", type=int, default=8787)
    start.add_argument("--workspace", default=".aiws/workspace")
    start.add_argument("--cloudflare", action="store_true", help="Start Cloudflare quick tunnel")
    start.set_defaults(func=cmd_start)

    stop = subparsers.add_parser("stop", help="Stop AIWS daemon and tunnel")
    stop.set_defaults(func=cmd_stop)

    status = subparsers.add_parser("status", help="Show daemon status")
    status.set_defaults(func=cmd_status)

    logs = subparsers.add_parser("logs", help="Print recent daemon logs")
    logs.add_argument("--cloudflare", action="store_true")
    logs.add_argument("--lines", type=int, default=80)
    logs.set_defaults(func=cmd_logs)
    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    result = args.func(args)
    if not isinstance(result, int):
        return 1
    return result


if __name__ == "__main__":
    raise SystemExit(main())
