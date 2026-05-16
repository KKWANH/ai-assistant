# AIWS Product Model

AIWS is a local-first workflow app platform for project folders, not a generic chat surface.

## Chat

A lightweight conversation. Chats can attach files, create context receipts, and save useful answers as artifacts. A chat can be promoted into a project when it becomes durable work.

## Project

A bounded local workspace with files, chats, workflow apps, artifacts, and explicit linked resources. Project nesting remains shallow: root project plus one optional subproject level.

## Workflow App

A repeatable project app with typed inputs, typed outputs, run policy, permissions, and viewer slots. It is the user-facing replacement for vague "Action" language.

## Execution / Run

A traceable execution record. Runs contain inputs, steps, receipts, logs, model calls, artifacts, status, and errors. Internal backend code may still use `action` as an execution concept.

## Artifact

A reusable output file, such as Markdown reports, CSV tables, JSON profiles, chart specs, logs, or images. Artifacts are rendered through allowlisted viewer plugins.

## Viewer

A safe frontend renderer selected by `viewer_id`. Viewers are registry plugins, not arbitrary project code. Workspace files cannot inject new browser modules.

## Linked Resource

A typed artifact or resource that one project explicitly exports and another project explicitly imports through an approved `ProjectLink`. Cross-project access is deny-by-default.
