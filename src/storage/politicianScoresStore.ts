import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { config } from "../config.js";

export type PoliticianScoresFile = {
  default_score: number;
  politicians: Record<string, number>;
};

const DEFAULT_SCORES: PoliticianScoresFile = {
  default_score: 1,
  politicians: {},
};

export function loadPoliticianScores(
  filePath = config.politicianScoresPath,
): PoliticianScoresFile {
  try {
    return JSON.parse(
      readFileSync(filePath, "utf8"),
    ) as PoliticianScoresFile;
  } catch {
    mkdirSync(path.dirname(filePath), { recursive: true });
    writeFileSync(
      filePath,
      `${JSON.stringify(DEFAULT_SCORES, null, 2)}\n`,
      "utf8",
    );
    return DEFAULT_SCORES;
  }
}

export function getPoliticianScore(
  name: string,
  scores = loadPoliticianScores(),
): number {
  const score = scores.politicians[name] ?? scores.default_score;
  return Number.isFinite(score) && score >= 0 ? score : scores.default_score;
}
