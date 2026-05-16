import React from "react";
import { Composer, type ComposerProps } from "./Composer";

export function WorkflowStepComposer(props: Omit<ComposerProps, "modeKind" | "docked">) {
  return <Composer {...props} modeKind="workflowStepChat" docked />;
}
