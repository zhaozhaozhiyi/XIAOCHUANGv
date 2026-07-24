import { HttpResponse, http } from 'msw'

import { dramaReviewFixtures, type DramaReviewFixtureName } from '../data/drama-review'

function reviewFixtureName(value: string | null): DramaReviewFixtureName {
  return value && value in dramaReviewFixtures
    ? value as DramaReviewFixtureName
    : 'pending'
}

export const dramaWorkspaceHandlers = [
  http.get('/api/v1/dramas/:dramaId/reviews/summary', ({ request }) => {
    const fixture = reviewFixtureName(new URL(request.url).searchParams.get('fixture'))
    return HttpResponse.json(dramaReviewFixtures[fixture])
  }),
]
