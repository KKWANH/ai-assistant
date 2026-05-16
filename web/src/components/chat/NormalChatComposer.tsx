import React from "react";
import { Composer, type ComposerProps } from "./Composer";

export function NormalChatComposer(props: Omit<ComposerProps, "modeKind" | "docked">) {
  return <Composer {...props} modeKind="normalChat" docked={false} />;
}
