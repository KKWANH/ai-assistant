# Project Connections Fixture

This fixture demonstrates explicit links instead of deeper nested projects.

- `food` exports `recipe_result` and `nutrition_snapshot`.
- `diet` imports `nutrition_snapshot` and exports `meal_log`.
- `exercise` imports `meal_log`, combines it with `activity_log`, and exports `calorie_balance`.

Each folder is meant to be copied into `projects/<name>/aiws.yaml`. A project cannot read another project's data until a `ProjectLink` is approved in the Connections tab.
