const DRAMA_STYLE_PROMPT_HINTS: Record<string, string> = {
  realistic: 'cinematic realistic style, photo-realistic rendering, natural lighting, high detail',
  anime: 'anime style, japanese 2D illustration, cel shading, clean line art, vibrant colors',
  ghibli: 'Studio Ghibli inspired, hand-drawn anime, soft watercolor backgrounds, warm palette, nostalgic atmosphere',
  cinematic: 'cinematic film still, dramatic lighting, shallow depth of field, filmic color grading, high production value',
  comic: 'comic book style, bold ink lines, vibrant flat colors, halftone shading, dynamic composition',
  watercolor: 'watercolor painting, soft brush strokes, artistic washes, paper texture, gentle color bleed',
}

export function dramaStylePromptHint(style: string | null | undefined): string {
  return DRAMA_STYLE_PROMPT_HINTS[String(style || '').trim()] || DRAMA_STYLE_PROMPT_HINTS.realistic
}
