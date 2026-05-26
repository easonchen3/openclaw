import { definePluginEntry, type AnyAgentTool } from "./api.js";
import { noemateVisualizationConfigSchema } from "./src/config.js";
import { createUiArtifactTool } from "./src/ui-artifact-tool.js";

export default definePluginEntry({
  id: "noemate-visualization",
  name: "NOEMate Visualization",
  description: "Render hosted UI companion artifacts for NOEMate reports.",
  configSchema: noemateVisualizationConfigSchema,
  register(api) {
    api.registerTool(createUiArtifactTool(api) as unknown as AnyAgentTool, {
      optional: true,
    });
  },
});
