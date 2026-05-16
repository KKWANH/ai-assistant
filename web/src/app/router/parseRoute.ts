export type ActivePath = {
  view?: "login" | "apps-tools" | "actions" | "home";
  projectPath: string;
  sessionSlug: string;
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
    return { projectPath: path.replace("/project/", ""), sessionSlug: "" };
  }
  return { projectPath: "", sessionSlug: "" };
}
