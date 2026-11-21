"""Shared pydantic models for plans/solver/evaluate. Leaf module: must NOT import builds, planner or planner_store.

weapon_slots policy: the catalog has at most 3 slots per weapon, so new inputs (ObjectiveIn, SolveBody) accept at most 3
sizes (``WeaponSlots``). EvalBody and SavedPayload keep ``WeaponSlotsLegacy`` (up to 4) so old saved builds still load.
"""
from __future__ import annotations

from typing import Annotated, Literal

from pydantic import AfterValidator, BaseModel, ConfigDict, Field, StringConstraints

from .validation import Slug, Title, no_control_chars

Id = Annotated[int, Field(ge=0, le=1_000_000)]
SlotSize = Annotated[int, Field(ge=1, le=4)]
WeaponSlots = Annotated[list[SlotSize], Field(max_length=3)]
WeaponSlotsLegacy = Annotated[list[SlotSize], Field(max_length=4)]
PieceName = Literal["head", "chest", "arms", "waist", "legs", "weapon"]


class TargetIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    skill_id: Id
    level: int = Field(ge=1, le=7)
    tier: Literal[1, 2, 3]


class SetBonusIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    bonus_id: Id
    required: int = Field(ge=1, le=5)


class DecoLock(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: Id
    piece: PieceName


class LocksIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    head: Id | None = None
    chest: Id | None = None
    arms: Id | None = None
    waist: Id | None = None
    legs: Id | None = None
    charm: Id | None = None
    decorations: list[DecoLock] = Field(default_factory=list, max_length=24)


class ExcludeIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    armor: list[Id] = Field(default_factory=list, max_length=100)
    charms: list[Id] = Field(default_factory=list, max_length=50)
    decorations: list[Id] = Field(default_factory=list, max_length=50)


WeaponType = Literal["great-sword", "long-sword", "sword-and-shield", "dual-blades", "hammer", "hunting-horn",
                     "lance", "gunlance", "switch-axe", "charge-blade", "insect-glaive", "light-bowgun",
                     "heavy-bowgun", "bow"]
Style = Literal["bloqueo", "esquiva", "aprendiendo", "multijugador"]


# ------------------------------------------------------------------ plan
class ObjectiveIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    weapon_type: WeaponType | None = None
    weapon_id: Id | None = None
    weapon_slots: WeaponSlots | None = None
    archetype: Slug | None = None
    styles: list[Style] = Field(default_factory=list, max_length=6)
    rank: Literal["LR", "HR", "MR"] | None = None
    cap: Literal["progress", "full"] | None = None
    monster_id: Id | None = None
    goal: Title | None = None
    notes: Annotated[str, StringConstraints(max_length=500), AfterValidator(no_control_chars)] | None = None


class PlanIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    objective: ObjectiveIn = Field(default_factory=ObjectiveIn)
    targets: list[TargetIn] = Field(default_factory=list, max_length=20)
    set_bonus: SetBonusIn | None = None
    locks: LocksIn = Field(default_factory=LocksIn)
    exclude: ExcludeIn = Field(default_factory=ExcludeIn)
    mode: Literal["owned", "ideal"] = "ideal"
