import type { Message, Project, Session } from "../../domain/types";
import { Button } from "../../ui/primitives/Button";
import { SessionPanel } from "../sessions/SessionPanel";
import styles from "./ProjectOverview.module.css";

interface ProjectOverviewProps {
  project?: Project;
  sessions: Session[];
  selectedSession?: Session;
  messages: Message[];
  onCreateSession: () => void;
  onSelectSession: (slug: string) => void;
  onAppendMessage: (content: string) => void;
}

export function ProjectOverview(props: ProjectOverviewProps) {
  if (!props.project) {
    return (
      <section className={styles.empty}>
        <h1>Project</h1>
        <p>Create a project to begin the AIWS workflow pipeline.</p>
      </section>
    );
  }
  return (
    <div className={styles.layout}>
      <section className={styles.header}>
        <div>
          <h1>{props.project.title}</h1>
          <p>{props.project.description || "No description yet."}</p>
        </div>
        <div className={styles.meta}>
          <span>Project</span>
          <strong>{props.project.path}</strong>
        </div>
      </section>

      <section className={styles.nouns}>
        {["Context Pack", "Context Receipt", "Action", "Run", "Artifact", "Report"].map((noun) => (
          <div className={styles.noun} key={noun}>
            <span>{noun}</span>
            <strong>{noun === "Action" ? "manifest pending" : "not created"}</strong>
          </div>
        ))}
      </section>

      <section className={styles.sessions}>
        <div className={styles.sectionHeader}>
          <h2>Sessions</h2>
          <Button onClick={props.onCreateSession} variant="primary">
            New session
          </Button>
        </div>
        <SessionPanel
          sessions={props.sessions}
          selectedSession={props.selectedSession}
          messages={props.messages}
          onSelectSession={props.onSelectSession}
          onAppendMessage={props.onAppendMessage}
        />
      </section>
    </div>
  );
}
