import { useEffect, useMemo, useState } from "react";
import { endpoints } from "../api/endpoints";
import type { AdminAnalysis, AdminStatus, Message, Project, Session } from "../domain/types";
import { WorkbenchShell } from "./shell/WorkbenchShell";

export function App() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [adminStatus, setAdminStatus] = useState<AdminStatus | null>(null);
  const [adminAnalysis, setAdminAnalysis] = useState<AdminAnalysis | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [selectedProjectPath, setSelectedProjectPath] = useState<string>("");
  const [selectedSessionSlug, setSelectedSessionSlug] = useState<string>("");
  const [error, setError] = useState<string>("");

  const selectedProject = useMemo(
    () => projects.find((project) => project.path === selectedProjectPath) ?? projects[0],
    [projects, selectedProjectPath]
  );
  const selectedSession = useMemo(
    () => sessions.find((session) => session.slug === selectedSessionSlug) ?? sessions[0],
    [sessions, selectedSessionSlug]
  );

  async function refresh() {
    setError("");
    try {
      await endpoints.initWorkspace().catch(() => undefined);
      const [projectData, status, analysis, logData] = await Promise.all([
        endpoints.projects(),
        endpoints.adminStatus(),
        endpoints.adminAnalysis(),
        endpoints.adminLogs()
      ]);
      setProjects(projectData.projects);
      setAdminStatus(status);
      setAdminAnalysis(analysis);
      setLogs(logData.lines);
      const project = projectData.projects[0];
      if (project) {
        setSelectedProjectPath((current) => current || project.path);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unknown API error");
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  useEffect(() => {
    if (!selectedProject) {
      setSessions([]);
      return;
    }
    endpoints
      .sessions(selectedProject.path)
      .then((data) => {
        setSessions(data.sessions);
        setSelectedSessionSlug((current) => current || data.sessions[0]?.slug || "");
      })
      .catch((caught: unknown) => setError(caught instanceof Error ? caught.message : String(caught)));
  }, [selectedProject]);

  useEffect(() => {
    if (!selectedProject || !selectedSession) {
      setMessages([]);
      return;
    }
    endpoints
      .messages(selectedProject.path, selectedSession.slug)
      .then((data) => setMessages(data.messages))
      .catch((caught: unknown) => setError(caught instanceof Error ? caught.message : String(caught)));
  }, [selectedProject, selectedSession]);

  return (
    <WorkbenchShell
      projects={projects}
      sessions={sessions}
      messages={messages}
      selectedProject={selectedProject}
      selectedSession={selectedSession}
      adminStatus={adminStatus}
      adminAnalysis={adminAnalysis}
      logs={logs}
      error={error}
      onRefresh={() => void refresh()}
      onSelectProject={(path) => {
        setSelectedProjectPath(path);
        setSelectedSessionSlug("");
      }}
      onSelectSession={setSelectedSessionSlug}
      onCreateProject={async () => {
        const index = projects.length + 1;
        const created = await endpoints.createProject({
          path: `project-${index}`,
          title: `Project ${index}`,
          description: "Local-first AIWS project"
        });
        setProjects((current) => [...current, created.project]);
        setSelectedProjectPath(created.project.path);
      }}
      onCreateSession={async () => {
        if (!selectedProject) return;
        const index = sessions.length + 1;
        const created = await endpoints.createSession(selectedProject.path, {
          slug: `session-${index}`,
          title: `Session ${index}`
        });
        setSessions((current) => [...current, created.session]);
        setSelectedSessionSlug(created.session.slug);
      }}
      onAppendMessage={async (content) => {
        if (!selectedProject || !selectedSession) return;
        const created = await endpoints.appendMessage(selectedProject.path, selectedSession.slug, {
          session_id: selectedSession.id,
          role: "user",
          content
        });
        setMessages((current) => [...current, created.message]);
      }}
    />
  );
}
