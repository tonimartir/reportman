/**
 * The wire vocabulary every Reportman AI client shares (Delphi, C#, Reportman.Web and this
 * designer): one streamed frame per step of an inference, and the shape of the final answers.
 */

/** Who is speaking in a streamed frame. */
export type AiActor = 'None' | 'System' | 'User' | 'AI' | 'Hub' | string;

/** Where the inference is. The designer endpoints add ParsingOperations and ApplyingOperations. */
export type AiStage = 'PreparingContext' | 'SendingRequest' | 'ReceivingResponse' | 'ParsingResult' | 'ParsingOperations' | 'ApplyingOperations' | 'Queued' | string;

export type AiChunkType = 'Start' | 'Partial' | 'End' | 'Full' | string;

/**
 * One streamed frame (`data: {...}`). `id` identifies the model call it belongs to: the server may
 * run several at once, and the usage header shows one row of tokens per id.
 */
export interface AiProgress {
  actor: AiActor;
  id: number | string | null;
  stage: AiStage;
  chunkType: AiChunkType;
  chunk: string;
  inputTokens: number;
  outputTokens: number;
  /** 0..1 while the prompt is being read; 0 once tokens come out. */
  prefillPercentage: number;
}

export type AiProgressHandler = (p: AiProgress) => void;

export interface AiTokenUsage {
  inputTokens: number;
  outputTokens: number;
  thinkingTokens?: number;
  modelName?: string;
}

/** What every final frame carries besides its own result. */
export interface AiResultBase {
  errorMessage?: string;
  /** The account after the charge; the host refreshes its credit indicator with it. */
  userProfile?: any;
  steps?: AiTokenUsage[];
  creditsConsumed?: number | null;
}

export interface AiSqlResult extends AiResultBase {
  sql?: string;
  explanation?: string;
}

export interface AiTextResult extends AiResultBase {
  text?: string;
}

export interface AiExpressionResult extends AiResultBase {
  expression?: string;
  explanation?: string;
}

export interface AiSqlCodeSuggestions extends AiResultBase {
  /** Ghost text to insert at the caret, most probable first. */
  inline: string[];
  /** Entries for the completion list, most probable first. */
  list: string[];
}

/** One line of the network log the chat shows in its "Red" tab. */
export interface AiNetLine {
  time: Date;
  text: string;
}

/** A block of the AI log: the chunks of one model call (one `id`), or the lines of one stage. */
export interface AiLogBlock {
  key: string;
  id: number | string | null;
  actor: AiActor;
  stage: AiStage;
  /** Exactly what arrived, for Copy all and for reporting it. */
  text: string;
  /** `text` rendered as markdown; refreshed at most once a frame while it streams. */
  html: string;
  closed: boolean;
  time: Date;
  /** A model call: the tokens it read and wrote, as its frames report them (0 until they do). */
  inputTokens?: number;
  outputTokens?: number;
  /** The last frame of a model call: with , how long it took. */
  ended?: Date;
}
