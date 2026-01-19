import { describe, it, expect, beforeEach, mock } from "bun:test";
import {
  validateSlippage,
  slippageToDecimal,
  DEFAULT_SLIPPAGE,
  MIN_SLIPPAGE,
  MAX_SLIPPAGE_WITHOUT_CONFIRMATION,
  ABSOLUTE_MAX_SLIPPAGE,
} from "./slippage";
import type { IAgentRuntime, State } from "@elizaos/core";

describe("Slippage Validation", () => {
  let mockRuntime: IAgentRuntime;
  let mockCallback: any;
  let mockState: State;

  beforeEach(() => {
    // Mock runtime with useModel function
    mockRuntime = {
      useModel: mock(() => Promise.resolve("NO")),
      getService: mock(() => ({})),
    } as unknown as IAgentRuntime;

    mockCallback = mock(() => {});

    mockState = {
      recentMessagesData: [],
    } as unknown as State;
  });

  describe("slippageToDecimal", () => {
    it("converts percentage to decimal", () => {
      expect(slippageToDecimal(1)).toBe(0.01);
      expect(slippageToDecimal(5)).toBe(0.05);
      expect(slippageToDecimal(10)).toBe(0.1);
      expect(slippageToDecimal(0.5)).toBe(0.005);
      expect(slippageToDecimal(100)).toBe(1);
    });
  });

  describe("validateSlippage - Basic validation", () => {
    it("accepts valid slippage within default range", async () => {
      const result = await validateSlippage(
        mockRuntime,
        1,
        false,
        {},
        "TEST",
        mockCallback
      );
      expect(result.valid).toBe(true);
    });

    it("accepts valid slippage at max without confirmation", async () => {
      const result = await validateSlippage(
        mockRuntime,
        5,
        false,
        {},
        "TEST",
        mockCallback
      );
      expect(result.valid).toBe(true);
    });

    it("rejects NaN slippage", async () => {
      const result = await validateSlippage(
        mockRuntime,
        NaN,
        false,
        {},
        "TEST",
        mockCallback
      );
      expect(result.valid).toBe(false);
      expect(result.errorResult?.error).toBe("invalid_slippage_type");
    });

    it("rejects zero slippage", async () => {
      const result = await validateSlippage(
        mockRuntime,
        0,
        false,
        {},
        "TEST",
        mockCallback
      );
      expect(result.valid).toBe(false);
      expect(result.errorResult?.error).toBe("slippage_must_be_positive");
    });

    it("rejects negative slippage", async () => {
      const result = await validateSlippage(
        mockRuntime,
        -1,
        false,
        {},
        "TEST",
        mockCallback
      );
      expect(result.valid).toBe(false);
      expect(result.errorResult?.error).toBe("slippage_must_be_positive");
    });

    it("rejects slippage over 100%", async () => {
      const result = await validateSlippage(
        mockRuntime,
        101,
        false,
        {},
        "TEST",
        mockCallback
      );
      expect(result.valid).toBe(false);
      expect(result.errorResult?.error).toBe("slippage_exceeds_maximum");
    });
  });

  describe("validateSlippage - High slippage with confirmHighSlippage", () => {
    it("rejects high slippage without confirmation", async () => {
      const result = await validateSlippage(
        mockRuntime,
        10,
        false,
        {},
        "TEST",
        mockCallback
      );
      expect(result.valid).toBe(false);
      expect(result.errorResult?.error).toBe("high_slippage_not_confirmed");
    });

    it("accepts high slippage with explicit boolean true confirmation", async () => {
      const result = await validateSlippage(
        mockRuntime,
        10,
        true,
        {},
        "TEST",
        mockCallback
      );
      expect(result.valid).toBe(true);
    });

    it("rejects high slippage with explicit boolean false confirmation", async () => {
      const result = await validateSlippage(
        mockRuntime,
        10,
        false,
        {},
        "TEST",
        mockCallback
      );
      expect(result.valid).toBe(false);
      expect(result.errorResult?.error).toBe("high_slippage_not_confirmed");
    });

    it("accepts slippage at absolute max (50%) with confirmation", async () => {
      const result = await validateSlippage(
        mockRuntime,
        50,
        true,
        {},
        "TEST",
        mockCallback
      );
      expect(result.valid).toBe(true);
    });

    it("rejects slippage above absolute max (50%) even with confirmation", async () => {
      const result = await validateSlippage(
        mockRuntime,
        51,
        true,
        {},
        "TEST",
        mockCallback
      );
      expect(result.valid).toBe(false);
      expect(result.errorResult?.error).toBe("slippage_exceeds_absolute_max");
    });

    it("rejects slippage of 60% even with confirmation", async () => {
      const result = await validateSlippage(
        mockRuntime,
        60,
        true,
        {},
        "TEST",
        mockCallback
      );
      expect(result.valid).toBe(false);
      expect(result.errorResult?.error).toBe("slippage_exceeds_absolute_max");
    });
  });

  describe("validateSlippage - Type safety for confirmHighSlippage (SECURITY)", () => {
    it('treats string "false" as false (security fix)', async () => {
      const result = await validateSlippage(
        mockRuntime,
        10,
        "false" as any, // Simulating parameter extraction bug
        {},
        "TEST",
        mockCallback
      );
      expect(result.valid).toBe(false);
      expect(result.errorResult?.error).toBe("high_slippage_not_confirmed");
    });

    it('treats string "true" as false (security fix)', async () => {
      const result = await validateSlippage(
        mockRuntime,
        10,
        "true" as any, // Simulating parameter extraction bug
        {},
        "TEST",
        mockCallback
      );
      expect(result.valid).toBe(false);
      expect(result.errorResult?.error).toBe("high_slippage_not_confirmed");
    });

    it("treats number 1 as false (security fix)", async () => {
      const result = await validateSlippage(
        mockRuntime,
        10,
        1 as any, // Simulating parameter extraction bug
        {},
        "TEST",
        mockCallback
      );
      expect(result.valid).toBe(false);
      expect(result.errorResult?.error).toBe("high_slippage_not_confirmed");
    });

    it("treats object as false (security fix)", async () => {
      const result = await validateSlippage(
        mockRuntime,
        10,
        { value: true } as any, // Simulating parameter extraction bug
        {},
        "TEST",
        mockCallback
      );
      expect(result.valid).toBe(false);
      expect(result.errorResult?.error).toBe("high_slippage_not_confirmed");
    });

    it("treats array as false (security fix)", async () => {
      const result = await validateSlippage(
        mockRuntime,
        10,
        [true] as any, // Simulating parameter extraction bug
        {},
        "TEST",
        mockCallback
      );
      expect(result.valid).toBe(false);
      expect(result.errorResult?.error).toBe("high_slippage_not_confirmed");
    });

    it("treats undefined as false", async () => {
      const result = await validateSlippage(
        mockRuntime,
        10,
        undefined as any,
        {},
        "TEST",
        mockCallback
      );
      expect(result.valid).toBe(false);
      expect(result.errorResult?.error).toBe("high_slippage_not_confirmed");
    });

    it("treats null as false", async () => {
      const result = await validateSlippage(
        mockRuntime,
        10,
        null as any,
        {},
        "TEST",
        mockCallback
      );
      expect(result.valid).toBe(false);
      expect(result.errorResult?.error).toBe("high_slippage_not_confirmed");
    });

    it("only accepts strict boolean true", async () => {
      const result = await validateSlippage(
        mockRuntime,
        10,
        true,
        {},
        "TEST",
        mockCallback
      );
      expect(result.valid).toBe(true);
    });
  });

  describe("validateSlippage - LLM consent detection", () => {
    it("accepts high slippage when LLM detects consent", async () => {
      const runtimeWithConsent = {
        useModel: mock(() => Promise.resolve("YES")),
        getService: mock(() => ({})),
      } as unknown as IAgentRuntime;

      const stateWithMessages = {
        recentMessagesData: [
          {
            userId: "user1",
            agentId: "agent1",
            content: { text: "yes, proceed with high slippage" },
          },
        ],
      } as unknown as State;

      const result = await validateSlippage(
        runtimeWithConsent,
        10,
        false,
        {},
        "TEST",
        mockCallback,
        stateWithMessages
      );
      expect(result.valid).toBe(true);
    });

    it("rejects high slippage when LLM does not detect consent", async () => {
      const runtimeWithoutConsent = {
        useModel: mock(() => Promise.resolve("NO")),
        getService: mock(() => ({})),
      } as unknown as IAgentRuntime;

      const stateWithMessages = {
        recentMessagesData: [
          {
            userId: "user1",
            agentId: "agent1",
            content: { text: "no, I don't want high slippage" },
          },
        ],
      } as unknown as State;

      const result = await validateSlippage(
        runtimeWithoutConsent,
        10,
        false,
        {},
        "TEST",
        mockCallback,
        stateWithMessages
      );
      expect(result.valid).toBe(false);
      expect(result.errorResult?.error).toBe("high_slippage_not_confirmed");
    });

    it("prefers explicit confirmation over LLM detection", async () => {
      const runtimeWithoutConsent = {
        useModel: mock(() => Promise.resolve("NO")),
        getService: mock(() => ({})),
      } as unknown as IAgentRuntime;

      const stateWithMessages = {
        recentMessagesData: [
          {
            userId: "user1",
            agentId: "agent1",
            content: { text: "no, I don't want high slippage" },
          },
        ],
      } as unknown as State;

      // Explicit true should override LLM saying NO
      const result = await validateSlippage(
        runtimeWithoutConsent,
        10,
        true, // Explicit confirmation
        {},
        "TEST",
        mockCallback,
        stateWithMessages
      );
      expect(result.valid).toBe(true);
    });
  });

  describe("validateSlippage - Edge cases", () => {
    it("accepts very small slippage", async () => {
      const result = await validateSlippage(
        mockRuntime,
        0.01,
        false,
        {},
        "TEST",
        mockCallback
      );
      expect(result.valid).toBe(true);
    });

    it("accepts default slippage", async () => {
      const result = await validateSlippage(
        mockRuntime,
        DEFAULT_SLIPPAGE,
        false,
        {},
        "TEST",
        mockCallback
      );
      expect(result.valid).toBe(true);
    });

    it("accepts boundary at max without confirmation", async () => {
      const result = await validateSlippage(
        mockRuntime,
        MAX_SLIPPAGE_WITHOUT_CONFIRMATION,
        false,
        {},
        "TEST",
        mockCallback
      );
      expect(result.valid).toBe(true);
    });

    it("rejects one above max without confirmation", async () => {
      const result = await validateSlippage(
        mockRuntime,
        MAX_SLIPPAGE_WITHOUT_CONFIRMATION + 0.1,
        false,
        {},
        "TEST",
        mockCallback
      );
      expect(result.valid).toBe(false);
      expect(result.errorResult?.error).toBe("high_slippage_not_confirmed");
    });
  });
});
