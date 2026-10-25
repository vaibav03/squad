// Dev-only: @squad/core's browser entry transitively imports node:crypto (llm/fake.ts). The village never calls it.
export const createHash = () => { throw new Error('node:crypto is not available in the browser'); };
