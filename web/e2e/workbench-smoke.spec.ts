import { expect, test, type Page } from "@playwright/test";

async function mockApi(page: Page) {
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/workspace") return route.fulfill({ json: {
      account: { username: "local", admin: true, profile: { ui_mode: "power", language: "en" }, model_catalog: [] },
      projects: [{ path: "demo", title: "Demo Project", sessions: [{ slug: "chat", title: "Planning chat", created_at: "2026-01-01T00:00:00Z" }] }],
      general_chats: [],
    } });
    if (path === "/api/home") return route.fulfill({ json: { home: { actions: [], runs: [], artifacts: [] } } });
    if (path === "/api/runtime") return route.fulfill({ json: { runtime: { diagnostics_visible: false } } });
    if (path === "/api/openclaw") return route.fulfill({ json: { openclaw: { installed: false } } });
    if (path === "/api/automations") return route.fulfill({ json: { projects: [] } });
    if (path === "/api/chat/demo/chat") return route.fulfill({ json: {
      project: { path: "demo", title: "Demo Project" },
      session: { slug: "chat", title: "Planning chat" },
      messages: [],
      skills: [],
      context_manifest: {},
    } });
    if (path === "/api/project-config/demo") return route.fulfill({ json: projectConfigPayload() });
    if (path === "/api/sessions/demo") return route.fulfill({ json: { session: { slug: "dock-chat", title: "Dock chat" } } });
    if (path === "/api/ask/demo/dock-chat") return route.fulfill({ json: {
      project: { path: "demo", title: "Demo Project" },
      session: { slug: "dock-chat", title: "Dock chat" },
      messages: [{ role: "assistant", content: "Scoped answer saved with receipt.", attachments: [] }],
    } });
    if (path === "/api/project-connections/demo") {
    if (route.request().method() === "POST") {
      return route.fulfill({ status: 400, json: { error: "Account cannot access project: food" } });
    }
    return route.fulfill({ json: { connections: projectConfigPayload().connections } });
    }
    return route.fulfill({ json: {} });
  });
}

function projectConfigPayload() {
  return {
    config: {
      name: "Demo Project",
      description: "Workflow App demo",
      commands: {
        investment_rebalancer: {
          kind: "python_script",
          label: "Investment Rebalancer",
          description: "Portfolio CSV to rebalance outputs.",
          workflow_app: workflowApp(),
        },
      },
      workflow_apps: [workflowApp()],
      panels: [],
      views: [],
      context: {},
    },
    runs: [],
    connections: {
      projectId: "demo",
      exports: [{ projectId: "demo", resourceType: "rebalance_report", artifactPattern: "artifacts/rebalance-report.md", schemaVersion: "1" }],
      imports: [],
      incomingLinks: [],
      outgoingLinks: [],
      connectedResources: [],
      visibleSources: [{ projectId: "food", title: "Food", exports: [{ projectId: "food", resourceType: "nutrition_snapshot", artifactPattern: "artifacts/nutrition.json", schemaVersion: "1" }] }],
    },
  };
}

function workflowApp() {
  return {
    id: "investment_rebalancer",
    title: "Investment Rebalancer",
    description: "Portfolio CSV to rebalance outputs.",
    category: "finance",
    inputSchema: [{ id: "portfolio", label: "Portfolio CSV", type: "file", required: true, accept: [".csv"] }],
    outputSchema: [{ id: "report", path: "artifacts/rebalance-report.md", type: "report", viewer_id: "reportViewer" }],
    runPolicy: { mode: "approval_required", requiresConfirmation: true, network: "approval_required", fileWrite: "artifacts_only", cloud: "blocked" },
    defaultViewerLayout: [{ id: "report", title: "Report", viewer_id: "reportViewer", position: "center" }],
    supportedResources: ["portfolio"],
    permissions: { network: "approval_required" },
  };
}

test.beforeEach(async ({ page }) => {
  await mockApi(page);
});

test("home loads", async ({ page }) => {
  await page.goto("/home");
  await expect(page.getByRole("region", { name: "AIWS home launcher" })).toBeVisible();
  await expect(page.getByRole("button", { name: /새 대화 시작/ })).toBeVisible();
});

test("apps and tools catalog navigation loads", async ({ page }) => {
  await page.goto("/apps-tools");
  await expect(page.getByRole("heading", { name: "Chat Tools" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Workflow Apps" })).toBeVisible();
});

test("project dashboard opens and investment app can launch chat dock", async ({ page }) => {
  await page.goto("/project/demo");
  await expect(page.getByText("Demo Project").first()).toBeVisible();
  await page.getByLabel("Project dashboard sections").getByRole("button", { name: "Workflow Apps" }).click();
  await expect(page.locator(".project-actions-panel").getByText("Investment Rebalancer")).toBeVisible();
  await expect(page.locator(".project-actions-panel").getByText("Chat Dock")).toBeVisible();
  const dock = page.locator(".project-actions-panel .chat-dock").first();
  await dock.getByPlaceholder("Ask anything").fill("Explain the rebalance report");
  await dock.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText("Scoped answer saved with receipt.")).toBeVisible();
});

test("workflow app direct route renders only the selected app shell", async ({ page }) => {
  await page.goto("/project/demo/app/investment_rebalancer");
  await expect(page.getByRole("button", { name: /Workflow App · investment_rebalancer/ })).toBeVisible();
  await expect(page.locator(".project-actions-panel").getByText("Investment Rebalancer")).toBeVisible();
  await expect(page.getByText("Run Receipt")).toBeVisible();
});

test("unauthorized linked resource access is blocked", async ({ page }) => {
  await page.goto("/project/demo");
  await page.getByRole("button", { name: "Linked Resources" }).click();
  await page.getByLabel(/nutrition_snapshot/).click();
  await page.getByRole("button", { name: "Request connection" }).click();
  await expect(page.getByText(/Account cannot access project: food/)).toBeVisible();
});
