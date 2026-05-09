"""Command-line interface for AIWS."""

from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path

from . import runner
from . import costs
from .env import load_env
from . import storage
from .runtime import LocalRuntime
from .supervisor import StatusSupervisor
from .ui import start_ui


def add_root(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--root", required=True, help="Workspace root path.")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="aiws")
    subcommands = parser.add_subparsers(dest="command", required=True)

    init = subcommands.add_parser("init", help="Initialize a workspace.")
    add_root(init)

    backup = subcommands.add_parser("backup", help="Create or restore workspace backups.")
    backup_sub = backup.add_subparsers(dest="backup_command", required=True)
    backup_create = backup_sub.add_parser("create", help="Create a compressed workspace backup.")
    backup_create.add_argument("--output", required=True)
    add_root(backup_create)
    backup_restore = backup_sub.add_parser("restore", help="Restore a compressed workspace backup.")
    backup_restore.add_argument("archive")
    backup_restore.add_argument("--replace", action="store_true")
    add_root(backup_restore)

    skills = subcommands.add_parser("skills", help="Manage skills.")
    skills_sub = skills.add_subparsers(dest="skills_command", required=True)
    skills_list = skills_sub.add_parser("list", help="List skills.")
    add_root(skills_list)

    models = subcommands.add_parser("models", help="Inspect model costs.")
    models_sub = models.add_subparsers(dest="models_command", required=True)
    models_costs = models_sub.add_parser("costs", help="List model cost estimates.")
    add_root(models_costs)

    account = subcommands.add_parser("account", help="Manage accounts.")
    account_sub = account.add_subparsers(dest="account_command", required=True)
    account_create = account_sub.add_parser("create", help="Create an account.")
    account_create.add_argument("username")
    account_create.add_argument("--password", required=True)
    account_create.add_argument("--display-name", default="")
    account_create.add_argument("--admin", action="store_true")
    add_root(account_create)
    account_list = account_sub.add_parser("list", help="List accounts.")
    add_root(account_list)
    account_update = account_sub.add_parser("update", help="Update account profile.")
    account_update.add_argument("username")
    account_update.add_argument("--name")
    account_update.add_argument("--age")
    account_update.add_argument("--job")
    account_update.add_argument("--situation")
    account_update.add_argument("--language", choices=["ko", "en"])
    account_update.add_argument("--ui-mode", choices=["easy", "power"])
    account_update.add_argument("--memory")
    add_root(account_update)

    project = subcommands.add_parser("project", help="Manage projects.")
    project_sub = project.add_subparsers(dest="project_command", required=True)
    project_create = project_sub.add_parser("create", help="Create a project or subproject.")
    project_create.add_argument("title")
    project_create.add_argument("--parent")
    project_create.add_argument("--slug")
    project_create.add_argument("--notes", default="")
    project_create.add_argument("--skills", action="append", default=[])
    project_create.add_argument("--owner")
    project_create.add_argument("--visibility", choices=["private", "public"], default="private")
    add_root(project_create)
    project_list = project_sub.add_parser("list", help="List projects.")
    project_list.add_argument("--user")
    add_root(project_list)

    session = subcommands.add_parser("session", help="Manage sessions.")
    session_sub = session.add_subparsers(dest="session_command", required=True)
    session_create = session_sub.add_parser("create", help="Create a session.")
    session_create.add_argument("project_path")
    session_create.add_argument("title")
    session_create.add_argument("--slug")
    add_root(session_create)
    session_append = session_sub.add_parser("append", help="Append a message.")
    session_append.add_argument("project_path")
    session_append.add_argument("session_slug")
    session_append.add_argument("--role", required=True)
    session_append.add_argument("--content", required=True)
    session_append.add_argument("--provider")
    session_append.add_argument("--model")
    session_append.add_argument("--actor")
    add_root(session_append)
    session_list = session_sub.add_parser("list", help="List sessions.")
    session_list.add_argument("project_path")
    add_root(session_list)

    prompt = subcommands.add_parser("prompt", help="Print prompt context.")
    prompt.add_argument("project_path")
    prompt.add_argument("session_slug")
    add_root(prompt)

    goal = subcommands.add_parser("goal", help="Show or update project goals.")
    goal.add_argument("project_or_action")
    goal.add_argument("project_or_session", nargs="?")
    goal.add_argument("session_slug", nargs="?")
    goal.add_argument("--file")
    add_root(goal)

    ask = subcommands.add_parser("ask", help="Append a user message, call a provider, and store the response.")
    ask.add_argument("project_path")
    ask.add_argument("session_slug")
    ask.add_argument("--provider", required=True, choices=["ollama", "kimi", "gemini", "openai"])
    ask.add_argument("--model", required=True)
    ask.add_argument("--content", required=True)
    ask.add_argument("--actor")
    ask.add_argument("--search-mode", choices=["off", "auto", "always"], default="off")
    ask.add_argument("--allow-remote", action="store_true")
    ask.add_argument("--confirm-cost", action="store_true")
    add_root(ask)

    code = subcommands.add_parser("code", help="Run programming-mode commands and archive them in a session.")
    code_sub = code.add_subparsers(dest="code_command", required=True)
    code_run = code_sub.add_parser("run", help="Execute a shell command and store command/output events.")
    code_run.add_argument("project_path")
    code_run.add_argument("session_slug")
    code_run.add_argument("--command", dest="shell_command", required=True)
    code_run.add_argument("--title", default="Programming run")
    code_run.add_argument("--actor")
    code_run.add_argument("--cwd", default=".")
    add_root(code_run)

    run_command = subcommands.add_parser("run", help="Run AIWS UI and optional local model services.")
    run_command.add_argument("--mode", choices=["local", "server"], default="local")
    run_command.add_argument("--port", type=int, default=8765)
    run_command.add_argument("--password")
    run_command.add_argument("--models", default="ollama", help="Comma-separated local services to start. Supported: ollama, none.")
    run_command.add_argument("--idle-timeout", type=int, default=1800, help="Seconds before idle local model services are stopped. 0 disables idle stop.")
    run_command.add_argument("--status-path")
    add_root(run_command)

    supervise = subcommands.add_parser("supervise", help="Run and monitor a command.")
    supervise.add_argument("--status-path")
    supervise.add_argument("supervised_command", nargs=argparse.REMAINDER)

    ui = subcommands.add_parser("ui", help="Run UI.")
    ui_sub = ui.add_subparsers(dest="ui_command", required=True)
    ui_start = ui_sub.add_parser("start", help="Start the UI server.")
    ui_start.add_argument("--mode", choices=["local", "server"], required=True)
    ui_start.add_argument("--port", type=int, default=8765)
    ui_start.add_argument("--password")
    add_root(ui_start)

    return parser


def run(args: argparse.Namespace) -> int:
    if args.command == "init":
        root = storage.init_workspace(args.root)
        storage.copy_default_skill_to_repo(Path("skills"))
        print(f"Initialized workspace: {root}")
        return 0

    if args.command == "skills" and args.skills_command == "list":
        storage.init_workspace(args.root)
        for skill in storage.list_skills(args.root):
            print(skill)
        return 0

    if args.command == "backup" and args.backup_command == "create":
        path = storage.create_workspace_backup(args.root, args.output)
        print(path)
        return 0

    if args.command == "backup" and args.backup_command == "restore":
        path = storage.restore_workspace_backup(args.archive, args.root, replace=args.replace)
        print(path)
        return 0

    if args.command == "models" and args.models_command == "costs":
        for item in costs.list_model_costs():
            print(
                f"{item.provider}\t{item.model}\t"
                f"input=${item.input_per_million}/M\toutput=${item.output_per_million}/M\t{item.note}"
            )
        return 0

    if args.command == "account" and args.account_command == "create":
        account = storage.create_account(
            args.root,
            args.username,
            args.password,
            admin=args.admin,
            display_name=args.display_name,
        )
        print(f"{account['username']}\tadmin={account['admin']}")
        return 0

    if args.command == "account" and args.account_command == "list":
        for account in storage.list_accounts(args.root):
            usage = account.get("usage", {})
            print(
                f"{account['username']}\tadmin={account['admin']}\t"
                f"messages={usage.get('messages', 0)}\tasks={usage.get('asks', 0)}"
            )
        return 0

    if args.command == "account" and args.account_command == "update":
        account = storage.update_account_profile(
            args.root,
            args.username,
            name=args.name,
            age=args.age,
            job=args.job,
            situation=args.situation,
            language=args.language,
            ui_mode=args.ui_mode,
            memory=args.memory,
        )
        print(f"{account['username']}\tlanguage={account.get('profile', {}).get('language', 'ko')}")
        return 0

    if args.command == "project" and args.project_command == "create":
        skills = []
        for item in args.skills:
            skills.extend(part.strip() for part in item.split(",") if part.strip())
        project = storage.create_project(
            args.root,
            args.title,
            parent=args.parent,
            slug=args.slug,
            notes=args.notes,
            skills=skills,
            owner=args.owner,
            visibility=args.visibility,
        )
        print(project["path"])
        return 0

    if args.command == "project" and args.project_command == "list":
        projects = storage.list_visible_projects(args.root, args.user) if args.user else storage.list_projects(args.root)
        for project in projects:
            print(
                f"{project['path']}\t{project['title']}\t"
                f"owner={project.get('owner') or '-'}\tvisibility={project.get('visibility', 'private')}"
            )
        return 0

    if args.command == "session" and args.session_command == "create":
        session = storage.create_session(args.root, args.project_path, args.title, slug=args.slug)
        print(session["slug"])
        return 0

    if args.command == "session" and args.session_command == "append":
        storage.append_message(
            args.root,
            args.project_path,
            args.session_slug,
            role=args.role,
            content=args.content,
            provider=args.provider,
            model=args.model,
            actor=args.actor,
        )
        print("Message appended.")
        return 0

    if args.command == "session" and args.session_command == "list":
        for session in storage.list_sessions(args.root, args.project_path):
            print(f"{session['slug']}\t{session['title']}")
        return 0

    if args.command == "prompt":
        print(storage.build_prompt_context(args.root, args.project_path, args.session_slug), end="")
        return 0

    if args.command == "goal":
        if args.project_or_action == "set":
            if not args.project_or_session:
                raise storage.WorkspaceError("goal set requires a project path.")
            if not args.file:
                raise storage.WorkspaceError("goal set requires --file.")
            markdown = Path(args.file).read_text(encoding="utf-8")
            goal = storage.set_goal_from_markdown(args.root, args.project_or_session, markdown)
            print(storage.goal_to_markdown(goal), end="")
            return 0
        print(
            storage.codex_goal_prompt(
                args.root,
                args.project_or_action,
                args.project_or_session,
            ),
            end="",
        )
        return 0

    if args.command == "ask":
        response = runner.ask(
            args.root,
            args.project_path,
            args.session_slug,
            provider=args.provider,
            model=args.model,
            content=args.content,
            actor=args.actor,
            search_mode=args.search_mode,
            allow_remote=args.allow_remote,
            confirm_cost=args.confirm_cost,
        )
        print(response)
        return 0

    if args.command == "code" and args.code_command == "run":
        run_record = storage.create_execution_run(
            args.root,
            args.project_path,
            args.session_slug,
            title=args.title,
            actor=args.actor,
        )
        storage.append_run_event(
            args.root,
            args.project_path,
            args.session_slug,
            run_record["id"],
            event_type="command",
            content=f"$ {args.shell_command}",
            metadata={"cwd": str(Path(args.cwd).resolve())},
            actor=args.actor,
        )
        result = subprocess.run(
            args.shell_command,
            cwd=args.cwd,
            shell=True,
            capture_output=True,
            text=True,
            check=False,
        )
        output = result.stdout
        if result.stderr:
            output += ("\n" if output else "") + result.stderr
        storage.append_run_event(
            args.root,
            args.project_path,
            args.session_slug,
            run_record["id"],
            event_type="output",
            content=output or "(no output)",
            metadata={"returncode": result.returncode},
            actor=args.actor,
        )
        storage.update_execution_run_status(
            args.root,
            args.project_path,
            args.session_slug,
            run_record["id"],
            "completed" if result.returncode == 0 else "failed",
        )
        print(run_record["id"])
        return result.returncode

    if args.command == "run":
        models = {item.strip().lower() for item in args.models.split(",") if item.strip()}
        runtime = LocalRuntime(
            root=args.root,
            mode=args.mode,
            port=args.port,
            password=args.password,
            start_ollama="ollama" in models,
            idle_timeout=args.idle_timeout,
            status_path=args.status_path,
        )
        runtime.run_forever()
        return 0

    if args.command == "supervise":
        if not args.supervised_command:
            raise storage.WorkspaceError("supervise requires a command.")
        command = args.supervised_command
        if command and command[0] == "--":
            command = command[1:]
        supervisor = StatusSupervisor(command)
        supervisor.run_forever(args.status_path)
        return 0

    if args.command == "ui" and args.ui_command == "start":
        start_ui(args.root, mode=args.mode, port=args.port, password=args.password)
        return 0

    raise storage.WorkspaceError("Unsupported command.")


def main(argv: list[str] | None = None) -> int:
    load_env()
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        return run(args)
    except storage.WorkspaceError as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
