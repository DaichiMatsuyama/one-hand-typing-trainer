const commit = typeof __BUILD_COMMIT__ === 'undefined' ? 'dev' : __BUILD_COMMIT__
const date = typeof __BUILD_DATE__ === 'undefined' ? 'dev' : __BUILD_DATE__

export const BUILD_COMMIT = commit
export const BUILD_DATE = date
export const BUILD_ID = `版 ${commit} · ${date}`
