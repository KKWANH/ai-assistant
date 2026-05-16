import type { ComponentType } from "react";

export type ViewerArtifact = {
  path?: string;
  type?: string;
  mime?: string;
  viewer_id?: string;
  viewer_type?: string;
  content?: string;
  [key: string]: unknown;
};

export type ViewerAccepts = {
  mimeTypes?: string[];
  mime?: string[];
  extensions?: string[];
  artifactTypes?: string[];
};

export type ViewerPluginRenderProps<TInput extends ViewerArtifact, TConfig> = {
  artifact: TInput;
  config?: TConfig;
};

export type ViewerPlugin<TInput extends ViewerArtifact = ViewerArtifact, TConfig = Record<string, unknown>> = {
  id: string;
  label: string;
  accepts: ViewerAccepts;
  configSchema?: TConfig;
  render: ComponentType<ViewerPluginRenderProps<TInput, TConfig>>;
  validateArtifact: (artifact: ViewerArtifact) => artifact is TInput;
};
