import { openAsBlob } from "node:fs";
import path from "node:path";
import { config } from "../config";
import { errors, RetryableProviderError } from "../lib/errors";

export interface TranscriptionInput {
  filePath: string | null;
  mimeType: string | null;
  participantName: string;
}

export interface TranscriptionResult {
  text: string;
  language: string | null;
  provider: string;
}

export interface SpeechToTextProvider {
  readonly name: string;
  transcribe(input: TranscriptionInput): Promise<TranscriptionResult>;
}

/** Demo provider: returns a fixed transcript so the workflow can be exercised without any external service. */
export const mockSpeechToText: SpeechToTextProvider = {
  name: "mock",
  async transcribe({ participantName }) {
    return {
      provider: "mock",
      language: "en",
      text:
        `Today we worked on ${participantName}'s community participation goals. We planned the outing together and discussed what support would be useful. ` +
        `${participantName} made choices throughout and was engaged. We agreed to continue practising this routine at the next visit.`,
    };
  },
};

/**
 * Any OpenAI-compatible `/audio/transcriptions` endpoint: OpenAI itself, or a self-hosted Whisper server
 * in the compose stack (keeps audio inside your infrastructure).
 */
export function openAiCompatibleSpeechToText(): SpeechToTextProvider {
  const settings = config().stt;
  return {
    name: "openai",
    async transcribe({ filePath, mimeType }) {
      if (!filePath)
        throw errors.validation(
          "This recording has no audio file to transcribe."
        );
      const form = new FormData();
      form.append(
        "file",
        await openAsBlob(filePath, {
          type: mimeType ?? "application/octet-stream",
        }),
        path.basename(filePath)
      );
      form.append("model", settings.model);
      if (settings.language) form.append("language", settings.language);
      form.append("response_format", "json");
      let response: Response;
      try {
        response = await fetch(`${settings.baseUrl}/audio/transcriptions`, {
          method: "POST",
          headers: settings.apiKey
            ? { Authorization: `Bearer ${settings.apiKey}` }
            : undefined,
          body: form,
          signal: AbortSignal.timeout(180_000),
        });
      } catch (error) {
        throw new RetryableProviderError(
          `Transcription service unreachable: ${String(error)}`
        );
      }
      if (response.status === 429 || response.status >= 500)
        throw new RetryableProviderError(
          `Transcription service returned ${response.status}`
        );
      if (!response.ok)
        throw errors.provider(
          `The transcription service rejected the recording (${response.status}).`
        );
      const body = (await response.json()) as {
        text?: string;
        language?: string;
      };
      if (typeof body.text !== "string")
        throw errors.provider(
          "The transcription service returned an unexpected response."
        );
      return {
        text: body.text.trim(),
        language: body.language ?? settings.language ?? null,
        provider: "openai",
      };
    },
  };
}

export function speechToText(): SpeechToTextProvider {
  return config().stt.provider === "openai"
    ? openAiCompatibleSpeechToText()
    : mockSpeechToText;
}
