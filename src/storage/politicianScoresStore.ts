import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { config } from "../config.js";

type PoliticianScoresFile = {
  default_score: number;
  politicians: Record<string, number>;
};

const DEFAULT_SCORES: PoliticianScoresFile = {
  default_score: 1,
  politicians: { Unknown: 1 },
};

export function loadPoliticianScores(): PoliticianScoresFile {
  try {
    return JSON.parse(
      readFileSync(config.politicianScoresPath, "utf8"),
    ) as PoliticianScoresFile;
  } catch {
    mkdirSync(path.dirname(config.politicianScoresPath), { recursive: true });
    writeFileSync(
      config.politicianScoresPath,
      `${JSON.stringify(DEFAULT_SCORES, null, 2)}\n`,
      "utf8",
    );
    return DEFAULT_SCORES;
  }
}

export function getPoliticianScore(name: string): number {
  const scores = loadPoliticianScores();
  const score = scores.politicians[name] ?? scores.default_score;
  return Number.isFinite(score) && score >= 0 ? score : scores.default_score;
}
