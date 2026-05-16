import React from "react";
import { Composer, type ComposerProps } from "./Composer";

export function DockedChatComposer(props: Omit<ComposerProps, "modeKind" | "docked">) {
  return <Composer {...props} modeKind="dockedContextChat" docked />;
}
