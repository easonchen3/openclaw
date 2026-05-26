import { Type } from "../api.js";

export const noemateVisualizationConfigSchema = Type.Object(
  {
    spikeZScoreThreshold: Type.Optional(Type.Number({ minimum: 1, maximum: 10, default: 3 })),
    dropZScoreThreshold: Type.Optional(Type.Number({ minimum: 1, maximum: 10, default: 3 })),
    sustainedWindowPoints: Type.Optional(Type.Number({ minimum: 2, maximum: 48, default: 3 })),
    sustainedZScoreThreshold: Type.Optional(Type.Number({ minimum: 1, maximum: 10, default: 2.5 })),
    maxPointsBeforeDownsample: Type.Optional(
      Type.Number({ minimum: 100, maximum: 5000, default: 1500 }),
    ),
  },
  { additionalProperties: false },
);
