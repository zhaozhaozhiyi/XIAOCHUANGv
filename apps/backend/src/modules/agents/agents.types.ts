export type StoryboardStateInput = Record<string, unknown>;

export type StoryboardDialogueHandoffInput = {
  mode?:
    | "continue_same_speaker"
    | "response"
    | "offscreen"
    | "overlap"
    | "pause"
    | "none";
  speaker?: string;
  voice_lock?: unknown;
  performance?: string | Record<string, unknown>;
  take_policy?: "continue_current_take" | "new_speaker_take" | "no_dialogue";
  subtitle_policy?: string;
  sync_policy?: "required" | "preferred" | "not_required";
  [key: string]: unknown;
};

export type StoryboardContinuityToNextInput = {
  relation_type?: "continuous" | "intentional_cut";
  transition_type?: "hard_cut" | "match_cut" | "dissolve" | "fade";
  action_handoff?: string;
  audio_bridge?: string;
  dialogue_handoff?: StoryboardDialogueHandoffInput;
  continuity_notes?: string[];
  asset_lock?: Record<string, unknown>;
  [key: string]: unknown;
};

export type StoryboardSaveInput = {
  shot_number: number;
  title?: string;
  shot_type?: string;
  angle?: string;
  movement?: string;
  location?: string;
  time?: string;
  action?: string;
  dialogue?: string;
  description?: string;
  result?: string;
  atmosphere?: string;
  image_prompt?: string;
  video_prompt?: string;
  bgm_prompt?: string;
  sound_effect?: string;
  duration?: number;
  scene_id?: number | null;
  character_ids?: number[];
  opening_state?: StoryboardStateInput;
  closing_state?: StoryboardStateInput;
  continuity_to_next?: StoryboardContinuityToNextInput;
};
