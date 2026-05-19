import { useState } from "react";
import type { Message, Session } from "../../domain/types";
import { Button } from "../../ui/primitives/Button";
import styles from "./SessionPanel.module.css";

interface SessionPanelProps {
  sessions: Session[];
  selectedSession?: Session;
  messages: Message[];
  onSelectSession: (slug: string) => void;
  onAppendMessage: (content: string) => void;
}

export function SessionPanel(props: SessionPanelProps) {
  const [draft, setDraft] = useState("");
  return (
    <div className={styles.panel}>
      <div className={styles.list}>
        {props.sessions.length === 0 ? <p>No sessions yet.</p> : null}
        {props.sessions.map((session) => (
          <button
            className={`${styles.session} ${
              props.selectedSession?.slug === session.slug ? styles.selected : ""
            }`}
            key={session.id}
            onClick={() => props.onSelectSession(session.slug)}
          >
            <span>{session.title}</span>
            <small>{session.kind}</small>
          </button>
        ))}
      </div>
      <div className={styles.thread}>
        <div className={styles.threadHeader}>
          <strong>{props.selectedSession?.title ?? "No session selected"}</strong>
          <span>Session</span>
        </div>
        <div className={styles.messages}>
          {props.messages.map((message) => (
            <article className={styles.message} key={message.id}>
              <span>{message.role}</span>
              <p>{message.content}</p>
            </article>
          ))}
        </div>
        <form
          className={styles.composer}
          onSubmit={(event) => {
            event.preventDefault();
            const content = draft.trim();
            if (!content) return;
            props.onAppendMessage(content);
            setDraft("");
          }}
        >
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Append a traceable project message"
          />
          <Button disabled={!props.selectedSession} variant="primary">
            Append
          </Button>
        </form>
      </div>
    </div>
  );
}
