export type ActivePath = {
  view?: "login" | "apps-tools" | "actions" | "home" | "workflow-app";
  projectPath: string;
  sessionSlug: string;
  appId?: string;
};

export function parseRoute(path = window.location.pathname): ActivePath {
  if (path === "/login") {
    return { view: "login", projectPath: "", sessionSlug: "" };
  }
  if (path === "/apps-tools") {
    return { view: "apps-tools", projectPath: "", sessionSlug: "" };
  }
  if (path === "/actions" || path === "/actions/new") {
    return { view: "actions", projectPath: "", sessionSlug: "" };
  }
  if (path === "/home") {
    return { view: "home", projectPath: "", sessionSlug: "" };
  }
  if (path.startsWith("/chat/")) {
    const parts = path.replace("/chat/", "").split("/");
    return { projectPath: parts.slice(0, -1).join("/"), sessionSlug: parts.at(-1) || "" };
  }
  if (path.startsWith("/project/")) {
    const route = path.replace("/project/", "");
    const appMarker = "/app/";
    if (route.includes(appMarker)) {
      const [projectPath, appId] = route.split(appMarker);
      return { view: "workflow-app", projectPath, sessionSlug: "", appId: appId || "" };
    }
    return { projectPath: route, sessionSlug: "" };
  }
  return { projectPath: "", sessionSlug: "" };
}
