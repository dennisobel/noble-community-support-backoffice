import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import type { DetailLevel, NoteSection } from "@shared/enums";
import { config } from "../config";
import { errors, RetryableProviderError } from "../lib/errors";

export interface NoteDraftInput {
  transcript: string;
  template: string;
  sections: NoteSection[];
  detailLevel: DetailLevel;
  transcriptOnly: boolean;
  /** Minimal context only: never NDIS number, date of birth, address or contact details. */
  participant: { preferred: string; goals: string[]; support: string };
}

export type NoteDraft = Record<NoteSection, string>;

export interface NoteDraftResult {
  draft: NoteDraft;
  provider: string;
  model: string | null;
}

export interface NoteDraftProvider {
  readonly name: string;
  generate(input: NoteDraftInput): Promise<NoteDraftResult>;
}

const EMPTY: NoteDraft = {
  support: "",
  response: "",
  outcome: "",
  observations: "",
  followUp: "",
};

/** Demo provider: deterministic text built from the transcript and the participant's first goal. */
export const mockNoteDrafts: NoteDraftProvider = {
  name: "mock",
  async generate(input) {
    const who = input.participant.preferred;
    const transcript = input.transcript.trim();
    const goal = input.participant.goals[0];
    const full: NoteDraft = input.transcriptOnly
      ? { ...EMPTY, support: transcript }
      : {
          support: `Supported ${who} to plan and take part in a community activity, offering clear prompts when requested.`,
          response: `${who} made choices during the activity and remained engaged. Support preferences were checked in along the way.`,
          outcome: goal
            ? `Worked toward ${who}'s goal: ${goal.charAt(0).toLowerCase()}${goal.slice(1)}.`
            : "Worked toward greater independence and confidence with community participation.",
          observations:
            "No incidents observed. The pace was adjusted to allow time for decision-making.",
          followUp: "Review the activity plan together at the next visit.",
        };
    const draft = { ...EMPTY };
    for (const section of input.sections) draft[section] = full[section];
    return { draft, provider: "mock", model: null };
  },
};

const DraftSchema = z.object({
  support: z.string(),
  response: z.string(),
  outcome: z.string(),
  observations: z.string(),
  followUp: z.string(),
});

const SECTION_GUIDE: Record<NoteSection, string> = {
  support: "support — the concrete support and actions the worker provided",
  response:
    "response — how the participant responded, engaged and the choices they made",
  outcome: "outcome — the goal or outcome the support worked toward",
  observations:
    "observations — relevant factual observations, including any incidents",
  followUp: "followUp — who will do what next, and when",
};

const LENGTH: Record<DetailLevel, string> = {
  Concise: "one or two sentences",
  Balanced: "two or three sentences",
  Detailed: "up to five sentences",
};

function systemPrompt(input: NoteDraftInput): string {
  return [
    "You draft progress notes for a disability support provider in Australia (NDIS).",
    "You receive a support worker's voice-note transcript about one support session.",
    "Write in clear, respectful, factual third person and use the participant's preferred name.",
    "Use only facts stated in the transcript. Never invent events, times, places, quotes or observations.",
    "If the transcript does not support a section, return an empty string for it instead of guessing.",
    input.transcriptOnly
      ? "Use the transcript alone; ignore any participant background."
      : "Participant goals are background for wording the outcome only; do not claim progress the transcript does not describe.",
    "Leave out sensitive personal details that are not relevant to the support provided.",
    `Keep each section to ${LENGTH[input.detailLevel]}. A support coordinator reviews and edits every draft before it is submitted.`,
  ].join("\n");
}

function userPrompt(input: NoteDraftInput): string {
  const lines = [
    `Template: ${input.template}`,
    `Write these sections: ${input.sections.map(section => SECTION_GUIDE[section]).join("; ")}.`,
    "Return an empty string for every other section.",
    `Participant's preferred name: ${input.participant.preferred}`,
  ];
  if (!input.transcriptOnly && input.participant.goals.length)
    lines.push(
      `Participant goals:\n${input.participant.goals.map(goal => `- ${goal}`).join("\n")}`
    );
  lines.push(`Transcript:\n"""\n${input.transcript}\n"""`);
  return lines.join("\n\n");
}

/** Claude via the official SDK, with structured output and the server-side refusal fallback. */
export function anthropicNoteDrafts(): NoteDraftProvider {
  const settings = config().notes;
  const client = new Anthropic({
    apiKey: settings.apiKey,
    maxRetries: 2,
    timeout: 120_000,
  });
  return {
    name: "anthropic",
    async generate(input) {
      try {
        const response = await client.beta.messages.parse({
          model: settings.model,
          max_tokens: 4_000,
          ...(settings.fallbacks
            ? {
                betas: ["server-side-fallback-2026-07-01"],
                fallbacks: "default" as const,
              }
            : {}),
          output_config: {
            effort: "medium",
            format: betaZodOutputFormat(DraftSchema),
          },
          system: systemPrompt(input),
          messages: [{ role: "user", content: userPrompt(input) }],
        });
        if (response.stop_reason === "refusal") {
          throw errors.provider(
            "A draft could not be generated for this recording. Write the note manually."
          );
        }
        const parsed = response.parsed_output;
        if (!parsed)
          throw errors.provider(
            "The draft service returned an unexpected response. Try again."
          );
        const draft = { ...EMPTY };
        for (const section of input.sections)
          draft[section] = parsed[section]?.trim() ?? "";
        return { draft, provider: "anthropic", model: response.model };
      } catch (error) {
        if (
          error instanceof Anthropic.RateLimitError ||
          error instanceof Anthropic.InternalServerError ||
          error instanceof Anthropic.APIConnectionError
        ) {
          throw new RetryableProviderError(
            `Draft service temporarily unavailable: ${error.message}`
          );
        }
        if (error instanceof Anthropic.APIError)
          throw errors.provider(
            `The draft service rejected the request (${error.status ?? "error"}).`
          );
        throw error;
      }
    },
  };
}

let cached: NoteDraftProvider | null = null;

export function noteDrafts(): NoteDraftProvider {
  if (config().notes.provider !== "anthropic") return mockNoteDrafts;
  cached ??= anthropicNoteDrafts();
  return cached;
}
