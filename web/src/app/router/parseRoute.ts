export type ActivePath = {
  view?: "login" | "apps-tools" | "actions" | "home" | "workflow-app";
  projectPath: string;
  sessionSlug: string;
  appId?: string;
};

export function parseRoute(path = window.location.pathname): ActivePath {
  const cleanPath = (path || "/").split("?")[0]?.split("#")[0] || "/";
  if (cleanPath === "/login") {
    return { view: "login", projectPath: "", sessionSlug: "" };
  }
  if (cleanPath === "/apps-tools") {
    return { view: "apps-tools", projectPath: "", sessionSlug: "" };
  }
  if (cleanPath === "/actions" || cleanPath === "/actions/new") {
    return { view: "actions", projectPath: "", sessionSlug: "" };
  }
  if (cleanPath === "/home") {
    return { view: "home", projectPath: "", sessionSlug: "" };
  }
  if (cleanPath.startsWith("/chat/")) {
    const parts = cleanPath.replace("/chat/", "").split("/");
    return { projectPath: parts.slice(0, -1).join("/"), sessionSlug: parts.at(-1) || "" };
  }
  if (cleanPath.startsWith("/project/")) {
    const route = cleanPath.replace("/project/", "");
    const appMarker = "/app/";
    if (route.includes(appMarker)) {
      const [projectPath, appId] = route.split(appMarker);
      return { view: "workflow-app", projectPath, sessionSlug: "", appId: appId || "" };
    }
    return { projectPath: route, sessionSlug: "" };
  }
  return { projectPath: "", sessionSlug: "" };
}
