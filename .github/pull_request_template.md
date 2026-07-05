## Change Summary

-

## Verification

- [ ] `npm test --workspace apps/backend`
- [ ] `npm run typecheck --workspace apps/backend`
- [ ] `npm run build --workspace apps/backend`
- [ ] `npm run lint --workspace apps/web`
- [ ] `npm run build --workspace apps/web`
- [ ] Other:

## Risk Checklist

- [ ] I did not commit generated media or runtime data under `apps/data/static/`.
- [ ] I called out database, queue, storage, or worker behavior changes.
- [ ] I called out user-visible interaction changes.
- [ ] I checked unrelated dirty files and did not revert others' work.
