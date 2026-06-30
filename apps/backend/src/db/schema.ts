import {
  boolean,
  index,
  integer,
  real,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core'

export const users = pgTable(
  'users',
  {
    id: serial('id').primaryKey(),
    adminUserId: varchar('admin_user_id', { length: 255 }),
    accountType: varchar('account_type', { length: 50 }).notNull(),
    role: varchar('role', { length: 50 }).notNull().default('user'),
    displayName: varchar('display_name', { length: 255 }).notNull(),
    email: varchar('email', { length: 255 }),
    phone: varchar('phone', { length: 50 }).unique(),
    passwordHash: varchar('password_hash', { length: 255 }),
    status: varchar('status', { length: 50 }).notNull().default('active'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
    deletedAt: timestamp('deleted_at'),
  },
  (table) => [
    uniqueIndex('idx_users_phone').on(table.phone),
    uniqueIndex('idx_users_email').on(table.email),
  ],
)

export const phoneVerificationCodes = pgTable(
  'phone_verification_codes',
  {
    id: serial('id').primaryKey(),
    phone: varchar('phone', { length: 50 }).notNull(),
    purpose: varchar('purpose', { length: 50 }).notNull(),
    code: varchar('code', { length: 6 }).notNull(),
    expiresAt: timestamp('expires_at').notNull(),
    usedAt: timestamp('used_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [
    index('idx_phone_verification_codes_lookup').on(table.phone, table.purpose),
    index('idx_phone_verification_codes_expires_at').on(table.expiresAt),
  ],
)

export const authSessions = pgTable(
  'auth_sessions',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id),
    sessionTokenHash: varchar('session_token_hash', { length: 255 }).notNull().unique(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at'),
    revokedAt: timestamp('revoked_at'),
  },
  (table) => [index('idx_auth_sessions_user_id').on(table.userId)],
)

export const roles = pgTable('roles', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 100 }).notNull().unique(),
  displayName: varchar('display_name', { length: 255 }).notNull(),
  description: text('description'),
  level: integer('level').notNull().default(0),
  permissions: text('permissions'),
  isSystem: boolean('is_system').default(false),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
  deletedAt: timestamp('deleted_at'),
})

