// Abandoned: a Vercel Function entrypoint for the sync server, saving boards
// to Vercel Blob instead of local disk. By the time this was built, the rest
// of the app (accounts, board list, uploaded images) had grown to depend on
// local disk too (server/store.ts, server/assets.ts), so this alone didn't
// make the app deployable on Vercel. Not wired into anything; not built or
// type-checked (excluded from tsconfig.json). Kept only so the next person
// to try this sees why it didn't work, rather than redoing the exploration.
// Safe to delete, along with ../vercel.json.
export {}
