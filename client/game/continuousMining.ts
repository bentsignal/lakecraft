export interface PrimaryActionHoldState {
  /** Physical primary-button state; cleared on release, pointer-lock loss, death, or teardown. */
  held: boolean;
  /** True only when this press is allowed to chain block mining. Entity attacks remain discrete. */
  miningArmed: boolean;
}

export const IDLE_PRIMARY_ACTION_HOLD: Readonly<PrimaryActionHoldState> = Object.freeze({
  held: false,
  miningArmed: false,
});

export function pressPrimaryAction(entityAttackHandled: boolean): PrimaryActionHoldState {
  return { held: true, miningArmed: !entityAttackHandled };
}

export function releasePrimaryAction(): PrimaryActionHoldState {
  return { ...IDLE_PRIMARY_ACTION_HOLD };
}

export function shouldStartHeldMining(
  state: Readonly<PrimaryActionHoldState>,
  input: {
    pointerLocked: boolean;
    playerAlive: boolean;
    miningActive: boolean;
    targetAvailable: boolean;
    editAllowed: boolean;
    targetPrimed: boolean;
  },
): boolean {
  return state.held
    && state.miningArmed
    && input.pointerLocked
    && input.playerAlive
    && !input.miningActive
    && input.targetAvailable
    && input.editAllowed
    && !input.targetPrimed;
}