export const userRoles = pgTable('user_roles', {
  id: serial('id').primaryKey(),
  userId: integer('user_id')
    .notNull()
    .references(() => users.id),
  roleId: integer('role_id')
    .notNull()
    .references(() => roles.id),
  grantedBy: integer('granted_by'),
  grantedAt: timestamp('granted_at').notNull().defaultNow(),
  expiresAt: timestamp('expires_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

export const organizations = pgTable(
  'organizations',
  {
    id: serial('id').primaryKey(),
    name: varchar('name', { length: 255 }).notNull(),
    slug: varchar('slug', { length: 100 }).unique(),
    plan: varchar('plan', { length: 50 }).notNull().default('free'),
    settings: text('settings'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
    deletedAt: timestamp('deleted_at'),
  },
  (table) => [uniqueIndex('idx_organizations_slug').on(table.slug)],
)

export const organizationMembers = pgTable(
  'organization_members',
  {
    id: serial('id').primaryKey(),
    organizationId: integer('organization_id')
      .notNull()
      .references(() => organizations.id),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id),
    role: varchar('role', { length: 50 }).notNull().default('member'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('idx_org_members').on(table.organizationId, table.userId),
    index('idx_org_members_org_id').on(table.organizationId),
    index('idx_org_members_user_id').on(table.userId),
  ],
)

export const subscriptionPlans = pgTable(
  'subscription_plans',
  {
    id: serial('id').primaryKey(),
    name: varchar('name', { length: 100 }).notNull().unique(),
    displayName: varchar('display_name', { length: 255 }).notNull(),
    description: text('description'),
    price: integer('price').notNull().default(0),
    priceUnit: varchar('price_unit', { length: 20 }).notNull().default('month'),
    videoQuotaMonthly: integer('video_quota_monthly').notNull().default(0),
    imageQuotaMonthly: integer('image_quota_monthly').notNull().default(0),
    storageQuotaMb: integer('storage_quota_mb').notNull().default(0),
    aiTokensQuotaMonthly: integer('ai_tokens_quota_monthly').notNull().default(0),
    features: text('features'),
    isActive: boolean('is_active').notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [uniqueIndex('idx_subscription_plans_name').on(table.name)],
)

export const subscriptions = pgTable(
  'subscriptions',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id),
    organizationId: integer('organization_id').references(() => organizations.id),
    planName: varchar('plan_name', { length: 100 })
      .notNull()
      .references(() => subscriptionPlans.name),
    status: varchar('status', { length: 50 }).notNull().default('active'),
    startedAt: timestamp('started_at').notNull().defaultNow(),
    expiresAt: timestamp('expires_at'),
    cancelAtPeriodEnd: boolean('cancel_at_period_end').notNull().default(false),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('idx_subscriptions_user_id').on(table.userId),
    index('idx_subscriptions_status').on(table.status),
  ],
)

export const aiServiceConfigs = pgTable('ai_service_configs', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').references(() => users.id),
  serviceType: varchar('service_type', { length: 50 }).notNull(),
  provider: varchar('provider', { length: 100 }),
  name: varchar('name', { length: 255 }).notNull(),
  description: text('description').notNull().default(''),
  baseUrl: varchar('base_url', { length: 500 }).notNull(),
  apiKey: text('api_key').notNull(),
  model: varchar('model', { length: 255 }),
  endpoint: varchar('endpoint', { length: 500 }),
  queryEndpoint: varchar('query_endpoint', { length: 500 }),
  priority: integer('priority').default(0),
  isDefault: boolean('is_default').default(false),
  isActive: boolean('is_active').default(true),
  settings: text('settings'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

export const aiVoices = pgTable('ai_voices', {
  id: serial('id').primaryKey(),
  voiceId: varchar('voice_id', { length: 255 }).notNull().unique(),
  voiceName: varchar('voice_name', { length: 255 }).notNull(),
  description: text('description'),
  language: varchar('language', { length: 50 }),
  provider: varchar('provider', { length: 100 }).notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

export const agentConfigs = pgTable('agent_configs', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').references(() => users.id),
  agentType: varchar('agent_type', { length: 100 }).notNull(),
  name: varchar('name', { length: 255 }).notNull(),
  description: text('description'),
  model: varchar('model', { length: 255 }),
  systemPrompt: text('system_prompt'),
  temperature: real('temperature'),
  maxTokens: integer('max_tokens'),
  maxIterations: integer('max_iterations'),
  isActive: boolean('is_active').default(true),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
  deletedAt: timestamp('deleted_at'),
})

export const dramas = pgTable('dramas', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').references(() => users.id),
  title: varchar('title', { length: 500 }).notNull(),
  description: text('description'),
  genre: varchar('genre', { length: 100 }),
  style: varchar('style', { length: 100 }).default('realistic'),
  totalEpisodes: integer('total_episodes').default(0),
  totalDuration: integer('total_duration').default(0),
  status: varchar('status', { length: 50 }).notNull().default('draft'),
  thumbnail: text('thumbnail'),
  tags: text('tags'),
  metadata: text('metadata'),
  isPublic: boolean('is_public').notNull().default(true),
  reviewStatus: varchar('review_status', { length: 50 }).default('pending'),
  reviewedBy: integer('reviewed_by'),
  reviewedAt: timestamp('reviewed_at'),
  reviewNote: text('review_note'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
  deletedAt: timestamp('deleted_at'),
})

export const episodes = pgTable('episodes', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').references(() => users.id),
  dramaId: integer('drama_id')
    .notNull()
    .references(() => dramas.id),
  episodeNumber: integer('episode_number').notNull(),
  title: varchar('title', { length: 500 }).notNull(),
  content: text('content'),
  scriptContent: text('script_content'),
  description: text('description'),
  duration: integer('duration').default(0),
  status: varchar('status', { length: 50 }).default('draft'),
  videoUrl: text('video_url'),
  thumbnail: text('thumbnail'),
  imageConfigId: integer('image_config_id').references(() => aiServiceConfigs.id),
  videoConfigId: integer('video_config_id').references(() => aiServiceConfigs.id),
  audioConfigId: integer('audio_config_id').references(() => aiServiceConfigs.id),
  reviewStatus: varchar('review_status', { length: 50 }).default('pending'),
  reviewedBy: integer('reviewed_by'),
  reviewedAt: timestamp('reviewed_at'),
  reviewNote: text('review_note'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
  deletedAt: timestamp('deleted_at'),
})

export const characters = pgTable('characters', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').references(() => users.id),
  dramaId: integer('drama_id')
    .notNull()
    .references(() => dramas.id),
  name: varchar('name', { length: 255 }).notNull(),
  role: varchar('role', { length: 100 }),
  description: text('description'),
  appearance: text('appearance'),
  personality: text('personality'),
  voiceStyle: varchar('voice_style', { length: 100 }),
  imageUrl: text('image_url'),
  referenceImages: text('reference_images'),
  seedValue: varchar('seed_value', { length: 255 }),
  sortOrder: integer('sort_order'),
  localPath: text('local_path'),
  voiceSampleUrl: text('voice_sample_url'),
  voiceProvider: varchar('voice_provider', { length: 100 }),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
  deletedAt: timestamp('deleted_at'),
})

export const episodeCharacters = pgTable('episode_characters', {
  id: serial('id').primaryKey(),
  episodeId: integer('episode_id')
    .notNull()
    .references(() => episodes.id),
  characterId: integer('character_id')
    .notNull()
    .references(() => characters.id),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

export const scenes = pgTable('scenes', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').references(() => users.id),
  dramaId: integer('drama_id')
    .notNull()
    .references(() => dramas.id),
  episodeId: integer('episode_id').references(() => episodes.id),
  location: varchar('location', { length: 500 }).notNull(),
  time: varchar('time', { length: 100 }).notNull(),
  prompt: text('prompt').notNull(),
  storyboardCount: integer('storyboard_count').default(1),
  imageUrl: text('image_url'),
  status: varchar('status', { length: 50 }).default('pending'),
  localPath: text('local_path'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
  deletedAt: timestamp('deleted_at'),
})

export const episodeScenes = pgTable('episode_scenes', {
  id: serial('id').primaryKey(),
  episodeId: integer('episode_id')
    .notNull()
    .references(() => episodes.id),
  sceneId: integer('scene_id')
    .notNull()
    .references(() => scenes.id),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

export const storyboards = pgTable('storyboards', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').references(() => users.id),
  episodeId: integer('episode_id')
    .notNull()
    .references(() => episodes.id),
  sceneId: integer('scene_id').references(() => scenes.id),
  storyboardNumber: integer('storyboard_number').notNull(),
  title: varchar('title', { length: 255 }),
  location: varchar('location', { length: 500 }),
  time: varchar('time', { length: 100 }),
  shotType: varchar('shot_type', { length: 100 }),
  angle: varchar('angle', { length: 100 }),
  movement: varchar('movement', { length: 100 }),
  action: text('action'),
  result: text('result'),
  atmosphere: text('atmosphere'),
  imagePrompt: text('image_prompt'),
  videoPrompt: text('video_prompt'),
  bgmPrompt: text('bgm_prompt'),
  soundEffect: text('sound_effect'),
  dialogue: text('dialogue'),
  description: text('description'),
  duration: integer('duration').default(0),
  composedImage: text('composed_image'),
  firstFrameImage: text('first_frame_image'),
  lastFrameImage: text('last_frame_image'),
  referenceImages: text('reference_images'),
  videoUrl: text('video_url'),
  ttsAudioUrl: text('tts_audio_url'),
  subtitleUrl: text('subtitle_url'),
  composedVideoUrl: text('composed_video_url'),
  status: varchar('status', { length: 50 }).default('pending'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
  deletedAt: timestamp('deleted_at'),
})

export const storyboardCharacters = pgTable('storyboard_characters', {
  storyboardId: integer('storyboard_id')
    .notNull()
    .references(() => storyboards.id),
  characterId: integer('character_id')
    .notNull()
    .references(() => characters.id),
})

export const props = pgTable('props', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').references(() => users.id),
  dramaId: integer('drama_id')
    .notNull()
    .references(() => dramas.id),
  name: varchar('name', { length: 255 }).notNull(),
  type: varchar('type', { length: 100 }),
  description: text('description'),
  prompt: text('prompt'),
  imageUrl: text('image_url'),
  referenceImages: text('reference_images'),
  localPath: text('local_path'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
  deletedAt: timestamp('deleted_at'),
})

export const imageGenerations = pgTable('image_generations', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').references(() => users.id),
  storyboardId: integer('storyboard_id').references(() => storyboards.id),
  dramaId: integer('drama_id').references(() => dramas.id),
  sceneId: integer('scene_id').references(() => scenes.id),
  characterId: integer('character_id').references(() => characters.id),
  propId: integer('prop_id').references(() => props.id),
  imageType: varchar('image_type', { length: 50 }),
  frameType: varchar('frame_type', { length: 50 }),
  provider: varchar('provider', { length: 100 }),
  prompt: text('prompt'),
  negativePrompt: text('negative_prompt'),
  model: varchar('model', { length: 255 }),
  size: varchar('size', { length: 50 }),
  quality: varchar('quality', { length: 50 }),
  style: varchar('style', { length: 100 }),
  steps: integer('steps'),
  cfgScale: real('cfg_scale'),
  seed: integer('seed'),
  imageUrl: text('image_url'),
  minioUrl: text('minio_url'),
  localPath: text('local_path'),
  status: varchar('status', { length: 50 }).default('pending'),
  taskId: varchar('task_id', { length: 255 }),
  errorMsg: text('error_msg'),
  width: integer('width'),
  height: integer('height'),
  referenceImages: text('reference_images'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
  completedAt: timestamp('completed_at'),
})

export const videoGenerations = pgTable('video_generations', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').references(() => users.id),
  storyboardId: integer('storyboard_id').references(() => storyboards.id),
  dramaId: integer('drama_id').references(() => dramas.id),
  provider: varchar('provider', { length: 100 }),
  prompt: text('prompt'),
  model: varchar('model', { length: 255 }),
  imageGenId: integer('image_gen_id').references(() => imageGenerations.id),
  referenceMode: varchar('reference_mode', { length: 50 }),
  imageUrl: text('image_url'),
  firstFrameUrl: text('first_frame_url'),
  lastFrameUrl: text('last_frame_url'),
  referenceImageUrls: text('reference_image_urls'),
  duration: integer('duration'),
  fps: integer('fps'),
  resolution: varchar('resolution', { length: 50 }),
  aspectRatio: varchar('aspect_ratio', { length: 50 }),
  style: varchar('style', { length: 100 }),
  motionLevel: integer('motion_level'),
  cameraMotion: varchar('camera_motion', { length: 100 }),
  seed: integer('seed'),
  videoUrl: text('video_url'),
  minioUrl: text('minio_url'),
  localPath: text('local_path'),
  status: varchar('status', { length: 50 }).default('pending'),
  taskId: varchar('task_id', { length: 255 }),
  errorMsg: text('error_msg'),
  width: integer('width'),
  height: integer('height'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
  completedAt: timestamp('completed_at'),
  deletedAt: timestamp('deleted_at'),
})

export const videoMerges = pgTable('video_merges', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').references(() => users.id),
  episodeId: integer('episode_id').references(() => episodes.id),
  dramaId: integer('drama_id').references(() => dramas.id),
  title: varchar('title', { length: 255 }),
  provider: varchar('provider', { length: 100 }),
  model: varchar('model', { length: 255 }),
  status: varchar('status', { length: 50 }).default('pending'),
  scenes: text('scenes'),
  mergedUrl: text('merged_url'),
  duration: integer('duration'),
  taskId: varchar('task_id', { length: 255 }),
  errorMsg: text('error_msg'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  completedAt: timestamp('completed_at'),
  deletedAt: timestamp('deleted_at'),
})

export const tasks = pgTable(
  'tasks',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id').references(() => users.id),
    type: varchar('type', { length: 50 }).notNull(),
    status: varchar('status', { length: 50 }).notNull(),
    title: varchar('title', { length: 255 }),
    progress: integer('progress'),
    sourceType: varchar('source_type', { length: 50 }).notNull(),
    dramaId: integer('drama_id').references(() => dramas.id),
    episodeId: integer('episode_id').references(() => episodes.id),
    storyboardId: integer('storyboard_id').references(() => storyboards.id),
    aiConfigId: integer('ai_config_id').references(() => aiServiceConfigs.id),
    domainTable: varchar('domain_table', { length: 100 }).notNull(),
    domainId: integer('domain_id').notNull(),
    providerTaskId: varchar('provider_task_id', { length: 255 }),
    attemptCount: integer('attempt_count').default(0),
    lockedBy: varchar('locked_by', { length: 255 }),
    lockedAt: timestamp('locked_at'),
    lockExpiresAt: timestamp('lock_expires_at'),
    payloadJson: text('payload_json'),
    resultSummaryJson: text('result_summary_json'),
    errorKind: varchar('error_kind', { length: 50 }),
    errorMessage: text('error_message'),
    errorDetailsJson: text('error_details_json'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
    startedAt: timestamp('started_at'),
    completedAt: timestamp('completed_at'),
    deletedAt: timestamp('deleted_at'),
  },
  (table) => [
    index('idx_tasks_status_updated_at').on(table.status, table.updatedAt),
    index('idx_tasks_source_type').on(table.sourceType, table.type),
    index('idx_tasks_user_id_updated_at').on(table.userId, table.updatedAt),
  ],
)

export const taskLogs = pgTable('task_logs', {
  id: serial('id').primaryKey(),
  taskId: integer('task_id').notNull().references(() => tasks.id),
  userId: integer('user_id').references(() => users.id),
  level: varchar('level', { length: 20 }).notNull().default('info'),
  message: text('message').notNull(),
  metadataJson: text('metadata_json'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (table) => [
  index('idx_task_logs_task_id').on(table.taskId),
  index('idx_task_logs_created_at').on(table.createdAt),
])

export const assets = pgTable(
  'assets',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id').references(() => users.id),
    kind: varchar('kind', { length: 50 }).notNull().default('image'),
    title: varchar('title', { length: 255 }).notNull(),
    provider: varchar('provider', { length: 100 }),
    mimeType: varchar('mime_type', { length: 100 }),
    sourceType: varchar('source_type', { length: 50 }).notNull().default('legacy_asset'),
    sourceId: integer('source_id'),
    sourceRef: text('source_ref'),
    sourcePath: text('source_path'),
    dramaId: integer('drama_id').references(() => dramas.id),
    episodeId: integer('episode_id').references(() => episodes.id),
    storyboardId: integer('storyboard_id').references(() => storyboards.id),
    taskId: integer('task_id').references(() => tasks.id),
    imageGenerationId: integer('image_generation_id').references(() => imageGenerations.id),
    videoGenerationId: integer('video_generation_id').references(() => videoGenerations.id),
    url: text('url'),
    localPath: text('local_path'),
    thumbnailUrl: text('thumbnail_url'),
    metadataJson: text('metadata_json'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
    deletedAt: timestamp('deleted_at'),
  },
  (table) => [
    index('idx_assets_user_id_updated_at').on(table.userId, table.updatedAt),
    index('idx_assets_drama_id').on(table.dramaId),
    index('idx_assets_task_id').on(table.taskId),
    index('idx_assets_source_ref').on(table.sourceRef),
  ],
)

export const quickVideoSessions = pgTable(
  'quick_video_sessions',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id').notNull().references(() => users.id),
    title: varchar('title', { length: 255 }).notNull().default('新创作'),
    status: varchar('status', { length: 20 }).notNull().default('active'),
    dominantOperation: varchar('dominant_operation', { length: 20 }),
    summary: text('summary'),
    coverOutputId: integer('cover_output_id'),
    metadataJson: text('metadata_json'),
    lastMessageAt: timestamp('last_message_at').notNull().defaultNow(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
    deletedAt: timestamp('deleted_at'),
  },
  (table) => [
    index('idx_quick_video_sessions_user_last_message').on(table.userId, table.lastMessageAt),
    index('idx_quick_video_sessions_user_status').on(table.userId, table.status),
    index('idx_quick_video_sessions_deleted_at').on(table.deletedAt),
  ],
)

export const quickVideoRounds = pgTable(
  'quick_video_rounds',
  {
    id: serial('id').primaryKey(),
    sessionId: integer('session_id').notNull().references(() => quickVideoSessions.id),
    parentRoundId: integer('parent_round_id'),
    deriveFrom: varchar('derive_from', { length: 32 }),
    operationType: varchar('operation_type', { length: 20 }).notNull(),
    prompt: text('prompt').notNull(),
    attachmentsJson: text('attachments_json').notNull().default('[]'),
    configSnapshotJson: text('config_snapshot_json'),
    status: varchar('status', { length: 20 }).notNull().default('queued'),
    taskId: integer('task_id'),
    domainId: integer('domain_id'),
    progress: integer('progress'),
    errorMessage: text('error_message'),
    branchName: varchar('branch_name', { length: 255 }),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
    deletedAt: timestamp('deleted_at'),
  },
  (table) => [
    index('idx_quick_video_rounds_session_created').on(table.sessionId, table.createdAt),
    index('idx_quick_video_rounds_parent').on(table.parentRoundId),
    index('idx_quick_video_rounds_deleted_at').on(table.deletedAt),
  ],
)

export const quickVideoOutputs = pgTable(
  'quick_video_outputs',
  {
    id: serial('id').primaryKey(),
    roundId: integer('round_id').notNull().references(() => quickVideoRounds.id),
    kind: varchar('kind', { length: 20 }).notNull(),
    taskId: integer('task_id'),
    domainId: integer('domain_id'),
    previewUrl: text('preview_url').notNull(),
    thumbUrl: text('thumb_url'),
    status: varchar('status', { length: 20 }).notNull().default('completed'),
    metadataJson: text('metadata_json'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    index('idx_quick_video_outputs_round_created').on(table.roundId, table.createdAt),
    index('idx_quick_video_outputs_task_id').on(table.taskId),
  ],
)

export const writings = pgTable(
  'writings',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id').references(() => users.id),
    title: varchar('title', { length: 255 }).notNull(),
    kind: varchar('kind', { length: 50 }).notNull().default('novel'),
    status: varchar('status', { length: 50 }).notNull().default('draft'),
    synopsis: text('synopsis'),
    outlineJson: text('outline_json'),
    briefJson: text('brief_json'),
    currentDocumentId: integer('current_document_id'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
    deletedAt: timestamp('deleted_at'),
  },
  (table) => [index('idx_writings_user_id_updated_at').on(table.userId, table.updatedAt)],
)

export const writingDocuments = pgTable(
  'writing_documents',
  {
    id: serial('id').primaryKey(),
    writingId: integer('writing_id')
      .notNull()
      .references(() => writings.id),
    userId: integer('user_id').references(() => users.id),
    parentId: integer('parent_id'),
    title: varchar('title', { length: 255 }).notNull(),
    documentType: varchar('document_type', { length: 50 }).notNull().default('chapter'),
    sortOrder: integer('sort_order').notNull().default(0),
    contentMd: text('content_md').notNull().default(''),
    summary: text('summary'),
    wordCount: integer('word_count'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
    deletedAt: timestamp('deleted_at'),
  },
  (table) => [index('idx_writing_documents_writing_id_sort_order').on(table.writingId, table.sortOrder)],
)

export const aiRuns = pgTable(
  'ai_runs',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id').references(() => users.id),
    skillId: varchar('skill_id', { length: 100 }).notNull(),
    mode: varchar('mode', { length: 100 }).notNull(),
    scene: varchar('scene', { length: 100 }).notNull(),
    targetType: varchar('target_type', { length: 50 }).notNull(),
    targetId: integer('target_id').notNull(),
    status: varchar('status', { length: 50 }).notNull().default('completed'),
    userMessage: text('user_message'),
    assistantMessage: text('assistant_message'),
    referencesJson: text('references_json'),
    actionsJson: text('actions_json'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [
    index('idx_ai_runs_target').on(table.targetType, table.targetId, table.createdAt),
    index('idx_ai_runs_user_created_at').on(table.userId, table.createdAt),
  ],
)
export const writingProposals = pgTable(
  'writing_proposals',
  {
    id: serial('id').primaryKey(),
    writingId: integer('writing_id').notNull().references(() => writings.id),
    userId: integer('user_id').references(() => users.id),
    sourceRunId: integer('source_run_id').references(() => aiRuns.id),
    proposalKind: varchar('proposal_kind', { length: 100 }).notNull().default('generic'),
    targetKind: varchar('target_kind', { length: 50 }).notNull().default('proposal'),
    targetDocumentId: integer('target_document_id').references(() => writingDocuments.id),
    title: varchar('title', { length: 255 }).notNull(),
    content: text('content').notNull().default(''),
    structuredJson: text('structured_json'),
    referencesJson: text('references_json'),
    status: varchar('status', { length: 30 }).notNull().default('pending'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
    appliedAt: timestamp('applied_at'),
    rejectedAt: timestamp('rejected_at'),
  },
  (table) => [
    index('idx_writing_proposals_writing_id_created_at').on(table.writingId, table.createdAt),
    index('idx_writing_proposals_user_status').on(table.userId, table.status, table.createdAt),
  ],
)

export const writingKnowledgeCards = pgTable(
  'writing_knowledge_cards',
  {
    id: serial('id').primaryKey(),
    writingId: integer('writing_id').notNull().references(() => writings.id),
    userId: integer('user_id').references(() => users.id),
    proposalId: integer('proposal_id').references(() => writingProposals.id),
    cardType: varchar('card_type', { length: 50 }).notNull(),
    title: varchar('title', { length: 255 }).notNull(),
    content: text('content').notNull().default(''),
    evidenceJson: text('evidence_json'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
    deletedAt: timestamp('deleted_at'),
  },
  (table) => [
    index('idx_writing_knowledge_cards_writing_id_created_at').on(table.writingId, table.createdAt),
    index('idx_writing_knowledge_cards_user_card_type').on(table.userId, table.cardType, table.createdAt),
  ],
)

export const writingObjectHistories = pgTable(
  'writing_object_histories',
  {
    id: serial('id').primaryKey(),
    writingId: integer('writing_id').notNull().references(() => writings.id),
    userId: integer('user_id').references(() => users.id),
    objectKind: varchar('object_kind', { length: 50 }).notNull(),
    documentId: integer('document_id').references(() => writingDocuments.id),
    snapshotTitle: varchar('snapshot_title', { length: 255 }),
    content: text('content').notNull().default(''),
    sourceProposalId: integer('source_proposal_id').references(() => writingProposals.id),
    sourceRunId: integer('source_run_id').references(() => aiRuns.id),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    index('idx_writing_object_histories_writing_kind_created_at').on(table.writingId, table.objectKind, table.createdAt),
    index('idx_writing_object_histories_document_id_created_at').on(table.documentId, table.createdAt),
  ],
)

export const writingKnowledgeCardHistories = pgTable(
  'writing_knowledge_card_histories',
  {
    id: serial('id').primaryKey(),
    writingId: integer('writing_id').notNull().references(() => writings.id),
    knowledgeCardId: integer('knowledge_card_id').notNull().references(() => writingKnowledgeCards.id),
    userId: integer('user_id').references(() => users.id),
    cardType: varchar('card_type', { length: 50 }).notNull(),
    title: varchar('title', { length: 255 }).notNull(),
    content: text('content').notNull().default(''),
    evidenceJson: text('evidence_json'),
    sourceProposalId: integer('source_proposal_id').references(() => writingProposals.id),
    sourceRunId: integer('source_run_id').references(() => aiRuns.id),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    index('idx_writing_knowledge_card_histories_card_created_at').on(table.knowledgeCardId, table.createdAt),
    index('idx_writing_knowledge_card_histories_writing_created_at').on(table.writingId, table.createdAt),
  ],
)


export const writingBatchExecutions = pgTable(
  'writing_batch_executions',
  {
    id: serial('id').primaryKey(),
    writingId: integer('writing_id').notNull().references(() => writings.id),
    userId: integer('user_id').references(() => users.id),
    proposalIdsJson: text('proposal_ids_json').notNull().default('[]'),
    recommendedProposalIdsJson: text('recommended_proposal_ids_json').notNull().default('[]'),
    resultsJson: text('results_json').notNull().default('[]'),
    rollbackJson: text('rollback_json').notNull().default('[]'),
    note: varchar('note', { length: 255 }),
    tag: varchar('tag', { length: 100 }),
    isPinned: boolean('is_pinned').notNull().default(false),
    isImportant: boolean('is_important').notNull().default(false),
    appliedCount: integer('applied_count').notNull().default(0),
    stoppedAtProposalId: integer('stopped_at_proposal_id'),
    blockedByConflict: boolean('blocked_by_conflict').notNull().default(false),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    index('idx_writing_batch_executions_writing_created_at').on(table.writingId, table.createdAt),
    index('idx_writing_batch_executions_user_created_at').on(table.userId, table.createdAt),
  ],
)

// ============================================================
// 画布模块 (Canvas) — v1.0.0
// ID 约定：所有 canvas 表使用 text UUID（前端生成），仅 user_id 为 integer FK
// 字段命名：snake_case DB columns → 前端 snake_case JSON（is_pinned, created_at 等）
// ============================================================

// ----------------------------
// canvases — 画布主表
// ----------------------------
export const canvases = pgTable(
  'canvases',
  {
    id: text('id').primaryKey(),
    userId: integer('user_id').notNull().references(() => users.id),
    title: varchar('title', { length: 100 }).notNull().default('未命名画布'),
    source: varchar('source', { length: 50 }).notNull().default('blank'),
    isPinned: boolean('is_pinned').notNull().default(false),
    sortOrder: integer('sort_order').notNull().default(0),
    colorPaletteJson: text('color_palette_json').notNull().default('[]'),
    compositeSettingsJson: text('composite_settings_json').notNull().default('{"resolution":"1080p","fps":24,"transition":"none"}'),
    currentVersionId: text('current_version_id'),
    thumbnail: text('thumbnail'),
    sourceDramaId: text('source_drama_id'),
    sourceEpisodeId: text('source_episode_id'),
    sourceDramaTitle: text('source_drama_title'),
    sourceDramaSnapshotAt: text('source_drama_snapshot_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
    deletedAt: timestamp('deleted_at'),
  },
  (table) => [
    index('idx_canvases_user_id').on(table.userId),
    index('idx_canvases_user_pinned').on(table.userId, table.isPinned),
    index('idx_canvases_deleted_at').on(table.deletedAt),
  ],
)

// ----------------------------
// canvas_nodes — 节点表
// ----------------------------
export const canvasNodes = pgTable(
  'canvas_nodes',
  {
    id: text('id').primaryKey(),
    canvasId: text('canvas_id').notNull().references(() => canvases.id, { onDelete: 'cascade' }),
    versionId: text('version_id'),
    nodeDefId: varchar('node_def_id', { length: 50 }).notNull(),
    label: varchar('label', { length: 100 }).notNull().default(''),
    dataJson: text('data_json').notNull().default('{}'),
    positionX: real('position_x').notNull().default(0),
    positionY: real('position_y').notNull().default(0),
    width: integer('width').notNull().default(260),
    height: integer('height').notNull().default(230),
    zIndex: integer('z_index').notNull().default(0),
    color: varchar('color', { length: 10 }),
    shotIndex: integer('shot_index'),
    parentStoryboardId: text('parent_storyboard_id'),
    isHidden: boolean('is_hidden').notNull().default(false),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [
    index('idx_canvas_nodes_canvas_id').on(table.canvasId),
    index('idx_canvas_nodes_version_id').on(table.versionId),
    index('idx_canvas_nodes_position').on(table.canvasId, table.positionX, table.positionY),
    index('idx_canvas_nodes_def_id').on(table.canvasId, table.nodeDefId),
  ],
)

// ----------------------------
// canvas_edges — 连线表
// ----------------------------
export const canvasEdges = pgTable(
  'canvas_edges',
  {
    id: text('id').primaryKey(),
    canvasId: text('canvas_id').notNull().references(() => canvases.id, { onDelete: 'cascade' }),
    sourceNodeId: text('source_node_id').notNull(),
    targetNodeId: text('target_node_id').notNull(),
    edgeKind: varchar('edge_kind', { length: 20 }).notNull().default('narrative'),
    relationType: varchar('relation_type', { length: 20 }),
    thickness: varchar('thickness', { length: 10 }),
    sourcePort: varchar('source_port', { length: 50 }),
    targetPort: varchar('target_port', { length: 50 }),
    label: varchar('label', { length: 50 }),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    index('idx_canvas_edges_canvas_id').on(table.canvasId),
    index('idx_canvas_edges_source').on(table.canvasId, table.sourceNodeId),
    index('idx_canvas_edges_target').on(table.canvasId, table.targetNodeId),
    index('idx_canvas_edges_kind').on(table.canvasId, table.edgeKind),
  ],
)

// ----------------------------
// canvas_viewport — 视口表
// ----------------------------
export const canvasViewports = pgTable(
  'canvas_viewports',
  {
    id: text('id').primaryKey(),
    canvasId: text('canvas_id').notNull().unique().references(() => canvases.id, { onDelete: 'cascade' }),
    x: real('x').notNull().default(0),
    y: real('y').notNull().default(0),
    zoom: real('zoom').notNull().default(1.0),
    infoLayersJson: text('info_layers_json').notNull().default('{"emotion":false,"rhythm":false,"shotType":false,"ai":false}'),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
)

// ----------------------------
// canvas_versions — 版本表
// ----------------------------
export const canvasVersions = pgTable(
  'canvas_versions',
  {
    id: text('id').primaryKey(),
    canvasId: text('canvas_id').notNull().references(() => canvases.id, { onDelete: 'cascade' }),
    type: varchar('type', { length: 20 }).notNull(),
    label: varchar('label', { length: 100 }),
    runId: text('run_id'),
    nodeCount: integer('node_count').notNull().default(0),
    edgeCount: integer('edge_count').notNull().default(0),
    thumbnail: text('thumbnail'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    index('idx_canvas_versions_canvas_id').on(table.canvasId, table.type),
    index('idx_canvas_versions_run_id').on(table.runId),
  ],
)

// ----------------------------
// canvas_version_nodes — 版本节点快照
// ----------------------------
export const canvasVersionNodes = pgTable(
  'canvas_version_nodes',
  {
    id: text('id').primaryKey(),
    versionId: text('version_id').notNull().references(() => canvasVersions.id, { onDelete: 'cascade' }),
    originalNodeId: text('original_node_id').notNull(),
    nodeDefId: varchar('node_def_id', { length: 50 }).notNull(),
    label: varchar('label', { length: 100 }).notNull().default(''),
    dataJson: text('data_json').notNull().default('{}'),
    positionX: real('position_x').notNull().default(0),
    positionY: real('position_y').notNull().default(0),
    width: integer('width').notNull().default(260),
    height: integer('height').notNull().default(230),
    zIndex: integer('z_index').notNull().default(0),
    shotIndex: integer('shot_index'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    index('idx_canvas_version_nodes_version_id').on(table.versionId),
  ],
)

// ----------------------------
// canvas_version_edges — 版本连线快照
// ----------------------------
export const canvasVersionEdges = pgTable(
  'canvas_version_edges',
  {
    id: text('id').primaryKey(),
    versionId: text('version_id').notNull().references(() => canvasVersions.id, { onDelete: 'cascade' }),
    originalEdgeId: text('original_edge_id').notNull(),
    sourceNodeId: text('source_node_id').notNull(),
    targetNodeId: text('target_node_id').notNull(),
    edgeKind: varchar('edge_kind', { length: 20 }).notNull().default('narrative'),
    relationType: varchar('relation_type', { length: 20 }),
    thickness: varchar('thickness', { length: 10 }),
    sourcePort: varchar('source_port', { length: 50 }),
    targetPort: varchar('target_port', { length: 50 }),
    label: varchar('label', { length: 50 }),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    index('idx_canvas_version_edges_version_id').on(table.versionId),
  ],
)

// ----------------------------
// canvas_runs — 运行记录表
// ----------------------------
export const canvasRuns = pgTable(
  'canvas_runs',
  {
    id: text('id').primaryKey(),
    canvasId: text('canvas_id').notNull().references(() => canvases.id, { onDelete: 'cascade' }),
    versionId: text('version_id').notNull().references(() => canvasVersions.id, { onDelete: 'cascade' }),
    status: varchar('status', { length: 30 }).notNull().default('pending'),
    totalNodes: integer('total_nodes').notNull().default(0),
    completedNodes: integer('completed_nodes').notNull().default(0),
    failedNodes: integer('failed_nodes').notNull().default(0),
    skippedNodes: integer('skipped_nodes').notNull().default(0),
    progress: real('progress').notNull().default(0),
    creditsConsumed: real('credits_consumed').notNull().default(0),
    errorMessage: text('error_message'),
    startedAt: timestamp('started_at'),
    completedAt: timestamp('completed_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    index('idx_canvas_runs_canvas_id').on(table.canvasId),
    index('idx_canvas_runs_status').on(table.status),
  ],
)

// ----------------------------
// canvas_tasks — 异步任务表
// ----------------------------
export const canvasTasks = pgTable(
  'canvas_tasks',
  {
    id: text('id').primaryKey(),
    runId: text('run_id').notNull().references(() => canvasRuns.id, { onDelete: 'cascade' }),
    canvasId: text('canvas_id').notNull().references(() => canvases.id, { onDelete: 'cascade' }),
    nodeId: text('node_id').notNull(),
    nodeDefId: varchar('node_def_id', { length: 50 }).notNull(),
    status: varchar('status', { length: 20 }).notNull().default('pending'),
    paramsJson: text('params_json').notNull().default('{}'),
    resultJson: text('result_json'),
    errorMessage: text('error_message'),
    errorCode: varchar('error_code', { length: 50 }),
    progress: real('progress').notNull().default(0),
    retryCount: integer('retry_count').notNull().default(0),
    maxRetries: integer('max_retries').notNull().default(3),
    bullmqJobId: varchar('bullmq_job_id', { length: 255 }),
    startedAt: timestamp('started_at'),
    completedAt: timestamp('completed_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    index('idx_canvas_tasks_run_id').on(table.runId),
    index('idx_canvas_tasks_canvas_id').on(table.canvasId),
    index('idx_canvas_tasks_node_id').on(table.nodeId),
    index('idx_canvas_tasks_status').on(table.status),
  ],
)

// ----------------------------
// canvas_custom_terms — 用户自定义术语
// ----------------------------
export const canvasCustomTerms = pgTable(
  'canvas_custom_terms',
  {
    id: text('id').primaryKey(),
    userId: integer('user_id').notNull().references(() => users.id),
    fieldType: varchar('field_type', { length: 20 }).notNull(),
    term: varchar('term', { length: 100 }).notNull(),
    useCount: integer('use_count').notNull().default(1),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('idx_canvas_custom_terms_user_field_term').on(table.userId, table.fieldType, table.term),
  ],
)
