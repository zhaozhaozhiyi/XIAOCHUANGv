import {
  DRAMA_WORKSPACE_CONTRACT_VERSION,
  type DramaReviewSummary,
} from '@xiaochuang/contracts'

const pendingStoryboard = {
  subject_type: 'storyboard_set' as const,
  subject_id: '88',
  episode_id: 33,
  episode_number: 3,
  label: '第 3 集分镜',
  href: '/drama/7/episodes/3?stage=storyboard',
  version_key: 'fixture-storyboard-v2',
  review_status: 'pending_confirmation' as const,
  reviewed_at: null,
  review_note: null,
}

export const dramaReviewFixtures = {
  pending: {
    contract_version: DRAMA_WORKSPACE_CONTRACT_VERSION,
    primary_action: {
      kind: 'confirm_storyboard',
      title: '确认第 3 集分镜',
      description: '当前版本尚未确认，确认后才能继续生成镜头。',
      href: pendingStoryboard.href,
      subject_type: pendingStoryboard.subject_type,
      subject_id: pendingStoryboard.subject_id,
    },
    review: {
      total: 3,
      confirmed: 1,
      needs_attention: 2,
      deliverable: false,
      items: [
        pendingStoryboard,
        {
          subject_type: 'episode_final',
          subject_id: '33',
          episode_id: 33,
          episode_number: 3,
          label: '第 3 集成片',
          href: '/drama/7/episodes/3?stage=final',
          version_key: 'fixture-final-v1',
          review_status: 'stale',
          reviewed_at: '2026-07-12T08:00:00.000Z',
          review_note: '分镜已更新，请重新检查成片。',
        },
        {
          subject_type: 'episode_script',
          subject_id: '31',
          episode_id: 31,
          episode_number: 1,
          label: '第 1 集剧本',
          href: '/drama/7/episodes/1?stage=script',
          version_key: 'fixture-script-v1',
          review_status: 'confirmed',
          reviewed_at: '2026-07-12T07:30:00.000Z',
          review_note: null,
        },
      ],
    },
  },
  rework: {
    contract_version: DRAMA_WORKSPACE_CONTRACT_VERSION,
    primary_action: {
      kind: 'confirm_final',
      title: '处理第 2 集成片',
      description: '该版本已标记需重做，请处理后再确认。',
      href: '/drama/7/episodes/2?stage=final',
      subject_type: 'episode_final',
      subject_id: '32',
    },
    review: {
      total: 1,
      confirmed: 0,
      needs_attention: 1,
      deliverable: false,
      items: [{
        subject_type: 'episode_final',
        subject_id: '32',
        episode_id: 32,
        episode_number: 2,
        label: '第 2 集成片',
        href: '/drama/7/episodes/2?stage=final',
        version_key: 'fixture-final-rework-v1',
        review_status: 'rework_required',
        reviewed_at: '2026-07-13T07:00:00.000Z',
        review_note: '节奏不连贯，需要重新合成。',
      }],
    },
  },
  deliverable: {
    contract_version: DRAMA_WORKSPACE_CONTRACT_VERSION,
    primary_action: {
      kind: 'review_project',
      title: '可以交付',
      description: '所有当前版本均已确认。',
      href: '/drama/7/final',
      subject_type: null,
      subject_id: null,
    },
    review: {
      total: 3,
      confirmed: 3,
      needs_attention: 0,
      deliverable: true,
      items: [],
    },
  },
  empty: {
    contract_version: DRAMA_WORKSPACE_CONTRACT_VERSION,
    primary_action: {
      kind: 'create_reviewable_output',
      title: '先完成一个可审核版本',
      description: '剧本、分镜或成片完成后会出现在这里。',
      href: '/drama/7/episodes?stage=source',
      subject_type: null,
      subject_id: null,
    },
    review: {
      total: 0,
      confirmed: 0,
      needs_attention: 0,
      deliverable: false,
      items: [],
    },
  },
} satisfies Record<string, DramaReviewSummary>

export type DramaReviewFixtureName = keyof typeof dramaReviewFixtures
