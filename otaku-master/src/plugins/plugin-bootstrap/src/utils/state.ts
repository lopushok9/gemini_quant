import type { IAgentRuntime, Memory, State } from '@elizaos/core';

/**
 * Refreshes state after action execution to keep prompts and action results in sync
 * This ensures subsequent actions have access to the latest wallet balances and action results
 *
 * @param runtime - Agent runtime
 * @param message - Current message being processed
 * @param currentState - Current state object
 * @param actionResults - Array of action results from this execution round
 * @returns Updated state with fresh data
 */
export async function refreshStateAfterAction(
  runtime: IAgentRuntime,
  message: Memory,
  currentState: State,
  actionResults: unknown[]
): Promise<State> {
  // Recompose state with updated wallet info and action results
  const refreshedState = await runtime.composeState(message, [
    'RECENT_MESSAGES',
    'ACTION_STATE',
    'WALLET_STATE',
  ]);

  // Preserve action results in state
  refreshedState.data.actionResults = actionResults;

  // Merge any custom data from current state that shouldn't be lost
  if (currentState.data?.actionPlan) {
    refreshedState.data.actionPlan = currentState.data.actionPlan;
  }

  if (currentState.data?.workingMemory) {
    refreshedState.data.workingMemory = currentState.data.workingMemory;
  }

  return refreshedState;
}

/**
 * Updates action plan state with step completion status
 *
 * @param state - Current state
 * @param stepIndex - Index of the step to update
 * @param status - New status (completed, failed, pending)
 * @param result - Optional result data
 * @param error - Optional error message
 * @returns Updated state
 */
export function updateActionPlanStep(
  state: State,
  stepIndex: number,
  status: 'completed' | 'failed' | 'pending',
  result?: Record<string, unknown>,
  error?: string
): State {
  if (!state.data?.actionPlan) {
    return state;
  }

  const updatedPlan = { ...state.data.actionPlan };
  const steps = [...updatedPlan.steps];

  if (stepIndex >= 0 && stepIndex < steps.length) {
    steps[stepIndex] = {
      ...steps[stepIndex],
      status,
      result,
      error,
    };

    updatedPlan.steps = steps;
    updatedPlan.currentStep = stepIndex + 1;

    return {
      ...state,
      data: {
        ...state.data,
        actionPlan: updatedPlan,
      },
    };
  }

  return state;
}

/**
 * Initializes or updates working memory in state
 *
 * @param state - Current state
 * @param key - Memory key
 * @param value - Memory value
 * @returns Updated state
 */
export function updateWorkingMemory(
  state: State,
  key: string,
  value: Record<string, unknown>
): State {
  const workingMemory = state.data?.workingMemory || {};

  return {
    ...state,
    data: {
      ...state.data,
      workingMemory: {
        ...workingMemory,
        [key]: {
          ...value,
          timestamp: Date.now(),
        },
      },
    },
  };
}

