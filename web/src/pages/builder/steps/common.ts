import { Dispatch } from "react";
import { SkillCat } from "../planApi";
import { Action, PlanState, SolveResult, StepId } from "../planState";

export type StepProps = {
  state: PlanState;
  dispatch: Dispatch<Action>;
  skills: Map<number, SkillCat> | undefined;
  go: (s: StepId) => void;
  /** copia la base elegida al editor del paso «Probar» */
  onUseBase?: (r: SolveResult) => void;
};

export const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
export const skillLabel = (skills: Map<number, SkillCat> | undefined, id: number) => {
  const s = skills?.get(id);
  return s ? s.name_es || s.name_en : `Habilidad #${id}`;
};
