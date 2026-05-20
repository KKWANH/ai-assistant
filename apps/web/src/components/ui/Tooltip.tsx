import {
  useState,
  useRef,
  useEffect,
  type ReactNode,
} from "react";
import styles from "./Tooltip.module.css";

export interface TooltipProps {
  content: ReactNode;
  children: ReactNode;
  side?: "top" | "bottom" | "left" | "right";
  delay?: number;
}

const sideClass: Record<NonNullable<TooltipProps["side"]>, string> = {
  top:    styles["top"]!,
  bottom: styles["bottom"]!,
  left:   styles["left"]!,
  right:  styles["right"]!,
};

export function Tooltip({
  content,
  children,
  side = "top",
  delay = 400,
}: TooltipProps) {
  const [visible, setVisible] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = () => {
    timer.current = setTimeout(() => setVisible(true), delay);
  };
  const hide = () => {
    if (timer.current) clearTimeout(timer.current);
    setVisible(false);
  };

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  return (
    <div
      className={styles["wrapper"]!}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      {children}
      {visible && (
        <div
          role="tooltip"
          className={[styles["bubble"]!, sideClass[side]].join(" ")}
        >
          {content}
        </div>
      )}
    </div>
  );
}
